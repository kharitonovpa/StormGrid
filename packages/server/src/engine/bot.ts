import type { Action, GameState, PlayerId, WindDir, MoveDir, Cell } from '@wheee/shared'
import { BOARD_SIZE, DIRECTIONS, MOVE_DIRS } from '@wheee/shared'
import { inBounds } from './board.js'

const ALL_MOVE_DIRS: MoveDir[] = ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']
const CENTER = Math.floor(BOARD_SIZE / 2)

/**
 * Choose an action for the bot.
 * Receives canonical (un-transformed) state and the bot's player id.
 * Room handles raise/lower inversion for player B.
 */
export function chooseBotAction(state: GameState, pid: PlayerId): Action | null {
  const me = state.players[pid]
  if (!me.alive) return null

  const sign = pid === 'A' ? 1 : -1

  if (Math.random() < 0.05) return null
  if (Math.random() < 0.15) return randomAction(me)

  const { windCandidates, rainProbability } = state.forecast

  const windAction = windCandidates.length > 0
    ? handleWind(state, me, windCandidates, sign)
    : null
  if (windAction) return windAction

  const rainAction = rainProbability > 0.4
    ? handleRain(state.board, me, sign)
    : null
  if (rainAction) return rainAction

  const oppId: PlayerId = pid === 'A' ? 'B' : 'A'
  const opp = state.players[oppId]
  if (opp.alive && Math.random() < 0.3) {
    const aggAction = aggression(me, opp)
    if (aggAction) return aggAction
  }

  return moveTowardCenter(me) ?? { kind: 'raise', x: me.x, y: me.y }
}

/* ── perceived height on the bot's side ── */

function pH(board: Cell[][], x: number, y: number, sign: number): number {
  return board[y][x].height * sign
}

/* ── Wind evaluation ── */

function isShielded(
  board: Cell[][], px: number, py: number, dir: WindDir, sign: number,
): boolean {
  const d = DIRECTIONS[dir]
  const myH = pH(board, px, py, sign)
  let sx = px - d.dx
  let sy = py - d.dy
  while (inBounds(sx, sy)) {
    if (pH(board, sx, sy, sign) > myH) return true
    sx -= d.dx
    sy -= d.dy
  }
  return false
}

function survivesWind(
  board: Cell[][], px: number, py: number, dir: WindDir, sign: number,
): boolean {
  if (isShielded(board, px, py, dir, sign)) return true

  const d = DIRECTIONS[dir]
  let cx = px, cy = py
  let curH = pH(board, cx, cy, sign)

  for (;;) {
    const nx = cx + d.dx
    const ny = cy + d.dy
    if (!inBounds(nx, ny)) return false

    const nextH = pH(board, nx, ny, sign)
    if (nextH > curH) return true
    if (nextH < curH) return true
    cx = nx; cy = ny; curH = nextH
  }
}

function handleWind(
  state: GameState,
  me: { x: number; y: number },
  candidates: WindDir[],
  sign: number,
): Action | null {
  const board = state.board
  const unsafeDirs = candidates.filter(d => !survivesWind(board, me.x, me.y, d, sign))
  if (unsafeDirs.length === 0) return null

  const safeMoves = ALL_MOVE_DIRS.filter(md => {
    const m = MOVE_DIRS[md]
    const nx = me.x + m.dx, ny = me.y + m.dy
    if (!inBounds(nx, ny)) return false
    return candidates.every(wd => survivesWind(board, nx, ny, wd, sign))
  })

  if (safeMoves.length > 0) {
    return { kind: 'move', dir: closestToCenter(safeMoves, me) }
  }

  const partialMoves = ALL_MOVE_DIRS
    .filter(md => {
      const m = MOVE_DIRS[md]
      return inBounds(me.x + m.dx, me.y + m.dy)
    })
    .map(md => {
      const m = MOVE_DIRS[md]
      const count = candidates.filter(
        wd => !survivesWind(board, me.x + m.dx, me.y + m.dy, wd, sign),
      ).length
      return { dir: md, unsafeCount: count }
    })
    .filter(m => m.unsafeCount < unsafeDirs.length)
    .sort((a, b) => a.unsafeCount - b.unsafeCount)

  if (partialMoves.length > 0) {
    return { kind: 'move', dir: partialMoves[0].dir }
  }

  for (const wd of unsafeDirs) {
    const d = DIRECTIONS[wd]
    const ux = me.x - d.dx, uy = me.y - d.dy
    if (inBounds(ux, uy) && pH(board, ux, uy, sign) <= pH(board, me.x, me.y, sign)) {
      return { kind: 'raise', x: ux, y: uy }
    }
  }

  return { kind: 'raise', x: me.x, y: me.y }
}

