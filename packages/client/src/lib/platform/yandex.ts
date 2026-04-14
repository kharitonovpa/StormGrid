import type { UserInfo } from '@wheee/shared'
import type { PlatformAdapter } from './types'
import { API_BASE } from '../config'

const AD_TIMEOUT_MS = 15_000

let ysdk: YandexGamesSDK | null = null
let user: UserInfo | null = null
let token: string | null = null
const pauseCbs = new Set<() => void>()
const resumeCbs = new Set<() => void>()

async function authenticateWithServer(player: YandexGamesPlayer, signature?: string): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/yandex`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uniqueId: player.getUniqueID(),
        name: player.getName() || 'Player',
        avatar: player.getPhoto('medium') || null,
        signature: signature ?? undefined,
      }),
    })
    if (!res.ok) return
    const data = await res.json() as { token: string; user: UserInfo }
    token = data.token
    user = data.user
  } catch { /* server unreachable — continue as anonymous */ }
}

export default class YandexAdapter implements PlatformAdapter {
  readonly type = 'yandex' as const

  async init(): Promise<void> {
    if (typeof YaGames === 'undefined') {
      throw new Error('Yandex Games SDK not loaded')
    }
    ysdk = await YaGames.init()
    ysdk.on('game_api_pause', () => { for (const cb of pauseCbs) cb() })
    ysdk.on('game_api_resume', () => { for (const cb of resumeCbs) cb() })

    try {
      const player = await ysdk.getPlayer({ signed: true })
      if (player.isAuthorized()) {
        await authenticateWithServer(player, player.signature)
      }
    } catch { /* anonymous */ }
  }

  ready(): void {
    ysdk?.features.LoadingAPI?.ready()
  }

  gameplayStart(): void {
    ysdk?.features.GameplayAPI?.start()
  }

  gameplayStop(): void {
    ysdk?.features.GameplayAPI?.stop()
  }

  async getUser(): Promise<UserInfo | null> {
    return user
  }

  async login(): Promise<UserInfo | null> {
    if (!ysdk) return null
    try {
      await ysdk.auth.openAuthDialog()
      const player = await ysdk.getPlayer({ signed: true })
      if (player.isAuthorized()) {
        await authenticateWithServer(player, player.signature)
      }
    } catch { /* user cancelled */ }
    return user
  }

  async logout(): Promise<void> { /* no logout on Yandex */ }

  getAuthToken(): string | null {
    return token
  }

  async showInterstitial(): Promise<boolean> {
    if (!ysdk) return false
    const sdk = ysdk
    return new Promise((resolve) => {
      let settled = false
      const done = (v: boolean) => { if (!settled) { settled = true; resolve(v) } }
      const timer = setTimeout(() => done(false), AD_TIMEOUT_MS)
      sdk.adv.showFullscreenAdv({
        callbacks: {
          onOpen: () => { for (const cb of pauseCbs) cb() },
          onClose: () => { clearTimeout(timer); for (const cb of resumeCbs) cb(); done(true) },
          onError: () => { clearTimeout(timer); done(false) },
        },
      })
    })
  }

  async showRewarded(): Promise<boolean> {
    if (!ysdk) return false
    const sdk = ysdk
    return new Promise((resolve) => {
      let rewarded = false
      let settled = false
      const done = (v: boolean) => { if (!settled) { settled = true; resolve(v) } }
      const timer = setTimeout(() => done(false), AD_TIMEOUT_MS)
      sdk.adv.showRewardedVideo({
        callbacks: {
          onOpen: () => { for (const cb of pauseCbs) cb() },
          onRewarded: () => { rewarded = true },
          onClose: () => { clearTimeout(timer); for (const cb of resumeCbs) cb(); done(rewarded) },
          onError: () => { clearTimeout(timer); done(false) },
        },
      })
    })
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
    return ysdk?.environment.i18n.lang ?? 'en'
  }
}
