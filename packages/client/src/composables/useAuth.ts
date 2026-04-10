import { ref, readonly } from 'vue'
import type { UserInfo } from '@wheee/shared'
import { API_BASE } from '../lib/config'

const user = ref<UserInfo | null>(null)
const loading = ref(false)

let initialized = false

export function useAuth() {
  async function fetchMe() {
    if (initialized) return
    initialized = true
    loading.value = true
    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' })
      if (!res.ok) return
      const data = await res.json() as { user: UserInfo | null }
      user.value = data.user
    } catch {
      /* offline or server unavailable */
    } finally {
      loading.value = false
    }
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
    }
    window.addEventListener('message', onMessage)
  }

  async function logout() {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' })
    } catch { /* ignore */ }
    user.value = null
    initialized = false
  }

  return {
    user: readonly(user),
    loading: readonly(loading),
    fetchMe,
    login,
    logout,
  }
}
