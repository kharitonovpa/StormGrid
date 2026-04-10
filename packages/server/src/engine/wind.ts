import type { Cell, GameState, PlayerId, WindDir, Height } from '@wheee/shared'
import { BOARD_SIZE, DIRECTIONS } from '@wheee/shared'
import { inBounds } from './board.js'

export type WindResult = {
  deaths: PlayerId[]
  paths: Record<PlayerId, { x: number; y: number }[]>
}

/**
 * Wind resolution:
 *
 * Each player experiences wind on THEIR side of the slab.
 * A uses canonical heights; B uses negated heights.
 *
 * 1. Scan UPWIND (opposite to wind direction) from the player to the edge.
 *    If any cell is higher than the player → wind is blocked by terrain
 *    shadow, player stays.
 *
 * 2. Otherwise player is pushed DOWNWIND:
 *    - Higher cell ahead → stop before it
 *    - Lower cell ahead → fall in and stop (pit walls block further push)
 *    - Equal → continue
 *    - Off map edge → death
 */
export function resolveWind(state: GameState, dir: WindDir): WindResult {
  const d = DIRECTIONS[dir]
  const deaths: PlayerId[] = []
  const paths: Record<PlayerId, { x: number; y: number }[]> = { A: [], B: [] }

  for (const pid of ['A', 'B'] as PlayerId[]) {
    const p = state.players[pid]
    if (!p.alive) continue

    const sign = pid === 'A' ? 1 : -1
    const h = (x: number, y: number): Height =>
      (state.board[y][x].height * sign) as Height

    const startHeight = h(p.x, p.y)

    let shielded = false
    let sx = p.x - d.dx
    let sy = p.y - d.dy
    while (inBounds(sx, sy)) {
      if (h(sx, sy) > startHeight) {
        shielded = true
        break
      }
      sx -= d.dx
      sy -= d.dy
    }

    if (shielded) {
      paths[pid].push({ x: p.x, y: p.y })
      continue
    }

    let cx = p.x
    let cy = p.y
    let currentHeight = startHeight
    paths[pid].push({ x: cx, y: cy })

    let dead = false
    while (true) {
      const nx = cx + d.dx
      const ny = cy + d.dy

      if (!inBounds(nx, ny)) {
        dead = true
        break
      }

      const nextHeight = h(nx, ny)

      if (nextHeight > currentHeight) {
        break
      }

      const fell = nextHeight < currentHeight
      cx = nx
      cy = ny
      currentHeight = nextHeight
      paths[pid].push({ x: cx, y: cy })

      if (fell) {
        break
      }
    }

    if (dead) {
      p.alive = false
      deaths.push(pid)
    } else {
      p.x = cx
      p.y = cy
    }
  }

  return { deaths, paths }
}
