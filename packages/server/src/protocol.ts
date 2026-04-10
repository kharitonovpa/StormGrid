import type { ServerWebSocket } from 'bun'
import type { PlayerId, Role } from '@wheee/shared'
import { BOARD_SIZE, CHARACTERS, WIND_DIRS, WEATHER_TYPES, MOVE_DIRS } from '@wheee/shared'

export type {
  ClientMessage,
  ServerMessage,
  QueueJoinMsg,
  QueueLeaveMsg,
  ActionSubmitMsg,
  WatchJoinMsg,
  WatchLeaveMsg,
  WatcherPredictWinnerMsg,
  WatcherPredictMoveMsg,
  WatcherBreakInstrumentMsg,
  ArchitectJoinMsg,
  ArchitectLeaveMsg,
  ArchitectSetWeatherMsg,
  ArchitectPlaceBonusMsg,
  QueueWaitingMsg,
  GameStartMsg,
  RoundStartMsg,
  TickStartMsg,
  TickResolveMsg,
  WeatherResultMsg,
  GameEndMsg,
  ErrorMsg,
  WatchAssignedMsg,
  WatchNoMatchMsg,
  WatcherScoreMsg,
  WatcherRedirectMsg,
  ArchitectAssignedMsg,
  ArchitectNoMatchMsg,
  ArchitectPromptMsg,
  ForecastUpdateMsg,
  LobbyStatusMsg,
  ReconnectMsg,
  ReconnectOkMsg,
  ReconnectFailMsg,
  OpponentDisconnectedMsg,
  OpponentReconnectedMsg,
} from '@wheee/shared'

import type { ClientMessage, ServerMessage } from '@wheee/shared'

const VALID_MOVE_DIRS = new Set(Object.keys(MOVE_DIRS))
const VALID_WIND_DIRS = new Set(WIND_DIRS)
const VALID_WEATHER_TYPES = new Set(WEATHER_TYPES)
const VALID_ACTION_KINDS = new Set(['move', 'raise', 'lower'])
const VALID_PLAYER_IDS = new Set(['A', 'B'])
const VALID_INSTRUMENTS = new Set(['vane', 'barometer'])
const VALID_BONUS_TYPES = new Set(['time_extend', 'intel', 'clear_sky'])
const VALID_CHARACTERS = new Set(CHARACTERS)

function isValidAction(a: unknown): boolean {
  if (typeof a !== 'object' || a === null) return false
  const obj = a as Record<string, unknown>
  if (!VALID_ACTION_KINDS.has(obj.kind as string)) return false
  if (obj.kind === 'move') return VALID_MOVE_DIRS.has(obj.dir as string)
  return Number.isInteger(obj.x) && Number.isInteger(obj.y)
    && (obj.x as number) >= 0 && (obj.x as number) < BOARD_SIZE
    && (obj.y as number) >= 0 && (obj.y as number) < BOARD_SIZE
}

function isValidCoord(v: unknown): boolean {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) < BOARD_SIZE
}

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const msg = JSON.parse(raw)
    if (typeof msg !== 'object' || msg === null || typeof msg.type !== 'string') return null

    switch (msg.type) {
      case 'queue:join':
        if (!VALID_CHARACTERS.has(msg.character)) return null
        return msg
      case 'queue:leave':
      case 'watch:join':
      case 'watch:leave':
      case 'architect:join':
      case 'architect:leave':
        return msg
      case 'action:submit':
        if (!isValidAction(msg.action)) return null
        return msg
      case 'watcher:predict_winner':
        if (!VALID_PLAYER_IDS.has(msg.playerId)) return null
        return msg
      case 'watcher:predict_move':
        if (!VALID_PLAYER_IDS.has(msg.target)) return null
        if (!isValidAction(msg.action)) return null
        return msg
      case 'watcher:break_instrument':
        if (!VALID_INSTRUMENTS.has(msg.instrument)) return null
        return msg
      case 'architect:set_weather':
        if (!VALID_WEATHER_TYPES.has(msg.weatherType)) return null
        if (!VALID_WIND_DIRS.has(msg.dir)) return null
        return msg
      case 'architect:place_bonus':
        if (!isValidCoord(msg.x) || !isValidCoord(msg.y)) return null
        if (!VALID_BONUS_TYPES.has(msg.bonusType)) return null
        return msg
      case 'reconnect':
        if (typeof msg.token !== 'string' || !msg.token) return null
        return msg
      default:
        return null
    }
  } catch {
    return null
  }
}

export function send(ws: ServerWebSocket<WsData>, msg: ServerMessage): void {
  try { ws.send(JSON.stringify(msg)) } catch { /* socket already closed */ }
}

import type { ConnectionLimiter } from './ratelimit.js'

export type WsData = {
  sessionId: string
  roomId: string | null
  playerId: PlayerId | null
  role: Exclude<Role, 'guest'> | null
  limiter: ConnectionLimiter
}
