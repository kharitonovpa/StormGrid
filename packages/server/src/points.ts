/**
 * What a finished match is worth to one player. Points only ever go up: the
 * number is a reason to come back, not a rating. See the design spec for why
 * a draw beats a loss and a leaver gets nothing.
 */
export type PointsInput = {
  result: 'win' | 'draw' | 'loss'
  /** Round the match ended in, 1-based. */
  rounds: number
  vsBot: boolean
  /** Lost by dropping/leaving — the server cannot tell those apart. */
  ownDisconnect: boolean
  /** Picked up the crate this match. */
  crate: boolean
}

const RESULT_POINTS: Record<PointsInput['result'], number> = { win: 10, draw: 3, loss: 1 }
const ROUND_POINTS = 2
const CRATE_POINTS = 2

export function pointsFor(i: PointsInput): number {
  if (i.ownDisconnect) return 0
  let sum = RESULT_POINTS[i.result] + ROUND_POINTS * Math.max(0, i.rounds - 1) + (i.crate ? CRATE_POINTS : 0)
  if (i.vsBot) sum = Math.ceil(sum / 2)
  return sum
}
