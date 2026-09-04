import { ref, shallowRef } from 'vue'
import type { Action, BonusType, CharacterType, PlayerId, WeatherType, WindDir, ClientMessage, ServerMessage } from '@wheee/shared'
import { WS_URL } from '../lib/config'
import { getAnalyticsIdentity } from '../lib/analytics'
import { getAuthToken } from './useAuth'
import { loadReconnectToken, saveReconnectToken, clearReconnectToken } from './sessionToken'
import { presence } from '../lib/presence'

export type MessageHandler = (msg: ServerMessage) => void

const MAX_RECONNECT_DELAY = 8_000
const BASE_RECONNECT_DELAY = 500
const MAX_RECONNECT_ATTEMPTS = 20
/**
 * A match in progress is worth fighting much longer for than an idle lobby: at the
 * 8 s ceiling this is a bit over ten minutes of trying. A stale token is not a
 * problem — the server answers it with `reconnect:fail` and the loop stops there.
 */
const IN_MATCH_MAX_RECONNECT_ATTEMPTS = 100
/** Comfortably inside the server's 120 s idle timeout. */
const HEARTBEAT_MS = 25_000

/**
 * How long without an open socket before the UI is allowed to say so out loud.
 * Long enough that a normal `refreshConnection()` — fired on every auth change
 * and on a stalled tick — never flickers a "no connection" line at a player
 * whose connection is fine.
 */
const OFFLINE_AFTER_MS = 8_000

/**
 * Declared on every matchmaking-entry message so the server can tell this
 * build apart from an old portal client that cannot render the bolt — a room
 * only enables lightning once every human in it has declared the cap.
 */
const CLIENT_CAPS = ['lightning']

