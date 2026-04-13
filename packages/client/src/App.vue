<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef, computed, watch, provide } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js'
import type { Action, CharacterType, GameState, MoveDir } from '@wheee/shared'
import { SIZE, HALF, CELL_SIZE, SEGMENTS } from './lib/constants'
import { terrainState } from './lib/terrain'
import { createWaterSystem } from './lib/water'
import { createWindSystem } from './lib/wind'
import { createRainSystem } from './lib/rain'
import { createCompassSystem } from './lib/compass'
import { createInteractionSystem } from './lib/interaction'
import { createPlayerSystem } from './lib/player'
import { createNameplateSystem } from './lib/nameplate'
import { createPreviewSystem } from './lib/preview'
import { celebrate, disposeCelebrate } from './lib/celebrate'
import { createLobbyDemo } from './lib/lobbyDemo'
import { preloadModels } from './lib/models'
import { createAudioSystem, type AudioSystem } from './lib/audio'
import { createReplayPlayer, fetchReplayData, type ReplayPlayer } from './lib/replayPlayer'
import { useGameSocket } from './composables/useGameSocket'
import { useGameState } from './composables/useGameState'
import { useAuth } from './composables/useAuth'
import { IS_TELEGRAM } from './lib/config'
import LobbyOverlay from './components/LobbyOverlay.vue'
import GameHud from './components/GameHud.vue'
import GameOverOverlay from './components/GameOverOverlay.vue'
import ForecastPanel from './components/ForecastPanel.vue'
import WatcherHud from './components/WatcherHud.vue'
import ArchitectHud from './components/ArchitectHud.vue'
import ReplayOverlay from './components/ReplayOverlay.vue'
import VolumeControl from './components/VolumeControl.vue'

const container = ref<HTMLElement | null>(null)
let renderer: THREE.WebGLRenderer
let controls: OrbitControls | TrackballControls
let animId: number
let sceneCamera: THREE.PerspectiveCamera

const socket = useGameSocket()
const game = useGameState()
const { onAuthChange, fetchMe: authFetchMe } = useAuth()

const modelsReady = preloadModels()
if (IS_TELEGRAM) {
  authFetchMe().then(() => socket.connect())
} else {
  socket.connect()
}
const unsubAuth = onAuthChange(() => socket.refreshConnection())

const audio = createAudioSystem()
provide<AudioSystem>('audio', audio)

function worldToScreen(wx: number, wy: number, wz: number): { x: number; y: number } {
  const v = new THREE.Vector3(wx, wy, wz)
  v.project(sceneCamera)
  return {
    x: (v.x * 0.5 + 0.5) * window.innerWidth,
    y: (-v.y * 0.5 + 0.5) * window.innerHeight,
  }
}

const winnerPopup = ref<{ player: 'A' | 'B'; points: number } | null>(null)
const contextLost = ref(false)
function onContextReload() { window.location.reload() }
let winnerPopupTimer = 0
let celebrateTimer = 0
let contextLostTimer = 0
let unsubMessage1: (() => void) | null = null
let unsubMessage2: (() => void) | null = null

function triggerCelebration(prediction: import('@wheee/shared').WatcherPrediction) {
  let wx = 0, wy = 2, wz = 0
  const state = game.gameState.value
  if (prediction.type === 'move' && prediction.target && state) {
    const p = state.players[prediction.target]
    wx = -HALF + (p.x + 0.5) * CELL_SIZE
    wz = -HALF + (p.y + 0.5) * CELL_SIZE
    wy = terrainState.getHeight(wx, wz) + (prediction.target === 'B' ? -1 : 1) * 0.5
  }

  if (prediction.type === 'winner' && prediction.predictedWinner) {
    winnerPopup.value = { player: prediction.predictedWinner, points: prediction.points }
    clearTimeout(winnerPopupTimer)
    winnerPopupTimer = window.setTimeout(() => {
      winnerPopup.value = null
    }, 2800)
  }

  const delay = prediction.type === 'winner' ? 600 : 0
  clearTimeout(celebrateTimer)
  celebrateTimer = window.setTimeout(() => {
    if (!sceneCamera) return
    const src = worldToScreen(wx, wy, wz)
    const scoreEl = document.querySelector('.wh-score-num')
    const rect = scoreEl?.getBoundingClientRect()
    const tx = rect ? rect.left + rect.width / 2 : 40
    const ty = rect ? rect.top + rect.height / 2 : 30
    celebrate(src.x, src.y, tx, ty, prediction.points, () => {
      const el = document.querySelector('.wh-score-num')
      if (!el) return
      el.classList.remove('wh-score-pop')
      void (el as HTMLElement).offsetWidth
      el.classList.add('wh-score-pop')
    })
  }, delay)
}

unsubMessage1 = socket.onMessage((msg) => {
  if (msg.type === 'lobby:status') {
    onlineCount.value = Number.isFinite(msg.online) ? msg.online : 0
    inQueue.value = Number.isFinite(msg.inQueue) ? msg.inQueue : 0
    return
  }
  if (msg.type === 'game:start') {
    lastRoomId = msg.roomId
    socket.setReconnectToken(msg.reconnectToken)
    audio.enterMatch()
    audio.play('match-found')
  }
  if (msg.type === 'reconnect:fail') {
    socket.setReconnectToken(null)
  }
  if (msg.type === 'game:end') {
    socket.setReconnectToken(null)
    if (pendingGameEnd === null && game.phase.value === 'weather' && !weatherAnimDone) {
      pendingGameEnd = msg as { type: 'game:end'; winner: 'A' | 'B' | 'draw' }
      return
    }
    nameplateSystem?.setVisible(false)
    audio.enterFinished()
    const w = (msg as { winner: 'A' | 'B' | 'draw' }).winner
    const myId = game.myPlayerId.value
    if (w === 'draw') audio.play('draw-end')
    else if (myId && w === myId) audio.play('victory')
    else if (myId) audio.play('defeat')
  }
  if (msg.type === 'watcher:score') {
    if (msg.prediction.correct) {
      triggerCelebration(msg.prediction)
      audio.play('predict-correct')
    } else if (msg.prediction.correct === false) {
      audio.play('predict-wrong')
    }
  }
  game.handleMessage(msg)
})

const showLobby = computed(() =>
  game.phase.value === 'lobby' ||
  game.phase.value === 'queue' ||
  game.phase.value === 'watch_queue' ||
  game.phase.value === 'architect_queue',
)

const lobbyCharacterLocked = computed(
  () => game.queueJoinPending.value || game.phase.value !== 'lobby',
)
const lobbyCommittedCharacter = computed(() => game.selectedCharacter.value)
const showHud = computed(() =>
  game.phase.value === 'forecast' ||
  game.phase.value === 'ticking' ||
  game.phase.value === 'weather',
)
const showGameOver = computed(() => game.phase.value === 'finished')
const showWatcher = computed(() => game.isWatcher.value && game.gameState.value !== null)
const showArchitect = computed(() => game.isArchitect.value && game.gameState.value !== null)

const isInGame = computed(() =>
  game.phase.value === 'forecast' ||
  game.phase.value === 'ticking' ||
  game.phase.value === 'weather',
)
const showReconnecting = computed(() =>
  !socket.connected.value && isInGame.value,
)
const showOpponentDisconnected = computed(() =>
  game.opponentDisconnected.value && isInGame.value,
)

const onlineCount = ref(0)
const inQueue = ref(0)
let pendingAction: (() => void) | null = null
let weatherAnimDone = false

function ensureConnected(then: () => void) {
  if (socket.connected.value) {
    then()
  } else {
    pendingAction = then
    socket.connect()
  }
}

watch(() => socket.connected.value, (connected) => {
  if (connected && pendingAction) {
    const fn = pendingAction
    pendingAction = null
    fn()
  }
})

function onPlay(character: CharacterType) {
  game.selectedCharacter.value = character
  audio.play('queue-enter')
  stopLobbyDemo()
  ensureConnected(() => {
    if (socket.joinQueue(character)) game.queueJoinPending.value = true
  })
}

function onWatch() {
  audio.play('queue-enter')
  stopLobbyDemo()
  ensureConnected(() => socket.joinWatch())
}

