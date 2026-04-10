import { describe, it, expect } from 'bun:test'
import { createInitialState } from '../board.js'
import { applyTick } from '../tick.js'
import type { Action, GameState } from '@wheee/shared'
import { BOARD_SIZE } from '@wheee/shared'

const FIXED_SPAWN = { A: { x: 3, y: 5 }, B: { x: 3, y: 1 } }

function state(): GameState {
  return createInitialState(FIXED_SPAWN)
}

describe('tick — movement', () => {
  it('moves player A north', () => {
    const s = state()
    const startY = s.players.A.y
    const startX = s.players.A.x
    const { state: next } = applyTick(s, { A: { kind: 'move', dir: 'N' } })
    expect(next.players.A.y).toBe(startY > 0 ? startY - 1 : startY)
    expect(next.players.A.x).toBe(startX)
  })

  it('moves player B south', () => {
    const s = state()
    const startY = s.players.B.y
    const { state: next } = applyTick(s, { B: { kind: 'move', dir: 'S' } })
    expect(next.players.B.y).toBe(startY < BOARD_SIZE - 1 ? startY + 1 : startY)
  })

  it('blocks move off the map edge', () => {
    const s = state()
    s.players.A.x = 0
    s.players.A.y = 0
    const { state: next } = applyTick(s, { A: { kind: 'move', dir: 'N' } })
    expect(next.players.A.x).toBe(0)
    expect(next.players.A.y).toBe(0)
  })

  it('both players can move to the same cell', () => {
    const s = state()
    s.players.A.x = 2
    s.players.A.y = 3
    s.players.B.x = 4
    s.players.B.y = 3
    const { state: next } = applyTick(s, {
      A: { kind: 'move', dir: 'E' },
      B: { kind: 'move', dir: 'W' },
    })
    expect(next.players.A.x).toBe(3)
    expect(next.players.B.x).toBe(3)
  })

  it('no action = no change', () => {
    const s = state()
    const { state: next } = applyTick(s, {})
    expect(next.players.A.x).toBe(s.players.A.x)
    expect(next.players.A.y).toBe(s.players.A.y)
  })

  it('increments tick counter', () => {
    const s = state()
    expect(s.tick).toBe(0)
    const { state: next } = applyTick(s, {})
    expect(next.tick).toBe(1)
  })
})

describe('tick — terrain changes', () => {
  it('raises a cell', () => {
    const s = state()
    const { state: next } = applyTick(s, { A: { kind: 'raise', x: 6, y: 6 } })
    expect(next.board[6][6].height).toBe(1)
  })

  it('lowers a cell', () => {
    const s = state()
    const { state: next } = applyTick(s, { A: { kind: 'lower', x: 6, y: 6 } })
    expect(next.board[6][6].height).toBe(-1)
  })

  it('clamps height at +1', () => {
    const s = state()
    s.board[6][6].height = 1
    const { state: next } = applyTick(s, { A: { kind: 'raise', x: 6, y: 6 } })
    expect(next.board[6][6].height).toBe(1)
  })

  it('clamps height at -1', () => {
    const s = state()
    s.board[6][6].height = -1
    const { state: next } = applyTick(s, { A: { kind: 'lower', x: 6, y: 6 } })
    expect(next.board[6][6].height).toBe(-1)
  })

  it('raise + lower on same cell → cancel', () => {
    const s = state()
    const { state: next } = applyTick(s, {
      A: { kind: 'raise', x: 6, y: 6 },
      B: { kind: 'lower', x: 6, y: 6 },
    })
    expect(next.board[6][6].height).toBe(0)
  })

  it('can modify cell under a player', () => {
    const s = state()
    const ax = s.players.A.x
    const ay = s.players.A.y
    const { state: next } = applyTick(s, { A: { kind: 'raise', x: ax, y: ay } })
    expect(next.board[ay][ax].height).toBe(1)
  })

  it('cell check uses post-move positions', () => {
    const s = state()
    s.players.A.x = 2
    s.players.A.y = 2
    s.players.B.x = 5
    s.players.B.y = 5
    const { state: next } = applyTick(s, {
      A: { kind: 'raise', x: 5, y: 5 },
      B: { kind: 'move', dir: 'N' },
    })
    expect(next.board[5][5].height).toBe(1)
  })
})

describe('tick — bonus activation', () => {
  it('activates bonus when player steps on it', () => {
    const s = state()
    s.players.A.x = 3
    s.players.A.y = 3
    s.activeBonus = { x: 4, y: 3, type: 'intel' }
    const result = applyTick(s, { A: { kind: 'move', dir: 'E' } })
    expect(result.activatedBonus).toEqual({ player: 'A', bonus: 'intel' })
    expect(result.state.activeBonus).toBeNull()
  })

  it('no bonus if nobody steps on it', () => {
    const s = state()
    s.activeBonus = { x: 6, y: 6, type: 'time_extend' }
    const result = applyTick(s, {})
    expect(result.activatedBonus).toBeNull()
    expect(result.state.activeBonus).not.toBeNull()
  })
})
