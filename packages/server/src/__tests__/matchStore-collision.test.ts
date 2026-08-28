import { describe, test, expect, beforeAll, mock } from 'bun:test'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as schema from '../db/schema'
import type { ReplayData } from '@wheee/shared'

const __dir = dirname(fileURLToPath(import.meta.url))
const migrationsPath = resolve(__dir, '../../drizzle')

const sqlite = new Database(':memory:')
sqlite.run('PRAGMA foreign_keys = ON')
const db = drizzle(sqlite, { schema })
migrate(db, { migrationsFolder: migrationsPath })

mock.module('../db/index.js', () => ({ db, schema, sqlite }))

let saveMatch: typeof import('../db/matchStore')['saveMatch']

beforeAll(async () => {
  saveMatch = (await import('../db/matchStore')).saveMatch
})

function record(roomId: string) {
  return {
    roomId,
    playerAId: null,
    playerBId: null,
    characterA: 'wheat',
    characterB: 'rice',
    winner: 'A' as const,
    rounds: 3,
    durationMs: 60_000,
    vsBot: false,
  }
}

function replay(id: string): ReplayData {
  return { id, charA: 'wheat', charB: 'rice', winner: 'A', frameCount: 0, frames: [] }
}

function matchCount(): number {
  return db.select().from(schema.matches).all().length
}

/*
 * Room ids come from a counter that starts at 1 in every fresh process, and a
 * replay is stored under its room's id. So after a restart the ids repeat, the
 * replay insert hits the primary key, and — because saveMatch puts both inserts
 * in one transaction — the *match* is rolled back with it. The match table is
 * what `serverMatches` counts and what the code calls the authoritative number,
 * so this quietly deletes the metric rather than a replay.
 */
describe('saveMatch — a replay id that already exists', () => {
  test('still records the match', () => {
    saveMatch(record('room-1'), replay('room-1'))
    expect(matchCount()).toBe(1)

    saveMatch(record('room-1'), replay('room-1'))

    expect(matchCount()).toBe(2)
  })

  /*
   * The colliding id is handed out to the *newer* match, whose player is the
   * one about to press Replay on the game-over screen. So the newer replay
   * wins the slot, and its `matchId` follows it — the alternative leaves that
   * player watching a stranger's match.
   */
  test('gives the id to the newer replay, matchId and all', () => {
    const replays = db.select().from(schema.replays).all()
    expect(replays).toHaveLength(1)

    const matches = db.select().from(schema.matches).all()
    const newest = matches[matches.length - 1]
    expect(replays[0].matchId).toBe(newest.id)
  })
})