function onArchitect() {
  audio.play('queue-enter')
  stopLobbyDemo()
  ensureConnected(() => socket.joinArchitect())
}

function onCancelSearch() {
  audio.play('ui-click')
  const phase = game.phase.value
  if (phase === 'queue') socket.leaveQueue()
  else if (phase === 'watch_queue') socket.leaveWatch()
  else if (phase === 'architect_queue') socket.leaveArchitect()
  game.reset()
  if (lobbyDemo && !lobbyDemoActive) {
    lobbyDemo.start()
    lobbyDemoActive = true
  }
}

const pendingBonusType = ref<import('@wheee/shared').BonusType | null>(null)
const architectHudRef = ref<InstanceType<typeof ArchitectHud> | null>(null)

function onSetWeather(weatherType: import('@wheee/shared').WeatherType, dir: import('@wheee/shared').WindDir) {
  socket.setWeather(weatherType, dir)
  game.weatherSubmitted.value = true
  audio.play('weather-confirm')
}

function onStartBonusPlace(bonusType: import('@wheee/shared').BonusType) {
  pendingBonusType.value = bonusType
}

function onPlayAgain() {
  pendingGameEnd = null
  socket.setReconnectToken(null)
  const lastCharacter = game.selectedCharacter.value ?? 'wheat'
  game.reset()
  game.selectedCharacter.value = lastCharacter
  audio.enterLobby()
  ensureConnected(() => {
    if (socket.joinQueue(lastCharacter)) game.queueJoinPending.value = true
  })
}

function onBackToLobby() {
  pendingGameEnd = null
  socket.setReconnectToken(null)
  game.reset()
  terrainState.resetFlat()
  resetVisuals()
  if (playersSystem) {
    playersSystem.setActivePlayer(null)
    playersSystem.playerA.resetAppearance()
    playersSystem.playerB.resetAppearance()
    playersSystem.applyPositions(
      { x: 2, y: 2, alive: true, character: 'wheat' },
      { x: 4, y: 4, alive: true, character: 'corn' },
    )
  }
  nameplateSystem?.setVisible(false)
  switchToOrbit()
  startAnimating()
  introActive.value = false
  introShowLabels.value = false
  introBounceFlip.value = false
  introBasePos = null
  cameraAnimTarget = null
  cameraAnimFrom = null
  cameraAnimProgress = 0
  if (lobbyDemo && !lobbyDemoActive) {
    lobbyDemo.start()
    lobbyDemoActive = true
  }
  if (controls instanceof OrbitControls) {
    controls.enabled = true
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.4
  }
  audio.enterLobby()
}

async function startReplay(roomId: string) {
  const gen = ++replayGeneration
  const data = await fetchReplayData(roomId)
  if (!data || data.frames.length === 0 || gen !== replayGeneration) return

  game.reset()
  stopLobbyDemo()
  resetVisuals()
  terrainState.resetFlat()
  if (playersSystem) {
    playersSystem.setActivePlayer(null)
    playersSystem.playerA.resetAppearance()
    playersSystem.playerB.resetAppearance()
  }
  switchToTrackball()
  startAnimating()

  replayMode.value = true
  replayPlayer.value = createReplayPlayer(data.frames, (frame, _index, animate) => {
    terrainState.applyBoardState(frame.state.board)
    startAnimating()

    if (animate && frame.weather && playersSystem) {
      const weather = frame.state.weather
      if (weather) {
        windSystem?.setDirection(weather.dir)
        windSystem?.setVisible(true)
      }
      const paths = frame.weather.windPath as Record<'A' | 'B', { x: number; y: number }[]>
      const deaths = frame.weather.deaths as ('A' | 'B')[]
      playersSystem.animateWindPaths(paths, deaths).then(() => {
        if (!playersSystem) return
        playersSystem.applyPositions(frame.state.players.A, frame.state.players.B)
        windSystem?.setVisible(false)
      })
    } else {
      windSystem?.setVisible(false)
      if (playersSystem) {
        playersSystem.applyPositionsImmediate(frame.state.players.A, frame.state.players.B)
      }
    }
  })
}

function exitReplay() {
  replayPlayer.value?.dispose()
  replayPlayer.value = null
  replayMode.value = false

  if (playersSystem) {
    playersSystem.playerA.resetAppearance()
    playersSystem.playerB.resetAppearance()
  }
  terrainState.resetFlat()
  resetVisuals()
  switchToOrbit()
  audio.enterLobby()
}

function onPredictWinner(playerId: 'A' | 'B') {
  socket.predictWinner(playerId)
  game.winnerPredicted.value = true
}

const watcherTarget = ref<'A' | 'B'>('A')

function onPredictMove(target: 'A' | 'B', action: Action) {
  socket.predictMove(target, action)
  game.movePredicted.value = { ...game.movePredicted.value, [target]: true }
}

function onBreakInstrument(instrument: 'vane' | 'barometer') {
  socket.breakInstrument(instrument)
  game.breakUsed.value = true
  audio.play('instrument-break')
}

function switchToTrackball() {
  if (controls instanceof TrackballControls) return
  const cam = sceneCamera
  controls.dispose()
  const tb = new TrackballControls(cam, renderer.domElement)
  tb.rotateSpeed = 3.0
  tb.zoomSpeed = 1.5
  tb.panSpeed = 0.8
  tb.dynamicDampingFactor = 0.15
  tb.noZoom = false
  tb.noPan = false
  controls = tb
}

function switchToOrbit() {
  if (controls instanceof OrbitControls) return
  const cam = sceneCamera
  controls.dispose()
  const oc = new OrbitControls(cam, renderer.domElement)
  oc.enableDamping = true
  oc.dampingFactor = 0.08
  oc.maxPolarAngle = Math.PI * 0.85
  controls = oc
}

let cameraAnimTarget: THREE.Vector3 | null = null
let cameraAnimFrom: THREE.Vector3 | null = null
let cameraAnimProgress = 0

function animateCameraToSide(side: 'top' | 'bottom') {
  const cam = sceneCamera
  const pos = cam.position.clone()
  const dist = pos.length()
  const targetY = side === 'top' ? Math.abs(pos.y) || dist * 0.6 : -(Math.abs(pos.y) || dist * 0.6)
  if ((side === 'top' && pos.y > 0) || (side === 'bottom' && pos.y < 0)) return
  cameraAnimFrom = pos.clone()
  cameraAnimTarget = new THREE.Vector3(pos.x, targetY, pos.z)
  cameraAnimProgress = 0
}

function onFlipView() {
  if (!sceneCamera || introActive.value || demoOrbitActive) return
  const side = sceneCamera.position.y >= 0 ? 'bottom' : 'top'
  animateCameraToSide(side)
}

/* ── Demo orbit: dip below the board to show both sides ── */
const demoOrbitPaused = ref(false)
let demoOrbitActive = false
let demoOrbitElapsed = 0
let demoOrbitBasePos: THREE.Vector3 | null = null

const DEMO_DIP_DUR = 2.0
const DEMO_HOLD_DUR = 2.5
const DEMO_RISE_DUR = 2.0
const DEMO_ORBIT_TOTAL = DEMO_DIP_DUR + DEMO_HOLD_DUR + DEMO_RISE_DUR

function updateDemoOrbit(dt: number) {
  if (!demoOrbitActive || !demoOrbitBasePos) return
  demoOrbitElapsed += dt
  const cam = sceneCamera
  const base = demoOrbitBasePos
  const dist = base.length()
  const pullback = dist * 1.3
  const sideDir = new THREE.Vector3(base.x, 0, base.z).normalize()
  const lowPos = sideDir.clone().multiplyScalar(pullback).setY(-dist * 0.12)

  if (controls instanceof OrbitControls) {
    controls.autoRotate = false
    controls.enabled = false
  }
  if (!demoOrbitPaused.value) demoOrbitPaused.value = true

  if (demoOrbitElapsed < DEMO_DIP_DUR) {
    const t = smoothstep(demoOrbitElapsed / DEMO_DIP_DUR)
    cam.position.lerpVectors(base, lowPos, t)
    cam.lookAt(0, -0.5, 0)
  } else if (demoOrbitElapsed < DEMO_DIP_DUR + DEMO_HOLD_DUR) {
    cam.position.copy(lowPos)
    cam.lookAt(0, -0.5, 0)
  } else if (demoOrbitElapsed < DEMO_ORBIT_TOTAL) {
    const t = smoothstep((demoOrbitElapsed - DEMO_DIP_DUR - DEMO_HOLD_DUR) / DEMO_RISE_DUR)
    cam.position.lerpVectors(lowPos, base, t)
    cam.lookAt(0, 0, 0)
  } else {
    demoOrbitActive = false
    demoOrbitBasePos = null
    demoOrbitPaused.value = false
    cam.position.copy(base)
    cam.lookAt(0, 0, 0)
    if (controls instanceof OrbitControls) {
      controls.enabled = true
      if (lobbyDemoActive) controls.autoRotate = true
    }
  }
}

