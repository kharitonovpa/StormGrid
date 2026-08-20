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
    data: { sessionId: crypto.randomUUID(), userId: null, userName: null, countryCode: null, roomId: null, playerId: null, role: null },
    readyState: 1,
    send(data: string) { messages.push(JSON.parse(data)) },
    messages,
  }
}

function waitingMsg(ws: FakeWs) {
  return ws.messages.find(m => m.type === 'queue:waiting') as { type: string; maxWaitMs: number } | undefined
}

/*
 * The bot-fallback window adapts to who is around: alone on the server the
 * short delay applies (nobody to wait for), with another idle human online
 * the long one does (a real opponent might still press Play).
 * Defaults: short 8s, long 30s — these tests run without env overrides.
 */
describe('Matchmaking — dynamic bot delay', () => {
  it('uses the short window when the queuer is alone', () => {
    const mm = new Matchmaking(new RoomManager(), { countIdleHumans: () => 0 })
    const ws = makeFakeWs()
    mm.enqueue(ws as any, 'wheat')

    expect(waitingMsg(ws)!.maxWaitMs).toBe(8_000)
    mm.dequeue(ws as any)
  })

  it('uses the long window when another idle human is online', () => {
    const mm = new Matchmaking(new RoomManager(), { countIdleHumans: () => 1 })
    const ws = makeFakeWs()
    mm.enqueue(ws as any, 'wheat')

    expect(waitingMsg(ws)!.maxWaitMs).toBe(30_000)
    mm.dequeue(ws as any)
  })

  it('does not count the queuer themself: the exclude arg is passed through', () => {
    let excluded: unknown = null
    const mm = new Matchmaking(new RoomManager(), {
      countIdleHumans: (ws) => { excluded = ws; return 0 },
    })
    const ws = makeFakeWs()
    mm.enqueue(ws as any, 'wheat')

    expect(excluded).toBe(ws)
    mm.dequeue(ws as any)
  })

  it('falls back to the short window without a counter (old constructor call)', () => {
    const mm = new Matchmaking(new RoomManager())
    const ws = makeFakeWs()
    mm.enqueue(ws as any, 'wheat')

    expect(waitingMsg(ws)!.maxWaitMs).toBe(8_000)
    mm.dequeue(ws as any)
  })
})

describe('Matchmaking — lone-waiter callback', () => {
  it('fires when a player starts waiting alone, with their name and window', () => {
    const seen: { name: string; waitMs: number }[] = []
    const mm = new Matchmaking(new RoomManager(), {
      countIdleHumans: () => 1,
      onLoneWaiter: (info) => { seen.push(info) },
    })
    const ws = makeFakeWs()
    ws.data.userName = 'ovi8x'
    mm.enqueue(ws as any, 'wheat')

    expect(seen).toHaveLength(1)
    expect(seen[0].name).toBe('ovi8x')
    expect(seen[0].waitMs).toBe(30_000)
    mm.dequeue(ws as any)
  })

  it('does not fire when two players match instantly', () => {
    const seen: unknown[] = []
    const mm = new Matchmaking(new RoomManager(), {
      onLoneWaiter: (info) => { seen.push(info) },
    })
    const a = makeFakeWs()
    const b = makeFakeWs()
    mm.enqueue(a as any, 'wheat')
    mm.enqueue(b as any, 'rice')

    expect(seen).toHaveLength(1) // only the first, lone enqueue — not the pairing one
    expect(mm.queueSize).toBe(0)
  })
})
