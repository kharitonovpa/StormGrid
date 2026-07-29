import type { UserInfo } from '@wheee/shared'
import type { MuteKind, MuteState, PlatformAdapter, PlatformSound, PlatformStorage } from './types'
import { createLocalStorage } from './defaults'
import { API_BASE } from '../config'

const AD_TIMEOUT_MS = 15_000
const PRELOADER_TIMEOUT_MS = 8_000
const AUTH_TIMEOUT_MS = 30_000
/** Batch writes: `sync()` is a network call, and settings arrive in bursts. */
const SAVE_DEBOUNCE_MS = 500
/** Reserve for the banner. GamePush documents 50–100 px, 110 px on VK Direct. */
const STICKY_HEIGHT_PX = 110
/**
 * The one player field this game needs. Create it in the GamePush panel under
 * Players → Player Fields as a JSON field with this key; without it the adapter
 * falls back to localStorage and warns.
 */
const SAVE_FIELD = 'save'

let gp: GamePushInstance | null = null
let user: UserInfo | null = null
let token: string | null = null
const pauseCbs = new Set<() => void>()
const resumeCbs = new Set<() => void>()
const stickyCbs = new Set<(heightPx: number) => void>()
const muteCbs = new Set<(state: MuteState) => void>()

/* ── Cloud saves: one JSON player field, flushed on a debounce ── */

const localFallback = createLocalStorage()
let saveData: Record<string, string> = {}
let saveTimer: ReturnType<typeof setTimeout> | null = null
let saveFieldBroken = false
let saveLoaded = false

function flushSave(): void {
  saveTimer = null
  if (!gp || saveFieldBroken) return
  // Never write before the profile has been read: `saveData` would still be the
  // empty starting object, and flushing it would erase the player's cloud save.
  if (!saveLoaded) return
  try {
    gp.player.set(SAVE_FIELD, JSON.stringify(saveData))
    void gp.player.sync().catch((e) => {
      console.warn('[gamepush] player.sync failed:', e)
    })
  } catch (e) {
    // Most likely the `save` field was never created in the panel. Say so once
    // and keep the game playable on localStorage.
    saveFieldBroken = true
    console.warn(`[gamepush] cannot write player field "${SAVE_FIELD}" — falling back to localStorage:`, e)
  }
}

const storage: PlatformStorage = {
  async load() {
    const local = await localFallback.load()
    let cloud: Record<string, string> = {}
    try {
      const raw = gp?.player.get(SAVE_FIELD)
      if (typeof raw === 'string' && raw) cloud = JSON.parse(raw)
      else if (raw && typeof raw === 'object') cloud = raw as Record<string, string>
    } catch (e) {
      console.warn(`[gamepush] cannot read player field "${SAVE_FIELD}":`, e)
    }
    // The cloud wins where both have a value; local carries players who started
    // before saves moved to the profile.
    saveData = { ...local, ...cloud }
    saveLoaded = true
    return { ...saveData }
  },
  set(key, value) {
    saveData[key] = value
    // Mirrored locally too, so a failed sync never costs the player their progress.
    localFallback.set(key, value)
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS)
  },
}

/* ── Sound: the platform owns mute, we follow it ── */

function readMuteState(): MuteState {
  return {
    all: gp?.sounds?.isMuted ?? false,
    music: gp?.sounds?.isMusicMuted ?? false,
    sfx: gp?.sounds?.isSFXMuted ?? false,
  }
}

function emitMuteState(): void {
  const state = readMuteState()
  for (const cb of muteCbs) cb(state)
}

const sound: PlatformSound = {
  // Only claim ownership of mute if the SDK actually offers it — otherwise the
  // player's own saved setting would be overwritten with a hardcoded "unmuted".
  get managed() { return !!gp?.sounds },
  getState: readMuteState,
  setMuted(kind: MuteKind, muted: boolean) {
    if (!gp?.sounds) return
    if (kind === 'all') muted ? gp.sounds.mute() : gp.sounds.unmute()
    else if (kind === 'music') muted ? gp.sounds.muteMusic() : gp.sounds.unmuteMusic()
    else muted ? gp.sounds.muteSFX() : gp.sounds.unmuteSFX()
  },
  onChange(cb) {
    muteCbs.add(cb)
    return () => muteCbs.delete(cb)
  },
}

async function authenticateWithServer(): Promise<void> {
  if (!gp || !gp.player.isLoggedIn) return
  try {
    const res = await fetch(`${API_BASE}/api/auth/gamepush`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: gp.player.id,
        name: gp.player.name || 'Player',
        avatar: gp.player.avatar || null,
      }),
    })
    if (!res.ok) return
    const data = await res.json() as { token: string; user: UserInfo }
    token = data.token
    user = data.user
  } catch { /* server unreachable — continue as anonymous */ }
}

export default class GamePushAdapter implements PlatformAdapter {
  readonly type = 'gamepush' as const
  readonly storage = storage
  readonly sound = sound

  get hostId(): string | null { return gp?.platform.type ?? null }

