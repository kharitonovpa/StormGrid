import { ref, shallowRef } from 'vue'
import type { Action, BonusType, CharacterType, PlayerId, WeatherType, WindDir, ClientMessage, ServerMessage } from '@wheee/shared'
import { WS_URL } from '../lib/config'
import { getAuthToken } from './useAuth'

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

export function useGameSocket() {
  const connected = ref(false)
  const reconnecting = ref(false)
  /** Every reconnect attempt has been spent — the player needs a way out. */
  const gaveUp = ref(false)
  const reconnectToken = ref<string | null>(null)
  const ws = shallowRef<WebSocket | null>(null)
  const handlers = new Set<MessageHandler>()
  let reconnectAttempts = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let intentionalClose = false

  function connect() {
    if (ws.value && ws.value.readyState <= WebSocket.OPEN) return
    intentionalClose = false
    // An explicit connect (pressing Play) earns a fresh budget: otherwise a
    // spent counter from an earlier outage leaves the lobby quietly dead.
    reconnectAttempts = 0
    gaveUp.value = false
    createSocket()
  }

  function buildWsUrl(): string {
    const token = getAuthToken()
    return token ? `${WS_URL}?token=${encodeURIComponent(token)}` : WS_URL
  }

  function createSocket() {
    const socket = new WebSocket(buildWsUrl())
    ws.value = socket

    socket.onopen = () => {
      connected.value = true
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

  function startHeartbeat() {
    stopHeartbeat()
    heartbeatTimer = setInterval(() => { send({ type: 'ping' }) }, HEARTBEAT_MS)
  }

  function stopHeartbeat() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
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

  function joinQueue(character: CharacterType = 'wheat') {
    return send({ type: 'queue:join', character })
  }

  function startPractice(character: CharacterType = 'wheat') {
    return send({ type: 'practice:start', character })
  }

  function leaveQueue() {
    send({ type: 'queue:leave' })
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
    reconnectToken.value = null
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    stopHeartbeat()
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
    reconnectToken,
    connect,
    disconnect,
    refreshConnection,
    retryConnection,
    setReconnectToken,
    joinQueue,
    leaveQueue,
    startPractice,
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
