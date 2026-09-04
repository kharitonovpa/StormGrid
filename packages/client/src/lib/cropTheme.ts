import type { CharacterType } from '@wheee/shared'

/**
 * Small decorative parameters keyed by crop, giving each one a subtle
 * region-flavored identity (rice ~ Asia, wheat ~ Europe, corn ~ Americas)
 * across the arena, result screen, and (later) music — without touching
 * gameplay. Deliberately excludes wind/rain/lightning colors: those carry
 * functional signal and stay universal (see the design spec's Non-goals).
 */
export interface CropTheme {
  /** Small RGB delta blended into the terrain palette (paintColors), each channel roughly -0.1..0.1. */
  paletteAccent: readonly [number, number, number]
  /** Calm-sky base color for the storm system's resting state, 0xRRGGBB. */
  skyTint: number
  /** CSS color for the result-screen accent border. */
  resultAccent: string
}

export const CROP_THEME: Record<CharacterType, CropTheme> = {
  // wheat's skyTint matches today's BASE (packages/client/src/lib/storm.ts)
  // exactly, so the default crop's sky is unchanged. Its paletteAccent, like
  // the other two, adds a small warm shift to the terrain on top of that.
  wheat: { paletteAccent: [0.05, 0.02, -0.03], skyTint: 0x0a0e14, resultAccent: 'rgba(210, 180, 90, 0.55)' },
  rice: { paletteAccent: [-0.02, 0.01, 0.04], skyTint: 0x0a1018, resultAccent: 'rgba(220, 70, 70, 0.5)' },
  corn: { paletteAccent: [0.06, 0.04, -0.04], skyTint: 0x120e0a, resultAccent: 'rgba(230, 160, 40, 0.55)' },
}
