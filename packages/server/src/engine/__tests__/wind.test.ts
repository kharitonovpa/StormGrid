import { describe, it, expect } from 'bun:test'
import { createInitialState } from '../board.js'
import { resolveWind } from '../wind.js'
import type { GameState, Height } from '@stormgrid/shared'
import { BOARD_SIZE } from '@stormgrid/shared'

const FIXED_SPAWN = { A: { x: 3, y: 5 }, B: { x: 3, y: 1 } }

function state(): GameState {
  return createInitialState(FIXED_SPAWN)
}

describe('wind — basic push', () => {
  it('pushes player east across flat board to death', () => {
    const s = state()
    s.players.A.x = 3
    s.players.A.y = 3
    s.players.B.x = 0
    s.players.B.y = 0

    const result = resolveWind(s, 'E')
    expect(result.deaths).toContain('A')
    expect(s.players.A.alive).toBe(false)
  })

  it('pushes player south to death on flat board', () => {
    const s = state()
    s.players.A.x = 3
    s.players.A.y = 3
    s.players.B.x = 0
    s.players.B.y = 0

    const result = resolveWind(s, 'S')
    expect(result.deaths).toContain('A')
  })
})

describe('wind — upwind shielding', () => {
  it('wall UPWIND of player blocks wind completely', () => {
    const s = state()
    s.players.A.x = 4
    s.players.A.y = 3
    s.players.B.x = 0
    s.players.B.y = 0
    // Wind East → comes from West. Wall at x=2 (west of player) shields.
    s.board[3][2].height = 1

    const result = resolveWind(s, 'E')
    expect(result.deaths).not.toContain('A')
    expect(s.players.A.x).toBe(4)
  })

  it('wall immediately upwind shields', () => {
    const s = state()
    s.players.A.x = 4
    s.players.A.y = 3
    s.players.B.x = 0
    s.players.B.y = 0
    // Wind East. Wall at x=3 (one cell west).
    s.board[3][3].height = 1

    const result = resolveWind(s, 'E')
    expect(result.deaths).not.toContain('A')
    expect(s.players.A.x).toBe(4)
  })

  it('wall DOWNWIND does NOT shield — player stops before it', () => {
    const s = state()
    s.players.A.x = 3
    s.players.A.y = 3
    s.players.B.x = 0
    s.players.B.y = 0
    // Wind East. Wall at x=5 (downwind) — not a shield, but an obstacle.
    s.board[3][5].height = 1

    const result = resolveWind(s, 'E')
    expect(result.deaths).not.toContain('A')
    expect(s.players.A.x).toBe(4)
  })

  it('wall on different row does NOT shield', () => {
    const s = state()
    s.players.A.x = 3
    s.players.A.y = 3
    s.players.B.x = 0
    s.players.B.y = 0
    // Wind East. Wall upwind but on row 2, player on row 3.
    s.board[2][1].height = 1

    const result = resolveWind(s, 'E')
    expect(result.deaths).toContain('A')
  })
})

describe('wind — downwind obstacles', () => {
  it('stops before a wall during push', () => {
    const s = state()
    s.players.A.x = 1
    s.players.A.y = 3
    s.players.B.x = 0
    s.players.B.y = 0
    s.board[3][5].height = 1

    const result = resolveWind(s, 'E')
    expect(result.deaths).not.toContain('A')
    expect(s.players.A.x).toBe(4)
  })

  it('falls into a pit and stops', () => {
    const s = state()
    s.players.A.x = 2
    s.players.A.y = 3
    s.players.B.x = 0
    s.players.B.y = 0
    s.board[3][4].height = -1

    const result = resolveWind(s, 'E')
    expect(result.deaths).not.toContain('A')
    expect(s.players.A.x).toBe(4)
  })
})

describe('wind — edge death', () => {
  it('player on edge dies from wind pushing off', () => {
    const s = state()
    s.players.A.x = 6
    s.players.A.y = 3
    s.players.B.x = 0
    s.players.B.y = 0

    const result = resolveWind(s, 'E')
    expect(result.deaths).toContain('A')
    expect(s.players.A.alive).toBe(false)
  })
})

describe('wind — both players', () => {
  it('both die on flat board wind east', () => {
    const s = state()
    s.players.A.x = 3
    s.players.A.y = 3
    s.players.B.x = 3
    s.players.B.y = 5

    const result = resolveWind(s, 'E')
    expect(result.deaths).toContain('A')
    expect(result.deaths).toContain('B')
  })

  it('one shielded by upwind wall, one dies', () => {
    const s = state()
    s.players.A.x = 4
    s.players.A.y = 3
    s.players.B.x = 3
    s.players.B.y = 5
    // Wind East. Wall upwind of A at x=2.
    s.board[3][2].height = 1

    const result = resolveWind(s, 'E')
    expect(result.deaths).not.toContain('A')
    expect(result.deaths).toContain('B')
  })
})

describe('wind — path tracking', () => {
  it('shielded player has single-point path', () => {
    const s = state()
    s.players.A.x = 4
    s.players.A.y = 3
    s.players.B.x = 0
    s.players.B.y = 0
    s.board[3][2].height = 1

    const result = resolveWind(s, 'E')
    expect(result.paths.A).toEqual([{ x: 4, y: 3 }])
  })

  it('pushed player path ends at pit', () => {
    const s = state()
    s.players.A.x = 2
    s.players.A.y = 3
    s.players.B.x = 0
    s.players.B.y = 0
    s.board[3][4].height = -1

    const result = resolveWind(s, 'E')
    expect(result.paths.A[0]).toEqual({ x: 2, y: 3 })
    expect(result.paths.A[result.paths.A.length - 1]).toEqual({ x: 4, y: 3 })
  })
})

describe('wind — two-sided inversion', () => {
  it('canonical +1 upwind shields A, not B (B sees it as pit)', () => {
    const s = state()
    s.players.A.x = 4
    s.players.A.y = 3
    s.players.B.x = 4
    s.players.B.y = 3
    // Wind East. Upwind wall at x=2 (canonical +1).
    // A sees +1 → shield. B sees -1 → no shield.
    s.board[3][2].height = 1

    const result = resolveWind(s, 'E')
    expect(result.deaths).not.toContain('A')
    expect(s.players.A.x).toBe(4)
    expect(result.deaths).toContain('B')
  })

  it('canonical -1 upwind shields B, not A (A sees it as pit)', () => {
    const s = state()
    s.players.A.x = 4
    s.players.A.y = 3
    s.players.B.x = 4
    s.players.B.y = 3
    // Wind East. Upwind cell at x=2 (canonical -1).
    // A sees -1 → no shield. B sees +1 → shield.
    s.board[3][2].height = -1

    const result = resolveWind(s, 'E')
    expect(result.deaths).toContain('A')
    expect(result.deaths).not.toContain('B')
    expect(s.players.B.x).toBe(4)
  })
})
