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
  matches: number
  /** Of devices first seen the previous day, how many came back on this one. */
  d1Retained: number
}

/**
 * One row per day, newest first. Everything is derived from raw events on read —
 * at this game's traffic there is no need for rollup tables yet.
 */
export function getDailySummary(days = 14): DailySummary[] {
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
             SUM(CASE WHEN name = 'match_end' THEN 1 ELSE 0 END) AS matches
      FROM events
      WHERE created_at >= unixepoch('now', ${'-' + Math.max(1, Math.min(days, 90)) + ' days'})
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

  return rows.map((r) => ({
    day: r.day,
    opens: r.opens,
    devices: r.devices,
    newDevices: r.new_devices,
    matches: r.matches,
    d1Retained: r.d1_retained,
  }))
}

/** Event counts by name for a quick funnel read, over the last `days`. */
export function getEventCounts(days = 14): { name: string; count: number; devices: number }[] {
  return db.all<{ name: string; count: number; devices: number }>(sql`
    SELECT name, COUNT(*) AS count, COUNT(DISTINCT device_id) AS devices
    FROM events
    WHERE created_at >= unixepoch('now', ${'-' + Math.max(1, Math.min(days, 90)) + ' days'})
    GROUP BY name
    ORDER BY count DESC
  `)
}
