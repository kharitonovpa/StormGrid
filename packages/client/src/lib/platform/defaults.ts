import type { MuteKind, MuteState, PlatformSound, PlatformStorage } from './types'

/** Every key the game owns starts with this — see lib/storage.ts. */
const KEY_PREFIX = 'wheee'

/**
 * localStorage-backed saves: the behaviour every platform had before GamePush
 * required its own. Values stay under their own keys, so nothing a player has
 * already saved is lost.
 */
export function createLocalStorage(): PlatformStorage {
  return {
    async load() {
      const out: Record<string, string> = {}
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (!key || !key.startsWith(KEY_PREFIX)) continue
          const value = localStorage.getItem(key)
          if (value !== null) out[key] = value
        }
      } catch { /* private mode — the game runs with defaults */ }
      return out
    },
    set(key, value) {
      try { localStorage.setItem(key, value) } catch { /* private mode */ }
    },
  }
}

/** Mute with no platform behind it: the game's own settings remain the truth. */
export function createLocalSound(): PlatformSound {
  const state: MuteState = { all: false, music: false, sfx: false }
  return {
    managed: false,
    getState: () => ({ ...state }),
    setMuted(kind: MuteKind, muted: boolean) { state[kind] = muted },
    onChange: () => () => {},
  }
}

/** Platforms without a banner still have to answer the sticky calls. */
export const noSticky = {
  showSticky() {},
  closeSticky() {},
  onStickyChange: (_cb: (heightPx: number) => void) => () => {},
}
