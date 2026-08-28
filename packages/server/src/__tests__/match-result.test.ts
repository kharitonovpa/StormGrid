import { describe, it, expect } from 'bun:test'
import { RoomManager } from '../RoomManager.js'
import type { MatchEndData } from '../Room.js'
import type { ServerMessage } from '../protocol.js'

/**
 * Why a player lost is computed for every ending and sent to the clients, then
 * thrown away. It is the one thing that says whether a newcomer was beaten by
 * the opponent or by the weather — and the queue's first-match bot never hunts,
 * so the answer decides what wave 1 should even aim at. These tests pin the
 * cause, and each player's analytics identity, onto the record the server keeps.
 */

function makeFakeWs(deviceId: string) {
  const messages: ServerMessage[] = []
  return {
    data: {
      sessionId: crypto.randomUUID(),
      userId: null,
      userName: null,
      countryCode: null,
      roomId: null,
      playerId: null,
      role: null,
      analytics: { deviceId, sessionId: `s-${deviceId}`, platform: 'web', host: null },
    },
    readyState: 1,
    send(data: string) { messages.push(JSON.parse(data)) },
    messages,
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('match results', () => {
  it('carries the death cause and both identities out of a forfeit', async () => {
    const ends: MatchEndData[] = []
    const rm = new RoomManager({ gracePeriodMs: 10, onMatchEnd: (d) => ends.push(d) })
    const room = rm.createRoom({ lightningEnabled: true })
    const a = makeFakeWs('res-a')
    const b = makeFakeWs('res-b')
    const pidA = room.join(a as never, 'wheat')
    room.join(b as never, 'rice')

    room.removePlayer(pidA!)
    await sleep(50)

    expect(ends).toHaveLength(1)
    expect(ends[0].winner).toBe('B')
    expect(ends[0].deathCauses.A).toEqual({ type: 'disconnect' })
    expect(ends[0].analytics.A?.deviceId).toBe('res-a')
    expect(ends[0].analytics.B?.deviceId).toBe('res-b')
  })

  it('leaves the bot slot without an identity', async () => {
    const ends: MatchEndData[] = []
    const rm = new RoomManager({ gracePeriodMs: 10, onMatchEnd: (d) => ends.push(d) })
    const room = rm.createRoom({ lightningEnabled: true })
    const ws = makeFakeWs('res-human')
    const pid = room.join(ws as never, 'wheat')
    room.joinBot('rice')

    room.removePlayer(pid!)
    await sleep(50)

    expect(ends).toHaveLength(1)
    expect(ends[0].analytics.A?.deviceId).toBe('res-human')
    expect(ends[0].analytics.B).toBeNull()
    expect(ends[0].vsBot).toBe(true)
  })
})
