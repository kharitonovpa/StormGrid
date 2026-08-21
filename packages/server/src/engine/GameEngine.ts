import type {
  Action,
  BonusType,
  DeathCause,
  GameState,
  PlayerId,
  WeatherType,
  WindDir,
  TickResult,
  WeatherResult,
  CharacterType,
} from '@wheee/shared'
import { BOARD_SIZE, TICKS_PER_ROUND, SPAWN_PAIRS, hasWind, hasRain, hasLightning } from '@wheee/shared'
import { createInitialState, cloneState } from './board.js'
import { applyTick } from './tick.js'
import { resolveWind } from './wind.js'
import { resolveRain } from './rain.js'
import { resolveLightning } from './lightning.js'
import { generateForecast, randomWeatherDecision } from './forecast.js'
import type { WeatherDecision } from './forecast.js'

export class GameEngine {
  private state: GameState
  private weatherDecision: WeatherDecision | null = null
  /**
   * Gates lightning entirely. Two callers land on this one flag: practice
   * (tutorial matches must never see lightning — owner ruling) and rooms
   * where not every human client declared the `lightning` capability (old
   * portal build on the client side — backward-compat handshake). Room
   * computes `!practice && opts.lightningEnabled` and passes the result
   * here; the engine itself doesn't know or care which reason applies.
   */
  private readonly lightningEnabled: boolean

  constructor(spawn?: typeof SPAWN_PAIRS[number], lightningEnabled = true) {
    this.state = createInitialState(spawn)
    this.lightningEnabled = lightningEnabled
  }

  /** Set character choices before the game starts. */
  setCharacters(a: CharacterType, b: CharacterType): void {
    this.state.players.A.character = a
    this.state.players.B.character = b
  }

  /** Start round: generate weather decision + forecast, set phase. */
  startRound(): GameState {
    this.weatherDecision = randomWeatherDecision(this.clampedRound())
    this.state.forecast = generateForecast(this.weatherDecision)
    this.state.phase = 'forecast'
    this.state.tick = 0
    this.state.weather = null
    return this.getState()
  }

  /**
   * Override weather decision (Architect mode). With lightning disabled, a
   * lightning-bearing order is coerced to its base type — the architect
   * keeps their wind/rain call, just without the bolt.
   * Must be called after startRound() and before any tick.
   */
  setWeatherDecision(type: WeatherType, dir: WindDir): void {
    this.weatherDecision = { type: this.lightningEnabled ? type : stripLightning(type), dir }
    this.state.forecast = generateForecast(this.weatherDecision)
  }

  /**
   * The one clamp: when lightning is disabled, the schedule round is capped
   * at the pre-lightning tier no matter how far the real round counter has
   * climbed (practice's tutorial round count included).
   */
  private clampedRound(): number {
    return this.lightningEnabled ? this.state.round : Math.min(this.state.round, 2)
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
    const deathCauses: Partial<Record<PlayerId, DeathCause>> = {}
    let windPaths: Record<PlayerId, { x: number; y: number }[]> = { A: [], B: [] }
    let windSpared: PlayerId | null = null
    let floodedCellsA: { x: number; y: number }[] = []
    let floodedCellsB: { x: number; y: number }[] = []
    let rainSpared: PlayerId | null = null
    let waterVolume = 0
    let boltCell: Record<PlayerId, { x: number; y: number } | null> = { A: null, B: null }
    let lightningSpared: PlayerId | null = null

    if (hasLightning(decision.type)) {
      const lr = resolveLightning(this.state)
      deaths.push(...lr.deaths)
      Object.assign(deathCauses, lr.deathCauses)
      boltCell = lr.boltCell
      lightningSpared = lr.spared
    }

    // The storm breaks off on the first death: a bolt that took someone ends
    // the round before the gale, exactly as the gale ends it before the rain.
    if (hasWind(decision.type) && deaths.length === 0) {
      const wr = resolveWind(this.state, decision.dir)
      deaths.push(...wr.deaths)
      Object.assign(deathCauses, wr.deathCauses)
      windPaths = wr.paths
      windSpared = wr.spared
    }

    const rains = hasRain(decision.type) && deaths.length === 0

    if (rains) {
      const rr = resolveRain(this.state)
      deaths.push(...rr.deaths)
      Object.assign(deathCauses, rr.deathCauses)
      floodedCellsA = rr.floodedCellsA
      floodedCellsB = rr.floodedCellsB
      rainSpared = rr.spared
      waterVolume = rr.waterVolume
    }

    this.resolveWinner()

    if (this.state.winner === null) {
      this.state.round += 1
    }

    return {
      state: this.getState(),
      deaths: [...new Set(deaths)],
      deathCauses,
      windPath: windPaths,
      windSpared,
      floodedCells: floodedCellsA,
      floodedCellsB,
      rainSpared,
      waterVolume,
      boltCell,
      lightningSpared,
    }
  }

  /** Break a player's forecast instrument (watcher ability). */
  breakInstrument(target: PlayerId, instrument: 'vane' | 'barometer'): void {
    this.state.forecast.instrumentsBroken[target][instrument] = true
  }

  /**
   * Place a bonus on the board (architect ability, or the room's own crate).
   * `forPlayer` addresses it to one player — see BonusCell.for.
   */
  placeBonus(x: number, y: number, type: BonusType, forPlayer?: PlayerId): boolean {
    if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return false
    const { A, B } = this.state.players
    if ((A.alive && A.x === x && A.y === y) || (B.alive && B.x === x && B.y === y)) return false
    this.state.activeBonus = { x, y, type, ...(forPlayer ? { for: forPlayer } : {}) }
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

/** lightning → wind, wind_lightning → wind, rain_lightning → rain, wind_rain_lightning → wind_rain. */
const LIGHTNING_BASE_TYPE: Partial<Record<WeatherType, WeatherType>> = {
  lightning: 'wind',
  wind_lightning: 'wind',
  rain_lightning: 'rain',
  wind_rain_lightning: 'wind_rain',
}

function stripLightning(type: WeatherType): WeatherType {
  return LIGHTNING_BASE_TYPE[type] ?? type
}
