import { describe, it, expect, mock, afterAll } from 'bun:test'

/**
 * Regression test for the Yandex Games black screen (Sept 2026): the portal's
 * CSP blocked the GamePush SDK's own API, so `gp.player.ready` never settled,
 * `GamePushAdapter.init()` never returned, and `#app` stayed empty forever —
 * no game, no error, no Reload button.
 *
 * `initPlatform()` must therefore never hang on an adapter that doesn't come
 * up: past its budget it boots without the SDK, so the app mounts and the
 * in-game "no connection / try again" UI can speak for itself.
 */

// `detect.ts` reads these at call time; `index.ts` pulls in `../storage`,
// which is inert until hydrated. Neither exists under `bun test`.
Object.defineProperty(globalThis, 'location', {
  configurable: true,
  value: { hostname: 'wheee.io', protocol: 'https:', origin: 'https://wheee.io' },
})
Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })

// Captured before the mock goes in and put back afterwards: `mock.module`
// is global to the whole `bun test` run, and web.test.ts imports the real
// module later in the same process.
const realWeb = await import('../web.ts')

const hung = new Promise<void>(() => {})

mock.module('../web.ts', () => ({
  default: class HungAdapter {
    readonly type = 'web' as const
    readonly storage = { load: async () => ({}), set: () => {} }
    // Never settles — exactly what a CSP-blocked portal SDK does.
    init(): Promise<void> { return hung }
  },
}))

describe('initPlatform — an adapter that never comes up', () => {
  it('boots without the SDK instead of hanging forever', async () => {
    const { initPlatform } = await import('../index.ts')
    const adapter = await initPlatform({ initTimeoutMs: 20, storageTimeoutMs: 20 })
    expect(adapter.type).toBe('web')
  })
})

afterAll(() => { mock.module('../web.ts', () => realWeb) })
