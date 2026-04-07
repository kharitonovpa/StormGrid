import type {
  Action,
  BonusType,
  GameState,
  PlayerId,
  WeatherType,
  WindDir,
  TickResult,
  WeatherResult,
  CharacterType,
} from '@stormgrid/shared'
import { BOARD_SIZE, TICKS_PER_ROUND, SPAWN_PAIRS } from '@stormgrid/shared'
import { createInitialState, cloneState } from './board.js'
import { applyTick } from './tick.js'
import { resolveWind } from './wind.js'
import { resolveRain } from './rain.js'
import { generateForecast, randomWeatherDecision } from './forecast.js'
import type { WeatherDecision } from './forecast.js'

export class GameEngine {
  private state: GameState
  private weatherDecision: WeatherDecision | null = null

  constructor(spawn?: typeof SPAWN_PAIRS[number]) {
    this.state = createInitialState(spawn)
  }

  /** Set character choices before the game starts. */
  setCharacters(a: CharacterType, b: CharacterType): void {
    this.state.players.A.character = a
    this.state.players.B.character = b
  }

  /** Start round: generate weather decision + forecast, set phase. */
  startRound(): GameState {
    this.weatherDecision = randomWeatherDecision()
    this.state.forecast = generateForecast(this.weatherDecision)
    this.state.phase = 'forecast'
    this.state.tick = 0
    this.state.weather = null
    return this.getState()
  }

  /**
   * Override weather decision (Architect mode).
   * Must be called after startRound() and before any tick.
   */
  setWeatherDecision(type: WeatherType, dir: WindDir): void {
    this.weatherDecision = { type, dir }
    this.state.forecast = generateForecast(this.weatherDecision)
  }

  /** Begin the ticking phase (after forecast is shown). */
  beginTicking(): GameState {
    this.state.phase = 'ticking'
    return this.getState()
  }

  /**
   * Apply one tick with the given player actions.
   * Returns the new state + any bonus activation.
   */
  submitTick(actions: Partial<Record<PlayerId, Action>>): TickResult {
    if (this.state.phase !== 'ticking') {
      throw new Error(`Cannot tick in phase "${this.state.phase}"`)
    }

    const result = applyTick(this.state, actions)
    this.state = result.state

    if (this.state.tick >= TICKS_PER_ROUND) {
      this.state.phase = 'weather'
    }

    return result
  }

  /** Execute the weather cataclysm for the current round. */
  executeWeather(): WeatherResult {
    if (this.state.phase !== 'weather') {
      throw new Error(`Cannot execute weather in phase "${this.state.phase}"`)
    }

    if (!this.weatherDecision) throw new Error('No weather decision — call startRound() first')
    const decision = this.weatherDecision
    this.state.weather = { type: decision.type, dir: decision.dir }

    const deaths: PlayerId[] = []
    let windPaths: Record<PlayerId, { x: number; y: number }[]> = { A: [], B: [] }
    let floodedCellsA: { x: number; y: number }[] = []
    let floodedCellsB: { x: number; y: number }[] = []

    if (decision.type === 'wind' || decision.type === 'wind_rain') {
      const wr = resolveWind(this.state, decision.dir)
      deaths.push(...wr.deaths)
      windPaths = wr.paths
    }

    if (decision.type === 'rain' || decision.type === 'wind_rain') {
      const rr = resolveRain(this.state)
      deaths.push(...rr.deaths)
      floodedCellsA = rr.floodedCellsA
      floodedCellsB = rr.floodedCellsB
    }

    this.resolveWinner()

    if (this.state.winner === null) {
      this.state.round += 1
    }

    return {
      state: this.getState(),
      deaths: [...new Set(deaths)],
      windPath: windPaths,
      floodedCells: floodedCellsA,
      floodedCellsB,
    }
  }

  /** Break a player's forecast instrument (watcher ability). */
  breakInstrument(target: PlayerId, instrument: 'vane' | 'barometer'): void {
    this.state.forecast.instrumentsBroken[target][instrument] = true
  }

  /** Place a bonus on the board (architect ability). */
  placeBonus(x: number, y: number, type: BonusType): boolean {
    if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return false
    const { A, B } = this.state.players
    if ((A.alive && A.x === x && A.y === y) || (B.alive && B.x === x && B.y === y)) return false
    this.state.activeBonus = { x, y, type }
    return true
  }

  getState(): GameState {
    return cloneState(this.state)
  }

  /** Determine winner based on alive status. */
  private resolveWinner(): void {
    const aAlive = this.state.players.A.alive
    const bAlive = this.state.players.B.alive

    if (!aAlive && !bAlive) {
      this.state.winner = 'draw'
      this.state.phase = 'finished'
    } else if (!aAlive) {
      this.state.winner = 'B'
      this.state.phase = 'finished'
    } else if (!bAlive) {
      this.state.winner = 'A'
      this.state.phase = 'finished'
    }
  }
}
