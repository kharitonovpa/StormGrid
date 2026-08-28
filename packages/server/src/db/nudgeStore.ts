import { sql } from 'drizzle-orm'
import { db, schema } from './index.js'

/**
 * A Telegram player worth reminding, with everything the message needs. The
 * chat id is the Telegram user id, which `users.provider_id` already holds for
 * every Mini App player whose signed `initData` we verified at login — so no
 * new identity plumbing is involved.
 */
export type NudgeCandidate = {
  userId: string
  /** Telegram user id — the same number as the private chat's id. */
  chatId: string
  name: string
  wins: number
  gamesPlayed: number
  /** Their client's language, taken from their most recent event. */
  lang: string
}

/**
 * Players who were here yesterday and have not come back today. Deliberately
 * narrow, because the cost of being wrong is a message to a real person:
 *
 *  - Telegram only, since that is the only platform we can write to at all.
 *  - They must have finished at least one match; there is nothing to say to
 *    somebody who never played.
 *  - Yesterday's cohort only, never a backlog of everyone who ever left.
 *  - Nobody inside the cooldown, and nobody Telegram has already refused.
 */
export function selectNudgeCandidates(opts: { cooldownDays: number; limit?: number }): NudgeCandidate[] {
  const days = Math.max(0, Math.floor(opts.cooldownDays))
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000)
  // Zero means no cooldown at all, rather than "sent strictly before now" —
  // which a message sent this same second would fail, making 0 mean "never".
  const cooldownClause = days === 0
    ? sql`1 = 1`
    : sql`(n.last_sent_at IS NULL OR n.last_sent_at < unixepoch('now', ${'-' + days + ' days'}))`

  return db.all<{
    user_id: string
    chat_id: string
    name: string
    wins: number
    games_played: number
    lang: string
  }>(sql`
    WITH seen AS (
      SELECT user_id, MAX(created_at) AS last_seen, MAX(id) AS last_id
      FROM events WHERE user_id IS NOT NULL GROUP BY user_id
    ),
    tongue AS (
      SELECT s.user_id, e.lang
      FROM seen s JOIN events e ON e.id = s.last_id
    )
    SELECT u.id AS user_id,
           u.provider_id AS chat_id,
           u.name AS name,
           st.wins AS wins,
           st.games_played AS games_played,
           COALESCE(t.lang, 'en') AS lang
    FROM users u
    JOIN user_stats st ON st.user_id = u.id
    JOIN seen s ON s.user_id = u.id
    LEFT JOIN tongue t ON t.user_id = u.id
    LEFT JOIN tg_nudges n ON n.user_id = u.id
    WHERE u.provider = 'telegram'
      AND st.games_played > 0
      AND date(s.last_seen, 'unixepoch') = date('now', '-1 day')
      AND COALESCE(n.unreachable, 0) = 0
      AND ${cooldownClause}
    ORDER BY st.wins DESC, u.id ASC
    LIMIT ${limit}
  `).map((r) => ({
    userId: r.user_id,
    chatId: r.chat_id,
    name: r.name,
    wins: r.wins,
    gamesPlayed: r.games_played,
    lang: r.lang,
  }))
}

/** Written before the send is attempted: a crash must not license a second try. */
export function markNudged(userId: string): void {
  const now = new Date()
  db.insert(schema.tgNudges)
    .values({ userId, lastSentAt: now, sentCount: 1, unreachable: false })
    .onConflictDoUpdate({
      target: schema.tgNudges.userId,
      set: { lastSentAt: now, sentCount: sql`${schema.tgNudges.sentCount} + 1` },
    })
    .run()
}

/** Telegram answered 403: no private chat exists, or the bot is blocked. */
export function markUnreachable(userId: string): void {
  db.insert(schema.tgNudges)
    .values({ userId, lastSentAt: new Date(), sentCount: 0, unreachable: true })
    .onConflictDoUpdate({
      target: schema.tgNudges.userId,
      set: { unreachable: true },
    })
    .run()
}
