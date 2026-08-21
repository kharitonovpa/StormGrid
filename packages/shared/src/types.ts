/* ── Board ── */

export type Height = -1 | 0 | 1

export type Cell = {
  height: Height
  bonus: BonusType | null
}

/* ── Characters ── */

export type CharacterType = 'wheat' | 'rice' | 'corn'

/* ── Player ── */

export type Player = {
  id: 'A' | 'B'
  x: number
  y: number
  character: CharacterType
  alive: boolean
}

export type PlayerId = 'A' | 'B'

/* ── Weather ── */

export type WindDir = 'N' | 'S' | 'E' | 'W'

export type MoveDir = 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW'

export type WeatherType =
  | 'wind' | 'rain' | 'wind_rain'
  | 'lightning' | 'wind_lightning' | 'rain_lightning' | 'wind_rain_lightning'

export type ForecastData = {
  windCandidates: WindDir[]
  rainProbability: number
  lightningProbability: number
  instrumentsBroken: Record<PlayerId, { vane: boolean; barometer: boolean }>
}

/* ── Bonuses ── */

export type BonusType = 'time_extend' | 'intel' | 'clear_sky'

export type BonusCell = {
  x: number
  y: number
  type: BonusType
  /**
   * Who may pick it up. The crate seeds a streak badge, so it is addressed to a
   * player who has none — the other one walks straight through and it stays put,
   * which stops a veteran denying a newcomer their way in. Undefined means
   * anyone, which is how the architect places one.
   */
  for?: PlayerId
}

/* ── Roles ── */

export type Role = 'guest' | 'player' | 'watcher' | 'architect'

/* ── Actions ── */

export type ActionKind = 'move' | 'raise' | 'lower'

export type MoveAction = {
  kind: 'move'
  dir: MoveDir
}

export type RaiseAction = {
  kind: 'raise'
  x: number
  y: number
}

export type LowerAction = {
  kind: 'lower'
  x: number
  y: number
}

export type Action = MoveAction | RaiseAction | LowerAction

/* ── Game State ── */

export type GamePhase = 'waiting' | 'forecast' | 'ticking' | 'weather' | 'finished'

export type GameState = {
  board: Cell[][]
  players: Record<PlayerId, Player>
  tick: number
  round: number
  phase: GamePhase
  forecast: ForecastData
  activeBonus: BonusCell | null
  weather: { type: WeatherType; dir: WindDir } | null
  winner: PlayerId | 'draw' | null
}

/* ── Death causes ── */

export type DeathCause =
  | { type: 'wind'; dir: WindDir }
  | { type: 'rain' }
  | { type: 'lightning' }
  | { type: 'disconnect' }

/* ── Tick / Weather results ── */

export type TickResult = {
  state: GameState
  activatedBonus: { player: PlayerId; bonus: BonusType } | null
}

export type WeatherResult = {
  state: GameState
  deaths: PlayerId[]
  deathCauses: Partial<Record<PlayerId, DeathCause>>
  windPath: Record<PlayerId, { x: number; y: number }[]>
  /** Player the wind spared because the other one left the board first. */
  windSpared: PlayerId | null
  floodedCells: { x: number; y: number }[]
  floodedCellsB: { x: number; y: number }[]
  /** Player the water spared because the other one went under first. */
  rainSpared: PlayerId | null
  /**
   * How much water came down, in cell-depths: a basin of N cells stands at
   * min(1, waterVolume / N) of its depth. 0 means the rain never fell.
   */
  waterVolume: number
  /** Where the bolt landed on each side: the player's cell on a kill, the absorbing rod otherwise. Null when no lightning fell on that side. */
  boltCell: Record<PlayerId, { x: number; y: number } | null>
  /** Player the bolt passed over because the other crown stood taller. */
  lightningSpared: PlayerId | null
}

/* ── Watcher ── */

export type WatcherPrediction = {
  type: 'winner' | 'move'
  round: number
  tick?: number
  target?: PlayerId
  predictedWinner?: PlayerId
  predictedAction?: Action
  correct: boolean | null
  points: number
}

export type WatcherState = {
  score: number
  predictions: WatcherPrediction[]
  breakUsed: boolean
}

/* ── Auth ── */

export type UserInfo = {
  id: string
  name: string
  avatar: string | null
}

export type PlayerInfo = {
  displayName: string
  flag: string
  /** Length of the badge streak; 0 means no badge. Cosmetic — see badgeFor(). */
  streak: number
}

/* ── Stats ── */

export type WatcherScoreEntry = { userId: string; score: number }

