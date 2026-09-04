import { describe, it, expect, beforeEach, afterEach, jest } from 'bun:test'

/** Stand-in for the browser's WebSocket: nothing connects, the test drives it. */
class FakeSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: FakeSocket[] = []

  readyState = 0
  onopen: (() => void) | null = null
  onclose: ((e: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  url: string

  constructor(url: string) { this.url = url; FakeSocket.instances.push(this) }
  send(): void {}
  close(): void { this.readyState = FakeSocket.CLOSED }

  /** The server accepted the connection. */
  open(): void { this.readyState = FakeSocket.OPEN; this.onopen?.() }
  /** The connection died without ever opening, as a CSP block does. */
  fail(): void { this.readyState = FakeSocket.CLOSED; this.onclose?.({ code: 1006, reason: '' }) }
}

function installGlobals(): void {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: {
      protocol: 'https:',
      hostname: 'wheee.io',
      origin: 'https://wheee.io',
      href: 'https://wheee.io/',
    },
  })
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FakeSocket })
}

async function freshSocket() {
  installGlobals()
  FakeSocket.instances = []
  const { useGameSocket } = await import('../useGameSocket.js')
  return useGameSocket()
}

const OFFLINE_AFTER_MS = 8_000

describe('offline flag', () => {
  beforeEach(() => {
    installGlobals()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('stays down until the connection has been missing long enough', async () => {
    const socket = await freshSocket()
    socket.connect()
    expect(socket.offline.value).toBe(false)
    jest.advanceTimersByTime(OFFLINE_AFTER_MS - 1)
    expect(socket.offline.value).toBe(false)
    jest.advanceTimersByTime(1)
    expect(socket.offline.value).toBe(true)
  })

  it('never fires for a connection that opens in time', async () => {
    const socket = await freshSocket()
    socket.connect()
    FakeSocket.instances[0]!.open()
    jest.advanceTimersByTime(OFFLINE_AFTER_MS * 2)
    expect(socket.offline.value).toBe(false)
    expect(socket.connected.value).toBe(true)
  })

  it('clears once a connection finally lands', async () => {
    const socket = await freshSocket()
    socket.connect()
    jest.advanceTimersByTime(OFFLINE_AFTER_MS)
    expect(socket.offline.value).toBe(true)
    FakeSocket.instances.at(-1)!.open()
    expect(socket.offline.value).toBe(false)
  })

  it('arms on a refresh that replaces a healthy socket', async () => {
    const socket = await freshSocket()
    socket.connect()
    FakeSocket.instances[0]!.open()
    socket.refreshConnection()
    jest.advanceTimersByTime(OFFLINE_AFTER_MS)
    expect(socket.offline.value).toBe(true)
  })

  it('is not pushed back by the reconnect loop making new sockets', async () => {
    const socket = await freshSocket()
    socket.connect()
    // Fail early and let the backoff build a second socket; the deadline is
    // measured from the first attempt, not from the latest one.
    FakeSocket.instances[0]!.fail()
    jest.advanceTimersByTime(OFFLINE_AFTER_MS)
    expect(FakeSocket.instances.length).toBeGreaterThan(1)
    expect(socket.offline.value).toBe(true)
  })

  it('leaves the give-up budget alone', async () => {
    const socket = await freshSocket()
    socket.connect()
    FakeSocket.instances[0]!.fail()
    jest.advanceTimersByTime(OFFLINE_AFTER_MS)
    // The reconnect loop is nowhere near its 20-attempt budget yet.
    expect(socket.gaveUp.value).toBe(false)
    expect(socket.reconnecting.value).toBe(true)
  })
})
