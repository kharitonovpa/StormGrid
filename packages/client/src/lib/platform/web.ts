import type { UserInfo } from '@wheee/shared'
import type { PlatformAdapter } from './types'
import { createLocalStorage, createLocalSound, noSticky } from './defaults'
import { API_BASE } from '../config'

let user: UserInfo | null = null
const authCallbacks = new Set<() => void>()

export default class WebAdapter implements PlatformAdapter {
  readonly type = 'web' as const
  /**
   * The itch.io archive runs this same adapter. Marking the host keeps its
   * traffic out of the wheee.io numbers in the analytics platform split.
   */
  readonly hostId = import.meta.env.VITE_PLATFORM === 'itch' ? 'itch' : null
  readonly storage = createLocalStorage()
  readonly sound = createLocalSound()

  /**
   * Not on itch.io. The session lives in an api.wheee.io cookie, which inside
   * itch's game frame is a third-party cookie browsers drop, and the OAuth popup
   * only reports back to wheee.io origins. A guest plays everything but spectating.
   */
  canAuth(): boolean { return import.meta.env.VITE_PLATFORM !== 'itch' }
  canShowLeaderboard(): boolean { return true }
  canLinkOut(): boolean { return true }

  showSticky = noSticky.showSticky
  closeSticky = noSticky.closeSticky
  onStickyChange = noSticky.onStickyChange

  async init(): Promise<void> {
    if (!this.canAuth()) return
    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json() as { user: UserInfo | null }
        user = data.user
      }
    } catch { /* offline — keep user null */ }
  }

  ready(): void { /* noop */ }
  gameplayStart(): void { /* noop */ }
  gameplayStop(): void { /* noop */ }

  async getUser(): Promise<UserInfo | null> {
    return user
  }

  async login(provider?: string): Promise<UserInfo | null> {
    const p = provider ?? 'google'
    const url = `${API_BASE}/api/auth/${p}`
    const w = 500, h = 600
    const left = window.screenX + (window.innerWidth - w) / 2
    const top = window.screenY + (window.innerHeight - h) / 2
    const popup = window.open(url, 'wheee-auth', `width=${w},height=${h},left=${left},top=${top}`)

    return new Promise<UserInfo | null>((resolve, reject) => {
      const site = location.hostname.split('.').slice(-2).join('.')
      let settled = false
      let poll: ReturnType<typeof setInterval> | undefined
      let timeout: ReturnType<typeof setTimeout> | undefined

      const finish = (u: UserInfo | null) => {
        if (settled) return
        settled = true
        clearInterval(poll)
        clearTimeout(timeout)
        window.removeEventListener('message', onMessage)
        popup?.close()
        resolve(u)
      }

      // Settle-once failure path, mirroring `finish`'s cleanup — used only for
      // the two cases below that are genuine failures, never for a cancel.
      const fail = (err: unknown) => {
        if (settled) return
        settled = true
        clearInterval(poll)
        clearTimeout(timeout)
        window.removeEventListener('message', onMessage)
        popup?.close()
        reject(err)
      }

      const onMessage = (e: MessageEvent) => {
        try { if (!new URL(e.origin).hostname.endsWith(site)) return } catch { return }
        if (e.data?.type !== 'auth:done') return
        user = e.data.user as UserInfo
        for (const cb of authCallbacks) cb()
        finish(user)
      }
      window.addEventListener('message', onMessage)

      if (!popup) {
        // window.open was refused outright (popup blocker) — the player never
        // got a chance to attempt sign-in. A failure, not a cancel.
        fail(new Error('Sign-in popup was blocked'))
        return
      }

      poll = setInterval(async () => {
        if (popup.closed) {
          if (!user) {
            try {
              const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' })
              if (res.ok) {
                const data = await res.json() as { user: UserInfo | null }
                if (data.user) {
                  user = data.user
                  for (const cb of authCallbacks) cb()
                }
              }
              // A non-ok status here is not a failure: /api/auth/me always
              // answers 200 with { user: null } for a missing/invalid session,
              // which is the normal reply for a player who cancelled.
            } catch (err) {
              // The popup closed, but we couldn't even ask our own server
              // whether sign-in succeeded (network/CSP failure) — distinct
              // from a cancel, where the server is reachable and just says no.
              fail(err)
              return
            }
          }
          finish(user)
        }
      }, 500)

      timeout = setTimeout(() => finish(user), 5 * 60_000)
    })
  }

  async logout(): Promise<void> {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' })
    } catch { /* ignore */ }
    user = null
    for (const cb of authCallbacks) cb()
  }

  getAuthToken(): string | null {
    return null
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
    return (typeof navigator !== 'undefined' && navigator.language)
      ? navigator.language.slice(0, 2)
      : 'en'
  }
}

export function onWebAuthChange(cb: () => void): () => void {
  authCallbacks.add(cb)
  return () => authCallbacks.delete(cb)
}

export function getWebUser(): UserInfo | null {
  return user
}

export function setWebUser(u: UserInfo | null) {
  user = u
}
