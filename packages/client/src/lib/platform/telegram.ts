import type { UserInfo } from '@wheee/shared'
import type { PlatformAdapter } from './types'
import { API_BASE } from '../config'

let user: UserInfo | null = null
let token: string | null = null
const authCallbacks = new Set<() => void>()

export default class TelegramAdapter implements PlatformAdapter {
  readonly type = 'telegram' as const

  async init(): Promise<void> {
    const wa = window.Telegram?.WebApp
    if (wa) {
      wa.ready()
      wa.expand()
      wa.disableVerticalSwipes()
    }
    await this.loginWithRetry()
  }

  ready(): void { /* already called in init */ }
  gameplayStart(): void { /* noop */ }
  gameplayStop(): void { /* noop */ }

  async getUser(): Promise<UserInfo | null> {
    return user
  }

  async login(): Promise<UserInfo | null> {
    if (!user) await this.loginWithRetry(1)
    return user
  }

  async logout(): Promise<void> { /* noop in Telegram */ }

  getAuthToken(): string | null {
    return token
  }

  async showInterstitial(): Promise<boolean> { return false }
  async showRewarded(): Promise<boolean> { return false }

  onPause(cb: () => void): () => void {
    const handler = () => { if (document.hidden) cb() }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }

  onResume(cb: () => void): () => void {
    const handler = () => { if (!document.hidden) cb() }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }

  getLanguage(): string {
    const ud = window.Telegram?.WebApp?.initDataUnsafe as { user?: { language_code?: string } } | undefined
    return ud?.user?.language_code ?? 'en'
  }

  private async loginWithRetry(maxAttempts = 3): Promise<boolean> {
    const initData = window.Telegram?.WebApp?.initData
    if (!initData) {
      console.warn('[telegram] initData not available — running as anonymous')
      return false
    }
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
      try {
        const res = await fetch(`${API_BASE}/api/auth/telegram`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData }),
        })
        if (!res.ok) continue
        const data = await res.json() as { token: string; user: UserInfo }
        token = data.token
        user = data.user
        for (const cb of authCallbacks) cb()
        return true
      } catch { /* retry */ }
    }
    console.warn('[telegram] Auth failed after', maxAttempts, 'attempts — running as anonymous')
    return false
  }
}

export function onTelegramAuthChange(cb: () => void): () => void {
  authCallbacks.add(cb)
  return () => authCallbacks.delete(cb)
}

export function getTelegramUser(): UserInfo | null {
  return user
}
