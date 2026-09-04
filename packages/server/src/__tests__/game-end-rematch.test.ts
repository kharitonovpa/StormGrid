import { describe, it, expect } from 'bun:test'
import { RoomManager } from '../RoomManager.js'
import type { ServerMessage } from '../protocol.js'

/*
 * The game-over card must know on its first paint whether "Rematch" belongs on
 * it. `rematch:available` follows `game:end` as a separate message, which lets
 * the button pop in after the card is already up — so `game:end` itself says
 * whether a human pair is still here.
 */

function makeFakeWs() {
  const messages: ServerMessage[] = []
  return {
    data: { sessionId: crypto.randomUUID(), userId: null, userName: null, countryCode: null, roomId: null, playerId: null, role: null, analytics: null, lastActiveAt: 0 },
    readyState: 1,
    send(data: string) { messages.push(JSON.parse(data)) },
    messages,
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Plays a whole match: both players dig a far corner every tick, so the first wind takes both. */
async function playToEnd(ws: ReturnType<typeof makeFakeWs>, room: ReturnType<RoomManager['createRoom']>, pid: 'A' | 'B') {
  let acted = 0
  for (let i = 0; i < 2400; i++) { // up to 60 s: a bot answers with a human-like 1–4 s delay per tick
    const ticks = ws.messages.filter((m) => m.type === 'tick:start').length
    if (ticks > acted) { acted = ticks; room.submitAction(pid, { kind: 'lower', x: 0, y: 0 }) }
    if (ws.messages.some((m) => m.type === 'game:end')) return
    await sleep(25)
  }
  throw new Error('match did not end')
}

describe('game:end rematch offer', () => {
  it('tells both humans the rematch is on the table', async () => {
    const room = new RoomManager().createRoom({ lightningEnabled: true })
    const a = makeFakeWs()
    const b = makeFakeWs()
    room.join(a as never, 'wheat')
    room.join(b as never, 'rice')

    await Promise.all([playToEnd(a, room, 'A'), playToEnd(b, room, 'B')])

    const endA = a.messages.find((m) => m.type === 'game:end') as { rematchOffered?: boolean }
    const endB = b.messages.find((m) => m.type === 'game:end') as { rematchOffered?: boolean }
    expect(endA.rematchOffered).toBe(true)
    expect(endB.rematchOffered).toBe(true)
  }, 20_000)

  it('carries no offer against a bot', async () => {
    const room = new RoomManager().createRoom({ lightningEnabled: true })
    const a = makeFakeWs()
    room.join(a as never, 'wheat')
    room.joinBot('rice')

    await playToEnd(a, room, 'A')

    const end = a.messages.find((m) => m.type === 'game:end') as { rematchOffered?: boolean }
    expect(end.rematchOffered).toBeUndefined()
  }, 60_000)
})
