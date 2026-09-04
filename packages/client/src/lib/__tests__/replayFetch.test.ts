import { describe, it, expect, beforeEach } from 'bun:test'

/**
 * `config.ts` reads `location` at module scope, so the stub has to be in place
 * before the module under test is ever imported — hence the dynamic import.
 */
function installLocation(): void {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: {
      protocol: 'https:',
      hostname: 'wheee.io',
      origin: 'https://wheee.io',
      href: 'https://wheee.io/',
    },
  })
}

function stubFetch(impl: () => Promise<unknown>): void {
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: impl })
}

async function loadModule() {
  installLocation()
  return import('../replayPlayer.js')
}

describe('replay fetches', () => {
  beforeEach(installLocation)

  it('returns null when the request is blocked outright', async () => {
    const { fetchReplayList } = await loadModule()
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    expect(await fetchReplayList()).toBeNull()
  })

  it('returns null when the server answers with an error status', async () => {
    const { fetchReplayList } = await loadModule()
    stubFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve(null) }))
    expect(await fetchReplayList()).toBeNull()
  })

  it('returns an empty array when there are genuinely no replays', async () => {
    const { fetchReplayList } = await loadModule()
    stubFetch(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }))
    expect(await fetchReplayList()).toEqual([])
  })

  it('returns null when a single replay cannot be fetched', async () => {
    const { fetchReplayData } = await loadModule()
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    expect(await fetchReplayData('abc')).toBeNull()
  })
})
