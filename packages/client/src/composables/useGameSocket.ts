import { ref, shallowRef } from 'vue'
import type { Action, BonusType, CharacterType, PlayerId, WeatherType, WindDir, ClientMessage, ServerMessage } from '@wheee/shared'
import { WS_URL } from '../lib/config'

export type MessageHandler = (msg: ServerMessage) => void

const MAX_RECONNECT_DELAY = 8_000
const BASE_RECONNECT_DELAY = 500

export function useGameSocket() {
  const connected = ref(false)
  const reconnecting = ref(false)
  const reconnectToken = ref<string | null>(null)
  const ws = shallowRef<WebSocket | null>(null)
  const handlers = new Set<MessageHandler>()
  let reconnectAttempts = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let intentionalClose = false

  function connect() {
    if (ws.value && ws.value.readyState <= WebSocket.OPEN) return
    intentionalClose = false
    createSocket()
  }

  function createSocket() {
    const socket = new WebSocket(WS_URL)
    ws.value = socket

    socket.onopen = () => {
      connected.value = true
      reconnecting.value = false
      reconnectAttempts = 0
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

    socket.onclose = () => {
      connected.value = false
      ws.value = null
      if (!intentionalClose) {
        scheduleReconnect()
      }
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return
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
    send({ type: 'queue:join', character })
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
    if (!ws.value || ws.value.readyState > WebSocket.OPEN) return
    intentionalClose = true
    ws.value.close()
    ws.value = null
    connected.value = false
    intentionalClose = false
    createSocket()
  }

  function disconnect() {
    intentionalClose = true
    reconnectToken.value = null
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    ws.value?.close()
    ws.value = null
    connected.value = false
    reconnecting.value = false
  }

  return {
    connected,
    reconnecting,
    reconnectToken,
    connect,
    disconnect,
    refreshConnection,
    setReconnectToken,
    joinQueue,
    leaveQueue,
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
