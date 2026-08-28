import { describe, test, expect, beforeAll, mock } from 'bun:test'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as schema from '../db/schema'

const __dir = dirname(fileURLToPath(import.meta.url))
const migrationsPath = resolve(__dir, '../../drizzle')

const sqlite = new Database(':memory:')
sqlite.run('PRAGMA foreign_keys = ON')
const db = drizzle(sqlite, { schema })
migrate(db, { migrationsFolder: migrationsPath })

mock.module('../db/index.js', () => ({ db, schema, sqlite }))

const DAY_MS = 24 * 60 * 60 * 1000
const today = new Date()
const yesterday = new Date(today.getTime() - DAY_MS)
const twoDaysAgo = new Date(today.getTime() - 2 * DAY_MS)

type Ev = { deviceId: string; name: string; props?: object; platform?: string; host?: string | null; at?: Date }

function insertEvent(e: Ev) {
  db.insert(schema.events).values({
    deviceId: e.deviceId,
    sessionId: `s-${e.deviceId}`,
    userId: null,
    platform: e.platform ?? 'web',
    host: e.host === undefined ? 'wheee.io' : e.host,
    name: e.name,
    props: e.props ? JSON.stringify(e.props) : null,
    country: null,
    lang: null,
    createdAt: e.at ?? today,
  }).run()
}

function insertServerMatch(at: Date, vsBot = false, winner: string = 'A') {
  db.insert(schema.matches).values({
    id: crypto.randomUUID(),
    roomId: crypto.randomUUID(),
    playerAId: null,
    playerBId: null,
    characterA: 'wheat',
    characterB: 'rice',
    winner,
    rounds: 3,
    durationMs: 60_000,
    vsBot,
    createdAt: at,
  }).run()
}

let getDailySummary: typeof import('../db/eventStore')['getDailySummary']
let getEventCounts: typeof import('../db/eventStore')['getEventCounts']
let getPlatformSummary: typeof import('../db/eventStore')['getPlatformSummary']
let getPropsAudit: typeof import('../db/eventStore')['getPropsAudit']
let setExcludedDevices: typeof import('../db/eventStore')['setExcludedDevices']

beforeAll(async () => {
  const mod = await import('../db/eventStore')
  getDailySummary = mod.getDailySummary
  getEventCounts = mod.getEventCounts
  getPlatformSummary = mod.getPlatformSummary
  getPropsAudit = mod.getPropsAudit
  setExcludedDevices = mod.setExcludedDevices
})

/*
 * Fixture story:
 *  - device "gp-1" on gamepush/gamepix.com: first seen two days ago, came back
 *    yesterday (D1 retained), played 1 pvp match (start+end) and 1 practice match.
 *  - device "gp-2" on gamepush/gamepix.com: first seen yesterday, never returned.
 *  - device "web-1" on web/wheee.io: first seen today, 1 pvp match_start, no end.
 *  - 2 server-recorded matches: one yesterday, one today.
 */
beforeAll(() => {
  const gp = { platform: 'gamepush', host: 'gamepix.com' }
  insertEvent({ deviceId: 'gp-1', name: 'app_open', ...gp, at: twoDaysAgo })
  insertEvent({ deviceId: 'gp-1', name: 'app_open', ...gp, at: yesterday })
  insertEvent({ deviceId: 'gp-1', name: 'match_start', props: { practice: false }, ...gp, at: yesterday })
  insertEvent({ deviceId: 'gp-1', name: 'match_end', props: { result: 'win', practice: false }, ...gp, at: yesterday })
  insertEvent({ deviceId: 'gp-1', name: 'match_start', props: { practice: true }, ...gp, at: yesterday })
  insertEvent({ deviceId: 'gp-1', name: 'match_end', props: { result: 'win', practice: true }, ...gp, at: yesterday })

  insertEvent({ deviceId: 'gp-2', name: 'app_open', ...gp, at: yesterday })

  insertEvent({ deviceId: 'web-1', name: 'app_open', at: today })
  insertEvent({ deviceId: 'web-1', name: 'match_start', props: { practice: false }, at: today })

  insertServerMatch(yesterday)
  insertServerMatch(today)
  // Two bot matches today: the human (always slot A in queue bot matches) wins one.
  insertServerMatch(today, true, 'A')
  insertServerMatch(today, true, 'B')
})

