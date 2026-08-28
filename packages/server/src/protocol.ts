import type { ServerWebSocket } from 'bun'
import type { PlayerId, Role } from '@wheee/shared'
import { BOARD_SIZE, CHARACTERS, WIND_DIRS, WEATHER_TYPES, MOVE_DIRS } from '@wheee/shared'

export type {
  ClientMessage,
  ServerMessage,
  QueueJoinMsg,
  QueueLeaveMsg,
  PracticeStartMsg,
  InstantStartMsg,
  FriendCreateMsg,
  FriendCancelMsg,
  FriendJoinMsg,
  FriendWaitingMsg,
  FriendJoinFailMsg,
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
  PingMsg,
  PongMsg,
  ReconnectOkMsg,
  ReconnectFailMsg,
  OpponentDisconnectedMsg,
  OpponentReconnectedMsg,
  OpponentActedMsg,
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
/** Server codes are 6 chars, but stay tolerant of case and future lengths. */
const FRIEND_CODE_RE = /^[a-zA-Z0-9]{4,12}$/
/**
 * friend:create's optional `code` covers a second shape FRIEND_CODE_RE doesn't:
 * a discord instance-automatch pairing (`DC-` + the SDK's instanceId, see
 * discord.ts and matchmaking.ts's own CLIENT_CODE_RE). Reusing FRIEND_CODE_RE
 * as-is would parse-reject every automatch attempt.
 */
const FRIEND_CREATE_CODE_RE = /^(?:[a-zA-Z0-9]{4,12}|[dD][cC]-[a-zA-Z0-9-]{6,64})$/
/** `caps` is client-supplied and only ever a short client-feature list — cap
 * its shape hard so a hostile client can't use it to smuggle in a large payload. */
const MAX_CAPS = 8
const MAX_CAP_LEN = 32

function isValidCaps(v: unknown): boolean {
  if (v === undefined) return true
  return Array.isArray(v) && v.length <= MAX_CAPS
    && v.every((c) => typeof c === 'string' && c.length <= MAX_CAP_LEN)
}

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
      case 'friend:join':
        if (typeof msg.code !== 'string' || !FRIEND_CODE_RE.test(msg.code)) return null
        // fallthrough — the rest of the shape matches queue:join
      case 'queue:join':
      case 'practice:start':
      case 'instant:start':
      case 'friend:create':
        if (!VALID_CHARACTERS.has(msg.character)) return null
        // friend:create's `code` is optional (server generates one when absent),
        // but when present it must pass shape validation just like friend:join's
        // required code does above — otherwise an instance-automatch code (or a
        // hostile client) reaches matchmaking.ts's `.toUpperCase()` call
        // unvalidated. Scoped to friend:create: the other message types sharing
        // this block have no `code` field of their own.
        if (msg.type === 'friend:create' && msg.code !== undefined
          && (typeof msg.code !== 'string' || !FRIEND_CREATE_CODE_RE.test(msg.code))) return null
        // Cosmetic and self-reported, but still has to be a sane number.
        if (msg.streak !== undefined
          && (!Number.isInteger(msg.streak) || msg.streak < 0 || msg.streak > 9999)) return null
        // practice:start has no use for caps — practice is already lightning-free.
        if (msg.type !== 'practice:start' && !isValidCaps(msg.caps)) return null
        return msg
      case 'queue:leave':
      case 'friend:cancel':
      case 'watch:join':
      case 'watch:leave':
      case 'architect:join':
      case 'architect:leave':
      case 'ping':
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

/**
 * Who the client is to first-party analytics, handed over as query params on
 * the socket URL. It is the client's own `wheee:device_id` — the server needs
 * it to write events on behalf of a player who is no longer there to send any,
 * which is the only way an abandoned match ever reaches the funnel.
 */
export type AnalyticsIdentity = {
  deviceId: string
  sessionId: string
  platform: string
  host: string | null
}

/**
 * Same shape rules POST /api/events applies to a client-sent batch. They have
 * to agree: a row the server writes on an absent player's behalf must be
 * indistinguishable from one that player's own client would have sent, or the
 * two halves of a funnel stop joining on device_id.
 */
const ANALYTICS_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/
const MAX_PLATFORM_LEN = 20
const MAX_HOST_LEN = 40

/** Null whenever anything is missing or malformed — analytics never gates play. */
export function parseAnalyticsIdentity(params: URLSearchParams): AnalyticsIdentity | null {
  const deviceId = params.get('device') ?? ''
  const sessionId = params.get('asid') ?? ''
  if (!ANALYTICS_ID_RE.test(deviceId) || !ANALYTICS_ID_RE.test(sessionId)) return null

  const platform = params.get('platform') ?? ''
  if (platform.length === 0 || platform.length > MAX_PLATFORM_LEN) return null

  // An unusable host is dropped rather than fatal: the platform alone is still
  // worth having, and only gamepush ever sends a host in the first place.
  const rawHost = params.get('host')
  const host = rawHost && rawHost.length > 0 && rawHost.length <= MAX_HOST_LEN ? rawHost : null

  return { deviceId, sessionId, platform, host }
}

export type WsData = {
  sessionId: string
  userId: string | null
  userName: string | null
  countryCode: string | null
  roomId: string | null
  playerId: PlayerId | null
  role: Exclude<Role, 'guest'> | null
  limiter: ConnectionLimiter
  /** Null when an old client connects without the params, or they fail validation. */
  analytics: AnalyticsIdentity | null
}
