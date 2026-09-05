import { describe, it, expect } from 'bun:test'
import { RoomManager } from '../RoomManager.js'
import type { ServerMessage } from '../protocol.js'
import type { PlayerId, PlayerInfo } from '@wheee/shared'

/**
 * The nameplate shows each human's points total. The server copies it into
 * PlayerInfo once, at join, through the pointsFor callback; bots have none.
 */

function makeFakeWs(deviceId: string, userId: string | null = null) {
  const messages: ServerMessage[] = []
  return {
    data: {
      sessionId: crypto.randomUUID(),
      userId,
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

function playerInfoFrom(messages: ServerMessage[]): Record<PlayerId, PlayerInfo> {
  const withInfo = messages.find((m) => 'playerInfo' in m) as { playerInfo: Record<PlayerId, PlayerInfo> } | undefined
  expect(withInfo).toBeDefined()
  return withInfo!.playerInfo
}

describe('PlayerInfo.points', () => {
  it('copies pointsFor(ws) for the human and leaves the bot without', () => {
    const rm = new RoomManager({ pointsFor: (ws) => (ws.data.userId === 'u-1' ? 1240 : 0) })
    const room = rm.createRoom({ practice: true, lightningEnabled: false })
    const ws = makeFakeWs('dev-1', 'u-1')
    const pid = room.join(ws as never, 'wheat')!
    room.joinBot('rice')
    const info = playerInfoFrom(ws.messages)
    expect(info[pid].points).toBe(1240)
    expect(info[pid === 'A' ? 'B' : 'A'].points).toBeUndefined()
  })

  it('omits points when the callback returns 0 or is absent', () => {
    const rmZero = new RoomManager({ pointsFor: () => 0 })
    const roomZero = rmZero.createRoom({ practice: true, lightningEnabled: false })
    const wsZero = makeFakeWs('dev-2')
    const pidZero = roomZero.join(wsZero as never, 'wheat')!
    roomZero.joinBot('rice')
    expect(playerInfoFrom(wsZero.messages)[pidZero].points).toBeUndefined()

    const rmNone = new RoomManager({})
    const roomNone = rmNone.createRoom({ practice: true, lightningEnabled: false })
    const wsNone = makeFakeWs('dev-3')
    const pidNone = roomNone.join(wsNone as never, 'wheat')!
    roomNone.joinBot('rice')
    expect(playerInfoFrom(wsNone.messages)[pidNone].points).toBeUndefined()
  })
})
