import { describe, test, expect, beforeAll, mock } from 'bun:test'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq, desc, sql } from 'drizzle-orm'
import * as schema from '../db/schema'
import type { ReplayData } from '@wheee/shared'

const __dir = dirname(fileURLToPath(import.meta.url))
const migrationsPath = resolve(__dir, '../../drizzle')

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.run('PRAGMA foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: migrationsPath })
  return { db, sqlite }
}

describe('DB schema', () => {
  let db: ReturnType<typeof createTestDb>['db']

  beforeAll(() => {
    const t = createTestDb()
    db = t.db
  })

  test('insert and retrieve user', () => {
    const id = crypto.randomUUID()
    db.insert(schema.users).values({
      id,
      provider: 'github',
      providerId: '12345',
      name: 'TestUser',
      avatar: null,
      createdAt: new Date(),
    }).run()

    const user = db.select().from(schema.users).where(eq(schema.users.id, id)).get()
    expect(user).not.toBeNull()
    expect(user!.name).toBe('TestUser')
    expect(user!.provider).toBe('github')
  })

  test('upsert user (update on conflict)', () => {
    const id = crypto.randomUUID()
    db.insert(schema.users).values({
      id,
      provider: 'google',
      providerId: 'g-1',
      name: 'Original',
      avatar: null,
      createdAt: new Date(),
    }).run()

    db.update(schema.users)
      .set({ name: 'Updated', avatar: 'https://img/new.png' })
      .where(eq(schema.users.id, id))
      .run()

    const user = db.select().from(schema.users).where(eq(schema.users.id, id)).get()
    expect(user!.name).toBe('Updated')
    expect(user!.avatar).toBe('https://img/new.png')
  })

  test('insert match with nullable player IDs (guest players)', () => {
    const matchId = crypto.randomUUID()
    db.insert(schema.matches).values({
      id: matchId,
      roomId: 'room-1',
      playerAId: null,
      playerBId: null,
      characterA: 'wheat',
      characterB: 'rice',
      winner: 'A',
      rounds: 3,
      durationMs: 45000,
      createdAt: new Date(),
    }).run()

    const match = db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get()
    expect(match).not.toBeNull()
    expect(match!.winner).toBe('A')
    expect(match!.playerAId).toBeNull()
    expect(match!.rounds).toBe(3)
  })

  test('insert match with user IDs', () => {
    const userA = crypto.randomUUID()
    const userB = crypto.randomUUID()
    db.insert(schema.users).values({ id: userA, provider: 'github', providerId: 'a1', name: 'A', avatar: null, createdAt: new Date() }).run()
    db.insert(schema.users).values({ id: userB, provider: 'google', providerId: 'b1', name: 'B', avatar: null, createdAt: new Date() }).run()

    const matchId = crypto.randomUUID()
    db.insert(schema.matches).values({
      id: matchId,
      roomId: 'room-2',
      playerAId: userA,
      playerBId: userB,
      characterA: 'corn',
      characterB: 'wheat',
      winner: 'draw',
      rounds: 5,
      durationMs: 60000,
      createdAt: new Date(),
    }).run()

    const match = db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get()
    expect(match!.playerAId).toBe(userA)
    expect(match!.playerBId).toBe(userB)
    expect(match!.winner).toBe('draw')
  })

  test('insert and retrieve replay', () => {
    const matchId = crypto.randomUUID()
    db.insert(schema.matches).values({
      id: matchId,
      roomId: 'room-3',
      playerAId: null,
      playerBId: null,
      characterA: 'wheat',
      characterB: 'rice',
      winner: 'B',
      rounds: 2,
      durationMs: 30000,
      createdAt: new Date(),
    }).run()

    const replayId = 'room-3'
    const frames = [{ state: { board: [], tick: 1 } }]
    db.insert(schema.replays).values({
      id: replayId,
      matchId,
      charA: 'wheat',
      charB: 'rice',
      winner: 'B',
      frameCount: frames.length,
      frames: JSON.stringify(frames),
      createdAt: new Date(),
    }).run()

    const replay = db.select().from(schema.replays).where(eq(schema.replays.id, replayId)).get()
    expect(replay).not.toBeNull()
    expect(JSON.parse(replay!.frames)).toEqual(frames)
  })

  test('unique index prevents duplicate provider+providerId', () => {
    const id1 = crypto.randomUUID()
    const id2 = crypto.randomUUID()
    db.insert(schema.users).values({ id: id1, provider: 'github', providerId: 'dup-1', name: 'First', avatar: null, createdAt: new Date() }).run()

    expect(() => {
      db.insert(schema.users).values({ id: id2, provider: 'github', providerId: 'dup-1', name: 'Second', avatar: null, createdAt: new Date() }).run()
    }).toThrow()
  })

  test('user_stats — raw increment wins and losses', () => {
    const userA = crypto.randomUUID()
    const userB = crypto.randomUUID()
    db.insert(schema.users).values({ id: userA, provider: 'github', providerId: `stats-a-${userA}`, name: 'StatsA', avatar: null, createdAt: new Date() }).run()
    db.insert(schema.users).values({ id: userB, provider: 'github', providerId: `stats-b-${userB}`, name: 'StatsB', avatar: null, createdAt: new Date() }).run()

    const now = new Date()
    db.insert(schema.userStats).values({ userId: userA, wins: 0, losses: 0, draws: 0, watcherScore: 0, gamesPlayed: 0, updatedAt: now }).run()
    db.insert(schema.userStats).values({ userId: userB, wins: 0, losses: 0, draws: 0, watcherScore: 0, gamesPlayed: 0, updatedAt: now }).run()

    db.update(schema.userStats)
      .set({ wins: sql`${schema.userStats.wins} + 1`, gamesPlayed: sql`${schema.userStats.gamesPlayed} + 1`, updatedAt: now })
      .where(eq(schema.userStats.userId, userA))
      .run()
    db.update(schema.userStats)
      .set({ losses: sql`${schema.userStats.losses} + 1`, gamesPlayed: sql`${schema.userStats.gamesPlayed} + 1`, updatedAt: now })
      .where(eq(schema.userStats.userId, userB))
      .run()

    const statsA = db.select().from(schema.userStats).where(eq(schema.userStats.userId, userA)).get()
    expect(statsA!.wins).toBe(1)
    expect(statsA!.losses).toBe(0)
    expect(statsA!.gamesPlayed).toBe(1)

    const statsB = db.select().from(schema.userStats).where(eq(schema.userStats.userId, userB)).get()
    expect(statsB!.wins).toBe(0)
    expect(statsB!.losses).toBe(1)
  })
})

