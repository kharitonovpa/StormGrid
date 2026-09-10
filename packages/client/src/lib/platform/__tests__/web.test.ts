import { describe, it, expect, beforeEach, afterEach, jest } from 'bun:test'

/**
 * Stand-in for the popup window `window.open` returns. Starts open; the test
 * flips `closed` to simulate the OAuth flow ending one way or another.
 */
class FakePopup {
  closed = false
  close(): void { this.closed = true }
}

/**
 * `web.ts` reads `location` at *import* time (via `../config`'s top-level
 * `API_BASE` computation), so it must exist before the module is ever
 * evaluated — hence the dynamic `import()` below, after globals are in place,
 * the same trick `useGameSocket.offline.test.ts` uses for the same reason.
 */
function installGlobals(openImpl: () => FakePopup | null) {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { hostname: 'wheee.io', protocol: 'https:', origin: 'https://wheee.io' },
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      screenX: 0,
      screenY: 0,
      innerWidth: 800,
      innerHeight: 600,
      open: openImpl,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  })
}

async function freshAdapter(openImpl: () => FakePopup | null) {
  installGlobals(openImpl)
  const { default: WebAdapter, setWebUser } = await import('../web.js')
  setWebUser(null)
  return new WebAdapter()
}

describe('WebAdapter.login — failure vs. cancel', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    jest.useFakeTimers()
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: originalFetch })
    jest.useRealTimers()
  })

  it('rejects when the popup is blocked outright', async () => {
    const adapter = await freshAdapter(() => null)
    await expect(adapter.login('google')).rejects.toThrow(/blocked/i)
  })

  it('rejects when the server cannot be reached after the popup closes', async () => {
    const popup = new FakePopup()
    const adapter = await freshAdapter(() => popup)
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: async () => { throw new Error('network down') },
    })

    const pending = adapter.login('google')
    popup.closed = true
    jest.advanceTimersByTime(500)

    await expect(pending).rejects.toThrow('network down')
  })

  it('does NOT reject on an ordinary cancel — server reachable, answers not-ok', async () => {
    const popup = new FakePopup()
    const adapter = await freshAdapter(() => popup)
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      // Mirrors /api/auth/me's actual shape for a missing session; asserting
      // against a bare `!res.ok` (e.g. a 401) here would wrongly turn a
      // cancel into a reported failure.
      value: async () => new Response(JSON.stringify({ user: null }), { status: 401 }),
    })

    const pending = adapter.login('google')
    popup.closed = true
    jest.advanceTimersByTime(500)

    await expect(pending).resolves.toBeNull()
  })
})

describe('WebAdapter on itch.io', () => {
  const saved = process.env.VITE_PLATFORM
  const originalFetch = globalThis.fetch

  afterEach(() => {
    if (saved === undefined) delete process.env.VITE_PLATFORM
    else process.env.VITE_PLATFORM = saved
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: originalFetch })
  })

  it('does not ask the API for a session the frame can never hold', async () => {
    process.env.VITE_PLATFORM = 'itch'
    const adapter = await freshAdapter(() => new FakePopup())
    let calls = 0
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: async () => { calls++; return new Response('{"user":null}') },
    })
    await adapter.init()
    expect(calls).toBe(0)
  })

  it('reports itch as the host so analytics can split its traffic', async () => {
    process.env.VITE_PLATFORM = 'itch'
    const adapter = await freshAdapter(() => new FakePopup())
    expect(adapter.type).toBe('web')
    expect(adapter.hostId).toBe('itch')
  })

  it('hides sign-in, which needs a cookie the itch frame cannot keep', async () => {
    process.env.VITE_PLATFORM = 'itch'
    const adapter = await freshAdapter(() => new FakePopup())
    expect(adapter.canAuth()).toBe(false)
    expect(adapter.canLinkOut()).toBe(true)
  })

  it('keeps the plain web build unchanged', async () => {
    delete process.env.VITE_PLATFORM
    const adapter = await freshAdapter(() => new FakePopup())
    expect(adapter.hostId).toBeNull()
    expect(adapter.canAuth()).toBe(true)
  })
})
