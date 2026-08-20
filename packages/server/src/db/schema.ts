import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(), // 'google' | 'github'
  providerId: text('provider_id').notNull(),
  name: text('name').notNull(),
  avatar: text('avatar'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => [
  uniqueIndex('provider_provider_id_idx').on(t.provider, t.providerId),
])

export const matches = sqliteTable('matches', {
  id: text('id').primaryKey(),
  roomId: text('room_id').notNull(),
  playerAId: text('player_a_id').references(() => users.id),
  playerBId: text('player_b_id').references(() => users.id),
  characterA: text('character_a').notNull(),
  characterB: text('character_b').notNull(),
  winner: text('winner'), // 'A' | 'B' | 'draw' | null
  rounds: integer('rounds').notNull(),
  durationMs: integer('duration_ms').notNull(),
  // Queue fallback vs bot; the bot always sits in slot B, so winner='A' means the human won.
  vsBot: integer('vs_bot', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

export const userStats = sqliteTable('user_stats', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  wins: integer('wins').notNull().default(0),
  losses: integer('losses').notNull().default(0),
  draws: integer('draws').notNull().default(0),
  watcherScore: integer('watcher_score').notNull().default(0),
  gamesPlayed: integer('games_played').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (t) => [
  index('user_stats_wins_idx').on(t.wins),
  index('user_stats_watcher_score_idx').on(t.watcherScore),
])

/**
 * First-party analytics: one row per client event. `deviceId` survives reloads
 * (platform storage), `sessionId` lives one page load — together they give
 * funnels and D1/D7 retention without any third-party SDK.
 */
export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  deviceId: text('device_id').notNull(),
  sessionId: text('session_id').notNull(),
  userId: text('user_id'),
  platform: text('platform').notNull(),
  host: text('host'),
  name: text('name').notNull(),
  props: text('props'), // JSON, small and optional
  country: text('country'),
  lang: text('lang'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => [
  index('events_name_created_idx').on(t.name, t.createdAt),
  index('events_device_created_idx').on(t.deviceId, t.createdAt),
])

export const replays = sqliteTable('replays', {
  id: text('id').primaryKey(),
  matchId: text('match_id').notNull().references(() => matches.id),
  charA: text('char_a').notNull(),
  charB: text('char_b').notNull(),
  winner: text('winner'),
  frameCount: integer('frame_count').notNull(),
  frames: text('frames').notNull(), // JSON-serialized ReplayFrame[]
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})
