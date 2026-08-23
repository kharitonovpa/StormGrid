import type { PlatformAdapter } from './types'
import { createLocalStorage, createLocalSound, noSticky } from './defaults'

/** Placeholder — replaced by the real adapter in the next task. */
export default class DiscordAdapter implements PlatformAdapter {
  readonly type = 'discord' as const
  readonly hostId = null
  readonly storage = createLocalStorage()
  readonly sound = createLocalSound()

  canAuth(): boolean { return true }
  canShowLeaderboard(): boolean { return true }
  canLinkOut(): boolean { return false }

  showSticky = noSticky.showSticky
  closeSticky = noSticky.closeSticky
  onStickyChange = noSticky.onStickyChange

  async init(): Promise<void> {}
  ready(): void {}
  gameplayStart(): void {}
  gameplayStop(): void {}
  async getUser() { return null }
  async login() { return null }
  async logout(): Promise<void> {}
  getAuthToken(): string | null { return null }
  isRewardedAvailable(): boolean { return false }
  async showPreloader(): Promise<boolean> { return false }
  async showInterstitial(): Promise<boolean> { return false }
  async showRewarded(): Promise<boolean> { return false }
  onPause(_cb: () => void): () => void { return () => {} }
  onResume(_cb: () => void): () => void { return () => {} }
  getLanguage(): string { return 'en' }
}
