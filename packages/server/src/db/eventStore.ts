import { sql } from 'drizzle-orm'
import { db, schema } from './index.js'

export type EventRow = {
  deviceId: string
  sessionId: string
  userId: string | null
  platform: string
  host: string | null
  name: string
  props: string | null
  country: string | null
  lang: string | null
}

export function insertEvents(rows: EventRow[]): void {
  if (rows.length === 0) return
  const now = new Date()
  db.insert(schema.events).values(rows.map((r) => ({ ...r, createdAt: now }))).run()
}

export type DailySummary = {
  day: string
  opens: number
  devices: number
  newDevices: number
  /** Client-reported PvP match_end events (practice excluded). Undercounts: fired via sendBeacon on pagehide. */
  matches: number
  /** Completed PvP matches from the server's `matches` table — the authoritative count, forfeits included. */
  serverMatches: number
  /** Of serverMatches, how many were the queue's bot fallback. */
  botMatches: number
  /**
   * serverMatches minus botMatches — human against human. Carried explicitly
   * because it is the number the game is actually judged on, and leaving it as
   * a subtraction invited reading `serverMatches` as if it meant PvP.
   */
  pvpMatches: number
  /** Of botMatches, how many the human won (the bot always sits in slot B). */
  botHumanWins: number
  /** Of devices first seen the previous day, how many came back on this one. */
  d1Retained: number
}

/** SQL fragment: the event is a practice (tutorial/bot) one per its props. */
const IS_PRACTICE = sql.raw(`COALESCE(json_extract(props, '$.practice'), 0) = 1`)

let excludedDevices: string[] = []

/**
 * Device ids to leave out of every aggregate — our own browsers, mostly. A
 * developer reloading the game all day lands in the report as the most engaged
 * player on the most engaged platform, which is precisely the row being read
 * for signal. Set from STATS_EXCLUDE_DEVICES at boot.
 *
 * The one place this cannot reach: `serverMatches` / `botMatches` come from the
 * `matches` table, which has no device column, so matches played by an excluded
 * device still count there.
 */
export function setExcludedDevices(ids: string[]): void {
  excludedDevices = ids.map((s) => s.trim()).filter((s) => s.length > 0)
}

/** An `AND`-able fragment — a true constant while nothing is excluded. */
function deviceAllowed() {
  if (excludedDevices.length === 0) return sql`1 = 1`
  return sql`device_id NOT IN (${sql.join(excludedDevices.map((id) => sql`${id}`), sql.raw(', '))})`
}

/**
 * One row per day, newest first. Everything is derived from raw events on read —
 * at this game's traffic there is no need for rollup tables yet.
 */
export function getDailySummary(days = 14): DailySummary[] {
  const window = '-' + Math.max(1, Math.min(days, 90)) + ' days'
  const rows = db.all<{
    day: string
    opens: number
    devices: number
    new_devices: number
    matches: number
    d1_retained: number
  }>(sql`
    WITH firsts AS (
      SELECT device_id, date(MIN(created_at), 'unixepoch') AS first_day
      FROM events GROUP BY device_id
    ),
    daily AS (
      SELECT date(created_at, 'unixepoch') AS day,
             device_id,
             SUM(CASE WHEN name = 'app_open' THEN 1 ELSE 0 END) AS opens,
             SUM(CASE WHEN name = 'match_end' AND NOT ${IS_PRACTICE} THEN 1 ELSE 0 END) AS matches
      FROM events
      WHERE created_at >= unixepoch('now', ${window}) AND ${deviceAllowed()}
      GROUP BY day, device_id
    )
    SELECT d.day AS day,
           SUM(d.opens) AS opens,
           COUNT(*) AS devices,
           SUM(CASE WHEN f.first_day = d.day THEN 1 ELSE 0 END) AS new_devices,
           SUM(d.matches) AS matches,
           SUM(CASE WHEN f.first_day = date(d.day, '-1 day')
                    THEN 1 ELSE 0 END) AS d1_retained
    FROM daily d
    JOIN firsts f ON f.device_id = d.device_id
    GROUP BY d.day
    ORDER BY d.day DESC
  `)

  const serverRows = db.all<{ day: string; n: number; bots: number; bot_human_wins: number }>(sql`
    SELECT date(created_at, 'unixepoch') AS day,
           COUNT(*) AS n,
           SUM(vs_bot) AS bots,
           SUM(CASE WHEN vs_bot AND winner = 'A' THEN 1 ELSE 0 END) AS bot_human_wins
    FROM matches
    WHERE created_at >= unixepoch('now', ${window})
    GROUP BY day
  `)
  const serverByDay = new Map(serverRows.map((r) => [r.day, r]))

  return rows.map((r) => {
    const s = serverByDay.get(r.day)
    return {
      day: r.day,
      opens: r.opens,
      devices: r.devices,
      newDevices: r.new_devices,
      matches: r.matches,
      serverMatches: s?.n ?? 0,
      botMatches: s?.bots ?? 0,
      pvpMatches: (s?.n ?? 0) - (s?.bots ?? 0),
      botHumanWins: s?.bot_human_wins ?? 0,
      d1Retained: r.d1_retained,
    }
  })
}

