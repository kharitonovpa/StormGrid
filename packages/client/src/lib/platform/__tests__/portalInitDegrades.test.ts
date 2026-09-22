import { describe, it, expect, beforeAll } from 'bun:test'

/**
 * Regression test for the Yandex Games moderation reject of 2026-09-21 (rule
 * 1.14, "ошибка на старте"): on the portal the enforced CSP refuses
 * `api.gamepush.com`/`apip.gamepush.com`, the GamePush SDK dies on its own
 * chunk load, `onGPInit` never fires — and `GamePushAdapter.init()` used to
 * *reject*. `withBudget` propagates a rejection by design, so `initPlatform()`
 * rejected too and `main.ts` painted its "Не удалось загрузить игру / Проверь
 * подключение к интернету" card over a game that was perfectly playable.
 *
 * A portal SDK is an optional extra — ads, cloud saves, portal auth. Losing it
 * must cost those and nothing else, so neither portal adapter may reject from
 * `init()`: it degrades to `gp`/`ysdk` null, which every method below already
 * guards for. Only genuine programming errors (a module with no default
 * export) are still allowed to take the boot down.
 */

beforeAll(() => {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { hostname: 'yandex.ru', protocol: 'https:', origin: 'https://yandex.ru' },
  })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { hidden: false, addEventListener() {}, removeEventListener() {} },
  })
})

describe('GamePushAdapter.init — SDK blocked by the portal', () => {
  it('resolves instead of rejecting when the SDK never calls onGPInit', async () => {
    const { default: GamePushAdapter } = await import('../gamepush.ts')
    const adapter = new GamePushAdapter()

    // The SDK script is loaded but its API hosts are refused, so the callback
    // never arrives. `init()` must not be the thing that ends the boot.
    const settled = await Promise.race([
      adapter.init().then(() => 'resolved' as const, () => 'rejected' as const),
      new Promise<'pending'>((r) => setTimeout(() => r('pending'), 300)),
    ])
    expect(settled).not.toBe('rejected')
  })

  it('resolves when the SDK comes up but its player profile never loads', async () => {
    const { default: GamePushAdapter } = await import('../gamepush.ts')
    const adapter = new GamePushAdapter()

    const init = adapter.init()
    // The real SDK hands the instance over through this global callback.
    ;(globalThis as { window: { onGPInit?: (i: unknown) => void } }).window.onGPInit?.({
      player: { ready: Promise.reject(new Error('blocked by CSP')), isLoggedIn: false },
      ads: {},
    })

    const settled = await Promise.race([
      init.then(() => 'resolved' as const, () => 'rejected' as const),
      new Promise<'pending'>((r) => setTimeout(() => r('pending'), 300)),
    ])
    expect(settled).toBe('resolved')
    // Degraded, not half-initialised: the ad slots simply report themselves gone.
    expect(adapter.isRewardedAvailable()).toBe(false)
  })
})

describe('YandexAdapter.init — SDK script blocked', () => {
  it('resolves instead of throwing when YaGames never loaded', async () => {
    const { default: YandexAdapter } = await import('../yandex.ts')
    const adapter = new YandexAdapter()

    const settled = await adapter.init().then(() => 'resolved' as const, () => 'rejected' as const)
    expect(settled).toBe('resolved')
    expect(adapter.isRewardedAvailable()).toBe(false)
  })
})
