import type { Action, BonusType, CharacterType, DeathCause, GameState, PlayerId, WeatherResult, WeatherType, WindDir, WatcherPrediction, WatcherState, PlayerInfo } from './types.js'

/* ── Client → Server ── */

/**
 * `streak` is the player's badge length, self-reported: it is cosmetic only.
 * `caps` declares client-side feature support (currently just `'lightning'`)
 * so a room can tell an up-to-date client from an old portal build that
 * cannot render the bolt — see GameEngine's lightningEnabled flag. Absence of
 * the field means an old client: never assume support that wasn't declared.
 */
export type QueueJoinMsg = { type: 'queue:join'; character: CharacterType; streak?: number; caps?: string[] }
export type QueueLeaveMsg = { type: 'queue:leave' }
export type PracticeStartMsg = { type: 'practice:start'; character: CharacterType; streak?: number }
/**
 * Skip the queue and start against a bot at once. This is what a rewarded ad
 * buys: the wait already exists (BOT_MATCH_DELAY_MS), so nothing is invented to
 * sell. A full match in every other way — it counts, unlike practice.
 */
export type InstantStartMsg = { type: 'instant:start'; character: CharacterType; streak?: number; caps?: string[] }
export type ActionSubmitMsg = { type: 'action:submit'; action: Action }

/**
 * A private match by link. `friend:create` parks the sender under a short code
 * (no bot fallback — the wait is for one specific person); `friend:join` is what
 * the invited side sends after opening the link with that code.
 * Discord instances pass a deterministic `dc-<instanceId>` code — the server treats a taken code as a join (create-or-join), so both sides can send the same message.
 */
export type FriendCreateMsg = { type: 'friend:create'; character: CharacterType; streak?: number; caps?: string[]; code?: string }
export type FriendCancelMsg = { type: 'friend:cancel' }
export type FriendJoinMsg = { type: 'friend:join'; code: string; character: CharacterType; streak?: number; caps?: string[] }

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

/** Keepalive. Sent every few seconds so an idle socket is never mistaken for a dead one. */
/** `active` — the tab is visible and was touched within the last minute. Absent on old clients. */
export type PingMsg = { type: 'ping'; active?: boolean }

/**
 * A rematch against the same opponent. Symmetric on purpose: the first
 * `rematch:want` is an offer, the second is the acceptance, so neither client
 * has to know which side it is. `character` lets each player re-pick their
 * culture; the new room inherits the finished match's lightning setting rather
 * than re-reading caps, since the pair is unchanged.
 */
export type RematchWantMsg = { type: 'rematch:want'; character: CharacterType; streak?: number; caps?: string[] }
export type RematchCancelMsg = { type: 'rematch:cancel' }

export type ClientMessage =
  | RematchWantMsg
  | RematchCancelMsg
  | QueueJoinMsg
  | QueueLeaveMsg
  | PracticeStartMsg
  | InstantStartMsg
  | FriendCreateMsg
  | FriendCancelMsg
  | FriendJoinMsg
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
  | PingMsg

/* ── Server → Client ── */

export type PongMsg = { type: 'pong' }

export type QueueWaitingMsg = { type: 'queue:waiting'; maxWaitMs: number }
/** The invite is live; `code` is what goes into the link. */
export type FriendWaitingMsg = { type: 'friend:waiting'; code: string }
/** The code did not resolve: expired, already used, or the creator left. */
export type FriendJoinFailMsg = { type: 'friend:join_fail' }
export type GameStartMsg = { type: 'game:start'; playerId: PlayerId; state: GameState; reconnectToken: string; roomId: string; playerInfo: Record<PlayerId, PlayerInfo>; practice?: boolean }
export type RoundStartMsg = { type: 'round:start'; state: GameState; forecastDeadline: number }
/** `deadline: 0` means the tick is untimed (practice mode — waits for the player's action). */
export type TickStartMsg = { type: 'tick:start'; tick: number; deadline: number }
/** `bonus` is set on the tick where a crate was picked up — it seeds the badge. */
export type TickResolveMsg = { type: 'tick:resolve'; state: GameState; bonus?: { player: PlayerId; type: BonusType } }
export type WeatherResultMsg = { type: 'weather:result'; result: WeatherResult }
/** `rematchOffered` — a PvP ending with both humans still here; a `rematch:available` follows for old clients. */
export type GameEndMsg = { type: 'game:end'; winner: PlayerId | 'draw'; deathCauses?: Partial<Record<PlayerId, DeathCause>>; rematchOffered?: boolean }
export type ErrorMsg = { type: 'error'; message: string }