/* ── Intro fly-around (first game only) ── */
const INTRO_STORAGE_KEY = 'wheee:intro_seen'
const introActive = ref(false)
const introYouPos = ref({ x: 0, y: 0 })
const introOpponentPos = ref({ x: 0, y: 0 })
const introShowLabels = ref(false)
const introBounceFlip = ref(false)

let introElapsed = 0
let introBasePos: THREE.Vector3 | null = null

const INTRO_HOLD = 0.3
const INTRO_ORBIT_DUR = 1.4
const INTRO_LABEL_HOLD = 2.0
const INTRO_RETURN_DUR = 1.0
const INTRO_TOTAL = INTRO_HOLD + INTRO_ORBIT_DUR + INTRO_LABEL_HOLD + INTRO_RETURN_DUR

function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t))
  return c * c * (3 - 2 * c)
}

function storageGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function storageSet(key: string, val: string) {
  try { localStorage.setItem(key, val) } catch { /* private mode */ }
}

function startIntroAnimation() {
  if (storageGet(INTRO_STORAGE_KEY)) return
  introActive.value = true
  introElapsed = 0
  introShowLabels.value = false
  introBasePos = sceneCamera.position.clone()
}

function updateIntro(dt: number) {
  if (!introActive.value || !introBasePos) return
  introElapsed += dt
  const cam = sceneCamera

  const base = introBasePos
  const dist = base.length()
  const pullback = dist * 1.35
  const sideDir = new THREE.Vector3(base.x, 0, base.z).normalize()
  const sidePos = sideDir.clone().multiplyScalar(pullback).setY(-dist * 0.15)

  if (introElapsed < INTRO_HOLD) {
    // hold at start
  } else if (introElapsed < INTRO_HOLD + INTRO_ORBIT_DUR) {
    const t = smoothstep((introElapsed - INTRO_HOLD) / INTRO_ORBIT_DUR)
    cam.position.lerpVectors(base, sidePos, t)
    cam.lookAt(0, -0.5, 0)
  } else if (introElapsed < INTRO_HOLD + INTRO_ORBIT_DUR + INTRO_LABEL_HOLD) {
    cam.position.copy(sidePos)
    cam.lookAt(0, -0.5, 0)
    if (!introShowLabels.value) {
      introShowLabels.value = true
      introBounceFlip.value = true
    }

    const topY = 1.5
    const botY = -2.5
    introYouPos.value = worldToScreen(0, topY, 0)
    introOpponentPos.value = worldToScreen(0, botY, 0)
  } else if (introElapsed < INTRO_TOTAL) {
    introShowLabels.value = false
    introBounceFlip.value = false
    const t = smoothstep((introElapsed - INTRO_HOLD - INTRO_ORBIT_DUR - INTRO_LABEL_HOLD) / INTRO_RETURN_DUR)
    cam.position.lerpVectors(sidePos, base, t)
    cam.lookAt(0, 0, 0)
  } else {
    introActive.value = false
    introShowLabels.value = false
    introBounceFlip.value = false
    cam.position.copy(base)
    cam.lookAt(0, 0, 0)
    introBasePos = null
    storageSet(INTRO_STORAGE_KEY, '1')
  }
}

// --- Radial menu state ---
const MENU_MARGIN = 96
function clampMenuPos(x: number, y: number) {
  const mx = Math.min(MENU_MARGIN, window.innerWidth / 2)
  const my = Math.min(MENU_MARGIN, window.innerHeight / 2)
  return {
    x: Math.max(mx, Math.min(x, window.innerWidth - mx)),
    y: Math.max(my, Math.min(y, window.innerHeight - my)),
  }
}

const menuVisible = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const menuCx = ref(0)
const menuCz = ref(0)
const menuCellValue = ref(0)
const menuIsPlayer = ref(false)

type MenuAction = 'raise' | 'lower' | 'move'

const menuOptions = computed(() => {
  const v = menuCellValue.value
  const opts: { action: MenuAction; label: string; icon: string; disabled: boolean }[] = []
  if (menuIsPlayer.value && !game.isWatcher.value) {
    opts.push({ action: 'move', label: 'Move', icon: 'move', disabled: false })
  }
  opts.push(
    { action: 'raise', label: 'Raise', icon: 'raise', disabled: v === 1 },
    { action: 'lower', label: 'Lower', icon: 'lower', disabled: v === -1 },
  )
  return opts
})

const menuStyle = computed(() => ({
  left: menuX.value + 'px',
  top: menuY.value + 'px',
}))

function closeMenu() {
  menuVisible.value = false
}

function onDocumentPointerDown(e: PointerEvent) {
  const el = e.target as HTMLElement | null
  if (el?.closest('.radial-menu')) return
  closeMenu()
}

let menuListenerId = 0
watch(menuVisible, (open) => {
  if (open) {
    clearTimeout(menuListenerId)
    menuListenerId = window.setTimeout(() => document.addEventListener('pointerdown', onDocumentPointerDown, { capture: true }), 0)
  } else {
    clearTimeout(menuListenerId)
    document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  }
})

let handleAction: ((action: MenuAction) => void) | null = null
let playersSystem: ReturnType<typeof createPlayerSystem> | null = null
let nameplateSystem: ReturnType<typeof createNameplateSystem> | null = null
let sceneCleanup: (() => void) | null = null

const replayMode = ref(false)
const replayPlayer = shallowRef<ReplayPlayer | null>(null)
let lastRoomId: string | null = null
let replayGeneration = 0

function selectOption(action: MenuAction) {
  handleAction?.(action)
  closeMenu()
}

const RING_R = 64
const BTN_HALF = 30
const RING_R_M = 58
const BTN_HALF_M = 28

function isMobileLayout() { return window.innerWidth <= 640 }

function optionStyle(index: number) {
  const mobile = isMobileLayout()
  const r = mobile ? RING_R_M : RING_R
  const h = mobile ? BTN_HALF_M : BTN_HALF
  const count = menuOptions.value.length
  let x: number, y: number
  if (count === 2) {
    const side = index === 0 ? -1 : 1
    x = side * r - h
    y = -h
  } else {
    const step = (2 * Math.PI) / count
    const rad = -Math.PI / 2 - index * step
    x = Math.cos(rad) * r - h
    y = Math.sin(rad) * r - h
  }
  return { left: `${x}px`, top: `${y}px`, '--i': String(index) } as Record<string, string>
}

let sceneReady = false

function applyGameState(state: GameState) {
  terrainState.applyBoardState(state.board)
  if (playersSystem) {
    playersSystem.applyPositions(state.players.A, state.players.B)
  }
}

function resetVisuals() {
  windSystem?.setVisible(false)
  rainSystem?.setVisible(false)
  waterSystem?.clear()
  shouldBuildWater = false
  nameplateSystem?.setVisible(false)
}

function stopLobbyDemo() {
  if (!lobbyDemoActive) return
  lobbyDemoActive = false
  lobbyDemo?.stop()
  if (demoOrbitActive && demoOrbitBasePos) {
    sceneCamera.position.copy(demoOrbitBasePos)
    sceneCamera.lookAt(0, 0, 0)
  }
  demoOrbitActive = false
  demoOrbitBasePos = null
  demoOrbitPaused.value = false
  if (controls instanceof OrbitControls) {
    controls.enabled = true
    controls.autoRotate = false
  }
}

