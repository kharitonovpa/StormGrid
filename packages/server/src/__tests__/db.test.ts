import { describe, test, expect, beforeAll } from 'bun:test'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema'
import type { ReplayData } from '@wheee/shared'

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.run('PRAGMA foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './drizzle' })
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
})
