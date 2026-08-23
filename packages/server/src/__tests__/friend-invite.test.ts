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

function lastOfType(ws: FakeWs, type: ServerMessage['type']) {
  return [...ws.messages].reverse().find(m => m.type === type)
}

describe('Matchmaking — friend invites', () => {
  it('createInvite parks the creator under a code', () => {
    const mm = new Matchmaking(new RoomManager())
    const creator = makeFakeWs()

    mm.createInvite(creator as any, 'wheat')

    const waiting = lastOfType(creator, 'friend:waiting')
    expect(waiting).toBeDefined()
    expect((waiting as { code: string }).code).toMatch(/^[A-Z2-9]{6}$/)
    // No bot timer race: the creator is not in the public queue.
    expect(mm.queueSize).toBe(0)
  })

  it('joinInvite starts a match between creator and joiner', () => {
    const mm = new Matchmaking(new RoomManager())
    const creator = makeFakeWs()
    const friend = makeFakeWs()

    mm.createInvite(creator as any, 'wheat')
    const code = (lastOfType(creator, 'friend:waiting') as { code: string }).code

    const ok = mm.joinInvite(friend as any, code, 'corn')
    expect(ok).toBe(true)
    expect(lastOfType(creator, 'game:start')).toBeDefined()
    expect(lastOfType(friend, 'game:start')).toBeDefined()
  })

  it('codes are single-use and case-insensitive', () => {
    const mm = new Matchmaking(new RoomManager())
    const creator = makeFakeWs()
    const friend = makeFakeWs()
    const third = makeFakeWs()

    mm.createInvite(creator as any, 'wheat')
    const code = (lastOfType(creator, 'friend:waiting') as { code: string }).code

    expect(mm.joinInvite(friend as any, code.toLowerCase(), 'rice')).toBe(true)
    expect(mm.joinInvite(third as any, code, 'corn')).toBe(false)
    expect(lastOfType(third, 'friend:join_fail')).toBeDefined()
  })

  it('rejects unknown codes and self-joins', () => {
    const mm = new Matchmaking(new RoomManager())
    const creator = makeFakeWs()
    const stranger = makeFakeWs()

    expect(mm.joinInvite(stranger as any, 'NOSUCH', 'wheat')).toBe(false)
    expect(lastOfType(stranger, 'friend:join_fail')).toBeDefined()

    mm.createInvite(creator as any, 'wheat')
    const code = (lastOfType(creator, 'friend:waiting') as { code: string }).code
    expect(mm.joinInvite(creator as any, code, 'wheat')).toBe(false)
  })

  it('cancelInvite kills the code', () => {
    const mm = new Matchmaking(new RoomManager())
    const creator = makeFakeWs()
    const friend = makeFakeWs()

    mm.createInvite(creator as any, 'wheat')
    const code = (lastOfType(creator, 'friend:waiting') as { code: string }).code
    mm.cancelInvite(creator as any)

    expect(mm.joinInvite(friend as any, code, 'corn')).toBe(false)
  })

  it('a dead creator socket invalidates the invite', () => {
    const mm = new Matchmaking(new RoomManager())
    const creator = makeFakeWs()
    const friend = makeFakeWs()

    mm.createInvite(creator as any, 'wheat')
    const code = (lastOfType(creator, 'friend:waiting') as { code: string }).code
    creator.readyState = 3 // CLOSED

    expect(mm.joinInvite(friend as any, code, 'corn')).toBe(false)
    expect(lastOfType(friend, 'friend:join_fail')).toBeDefined()
  })

  it('joining the public queue cancels a parked invite', () => {
    const mm = new Matchmaking(new RoomManager())
    const creator = makeFakeWs()
    const friend = makeFakeWs()

    mm.createInvite(creator as any, 'wheat')
    const code = (lastOfType(creator, 'friend:waiting') as { code: string }).code
    mm.enqueue(creator as any, 'wheat')
    mm.dequeue(creator as any) // leave the queue again so join can't match through it

    expect(mm.joinInvite(friend as any, code, 'corn')).toBe(false)
  })
})

describe('Matchmaking — discord create-or-join codes', () => {
  it('parks the first caller under a valid client code', () => {
    const mm = new Matchmaking(new RoomManager())
    const a = makeFakeWs()

    const code = mm.createInvite(a as any, 'wheat', 0, [], 'dc-abc123-def')

    expect(code).toBe('DC-ABC123-DEF')
    const waiting = lastOfType(a, 'friend:waiting')
    expect((waiting as { code: string }).code).toBe('DC-ABC123-DEF')
  })

  it('second create with the same code joins instead of parking', () => {
    const mm = new Matchmaking(new RoomManager())
    const a = makeFakeWs()
    const b = makeFakeWs()

    mm.createInvite(a as any, 'wheat', 0, [], 'dc-abc123-def')
    mm.createInvite(b as any, 'corn', 0, [], 'DC-abc123-def')

    // Both sockets are in a room now — the match started.
    expect(a.data.roomId).not.toBeNull()
    expect(b.data.roomId).not.toBeNull()
    expect(a.data.roomId).toBe(b.data.roomId)
  })

  it('third create after the match parks a fresh invite (pairwise matching)', () => {
    const mm = new Matchmaking(new RoomManager())
    const a = makeFakeWs()
    const b = makeFakeWs()
    const c = makeFakeWs()

    mm.createInvite(a as any, 'wheat', 0, [], 'dc-abc123-def')
    mm.createInvite(b as any, 'corn', 0, [], 'dc-abc123-def')
    mm.createInvite(c as any, 'wheat', 0, [], 'dc-abc123-def')

    expect(c.data.roomId).toBeNull()
    const waiting = lastOfType(c, 'friend:waiting')
    expect((waiting as { code: string }).code).toBe('DC-ABC123-DEF')
  })

  it('re-create by the same socket replaces its invite instead of self-joining', () => {
    const mm = new Matchmaking(new RoomManager())
    const a = makeFakeWs()

    mm.createInvite(a as any, 'wheat', 0, [], 'dc-abc123-def')
    mm.createInvite(a as any, 'corn', 0, [], 'dc-abc123-def')

    expect(a.data.roomId).toBeNull()
    expect(a.messages.filter(m => m.type === 'friend:waiting').length).toBe(2)
  })

  it('rejects codes without the dc- prefix and falls back to a server code', () => {
    const mm = new Matchmaking(new RoomManager())
    const a = makeFakeWs()

    const code = mm.createInvite(a as any, 'wheat', 0, [], 'HACK42')

    expect(code).toMatch(/^[A-Z2-9]{6}$/)
  })

  it('rejects malformed dc- codes (too short, bad chars)', () => {
    const mm = new Matchmaking(new RoomManager())
    const a = makeFakeWs()

    expect(mm.createInvite(a as any, 'wheat', 0, [], 'dc-ab')).toMatch(/^[A-Z2-9]{6}$/)
    expect(mm.createInvite(a as any, 'wheat', 0, [], 'dc-абв_гд')).toMatch(/^[A-Z2-9]{6}$/)
  })
})