// React to server state changes (deferred until scene is mounted)
unsubMessage2 = socket.onMessage((msg) => {
  if (!sceneReady) return
  switch (msg.type) {
    case 'game:start': {
      stopLobbyDemo()
      pendingGameEnd = null
      terrainState.resetFlat()
      terrainState.applyBoardState(msg.state.board)
      if (playersSystem) {
        playersSystem.setActivePlayer(msg.playerId)
        playersSystem.applyPositions(msg.state.players.A, msg.state.players.B)
      }
      resetVisuals()
      if (nameplateSystem && msg.playerInfo) {
        nameplateSystem.setInfo('A', msg.playerInfo.A)
        nameplateSystem.setInfo('B', msg.playerInfo.B)
        nameplateSystem.setVisible(true)
      }
      switchToOrbit()
      startAnimating()
      startIntroAnimation()
      break
    }
    case 'reconnect:ok': {
      stopLobbyDemo()
      pendingGameEnd = null
      introActive.value = false
      introShowLabels.value = false
      introBounceFlip.value = false
      introBasePos = null
      previewSystem?.hide()
      playersSystem?.hideMoveOptions()
      menuVisible.value = false
      if (playersSystem) {
        playersSystem.setActivePlayer(msg.playerId)
        playersSystem.applyPositions(msg.state.players.A, msg.state.players.B)
      }
      applyGameState(msg.state)
      resetVisuals()
      if (nameplateSystem && msg.playerInfo) {
        nameplateSystem.setInfo('A', msg.playerInfo.A)
        nameplateSystem.setInfo('B', msg.playerInfo.B)
        nameplateSystem.setVisible(true)
      }
      switchToOrbit()
      startAnimating()
      audio.enterMatch()
      break
    }
    case 'reconnect:fail': {
      previewSystem?.hide()
      playersSystem?.hideMoveOptions()
      menuVisible.value = false
      terrainState.resetFlat()
      resetVisuals()
      startAnimating()
      audio.enterLobby()
      break
    }
    case 'watch:assigned': {
      stopLobbyDemo()
      terrainState.resetFlat()
      if (playersSystem) {
        playersSystem.setActivePlayer(null)
        playersSystem.applyPositions(msg.state.players.A, msg.state.players.B)
      }
      resetVisuals()
      if (nameplateSystem && msg.playerInfo) {
        nameplateSystem.setInfo('A', msg.playerInfo.A)
        nameplateSystem.setInfo('B', msg.playerInfo.B)
        nameplateSystem.setVisible(true)
      }
      switchToTrackball()
      applyGameState(msg.state)
      startAnimating()
      audio.enterMatch()
      audio.play('match-found')
      break
    }
    case 'architect:assigned': {
      stopLobbyDemo()
      terrainState.resetFlat()
      if (playersSystem) {
        playersSystem.setActivePlayer(null)
        playersSystem.applyPositions(msg.state.players.A, msg.state.players.B)
      }
      resetVisuals()
      if (nameplateSystem && msg.playerInfo) {
        nameplateSystem.setInfo('A', msg.playerInfo.A)
        nameplateSystem.setInfo('B', msg.playerInfo.B)
        nameplateSystem.setVisible(true)
      }
      switchToTrackball()
      applyGameState(msg.state)
      startAnimating()
      audio.enterMatch()
      audio.play('match-found')
      break
    }
    case 'architect:prompt': {
      architectHudRef.value?.startCountdown()
      break
    }
    case 'watcher:redirect': {
      resetVisuals()
      audio.stopWeather()
      socket.joinWatch()
      break
    }
    case 'tick:start': {
      previewSystem?.hide()
      playersSystem?.hideMoveOptions()
      menuVisible.value = false
      break
    }
    case 'tick:resolve': {
      previewSystem?.hide()
      menuVisible.value = false
      applyGameState(msg.state)
      startAnimating()
      break
    }
    case 'weather:result': {
      terrainState.applyBoardState(msg.result.state.board)
      const weather = msg.result.state.weather
      if (weather) {
        windSystem?.setDirection(weather.dir)
        windSystem?.setVisible(true)
        audio.startWind()
      }
      if (weather?.type === 'wind_rain') {
        rainSystem?.setVisible(true)
        audio.startRain()
      }
      if (msg.result.floodedCells.length > 0) shouldBuildWater = true
      startAnimating()

      if (playersSystem) {
        const paths = msg.result.windPath as Record<'A' | 'B', { x: number; y: number }[]>
        const deaths = msg.result.deaths as ('A' | 'B')[]
        if (paths.A.length > 1 || paths.B.length > 1) audio.play('wind-push')
        weatherAnimDone = false
        playersSystem.animateWindPaths(paths, deaths).then(() => {
          if (!playersSystem) return
          playersSystem.applyPositions(msg.result.state.players.A, msg.result.state.players.B)
          audio.stopWeather()
          if (deaths.length > 0) audio.play('death')
          if (shouldBuildWater && deaths.length === 0) audio.play('water-rise')
          weatherAnimDone = true
          if (pendingGameEnd) {
            nameplateSystem?.setVisible(false)
            audio.enterFinished()
            const w = pendingGameEnd.winner
            const myId = game.myPlayerId.value
            if (w === 'draw') audio.play('draw-end')
            else if (myId && w === myId) audio.play('victory')
            else if (myId) audio.play('defeat')
            game.handleMessage(pendingGameEnd)
            pendingGameEnd = null
          }
        })
      } else {
        audio.stopWeather()
      }
      break
    }
    case 'round:start': {
      resetVisuals()
      nameplateSystem?.setVisible(true)
      applyGameState(msg.state)
      startAnimating()
      audio.stopWeather()
      break
    }
    case 'forecast:update': {
      applyGameState(msg.state)
      startAnimating()
      break
    }
  }
})

let animating = false
let waterSystem: ReturnType<typeof createWaterSystem> | null = null
let windSystem: ReturnType<typeof createWindSystem> | null = null
let rainSystem: ReturnType<typeof createRainSystem> | null = null
let shouldBuildWater = false
let previewSystem: ReturnType<typeof createPreviewSystem> | null = null
let pendingGameEnd: { type: 'game:end'; winner: 'A' | 'B' | 'draw' } | null = null
let lobbyDemo: ReturnType<typeof createLobbyDemo> | null = null
let lobbyDemoActive = false

function startAnimating() {
  animating = true
}

