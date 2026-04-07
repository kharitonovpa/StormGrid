import { describe, it, expect } from 'bun:test'
import { createInitialState } from '../board.js'
import { resolveRain } from '../rain.js'
import type { GameState, Height } from '@stormgrid/shared'
import { BOARD_SIZE } from '@stormgrid/shared'

const FIXED_SPAWN = { A: { x: 3, y: 5 }, B: { x: 3, y: 1 } }

function state(): GameState {
  return createInitialState(FIXED_SPAWN)
}

describe('rain — flat board', () => {
  it('all cells are one basin on flat board, both players drown', () => {
    const s = state()
    s.players.A.x = 3
    s.players.A.y = 3
    s.players.B.x = 5
    s.players.B.y = 5

    const result = resolveRain(s)
    expect(result.deaths).toContain('A')
    expect(result.deaths).toContain('B')
  })
})

describe('rain — pit drowning', () => {
  it('player A in canonical pit drowns', () => {
    const s = state()
    s.players.A.x = 3
    s.players.A.y = 3
    s.players.B.x = 0
    s.players.B.y = 0

    s.board[3][3].height = -1
    s.board[2][3].height = 1
    s.board[4][3].height = 1
    s.board[3][2].height = 1
    s.board[3][4].height = 1

    const result = resolveRain(s)
    expect(result.deaths).toContain('A')
  })

  it('player B in canonical peak (+1) drowns (pit on B surface)', () => {
    const s = state()
    // Raise entire board to +1 so A is safe (canonical +1 = peak for A)
    for (let y = 0; y < BOARD_SIZE; y++)
      for (let x = 0; x < BOARD_SIZE; x++)
        s.board[y][x].height = 1

    // Dig one cell to 0 for B's pit: canonical 0 surrounded by +1.
    // B sees: 0 → 0, +1 → -1. So B sees (3,3)=0 surrounded by -1.
    // Actually invert: +1 → -1 for B, 0 → 0 for B. So B surface:
    // most cells = -1, cell (3,3) = 0. The -1 cells form a basin.
    // B is at (3,3) = 0, which is higher than -1. B survives.
    // Let me rethink... I need B to be in a PIT on B's surface.
    // B pit = canonical +1 surrounded by higher canonical values.
    // But +1 is already max. Can't go higher.
    // Instead: set most of board to -1, B at (3,3) on height 0.
    // B sees: -1 → +1, 0 → 0. So B surface: most cells = +1,
    // cell (3,3) = 0. The 0-cell is a basin (surrounded by +1). B drowns.
    for (let y = 0; y < BOARD_SIZE; y++)
      for (let x = 0; x < BOARD_SIZE; x++)
        s.board[y][x].height = -1

    s.board[3][3].height = 0
    s.players.A.x = 0
    s.players.A.y = 0
    s.players.B.x = 3
    s.players.B.y = 3

    const result = resolveRain(s)
    expect(result.deaths).toContain('B')
  })
})

describe('rain — survival', () => {
  it('player A on higher ground survives', () => {
    const s = state()
    s.players.A.x = 3
    s.players.A.y = 3
    s.players.B.x = 0
    s.players.B.y = 0

    s.board[3][3].height = 1

    const result = resolveRain(s)
    expect(result.deaths).not.toContain('A')
  })

  it('player A at 0 survives if adjacent cell is -1', () => {
    const s = state()
    s.players.A.x = 3
    s.players.A.y = 3
    s.players.B.x = 0
    s.players.B.y = 0

    s.board[3][2].height = -1

    const result = resolveRain(s)
    expect(result.deaths).not.toContain('A')
  })
})

describe('rain — isolated basins', () => {
  it('two separate pits create two basins', () => {
    const s = state()
    for (let y = 0; y < BOARD_SIZE; y++) {
      s.board[y][3].height = 1
    }

    s.board[1][1].height = -1
    s.board[1][5].height = -1

    s.players.A.x = 1
    s.players.A.y = 1
    s.players.B.x = 5
    s.players.B.y = 1

    const result = resolveRain(s)
    expect(result.deaths).toContain('A')
  })
})

describe('rain — flooded cells', () => {
  it('returns flooded cells for both surfaces', () => {
    const s = state()
    s.players.A.x = 3
    s.players.A.y = 3
    s.players.B.x = 0
    s.players.B.y = 0

    const result = resolveRain(s)
    expect(result.floodedCellsA.length).toBeGreaterThan(0)
    expect(result.floodedCellsB.length).toBeGreaterThan(0)
  })
})

describe('rain — two-sided inversion', () => {
  it('canonical -1 pit floods A surface, canonical +1 pit floods B surface', () => {
    const s = state()
    // Single pit for A at (1,1)
    s.board[1][1].height = -1
    // Single pit for B at (5,5) — canonical +1, inverted = -1
    s.board[5][5].height = 1

    s.players.A.x = 1
    s.players.A.y = 1
    s.players.B.x = 5
    s.players.B.y = 5

    const result = resolveRain(s)
    expect(result.deaths).toContain('A')
    expect(result.deaths).toContain('B')
  })
})