export type WatchAssignedMsg = { type: 'watch:assigned'; roomId: string; state: GameState; watcherState: WatcherState; playerInfo?: Record<PlayerId, PlayerInfo> }
export type WatchNoMatchMsg = { type: 'watch:no_match' }
export type WatcherScoreMsg = { type: 'watcher:score'; delta: number; total: number; prediction: WatcherPrediction }
export type WatcherRedirectMsg = { type: 'watcher:redirect'; roomId: string }

export type ArchitectAssignedMsg = { type: 'architect:assigned'; roomId: string; state: GameState; playerInfo?: Record<PlayerId, PlayerInfo> }
export type ArchitectNoMatchMsg = { type: 'architect:no_match' }
export type ArchitectPromptMsg = { type: 'architect:prompt'; deadline: number }

export type ForecastUpdateMsg = { type: 'forecast:update'; state: GameState }

/** `liveMatches` counts rooms a watcher could actually be dropped into. */
export type LobbyStatusMsg = { type: 'lobby:status'; online: number; inQueue: number; liveMatches: number }

export type ReconnectOkMsg = { type: 'reconnect:ok'; playerId: PlayerId; state: GameState; tick: number; deadline: number; forecastDeadline: number; playerInfo?: Record<PlayerId, PlayerInfo> }
export type ReconnectFailMsg = { type: 'reconnect:fail' }
export type OpponentDisconnectedMsg = { type: 'opponent:disconnected' }
export type OpponentReconnectedMsg = { type: 'opponent:reconnected' }
/**
 * The other player has locked in a move this tick. What the move is stays
 * secret until the tick resolves — this only proves someone is alive out there.
 */
export type OpponentActedMsg = { type: 'opponent:acted'; tick: number }

/* ── Replay ── */

export type ReplayFrame = {
  state: GameState
  weather?: {
    deaths: PlayerId[]
    windPath: Record<PlayerId, { x: number; y: number }[]>
    floodedCells: { x: number; y: number }[]
    boltCell?: Record<PlayerId, { x: number; y: number } | null>
  }
}

export type ReplaySummary = {
  id: string
  charA: CharacterType
  charB: CharacterType
  winner: PlayerId | 'draw' | null
  frameCount: number
  /** Display names as shown on the nameplates; absent on replays saved before they were stored. */
  nameA?: string
  nameB?: string
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
  /** Match points; the board is ordered by these. */
  points: number
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

/** The pairing is alive and both sides may ask for another match. */
export type RematchAvailableMsg = { type: 'rematch:available' }
/** You asked; the opponent has not answered yet. */
export type RematchWaitingMsg = { type: 'rematch:waiting' }
/** The opponent asked first — answering starts the match. */
export type RematchOfferedMsg = { type: 'rematch:offered' }
/** Off the table: declined, left, or the window closed. */
export type RematchOffMsg = { type: 'rematch:off' }

export type ServerMessage =
  | RematchAvailableMsg
  | RematchWaitingMsg
  | RematchOfferedMsg
  | RematchOffMsg
  | QueueWaitingMsg
  | FriendWaitingMsg
  | FriendJoinFailMsg
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
  | OpponentActedMsg
  | PongMsg
