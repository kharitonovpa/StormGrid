import type { UserInfo } from '@wheee/shared'

export type PlatformType = 'web' | 'telegram' | 'yandex' | 'gamepush'

/** Which audio track a mute applies to. */
export type MuteKind = 'all' | 'music' | 'sfx'

export type MuteState = { all: boolean; music: boolean; sfx: boolean }

/**
 * Where the game's saved values live. Some platforms (GamePush) require progress
 * to go through their player profile rather than localStorage.
 */
export interface PlatformStorage {
  /** Read everything the platform has stored. Called once, during init(). */
  load(): Promise<Record<string, string>>
  /** Write one value. Implementations may batch the actual flush. */
  set(key: string, value: string): void
}

/**
 * Platform-level mute. When `managed` is true the platform owns the state — it
 * survives reloads on its own and is shared with the platform's own audio button,
 * so the game follows it instead of its own stored flags.
 */
export interface PlatformSound {
  readonly managed: boolean
  getState(): MuteState
  setMuted(kind: MuteKind, muted: boolean): void
  onChange(cb: (state: MuteState) => void): () => void
}

export interface PlatformAdapter {
  readonly type: PlatformType
  /**
   * The specific site behind an aggregator — GamePush reports e.g.
   * 'GAME_DISTRIBUTION' or 'OK'. Null when the platform is the host itself.
   */
  readonly hostId: string | null

  init(): Promise<void>
  ready(): void
  gameplayStart(): void
  gameplayStop(): void

  getUser(): Promise<UserInfo | null>
  login(provider?: string): Promise<UserInfo | null>
  logout(): Promise<void>
  getAuthToken(): string | null

  /** False where signing in would need a backend the host forbids. */
  canAuth(): boolean
  /** False where the host does not allow overlay windows like a leaderboard. */
  canShowLeaderboard(): boolean
  /**
   * False on hosts that forbid sending players anywhere off the portal — the
   * community link and challenge links included. Portal moderation rejects
   * builds over this ("external links are severely not allowed"), and inside a
   * portal iframe `location.origin` is the portal's CDN anyway.
   */
  canLinkOut(): boolean

  isRewardedAvailable(): boolean
  showPreloader(): Promise<boolean>
  showInterstitial(): Promise<boolean>
  showRewarded(): Promise<boolean>

  /** Bottom-anchored banner. No-op where the platform has none. */
  showSticky(): void
  closeSticky(): void
  /** Fires with the height in pixels the banner occupies — 0 when it is gone. */
  onStickyChange(cb: (heightPx: number) => void): () => void

  onPause(cb: () => void): () => void
  onResume(cb: () => void): () => void

  readonly storage: PlatformStorage
  readonly sound: PlatformSound

  getLanguage(): string
}
