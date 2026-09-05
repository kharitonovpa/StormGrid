import type { WindDir } from '@wheee/shared'

/**
 * The one bearing convention for anything that points at where weather comes
 * from. The sky (lib/storm.ts) stands a mass on axis (sin az, cos az) — the
 * source; the gale's streams (lib/wind.ts) and the grass sheen (lib/sheen.ts)
 * travel the opposite way, across the board.
 */
export const DIR_AZIMUTH: Record<WindDir, number> = { N: 0, E: -Math.PI / 2, S: Math.PI, W: Math.PI / 2 }

/** Unit world x/z a gust from `azimuth` travels along: away from the source. */
export function gustDirection(azimuth: number): [number, number] {
  return [-Math.sin(azimuth), -Math.cos(azimuth)]
}