export function useGameSocket() {
  const connected = ref(false)
  const reconnecting = ref(false)
  /** Every reconnect attempt has been spent — the player needs a way out. */
  const gaveUp = ref(false)
  /**
   * No open socket for OFFLINE_AFTER_MS. Purely a reporting flag: it is read by
   * the lobby and written by nothing in the reconnect path, whose counters and
   * budgets it must not touch.
   */
  const offline = ref(false)
  const reconnectToken = ref<string | null>(loadReconnectToken())
  const ws = shallowRef<WebSocket | null>(null)
  const handlers = new Set<MessageHandler>()
  let reconnectAttempts = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let presenceUnsub: (() => void) | null = null
  let intentionalClose = false
  let offlineTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * Armed once per outage, not once per attempt: the backoff loop builds a new
   * socket every few seconds, and re-arming there would push the deadline out
   * forever and the flag would never latch.
   */
  function armOfflineTimer() {
    if (offlineTimer || offline.value) return
    offlineTimer = setTimeout(() => {
      offlineTimer = null
      offline.value = true
    }, OFFLINE_AFTER_MS)
  }

  function clearOfflineTimer() {
    if (offlineTimer) { clearTimeout(offlineTimer); offlineTimer = null }
    offline.value = false
  }

  function connect() {
    if (ws.value && ws.value.readyState <= WebSocket.OPEN) return
    intentionalClose = false
    // An explicit connect (pressing Play) earns a fresh budget: otherwise a
    // spent counter from an earlier outage leaves the lobby quietly dead.
    reconnectAttempts = 0
    gaveUp.value = false
    createSocket()
  }

  /**
   * The analytics identity travels with the socket, not in a message: the
   * server needs it before the one event only it can write — a match abandoned
   * by closing the tab, where the client is gone and cannot report its own
   * exit. Absent params just leave the server's copy null.
   */
  function buildWsUrl(): string {
    const params = new URLSearchParams()
    const token = getAuthToken()
    if (token) params.set('token', token)
    const id = getAnalyticsIdentity()
    if (id) {
      params.set('device', id.deviceId)
      params.set('asid', id.sessionId)
      params.set('platform', id.platform)
      if (id.host) params.set('host', id.host)
    }
    const qs = params.toString()
    return qs ? `${WS_URL}?${qs}` : WS_URL
  }

  function createSocket() {
    armOfflineTimer()
    const socket = new WebSocket(buildWsUrl())
    ws.value = socket

    socket.onopen = () => {
      connected.value = true
      clearOfflineTimer()
      reconnecting.value = false
      gaveUp.value = false
      reconnectAttempts = 0
      startHeartbeat()
      if (reconnectToken.value) {
        send({ type: 'reconnect', token: reconnectToken.value })
      }
    }

    socket.onmessage = (e) => {
      try {
        const msg: ServerMessage = JSON.parse(e.data)
        for (const h of handlers) h(msg)
      } catch { /* ignore malformed */ }
    }

    socket.onerror = () => {
      /* browser fires close after error — reconnection handled there */
    }

    socket.onclose = (e) => {
      // A socket that has already been replaced must not clear its successor.
      if (ws.value !== socket) return
      connected.value = false
      ws.value = null
      stopHeartbeat()
      if (!intentionalClose) {
        console.warn(`[ws] closed code=${e.code}${e.reason ? ` reason=${e.reason}` : ''}`)
        scheduleReconnect()
      }
    }
  }

  /** The heartbeat doubles as presence: the server waits only for tabs that are looked at. */
  function sendPing() { send({ type: 'ping', active: presence.isActive() }) }

  function startHeartbeat() {
    stopHeartbeat()
    heartbeatTimer = setInterval(sendPing, HEARTBEAT_MS)
    // A tab that comes back (or goes away) is reported within the second, not
    // at the next heartbeat.
    presenceUnsub?.()
    presenceUnsub = presence.onChange(() => sendPing())
  }

  function stopHeartbeat() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
    presenceUnsub?.()
    presenceUnsub = null
  }

  function scheduleReconnect() {
    if (reconnectTimer) return
    const maxAttempts = reconnectToken.value
      ? IN_MATCH_MAX_RECONNECT_ATTEMPTS
      : MAX_RECONNECT_ATTEMPTS
    if (reconnectAttempts >= maxAttempts) {
      reconnecting.value = false
      gaveUp.value = true
      return
    }
    reconnecting.value = true
    const delay = Math.min(BASE_RECONNECT_DELAY * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY)
    reconnectAttempts++
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      createSocket()
    }, delay)
  }

  function send(msg: ClientMessage): boolean {
    if (ws.value?.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify(msg))
      return true
    }
    return false
  }

  function joinQueue(character: CharacterType = 'wheat', streak = 0) {
    return send({ type: 'queue:join', character, streak, caps: CLIENT_CAPS })
  }

  function startPractice(character: CharacterType = 'wheat', streak = 0) {
    return send({ type: 'practice:start', character, streak })
  }

  /** Straight into a bot match, no queue — what the rewarded ad pays for. */
  function startInstant(character: CharacterType = 'wheat', streak = 0) {
    return send({ type: 'instant:start', character, streak, caps: CLIENT_CAPS })
  }

  /**
   * Play the same person again. Symmetric on the wire: whichever of the two
   * sends this first is offering, the second is accepting — the client never
   * has to know which side it is on.
   */
  function wantRematch(character: CharacterType = 'wheat', streak = 0) {
    return send({ type: 'rematch:want', character, streak, caps: CLIENT_CAPS })
  }

  function cancelRematch() {
    send({ type: 'rematch:cancel' })
  }

  function leaveQueue() {
    send({ type: 'queue:leave' })
  }

  /** Park under a short code and wait for the invited friend. A discord
   * instance passes its deterministic dc- code (create-or-join on the server). */
  function createFriendInvite(character: CharacterType = 'wheat', streak = 0, code?: string) {
    return send(code
      ? { type: 'friend:create', character, streak, caps: CLIENT_CAPS, code }
      : { type: 'friend:create', character, streak, caps: CLIENT_CAPS })
  }

  function cancelFriendInvite() {
    send({ type: 'friend:cancel' })
  }

  /** Join the match behind a challenge link's code. */
  function joinFriend(code: string, character: CharacterType = 'wheat', streak = 0) {
    return send({ type: 'friend:join', code, character, streak, caps: CLIENT_CAPS })
  }

  function submitAction(action: Action) {
    send({ type: 'action:submit', action })
  }

  function joinWatch() {
    send({ type: 'watch:join' })
  }

  function leaveWatch() {
    send({ type: 'watch:leave' })
  }

  function predictWinner(playerId: PlayerId) {
    send({ type: 'watcher:predict_winner', playerId })
  }

  function predictMove(target: PlayerId, action: Action) {
    send({ type: 'watcher:predict_move', target, action })
  }

  function breakInstrument(instrument: 'vane' | 'barometer') {
    send({ type: 'watcher:break_instrument', instrument })
  }

  function joinArchitect() {
    send({ type: 'architect:join' })
  }

  function leaveArchitect() {
    send({ type: 'architect:leave' })
  }

  function setWeather(weatherType: WeatherType, dir: WindDir) {
    send({ type: 'architect:set_weather', weatherType, dir })
  }

  function placeBonus(x: number, y: number, bonusType: BonusType) {
    send({ type: 'architect:place_bonus', x, y, bonusType })
  }

  function onMessage(handler: MessageHandler) {
    handlers.add(handler)
    return () => handlers.delete(handler)
  }

  function setReconnectToken(token: string | null) {
    reconnectToken.value = token
    if (token) saveReconnectToken(token)
    else clearReconnectToken()
  }

  function refreshConnection() {
    // A backoff retry may already be queued. Letting it fire as well would leave
    // two sockets racing, and the loser's `onclose` would drop the winner.
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }

    if (!ws.value || ws.value.readyState > WebSocket.OPEN) {
      createSocket()
      return
    }
    const old = ws.value
    old.onclose = null
    old.onerror = null
    old.onmessage = null
    old.close()
    ws.value = null
    connected.value = false
    createSocket()
  }

  function disconnect() {
    intentionalClose = true
    setReconnectToken(null)
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    stopHeartbeat()
    clearOfflineTimer()
    ws.value?.close()
    ws.value = null
    connected.value = false
    reconnecting.value = false
    gaveUp.value = false
  }

  /** Start over after the reconnect loop gave up — used by the "lost connection" screen. */
  function retryConnection() {
    reconnectAttempts = 0
    gaveUp.value = false
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    refreshConnection()
  }

  return {
    connected,
    reconnecting,
    gaveUp,
    offline,
    reconnectToken,
    connect,
    disconnect,
    refreshConnection,
    retryConnection,
    setReconnectToken,
    joinQueue,
    leaveQueue,
    wantRematch,
    cancelRematch,
    createFriendInvite,
    cancelFriendInvite,
    joinFriend,
    startPractice,
    startInstant,
    submitAction,
    joinWatch,
    leaveWatch,
    predictWinner,
    predictMove,
    breakInstrument,
    joinArchitect,
    leaveArchitect,
    setWeather,
    placeBonus,
    onMessage,
  }
}
