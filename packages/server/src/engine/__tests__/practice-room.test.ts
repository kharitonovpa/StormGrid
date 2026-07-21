import { describe, it, expect } from 'bun:test'
import { Room } from '../../Room.js'
import type { ServerMessage } from '../../protocol.js'

type FakeWs = {
  data: Record<string, unknown>
  send: (data: string) => void
  messages: ServerMessage[]
}

function makeFakeWs(): FakeWs {
  const messages: ServerMessage[] = []
  return {
    data: { sessionId: crypto.randomUUID(), userId: null, roomId: null, playerId: null, role: null },
    send(data: string) { messages.push(JSON.parse(data)) },
    messages,
  }
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

function makePracticeRoom(onMatchEnd?: () => void): Room {
  return new Room('practice-test', {
    onDispose: () => {},
    gracePeriodMs: 30_000,
    onMatchEnd: onMatchEnd
      ? () => onMatchEnd()
      : undefined,
  }, { practice: true })
}

describe('Room — practice (tutorial) mode', () => {
  it('game:start carries the practice flag', () => {
    const room = makePracticeRoom()
    const ws = makeFakeWs()

    room.join(ws as any, 'wheat')
    room.joinBot('corn')

    const startMsg = ws.messages.find(m => m.type === 'game:start')
    expect(startMsg).toBeDefined()
    expect((startMsg as { practice?: boolean }).practice).toBe(true)

    room.dispose()
  })

  it('tick:start has deadline 0 (untimed)', async () => {
    const room = makePracticeRoom()
    const ws = makeFakeWs()

    room.join(ws as any, 'wheat')
    room.joinBot('rice')

    // practice forecast is 6s
    await sleep(6_500)

    const tickStart = ws.messages.find(m => m.type === 'tick:start')
    expect(tickStart).toBeDefined()
    expect((tickStart as { deadline: number }).deadline).toBe(0)

    room.dispose()
  }, 10_000)

  it('tick resolves immediately on player action, no timer wait', async () => {
    const room = makePracticeRoom()
    const ws = makeFakeWs()

    room.join(ws as any, 'wheat')
    room.joinBot('rice')

    await sleep(6_500)
    expect(ws.messages.some(m => m.type === 'tick:start')).toBe(true)

    // no action → no resolve, even after longer than a normal tick would take
    await sleep(1_000)
    expect(ws.messages.some(m => m.type === 'tick:resolve')).toBe(false)

    room.submitAction('A', { kind: 'raise', x: 0, y: 0 })
    await sleep(100)

    expect(ws.messages.some(m => m.type === 'tick:resolve')).toBe(true)

    room.dispose()
  }, 12_000)

  it('plays a full round quickly and does not persist match results', async () => {
    let matchEndCalls = 0
    const room = makePracticeRoom(() => { matchEndCalls++ })
    const ws = makeFakeWs()

    room.join(ws as any, 'wheat')
    room.joinBot('rice')

    await sleep(6_500)

    for (let i = 0; i < 5; i++) {
      room.submitAction('A', { kind: 'raise', x: 3, y: 3 })
      await sleep(700) // 300ms inter-tick delay + margin
    }

    await sleep(1_500) // weather resolve (500ms) + margin

    expect(ws.messages.some(m => m.type === 'weather:result')).toBe(true)
    expect(matchEndCalls).toBe(0)

    room.dispose()
  }, 20_000)

  it('disposes on player disconnect instead of pausing', () => {
    let disposed = false
    const room = new Room('practice-dc', {
      onDispose: () => { disposed = true },
      gracePeriodMs: 30_000,
    }, { practice: true })
    const ws = makeFakeWs()

    room.join(ws as any, 'wheat')
    room.joinBot('corn')

    room.removePlayer('A')
    expect(disposed).toBe(true)
  })
})
