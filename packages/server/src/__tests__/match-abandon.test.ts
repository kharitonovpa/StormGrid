import { describe, it, expect } from 'bun:test'
import { RoomManager } from '../RoomManager.js'
import type { AbandonData } from '../Room.js'
import type { ServerMessage } from '../protocol.js'

/**
 * A player who closes the tab mid-match is the one player the client-side
 * funnel can never see: `match_end` only ever fires on a `game:end` message,
 * and the server sends that to whoever is left, not to the one who left. These
 * tests pin the server-side record that closes the gap.
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

describe('abandoned matches', () => {
  it('records the leaver when a tutorial player walks out mid-match', () => {
    const abandons: AbandonData[] = []
    const rm = new RoomManager({ onAbandon: (d) => abandons.push(d) })
    const room = rm.createRoom({ practice: true, lightningEnabled: false })
    const ws = makeFakeWs('tut-1')
    const pid = room.join(ws as never, 'wheat')
    room.joinBot('rice')

    room.removePlayer(pid!)

    expect(abandons).toHaveLength(1)
    expect(abandons[0].reason).toBe('practice_quit')
    expect(abandons[0].practice).toBe(true)
    expect(abandons[0].analytics?.deviceId).toBe('tut-1')
    expect(abandons[0].round).toBe(1)
  })

  it('records the leaver only once the reconnect grace has run out', async () => {
    const abandons: AbandonData[] = []
    const rm = new RoomManager({ gracePeriodMs: 10, onAbandon: (d) => abandons.push(d) })
    const room = rm.createRoom({ lightningEnabled: true })
    const a = makeFakeWs('pvp-a')
    const b = makeFakeWs('pvp-b')
    const pidA = room.join(a as never, 'wheat')
    room.join(b as never, 'rice')

    room.removePlayer(pidA!)
    expect(abandons).toHaveLength(0)

    await new Promise((r) => setTimeout(r, 50))

    expect(abandons).toHaveLength(1)
    expect(abandons[0].reason).toBe('forfeit')
    expect(abandons[0].practice).toBe(false)
    expect(abandons[0].vsBot).toBe(false)
    expect(abandons[0].analytics?.deviceId).toBe('pvp-a')
  })

  it('says nothing when a player leaves before the match has begun', () => {
    const abandons: AbandonData[] = []
    const rm = new RoomManager({ onAbandon: (d) => abandons.push(d) })
    const room = rm.createRoom({ lightningEnabled: true })
    const ws = makeFakeWs('solo-1')
    const pid = room.join(ws as never, 'wheat')

    room.removePlayer(pid!)

    expect(abandons).toHaveLength(0)
  })

  it('marks a queue bot match as vsBot so bot and human quits can be told apart', async () => {
    const abandons: AbandonData[] = []
    const rm = new RoomManager({ gracePeriodMs: 10, onAbandon: (d) => abandons.push(d) })
    const room = rm.createRoom({ lightningEnabled: true })
    const ws = makeFakeWs('botquit-1')
    const pid = room.join(ws as never, 'wheat')
    room.joinBot('rice')

    room.removePlayer(pid!)
    await new Promise((r) => setTimeout(r, 50))

    expect(abandons).toHaveLength(1)
    expect(abandons[0].vsBot).toBe(true)
  })
})
