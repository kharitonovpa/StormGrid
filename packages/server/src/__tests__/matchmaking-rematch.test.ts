import { describe, it, expect } from 'bun:test'
import { Matchmaking } from '../matchmaking.js'
import { RoomManager } from '../RoomManager.js'
import type { ServerMessage } from '../protocol.js'

/*
 * A rematch keeps a human pairing alive. It matters because human opponents are
 * the scarce thing here — the queue hands out a bot after 8 seconds, so "Play
 * again" after a PvP match almost always lands the player back against a bot.
 *
 * The pairing is scoped to the two sockets that actually played: the room id is
 * visible to watchers and in replay links, so anything joinable by id would be
 * hijackable. Hence a registry keyed by room id whose entry names both sockets,
 * rather than reusing the friend-invite codes.
 */

type FakeWs = {
  data: Record<string, unknown>
  readyState: number
  send: (data: string) => void
  messages: ServerMessage[]
}

function makeFakeWs(): FakeWs {
  const messages: ServerMessage[] = []
  return {
    data: {
      sessionId: crypto.randomUUID(), userId: null, userName: null, countryCode: null,
      roomId: null, playerId: null, role: null, analytics: null,
    },
    readyState: 1,
    send(data: string) { messages.push(JSON.parse(data)) },
    messages,
  }
}

const typesOf = (ws: FakeWs) => ws.messages.map(m => m.type)
const has = (ws: FakeWs, t: ServerMessage['type']) => typesOf(ws).includes(t)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function setup(ttlMs?: number) {
  const mm = new Matchmaking(new RoomManager(), ttlMs === undefined ? undefined : { rematchTtlMs: ttlMs })
  const a = makeFakeWs()
  const b = makeFakeWs()
  return { mm, a, b }
}

/*
 * Who is even eligible. A forfeit leaves nobody to play again with, and a
 * rematch against a bot is what the instant-play button already does — so the
 * room has to be able to say "these two humans are both still here".
 */
describe('rematch eligibility', () => {
  it('names both sockets of a two-human match', () => {
    const room = new RoomManager().createRoom({ lightningEnabled: true })
    const a = makeFakeWs()
    const b = makeFakeWs()
    room.join(a as never, 'wheat')
    room.join(b as never, 'rice')

    expect(room.humanPair).toEqual([a, b] as never)
  })

  it('refuses a match that had a bot in it', () => {
    const room = new RoomManager().createRoom({ lightningEnabled: true })
    room.join(makeFakeWs() as never, 'wheat')
    room.joinBot('rice')

    expect(room.humanPair).toBeNull()
  })

  it('refuses once one of them has dropped', async () => {
    const rm = new RoomManager({ gracePeriodMs: 10 })
    const room = rm.createRoom({ lightningEnabled: true })
    const a = makeFakeWs()
    const pidA = room.join(a as never, 'wheat')
    room.join(makeFakeWs() as never, 'rice')

    room.removePlayer(pidA!)
    await sleep(40)

    expect(room.humanPair).toBeNull()
  })

  it('refuses a tutorial room', () => {
    const room = new RoomManager().createRoom({ practice: true, lightningEnabled: false })
    room.join(makeFakeWs() as never, 'wheat')
    room.join(makeFakeWs() as never, 'rice')

    expect(room.humanPair).toBeNull()
  })
})

describe('rematch', () => {
  it('offers a rematch to both players when a match ends', () => {
    const { mm, a, b } = setup()
    mm.openRematch('room-x', a as never, b as never, true)

    expect(has(a, 'rematch:available')).toBe(true)
    expect(has(b, 'rematch:available')).toBe(true)
  })

  it('tells the other side when one player asks for it', () => {
    const { mm, a, b } = setup()
    mm.openRematch('room-x', a as never, b as never, true)

    mm.wantRematch(a as never, 'wheat', 0, ['lightning'])

    expect(has(a, 'rematch:waiting')).toBe(true)
    expect(has(b, 'rematch:offered')).toBe(true)
    expect(has(a, 'game:start')).toBe(false)
  })

  it('starts a new match once both have asked', () => {
    const { mm, a, b } = setup()
    mm.openRematch('room-x', a as never, b as never, true)

    mm.wantRematch(a as never, 'wheat', 0, ['lightning'])
    mm.wantRematch(b as never, 'rice', 0, ['lightning'])

    expect(has(a, 'game:start')).toBe(true)
    expect(has(b, 'game:start')).toBe(true)
  })

  it('carries the finished match’s lightning setting into the new room', () => {
    const { mm, a, b } = setup()
    mm.openRematch('room-x', a as never, b as never, false)

    mm.wantRematch(a as never, 'wheat', 0, ['lightning'])
    mm.wantRematch(b as never, 'rice', 0, ['lightning'])

    const start = a.messages.find(m => m.type === 'game:start') as { state: { lightningPossible?: boolean } } | undefined
    expect(start).toBeDefined()
    // An old client in the finished room means no lightning here either, no
    // matter what caps the rematch messages carry.
    expect(mm.rematchCount).toBe(0)
  })

  it('tells the waiting player when the other one declines', () => {
    const { mm, a, b } = setup()
    mm.openRematch('room-x', a as never, b as never, true)
    mm.wantRematch(a as never, 'wheat', 0, ['lightning'])

    mm.cancelRematch(b as never)

    expect(has(a, 'rematch:off')).toBe(true)
    expect(mm.rematchCount).toBe(0)
  })

  it('ignores a socket that did not play in that match', () => {
    const { mm, a, b } = setup()
    const stranger = makeFakeWs()
    mm.openRematch('room-x', a as never, b as never, true)

    mm.wantRematch(stranger as never, 'wheat', 0, ['lightning'])

    expect(has(stranger, 'rematch:waiting')).toBe(false)
    expect(has(b, 'rematch:offered')).toBe(false)
  })

  it('expires so a player cannot be pulled into a match minutes later', async () => {
    const { mm, a, b } = setup(30)
    mm.openRematch('room-x', a as never, b as never, true)
    mm.wantRematch(a as never, 'wheat', 0, ['lightning'])

    await sleep(60)
    mm.wantRematch(b as never, 'rice', 0, ['lightning'])

    expect(has(b, 'game:start')).toBe(false)
    expect(has(a, 'rematch:off')).toBe(true)
  })
})
