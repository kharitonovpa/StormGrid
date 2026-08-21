import type { DeathCause, GameState, PlayerId } from '@wheee/shared'
import { BOARD_SIZE, CROWN_HEIGHT } from '@wheee/shared'

export type LightningResult = {
  deaths: PlayerId[]
  deathCauses: Partial<Record<PlayerId, DeathCause>>
  /** Where the bolt landed on each side: the player's cell on a kill, the absorbing rod otherwise. */
  boltCell: Record<PlayerId, { x: number; y: number } | null>
  /** Player the bolt passed over because the other crown stood taller. */
  spared: PlayerId | null
}

type Judgement = {
  exposed: boolean
  crown: number
  maxOtherHeight: number
  bolt: { x: number; y: number }
}

/**
 * Lightning resolution — the bolt takes the highest point of each side.
 *
 * A standing character pokes CROWN_HEIGHT above their cell. Any cell strictly
 * higher than that crown, anywhere on the side, is a lightning rod: the bolt
 * dives into it and the player lives. No higher point means the player IS the
 * highest point — exposed. The rule is relative, so a uniformly lowered board
 * is exactly as deadly as a flat one.
 *
 * When both players stand exposed, the bolt kills the one whose crown protrudes
 * furthest above everything else on their side. Margin = crown − max(other cells).
 * The player with the larger margin dies; the other is spared. Equal margins both die.
 * This keeps the rule side-relative: uniform board shifts change no outcome.
 */
export function resolveLightning(state: GameState): LightningResult {
  const judged: Partial<Record<PlayerId, Judgement>> = {}
  for (const pid of ['A', 'B'] as PlayerId[]) {
    if (state.players[pid].alive) judged[pid] = judge(state, pid)
  }

  let spared: PlayerId | null = null
  const a = judged.A
  const b = judged.B
  if (a?.exposed && b?.exposed) {
    const aMargin = a.crown - a.maxOtherHeight
    const bMargin = b.crown - b.maxOtherHeight
    if (aMargin !== bMargin) {
      spared = aMargin > bMargin ? 'B' : 'A'
      judged[spared]!.exposed = false
    }
  }

  const deaths: PlayerId[] = []
  const deathCauses: Partial<Record<PlayerId, DeathCause>> = {}
  const boltCell: Record<PlayerId, { x: number; y: number } | null> = { A: null, B: null }

  for (const pid of ['A', 'B'] as PlayerId[]) {
    const j = judged[pid]
    if (!j) continue
    if (pid === spared) {
      boltCell[pid] = null
    } else {
      boltCell[pid] = j.bolt
    }
    if (j.exposed) {
      state.players[pid].alive = false
      deaths.push(pid)
      deathCauses[pid] = { type: 'lightning' }
    }
  }

  return { deaths, deathCauses, boltCell, spared }
}

/** One side's verdict: is the player the highest point, and where does the bolt go? */
function judge(state: GameState, pid: PlayerId): Judgement {
  const sign = pid === 'A' ? 1 : -1
  const h = (x: number, y: number) => state.board[y][x].height * sign
  const p = state.players[pid]
  const crown = h(p.x, p.y) + CROWN_HEIGHT

  let maxOtherHeight = -Infinity
  let rod: { x: number; y: number; h: number; dist: number } | null = null
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const hh = h(x, y)
      // Track max height of cells other than the player's cell
      if (x !== p.x || y !== p.y) {
        maxOtherHeight = Math.max(maxOtherHeight, hh)
      }
      if (hh <= crown) continue
      const dist = Math.max(Math.abs(x - p.x), Math.abs(y - p.y))
      if (
        rod === null
        || hh > rod.h
        || (hh === rod.h && dist < rod.dist)
        || (hh === rod.h && dist === rod.dist && (y < rod.y || (y === rod.y && x < rod.x)))
      ) {
        rod = { x, y, h: hh, dist }
      }
    }
  }

  return rod
    ? { exposed: false, crown, maxOtherHeight, bolt: { x: rod.x, y: rod.y } }
    : { exposed: true, crown, maxOtherHeight, bolt: { x: p.x, y: p.y } }
}
