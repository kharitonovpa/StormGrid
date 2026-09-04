import { describe, it, expect } from 'bun:test'
import { countIdleHumans, IDLE_HUMAN_WINDOW_MS, type PresenceClient } from '../presence.js'

function client(over: Partial<PresenceClient> = {}): PresenceClient {
  return { readyState: 1, data: { roomId: null, lastActiveAt: 1_000_000 }, ...over } as PresenceClient
}

/*
 * The bot-fallback window is short only when nobody is around to wait for. A
 * socket counts as "around" when it has no room and reported activity inside
 * the idle window — a tab parked on the lobby for an hour is not an opponent.
 */
describe('countIdleHumans', () => {
  const now = 1_000_000 + 10_000

  it('counts a lobby socket active within the window', () => {
    expect(countIdleHumans([client()], null, now)).toBe(1)
  })

  it('ignores a socket whose activity is older than the window', () => {
    const stale = client({ data: { roomId: null, lastActiveAt: now - IDLE_HUMAN_WINDOW_MS - 1 } })
    expect(countIdleHumans([stale], null, now)).toBe(0)
  })

  it('counts activity just inside the window edge', () => {
    const edge = client({ data: { roomId: null, lastActiveAt: now - IDLE_HUMAN_WINDOW_MS + 1 } })
    expect(countIdleHumans([edge], null, now)).toBe(1)
  })

  it('ignores sockets in a room and closed sockets', () => {
    const playing = client({ data: { roomId: 'room-1', lastActiveAt: now } })
    const closed = client({ readyState: 3 })
    expect(countIdleHumans([playing, closed], null, now)).toBe(0)
  })

  it('excludes the queuer themself', () => {
    const me = client()
    const other = client()
    expect(countIdleHumans([me, other], me, now)).toBe(1)
  })
})
