import { ref, readonly } from 'vue'
import type { UserInfo } from '@wheee/shared'
import { usePlatform } from '../lib/platform'

const user = ref<UserInfo | null>(null)
const loading = ref(false)
const authError = ref(false)
const authCallbacks = new Set<() => void>()

let fetchMePromise: Promise<void> | null = null

export function getAuthToken(): string | null {
  try { return usePlatform().getAuthToken() } catch { return null }
}

export function useAuth() {
  const platform = usePlatform()

  async function fetchMe() {
    if (fetchMePromise) return fetchMePromise
    loading.value = true
    fetchMePromise = (async () => {
      try {
        user.value = await platform.getUser()
      } catch { /* keep user null */ }
      loading.value = false
    })()
    return fetchMePromise
  }

  function onAuthChange(cb: () => void) {
    authCallbacks.add(cb)
    return () => authCallbacks.delete(cb)
  }

  async function login(provider?: string) {
    loading.value = true
    authError.value = false
    try {
      const u = await platform.login(provider)
      if (u) {
        user.value = u
        for (const cb of authCallbacks) cb()
      }
    } catch {
      // No caller awaits login(), so without this the failure is an unhandled
      // rejection and the Sign In button simply looks dead. A null return above
      // is a closed popup, not a failure — it deliberately does not land here.
      authError.value = true
    } finally {
      loading.value = false
    }
  }

  async function logout() {
    await platform.logout()
    user.value = null
    fetchMePromise = null
    for (const cb of authCallbacks) cb()
  }

  return {
    user: readonly(user),
    loading: readonly(loading),
    authError: readonly(authError),
    platformType: platform.type,
    fetchMe,
    login,
    logout,
    onAuthChange,
  }
}
