import type { UserInfo } from '@wheee/shared'
import type { PlatformAdapter } from './types'
import { API_BASE } from '../config'

const AD_TIMEOUT_MS = 15_000
const AUTH_TIMEOUT_MS = 30_000

let gp: GamePushInstance | null = null
let user: UserInfo | null = null
let token: string | null = null
const pauseCbs = new Set<() => void>()
const resumeCbs = new Set<() => void>()

async function authenticateWithServer(): Promise<void> {
  if (!gp || !gp.player.isLoggedIn) return
  try {
    const res = await fetch(`${API_BASE}/api/auth/gamepush`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: gp.player.id,
        name: gp.player.name || 'Player',
        avatar: gp.player.avatar || null,
      }),
    })
    if (!res.ok) return
    const data = await res.json() as { token: string; user: UserInfo }
    token = data.token
    user = data.user
  } catch { /* server unreachable — continue as anonymous */ }
}

export default class GamePushAdapter implements PlatformAdapter {
  readonly type = 'gamepush' as const

  async init(): Promise<void> {
    if (gp) return

    gp = await new Promise<GamePushInstance>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('GamePush SDK initialization timeout')),
        10_000,
      )
      window.onGPInit = (instance) => {
        clearTimeout(timeout)
        resolve(instance)
      }
    })

    await gp.player.ready

    if (gp.player.isLoggedIn) {
      await authenticateWithServer()
    }

    gp.ads.on('start', () => { for (const cb of pauseCbs) cb() })
    gp.ads.on('close', () => { for (const cb of resumeCbs) cb() })
  }

  ready(): void { /* GP handles loading state internally */ }

  gameplayStart(): void { /* noop */ }
  gameplayStop(): void { /* noop */ }

  async getUser(): Promise<UserInfo | null> {
    return user
  }

  async login(): Promise<UserInfo | null> {
    if (!gp) return null
    return new Promise<UserInfo | null>((resolve) => {
      let settled = false
      const finish = (u: UserInfo | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        gp!.player.off('login', onLogin)
        resolve(u)
      }
      const onLogin = async (success: boolean) => {
        if (success) await authenticateWithServer()
        finish(user)
      }
      const timer = setTimeout(() => finish(user), AUTH_TIMEOUT_MS)
      gp!.player.on('login', onLogin)
      gp!.player.login()
    })
  }

  async logout(): Promise<void> {
    if (!gp || !gp.platform.isLogoutAvailable) return
    return new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        gp!.player.off('logout', onLogout)
        user = null
        token = null
        resolve()
      }
      const onLogout = () => finish()
      const timer = setTimeout(finish, AUTH_TIMEOUT_MS)
      gp!.player.on('logout', onLogout)
      gp!.player.logout()
    })
  }

  getAuthToken(): string | null {
    return token
  }

  async showInterstitial(): Promise<boolean> {
    if (!gp) return false
    return Promise.race([
      gp.ads.showFullscreen(),
      new Promise<boolean>((r) => setTimeout(() => r(false), AD_TIMEOUT_MS)),
    ])
  }

  async showRewarded(): Promise<boolean> {
    if (!gp) return false
    return Promise.race([
      gp.ads.showRewardedVideo(),
      new Promise<boolean>((r) => setTimeout(() => r(false), AD_TIMEOUT_MS)),
    ])
  }

  onPause(cb: () => void): () => void {
    pauseCbs.add(cb)
    const handler = () => { if (document.hidden) cb() }
    document.addEventListener('visibilitychange', handler)
    return () => {
      pauseCbs.delete(cb)
      document.removeEventListener('visibilitychange', handler)
    }
  }

  onResume(cb: () => void): () => void {
    resumeCbs.add(cb)
    const handler = () => { if (!document.hidden) cb() }
    document.addEventListener('visibilitychange', handler)
    return () => {
      resumeCbs.delete(cb)
      document.removeEventListener('visibilitychange', handler)
    }
  }

  getLanguage(): string {
    return gp?.language ?? 'en'
  }
}
