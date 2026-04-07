import type { Action, GameState, PlayerId, TickResult, BonusType, Height } from '@stormgrid/shared'
import { BOARD_SIZE, MOVE_DIRS } from '@stormgrid/shared'
import { cloneState, inBounds, clampHeight } from './board.js'

export function applyTick(
  state: GameState,
  actions: Partial<Record<PlayerId, Action>>,
): TickResult {
  const next = cloneState(state)
  const actionA = actions.A
  const actionB = actions.B

  resolveMoves(next, actionA, actionB)
  resolveTerrainChanges(next, actionA, actionB)

  const activatedBonus = resolveBonus(next)

  next.tick += 1
  return { state: next, activatedBonus }
}

function applyMove(player: { x: number; y: number; alive: boolean }, action: Action | undefined): void {
  if (!action || action.kind !== 'move' || !player.alive) return
  const d = MOVE_DIRS[action.dir]
  const nx = player.x + d.dx
  const ny = player.y + d.dy
  if (inBounds(nx, ny)) { player.x = nx; player.y = ny }
}

function resolveMoves(
  state: GameState,
  actionA: Action | undefined,
  actionB: Action | undefined,
): void {
  applyMove(state.players.A, actionA)
  applyMove(state.players.B, actionB)
}

/**
 * Raise/Lower are applied simultaneously.
 * If both target the same cell with opposite operations, they cancel out.
 */
function resolveTerrainChanges(
  state: GameState,
  actionA: Action | undefined,
  actionB: Action | undefined,
): void {
  const terrainA = actionA && (actionA.kind === 'raise' || actionA.kind === 'lower') ? actionA : null
  const terrainB = actionB && (actionB.kind === 'raise' || actionB.kind === 'lower') ? actionB : null

  if (!terrainA && !terrainB) return

  const deltas = new Map<string, number>()

  for (const action of [terrainA, terrainB]) {
    if (!action) continue
    const key = `${action.x},${action.y}`
    const delta = action.kind === 'raise' ? 1 : -1
    deltas.set(key, (deltas.get(key) ?? 0) + delta)
  }

  for (const [key, delta] of deltas) {
    if (delta === 0) continue
    const [x, y] = key.split(',').map(Number)
    if (!inBounds(x, y)) continue

    const cell = state.board[y][x]
    cell.height = clampHeight(cell.height + delta)
  }
}

function resolveBonus(state: GameState): { player: PlayerId; bonus: BonusType } | null {
  const b = state.activeBonus
  if (!b) return null

  for (const pid of ['A', 'B'] as PlayerId[]) {
    const p = state.players[pid]
    if (p.alive && p.x === b.x && p.y === b.y) {
      state.activeBonus = null
      return { player: pid, bonus: b.type }
    }
  }

  return null
}