onMounted(() => {
  const el = container.value!
  const w = el.clientWidth
  const h = el.clientHeight

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0a0e14)

  const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 500)
  camera.position.set(30, 25, 30)
  camera.lookAt(0, 0, 0)
  sceneCamera = camera

  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(w, h)
  el.appendChild(renderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.maxPolarAngle = Math.PI * 0.85

  scene.add(new THREE.AmbientLight(0xffffff, 0.5))

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2)
  dirLight.position.set(10, 20, 15)
  scene.add(dirLight)

  const dirLightBottom = new THREE.DirectionalLight(0xffffff, 1.0)
  dirLightBottom.position.set(-10, -20, -15)
  scene.add(dirLightBottom)

  const players = createPlayerSystem(scene, terrainState)
  playersSystem = players

  const nameplates = createNameplateSystem(scene, terrainState)
  nameplateSystem = nameplates
  nameplates.setPlayerRefs(
    { get state() { return players.playerA.state }, get mesh() { return players.playerA.mesh }, get surface() { return players.playerA.surface } },
    { get state() { return players.playerB.state }, get mesh() { return players.playerB.mesh }, get surface() { return players.playerB.surface } },
  )

  // --- Terrain meshes ---
  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.85, metalness: 0,
    side: THREE.DoubleSide, polygonOffset: true,
    polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  })

  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const topMesh = new THREE.Mesh(geo, terrainMat)
  scene.add(topMesh)

  const bottomGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS)
  bottomGeo.rotateX(-Math.PI / 2)
  const bottomPos = bottomGeo.attributes.position as THREE.BufferAttribute
  const bottomMesh = new THREE.Mesh(bottomGeo, terrainMat)
  scene.add(bottomMesh)

  const perimN = terrainState.PERIMETER.length
  const skirtVerts = new Float32Array(perimN * 2 * 3)
  const skirtIdxArr: number[] = []
  for (let i = 0; i < perimN; i++) {
    const next = (i + 1) % perimN
    skirtIdxArr.push(i, perimN + i, next, next, perimN + i, perimN + next)
  }
  const skirtGeo = new THREE.BufferGeometry()
  const skirtPos = new THREE.BufferAttribute(skirtVerts, 3)
  skirtGeo.setAttribute('position', skirtPos)
  skirtGeo.setIndex(skirtIdxArr)
  scene.add(new THREE.Mesh(skirtGeo, terrainMat))

  const gridStep = SIZE / SEGMENTS
  const gridLineCount = (7 + 1) * SEGMENTS * 4
  const gridPts = new Float32Array(gridLineCount * 3)
  const gridGeo = new THREE.BufferGeometry()
  const gridPos = new THREE.BufferAttribute(gridPts, 3)
  gridGeo.setAttribute('position', gridPos)
  const gridLineMat = new THREE.LineBasicMaterial({ color: 0x2a4a2a, transparent: true, opacity: 0.35 })
  const gridLines = new THREE.LineSegments(gridGeo, gridLineMat)
  scene.add(gridLines)

  const botGridPts = new Float32Array(gridLineCount * 3)
  const botGridGeo = new THREE.BufferGeometry()
  const botGridPos = new THREE.BufferAttribute(botGridPts, 3)
  botGridGeo.setAttribute('position', botGridPos)
  const botGridLines = new THREE.LineSegments(botGridGeo, gridLineMat)
  scene.add(botGridLines)

  function rebuildGrid() {
    let idx = 0
    let bidx = 0
    const CELLS = 7
    const THICK = 1
    for (let i = 0; i <= CELLS; i++) {
      const off = -HALF + i * CELL_SIZE
      for (let j = 0; j < SEGMENTS; j++) {
        const t0 = -HALF + j * gridStep
        const t1 = t0 + gridStep
        const h00 = terrainState.getHeight(off, t0)
        const h01 = terrainState.getHeight(off, t1)
        const h10 = terrainState.getHeight(t0, off)
        const h11 = terrainState.getHeight(t1, off)

        gridPts[idx++] = off; gridPts[idx++] = h00 + 0.05; gridPts[idx++] = t0
        gridPts[idx++] = off; gridPts[idx++] = h01 + 0.05; gridPts[idx++] = t1
        gridPts[idx++] = t0; gridPts[idx++] = h10 + 0.05; gridPts[idx++] = off
        gridPts[idx++] = t1; gridPts[idx++] = h11 + 0.05; gridPts[idx++] = off

        botGridPts[bidx++] = off; botGridPts[bidx++] = h00 - THICK - 0.05; botGridPts[bidx++] = t0
        botGridPts[bidx++] = off; botGridPts[bidx++] = h01 - THICK - 0.05; botGridPts[bidx++] = t1
        botGridPts[bidx++] = t0; botGridPts[bidx++] = h10 - THICK - 0.05; botGridPts[bidx++] = off
        botGridPts[bidx++] = t1; botGridPts[bidx++] = h11 - THICK - 0.05; botGridPts[bidx++] = off
      }
    }
    gridPos.needsUpdate = true
    botGridPos.needsUpdate = true
  }

  const water = createWaterSystem(scene, terrainState)
  waterSystem = water
  const wind = createWindSystem(scene, terrainState)
  windSystem = wind
  const rain = createRainSystem(scene, terrainState)
  rainSystem = rain
  const compass = createCompassSystem(scene)
  const preview = createPreviewSystem(scene, terrainState)
  previewSystem = preview

  const DIR_MAP: Record<string, MoveDir> = {
    '0,-1': 'N', '0,1': 'S', '1,0': 'E', '-1,0': 'W',
    '1,-1': 'NE', '-1,-1': 'NW', '1,1': 'SE', '-1,1': 'SW',
  }

  const interaction = createInteractionSystem(
    scene, camera, renderer.domElement as HTMLCanvasElement, topMesh, terrainState,
    (e) => {
      const isWatcher = game.isWatcher.value
      const isArch = game.isArchitect.value
      const gamePhase = game.gameState.value?.phase

      if (isArch) {
        if (pendingBonusType.value && gamePhase === 'forecast') {
          socket.placeBonus(e.cx, e.cz, pendingBonusType.value)
          pendingBonusType.value = null
          architectHudRef.value?.resetBonusState()
        }
        return
      }

      if (isWatcher) {
        if (gamePhase !== 'ticking') return

        if (players.moveMode) {
          if (players.isValidMove(e.cx, e.cz)) {
            const pid = players.moveModePlayer
            const s = pid === 'A' ? players.playerA.state : players.playerB.state
            const off = players.surfaceOffsetFor(pid)
            const dx = e.cx - s.cx
            const dz = e.cz - s.cz
            const dir = DIR_MAP[`${dx},${dz}`] ?? null
            if (dir) {
              onPredictMove(pid, { kind: 'move', dir })
              preview.showMove(s.cx, s.cz, e.cx, e.cz, off)
            }
          }
          players.hideMoveOptions()
          return
        }

        const clickedPlayer = players.playerAtCell(e.cx, e.cz)
        if (clickedPlayer) {
          watcherTarget.value = clickedPlayer
          animateCameraToSide(clickedPlayer === 'A' ? 'top' : 'bottom')
          if (!game.movePredicted.value[clickedPlayer]) {
            players.showMoveOptionsFor(clickedPlayer)
          }
          return
        }

        watcherTarget.value = e.isBottom ? 'B' : 'A'
        menuCx.value = e.cx
        menuCz.value = e.cz
        const wp = clampMenuPos(e.screenX, e.screenY)
        menuX.value = wp.x
        menuY.value = wp.y
        menuCellValue.value = terrainState.target[e.cz][e.cx]
        menuIsPlayer.value = false
        menuVisible.value = true
        return
      }

      if (game.phase.value !== 'ticking' || game.actionSubmitted.value || !game.myPlayerId.value) return

      if (players.moveMode) {
        if (players.isValidMove(e.cx, e.cz)) {
          const s = game.myPlayerId.value === 'A' ? players.playerA.state : players.playerB.state
          const dx = e.cx - s.cx
          const dz = e.cz - s.cz
          const dir = DIR_MAP[`${dx},${dz}`] ?? null
          if (dir) {
            socket.submitAction({ kind: 'move', dir })
            game.actionSubmitted.value = true
            audio.play('action-submit')
            const s2 = game.myPlayerId.value === 'A' ? players.playerA.state : players.playerB.state
            preview.showMove(s2.cx, s2.cz, e.cx, e.cz)
          }
        }
        players.hideMoveOptions()
        return
      }
      menuCx.value = e.cx
      menuCz.value = e.cz
      const pp = clampMenuPos(e.screenX, e.screenY)
      menuX.value = pp.x
      menuY.value = pp.y
      menuCellValue.value = terrainState.target[e.cz][e.cx]
      menuIsPlayer.value = players.isMyCell(e.cx, e.cz)
      menuVisible.value = true
    },
    (cell) => {
      const canvas = renderer.domElement
      const isWatcher = game.isWatcher.value

      if (isWatcher) {
        if (cell && players.playerAtCell(cell.cx, cell.cz)) {
          players.setHovered(true)
          canvas.style.cursor = 'pointer'
        } else if (cell && players.moveMode && players.isValidMove(cell.cx, cell.cz)) {
          players.setHovered(false)
          players.setHoverCell(cell.cx, cell.cz)
          canvas.style.cursor = 'pointer'
        } else if (cell) {
          players.setHovered(false)
          canvas.style.cursor = 'pointer'
        } else {
          players.setHovered(false)
          canvas.style.cursor = ''
        }
        return
      }

      if (cell && players.isMyCell(cell.cx, cell.cz)) {
        players.setHovered(true)
        canvas.style.cursor = 'pointer'
      } else if (cell && players.moveMode && players.isValidMove(cell.cx, cell.cz)) {
        players.setHovered(false)
        players.setHoverCell(cell.cx, cell.cz)
        canvas.style.cursor = 'pointer'
      } else {
        players.setHovered(false)
        canvas.style.cursor = ''
      }
    },
    [bottomMesh],
    closeMenu,
  )

  handleAction = (action) => {
    const cx = menuCx.value
    const cz = menuCz.value

    if (game.isWatcher.value) {
      if (action === 'raise' || action === 'lower') {
        const target = watcherTarget.value
        const off = players.surfaceOffsetFor(target)
        onPredictMove(target, { kind: action, x: cx, y: cz })
        if (action === 'raise') preview.showRaise(cx, cz, off)
        else preview.showLower(cx, cz, off)
      }
      return
    }

    if (game.phase.value !== 'ticking' || game.actionSubmitted.value) return
    if (action === 'move') {
      players.showMoveOptions()
      return
    }
    const serverAction: Action = { kind: action, x: cx, y: cz }
    socket.submitAction(serverAction)
    game.actionSubmitted.value = true
    audio.play('action-submit')
    if (action === 'raise') preview.showRaise(cx, cz)
    else if (action === 'lower') preview.showLower(cx, cz)
  }

  // Start flat
  terrainState.resetFlat()

  terrainState.rebuildMesh(pos, bottomPos, skirtPos)
  terrainState.rebuildHeightCache()
  geo.computeVertexNormals()
  bottomGeo.computeVertexNormals()
  skirtGeo.computeVertexNormals()
  terrainState.paintColors(geo)
  terrainState.paintColors(bottomGeo, true)
  terrainState.paintColors(skirtGeo)
  rebuildGrid()

  sceneReady = true
  audio.enterLobby()

  if (IS_TELEGRAM && window.Telegram?.WebApp) {
    window.Telegram.WebApp.ready()
    window.Telegram.WebApp.expand()
    window.Telegram.WebApp.disableVerticalSwipes()
  }

  // --- Lobby demo: cinematic showcase ---
  players.setActivePlayer(null)
  const demoPairs: [CharacterType, CharacterType][] = [
    ['wheat', 'corn'],
    ['rice', 'wheat'],
    ['corn', 'rice'],
  ]
  let demoPairIdx = 0
  lobbyDemo = createLobbyDemo(terrainState, wind, rain, water, {
    onTerrainChanged() { animating = true },
    onRequestFlood() { shouldBuildWater = true },
    onRepositionPlayers(posA, posB) {
      const [top, bot] = demoPairs[demoPairIdx % demoPairs.length]
      demoPairIdx++
      players.applyPositions(
        { ...posA, alive: true, character: top },
        { ...posB, alive: true, character: bot },
      )
    },
    onRequestCameraDip() {
      if (!lobbyDemoActive) return
      demoOrbitActive = true
      demoOrbitElapsed = 0
      demoOrbitBasePos = camera.position.clone()
    },
  })
  lobbyDemo.start()
  lobbyDemoActive = true

  modelsReady.then(() => {
    if (!lobbyDemoActive) return
    players.applyPositions(
      { x: 2, y: 2, alive: true, character: 'wheat' },
      { x: 4, y: 4, alive: true, character: 'corn' },
    )
  })
  if (controls instanceof OrbitControls) {
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.4
  }

  let prevTime = performance.now()

  function animate() {
    animId = requestAnimationFrame(animate)
    const now = performance.now()
    const dt = Math.min((now - prevTime) / 1000, 0.1)
    prevTime = now
    if (!demoOrbitActive) controls.update()

    if (lobbyDemoActive && lobbyDemo) {
      lobbyDemo.update(dt)
    }

    if (demoOrbitActive) {
      updateDemoOrbit(dt)
    } else if (introActive.value) {
      updateIntro(dt)
    } else if (cameraAnimTarget && cameraAnimFrom) {
      cameraAnimProgress = Math.min(cameraAnimProgress + dt * 2.5, 1)
      const t = cameraAnimProgress * cameraAnimProgress * (3 - 2 * cameraAnimProgress)
      camera.position.lerpVectors(cameraAnimFrom, cameraAnimTarget, t)
      camera.lookAt(0, 0, 0)
      if (cameraAnimProgress >= 1) {
        cameraAnimTarget = null
        cameraAnimFrom = null
      }
    }

    if (animating) {
      const done = terrainState.stepAnimation(dt)
      terrainState.rebuildMesh(pos, bottomPos, skirtPos)
      geo.computeVertexNormals()
      bottomGeo.computeVertexNormals()
      skirtGeo.computeVertexNormals()
      terrainState.paintColors(geo)
      terrainState.paintColors(bottomGeo, true)
      terrainState.paintColors(skirtGeo)
      rebuildGrid()
      if (done) {
        animating = false
        terrainState.rebuildHeightCache()
        if (shouldBuildWater) {
          terrainState.computeFlood()
          terrainState.computeFloodBot()
          water.buildTop()
          water.buildBot()
          shouldBuildWater = false
        }
      }
    }

    water.update(dt)
    wind.update(dt)
    rain.update(dt)
    players.update(dt)
    nameplates.update(dt)
    interaction.update(dt)
    preview.update(dt)
    audio.update(dt)
    renderer.render(scene, camera)
  }

  animate()

  /* ── WebGL context loss / restore ── */
  renderer.domElement.addEventListener('webglcontextlost', () => {
    clearTimeout(contextLostTimer)
    contextLostTimer = window.setTimeout(() => { contextLost.value = true }, 1500)
  })

  renderer.domElement.addEventListener('webglcontextrestored', () => {
    clearTimeout(contextLostTimer)
    contextLost.value = false
    startAnimating()
  })

  const onVisibility = () => {
    cancelAnimationFrame(animId)
    if (!document.hidden) {
      prevTime = performance.now()
      animate()
    }
  }
  document.addEventListener('visibilitychange', onVisibility)

  const onResize = () => {
    const rw = el.clientWidth, rh = el.clientHeight
    camera.aspect = rw / rh
    camera.updateProjectionMatrix()
    renderer.setSize(rw, rh)
    if (controls instanceof TrackballControls) controls.handleResize()
  }
  window.addEventListener('resize', onResize)

  sceneCleanup = () => {
    document.removeEventListener('visibilitychange', onVisibility)
    clearTimeout(contextLostTimer)
    window.removeEventListener('resize', onResize)
    water.dispose()
    wind.dispose()
    rain.dispose()
    compass.dispose()
    players.dispose()
    nameplates.dispose()
    interaction.dispose()
    preview.dispose()
    handleAction = null
    playersSystem = null
    nameplateSystem = null
    previewSystem = null
    waterSystem = null
    windSystem = null
    rainSystem = null
    lobbyDemo?.stop()
    lobbyDemo = null
    lobbyDemoActive = false
    sceneReady = false
    audio.dispose()
    socket.disconnect()
  }
})

