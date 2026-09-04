import { describe, it, expect } from 'bun:test'
import { Matchmaking } from '../matchmaking.js'
import { RoomManager } from '../RoomManager.js'
import type { ServerMessage } from '../protocol.js'

type FakeWs = {
  data: Record<string, unknown>
  readyState: number
  send: (data: string) => void
  messages: ServerMessage[]
}

function makeFakeWs(): FakeWs {
  const messages: ServerMessage[] = []
  return {
    data: { sessionId: crypto.randomUUID(), userId: null, userName: null, countryCode: null, roomId: null, playerId: null, role: null, lastActiveAt: 0 },
    readyState: 1,
    send(data: string) { messages.push(JSON.parse(data)) },
    messages,
  }
}

function lastOfType(ws: FakeWs, type: ServerMessage['type']) {
  return [...ws.messages].reverse().find(m => m.type === type)
}

/** Fresh RoomManager per test — its own room map, so `getActiveRoomId()`
 * unambiguously points at the one room this test just created. */
function lightningOf(rm: RoomManager): boolean {
  const roomId = rm.getActiveRoomId()
  expect(roomId).not.toBeNull()
  return rm.getRoom(roomId!)!.lightningEnabled
}

/*
 * Backward-compat capability handshake (owner ruling): lightning is enabled
 * per-match only when every human client declared `caps: ['lightning']`. An
 * old client sends no `caps` field at all — absence must mean disabled,
 * never a default-enabled fallback.
 */
describe('Matchmaking — lightning capability handshake', () => {
  it('mixed caps (one new client, one old): room stays disabled', () => {
    const rm = new RoomManager()
    const mm = new Matchmaking(rm)
    const a = makeFakeWs()
    const b = makeFakeWs()

    mm.enqueue(a as any, 'wheat', 0, ['lightning'])
    mm.enqueue(b as any, 'rice') // old client: no caps field at all

    expect(mm.queueSize).toBe(0)
    expect(lightningOf(rm)).toBe(false)
  })

  it('both sides declare the cap: room enables lightning', () => {
    const rm = new RoomManager()
    const mm = new Matchmaking(rm)
    const a = makeFakeWs()
    const b = makeFakeWs()

    mm.enqueue(a as any, 'wheat', 0, ['lightning'])
    mm.enqueue(b as any, 'rice', 0, ['lightning'])

    expect(lightningOf(rm)).toBe(true)
  })

  it('neither side declares the cap: room stays disabled', () => {
    const rm = new RoomManager()
    const mm = new Matchmaking(rm)
    const a = makeFakeWs()
    const b = makeFakeWs()

    mm.enqueue(a as any, 'wheat')
    mm.enqueue(b as any, 'rice')

    expect(lightningOf(rm)).toBe(false)
  })

  it('an unrelated cap without "lightning" in it still counts as no support', () => {
    const rm = new RoomManager()
    const mm = new Matchmaking(rm)
    const a = makeFakeWs()
    const b = makeFakeWs()

    mm.enqueue(a as any, 'wheat', 0, ['lightning'])
    mm.enqueue(b as any, 'rice', 0, ['some_future_cap'])

    expect(lightningOf(rm)).toBe(false)
  })

  it('bot fallback: the lone human declaring the cap enables lightning', () => {
    const rm = new RoomManager()
    const mm = new Matchmaking(rm)
    const ws = makeFakeWs()

    mm.enqueue(ws as any, 'wheat', 0, ['lightning'])
    // Skip the real bot-delay timer — exercise the fallback path directly.
    ;(mm as unknown as { matchWithBot: () => void }).matchWithBot()

    expect(lightningOf(rm)).toBe(true)
  })

  it('bot fallback: a human without the cap gets a disabled room (bot has no client)', () => {
    const rm = new RoomManager()
    const mm = new Matchmaking(rm)
    const ws = makeFakeWs()

    mm.enqueue(ws as any, 'wheat')
    ;(mm as unknown as { matchWithBot: () => void }).matchWithBot()

    expect(lightningOf(rm)).toBe(false)
  })

  it('friend invite: both sides declaring the cap enables lightning', () => {
    const rm = new RoomManager()
    const mm = new Matchmaking(rm)
    const creator = makeFakeWs()
    const friend = makeFakeWs()

    mm.createInvite(creator as any, 'wheat', 0, ['lightning'])
    const code = (lastOfType(creator, 'friend:waiting') as { code: string }).code

    mm.joinInvite(friend as any, code, 'corn', 0, ['lightning'])

    expect(lightningOf(rm)).toBe(true)
  })

  it('friend invite: joiner is an old client (no caps) — room stays disabled', () => {
    const rm = new RoomManager()
    const mm = new Matchmaking(rm)
    const creator = makeFakeWs()
    const friend = makeFakeWs()

    mm.createInvite(creator as any, 'wheat', 0, ['lightning'])
    const code = (lastOfType(creator, 'friend:waiting') as { code: string }).code

    mm.joinInvite(friend as any, code, 'corn')

    expect(lightningOf(rm)).toBe(false)
  })
})
