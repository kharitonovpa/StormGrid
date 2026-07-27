import type { Cell, DeathCause, GameState, PlayerId, WindDir, Height } from '@wheee/shared'
import { BOARD_SIZE, DIRECTIONS } from '@wheee/shared'
import { inBounds } from './board.js'

export type WindResult = {
  deaths: PlayerId[]
  deathCauses: Partial<Record<PlayerId, DeathCause>>
  paths: Record<PlayerId, { x: number; y: number }[]>
  /** Player the storm released because the other one left the board first. */
  spared: PlayerId | null
}

type Push = {
  path: { x: number; y: number }[]
  dead: boolean
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
 *
 * 3. Runway tiebreak: if the wind would carry BOTH players off the board,
 *    only the one with the shorter runway dies. The storm dies down the moment
 *    he leaves the board, so the other one is carried exactly as many steps as
 *    the loser managed before flying off, and survives. Equal runways still
 *    kill both.
 */
export function resolveWind(state: GameState, dir: WindDir): WindResult {
  const pushes: Partial<Record<PlayerId, Push>> = {}
  for (const pid of ['A', 'B'] as PlayerId[]) {
    if (state.players[pid].alive) pushes[pid] = pushPlayer(state, pid, dir)
  }

  const spared = arbitrateRunway(pushes)

  const deaths: PlayerId[] = []
  const deathCauses: Partial<Record<PlayerId, DeathCause>> = {}
  const paths: Record<PlayerId, { x: number; y: number }[]> = { A: [], B: [] }

  for (const pid of ['A', 'B'] as PlayerId[]) {
    const push = pushes[pid]
    if (!push) continue

    paths[pid] = push.path
    const p = state.players[pid]

    if (push.dead) {
      p.alive = false
      deaths.push(pid)
      deathCauses[pid] = { type: 'wind', dir }
    } else {
      const last = push.path[push.path.length - 1]
      p.x = last.x
      p.y = last.y
    }
  }

  return { deaths, deathCauses, paths, spared }
}

/** Trace where the wind takes one player. Pure — does not touch the state. */
function pushPlayer(state: GameState, pid: PlayerId, dir: WindDir): Push {
  const d = DIRECTIONS[dir]
  const p = state.players[pid]

  const sign = pid === 'A' ? 1 : -1
  const h = (x: number, y: number): Height =>
    (state.board[y][x].height * sign) as Height

  const startHeight = h(p.x, p.y)

  let sx = p.x - d.dx
  let sy = p.y - d.dy
  while (inBounds(sx, sy)) {
    if (h(sx, sy) > startHeight) {
      return { path: [{ x: p.x, y: p.y }], dead: false }
    }
    sx -= d.dx
    sy -= d.dy
  }

  const path: { x: number; y: number }[] = [{ x: p.x, y: p.y }]
  let cx = p.x
  let cy = p.y
  let currentHeight = startHeight

  while (true) {
    const nx = cx + d.dx
    const ny = cy + d.dy

    if (!inBounds(nx, ny)) {
      return { path, dead: true }
    }

    const nextHeight = h(nx, ny)

    if (nextHeight > currentHeight) {
      break
    }

    const fell = nextHeight < currentHeight
    cx = nx
    cy = ny
    currentHeight = nextHeight
    path.push({ x: cx, y: cy })

    if (fell) {
      break
    }
  }

  return { path, dead: false }
}

/**
 * When both players would be carried off the board, the shorter runway loses.
 * The survivor's slide is cut to the loser's length: the storm stops at the
 * moment of the death. Returns the spared player, or null if nothing changed.
 *
 * A player can only die if every cell downwind is level with him (any rise
 * stops him, any drop makes him fall in), so runway length equals the distance
 * to the leeward edge.
 */
function arbitrateRunway(pushes: Partial<Record<PlayerId, Push>>): PlayerId | null {
  const { A: a, B: b } = pushes
  if (!a?.dead || !b?.dead) return null
  if (a.path.length === b.path.length) return null

  const loser: PlayerId = a.path.length < b.path.length ? 'A' : 'B'
  const survivor: PlayerId = loser === 'A' ? 'B' : 'A'

  const sp = pushes[survivor]!
  sp.path = sp.path.slice(0, pushes[loser]!.path.length)
  sp.dead = false

  return survivor
}