onUnmounted(() => {
  cancelAnimationFrame(animId)
  clearTimeout(winnerPopupTimer)
  clearTimeout(celebrateTimer)
  clearTimeout(contextLostTimer)
  clearTimeout(menuListenerId)
  disposeCelebrate()
  pendingGameEnd = null
  unsubMessage1?.()
  unsubMessage2?.()
  unsubAuth()
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  sceneCleanup?.()
  sceneCleanup = null
  controls?.dispose()
  if (renderer) {
    renderer.domElement.parentElement?.removeChild(renderer.domElement)
    renderer.dispose()
  }
})
</script>

<template>
  <div ref="container" class="canvas-root" />

  <!-- WebGL context lost overlay -->
  <Transition name="rc">
    <div v-if="contextLost" class="reconnect-overlay" style="cursor:pointer" @click="onContextReload">
      <div class="reconnect-card">
        <div class="reconnect-text">Display error — tap to reload</div>
      </div>
    </div>
  </Transition>

  <!-- Reconnecting overlay -->
  <Transition name="rc">
    <div v-if="showReconnecting" class="reconnect-overlay">
      <div class="reconnect-card">
        <div class="reconnect-spinner" />
        <div class="reconnect-text">Reconnecting...</div>
      </div>
    </div>
  </Transition>

  <!-- Opponent disconnected banner -->
  <Transition name="od">
    <div v-if="showOpponentDisconnected" class="opponent-dc-banner">
      <div class="opponent-dc-dot" />
      Opponent disconnected — waiting for reconnect...
    </div>
  </Transition>

  <!-- Demo orbit pause indicator -->
  <Transition name="demo-pause">
    <div v-if="demoOrbitPaused && game.phase.value === 'lobby'" class="demo-pause-overlay">
      <div class="demo-pause-icon">
        <div class="demo-pause-bar" />
        <div class="demo-pause-bar" />
      </div>
    </div>
  </Transition>

  <LobbyOverlay
    v-if="showLobby && !replayMode"
    :phase="game.phase.value"
    :character-locked="lobbyCharacterLocked"
    :committed-character="lobbyCommittedCharacter"
    :online-count="onlineCount"
    :in-queue="inQueue"
    :queue-countdown="game.queueCountdown.value"
    @play="onPlay"
    @watch="onWatch"
    @architect="onArchitect"
    @watch-replay="startReplay"
    @cancel-search="onCancelSearch"
  />

  <GameHud
    v-if="showHud"
    :phase="(game.phase.value as 'forecast' | 'ticking' | 'weather')"
    :round="game.gameState.value?.round ?? 1"
    :tick="game.currentTick.value"
    :tick-deadline="game.tickDeadline.value"
    :forecast-deadline="game.forecastDeadline.value"
    :action-submitted="game.actionSubmitted.value"
    :my-player-id="game.myPlayerId.value ?? 'A'"
    :bounce-flip="introBounceFlip"
    @flip="onFlipView"
  />

  <ForecastPanel
    v-if="showHud && game.forecast.value"
    :wind-candidates="game.forecast.value.windCandidates"
    :rain-probability="game.forecast.value.rainProbability"
    :vane-broken="game.myInstrumentsBroken.value.vane"
    :barometer-broken="game.myInstrumentsBroken.value.barometer"
  />

  <WatcherHud
    v-if="showWatcher"
    :phase="game.gameState.value?.phase ?? 'waiting'"
    :score="game.watcherScore.value"
    :predictions="game.watcherPredictions.value"
    :break-used="game.breakUsed.value"
    :winner-predicted="game.winnerPredicted.value"
    :move-predicted="game.movePredicted.value"
    @predict-winner="onPredictWinner"
    @break-instrument="(i: 'vane' | 'barometer') => onBreakInstrument(i)"
  />

  <ArchitectHud
    v-if="showArchitect"
    ref="architectHudRef"
    :phase="game.gameState.value?.phase ?? 'waiting'"
    :deadline="game.architectDeadline.value"
    :weather-submitted="game.weatherSubmitted.value"
    @set-weather="onSetWeather"
    @start-bonus-place="onStartBonusPlace"
  />

  <GameOverOverlay
    v-if="showGameOver"
    :winner="game.winner.value"
    :my-player-id="game.myPlayerId.value"
    :room-id="lastRoomId"
    @play-again="onPlayAgain"
    @watch-replay="startReplay"
    @back-to-lobby="onBackToLobby"
  />

  <ReplayOverlay
    v-if="replayMode && replayPlayer"
    :player="replayPlayer"
    @exit="exitReplay"
  />

  <VolumeControl />

  <!-- Intro labels -->
  <Transition name="intro-label">
    <div v-if="introShowLabels" class="intro-labels">
      <div class="intro-label intro-you" :style="{ left: introYouPos.x + 'px', top: introYouPos.y + 'px' }">
        <div class="intro-label-dot" />
        <span>You</span>
      </div>
      <div class="intro-label intro-opp" :style="{ left: introOpponentPos.x + 'px', top: introOpponentPos.y + 'px' }">
        <div class="intro-label-dot" />
        <span>Opponent</span>
      </div>
    </div>
  </Transition>

  <!-- Winner Prediction Popup -->
  <Teleport to="body">
    <Transition name="wp">
      <div v-if="winnerPopup" class="wp-overlay">
        <div class="wp-card" :class="'wp-' + winnerPopup.player">
          <div class="wp-icon">
            <svg viewBox="0 0 48 48" width="48" height="48" fill="none">
              <path d="M24 4l5.5 11.2L42 17l-9 8.8L35.1 38 24 32.2 12.9 38 15 25.8 6 17l12.5-1.8z" fill="currentColor" opacity="0.85"/>
            </svg>
          </div>
          <div class="wp-text">Winner predicted</div>
          <div class="wp-points">+{{ winnerPopup.points }}</div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- Radial Menu -->
  <Teleport to="body">
    <Transition name="radial">
      <div v-if="menuVisible" class="radial-menu" :style="menuStyle">
        <div class="radial-ring"></div>
        <div class="radial-center"></div>
        <button
          v-for="(opt, i) in menuOptions"
          :key="opt.action"
          class="radial-btn"
          :class="[opt.icon, { disabled: opt.disabled }]"
          :style="optionStyle(i)"
          @click.stop="!opt.disabled && selectOption(opt.action)"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none"
               stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <template v-if="opt.icon === 'move'">
              <line x1="12" y1="3" x2="12" y2="21" opacity="0.15" />
              <line x1="3" y1="12" x2="21" y2="12" opacity="0.15" />
              <polyline points="9,6 12,3 15,6" />
              <polyline points="9,18 12,21 15,18" />
              <polyline points="6,9 3,12 6,15" />
              <polyline points="18,9 21,12 18,15" />
            </template>
            <template v-else-if="opt.icon === 'raise'">
              <polyline points="4,17 12,7 20,17" />
              <line x1="8" y1="20" x2="16" y2="20" opacity="0.35" />
            </template>
            <template v-else>
              <polyline points="4,7 12,17 20,7" />
              <line x1="8" y1="4" x2="16" y2="4" opacity="0.35" />
            </template>
          </svg>
          <span class="radial-label">{{ opt.label }}</span>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.canvas-root {
  position: fixed;
  inset: 0;
  overflow: hidden;
}

