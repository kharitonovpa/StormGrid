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
}

type Basin = { x: number; y: number }[]

/**
 * Rain resolution — per-surface flooding.
 *
 * Each player experiences rain on THEIR side of the slab.
 * A uses canonical heights; B uses negated heights.
 * Basins and flooding are computed independently for each surface.
 *
 * Volume tiebreak: if both players stand in a basin, the tighter one brims over
 * first and drowns its occupant. The water stops rising at that moment, so the
 * wider hollow never fills and its occupant survives — and nothing on his side
 * had time to brim over, so his surface reports no flooding at all. Equal
 * volumes drown both.
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

  return {
    deaths,
    deathCauses,
    floodedCellsA: spared === 'A' ? [] : basinsA.flat(),
    floodedCellsB: spared === 'B' ? [] : basinsB.flat(),
    spared,
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
