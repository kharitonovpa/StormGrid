import { describe, it, expect } from 'bun:test'
import { chooseBotAction } from '../bot.js'
import { GameEngine } from '../GameEngine.js'
import { createInitialState } from '../board.js'
import { SPAWN_PAIRS, TICKS_PER_ROUND } from '@wheee/shared'
import type { GameState, PlayerId, Action, Height, WindDir } from '@wheee/shared'

const FIXED_SPAWN = SPAWN_PAIRS[0]

function makeState(overrides?: Partial<GameState>): GameState {
  return { ...createInitialState(FIXED_SPAWN), ...overrides }
}

function setHeight(state: GameState, x: number, y: number, h: Height): void {
  state.board[y][x].height = h
}

describe('chooseBotAction — basic', () => {
  it('returns null when the bot is dead', () => {
    const state = makeState()
    state.players.A.alive = false
    expect(chooseBotAction(state, 'A')).toBeNull()
  })

  it('returns a valid action for a living bot', () => {
    const state = makeState()
    state.phase = 'ticking'
    state.forecast = { windCandidates: [], rainProbability: 0, instrumentsBroken: { A: { vane: false, barometer: false }, B: { vane: false, barometer: false } } }

    let actions = 0
    let nulls = 0
    for (let i = 0; i < 100; i++) {
      const action = chooseBotAction(state, 'A')
      if (action) {
        actions++
        expect(['move', 'raise', 'lower']).toContain(action.kind)
      } else {
        nulls++
      }
    }
    expect(actions).toBeGreaterThan(80)
  })
})

describe('chooseBotAction — wind safety', () => {
  it('seeks shelter when wind threatens from one direction', () => {
    const state = makeState()
    state.phase = 'ticking'
    state.players.A.x = 3
    state.players.A.y = 3
    state.forecast = {
      windCandidates: ['N'],
      rainProbability: 0,
      instrumentsBroken: { A: { vane: false, barometer: false }, B: { vane: false, barometer: false } },
    }

    setHeight(state, 3, 4, 1)

    let moveOrRaise = 0
    for (let i = 0; i < 50; i++) {
      const action = chooseBotAction(state, 'A')
      if (action && (action.kind === 'move' || action.kind === 'raise')) moveOrRaise++
    }
    expect(moveOrRaise).toBeGreaterThan(20)
  })

  it('raises upwind cell to create shelter when no safe move exists', () => {
    const state = makeState()
    state.phase = 'ticking'
    state.players.A.x = 0
    state.players.A.y = 3
    state.forecast = {
      windCandidates: ['E'],
      rainProbability: 0,
      instrumentsBroken: { A: { vane: false, barometer: false }, B: { vane: false, barometer: false } },
    }

    let raiseCount = 0
    for (let i = 0; i < 50; i++) {
      const action = chooseBotAction(state, 'A')
      if (action?.kind === 'raise') raiseCount++
    }
    expect(raiseCount).toBeGreaterThan(0)
  })

  it('stays calm when already shielded from wind', () => {
    const state = makeState()
    state.phase = 'ticking'
    state.players.A.x = 3
    state.players.A.y = 3
    state.forecast = {
      windCandidates: ['N'],
      rainProbability: 0,
      instrumentsBroken: { A: { vane: false, barometer: false }, B: { vane: false, barometer: false } },
    }

    setHeight(state, 3, 4, 1)

    let windRelated = 0
    for (let i = 0; i < 50; i++) {
      const action = chooseBotAction(state, 'A')
      if (action) windRelated++
    }
    expect(windRelated).toBeGreaterThan(0)
  })
})

describe('chooseBotAction — rain safety', () => {
  it('reacts to flood risk by moving up or raising terrain', () => {
    const state = makeState()
    state.phase = 'ticking'
    state.players.A.x = 3
    state.players.A.y = 3
    state.forecast = {
      windCandidates: [],
      rainProbability: 0.9,
      instrumentsBroken: { A: { vane: false, barometer: false }, B: { vane: false, barometer: false } },
    }

    setHeight(state, 2, 3, 1)
    setHeight(state, 4, 3, 1)
    setHeight(state, 3, 2, 1)
    setHeight(state, 3, 4, 1)

    let escapeActions = 0
    for (let i = 0; i < 50; i++) {
      const action = chooseBotAction(state, 'A')
      if (action && (action.kind === 'raise' || action.kind === 'move')) escapeActions++
    }
    expect(escapeActions).toBeGreaterThan(30)
  })
})

describe('chooseBotAction — player B inversion', () => {
  it('returns valid actions for player B', () => {
    const state = makeState()
    state.phase = 'ticking'
    state.forecast = { windCandidates: [], rainProbability: 0, instrumentsBroken: { A: { vane: false, barometer: false }, B: { vane: false, barometer: false } } }

    let count = 0
    for (let i = 0; i < 50; i++) {
      const action = chooseBotAction(state, 'B')
      if (action) {
        count++
        expect(['move', 'raise', 'lower']).toContain(action.kind)
      }
    }
    expect(count).toBeGreaterThan(30)
  })
})

describe('chooseBotAction — full engine round', () => {
  it('produces actions through a complete round lifecycle', () => {
    const engine = new GameEngine(FIXED_SPAWN)
    engine.startRound()
    engine.beginTicking()

    for (let t = 0; t < TICKS_PER_ROUND; t++) {
      const state = engine.getState()
      const botAction = chooseBotAction(state, 'B')
      const actions: Partial<Record<PlayerId, Action>> = {}
      actions.A = { kind: 'move', dir: 'N' }
      if (botAction) actions.B = botAction
      engine.submitTick(actions)
    }

    const final = engine.getState()
    expect(final.phase).toBe('weather')
    expect(final.tick).toBe(TICKS_PER_ROUND)
    expect(final.players.A.alive).toBe(true)
    expect(final.players.B.alive).toBe(true)
  })
})
