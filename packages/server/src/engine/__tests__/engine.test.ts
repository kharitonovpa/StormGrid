import { describe, it, expect } from 'bun:test'
import { GameEngine } from '../GameEngine.js'
import { stateForPlayer } from '../board.js'
import { BOARD_SIZE, TICKS_PER_ROUND, SPAWN_PAIRS } from '@wheee/shared'

const FIXED_SPAWN = SPAWN_PAIRS[0]

describe('GameEngine — full round lifecycle', () => {
  it('initializes with flat board and both players alive at spawn positions', () => {
    const engine = new GameEngine(FIXED_SPAWN)
    const s = engine.getState()

    expect(s.board.length).toBe(BOARD_SIZE)
    expect(s.board[0].length).toBe(BOARD_SIZE)
    expect(s.players.A.alive).toBe(true)
    expect(s.players.B.alive).toBe(true)
    expect(s.players.A.x).toBe(FIXED_SPAWN.A.x)
    expect(s.players.A.y).toBe(FIXED_SPAWN.A.y)
    expect(s.players.B.x).toBe(FIXED_SPAWN.B.x)
    expect(s.players.B.y).toBe(FIXED_SPAWN.B.y)
    expect(s.tick).toBe(0)
    expect(s.round).toBe(1)
  })

  it('runs a full round: forecast → 5 ticks → weather', () => {
    const engine = new GameEngine(FIXED_SPAWN)

    const forecast = engine.startRound()
    expect(forecast.phase).toBe('forecast')
    expect(forecast.forecast).toBeDefined()

    const ticking = engine.beginTicking()
    expect(ticking.phase).toBe('ticking')

    for (let i = 0; i < TICKS_PER_ROUND; i++) {
      engine.submitTick({})
    }

    const s = engine.getState()
    expect(s.phase).toBe('weather')
    expect(s.tick).toBe(TICKS_PER_ROUND)

    const weatherResult = engine.executeWeather()
    expect(weatherResult.state).toBeDefined()
    expect(weatherResult.state.weather).not.toBeNull()
  })

  it('rejects tick in wrong phase', () => {
    const engine = new GameEngine(FIXED_SPAWN)
    engine.startRound()
    // still in 'forecast' phase
    expect(() => engine.submitTick({})).toThrow()
  })

  it('rejects weather in wrong phase', () => {
    const engine = new GameEngine(FIXED_SPAWN)
    engine.startRound()
    expect(() => engine.executeWeather()).toThrow()
  })

  it('runway tiebreak: the player closest to the leeward edge loses', () => {
    const engine = new GameEngine(FIXED_SPAWN)
    engine.startRound()
    engine.beginTicking()

    // A walks to the east edge; B stays four cells away from it.
    engine.submitTick({ A: { kind: 'move', dir: 'E' } })
    engine.submitTick({ A: { kind: 'move', dir: 'E' } })
    engine.submitTick({ A: { kind: 'move', dir: 'E' } })
    engine.submitTick({})
    engine.submitTick({})

    engine.setWeatherDecision('wind', 'E')

    const result = engine.executeWeather()
    expect(result.deaths).toEqual(['A'])
    expect(result.windSpared).toBe('B')
    expect(result.state.winner).toBe('B')
    // A flew off on his first step, so the storm never moved B.
    expect(result.state.players.B.x).toBe(FIXED_SPAWN.B.x)
  })

  it('detects draw when both players die with equal runways', () => {
    const engine = new GameEngine(FIXED_SPAWN)
    engine.startRound()
    engine.beginTicking()

    // Nobody moves: both spawn on x=3, so both have the same runway east.
    for (let i = 0; i < TICKS_PER_ROUND; i++) engine.submitTick({})

    engine.setWeatherDecision('wind', 'E')

    const result = engine.executeWeather()
    expect(result.deaths).toContain('A')
    expect(result.deaths).toContain('B')
    expect(result.windSpared).toBe(null)
    expect(result.state.winner).toBe('draw')
  })
})

describe('GameEngine — character selection', () => {
  it('sets characters for both players', () => {
    const engine = new GameEngine(FIXED_SPAWN)
    engine.setCharacters('rice', 'corn')
    const s = engine.getState()
    expect(s.players.A.character).toBe('rice')
    expect(s.players.B.character).toBe('corn')
  })
})

describe('stateForPlayer — height inversion for B', () => {
  it('A sees canonical heights, B sees negated heights', () => {
    const engine = new GameEngine(FIXED_SPAWN)
    engine.startRound()
    engine.beginTicking()

    engine.submitTick({ A: { kind: 'raise', x: 0, y: 0 } })

    const canonical = engine.getState()
    expect(canonical.board[0][0].height).toBe(1)

    const forA = stateForPlayer(canonical, 'A')
    expect(forA.board[0][0].height).toBe(1)

    const forB = stateForPlayer(canonical, 'B')
    expect(forB.board[0][0].height).toBe(-1)
  })

  it('B raise is inverted to lower on canonical board', () => {
    const engine = new GameEngine(FIXED_SPAWN)
    engine.startRound()
    engine.beginTicking()

    // Simulate what Room does: B sends 'raise', server inverts to 'lower'
    const invertedAction = { kind: 'lower' as const, x: 0, y: 0 }
    engine.submitTick({ B: invertedAction })

    const canonical = engine.getState()
    expect(canonical.board[0][0].height).toBe(-1)

    const forB = stateForPlayer(canonical, 'B')
    expect(forB.board[0][0].height).toBe(1)
  })
})

describe('GameEngine — architect weather override', () => {
  it('allows architect to set weather decision', () => {
    const engine = new GameEngine(FIXED_SPAWN)
    engine.startRound()
    engine.setWeatherDecision('rain', 'N')
    engine.beginTicking()

    for (let i = 0; i < TICKS_PER_ROUND; i++) {
      engine.submitTick({})
    }

    const result = engine.executeWeather()
    expect(result.state.weather!.type).toBe('rain')
  })
})
