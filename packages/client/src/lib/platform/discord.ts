import { DiscordSDK } from '@discord/embedded-app-sdk'
import type { UserInfo } from '@wheee/shared'
import type { PlatformAdapter } from './types'
import { createLocalStorage, createLocalSound, noSticky } from './defaults'
import { API_BASE } from '../config'
import { setSafeAreaInset } from './safeArea'
import { registerDiscordHandles } from './discordBridge'

/**
 * Layout modes from the SDK's ACTIVITY_LAYOUT_MODE_UPDATE event:
 * 0 = focused, 1 = picture-in-picture, 2 = grid, -1 = unhandled (future value).
 * (@discord/embedded-app-sdk output/schema/common.mjs LayoutModeTypeObject)
 */
const LAYOUT_FOCUSED = 0

function readSafeAreaVar(name: string): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name)
  const px = parseFloat(raw)
  return Number.isFinite(px) ? px : 0
}

function applyDiscordSafeArea(): void {
  setSafeAreaInset({
    top: readSafeAreaVar('--discord-safe-area-inset-top'),
    bottom: readSafeAreaVar('--discord-safe-area-inset-bottom'),
    left: readSafeAreaVar('--discord-safe-area-inset-left'),
    right: readSafeAreaVar('--discord-safe-area-inset-right'),
  })
}

export default class DiscordAdapter implements PlatformAdapter {
  readonly type = 'discord' as const
  readonly hostId = null
  readonly storage = createLocalStorage()
  readonly sound = createLocalSound()

  private sdk: DiscordSDK | null = null
  private user: UserInfo | null = null
  private token: string | null = null
  private locale = 'en'
  private participantCount = 0
  private participantCbs = new Set<(count: number) => void>()
  private pauseCbs = new Set<() => void>()
  private resumeCbs = new Set<() => void>()

  canAuth(): boolean { return true }
  canShowLeaderboard(): boolean { return true }
  /** External links are hidden inside the activity sandbox (openExternalLink is a later feature). */
  canLinkOut(): boolean { return false }

  showSticky = noSticky.showSticky
  closeSticky = noSticky.closeSticky
  onStickyChange = noSticky.onStickyChange

  async init(): Promise<void> {
    const clientId: string = import.meta.env.VITE_DISCORD_CLIENT_ID || ''
    if (!clientId) {
      console.warn('[discord] VITE_DISCORD_CLIENT_ID missing — running as anonymous web-like client')
      return
    }

    const sdk = new DiscordSDK(clientId)
    this.sdk = sdk
    await sdk.ready()

    // Desktop-only dialog; switching relaunches the Discord client, so ask
    // before anything heavy starts. Failures are non-fatal everywhere.
    await sdk.commands.encourageHardwareAcceleration().catch(() => {})

    try {
      const { locale } = await sdk.commands.userSettingsGetLocale()
      this.locale = locale.split('-')[0] || 'en'
    } catch { /* locale stays 'en' */ }

    applyDiscordSafeArea()

    // PIP/grid ≈ backgrounded: pause the heavy render like a hidden tab.
    // No dedicated "compat" subscribe helper exists in the SDK — subscribe to
    // the raw event directly (event name/payload verified against the
    // installed package's schema/events.mjs).
    sdk.subscribe('ACTIVITY_LAYOUT_MODE_UPDATE', ({ layout_mode }) => {
      const cbs = layout_mode === LAYOUT_FOCUSED ? this.resumeCbs : this.pauseCbs
      for (const cb of cbs) cb()
    }).catch(() => {})

    sdk.subscribe('ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE', ({ participants }) => {
      this.participantCount = participants.length
      for (const cb of this.participantCbs) cb(this.participantCount)
    }).catch(() => {})
    try {
      const { participants } = await sdk.commands.getInstanceConnectedParticipants()
      this.participantCount = participants.length
    } catch { /* count stays 0 — automatch simply won't trigger */ }

    await this.loginWithRetry()

    registerDiscordHandles({
      instanceCode: `dc-${sdk.instanceId}`.toUpperCase(),
      customId: sdk.customId ?? null,
      referrerId: sdk.referrerId ?? null,
      shareLink: async (code, message) => {
        try {
          const { success } = await sdk.commands.shareLink({ message, custom_id: code })
          return success
        } catch { return false }
      },
      onParticipantCount: (cb) => {
        this.participantCbs.add(cb)
        cb(this.participantCount)
        return () => this.participantCbs.delete(cb)
      },
    })
  }

  ready(): void { /* sdk.ready() already awaited in init */ }
  gameplayStart(): void { /* noop */ }
  gameplayStop(): void { /* noop */ }

  async getUser(): Promise<UserInfo | null> { return this.user }

  async login(): Promise<UserInfo | null> {
    if (!this.user) await this.loginWithRetry(1)
    return this.user
  }

  async logout(): Promise<void> { /* noop inside Discord */ }

  getAuthToken(): string | null { return this.token }

  isRewardedAvailable(): boolean { return false }
  async showPreloader(): Promise<boolean> { return false }
  async showInterstitial(): Promise<boolean> { return false }
  async showRewarded(): Promise<boolean> { return false }

  onPause(cb: () => void): () => void {
    this.pauseCbs.add(cb)
    const handler = () => { if (document.hidden) cb() }
    document.addEventListener('visibilitychange', handler)
    return () => {
      this.pauseCbs.delete(cb)
      document.removeEventListener('visibilitychange', handler)
    }
  }

  onResume(cb: () => void): () => void {
    this.resumeCbs.add(cb)
    const handler = () => { if (!document.hidden) cb() }
    document.addEventListener('visibilitychange', handler)
    return () => {
      this.resumeCbs.delete(cb)
      document.removeEventListener('visibilitychange', handler)
    }
  }

  getLanguage(): string { return this.locale }

  private async loginWithRetry(maxAttempts = 3): Promise<boolean> {
    const sdk = this.sdk
    if (!sdk) return false
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
      try {
        const { code } = await sdk.commands.authorize({
          client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
          response_type: 'code',
          state: '',
          prompt: 'none',
          scope: ['identify', 'applications.commands'],
        })
        const res = await fetch(`${API_BASE}/api/auth/discord`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        })
        if (!res.ok) continue
        const data = await res.json() as { token: string; user: UserInfo; access_token: string }
        this.token = data.token
        this.user = data.user
        await sdk.commands.authenticate({ access_token: data.access_token })
        return true
      } catch { /* retry */ }
    }
    console.warn('[discord] Auth failed after', maxAttempts, 'attempts — running as anonymous')
    return false
  }
}
