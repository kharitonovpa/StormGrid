import { badgeFor } from '@wheee/shared'

/** What the game-over card shows under the cause line. */
export type MatchStats = {
  round: number
  durationMs: number
  /** Badge streak after the result is settled; 0 = no chip. */
  streak: number
  /** Points this match paid, when the server said. */
  earned?: number
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function streakChip(streak: number): string {
  const badge = badgeFor(streak)
  return badge ? `${badge} ${streak}` : ''
}
