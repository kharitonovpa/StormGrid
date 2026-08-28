import { describe, test, expect, beforeAll, mock } from 'bun:test'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as schema from '../db/schema'

const __dir = dirname(fileURLToPath(import.meta.url))
const sqlite = new Database(':memory:')
sqlite.run('PRAGMA foreign_keys = ON')
const db = drizzle(sqlite, { schema })
migrate(db, { migrationsFolder: resolve(__dir, '../../drizzle') })

mock.module('../db/index.js', () => ({ db, schema, sqlite }))

const DAY_MS = 24 * 60 * 60 * 1000
const today = new Date()
const yesterday = new Date(today.getTime() - DAY_MS)
const fiveDaysAgo = new Date(today.getTime() - 5 * DAY_MS)

let selectNudgeCandidates: typeof import('../db/nudgeStore')['selectNudgeCandidates']
let markNudged: typeof import('../db/nudgeStore')['markNudged']
let markUnreachable: typeof import('../db/nudgeStore')['markUnreachable']
let composeNudge: typeof import('../nudge')['composeNudge']

beforeAll(async () => {
  const store = await import('../db/nudgeStore')
  selectNudgeCandidates = store.selectNudgeCandidates
  markNudged = store.markNudged
  markUnreachable = store.markUnreachable
  composeNudge = (await import('../nudge')).composeNudge
})

function addPlayer(opts: {
  id: string
  provider?: string
  providerId: string
  wins?: number
  games?: number
  lastSeen: Date
  lang?: string
}) {
  db.insert(schema.users).values({
    id: opts.id,
    provider: opts.provider ?? 'telegram',
    providerId: opts.providerId,
    name: opts.id,
    avatar: null,
    createdAt: fiveDaysAgo,
  }).run()
  db.insert(schema.userStats).values({
    userId: opts.id,
    wins: opts.wins ?? 2,
    losses: 1,
    draws: 0,
    watcherScore: 0,
    gamesPlayed: opts.games ?? 3,
    updatedAt: opts.lastSeen,
  }).run()
  db.insert(schema.events).values({
    deviceId: `dev-${opts.id}`,
    sessionId: `s-${opts.id}`,
    userId: opts.id,
    platform: 'telegram',
    host: null,
    name: 'app_open',
    props: null,
    country: null,
    lang: opts.lang ?? 'ru',
    createdAt: opts.lastSeen,
  }).run()
}

/*
 * Fixture story, all Telegram unless stated:
 *  - "gone"     played yesterday and not since — the one we want to reach.
 *  - "here"     played today, so there is nothing to bring back.
 *  - "stale"    last played five days ago; yesterday's cohort only.
 *  - "web-gone" same shape as "gone" but signed in with Google — no chat to write to.
 *  - "nogames"  authenticated but never finished a match.
 */
beforeAll(() => {
  addPlayer({ id: 'gone', providerId: '111111', lastSeen: yesterday, wins: 3, games: 5 })
  addPlayer({ id: 'here', providerId: '222222', lastSeen: today })
  addPlayer({ id: 'stale', providerId: '333333', lastSeen: fiveDaysAgo })
  addPlayer({ id: 'web-gone', provider: 'google', providerId: '444444', lastSeen: yesterday })
  addPlayer({ id: 'nogames', providerId: '555555', lastSeen: yesterday, wins: 0, games: 0 })
})

describe('selectNudgeCandidates', () => {
  test('picks the telegram player who played yesterday and not today', () => {
    const ids = selectNudgeCandidates({ cooldownDays: 7 }).map(c => c.userId)
    expect(ids).toEqual(['gone'])
  })

  test('carries the chat id, record and language needed to write the message', () => {
    const c = selectNudgeCandidates({ cooldownDays: 7 })[0]
    expect(c.chatId).toBe('111111')
    expect(c.wins).toBe(3)
    expect(c.gamesPlayed).toBe(5)
    expect(c.lang).toBe('ru')
  })

  test('drops a player already nudged inside the cooldown', () => {
    markNudged('gone')
    expect(selectNudgeCandidates({ cooldownDays: 7 })).toHaveLength(0)
  })

  test('offers them again once the cooldown has passed', () => {
    expect(selectNudgeCandidates({ cooldownDays: 0 }).map(c => c.userId)).toEqual(['gone'])
  })

  test('never offers a player telegram refused to deliver to', () => {
    markUnreachable('gone')
    expect(selectNudgeCandidates({ cooldownDays: 0 })).toHaveLength(0)
  })
})

describe('composeNudge', () => {
  test('states the real record rather than inventing urgency', () => {
    const text = composeNudge({ name: 'Ann', wins: 3, gamesPlayed: 5, lang: 'ru' })
    expect(text).toContain('3')
    expect(text).toContain('5')
    expect(text.length).toBeLessThan(300)
  })

  test('writes English to a player whose client is English', () => {
    const text = composeNudge({ name: 'Ann', wins: 3, gamesPlayed: 5, lang: 'en' })
    expect(text).toMatch(/[a-z]/)
    expect(text).not.toMatch(/[а-я]/)
  })

  test('says something true to a player who has never won', () => {
    const text = composeNudge({ name: 'Ann', wins: 0, gamesPlayed: 4, lang: 'ru' })
    expect(text).not.toContain('0 побед')
    expect(text.length).toBeGreaterThan(10)
  })
})
