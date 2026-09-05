/**
 * Nameplate points total: `1 240`, with a THIN SPACE (U+2009) between
 * thousands groups. The star in front is drawn as a shape by the nameplate
 * renderer (see lib/star.ts), not typed, so it matches the HUD everywhere.
 * Empty for unknown, zero or negative totals so the plate shows nothing
 * rather than a "0".
 */
export function formatPoints(points?: number): string {
  if (points === undefined || !Number.isFinite(points) || points < 1) return ''
  const digits = String(Math.floor(points))
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}
