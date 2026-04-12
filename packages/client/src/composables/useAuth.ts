import { ref, readonly } from 'vue'
import type { UserInfo } from '@wheee/shared'
import { API_BASE, IS_TELEGRAM } from '../lib/config'

const user = ref<UserInfo | null>(null)
const loading = ref(false)
const authCallbacks = new Set<() => void>()

let initialized = false
let telegramToken: string | null = null
let _authReadyResolve: (() => void) | null = null
const _authReady = new Promise<void>(r => { _authReadyResolve = r })

/** Returns the bearer token for environments where cookies are unavailable (Telegram WebView). */
export function getAuthToken(): string | null {
  return telegramToken
}

/**
 * Resolves once the initial auth check is complete (TG login or cookie /me).
 * In non-TG mode resolves immediately — cookies handle WS auth.
 */
export function authReady(): Promise<void> {
  return IS_TELEGRAM ? _authReady : Promise.resolve()
}

export function useAuth() {
  async function fetchMe() {
    if (initialized) return
    loading.value = true
    try {
      if (IS_TELEGRAM) {
        const ok = await loginTelegramWithRetry()
        if (ok) initialized = true
      } else {
        const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' })
        if (res.ok) {
          const data = await res.json() as { user: UserInfo | null }
          user.value = data.user
        }
        initialized = true
      }
    } catch {
      if (!IS_TELEGRAM) initialized = true
    } finally {
      loading.value = false
      _authReadyResolve?.()
      _authReadyResolve = null
    }
  }

  async function loginTelegramWithRetry(maxAttempts = 3): Promise<boolean> {
    const initData = window.Telegram!.WebApp!.initData as string
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * attempt))
      try {
        const res = await fetch(`${API_BASE}/api/auth/telegram`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData }),
        })
        if (!res.ok) continue
        const data = await res.json() as { token: string; user: UserInfo }
        telegramToken = data.token
        user.value = data.user
        for (const cb of authCallbacks) cb()
        return true
      } catch { /* retry */ }
    }
    return false
  }

  function onAuthChange(cb: () => void) {
    authCallbacks.add(cb)
    return () => authCallbacks.delete(cb)
  }

  function login(provider: 'google' | 'github') {
    const url = `${API_BASE}/api/auth/${provider}`
    const w = 500
    const h = 600
    const left = window.screenX + (window.innerWidth - w) / 2
    const top = window.screenY + (window.innerHeight - h) / 2
    const popup = window.open(url, 'wheee-auth', `width=${w},height=${h},left=${left},top=${top}`)

    const expectedOrigin = new URL(API_BASE).origin
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== expectedOrigin) return
      if (e.data?.type !== 'auth:done') return
      user.value = e.data.user as UserInfo
      window.removeEventListener('message', onMessage)
      popup?.close()
      for (const cb of authCallbacks) cb()
    }
    window.addEventListener('message', onMessage)
  }

  async function logout() {
    if (IS_TELEGRAM) return
    try {
      await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' })
    } catch { /* ignore */ }
    user.value = null
    telegramToken = null
    initialized = false
    for (const cb of authCallbacks) cb()
  }

  return {
    user: readonly(user),
    loading: readonly(loading),
    isTelegram: IS_TELEGRAM,
    fetchMe,
    login,
    logout,
    onAuthChange,
  }
}
