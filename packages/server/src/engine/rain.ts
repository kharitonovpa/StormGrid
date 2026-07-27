import type { Cell, DeathCause, GameState, PlayerId, Height } from '@wheee/shared'
import { BOARD_SIZE } from '@wheee/shared'
import { inBounds } from './board.js'

export type RainResult = {
  deaths: PlayerId[]
  deathCauses: Partial<Record<PlayerId, DeathCause>>
  floodedCellsA: { x: number; y: number }[]
  floodedCellsB: { x: number; y: number }[]
  /** Player the water released because the other one went under first. */
  spared: PlayerId | null
  /** How much water came down, in cell-depths — see resolveRain. */
  waterVolume: number
}

type Basin = { x: number; y: number }[]

/**
 * Rain resolution — per-surface flooding.
 *
 * Each player experiences rain on THEIR side of the slab.
 * A uses canonical heights; B uses negated heights.
 * Basins and flooding are computed independently for each surface.
 *
 * Every basin fills at the same rate by volume, so a basin of N cells needs N
 * times as long to brim over as a single-cell puddle. `waterVolume` is how much
 * water came down before the storm broke off, measured in cell-depths: a basin
 * of N cells stands at min(1, waterVolume / N) of its depth. That is the whole
 * rule — the tighter hollow brims first, drowns its occupant, and the rain stops
 * right there, leaving every wider hollow unfinished. Equal volumes drown both.
 */
export function resolveRain(state: GameState): RainResult {
  const basinsA = findBasins(state.board, 1)
  const basinsB = findBasins(state.board, -1)

  const pA = state.players.A
  const pB = state.players.B
  const basinA = pA.alive ? basinUnder(basinsA, pA.x, pA.y) : null
  const basinB = pB.alive ? basinUnder(basinsB, pB.x, pB.y) : null

  let drownsA = basinA !== null
  let drownsB = basinB !== null
  let spared: PlayerId | null = null

  if (basinA && basinB && basinA.length !== basinB.length) {
    if (basinA.length < basinB.length) {
      drownsB = false
      spared = 'B'
    } else {
      drownsA = false
      spared = 'A'
    }
  }

  const deaths: PlayerId[] = []
  const deathCauses: Partial<Record<PlayerId, DeathCause>> = {}

  if (drownsA) {
    pA.alive = false
    deaths.push('A')
    deathCauses.A = { type: 'rain' }
  }

  if (drownsB) {
    pB.alive = false
    deaths.push('B')
    deathCauses.B = { type: 'rain' }
  }

  const drownedBasin = drownsA ? basinA! : drownsB ? basinB! : null
  const allBasins = [...basinsA, ...basinsB]

  return {
    deaths,
    deathCauses,
    floodedCellsA: basinsA.flat(),
    floodedCellsB: basinsB.flat(),
    spared,
    // Nobody drowned means the rain ran its course: enough water for the widest
    // hollow on the slab.
    waterVolume: drownedBasin
      ? drownedBasin.length
      : Math.max(1, ...allBasins.map(b => b.length)),
  }
}

/** The basin the player is standing in, or null if he is on safe ground. */
function basinUnder(basins: Basin[], x: number, y: number): Basin | null {
  return basins.find(b => b.some(c => c.x === x && c.y === y)) ?? null
}

/**
 * Find the basins of one surface. Every cell of a basin floods, since a basin
 * is a connected region of equal height with nowhere lower to drain to.
 * sign = 1 for A (canonical), sign = -1 for B (inverted).
 */
function findBasins(board: Cell[][], sign: number): Basin[] {
  const h = (x: number, y: number) => board[y][x].height * sign

  const visited: boolean[][] = Array.from({ length: BOARD_SIZE }, () =>
    Array(BOARD_SIZE).fill(false),
  )

  const basins: Basin[] = []

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (visited[y][x]) continue

      const component: Basin = []
      const height = h(x, y)
      const queue: { x: number; y: number }[] = [{ x, y }]
      let qi = 0
      visited[y][x] = true
      let isBasin = true

      while (qi < queue.length) {
        const cur = queue[qi++]
        component.push(cur)

        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const nx = cur.x + dx
          const ny = cur.y + dy

          if (!inBounds(nx, ny)) continue

          const neighborHeight = h(nx, ny)

          if (neighborHeight === height && !visited[ny][nx]) {
            visited[ny][nx] = true
            queue.push({ x: nx, y: ny })
          } else if (neighborHeight < height) {
            isBasin = false
          }
        }
      }

      if (isBasin) basins.push(component)
    }
  }

  return basins
}
