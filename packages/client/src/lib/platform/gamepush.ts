import type { UserInfo } from '@wheee/shared'
import type { PlatformAdapter } from './types'

const AD_TIMEOUT_MS = 15_000

let gp: GamePushInstance | null = null
let user: UserInfo | null = null
const pauseCbs = new Set<() => void>()
const resumeCbs = new Set<() => void>()

function extractUser(): UserInfo | null {
  if (!gp || !gp.player.isLoggedIn) return null
  return {
    id: String(gp.player.id),
    name: gp.player.name || 'Player',
    avatar: gp.player.avatar || null,
  }
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
    user = extractUser()

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
      const onLogin = (success: boolean) => {
        gp!.player.off('login', onLogin)
        if (success) user = extractUser()
        resolve(user)
      }
      gp!.player.on('login', onLogin)
      gp!.player.login()
    })
  }

  async logout(): Promise<void> {
    if (!gp || !gp.platform.isLogoutAvailable) return
    return new Promise<void>((resolve) => {
      const onLogout = () => {
        gp!.player.off('logout', onLogout)
        user = null
        resolve()
      }
      gp!.player.on('logout', onLogout)
      gp!.player.logout()
    })
  }

  getAuthToken(): string | null {
    return null
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
