import type { PlatformType } from './platform/types'

/**
 * What the game calls itself, per platform and language.
 *
 * The brand is `wheee`, and that is what wheee.io, Telegram, itch and Discord
 * show. Yandex Games moderation rejected the bare word under rule 8.2.1 ("no
 * such word"), and after the catalog name was changed to a full title, rule
 * 5.1.3 demands the game itself display the same title in each language. So
 * the portal builds (Yandex, and GamePush, which feeds Yandex) carry the full
 * catalog title; everything else stays `wheee`.
 */
export interface GameTitle {
  /** Large line of the lobby heading. */
  name: string
  /** Second line under the heading; `null` means show a tagline instead. */
  subtitle: string | null
  /** The complete title as the catalog spells it — for `document.title`. */
  full: string
}

const BRAND = 'wheee'

const PORTAL_TITLES: Record<string, { name: string; subtitle: string }> = {
  en: { name: 'Wheee!', subtitle: 'Storm Tactics' },
  ru: { name: 'Wheee!', subtitle: 'Штормовая тактика' },
}

export function usesCatalogTitle(platform: PlatformType | string): boolean {
  return platform === 'yandex' || platform === 'gamepush'
}

export function gameTitle(platform: PlatformType | string, lang: string): GameTitle {
  if (!usesCatalogTitle(platform)) return { name: BRAND, subtitle: null, full: BRAND }
  const t = PORTAL_TITLES[lang] ?? PORTAL_TITLES.en
  return { name: t.name, subtitle: t.subtitle, full: `${t.name} ${t.subtitle}` }
}