/* ── Demo orbit pause overlay ── */

.demo-pause-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.12) 0%, transparent 70%);
}

.demo-pause-icon {
  display: flex;
  gap: 10px;
  padding: 24px 28px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.demo-pause-bar {
  width: 8px;
  height: 36px;
  border-radius: 4px;
  background: linear-gradient(
    180deg,
    rgba(200, 210, 225, 0.5) 0%,
    rgba(200, 210, 225, 0.25) 100%
  );
  box-shadow: 0 0 12px rgba(139, 180, 255, 0.15);
}

.demo-pause-enter-active {
  transition: opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}
.demo-pause-enter-active .demo-pause-icon {
  transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}
.demo-pause-leave-active {
  transition: opacity 0.8s cubic-bezier(0.4, 0, 0.2, 1);
}
.demo-pause-leave-active .demo-pause-icon {
  transition: transform 0.8s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.8s cubic-bezier(0.4, 0, 0.2, 1);
}

.demo-pause-enter-from {
  opacity: 0;
}
.demo-pause-enter-from .demo-pause-icon {
  opacity: 0;
  transform: scale(0.85);
}

.demo-pause-leave-to {
  opacity: 0;
}
.demo-pause-leave-to .demo-pause-icon {
  opacity: 0;
  transform: scale(1.08);
}

@media (prefers-reduced-motion: reduce) {
  .demo-pause-enter-active,
  .demo-pause-leave-active,
  .demo-pause-enter-active .demo-pause-icon,
  .demo-pause-leave-active .demo-pause-icon {
    transition: none;
  }
}
</style>

<style>
/* ── Intro labels ── */

.intro-labels {
  position: fixed;
  inset: 0;
  z-index: 100;
  pointer-events: none;
}

.intro-label {
  position: absolute;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  animation: intro-pop 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}

.intro-label-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  animation: intro-dot-pulse 1.2s ease-in-out infinite;
}

.intro-you {
  color: rgba(74, 222, 128, 0.9);
  text-shadow: 0 0 16px rgba(74, 222, 128, 0.4);
}

.intro-you .intro-label-dot {
  background: rgba(74, 222, 128, 0.8);
  box-shadow: 0 0 10px rgba(74, 222, 128, 0.5);
}

.intro-opp {
  color: rgba(251, 146, 60, 0.9);
  text-shadow: 0 0 16px rgba(251, 146, 60, 0.4);
}

