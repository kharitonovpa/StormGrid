import type { PlatformAdapter, PlatformType } from './types'
import { detectPlatform } from './detect'

export type { PlatformAdapter, PlatformType }

let _platform: PlatformAdapter | null = null
let _initPromise: Promise<PlatformAdapter> | null = null

export async function initPlatform(): Promise<PlatformAdapter> {
  if (_platform) return _platform
  if (_initPromise) return _initPromise

  _initPromise = (async () => {
    const type = detectPlatform()
    const mod = type === 'yandex'
      ? await import('./yandex')
      : type === 'gamepush'
        ? await import('./gamepush')
        : type === 'telegram'
          ? await import('./telegram')
          : await import('./web')

    if (!mod.default || typeof mod.default !== 'function') {
      throw new Error(`Platform module "${type}" has no default export`)
    }

    const adapter = new mod.default()
    await adapter.init()
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
