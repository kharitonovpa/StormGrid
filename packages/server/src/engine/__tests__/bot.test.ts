import { describe, it, expect } from 'bun:test'
import { chooseBotAction } from '../bot.js'
import { GameEngine } from '../GameEngine.js'
import { createInitialState, cloneState } from '../board.js'
import { applyTick } from '../tick.js'
import { resolveLightning } from '../lightning.js'
import { resolveWind } from '../wind.js'
import { resolveRain } from '../rain.js'
import { SPAWN_PAIRS, TICKS_PER_ROUND, WIND_DIRS } from '@wheee/shared'
import type { GameState, PlayerId, Action, Height, WindDir } from '@wheee/shared'

const FIXED_SPAWN = SPAWN_PAIRS[0]

function makeState(overrides?: Partial<GameState>): GameState {
  return { ...createInitialState(FIXED_SPAWN), ...overrides }
}

function setHeight(state: GameState, x: number, y: number, h: Height): void {
  state.board[y][x].height = h
}

/**
 * The bot is judged the way the round judges it: play its action, bring the
 * weather down, see who is still standing.
 */
function survivesWind(state: GameState, pid: PlayerId, action: Action | null, dir: WindDir): boolean {
  const after = applyTick(state, action ? { [pid]: action } : {}).state
  resolveWind(after, dir)
  return after.players[pid].alive
}

function survivesRain(state: GameState, pid: PlayerId, action: Action | null): boolean {
  const after = applyTick(state, action ? { [pid]: action } : {}).state
  resolveRain(after)
  return after.players[pid].alive
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

  it('breaks its own runway when it is standing at the windward edge', () => {
    // Backed against the west edge with the wind blowing east: nothing upwind can
    // shield it, so the only way out is to put a step in the path ahead.
    const state = makeState()
    state.phase = 'ticking'
    state.players.A.x = 0
    state.players.A.y = 3
    state.forecast = {
      windCandidates: ['E'],
      rainProbability: 0,
      instrumentsBroken: { A: { vane: false, barometer: false }, B: { vane: false, barometer: false } },
    }

    let survived = 0
    for (let i = 0; i < 50; i++) {
      if (survivesWind(state, 'A', chooseBotAction(state, 'A'), 'E')) survived++
    }
    expect(survived).toBeGreaterThan(35)
  })

  it('defends against every direction when its vane is broken', () => {
    // A step already stands to the east, covering the east-west axis. One more on
    // the north-south axis makes the cell safe from all four winds.
    const state = makeState()
    state.phase = 'ticking'
    state.players.A.x = 3
    state.players.A.y = 3
    setHeight(state, 4, 3, 1)
    state.forecast = {
      windCandidates: ['N'],
      rainProbability: 0,
      instrumentsBroken: { A: { vane: true, barometer: false }, B: { vane: false, barometer: false } },
    }

    let coveredAll = 0
    for (let i = 0; i < 50; i++) {
      const action = chooseBotAction(state, 'A')
      if (WIND_DIRS.every(dir => survivesWind(state, 'A', action, dir))) coveredAll++
    }
    expect(coveredAll).toBeGreaterThan(35)
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
  it('gets out of a hollow before the rain fills it', () => {
    // Walled in on all four sides at the bottom: the cell is a basin of one, and
    // the water has nowhere to drain.
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

    let survived = 0
    for (let i = 0; i < 50; i++) {
      if (survivesRain(state, 'A', chooseBotAction(state, 'A'))) survived++
    }
    expect(survived).toBeGreaterThan(35)
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

describe('chooseBotAction — lightning safety', () => {
  it('under certain lightning the bot never ends the tick exposed', () => {
    // Bot as A on a +1 hill, forecast promises certain lightning, no wind, no rain.
    // Bot can survive by: moving off the hill, lowering the hill under itself, or making the opponent the taller target.
    const s = createInitialState({ A: { x: 3, y: 3 }, B: { x: 5, y: 5 } })
    s.board[3][3].height = 1
    s.board[6][6].height = 1
    s.forecast = {
      windCandidates: [],
      rainProbability: 0,
      lightningProbability: 1.0,
      instrumentsBroken: { A: { vane: false, barometer: false }, B: { vane: false, barometer: false } },
    }

    for (let i = 0; i < 50; i++) {
      const a = chooseBotAction(s, 'A', { skip: 0, blunder: 0, hunt: false })
      // Standing still dies, so a considered bot must act
      expect(a).not.toBeNull()

      // Apply the action and verify the bot survives lightning
      const after = applyTick(s, a ? { A: a } : {}).state
      resolveLightning(after)
      expect(after.players.A.alive).toBe(true)
    }
  })
})

describe('botStrengthForStreak — queue difficulty ramp', () => {
  it('gives a fresh player (streak 0) a gentle, non-hunting bot', async () => {
    const { botStrengthForStreak, BOT_MATCH } = await import('../bot.js')
    const gentle = botStrengthForStreak(0)
    expect(gentle.hunt).toBe(false)
    expect(gentle.blunder).toBeGreaterThan(BOT_MATCH.blunder)
  })

  it('ramps to a hunting mid-tier at streak 1 and full strength from streak 2', async () => {
    const { botStrengthForStreak, BOT_MATCH } = await import('../bot.js')
    const mid = botStrengthForStreak(1)
    expect(mid.hunt).toBe(true)
    expect(mid.blunder).toBeGreaterThan(BOT_MATCH.blunder)
    expect(botStrengthForStreak(2)).toBe(BOT_MATCH)
    expect(botStrengthForStreak(7)).toBe(BOT_MATCH)
  })
})
