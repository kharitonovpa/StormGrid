interface GamePushPlayer {
  id: number
  name: string
  avatar: string
  isLoggedIn: boolean
  ready: Promise<void>
  sync(options?: { override?: boolean }): Promise<void>
  get(key: string): unknown
  set(key: string, value: unknown): void
  has(key: string): boolean
  login(): void
  logout(): void
  on(event: string, cb: (success: boolean) => void): void
  off(event: string, cb: (success: boolean) => void): void
}

interface GamePushAds {
  isFullscreenPlaying: boolean
  isRewardedPlaying: boolean
  isPreloaderPlaying: boolean
  isStickyPlaying: boolean
  isFullscreenAvailable: boolean
  isRewardedAvailable: boolean
  showFullscreen(opts?: { showCountdownOverlay?: boolean }): Promise<boolean>
  showRewardedVideo(opts?: { showCountdownOverlay?: boolean }): Promise<boolean>
  showPreloader(): Promise<boolean>
  showSticky(): Promise<boolean>
  closeSticky(): Promise<void>
  on(event: string, cb: (...args: unknown[]) => void): void
  off(event: string, cb: (...args: unknown[]) => void): void
}

interface GamePushPlatform {
  type: string
  hasIntegratedAuth: boolean
  isExternalLinksAllowed: boolean
  isLogoutAvailable: boolean
  isSecretCodeAuthAvailable: boolean
}

interface GamePushInstance {
  player: GamePushPlayer
  ads: GamePushAds
  platform: GamePushPlatform
  language: string
  changeLanguage(lang: string): void
  isDev: boolean
  isReady: boolean
}

declare interface Window {
  onGPInit?: (gp: GamePushInstance) => void
}
