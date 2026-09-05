/**
 * Nameplate points: `★ 1 240` — a star, then the total with a THIN SPACE
 * (U+2009) between thousands groups. Empty for unknown, zero or negative totals
 * so the plate shows nothing rather than a "★ 0".
 */
export function formatPoints(points?: number): string {
  if (points === undefined || !Number.isFinite(points) || points < 1) return ''
  const digits = String(Math.floor(points))
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `★ ${grouped}`
}
