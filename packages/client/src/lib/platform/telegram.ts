import type { UserInfo } from '@wheee/shared'
import type { PlatformAdapter } from './types'
import { createLocalStorage, createLocalSound, noSticky } from './defaults'
import { API_BASE } from '../config'
import { setSafeAreaInset } from './safeArea'

let user: UserInfo | null = null
let token: string | null = null
const authCallbacks = new Set<() => void>()

/**
 * Clients old enough to lack both inset fields still run under a Telegram header
 * on mobile — this is a conservative estimate of its height so the UI doesn't sit
 * underneath it. Desktop/web Telegram clients don't have this chrome.
 */
const TG_HEADER_FALLBACK_PX = 56
const TG_MOBILE_PLATFORMS = new Set(['ios', 'android'])

/**
 * Telegram's two inset fields compose: `safeAreaInset` is the device's own notch
 * / home-indicator, `contentSafeAreaInset` is Telegram's own header and bottom
 * bar on top of that. Both are Bot API 8.0+ and must be feature-detected.
 */
function applyTelegramSafeArea(wa: TelegramWebApp): void {
  const content = wa.contentSafeAreaInset
  const device = wa.safeAreaInset
  const hasInsets = content !== undefined || device !== undefined
  const top = hasInsets
    ? (content?.top ?? 0) + (device?.top ?? 0)
    : (TG_MOBILE_PLATFORMS.has(wa.platform) ? TG_HEADER_FALLBACK_PX : 0)

  setSafeAreaInset({
    top,
    bottom: (content?.bottom ?? 0) + (device?.bottom ?? 0),
    left: (content?.left ?? 0) + (device?.left ?? 0),
    right: (content?.right ?? 0) + (device?.right ?? 0),
  })
}

/** `onEvent` is safe to call with an unrecognized name, but older clients may not
 * have the method at all — guard each subscription independently. */
function subscribeSafeArea(wa: TelegramWebApp): void {
  const handler = () => applyTelegramSafeArea(wa)
  for (const eventType of ['safeAreaChanged', 'contentSafeAreaChanged', 'viewportChanged']) {
    try { wa.onEvent?.(eventType, handler) } catch { /* unsupported on this client */ }
  }
}

export default class TelegramAdapter implements PlatformAdapter {
  readonly type = 'telegram' as const
  readonly hostId = null
  readonly storage = createLocalStorage()
  readonly sound = createLocalSound()

  canAuth(): boolean { return true }
  canShowLeaderboard(): boolean { return true }
  canLinkOut(): boolean { return true }

  showSticky = noSticky.showSticky
  closeSticky = noSticky.closeSticky
  onStickyChange = noSticky.onStickyChange

  async init(): Promise<void> {
    const wa = window.Telegram?.WebApp
    if (wa) {
      wa.ready()
      wa.expand()
      wa.disableVerticalSwipes()
      applyTelegramSafeArea(wa)
      subscribeSafeArea(wa)
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

  isRewardedAvailable(): boolean { return false }
  async showPreloader(): Promise<boolean> { return false }
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
