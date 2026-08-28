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

type S = typeof import('../db/streakStore')
let store: S

beforeAll(async () => { store = await import('../db/streakStore') })

/*
 * The server's copy has to end up agreeing with what the player actually sees,
 * because the whole point is to read it while they are away. So it mirrors
 * client semantics exactly (lib/streak.ts): the crate seeds, wins grow, a loss
 * wipes, a draw is neutral, and it never invents a badge nobody earned.
 */
describe('device streaks', () => {
  test('an unknown device carries no badge', () => {
    expect(store.getDeviceStreak('unseen')).toBe(0)
  })

  test('the crate seeds a badge, and seeding twice changes nothing', () => {
    store.seedDeviceStreak('d1')
    expect(store.getDeviceStreak('d1')).toBe(1)
    store.seedDeviceStreak('d1')
    expect(store.getDeviceStreak('d1')).toBe(1)
  })

  test('wins grow a badge that exists', () => {
    store.growDeviceStreak('d1')
    store.growDeviceStreak('d1')
    expect(store.getDeviceStreak('d1')).toBe(3)
  })

  /* winStreak() on the client returns early at zero — the crate is the only door. */
  test('a win without a badge grows nothing', () => {
    store.growDeviceStreak('d2')
    expect(store.getDeviceStreak('d2')).toBe(0)
  })

  test('a loss wipes it', () => {
    store.wipeDeviceStreak('d1')
    expect(store.getDeviceStreak('d1')).toBe(0)
  })

  /*
   * Trust on first sight, and upward only. Players who have carried a badge in
   * localStorage for weeks must not silently lose it the day the server starts
   * keeping its own copy; and a client-side rescue bought with a rewarded ad
   * would otherwise leave the two copies disagreeing forever. The number is
   * cosmetic — lib/streak.ts says forging it fools nobody but its owner — so
   * taking the player's word for a higher one costs nothing.
   */
  describe('adopting what the client reports', () => {
    test('takes the reported badge for a device never seen before', () => {
      expect(store.adoptDeviceStreak('d3', 6)).toBe(6)
      expect(store.getDeviceStreak('d3')).toBe(6)
    })

    test('keeps the higher of the two', () => {
      expect(store.adoptDeviceStreak('d3', 2)).toBe(6)
      expect(store.adoptDeviceStreak('d3', 9)).toBe(9)
    })

    test('ignores nonsense instead of storing it', () => {
      expect(store.adoptDeviceStreak('d4', -3)).toBe(0)
      expect(store.adoptDeviceStreak('d4', 1e9)).toBe(9999)
      expect(store.adoptDeviceStreak('d5', Number.NaN)).toBe(0)
    })
  })

  test('reads the best badge across a player’s devices', () => {
    store.adoptDeviceStreak('phone', 4)
    store.adoptDeviceStreak('laptop', 11)
    expect(store.bestStreakForDevices(['phone', 'laptop', 'unseen'])).toBe(11)
    expect(store.bestStreakForDevices([])).toBe(0)
  })
})