  /** GameDistribution forbids anything leaning on the GamePush backend. */
  private get isGameDistribution(): boolean {
    return this.hostId === 'GAME_DISTRIBUTION'
  }

  canAuth(): boolean { return !this.isGameDistribution }
  canShowLeaderboard(): boolean { return !this.isGameDistribution }

  async init(): Promise<void> {
    if (gp) return

    gp = await new Promise<GamePushInstance>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('GamePush SDK initialization timeout')),
        10_000,
      )
      window.onGPInit = (instance) => {
        clearTimeout(timeout)
        resolve(instance)
      }
    })

    await gp.player.ready

    await Promise.race([
      gp.ads.showPreloader(),
      new Promise<boolean>((r) => setTimeout(() => r(false), PRELOADER_TIMEOUT_MS)),
    ]).catch(() => {})

    if (gp.player.isLoggedIn) {
      await authenticateWithServer()
    }

    gp.ads.on('start', () => { for (const cb of pauseCbs) cb() })
    gp.ads.on('close', () => { for (const cb of resumeCbs) cb() })

    // The banner overlaps the bottom of the screen, so the UI needs to know.
    gp.ads.on('sticky:render', () => { for (const cb of stickyCbs) cb(STICKY_HEIGHT_PX) })
    gp.ads.on('sticky:close', () => { for (const cb of stickyCbs) cb(0) })

    // Guarded: an SDK build without `sounds` must degrade to game-local mute,
    // not throw and take the whole game down with the load-failure screen.
    if (gp.sounds) {
      for (const event of ['mute', 'unmute', 'mute:sfx', 'unmute:sfx', 'mute:music', 'unmute:music']) {
        gp.sounds.on(event, emitMuteState)
      }
    } else {
      console.warn('[gamepush] gp.sounds unavailable — mute stays game-local')
    }
  }

  ready(): void { gp?.gameStart() }

  gameplayStart(): void { gp?.gameplayStart() }
  gameplayStop(): void { gp?.gameplayStop() }

  async getUser(): Promise<UserInfo | null> {
    return user
  }

  async login(): Promise<UserInfo | null> {
    if (!gp) return null
    return new Promise<UserInfo | null>((resolve) => {
      let settled = false
      const finish = (u: UserInfo | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        gp!.player.off('login', onLogin)
        resolve(u)
      }
      const onLogin = async (success: boolean) => {
        if (success) await authenticateWithServer()
        finish(user)
      }
      const timer = setTimeout(() => finish(user), AUTH_TIMEOUT_MS)
      gp!.player.on('login', onLogin)
      gp!.player.login()
    })
  }

  async logout(): Promise<void> {
    if (!gp || !gp.platform.isLogoutAvailable) return
    return new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        gp!.player.off('logout', onLogout)
        user = null
        token = null
        resolve()
      }
      const onLogout = () => finish()
      const timer = setTimeout(finish, AUTH_TIMEOUT_MS)
      gp!.player.on('logout', onLogout)
      gp!.player.logout()
    })
  }

  getAuthToken(): string | null {
    return token
  }

  isRewardedAvailable(): boolean {
    return gp?.ads.isRewardedAvailable ?? false
  }

  async showPreloader(): Promise<boolean> {
    if (!gp) return false
    return Promise.race([
      gp.ads.showPreloader(),
      new Promise<boolean>((r) => setTimeout(() => r(false), PRELOADER_TIMEOUT_MS)),
    ])
  }

  async showInterstitial(): Promise<boolean> {
    if (!gp) return false
    return Promise.race([
      gp.ads.showFullscreen(),
      new Promise<boolean>((r) => setTimeout(() => r(false), AD_TIMEOUT_MS)),
    ])
  }

  async showRewarded(): Promise<boolean> {
    if (!gp) return false
    return Promise.race([
      gp.ads.showRewardedVideo(),
      new Promise<boolean>((r) => setTimeout(() => r(false), AD_TIMEOUT_MS)),
    ])
  }

  showSticky(): void {
    if (!gp?.ads.isStickyAvailable) return
    void gp.ads.showSticky().catch((e) => console.warn('[gamepush] showSticky failed:', e))
  }

  closeSticky(): void {
    void gp?.ads.closeSticky().catch(() => {})
  }

  onStickyChange(cb: (heightPx: number) => void): () => void {
    stickyCbs.add(cb)
    return () => stickyCbs.delete(cb)
  }

  onPause(cb: () => void): () => void {
    pauseCbs.add(cb)
    const handler = () => { if (document.hidden) cb() }
    document.addEventListener('visibilitychange', handler)
    return () => {
      pauseCbs.delete(cb)
      document.removeEventListener('visibilitychange', handler)
    }
  }

  onResume(cb: () => void): () => void {
    resumeCbs.add(cb)
    const handler = () => { if (!document.hidden) cb() }
    document.addEventListener('visibilitychange', handler)
    return () => {
      resumeCbs.delete(cb)
      document.removeEventListener('visibilitychange', handler)
    }
  }

  getLanguage(): string {
    return gp?.language ?? 'en'
  }
}
