import type { CharacterType } from '@wheee/shared'

/**
 * Small decorative parameters keyed by crop, giving each one a subtle
 * region-flavored identity (rice ~ Asia, wheat ~ Europe, corn ~ Americas)
 * across the arena, result screen, and (later) music — without touching
 * gameplay. Deliberately excludes wind/rain/lightning colors: those carry
 * functional signal and stay universal (see the design spec's Non-goals).
 */
export interface CropTheme {
  /** Small linear-RGB delta added to the terrain palette (paintColors) — the palette is linear, so keep these around 10% of the grass channels. */
  paletteAccent: readonly [number, number, number]
  /** Per-channel multiplier on the calm-sky gradient (lib/look.ts); [1, 1, 1] leaves it untouched. */
  skyTint: readonly [number, number, number]
  /** CSS color for the result-screen accent border. */
  resultAccent: string
}

export const CROP_THEME: Record<CharacterType, CropTheme> = {
  // wheat leaves the sky at its dusk base and warms the field a touch; rice
  // cools both, corn warms both — the same whisper in every layer.
  wheat: { paletteAccent: [0.012, 0.006, -0.006], skyTint: [1, 1, 1], resultAccent: 'rgba(210, 180, 90, 0.55)' },
  rice: { paletteAccent: [-0.006, 0.003, 0.012], skyTint: [0.94, 0.98, 1.08], resultAccent: 'rgba(220, 70, 70, 0.5)' },
  corn: { paletteAccent: [0.016, 0.010, -0.010], skyTint: [1.10, 0.98, 0.90], resultAccent: 'rgba(230, 160, 40, 0.55)' },
}
