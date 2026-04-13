import type { Cell, DeathCause, GameState, PlayerId, Height } from '@wheee/shared'
import { BOARD_SIZE } from '@wheee/shared'
import { inBounds } from './board.js'

export type RainResult = {
  deaths: PlayerId[]
  deathCauses: Partial<Record<PlayerId, DeathCause>>
  floodedCellsA: { x: number; y: number }[]
  floodedCellsB: { x: number; y: number }[]
}

/**
 * Rain resolution — per-surface flooding.
 *
 * Each player experiences rain on THEIR side of the slab.
 * A uses canonical heights; B uses negated heights.
 * Basins and flooding are computed independently for each surface.
 */
export function resolveRain(state: GameState): RainResult {
  const deaths: PlayerId[] = []
  const deathCauses: Partial<Record<PlayerId, DeathCause>> = {}

  const floodedA = findAndFlood(state.board, 1)
  const floodedB = findAndFlood(state.board, -1)

  const floodSetA = new Set(floodedA.map(c => c.y * BOARD_SIZE + c.x))
  const floodSetB = new Set(floodedB.map(c => c.y * BOARD_SIZE + c.x))

  const pA = state.players.A
  if (pA.alive && floodSetA.has(pA.y * BOARD_SIZE + pA.x)) {
    pA.alive = false
    deaths.push('A')
    deathCauses.A = { type: 'rain' }
  }

  const pB = state.players.B
  if (pB.alive && floodSetB.has(pB.y * BOARD_SIZE + pB.x)) {
    pB.alive = false
    deaths.push('B')
    deathCauses.B = { type: 'rain' }
  }

  return { deaths, deathCauses, floodedCellsA: floodedA, floodedCellsB: floodedB }
}

/**
 * Find basins and return flooded cells for one surface.
 * sign = 1 for A (canonical), sign = -1 for B (inverted).
 */
function findAndFlood(
  board: Cell[][],
  sign: number,
): { x: number; y: number }[] {
  const h = (x: number, y: number) => board[y][x].height * sign

  const visited: boolean[][] = Array.from({ length: BOARD_SIZE }, () =>
    Array(BOARD_SIZE).fill(false),
  )

  const flooded: { x: number; y: number }[] = []

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (visited[y][x]) continue

      const component: { x: number; y: number }[] = []
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

      if (isBasin) {
        const minH = Math.min(...component.map(c => h(c.x, c.y)))
        for (const c of component) {
          if (h(c.x, c.y) === minH) flooded.push(c)
        }
      }
    }
  }

  return flooded
}
