/**
 * Single source of truth for "how much top/bottom/left/right chrome sits over the
 * viewport edges right now". Every top- or bottom-anchored element in the client
 * reads these as CSS custom properties — `var(--sg-safe-top, 0px)` etc — instead of
 * checking the platform directly, so components stay platform-agnostic.
 *
 * style.css seeds the vars from `env(safe-area-inset-*)` (iOS notches) on `:root`,
 * which is already correct for web/yandex/gamepush and desktop (0 everywhere there
 * is no notch). Platforms with extra chrome the OS doesn't know about — namely
 * Telegram's in-app header — call `setSafeAreaInset` to override the relevant
 * sides with an inline style on the root element, which wins over the stylesheet
 * rule for that element.
 */

export interface SafeAreaInsets {
  top?: number
  bottom?: number
  left?: number
  right?: number
}

const PROPERTY: Record<keyof SafeAreaInsets, string> = {
  top: '--sg-safe-top',
  bottom: '--sg-safe-bottom',
  left: '--sg-safe-left',
  right: '--sg-safe-right',
}

export function setSafeAreaInset(insets: SafeAreaInsets): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement.style
  for (const side of Object.keys(PROPERTY) as (keyof SafeAreaInsets)[]) {
    const value = insets[side]
    if (value === undefined || Number.isNaN(value)) continue
    root.setProperty(PROPERTY[side], `${Math.max(0, value)}px`)
  }
}