describe('matchStore leaderboard functions', () => {
  const testDbData = createTestDb()

  mock.module('../db/index.js', () => ({
    db: testDbData.db,
    schema,
    sqlite: testDbData.sqlite,
  }))

  let updatePlayerStats: typeof import('../db/matchStore')['updatePlayerStats']
  let updateWatcherStats: typeof import('../db/matchStore')['updateWatcherStats']
  let getPlayerLeaderboard: typeof import('../db/matchStore')['getPlayerLeaderboard']
  let getWatcherLeaderboard: typeof import('../db/matchStore')['getWatcherLeaderboard']

  const uA = crypto.randomUUID()
  const uB = crypto.randomUUID()
  const uW = crypto.randomUUID()

  beforeAll(async () => {
    const mod = await import('../db/matchStore')
    updatePlayerStats = mod.updatePlayerStats
    updateWatcherStats = mod.updateWatcherStats
    getPlayerLeaderboard = mod.getPlayerLeaderboard
    getWatcherLeaderboard = mod.getWatcherLeaderboard

    const tdb = testDbData.db
    const now = new Date()
    tdb.insert(schema.users).values({ id: uA, provider: 'g', providerId: 'fn-a', name: 'Alice', avatar: 'https://img/a.png', createdAt: now }).run()
    tdb.insert(schema.users).values({ id: uB, provider: 'g', providerId: 'fn-b', name: 'Bob', avatar: null, createdAt: now }).run()
    tdb.insert(schema.users).values({ id: uW, provider: 'g', providerId: 'fn-w', name: 'Watcher', avatar: 'https://img/w.png', createdAt: now }).run()
  })

  test('updatePlayerStats — creates stats and increments correctly', () => {
    updatePlayerStats(uA, uB, 'A')
    updatePlayerStats(uA, uB, 'A')
    updatePlayerStats(uA, uB, 'draw')

    const rows = getPlayerLeaderboard()
    const alice = rows.find(r => r.userId === uA)!
    const bob = rows.find(r => r.userId === uB)!

    expect(alice.wins).toBe(2)
    expect(alice.losses).toBe(0)
    expect(alice.draws).toBe(1)
    expect(alice.gamesPlayed).toBe(3)

    expect(bob.wins).toBe(0)
    expect(bob.losses).toBe(2)
    expect(bob.draws).toBe(1)
  })

  test('updateWatcherStats — accumulates score', () => {
    updateWatcherStats([{ userId: uW, score: 15 }])
    updateWatcherStats([{ userId: uW, score: 10 }])

    const rows = getWatcherLeaderboard()
    const w = rows.find(r => r.userId === uW)!
    expect(w.watcherScore).toBe(25)
    expect(w.name).toBe('Watcher')
  })

  test('getPlayerLeaderboard — sorted by wins descending', () => {
    const rows = getPlayerLeaderboard()
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(rows[0].userId).toBe(uA)
  })

  test('updatePlayerStats — skips null userIds', () => {
    updatePlayerStats(null, null, 'A')
    const rows = getPlayerLeaderboard()
    expect(rows.find(r => r.userId === 'null')).toBeUndefined()
  })
})
