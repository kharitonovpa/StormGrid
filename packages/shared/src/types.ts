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

export type WeatherType = 'wind' | 'rain' | 'wind_rain'

export type ForecastData = {
  windCandidates: WindDir[]
  rainProbability: number
  instrumentsBroken: Record<PlayerId, { vane: boolean; barometer: boolean }>
}

/* ── Bonuses ── */

export type BonusType = 'time_extend' | 'intel' | 'clear_sky'

export type BonusCell = {
  x: number
  y: number
  type: BonusType
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

/* ── Tick / Weather results ── */

export type TickResult = {
  state: GameState
  activatedBonus: { player: PlayerId; bonus: BonusType } | null
}

export type WeatherResult = {
  state: GameState
  deaths: PlayerId[]
  windPath: Record<PlayerId, { x: number; y: number }[]>
  floodedCells: { x: number; y: number }[]
  floodedCellsB: { x: number; y: number }[]
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

/* ── Stats ── */

export type WatcherScoreEntry = { userId: string; score: number }

