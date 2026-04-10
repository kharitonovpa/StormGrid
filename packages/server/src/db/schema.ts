import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core'

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
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

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
