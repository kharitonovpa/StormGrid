import type { PlatformType } from './platform/types'
import { getDiscordCustomId } from './platform/discordBridge'

/**
 * Challenge links. The code travels either as `?join=CODE` on the web build or
 * as Telegram's `startapp` parameter, which the client receives back as
 * `start_param` / `tgWebAppStartParam` — or, inside Discord, as shareLink's
 * `custom_id`, which round-trips as `discordSdk.customId`.
 */

const CODE_RE = /^[a-zA-Z0-9]{4,12}$/

/**
 * Discord attaches its own service custom_id to launches from the game cards
 * it auto-posts in chat, so the discord source only counts when the value has
 * the exact shape of a server-generated invite code (6 chars, A-Z minus I/O,
 * digits 2-9 — see CODE_ALPHABET in server matchmaking).
 */
const SERVER_CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/i

/** Direct Mini App link; overridable per build via VITE_TG_APP_URL. */
const TG_APP_URL: string = import.meta.env.VITE_TG_APP_URL || 'https://t.me/wheee_game_bot/play'

export function getIncomingInviteCode(): string | null {
  const fromQuery = new URLSearchParams(location.search).get('join')
    ?? new URLSearchParams(location.search).get('tgWebAppStartParam')
  const fromTelegram = window.Telegram?.WebApp?.initDataUnsafe?.start_param
  const rawDiscord = getDiscordCustomId()
  const fromDiscord = rawDiscord && SERVER_CODE_RE.test(rawDiscord) ? rawDiscord : null
  const raw = fromDiscord || fromTelegram || fromQuery
  if (!raw || !CODE_RE.test(raw)) return null
  return raw.toUpperCase()
}

/** Drop `?join=` from the address bar so a reload does not re-trigger the invite. */
export function clearInviteFromUrl(): void {
  if (!location.search.includes('join=')) return
  const url = new URL(location.href)
  url.searchParams.delete('join')
  history.replaceState(null, '', url.pathname + url.search + url.hash)
}

export function buildInviteUrl(code: string, platform: PlatformType): string {
  if (platform === 'telegram') {
    return `${TG_APP_URL}?startapp=${code}`
  }
  // On the web the current origin is the right one: ru.wheee.io players should
  // hand out ru.wheee.io links.
  return `${location.origin}${location.pathname}?join=${code}`
}

/**
 * Hand the link to the platform's own share affordance where there is one;
 * returns false when the caller should fall back to copying.
 */
export function shareInvite(url: string, text: string): boolean {
  const wa = window.Telegram?.WebApp
  if (wa?.openTelegramLink) {
    wa.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`)
    return true
  }
  if (navigator.share) {
    navigator.share({ url, text }).catch(() => { /* user closed the sheet */ })
    return true
  }
  return false
}

export async function copyInvite(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url)
    return true
  } catch {
    return false
  }
}