.intro-opp .intro-label-dot {
  background: rgba(251, 146, 60, 0.8);
  box-shadow: 0 0 10px rgba(251, 146, 60, 0.5);
}

@keyframes intro-pop {
  0% { opacity: 0; transform: translate(-50%, -50%) scale(0.6); }
  100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}

@keyframes intro-dot-pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

.intro-label-enter-active { transition: opacity 0.4s ease; }
.intro-label-leave-active { transition: opacity 0.3s ease; }
.intro-label-enter-from, .intro-label-leave-to { opacity: 0; }

/* ── Radial Menu ── */

.radial-menu {
  position: fixed;
  z-index: 1001;
  pointer-events: none;
  width: 0;
  height: 0;
}

.radial-ring {
  position: absolute;
  width: 136px;
  height: 136px;
  border-radius: 50%;
  transform: translate(-68px, -68px);
  border: 1px solid rgba(255, 255, 255, 0.035);
  background: radial-gradient(circle, rgba(255, 255, 255, 0.015) 0%, transparent 70%);
  pointer-events: none;
}

.radial-center {
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transform: translate(-4px, -4px);
  background: rgba(255, 255, 255, 0.18);
  box-shadow: 0 0 10px rgba(255, 255, 255, 0.08);
  pointer-events: none;
}

.radial-btn {
  position: absolute;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(18, 20, 28, 0.55);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  color: rgba(220, 225, 235, 0.9);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  pointer-events: auto;
  padding: 0;
  gap: 2px;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  transition:
    transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
    box-shadow 0.25s ease,
    border-color 0.25s ease,
    background 0.25s ease;
  animation: radial-pop 0.38s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
  animation-delay: calc(var(--i, 0) * 0.055s);
}

.radial-btn svg {
  flex-shrink: 0;
  filter: drop-shadow(0 0 4px currentColor);
}

.radial-label {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.6px;
  opacity: 0.55;
  white-space: nowrap;
  text-transform: uppercase;
  font-family: system-ui, -apple-system, sans-serif;
}

.radial-btn.move {
  background: linear-gradient(145deg, rgba(99, 102, 241, 0.2), rgba(67, 56, 202, 0.08));
  border-color: rgba(129, 140, 248, 0.22);
  color: rgba(165, 180, 252, 0.95);
}
.radial-btn.move:hover:not(.disabled) {
  background: linear-gradient(145deg, rgba(99, 102, 241, 0.35), rgba(67, 56, 202, 0.15));
  border-color: rgba(165, 180, 252, 0.45);
  transform: scale(1.1);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.2),
    0 0 24px rgba(99, 102, 241, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.radial-btn.raise {
  background: linear-gradient(145deg, rgba(52, 211, 153, 0.2), rgba(16, 185, 129, 0.08));
  border-color: rgba(110, 231, 183, 0.22);
  color: rgba(167, 243, 208, 0.95);
}
.radial-btn.raise:hover:not(.disabled) {
  background: linear-gradient(145deg, rgba(52, 211, 153, 0.35), rgba(16, 185, 129, 0.15));
  border-color: rgba(110, 231, 183, 0.45);
  transform: scale(1.1);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.2),
    0 0 24px rgba(52, 211, 153, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.radial-btn.lower {
  background: linear-gradient(145deg, rgba(251, 146, 60, 0.2), rgba(234, 88, 12, 0.08));
  border-color: rgba(253, 186, 116, 0.22);
  color: rgba(254, 215, 170, 0.95);
}
.radial-btn.lower:hover:not(.disabled) {
  background: linear-gradient(145deg, rgba(251, 146, 60, 0.35), rgba(234, 88, 12, 0.15));
  border-color: rgba(253, 186, 116, 0.45);
  transform: scale(1.1);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.2),
    0 0 24px rgba(251, 146, 60, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.radial-btn.disabled {
  opacity: 0.15;
  cursor: default;
  pointer-events: none;
}

@keyframes radial-pop {
  from { opacity: 0; transform: scale(0); }
}

.radial-enter-active { transition: opacity 0.18s ease; }
.radial-leave-active { transition: opacity 0.1s ease; }
.radial-enter-from, .radial-leave-to { opacity: 0; }

/* ── Winner Prediction Popup ── */

.wp-overlay {
  position: fixed;
  inset: 0;
  z-index: 8000;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.wp-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 28px 44px;
  border-radius: 20px;
  background: rgba(18, 20, 28, 0.7);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  animation: wp-entrance 0.6s cubic-bezier(0.16, 1, 0.3, 1);
  font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
}

.wp-A {
  color: rgba(255, 215, 100, 0.9);
  box-shadow: 0 0 60px rgba(230, 180, 60, 0.12), 0 0 120px rgba(230, 180, 60, 0.06);
}

.wp-B {
  color: rgba(120, 210, 240, 0.9);
  box-shadow: 0 0 60px rgba(80, 180, 220, 0.12), 0 0 120px rgba(80, 180, 220, 0.06);
}

.wp-icon {
  animation: wp-star 0.8s cubic-bezier(0.16, 1, 0.3, 1);
}

.wp-text {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  opacity: 0.5;
}

.wp-points {
  font-size: 36px;
  font-weight: 900;
  letter-spacing: -1px;
  line-height: 1;
  animation: wp-count 0.5s 0.3s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.wp-A .wp-points { text-shadow: 0 0 30px rgba(255, 200, 60, 0.35); }
.wp-B .wp-points { text-shadow: 0 0 30px rgba(80, 180, 220, 0.35); }

@keyframes wp-entrance {
  0%   { opacity: 0; transform: scale(0.6) translateY(20px); }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}

@keyframes wp-star {
  0%   { opacity: 0; transform: scale(0) rotate(-30deg); }
  50%  { transform: scale(1.2) rotate(8deg); }
  100% { opacity: 1; transform: scale(1) rotate(0); }
}

@keyframes wp-count {
  0%   { opacity: 0; transform: scale(0.5) translateY(10px); }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}

.wp-enter-active { transition: opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
.wp-leave-active { transition: opacity 0.5s ease; }
.wp-enter-from { opacity: 0; }
.wp-leave-to { opacity: 0; }

/* ── Reconnecting overlay ── */

.reconnect-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(6, 8, 14, 0.55);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.reconnect-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 32px 48px;
  border-radius: 18px;
  background: rgba(18, 22, 30, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.4);
}

.reconnect-spinner {
  width: 28px;
  height: 28px;
  border: 2.5px solid rgba(255, 255, 255, 0.1);
  border-top-color: rgba(200, 210, 230, 0.7);
  border-radius: 50%;
  animation: rc-spin 0.8s linear infinite;
}

.reconnect-text {
  font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.8px;
  color: rgba(200, 210, 230, 0.7);
}

@keyframes rc-spin {
  to { transform: rotate(360deg); }
}

.rc-enter-active { transition: opacity 0.3s ease; }
.rc-leave-active { transition: opacity 0.25s ease; pointer-events: none; }
.rc-enter-from, .rc-leave-to { opacity: 0; }

/* ── Opponent disconnected banner ── */

.opponent-dc-banner {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 7000;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: 10px;
  background: rgba(24, 20, 16, 0.82);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(230, 160, 80, 0.2);
  font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.4px;
  color: rgba(230, 180, 100, 0.85);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  white-space: nowrap;
}

.opponent-dc-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(230, 160, 80, 0.7);
  animation: od-pulse 1.5s ease-in-out infinite;
}

@keyframes od-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

.od-enter-active { transition: opacity 0.3s ease, transform 0.3s ease; }
.od-leave-active { transition: opacity 0.25s ease, transform 0.25s ease; }
.od-enter-from { opacity: 0; transform: translateX(-50%) translateY(-12px); }
.od-leave-to { opacity: 0; transform: translateX(-50%) translateY(-12px); }

/* ── Mobile ── */

@media (max-width: 640px) {
  .radial-btn { width: 56px; height: 56px; }
  .radial-label { font-size: 10px; }
  .reconnect-card { padding: 24px 32px; }
  .reconnect-text { font-size: 12px; }
  .opponent-dc-banner { font-size: 11px; padding: 8px 14px; }
  .wp-card { padding: 20px 32px; }
  .wp-points { font-size: 28px; }
}
</style>
