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

function makeRoom(id = 'test-room'): Room {
  return new Room(id, {
    onDispose: () => {},
    gracePeriodMs: 30_000,
  })
}

describe('Room — bot integration', () => {
  it('joinBot fills a player slot and starts the game', () => {
    const room = makeRoom()
    const ws = makeFakeWs()

    room.join(ws as any, 'wheat')
    expect(ws.messages.length).toBe(0)

    room.joinBot('corn')
    const startMsg = ws.messages.find(m => m.type === 'game:start')
    expect(startMsg).toBeDefined()
    expect(startMsg!.type).toBe('game:start')
  })

  it('bot submits action automatically during tick phase', async () => {
    const room = makeRoom()
    const ws = makeFakeWs()

    room.join(ws as any, 'wheat')
    room.joinBot('rice')

    await sleep(200)

    const roundStart = ws.messages.find(m => m.type === 'round:start')
    expect(roundStart).toBeDefined()

    await sleep(3_500)

    const tickStart = ws.messages.find(m => m.type === 'tick:start')
    expect(tickStart).toBeDefined()

    room.submitAction('A', { kind: 'move', dir: 'N' })

    await sleep(4_500)

    const tickResolve = ws.messages.find(m => m.type === 'tick:resolve')
    expect(tickResolve).toBeDefined()

    room.dispose()
  }, 15_000)

  it('bot does not receive WebSocket messages', () => {
    const room = makeRoom()
    const ws = makeFakeWs()

    room.join(ws as any, 'wheat')
    room.joinBot('corn')

    const allMessages = ws.messages.map(m => m.type)
    expect(allMessages).toContain('game:start')
    expect(allMessages.filter(t => t === 'game:start')).toHaveLength(1)

    room.dispose()
  })

  it('real player can play a full round against bot', async () => {
    const room = makeRoom()
    const ws = makeFakeWs()

    room.join(ws as any, 'wheat')
    room.joinBot('rice')

    await sleep(3_500)

    const tickStart = ws.messages.find(m => m.type === 'tick:start')
    expect(tickStart).toBeDefined()

    for (let i = 0; i < 5; i++) {
      room.submitAction('A', { kind: 'raise', x: 3, y: 3 })
      await sleep(5_000)
    }

    const weatherResult = ws.messages.find(m => m.type === 'weather:result')
    expect(weatherResult).toBeDefined()

    room.dispose()
  }, 45_000)

  it('bot disconnect handling is skipped', () => {
    const room = makeRoom()
    const ws = makeFakeWs()

    room.join(ws as any, 'wheat')
    room.joinBot('corn')

    const disconnectMsg = ws.messages.find(m => m.type === 'opponent:disconnected')
    expect(disconnectMsg).toBeUndefined()

    room.dispose()
  })
})
