import type { UserInfo } from '@wheee/shared'
import type { PlatformAdapter } from './types'
import { API_BASE } from '../config'

let user: UserInfo | null = null
const authCallbacks = new Set<() => void>()

export default class WebAdapter implements PlatformAdapter {
  readonly type = 'web' as const

  async init(): Promise<void> {
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

    return new Promise<UserInfo | null>((resolve) => {
      const site = location.hostname.split('.').slice(-2).join('.')
      let settled = false
      const finish = (u: UserInfo | null) => {
        if (settled) return
        settled = true
        clearInterval(poll)
        clearTimeout(timeout)
        window.removeEventListener('message', onMessage)
        popup?.close()
        resolve(u)
      }

      const onMessage = (e: MessageEvent) => {
        try { if (!new URL(e.origin).hostname.endsWith(site)) return } catch { return }
        if (e.data?.type !== 'auth:done') return
        user = e.data.user as UserInfo
        for (const cb of authCallbacks) cb()
        finish(user)
      }
      window.addEventListener('message', onMessage)

      const poll = setInterval(async () => {
        if (!popup || popup.closed) {
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
            } catch { /* ignore */ }
          }
          finish(user)
        }
      }, 500)

      const timeout = setTimeout(() => finish(user), 5 * 60_000)
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
