import type { Action, BonusType, GameState, PlayerId, WeatherResult, WeatherType, WindDir, WatcherPrediction, WatcherState } from './types.js'

/* ── Client → Server ── */

export type QueueJoinMsg = { type: 'queue:join' }
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

/* ── Server → Client ── */

export type QueueWaitingMsg = { type: 'queue:waiting' }
export type GameStartMsg = { type: 'game:start'; playerId: PlayerId; state: GameState }
export type RoundStartMsg = { type: 'round:start'; state: GameState }
export type TickStartMsg = { type: 'tick:start'; tick: number; deadline: number }
export type TickResolveMsg = { type: 'tick:resolve'; state: GameState }
export type WeatherResultMsg = { type: 'weather:result'; result: WeatherResult }
export type GameEndMsg = { type: 'game:end'; winner: PlayerId | 'draw' }
export type ErrorMsg = { type: 'error'; message: string }

export type WatchAssignedMsg = { type: 'watch:assigned'; roomId: string; state: GameState; watcherState: WatcherState }
export type WatchNoMatchMsg = { type: 'watch:no_match' }
export type WatcherScoreMsg = { type: 'watcher:score'; delta: number; total: number; prediction: WatcherPrediction }
export type WatcherRedirectMsg = { type: 'watcher:redirect'; roomId: string }

export type ArchitectAssignedMsg = { type: 'architect:assigned'; roomId: string; state: GameState }
export type ArchitectNoMatchMsg = { type: 'architect:no_match' }
export type ArchitectPromptMsg = { type: 'architect:prompt'; deadline: number }

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
