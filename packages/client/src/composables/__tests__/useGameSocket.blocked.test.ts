import { describe, it, expect, beforeEach, afterEach, jest } from 'bun:test'

/**
 * Regression test for the Yandex Games black screen (Sept 2026). A portal that
 * leaves the game's own host out of its CSP `connect-src` does not merely fail
 * the connection — `new WebSocket(...)` *throws* `SecurityError` right there in
 * the constructor, in every engine. That throw escaped `createSocket()` during
 * App's setup, Vue abandoned the render, and `#app` was left holding a single
 * comment node: a black screen with no message and no way out.
 *
 * A refused socket has to land in the same place a dead one does — the lobby's
 * "no connection to the server / try again" UI.
 */
class RefusingSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static attempts = 0

  constructor() {
    RefusingSocket.attempts++
    throw new DOMException('The operation is insecure.', 'SecurityError')
  }
}

function installGlobals(): void {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { protocol: 'https:', hostname: 'wheee.io', origin: 'https://wheee.io', href: 'https://wheee.io/' },
  })
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: RefusingSocket })
}

const OFFLINE_AFTER_MS = 8_000

describe('a socket the page is not allowed to open', () => {
  beforeEach(() => {
    installGlobals()
    RefusingSocket.attempts = 0
    jest.useFakeTimers()
  })

  afterEach(() => { jest.useRealTimers() })

  it('does not let the SecurityError escape connect()', async () => {
    const { useGameSocket } = await import('../useGameSocket.js')
    const socket = useGameSocket()
    expect(() => socket.connect()).not.toThrow()
  })

  it('reports the outage instead, so the lobby can offer a retry', async () => {
    const { useGameSocket } = await import('../useGameSocket.js')
    const socket = useGameSocket()
    socket.connect()
    expect(socket.connected.value).toBe(false)
    jest.advanceTimersByTime(OFFLINE_AFTER_MS)
    expect(socket.offline.value).toBe(true)
  })

  it('retries on the usual backoff and eventually gives up', async () => {
    const { useGameSocket } = await import('../useGameSocket.js')
    const socket = useGameSocket()
    socket.connect()
    expect(RefusingSocket.attempts).toBe(1)
    jest.advanceTimersByTime(60_000)
    expect(RefusingSocket.attempts).toBeGreaterThan(1)
    jest.advanceTimersByTime(10 * 60_000)
    expect(socket.gaveUp.value).toBe(true)
  })
})