/* ── Rain evaluation ── */

function isFloodRisk(board: Cell[][], x: number, y: number, sign: number): boolean {
  const myH = pH(board, x, y, sign)
  const visited = new Set<number>()
  const queue: [number, number][] = [[x, y]]
  visited.add(y * BOARD_SIZE + x)
  let basin = true

  while (queue.length > 0) {
    const [cx, cy] = queue.shift()!
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const nx = cx + dx, ny = cy + dy
      if (!inBounds(nx, ny)) continue
      const nh = pH(board, nx, ny, sign)
      if (nh === myH && !visited.has(ny * BOARD_SIZE + nx)) {
        visited.add(ny * BOARD_SIZE + nx)
        queue.push([nx, ny])
      } else if (nh < myH) {
        basin = false
      }
    }
  }

  return basin
}

function handleRain(
  board: Cell[][], me: { x: number; y: number }, sign: number,
): Action | null {
  if (!isFloodRisk(board, me.x, me.y, sign)) return null

  const myH = pH(board, me.x, me.y, sign)
  const escapes = ALL_MOVE_DIRS
    .filter(md => {
      const m = MOVE_DIRS[md]
      return inBounds(me.x + m.dx, me.y + m.dy)
    })
    .map(md => {
      const m = MOVE_DIRS[md]
      return { dir: md, h: pH(board, me.x + m.dx, me.y + m.dy, sign) }
    })
    .filter(m => m.h > myH)
    .sort((a, b) => b.h - a.h)

  if (escapes.length > 0) return { kind: 'move', dir: escapes[0].dir }
  return { kind: 'raise', x: me.x, y: me.y }
}

/* ── Aggression ── */

function aggression(
  me: { x: number; y: number },
  opp: { x: number; y: number },
): Action | null {
  if (Math.random() < 0.5) return { kind: 'lower', x: opp.x, y: opp.y }

  const adj: { x: number; y: number }[] = []
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const nx = opp.x + dx, ny = opp.y + dy
    if (!inBounds(nx, ny)) continue
    if (nx === me.x && ny === me.y) continue
    adj.push({ x: nx, y: ny })
  }
  if (adj.length === 0) return null
  const t = adj[Math.floor(Math.random() * adj.length)]
  return { kind: 'lower', x: t.x, y: t.y }
}

/* ── Center pull ── */

function moveTowardCenter(me: { x: number; y: number }): Action | null {
  if (me.x === CENTER && me.y === CENTER) return null

  let bestDir: MoveDir | null = null
  let bestDist = Math.abs(CENTER - me.x) + Math.abs(CENTER - me.y)

  for (const md of ALL_MOVE_DIRS) {
    const m = MOVE_DIRS[md]
    const nx = me.x + m.dx, ny = me.y + m.dy
    if (!inBounds(nx, ny)) continue
    const d = Math.abs(CENTER - nx) + Math.abs(CENTER - ny)
    if (d < bestDist) { bestDist = d; bestDir = md }
  }

  return bestDir ? { kind: 'move', dir: bestDir } : null
}

/* ── Utilities ── */

function closestToCenter(dirs: MoveDir[], me: { x: number; y: number }): MoveDir {
  let best = dirs[0]
  let bestDist = Infinity
  for (const d of dirs) {
    const m = MOVE_DIRS[d]
    const dist = Math.abs(CENTER - (me.x + m.dx)) + Math.abs(CENTER - (me.y + m.dy))
    if (dist < bestDist) { bestDist = dist; best = d }
  }
  return best
}

function randomAction(me: { x: number; y: number }): Action {
  const r = Math.random()
  if (r < 0.5) {
    const valid = ALL_MOVE_DIRS.filter(md => {
      const m = MOVE_DIRS[md]
      return inBounds(me.x + m.dx, me.y + m.dy)
    })
    if (valid.length > 0) {
      return { kind: 'move', dir: valid[Math.floor(Math.random() * valid.length)] }
    }
  }

  const rx = me.x + Math.floor(Math.random() * 3) - 1
  const ry = me.y + Math.floor(Math.random() * 3) - 1
  if (inBounds(rx, ry)) {
    return r < 0.75
      ? { kind: 'raise', x: rx, y: ry }
      : { kind: 'lower', x: rx, y: ry }
  }

  return { kind: 'raise', x: me.x, y: me.y }
}
