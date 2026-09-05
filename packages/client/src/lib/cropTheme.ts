import type { CharacterType } from '@wheee/shared'

/**
 * Small decorative parameters keyed by crop, giving each one a subtle
 * region-flavored identity (rice ~ Asia, wheat ~ Europe, corn ~ Americas)
 * across the arena, result screen, and (later) music — without touching
 * gameplay. Deliberately excludes wind/rain/lightning colors: those carry
 * functional signal and stay universal (see the design spec's Non-goals).
 */
export interface CropTheme {
  /** Small linear-RGB delta added to the terrain palette (paintColors) — the palette is linear, so these are a few percent of the (linear) grass channels; keep them small. */
  paletteAccent: readonly [number, number, number]
  /** Per-channel multiplier on the calm-sky gradient (lib/look.ts); [1, 1, 1] leaves it untouched. */
  skyTint: readonly [number, number, number]
  /** CSS color for the result-screen accent border. */
  resultAccent: string
  /**
   * sRGB hex of the crop's identity colour — the local player's ring, arrow and
   * cell highlight, the opponent's butterfly wings, the winner's confetti and
   * the lobby card accent all read this one value. Taken from the butterflies'
   * jewel palette (topaz / aquamarine / amethyst): spread around the hue circle
   * and chosen to read over grass, which the crops' "natural" colours are not.
   */
  identity: number
}

export const CROP_THEME: Record<CharacterType, CropTheme> = {
  // wheat leaves the sky at its dusk base and warms the field a touch; rice
  // cools both, corn warms both — the same whisper in every layer. The sky
  // tints are wide enough for the crop identity to survive AgX's compression.
  wheat: { paletteAccent: [0.012, 0.006, -0.006], skyTint: [1, 1, 1], resultAccent: 'rgba(210, 180, 90, 0.55)', identity: 0xf0940f },
  rice: { paletteAccent: [-0.006, 0.003, 0.012], skyTint: [0.90, 0.96, 1.14], resultAccent: 'rgba(220, 70, 70, 0.5)', identity: 0x16a8d2 },
  corn: { paletteAccent: [0.016, 0.010, -0.010], skyTint: [1.14, 0.96, 0.86], resultAccent: 'rgba(230, 160, 40, 0.55)', identity: 0xb23bd6 },
}

/** `0xf0940f` → `'#f0940f'`. */
export function hexToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`
}

/** `0xf0940f, 0.35` → `'rgba(240, 148, 15, 0.35)'`. */
export function hexToRgba(hex: number, alpha: number): string {
  const r = (hex >> 16) & 0xff
  const g = (hex >> 8) & 0xff
  const b = hex & 0xff
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Mix a colour toward white by `t` (0 = unchanged, 1 = white), per channel, rounded. */
export function lightenHex(hex: number, t: number): number {
  const mix = (c: number) => Math.round(c + (255 - c) * t)
  const r = mix((hex >> 16) & 0xff)
  const g = mix((hex >> 8) & 0xff)
  const b = mix(hex & 0xff)
  return (r << 16) | (g << 8) | b
}

/** HSL hue of a colour in degrees, in [0, 360); greys report 0. */
export function hexHue(hex: number): number {
  const r = ((hex >> 16) & 0xff) / 255
  const g = ((hex >> 8) & 0xff) / 255
  const b = (hex & 0xff) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return 0
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h *= 60
  return h < 0 ? h + 360 : h
}
