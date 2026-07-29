import type { PlatformStorage } from './platform/types'

/**
 * Saved values, read through whatever the platform requires — localStorage on the
 * web, the player profile on GamePush (their moderation requires progress to go
 * through `gp.player`).
 *
 * The platform is asked for everything once, before Vue mounts, and the result is
 * held here. That keeps `get`/`set` synchronous, so call sites read exactly as
 * they did when this was localStorage.
 */

let cache: Record<string, string> = {}
let backend: PlatformStorage | null = null

/** Called by initPlatform() once the adapter is ready — before the app mounts. */
export async function hydrateStorage(storage: PlatformStorage): Promise<void> {
  backend = storage
  try {
    cache = await storage.load()
  } catch (e) {
    console.warn('[storage] load failed, starting empty:', e)
    cache = {}
  }
}

export function storageGet(key: string): string | null {
  return cache[key] ?? null
}

export function storageSet(key: string, value: string): void {
  cache[key] = value
  backend?.set(key, value)
}