/** Event counts by name for a quick funnel read, over the last `days`. `practice` is how many of `count` came from tutorial/bot matches. */
export function getEventCounts(days = 14): { name: string; count: number; devices: number; practice: number }[] {
  return db.all<{ name: string; count: number; devices: number; practice: number }>(sql`
    SELECT name, COUNT(*) AS count, COUNT(DISTINCT device_id) AS devices,
           SUM(CASE WHEN ${IS_PRACTICE} THEN 1 ELSE 0 END) AS practice
    FROM events
    WHERE created_at >= unixepoch('now', ${'-' + Math.max(1, Math.min(days, 90)) + ' days'})
      AND ${deviceAllowed()}
    GROUP BY name
    ORDER BY count DESC
  `)
}

export type PropsAudit = {
  name: string
  total: number
  /** Events of this name that arrived with no props at all. */
  noProps: number
  /** Events IS_PRACTICE counts as practice. */
  practiceTrue: number
  /** One real props payload, to eyeball what the client is actually sending. */
  sampleProps: string | null
}

/**
 * Which events carry which props, per name. This exists to settle a specific
 * question the aggregates above cannot answer about themselves: every
 * "practice excluded" metric leans on IS_PRACTICE, so if the flag lands on the
 * wrong events, both the daily and the platform summary are wrong in the same
 * direction and stay consistent with each other while doing it. An event whose
 * client-side `track()` call passes no props must show `noProps === total` and
 * `practiceTrue === 0` here; anything else means the deployed client is not the
 * one in this repository.
 */
export function getPropsAudit(days = 14): PropsAudit[] {
  return db.all<{ name: string; total: number; no_props: number; practice_true: number; sample_props: string | null }>(sql`
    SELECT name,
           COUNT(*)                  AS total,
           SUM(props IS NULL)        AS no_props,
           SUM(CASE WHEN ${IS_PRACTICE} THEN 1 ELSE 0 END) AS practice_true,
           MIN(props)                AS sample_props
    FROM events
    WHERE created_at >= unixepoch('now', ${'-' + Math.max(1, Math.min(days, 90)) + ' days'})
      AND ${deviceAllowed()}
    GROUP BY name
    ORDER BY total DESC
  `).map((r) => ({
    name: r.name,
    total: r.total,
    noProps: r.no_props,
    practiceTrue: r.practice_true,
    sampleProps: r.sample_props,
  }))
}

export type PlatformSummary = {
  platform: string
  host: string | null
  /** Devices active in the window, attributed to the platform/host of their first-ever event. */
  devices: number
  newDevices: number
  opens: number
  matchStarts: number
  matchEnds: number
  /** Of this platform's new devices, how many came back the day after they were first seen. */
  d1Retained: number
}

/** Per-portal acquisition/retention comparison over the last `days`. */
export function getPlatformSummary(days = 14): PlatformSummary[] {
  const window = '-' + Math.max(1, Math.min(days, 90)) + ' days'
  const rows = db.all<{
    platform: string
    host: string | null
    devices: number
    new_devices: number
    opens: number
    match_starts: number
    match_ends: number
    d1_retained: number
  }>(sql`
    WITH firsts AS (
      SELECT device_id,
             date(MIN(created_at), 'unixepoch') AS first_day,
             MIN(id) AS first_event_id
      FROM events GROUP BY device_id
    ),
    attribution AS (
      SELECT f.device_id, e.platform, e.host, f.first_day
      FROM firsts f JOIN events e ON e.id = f.first_event_id
    ),
    period AS (
      SELECT device_id,
             SUM(CASE WHEN name = 'app_open' THEN 1 ELSE 0 END) AS opens,
             SUM(CASE WHEN name = 'match_start' AND NOT ${IS_PRACTICE} THEN 1 ELSE 0 END) AS match_starts,
             SUM(CASE WHEN name = 'match_end' AND NOT ${IS_PRACTICE} THEN 1 ELSE 0 END) AS match_ends
      FROM events
      WHERE created_at >= unixepoch('now', ${window}) AND ${deviceAllowed()}
      GROUP BY device_id
    ),
    retained AS (
      SELECT DISTINCT e.device_id
      FROM events e JOIN firsts f ON f.device_id = e.device_id
      WHERE date(e.created_at, 'unixepoch') = date(f.first_day, '+1 day')
    )
    SELECT a.platform AS platform,
           a.host AS host,
           COUNT(*) AS devices,
           SUM(CASE WHEN a.first_day >= date('now', ${window}) THEN 1 ELSE 0 END) AS new_devices,
           SUM(p.opens) AS opens,
           SUM(p.match_starts) AS match_starts,
           SUM(p.match_ends) AS match_ends,
           SUM(CASE WHEN a.first_day >= date('now', ${window})
                     AND r.device_id IS NOT NULL THEN 1 ELSE 0 END) AS d1_retained
    FROM period p
    JOIN attribution a ON a.device_id = p.device_id
    LEFT JOIN retained r ON r.device_id = p.device_id
    GROUP BY a.platform, a.host
    ORDER BY devices DESC
  `)

  return rows.map((r) => ({
    platform: r.platform,
    host: r.host,
    devices: r.devices,
    newDevices: r.new_devices,
    opens: r.opens,
    matchStarts: r.match_starts,
    matchEnds: r.match_ends,
    d1Retained: r.d1_retained,
  }))
}
