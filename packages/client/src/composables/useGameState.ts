import { ref, shallowRef, computed, onScopeDispose } from 'vue'
import type {
  GameState,
  PlayerId,
  PlayerInfo,
  CharacterType,
  WeatherResult,
  ForecastData,
  ServerMessage,
  WatcherPrediction,
} from '@wheee/shared'

export type ClientPhase =
  | 'lobby'
  | 'queue'
  | 'forecast'
  | 'ticking'
  | 'weather'
  | 'finished'
  | 'watching'
  | 'watch_queue'
  | 'architect_queue'

export function useGameState() {
  const phase = ref<ClientPhase>('lobby')
  const myPlayerId = ref<PlayerId | null>(null)
  const gameState = shallowRef<GameState | null>(null)
  const weatherResult = ref<WeatherResult | null>(null)
  const winner = ref<PlayerId | 'draw' | null>(null)
  const selectedCharacter = ref<CharacterType>('wheat')
  const tickDeadline = ref(0)
  const forecastDeadline = ref(0)
  const currentTick = ref(0)
  const actionSubmitted = ref(false)

  const playerInfo = ref<Record<PlayerId, PlayerInfo> | null>(null)

  /* ── Watcher state ── */
  const isWatcher = ref(false)
  const watcherScore = ref(0)

  /* ── Queue countdown ── */
  const queueCountdown = ref(0)
  let _queueInterval: ReturnType<typeof setInterval> | null = null
  let _queueDeadline = 0

  function startQueueCountdown(maxWaitMs: number) {
    stopQueueCountdown()
    _queueDeadline = Date.now() + maxWaitMs
    queueCountdown.value = Math.ceil(maxWaitMs / 1000)
    _queueInterval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((_queueDeadline - Date.now()) / 1000))
      queueCountdown.value = remaining
      if (remaining <= 0) stopQueueCountdown()
    }, 250)
  }

  function stopQueueCountdown() {
    if (_queueInterval) { clearInterval(_queueInterval); _queueInterval = null }
    queueCountdown.value = 0
  }

  onScopeDispose(stopQueueCountdown)

  /* ── Opponent connection state ── */
  const opponentDisconnected = ref(false)

  /* ── Architect state ── */
  const isArchitect = ref(false)
  const architectDeadline = ref(0)
  const weatherSubmitted = ref(false)
  const watcherPredictions = ref<WatcherPrediction[]>([])
  const breakUsed = ref(false)
  const winnerPredicted = ref(false)
  const movePredicted = ref<Partial<Record<PlayerId, boolean>>>({})

  const myPlayer = computed(() => {
    if (!gameState.value || !myPlayerId.value) return null
    return gameState.value.players[myPlayerId.value]
  })

  const opponentPlayer = computed(() => {
    if (!gameState.value || !myPlayerId.value) return null
    const oppId: PlayerId = myPlayerId.value === 'A' ? 'B' : 'A'
    return gameState.value.players[oppId]
  })

  const forecast = computed<ForecastData | null>(() => gameState.value?.forecast ?? null)

  const myInstrumentsBroken = computed(() => {
    if (!forecast.value || !myPlayerId.value) return { vane: false, barometer: false }
    return forecast.value.instrumentsBroken[myPlayerId.value]
  })

  function handleMessage(msg: ServerMessage) {
    switch (msg.type) {
      case 'queue:waiting':
        phase.value = 'queue'
        startQueueCountdown(msg.maxWaitMs)
        break

      case 'game:start':
        stopQueueCountdown()
        myPlayerId.value = msg.playerId
        gameState.value = msg.state
        playerInfo.value = msg.playerInfo
        phase.value = 'forecast'
        isWatcher.value = false
        break

      case 'round:start':
        gameState.value = msg.state
        forecastDeadline.value = msg.forecastDeadline ?? 0
        phase.value = (isWatcher.value || isArchitect.value) ? 'watching' : 'forecast'
        weatherResult.value = null
        winnerPredicted.value = false
        movePredicted.value = {}
        weatherSubmitted.value = false
        break

      case 'tick:start':
        phase.value = (isWatcher.value || isArchitect.value) ? 'watching' : 'ticking'
        currentTick.value = msg.tick
        tickDeadline.value = msg.deadline
        actionSubmitted.value = false
        movePredicted.value = {}
        break

      case 'tick:resolve':
        gameState.value = msg.state
        break

      case 'weather:result':
        weatherResult.value = msg.result
        gameState.value = msg.result.state
        phase.value = (isWatcher.value || isArchitect.value) ? 'watching' : 'weather'
        break

      case 'game:end':
        winner.value = msg.winner
        phase.value = 'finished'
        break

      /* ── Watcher messages ── */

      case 'watch:assigned':
        isWatcher.value = true
        gameState.value = msg.state
        watcherScore.value = msg.watcherState.score
        watcherPredictions.value = [...msg.watcherState.predictions]
        breakUsed.value = msg.watcherState.breakUsed
        if (msg.playerInfo) playerInfo.value = msg.playerInfo
        phase.value = 'watching'
        break

      case 'watch:no_match':
        phase.value = 'lobby'
        isWatcher.value = false
        break

      case 'watcher:score':
        watcherScore.value = msg.total
        watcherPredictions.value = [...watcherPredictions.value, msg.prediction]
        break

      case 'watcher:redirect':
        gameState.value = null
        weatherResult.value = null
        winner.value = null
        phase.value = 'watch_queue'
        break

      /* ── Architect messages ── */

      case 'architect:assigned':
        isArchitect.value = true
        isWatcher.value = false
        gameState.value = msg.state
        if (msg.playerInfo) playerInfo.value = msg.playerInfo
        phase.value = 'watching'
        break

      case 'architect:no_match':
        phase.value = 'lobby'
        isArchitect.value = false
        break

      case 'forecast:update':
        gameState.value = msg.state
        break

      case 'architect:prompt':
        architectDeadline.value = msg.deadline
        break

      /* ── Reconnect messages ── */

      case 'reconnect:ok':
        myPlayerId.value = msg.playerId
        gameState.value = msg.state
        if (msg.playerInfo) playerInfo.value = msg.playerInfo
        tickDeadline.value = msg.deadline
        forecastDeadline.value = msg.forecastDeadline ?? 0
        currentTick.value = msg.tick
        actionSubmitted.value = false
        opponentDisconnected.value = false
        isWatcher.value = false
        isArchitect.value = false
        {
          const sp = msg.state.phase
          phase.value = sp === 'ticking' ? 'ticking'
            : sp === 'forecast' ? 'forecast'
            : sp === 'weather' ? 'weather'
            : sp === 'finished' ? 'finished'
            : 'ticking'
        }
        break

      case 'reconnect:fail':
        reset()
        break

      case 'opponent:disconnected':
        opponentDisconnected.value = true
        break

      case 'opponent:reconnected':
        opponentDisconnected.value = false
        break
    }
  }

  function reset() {
    stopQueueCountdown()
    phase.value = 'lobby'
    myPlayerId.value = null
    gameState.value = null
    playerInfo.value = null
    weatherResult.value = null
    winner.value = null
    tickDeadline.value = 0
    forecastDeadline.value = 0
    currentTick.value = 0
    actionSubmitted.value = false
    isWatcher.value = false
    watcherScore.value = 0
    watcherPredictions.value = []
    breakUsed.value = false
    winnerPredicted.value = false
    movePredicted.value = {}
    opponentDisconnected.value = false
    isArchitect.value = false
    architectDeadline.value = 0
    weatherSubmitted.value = false
  }

  return {
    phase,
    myPlayerId,
    gameState,
    playerInfo,
    weatherResult,
    winner,
    selectedCharacter,
    tickDeadline,
    forecastDeadline,
    currentTick,
    actionSubmitted,
    myPlayer,
    opponentPlayer,
    forecast,
    myInstrumentsBroken,
    isWatcher,
    watcherScore,
    watcherPredictions,
    breakUsed,
    winnerPredicted,
    movePredicted,
    isArchitect,
    architectDeadline,
    queueCountdown,
    opponentDisconnected,
    weatherSubmitted,
    handleMessage,
    reset,
  }
}
