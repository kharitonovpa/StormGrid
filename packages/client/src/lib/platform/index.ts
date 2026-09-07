import type { PlatformAdapter, PlatformType } from './types'
import { detectPlatform } from './detect'
import { hydrateStorage } from '../storage'
import { withBudget } from './budget'

export type { PlatformAdapter, PlatformType }

/**
 * How long a portal SDK gets to come up before the game boots without it.
 *
 * Every adapter's `init()` waits on a third-party SDK we don't control, and a
 * portal is entitled to make that wait never end: on Yandex Games the
 * portal's own CSP blocked the GamePush SDK's API hosts, so `gp.player.ready`
 * stayed pending, `init()` never returned and `#app` stayed empty — a black
 * screen with no message and no Reload button. Booting without the SDK is
 * always better than not booting: the game mounts, and the lobby's existing
 * "no connection to the server / try again" UI says what went wrong.
 *
 * Generous on purpose — a cold GamePush init behind a slow portal frame has
 * been measured at ~7s, so this must not clip a genuinely slow SDK.
 */
const INIT_TIMEOUT_MS = 12_000
/** Saved-settings load. Local by definition on every adapter, so much tighter. */
const STORAGE_TIMEOUT_MS = 5_000

export interface InitPlatformOptions {
  initTimeoutMs?: number
  storageTimeoutMs?: number
}

let _platform: PlatformAdapter | null = null
let _initPromise: Promise<PlatformAdapter> | null = null

export async function initPlatform(options: InitPlatformOptions = {}): Promise<PlatformAdapter> {
  if (_platform) return _platform
  if (_initPromise) return _initPromise

  const initBudget = options.initTimeoutMs ?? INIT_TIMEOUT_MS
  const storageBudget = options.storageTimeoutMs ?? STORAGE_TIMEOUT_MS

  _initPromise = (async () => {
    const type = detectPlatform()
    const mod = type === 'yandex'
      ? await import('./yandex')
      : type === 'gamepush'
        ? await import('./gamepush')
        : type === 'discord'
          ? await import('./discord')
          : type === 'telegram'
            ? await import('./telegram')
            : await import('./web')

    if (!mod.default || typeof mod.default !== 'function') {
      throw new Error(`Platform module "${type}" has no default export`)
    }

    const adapter = new mod.default()
    await withBudget(adapter.init(), initBudget, `${type} adapter init`)
    // Saved values are pulled in before the app mounts, so every read after this
    // point can stay synchronous. Budgeted too: on a portal adapter this reads
    // the cloud profile, which is exactly as blockable as init() itself, and an
    // unhydrated store just starts the player on defaults.
    await withBudget(hydrateStorage(adapter.storage), storageBudget, 'storage hydration')
    _platform = adapter
    return _platform
  })()

  try {
    return await _initPromise
  } catch (err) {
    _initPromise = null
    throw err
  }
}

export function usePlatform(): PlatformAdapter {
  if (!_platform) throw new Error('Platform not initialized — call initPlatform() first')
  return _platform
}
