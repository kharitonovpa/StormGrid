import type { Action, BonusType, CharacterType, DeathCause, GameState, PlayerId, WeatherResult, WeatherType, WindDir, WatcherPrediction, WatcherState, PlayerInfo } from './types.js'

/* ── Client → Server ── */

export type QueueJoinMsg = { type: 'queue:join'; character: CharacterType }
export type QueueLeaveMsg = { type: 'queue:leave' }
export type ActionSubmitMsg = { type: 'action:submit'; action: Action }

export type WatchJoinMsg = { type: 'watch:join' }
export type WatchLeaveMsg = { type: 'watch:leave' }
export type WatcherPredictWinnerMsg = { type: 'watcher:predict_winner'; playerId: PlayerId }
export type WatcherPredictMoveMsg = { type: 'watcher:predict_move'; target: PlayerId; action: Action }
export type WatcherBreakInstrumentMsg = { type: 'watcher:break_instrument'; instrument: 'vane' | 'barometer' }

export type ArchitectJoinMsg = { type: 'architect:join' }
export type ArchitectLeaveMsg = { type: 'architect:leave' }
export type ArchitectSetWeatherMsg = { type: 'architect:set_weather'; weatherType: WeatherType; dir: WindDir }
export type ArchitectPlaceBonusMsg = { type: 'architect:place_bonus'; x: number; y: number; bonusType: BonusType }

export type ReconnectMsg = { type: 'reconnect'; token: string }

export type ClientMessage =
  | QueueJoinMsg
  | QueueLeaveMsg
  | ActionSubmitMsg
  | WatchJoinMsg
  | WatchLeaveMsg
  | WatcherPredictWinnerMsg
  | WatcherPredictMoveMsg
  | WatcherBreakInstrumentMsg
  | ArchitectJoinMsg
  | ArchitectLeaveMsg
  | ArchitectSetWeatherMsg
  | ArchitectPlaceBonusMsg
  | ReconnectMsg

/* ── Server → Client ── */

export type QueueWaitingMsg = { type: 'queue:waiting'; maxWaitMs: number }
export type GameStartMsg = { type: 'game:start'; playerId: PlayerId; state: GameState; reconnectToken: string; roomId: string; playerInfo: Record<PlayerId, PlayerInfo> }
export type RoundStartMsg = { type: 'round:start'; state: GameState; forecastDeadline: number }
export type TickStartMsg = { type: 'tick:start'; tick: number; deadline: number }
export type TickResolveMsg = { type: 'tick:resolve'; state: GameState }
export type WeatherResultMsg = { type: 'weather:result'; result: WeatherResult }
export type GameEndMsg = { type: 'game:end'; winner: PlayerId | 'draw'; deathCauses?: Partial<Record<PlayerId, DeathCause>> }
export type ErrorMsg = { type: 'error'; message: string }

export type WatchAssignedMsg = { type: 'watch:assigned'; roomId: string; state: GameState; watcherState: WatcherState; playerInfo?: Record<PlayerId, PlayerInfo> }
export type WatchNoMatchMsg = { type: 'watch:no_match' }
export type WatcherScoreMsg = { type: 'watcher:score'; delta: number; total: number; prediction: WatcherPrediction }
export type WatcherRedirectMsg = { type: 'watcher:redirect'; roomId: string }

export type ArchitectAssignedMsg = { type: 'architect:assigned'; roomId: string; state: GameState; playerInfo?: Record<PlayerId, PlayerInfo> }
export type ArchitectNoMatchMsg = { type: 'architect:no_match' }
export type ArchitectPromptMsg = { type: 'architect:prompt'; deadline: number }

export type ForecastUpdateMsg = { type: 'forecast:update'; state: GameState }

export type LobbyStatusMsg = { type: 'lobby:status'; online: number; inQueue: number }

export type ReconnectOkMsg = { type: 'reconnect:ok'; playerId: PlayerId; state: GameState; tick: number; deadline: number; forecastDeadline: number; playerInfo?: Record<PlayerId, PlayerInfo> }
export type ReconnectFailMsg = { type: 'reconnect:fail' }
export type OpponentDisconnectedMsg = { type: 'opponent:disconnected' }
export type OpponentReconnectedMsg = { type: 'opponent:reconnected' }

/* ── Replay ── */

export type ReplayFrame = {
  state: GameState
  weather?: {
    deaths: PlayerId[]
    windPath: Record<PlayerId, { x: number; y: number }[]>
    floodedCells: { x: number; y: number }[]
  }
}

export type ReplaySummary = {
  id: string
  charA: CharacterType
  charB: CharacterType
  winner: PlayerId | 'draw' | null
  frameCount: number
}

export type ReplayData = ReplaySummary & { frames: ReplayFrame[] }

/* ── Match History ── */

export type MatchSummary = {
  id: string
  roomId: string
  characterA: string
  characterB: string
  winner: string | null
  rounds: number
  durationMs: number
  playedAt: string
}

/* ── Leaderboard ── */

export type PlayerLeaderboardEntry = {
  userId: string
  name: string
  avatar: string | null
  wins: number
  losses: number
  draws: number
  gamesPlayed: number
}

export type WatcherLeaderboardEntry = {
  userId: string
  name: string
  avatar: string | null
  watcherScore: number
}

export type Paginated<T> = {
  items: T[]
  total: number
}

export type ServerMessage =
  | QueueWaitingMsg
  | GameStartMsg
  | RoundStartMsg
  | TickStartMsg
  | TickResolveMsg
  | WeatherResultMsg
  | GameEndMsg
  | ErrorMsg
  | WatchAssignedMsg
  | WatchNoMatchMsg
  | WatcherScoreMsg
  | WatcherRedirectMsg
  | ArchitectAssignedMsg
  | ArchitectNoMatchMsg
  | ArchitectPromptMsg
  | ForecastUpdateMsg
  | LobbyStatusMsg
  | ReconnectOkMsg
  | ReconnectFailMsg
  | OpponentDisconnectedMsg
  | OpponentReconnectedMsg
