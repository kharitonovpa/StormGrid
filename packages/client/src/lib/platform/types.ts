import type { UserInfo } from '@wheee/shared'

export type PlatformType = 'web' | 'telegram' | 'yandex'

export interface PlatformAdapter {
  readonly type: PlatformType

  init(): Promise<void>
  ready(): void
  gameplayStart(): void
  gameplayStop(): void

  getUser(): Promise<UserInfo | null>
  login(provider?: string): Promise<UserInfo | null>
  logout(): Promise<void>
  getAuthToken(): string | null

  showInterstitial(): Promise<boolean>
  showRewarded(): Promise<boolean>

  onPause(cb: () => void): () => void
  onResume(cb: () => void): () => void

  getLanguage(): string
}