describe('getEventCounts', () => {
  test('splits practice events out per name', () => {
    const counts = getEventCounts(14)
    const matchEnd = counts.find((c) => c.name === 'match_end')!
    expect(matchEnd.count).toBe(2)
    expect(matchEnd.practice).toBe(1)

    const matchStart = counts.find((c) => c.name === 'match_start')!
    expect(matchStart.count).toBe(3)
    expect(matchStart.practice).toBe(1)

    const appOpen = counts.find((c) => c.name === 'app_open')!
    expect(appOpen.practice).toBe(0)
  })
})

describe('setExcludedDevices', () => {
  test('an excluded device is absent from event counts, platforms and daily rows', () => {
    const dayKey = (d: Date) => d.toISOString().slice(0, 10)
    const before = getPlatformSummary(14).find((r) => r.platform === 'gamepush')!
    expect(before.devices).toBe(2)

    setExcludedDevices(['gp-2'])
    try {
      expect(getEventCounts(14).find((c) => c.name === 'app_open')!.count).toBe(3)

      const gp = getPlatformSummary(14).find((r) => r.platform === 'gamepush')!
      expect(gp.devices).toBe(1)
      expect(gp.newDevices).toBe(1)

      const y = getDailySummary(14).find((r) => r.day === dayKey(yesterday))!
      expect(y.devices).toBe(1)
    } finally {
      setExcludedDevices([])
    }

    expect(getPlatformSummary(14).find((r) => r.platform === 'gamepush')!.devices).toBe(2)
  })
})

describe('getPropsAudit', () => {
  test('reports an event whose props are always absent', () => {
    const appOpen = getPropsAudit(14).find((a) => a.name === 'app_open')!
    expect(appOpen.total).toBe(4)
    expect(appOpen.noProps).toBe(4)
    expect(appOpen.practiceTrue).toBe(0)
    expect(appOpen.sampleProps).toBeNull()
  })

  test('counts practice-flagged events separately from props-carrying ones', () => {
    const matchStart = getPropsAudit(14).find((a) => a.name === 'match_start')!
    expect(matchStart.total).toBe(3)
    expect(matchStart.noProps).toBe(0)
    expect(matchStart.practiceTrue).toBe(1)
    expect(matchStart.sampleProps).toContain('practice')
  })
})

describe('getDailySummary', () => {
  test('matches excludes practice and serverMatches comes from the matches table', () => {
    const daily = getDailySummary(14)
    const dayKey = (d: Date) => d.toISOString().slice(0, 10)

    const y = daily.find((r) => r.day === dayKey(yesterday))!
    expect(y.matches).toBe(1) // gp-1's pvp match_end only; practice one excluded
    expect(y.serverMatches).toBe(1)

    const t = daily.find((r) => r.day === dayKey(today))!
    expect(t.matches).toBe(0) // web-1 never finished
    expect(t.serverMatches).toBe(3)
  })

  test('reports pvp matches separately so bots never pad the match count', () => {
    const daily = getDailySummary(14)
    const dayKey = (d: Date) => d.toISOString().slice(0, 10)

    const t = daily.find((r) => r.day === dayKey(today))!
    expect(t.serverMatches).toBe(3)
    expect(t.botMatches).toBe(2)
    expect(t.pvpMatches).toBe(1)

    const y = daily.find((r) => r.day === dayKey(yesterday))!
    expect(y.pvpMatches).toBe(1)
  })

  test('splits bot matches and human wins against the bot', () => {
    const daily = getDailySummary(14)
    const dayKey = (d: Date) => d.toISOString().slice(0, 10)

    const t = daily.find((r) => r.day === dayKey(today))!
    expect(t.botMatches).toBe(2)
    expect(t.botHumanWins).toBe(1)

    const y = daily.find((r) => r.day === dayKey(yesterday))!
    expect(y.botMatches).toBe(0)
    expect(y.botHumanWins).toBe(0)
  })
})

describe('getPlatformSummary', () => {
  test('groups devices by first-seen platform/host with funnel and D1', () => {
    const rows = getPlatformSummary(14)

    const gp = rows.find((r) => r.platform === 'gamepush' && r.host === 'gamepix.com')!
    expect(gp.devices).toBe(2)
    expect(gp.newDevices).toBe(2)
    expect(gp.opens).toBe(3)
    expect(gp.matchStarts).toBe(1) // pvp only — practice start excluded
    expect(gp.matchEnds).toBe(1)
    expect(gp.d1Retained).toBe(1) // gp-1 came back the day after first seen; gp-2 did not

    const web = rows.find((r) => r.platform === 'web' && r.host === 'wheee.io')!
    expect(web.devices).toBe(1)
    expect(web.newDevices).toBe(1)
    expect(web.matchStarts).toBe(1)
    expect(web.matchEnds).toBe(0)
    expect(web.d1Retained).toBe(0)
  })
})
