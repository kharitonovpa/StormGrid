<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef, computed, watch, provide } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js'
import type { Action, CharacterType, GameState, MoveDir } from '@wheee/shared'
import { badgeFor, hasWind, hasRain, hasLightning, TICKS_PER_ROUND } from '@wheee/shared'
import { SIZE, HALF, CELL_SIZE, CELLS, SEGMENTS } from './lib/constants'
import { terrainState } from './lib/terrain'
import { CROP_THEME } from './lib/cropTheme'
import { createWaterSystem, WATER_FILL_MS } from './lib/water'
import { createWindSystem } from './lib/wind'
import { createRainSystem } from './lib/rain'
import { createLightningSystem } from './lib/lightning'
import { createStormSystem } from './lib/storm'
import { createCompassSystem } from './lib/compass'
import { createInteractionSystem } from './lib/interaction'
import { createPlayerSystem } from './lib/player'
import { createNameplateSystem } from './lib/nameplate'
import { createPreviewSystem } from './lib/preview'
import { createInsectSystem } from './lib/insects'
import { createGlassSystem, GLASS_ORDER } from './lib/glass'
import { createBonusSystem } from './lib/bonus'
import { streak, canRescue, seedStreak, winStreak, breakStreak, restoreStreak } from './lib/streak'
import { celebrate, disposeCelebrate } from './lib/celebrate'
import { createLobbyDemo } from './lib/lobbyDemo'
import { preloadModels } from './lib/models'
import { Howler } from 'howler'
import { createAudioSystem, type AudioSystem } from './lib/audio'
import { createReplayPlayer, fetchReplayData, type ReplayPlayer } from './lib/replayPlayer'
import { useGameSocket } from './composables/useGameSocket'
import { useGameState } from './composables/useGameState'
import { useAuth } from './composables/useAuth'
import { usePlatform } from './lib/platform'
import { storageGet, storageSet } from './lib/storage'
import { track } from './lib/analytics'
import { getIncomingInviteCode, clearInviteFromUrl, buildInviteUrl, shareInvite, copyInvite } from './lib/invite'
import { getDiscordInstanceCode, onDiscordParticipantCount, shareDiscordLink, setDiscordPresence } from './lib/platform/discordBridge'
import { presenceBucketForPhase } from './lib/platform/discordPresence'
import LobbyOverlay from './components/LobbyOverlay.vue'
import GameHud from './components/GameHud.vue'
import GameOverOverlay from './components/GameOverOverlay.vue'
import ForecastPanel from './components/ForecastPanel.vue'
import WatcherHud from './components/WatcherHud.vue'
import ArchitectHud from './components/ArchitectHud.vue'
import ReplayOverlay from './components/ReplayOverlay.vue'
import VolumeControl from './components/VolumeControl.vue'
import TutorialHud from './components/TutorialHud.vue'
import { t } from './lib/i18n'

const container = ref<HTMLElement | null>(null)
let renderer: THREE.WebGLRenderer
let controls: OrbitControls | TrackballControls
let animId: number
let sceneCamera: THREE.PerspectiveCamera

const platform = usePlatform()
const socket = useGameSocket()
/**
 * True from boot when a persisted reconnect token was found — i.e. this load
 * is a reload (F5) of a page that was mid-match, not a cold start. Cleared as
 * soon as the resume attempt resolves either way (Step 3 below); it must be
 * declared here, before the presence watch a few lines down (Step 4), which
 * reads it on its first, immediate run.
 */
const restoringSession = ref(!!socket.reconnectToken.value)
/**
 * A boot-time restore gets a much shorter budget than a genuine mid-match
 * drop. `useGameSocket`'s own `IN_MATCH_MAX_RECONNECT_ATTEMPTS` (~13 minutes
 * at its backoff ceiling) is deliberately generous for a player already
 * looking at a live board who briefly lost their connection — but this timer
 * covers a *fresh page load* that merely found a persisted token: if the
 * server is unreachable at reload time, staring at a bare spinner for up to
 * 13 minutes with no escape is not acceptable. When this fires and the
 * restore still hasn't resolved, it forces the same connection-lost /
 * retry / back-to-lobby UI `socket.gaveUp` already renders, well ahead of
 * the socket layer's own budget running out.
 */
const BOOT_RESTORE_TIMEOUT_MS = 12_000
const bootRestoreGaveUp = ref(false)
let bootRestoreTimer = 0

function clearBootRestoreTimer() {
  clearTimeout(bootRestoreTimer)
  bootRestoreTimer = 0
}

function armBootRestoreTimer() {
  clearBootRestoreTimer()
  bootRestoreTimer = window.setTimeout(() => {
    bootRestoreTimer = 0
    if (restoringSession.value) bootRestoreGaveUp.value = true
  }, BOOT_RESTORE_TIMEOUT_MS)
}

if (restoringSession.value) armBootRestoreTimer()

const game = useGameState()
const { onAuthChange, fetchMe: authFetchMe } = useAuth()

const modelsReady = preloadModels()
if (platform.type === 'telegram') {
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

/** Which move was locked in this tick, for the HUD chip. Cleared when a new tick opens. */
const myActionLabel = ref('')
watch(() => game.actionSubmitted.value, (submitted) => {
  if (!submitted) myActionLabel.value = ''
})

watch(() => game.phase.value, (phase) => {
  // Skip the immediate 'lobby' push while a reload might still resume into a
  // live match. A successful resume takes phase out of 'lobby', which drives
  // a correct push through this same watcher — but a *failed* resume lands
  // phase back on 'lobby', the value it already had, so this watcher never
  // fires again on that path. The reconnect:fail handler below calls
  // setDiscordPresence('lobby') itself once restoringSession clears, so
  // presence still ends up correct either way.
  if (restoringSession.value && phase === 'lobby') return
  setDiscordPresence(presenceBucketForPhase(phase))
}, { immediate: true })

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

/* ── Challenge link (friend match) ── */

/** Code from a followed challenge link; Play accepts it instead of queueing. */
const incomingInvite = ref(getIncomingInviteCode())
clearInviteFromUrl()

/** On discord the code is a channel-instance pairing, not a link — never build one. */
const inviteUrl = computed(() =>
  game.inviteCode.value && platform.type !== 'discord'
    ? buildInviteUrl(game.inviteCode.value, platform.type)
    : null,
)

/** The friend_wait screen swaps in instance-specific copy for a dc- code. */
const isInstanceWait = computed(() => !!game.inviteCode.value?.toUpperCase().startsWith('DC-'))
/**
 * Share still has somewhere to go on discord even with no URL to show — but
 * not during an instance-wait: that dc- code isn't a joinable invite (the
 * client's own CODE_RE and the server's friend:join both reject it), so
 * sharing it would hand a recipient outside this voice channel a dead code.
 * The spec's instance-wait screen only prescribes leave-to-queue.
 */
const canShareInvite = computed(() => !isInstanceWait.value && (!!inviteUrl.value || platform.type === 'discord'))

/**
 * Declared here, ahead of the discord automatch block below, rather than
 * further down where the rest of the connection/queue state lives: the
 * bridge's `onDiscordParticipantCount` fires its callback synchronously,
 * with the *current* count, the moment it's registered — so if two people
 * are already in the voice channel when this script runs, automatch calls
 * `ensureConnected` before `main.ts` finishes mounting the app. Reading (or
 * writing) `pendingAction` from a `let` declared later in this same script
 * would hit its temporal dead zone and throw. Nothing about `ensureConnected`
 * itself changes — only where it and its backing variable are declared.
 */
let pendingAction: (() => void) | null = null

/**
 * How long a queued lobby action may sit waiting on a socket before the player
 * is told. The socket's own `gaveUp` is twenty backoff attempts — about two and
 * a half minutes — far too long to leave a tapped button looking dead.
 */
const PLAY_CONNECT_TIMEOUT_MS = 8_000

/** An action is queued behind a connect that has not landed yet. */
const connectPending = ref(false)
/** That connect has been slow enough to say so — without cancelling it. */
const connectFailed = ref(false)
let connectTimer = 0

function armConnectTimer() {
  if (connectTimer) clearTimeout(connectTimer)
  // Reports the wait; never drops `pendingAction`. A socket that lands at, say,
  // eleven seconds still starts the match and closes the card on its own — only
  // Cancel throws the queued action away.
  connectTimer = window.setTimeout(() => {
    connectTimer = 0
    if (pendingAction) connectFailed.value = true
  }, PLAY_CONNECT_TIMEOUT_MS)
}

function clearConnectWait() {
  if (connectTimer) { clearTimeout(connectTimer); connectTimer = 0 }
  connectPending.value = false
  connectFailed.value = false
}

function ensureConnected(then: () => void) {
  if (socket.connected.value) { then(); return }
  pendingAction = then
  if (!connectPending.value) {
    // The first queued action owns the clock: a later call while a connect is
    // already pending must not restart the deadline or hide a card that's
    // already showing.
    connectPending.value = true
    connectFailed.value = false
    armConnectTimer()
  }
  socket.connect()
}

watch(() => socket.connected.value, (connected) => {
  if (!connected) return
  clearConnectWait()
  if (pendingAction) {
    const fn = pendingAction
    pendingAction = null
    fn()
  }
})

/* ── Discord instance automatch: two people in the voice channel = a match.
   Both sides send the same dc- code; the server's create-or-join pairs them. ── */
if (platform.type === 'discord') {
  const tryInstanceMatch = () => {
    const code = getDiscordInstanceCode()
    if (!code) return
    // Only from an idle lobby: never steal a manual invite/queue/match in
    // progress, and never re-fire while an earlier automatch send is still
    // in flight. A finished match returns here through game.reset(), so a
    // fresh participant-count event (not just landing back in the lobby)
    // is what re-triggers this — acceptable for v1.
    if (game.phase.value !== 'lobby') return
    if (incomingInvite.value) return
    if (game.queueJoinPending.value) return
    // A user gesture always wins: if something is already queued for the
    // moment the socket connects — someone's own Play/Invite tap, or an
    // earlier automatch attempt still waiting on that same connect — this
    // is not it. Automatch defers rather than clobbering it; the reverse
    // (a user action overwriting an automatch pendingAction) stays allowed,
    // since ensureConnected's normal callers never check this and a
    // deliberate tap should win over an automatic one.
    if (pendingAction) return
    ensureConnected(() => {
      if (socket.createFriendInvite(game.selectedCharacter.value, streak.value, code)) {
        game.queueJoinPending.value = true
        track('instance_automatch')
      }
    })
  }
  onDiscordParticipantCount(count => { if (count >= 2) tryInstanceMatch() })
}

function onInvite(character: CharacterType) {
  game.commitCharacter(character)
  game.inviteFailed.value = false
  audio.play('queue-enter')
  stopLobbyDemo()
  ensureConnected(() => {
    if (socket.createFriendInvite(character, streak.value)) {
      game.queueJoinPending.value = true
      track('invite_created')
    }
  })
}

function onShareInvite() {
  track('invite_share')
  // No URL exists on discord — the SDK's own share sheet posts the invite
  // straight into the channel instead.
  if (platform.type === 'discord') {
    if (game.inviteCode.value) void shareDiscordLink(game.inviteCode.value, t('invite.shareText'))
    return
  }
  const url = inviteUrl.value
  if (!url) return
  // No native share sheet around (desktop web) — the copy button's job, done here.
  if (!shareInvite(url, t('invite.shareText'))) copyInvite(url)
}

unsubMessage1 = socket.onMessage((msg) => {
  if (msg.type === 'friend:join_fail') {
    // The dead link must not swallow the next Play press too.
    incomingInvite.value = null
    track('invite_join_fail')
  }
  if (msg.type === 'lobby:status') {
    onlineCount.value = Number.isFinite(msg.online) ? msg.online : 0
    inQueue.value = Number.isFinite(msg.inQueue) ? msg.inQueue : 0
    liveMatches.value = Number.isFinite(msg.liveMatches) ? msg.liveMatches : 0
    return
  }
  if (msg.type === 'rematch:available') rematchState.value = 'available'
  if (msg.type === 'rematch:offered') rematchState.value = 'offered'
  if (msg.type === 'rematch:waiting') rematchState.value = 'waiting'
  if (msg.type === 'rematch:off') rematchState.value = 'none'
  if (msg.type === 'game:start') {
    restoringSession.value = false
    clearBootRestoreTimer()
    bootRestoreGaveUp.value = false
    lastRoomId = msg.roomId
    socket.setReconnectToken(msg.reconnectToken)
    platform.gameplayStart()
    audio.enterMatch(game.selectedCharacter.value)
    audio.play('match-found')
    // The window belonged to the match that just finished, whether this new one
    // came out of it or out of the queue.
    rematchState.value = 'none'
    track('match_start', { practice: msg.practice === true, invited: !!incomingInvite.value })
    incomingInvite.value = null
  }
  if (msg.type === 'reconnect:fail') {
    restoringSession.value = false
    clearBootRestoreTimer()
    bootRestoreGaveUp.value = false
    socket.setReconnectToken(null)
    // The presence watch above deliberately skipped its immediate push while
    // this was still pending — phase was already 'lobby' and reset() below
    // (via game.handleMessage) puts it right back there, so that watcher
    // never fires again on this path. Drive the push from here instead.
    setDiscordPresence(presenceBucketForPhase('lobby'))
  }
  if (msg.type === 'reconnect:ok') {
    restoringSession.value = false
    clearBootRestoreTimer()
    bootRestoreGaveUp.value = false
  }
  if (msg.type === 'tick:resolve' && msg.bonus) onCratePicked(msg.bonus.player)
  if (msg.type === 'game:end') {
    socket.setReconnectToken(null)
    platform.gameplayStop()
    refreshRewardedAvailability()
    {
      // Watchers and the architect are sent game:end too, and they have no
      // playerId — so without this guard every match watched from the outside
      // filed a `match_end` of its own with result 'loss', inflating the match
      // count and dragging the win rate down with a defeat nobody suffered.
      const myId = game.myPlayerId.value
      if (myId) {
        const result = msg.winner === 'draw' ? 'draw' : (msg.winner === myId ? 'win' : 'loss')
        track('match_end', { result, practice: game.isPractice.value })
      }
    }
    if (game.isPractice.value) storageSet(TUTORIAL_STORAGE_KEY, '1')
    settleStreak(msg)
    if (pendingGameEnd === null && game.phase.value === 'weather' && !weatherAnimDone) {
      pendingGameEnd = msg as { type: 'game:end'; winner: 'A' | 'B' | 'draw' }
      return
    }
    // A match that ends outside the storm animation — a forfeit, a disconnect,
    // a verdict during the forecast — still owes the sky an exit, or the mass
    // hangs over the overlay and follows the player into the lobby. The tick 5
    // tremor is the same story: dischargeImpl never touches it, so without this
    // the camera keeps shaking at 9Hz behind the game-over overlay.
    stormSystem?.discharge('exhale')
    stormSystem?.setTremor(false)
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
  game.phase.value === 'friend_wait' ||
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
/**
 * `!isInGame.value` alone would already flip this off on a *successful*
 * resume (phase leaves 'lobby'), but `reconnect:fail` sends phase back to
 * 'lobby' too — so `restoringSession` needs its own explicit clear (Step 3)
 * or this would get stuck showing "Restoring match…" forever after a failed
 * resume.
 */
const showRestoringSession = computed(() => restoringSession.value && !isInGame.value)
/**
 * Folds the boot-time restore-after-reload wait into the same overlay as a
 * mid-match reconnect, rather than a separate one: `showRestoringSession`
 * alone would never go false if the resume attempt never resolves (socket
 * can't connect at all, or drops again before the server answers) — phase
 * never leaves 'lobby', so `isInGame` never flips, so nothing here ever
 * clears it and the player is stuck behind a bare spinner. Sharing this
 * overlay means the socket layer's own `gaveUp` — reached once its reconnect
 * budget (up to ~13 minutes for an in-match token) is spent — surfaces the
 * existing retry/back-to-lobby buttons for the restore case too, the same
 * way it already does for an ordinary in-match disconnect. That budget is
 * far too generous for a boot restore specifically, though — nothing on
 * screen yet tells the player a match even exists — so `bootRestoreGaveUp`
 * forces the same buttons on its own short `BOOT_RESTORE_TIMEOUT_MS` timer
 * well before the socket's own budget would ever be spent; see its
 * declaration above.
 */
const showReconnecting = computed(() =>
  showRestoringSession.value || (!socket.connected.value && isInGame.value),
)
const showOpponentDisconnected = computed(() =>
  game.opponentDisconnected.value && isInGame.value,
)

const onlineCount = ref(0)
const inQueue = ref(0)
const liveMatches = ref(0)
let weatherAnimDone = false
/**
 * The pause between the sky going quiet and the bolt landing. Long enough to be
 * read as dread, short enough that it never feels like a dropped frame.
 */
const HUSH_MS = 800
/**
 * How far into the front's crossing the gale itself shows up. Long enough that
 * the wind reads as something the storm brought with it, short enough that the
 * lines are blowing well before anybody is carried off the board.
 */
const WIND_ONSET_MS = 400

// The lobby emits this on every card click, not only Play — the arena's
// crop watcher and the persisted preference (useGameState's
// watch(selectedCharacter, saveCharacterPreference)) both key off
// game.selectedCharacter, so the pick has to land there on click.
function onSelectCharacter(character: CharacterType) {
  game.commitCharacter(character)
}

function onPlay(character: CharacterType) {
  game.commitCharacter(character)
  game.inviteFailed.value = false
  audio.play('queue-enter')
  stopLobbyDemo()
  ensureConnected(() => {
    // A followed challenge link beats everything, the tutorial included — the
    // friend on the other end is already waiting.
    if (incomingInvite.value) {
      if (socket.joinFriend(incomingInvite.value, character, streak.value)) {
        game.queueJoinPending.value = true
        track('invite_join')
      }
      return
    }
    // Straight to the real queue — the tutorial lives behind the lobby's
    // «How to play» chip only. Forcing it on first Play killed 7 of 10
    // newcomers before they ever saw a real match.
    if (socket.joinQueue(character, streak.value)) {
      game.queueJoinPending.value = true
      track('queue_join')
    }
  })
}

/**
 * The tutorial's only entrance — Play goes straight to the real queue. The chip
 * has to stay visible in the lobby: portal moderation (Pikabu) requires a way to
 * learn the rules that reused portal accounts can always find.
 */
function onHowToPlay(character: CharacterType) {
  game.commitCharacter(character)
  game.inviteFailed.value = false
  audio.play('queue-enter')
  stopLobbyDemo()
  const replay = hasDoneTutorial()
  ensureConnected(() => {
    if (socket.startPractice(character, streak.value)) {
      game.queueJoinPending.value = true
      track('tutorial_open', { replay })
    }
  })
}

function onWatch() {
  audio.play('queue-enter')
  stopLobbyDemo()
  track('watch_join')
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
  else if (phase === 'friend_wait') socket.cancelFriendInvite()
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

/**
 * A plain `computed` would be wrong here: `isRewardedAvailable()` reads a mutable
 * SDK property with no reactive dependency behind it, so Vue would cache whatever
 * it saw first — possibly before the SDK had an answer — and never look again.
 * Re-read it whenever the button is about to matter.
 */
/**
 * How far the rematch handshake has got. The server opens the window only for a
 * PvP match both players finished, so 'none' covers bots, tutorials, forfeits
 * and old clients alike — the button simply never appears.
 */
const rematchState = ref<'none' | 'available' | 'waiting' | 'offered'>('none')

function onRematch() {
  const character = game.selectedCharacter.value ?? 'wheat'
  if (socket.wantRematch(character, streak.value)) rematchState.value = 'waiting'
}

function onRematchCancel() {
  socket.cancelRematch()
  rematchState.value = 'none'
}

const hasRewardedAds = ref(platform.isRewardedAvailable())

function refreshRewardedAvailability() {
  hasRewardedAds.value = platform.isRewardedAvailable()
}

/** `instant` skips the queue for a bot match — the rewarded ad's payoff. */
function doPlayAgain(instant = false) {
  // Re-queueing abandons the pairing; say so rather than leaving the other
  // player watching a "waiting" button that will never resolve.
  if (rematchState.value !== 'none') { socket.cancelRematch(); rematchState.value = 'none' }
  track('play_again', { instant })
  pendingGameEnd = null
  socket.setReconnectToken(null)
  // Straight into the queue without a full visual reset, so the crystal has to
  // be sent away by hand or it hangs over the board while the player waits.
  bonusSystem?.clear()
  lastCrateCell = null
  const lastCharacter = game.selectedCharacter.value ?? 'wheat'
  game.reset()
  game.selectedCharacter.value = lastCharacter
  audio.enterLobby(game.selectedCharacter.value)
  ensureConnected(() => {
    if (instant) { socket.startInstant(lastCharacter, streak.value); return }
    if (socket.joinQueue(lastCharacter, streak.value)) game.queueJoinPending.value = true
  })
}

async function onRewardedPlayAgain() {
  if (rewardedBusy.value) return
  rewardedBusy.value = true
  try {
    const rewarded = await platform.showRewarded().catch(() => false)
    // An ad that never played buys nothing; the offer stays on the screen.
    if (!rewarded) return
    track('rewarded_instant')
    doPlayAgain(true)
  } finally {
    rewardedBusy.value = false
  }
}

async function onPlayAgain() {
  await platform.showInterstitial().catch(() => {})
  doPlayAgain()
}

async function onBackToLobby() {
  if (rematchState.value !== 'none') { socket.cancelRematch(); rematchState.value = 'none' }
  // Cleared before the awaited interstitial, not after: leaving these until
  // afterwards holds the window open longer than it needs to be, during
  // which the overlay could linger, or a concurrent retryConnection() (from
  // the "Try again" button's sibling handler) could resend a now-stale token
  // while the ad is still showing.
  socket.setReconnectToken(null)
  // A gave-up boot-time restore reaches here via onGiveUpToLobby — without
  // this, restoringSession would stay true and the reconnecting overlay
  // (still gated on it while phase is 'lobby') would pop right back up.
  restoringSession.value = false
  clearBootRestoreTimer()
  bootRestoreGaveUp.value = false
  await platform.showInterstitial().catch(() => {})
  pendingGameEnd = null
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
  audio.enterLobby(game.selectedCharacter.value)
}

/** Where the gem was standing, kept so the pickup burst starts from it. */
let lastCrateCell: { x: number; y: number } | null = null
/** Plate data for the running match, so a badge can be shown the instant it is won. */
const matchInfo = ref<Record<'A' | 'B', import('@wheee/shared').PlayerInfo> | null>(null)
const cratePopup = ref<{ mine: boolean } | null>(null)
let cratePopupTimer = 0

/**
 * Somebody collected the gem. It has to be unmistakable whose it was: the gem is
 * pulled in where it stood, sparks fly to that player's plate, and the badge
 * lands on the plate at once rather than waiting for the next match.
 */
function onCratePicked(player: 'A' | 'B') {
  const mine = player === game.myPlayerId.value
  bonusSystem?.playTake()

  if (mine) seedStreak()
  // The opponent's find is worth hearing too, just quieter and further away —
  // the same chime carries both, so the moment always sounds like itself.
  audio.play(mine ? 'crate-pickup' : 'ui-click')

  // The badge is worth 1 the moment the gem is taken — that is what seeds it.
  if (matchInfo.value) {
    matchInfo.value = { ...matchInfo.value, [player]: { ...matchInfo.value[player], streak: 1 } }
    nameplateSystem?.setInfo(player, matchInfo.value[player])
  }

  if (lastCrateCell && sceneCamera) {
    const wx = -HALF + (lastCrateCell.x + 0.5) * CELL_SIZE
    const wz = -HALF + (lastCrateCell.y + 0.5) * CELL_SIZE
    const wy = terrainState.getHeight(wx, wz) + 2
    const src = worldToScreen(wx, wy, wz)
    const p = game.gameState.value?.players[player]
    let dst = src
    if (p) {
      const px = -HALF + (p.x + 0.5) * CELL_SIZE
      const pz = -HALF + (p.y + 0.5) * CELL_SIZE
      dst = worldToScreen(px, terrainState.getHeight(px, pz) + 5, pz)
    }
    celebrate(src.x, src.y, dst.x, dst.y, 1)
  }
  lastCrateCell = null

  cratePopup.value = { mine }
  clearTimeout(cratePopupTimer)
  cratePopupTimer = window.setTimeout(() => { cratePopup.value = null }, 2600)
}

/**
 * The badge a loss just took, kept only long enough to offer it back. The loss
 * itself is committed immediately — leaving it pending until the player dismissed
 * the screen would make closing the tab a free save.
 */
const lostStreak = ref(0)
const lostRescuable = ref(false)
/** Owned here, not by the overlay: only this side knows when the ad finished. */
const rescueBusy = ref(false)
const rewardedBusy = ref(false)
const streakAtRisk = computed(() => lostStreak.value > 0)
const streakLabel = computed(() => {
  const emoji = badgeFor(lostStreak.value)
  return emoji ? `${emoji}${lostStreak.value}` : ''
})

function settleStreak(msg: { winner: 'A' | 'B' | 'draw'; deathCauses?: Partial<Record<'A' | 'B', { type: string }>> | null }) {
  lostStreak.value = 0
  lostRescuable.value = false
  // The tutorial sits outside the system: no crate is dropped there either.
  if (game.isPractice.value) return
  const myId = game.myPlayerId.value
  if (!myId) return

  if (msg.winner === myId) { winStreak(); return }
  if (msg.winner === 'draw') return   // too rare to punish, too symmetric to reward

  // Losing to a dropped connection is the network's fault, not the player's.
  if (msg.deathCauses?.[myId]?.type === 'disconnect') return
  if (streak.value === 0) return

  lostStreak.value = streak.value
  lostRescuable.value = canRescue.value
  breakStreak()
}

async function onRescueStreak() {
  if (rescueBusy.value) return
  rescueBusy.value = true
  try {
    const watched = await platform.showRewarded().catch(() => false)
    // An ad that failed to load must not cost the player their badge — the
    // offer stays open so they can try again.
    if (!watched) return
    track('rewarded_rescue')
    restoreStreak(lostStreak.value)
    lostStreak.value = 0
    lostRescuable.value = false
  } finally {
    rescueBusy.value = false
  }
}

function onRetryConnection() {
  // "Try again" on a boot-restore that already timed out gets a fresh
  // BOOT_RESTORE_TIMEOUT_MS window of its own, rather than falling through to
  // the socket's much longer in-match budget.
  if (bootRestoreGaveUp.value) {
    bootRestoreGaveUp.value = false
    if (restoringSession.value) armBootRestoreTimer()
  }
  socket.retryConnection()
}

function onRetryConnect() {
  connectFailed.value = false
  armConnectTimer()
  socket.retryConnection()
}

function onCancelConnect() {
  pendingAction = null
  clearConnectWait()
}

function onRetryReplay() {
  if (lastReplayId) startReplay(lastReplayId)
}

/** Abandon the dead match rather than stare at a frozen board. */
function onGiveUpToLobby() {
  socket.retryConnection()
  onBackToLobby()
}

/**
 * The countdown reaching zero with nothing following it is exactly what a silently
 * dead socket looks like from the player's seat. Give the server a grace window,
 * then rebuild the connection once — the reconnect token restores the match.
 */
const TICK_STALL_GRACE_MS = 8_000
let stallNudgedForTick = -1

function checkTickStall() {
  if (game.phase.value !== 'ticking') return
  const deadline = game.tickDeadline.value
  if (!deadline) return   // practice ticks are untimed by design
  if (Date.now() - deadline < TICK_STALL_GRACE_MS) return
  if (stallNudgedForTick === game.currentTick.value) return
  stallNudgedForTick = game.currentTick.value
  console.warn('[ws] tick deadline passed with no resolve — refreshing connection')
  socket.refreshConnection()
}

async function startReplay(roomId: string) {
  track('replay_watch')
  lastReplayId = roomId
  replayLoadFailed.value = false
  const gen = ++replayGeneration
  const data = await fetchReplayData(roomId)
  // Generation first: a replay the player has already navigated away from must
  // not raise a notice for a screen they are no longer looking at.
  if (gen !== replayGeneration) return
  if (!data || data.frames.length === 0) {
    replayLoadFailed.value = true
    return
  }

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
    // Every frame invalidates the last one's storm, animated or not: stepping back
    // and restarting both land in the immediate branch, and a bolt still flashing
    // from the frame they replaced must not bring its gale along afterwards.
    const gen = ++replayStormGeneration

    if (animate && frame.weather && playersSystem) {
      const weather = frame.state.weather
      const paths = frame.weather.windPath as Record<'A' | 'B', { x: number; y: number }[]>
      const deaths = frame.weather.deaths as ('A' | 'B')[]

      const animateWind = () => {
        if (gen !== replayStormGeneration || !playersSystem) return
        if (weather && hasWind(weather.type)) {
          windSystem?.setDirection(weather.dir)
          windSystem?.setVisible(true)
        }
        playersSystem.animateWindPaths(paths, deaths).then(() => {
          if (!playersSystem) return
          playersSystem.applyPositions(frame.state.players.A, frame.state.players.B)
          windSystem?.setVisible(false)
        })
      }

      // Replays are watched from A's seat, so A's is the bolt that gets drawn.
      const bolt = frame.weather.boltCell?.A ?? null
      if (bolt && weather && hasLightning(weather.type) && lightningSystem) {
        lightningSystem.strike(bolt, terrainState).then(animateWind)
      } else {
        animateWind()
      }
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
  // A bolt caught mid-flash owns no frame any more — its gale must not blow
  // through the lobby and move the players about once the replay is closed.
  replayStormGeneration++

  if (playersSystem) {
    playersSystem.playerA.resetAppearance()
    playersSystem.playerB.resetAppearance()
  }
  terrainState.resetFlat()
  resetVisuals()
  switchToOrbit()
  audio.enterLobby(game.selectedCharacter.value)
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

/**
 * The slab is seen along its diagonal, so its widest reach on screen is that
 * diagonal — and on a phone held upright it does not come close to fitting: both
 * side corners, and with them the cells the storm decides, fall outside the
 * frame. Below this aspect the camera is pulled back until the whole slab is
 * inside; above it the composed framing stands, along with whatever zoom the
 * player set themselves.
 */
const FIT_ASPECT = 1.2
const FIT_MARGIN = 1.04
/**
 * The footprint at rest, not the raised extremes: a single corner cell lifted a
 * step is worth less than the screen the slack would cost every match.
 */
const FIT_CORNERS: THREE.Vector3[] = []
for (const x of [-HALF, HALF]) {
  for (const z of [-HALF, HALF]) {
    FIT_CORNERS.push(new THREE.Vector3(x, 0, z))
  }
}

function fitCameraToBoard(cam: THREE.PerspectiveCamera) {
  if (cam.aspect >= FIT_ASPECT) return
  const dir = cam.position.clone()
  if (dir.lengthSq() === 0) return
  let dist = dir.length()
  dir.divideScalar(dist)

  const v = new THREE.Vector3()
  // A corner's screen position is not linear in the distance, so close in on it.
  // The margin is applied once at the end — folding it into every iteration would
  // compound it (1.04^5 ≈ 1.22), pushing the camera much further back than intended.
  for (let i = 0; i < 5; i++) {
    cam.position.copy(dir).multiplyScalar(dist)
    cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld()
    let worst = 0
    for (const corner of FIT_CORNERS) {
      v.copy(corner).project(cam)
      worst = Math.max(worst, Math.abs(v.x), Math.abs(v.y))
    }
    dist *= worst
  }
  dist *= FIT_MARGIN

  cam.position.copy(dir).multiplyScalar(dist)
  cam.lookAt(0, 0, 0)
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

/* ── Tutorial (practice match vs bot, via the «How to play» chip) ── */
const TUTORIAL_STORAGE_KEY = 'wheee:tutorial_done'
/** Legacy key from the old slide-based onboarding — don't force veterans through the tutorial. */
const LEGACY_STORIES_KEY = 'wheee:stories_skipped'

function hasDoneTutorial(): boolean {
  return storageGet(TUTORIAL_STORAGE_KEY) !== null || storageGet(LEGACY_STORIES_KEY) !== null
}

/* ── Intro fly-around (first game only) ── */
const INTRO_STORAGE_KEY = 'wheee:intro_seen'
const introActive = ref(false)
const introYouPos = ref({ x: 0, y: 0 })
const introOpponentPos = ref({ x: 0, y: 0 })
const introShowLabels = ref(false)
const introBounceFlip = ref(false)

/* Active tutorial hint key (practice mode) — used to highlight the flip button. */
const tutorialHint = ref<string | null>(null)

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
/** Height of the platform's sticky banner, 0 where there is none. */
const stickyInset = ref(0)
const MENU_MARGIN = 96
function clampMenuPos(x: number, y: number) {
  const mx = Math.min(MENU_MARGIN, window.innerWidth / 2)
  const my = Math.min(MENU_MARGIN, window.innerHeight / 2)
  // The sticky banner eats the bottom strip. A menu clamped into it would put
  // Raise/Lower under the ad, where they cannot be tapped.
  const usableHeight = window.innerHeight - stickyInset.value
  return {
    x: Math.max(mx, Math.min(x, window.innerWidth - mx)),
    y: Math.max(my, Math.min(y, usableHeight - my)),
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
    opts.push({ action: 'move', label: t('action.move'), icon: 'move', disabled: false })
  }
  opts.push(
    { action: 'raise', label: t('action.raise'), icon: 'raise', disabled: v === 1 },
    { action: 'lower', label: t('action.lower'), icon: 'lower', disabled: v === -1 },
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
let bonusSystem: ReturnType<typeof createBonusSystem> | null = null
let sceneCleanup: (() => void) | null = null

const replayMode = ref(false)
const replayPlayer = shallowRef<ReplayPlayer | null>(null)
let lastRoomId: string | null = null
let replayGeneration = 0
/** The last replay the player asked for, so the notice's retry has a target. */
let lastReplayId: string | null = null
const replayLoadFailed = ref(false)
// Any phase change means the player has moved off whichever screen raised the
// last replay-fetch failure — the notice must not follow them to the next one.
watch(() => game.phase.value, () => { replayLoadFailed.value = false })
/** Bumped on every replay frame and on exit, so an abandoned storm cannot finish late. */
let replayStormGeneration = 0
/**
 * The live-match analogue of replayStormGeneration: bumped by resetVisuals(),
 * which every visual-invalidating transition already calls (watcher:redirect,
 * reconnect, a fresh round:start, leaving the match, ...). A weather:result
 * handler captures the value it saw on entry and compares against this on
 * each async continuation — if they differ, the chain is stale and must not
 * apply wind/rain visuals or old position data. concludeStorm() must still
 * run either way, so a deferred game:end is never left stuck in pendingGameEnd.
 */
let liveStormGeneration = 0

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

function preventContextMenu(e: Event) { e.preventDefault() }

/** Only during an actual live turn — never in lobby, queue, or after game-over. */
function handleBeforeUnload(e: BeforeUnloadEvent) {
  if (isInGame.value) {
    e.preventDefault()
    e.returnValue = ''
  }
}

let sceneReady = false

function applyGameState(state: GameState) {
  terrainState.applyBoardState(state.board)
  if (playersSystem) {
    playersSystem.applyPositions(state.players.A, state.players.B)
  }
  if (bonusSystem) {
    const crate = state.activeBonus
    // One crystal driven through the slab — both players see their own half of
    // it. `mine` only decides which face gets the bright hoop.
    const mine = !!crate && (!crate.for || crate.for === game.myPlayerId.value)
    bonusSystem.setBonus(crate, mine)
    if (crate) lastCrateCell = { x: crate.x, y: crate.y }
  }
}

function resetVisuals() {
  // Invalidates any in-flight weather:result chain: a watcher:redirect,
  // reconnect, fresh round:start, or exit that lands here mid-storm must not
  // let that stale chain's wind/rain visuals or old position data through.
  liveStormGeneration++
  clearTimeout(cratePopupTimer)
  cratePopup.value = null
  windSystem?.setVisible(false)
  rainSystem?.setVisible(false)
  glassSystem?.close()
  // The sky over this round is done rumbling, whatever the last forecast promised.
  audio.setStormAmbience(false)
  audio.stopCrackle()
  // Nor is anything owed to a storm nobody is watching any more: the mass drains
  // off in a few frames rather than being cut away mid-sky.
  stormSystem?.discharge('fast')
  audio.setStormBed(0)
  stormSystem?.setTremor(false)
  waterSystem?.clear()
  pendingWaterVolume = null
  // Never leave the storm waiting on water that will not come.
  floodResolve?.()
  floodResolve = null
  nameplateSystem?.setVisible(false)
  // An uncollected crystal belongs to the match it was dropped in.
  bonusSystem?.clear()
  lastCrateCell = null
}

/**
 * The storm is heard before it is seen. Distant rumbles from a quarter chance up,
 * mains-hum crackle once the dial is all but certain — driven straight off the
 * forecast, so a watcher hears the same sky the players are reading. null stands
 * for "no forecast to listen to", which silences both.
 *
 * A broken barometer is what hides rain/lightning in the first place
 * (GAME_DESIGN.md: it blinds the whole sky, not just its own dial reading), so
 * the raw probability must never reach these two once it's broken — that would
 * leak the true forecast through distant thunder and rim crackle even while the
 * dial itself is scrambled. Gated the same way the dome's zenith mode is:
 * re-rolled on the dial's own broken cadence (~0.12-0.30s) rather than simply
 * silenced, so listening in tells a watcher nothing truer than looking would.
 */
let baroAmbienceTimer: ReturnType<typeof setInterval> | null = null
watch(
  () => {
    const p = game.gameState.value?.phase
    if (p !== 'forecast' && p !== 'ticking') return null
    const f = game.forecast.value
    if (!f) return null
    return { prob: f.lightningProbability, barometerBroken: game.myInstrumentsBroken.value.barometer }
  },
  (v) => {
    if (baroAmbienceTimer !== null) { clearInterval(baroAmbienceTimer); baroAmbienceTimer = null }
    if (!v) {
      audio.setStormAmbience(false)
      audio.stopCrackle()
      return
    }
    if (!v.barometerBroken) {
      audio.setStormAmbience(v.prob >= 0.25)
      if (v.prob >= 0.75) audio.startCrackle()
      else audio.stopCrackle()
      return
    }
    const reroll = () => {
      const fake = Math.random()
      audio.setStormAmbience(fake >= 0.25)
      if (fake >= 0.75) audio.startCrackle()
      else audio.stopCrackle()
    }
    reroll()
    baroAmbienceTimer = setInterval(reroll, 200)
  },
)

/**
 * ...and then it is seen. The dome reads the same dial the player does: the same
 * wind candidates, the same broken vane, and a bolt likely enough to pool the
 * darkness overhead instead of along the horizon. Only a live forecast builds a
 * storm — a replay keeps a dead sky, since its ticks are never played out.
 */
watch(
  () => {
    if (replayMode.value) return null
    const p = game.gameState.value?.phase
    if (p !== 'forecast' && p !== 'ticking') return null
    const f = game.forecast.value
    if (!f) return null
    return {
      candidates: f.windCandidates,
      // The same side the dial reads from: a watcher and the architect hold
      // working instruments, so they see the storm's honest bearing.
      vane: game.myInstrumentsBroken.value.vane,
      stormy: f.lightningProbability >= 0.5,
      // Passed through, not resolved here: a broken barometer must not leak
      // the true reading into the sky either, so storm.ts does its own
      // scrambling of zenith mode rather than trusting this value outright.
      barometerBroken: game.myInstrumentsBroken.value.barometer,
    }
  },
  (f) => {
    if (!f) return
    stormSystem?.setForecast(f.candidates, f.vane, f.stormy, f.barometerBroken)
  },
)

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
      nameplateSystem?.setLocalPlayer(msg.playerId)
      if (nameplateSystem && msg.playerInfo) {
        matchInfo.value = msg.playerInfo
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
      nameplateSystem?.setLocalPlayer(msg.playerId)
      if (nameplateSystem && msg.playerInfo) {
        matchInfo.value = msg.playerInfo
        nameplateSystem.setInfo('A', msg.playerInfo.A)
        nameplateSystem.setInfo('B', msg.playerInfo.B)
        nameplateSystem.setVisible(true)
      }
      switchToOrbit()
      startAnimating()
      platform.gameplayStart()
      audio.enterMatch(game.selectedCharacter.value)
      break
    }
    case 'reconnect:fail': {
      previewSystem?.hide()
      playersSystem?.hideMoveOptions()
      menuVisible.value = false
      terrainState.resetFlat()
      resetVisuals()
      startAnimating()
      audio.enterLobby(game.selectedCharacter.value)
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
      nameplateSystem?.setLocalPlayer(null)
      if (nameplateSystem && msg.playerInfo) {
        matchInfo.value = msg.playerInfo
        nameplateSystem.setInfo('A', msg.playerInfo.A)
        nameplateSystem.setInfo('B', msg.playerInfo.B)
        nameplateSystem.setVisible(true)
      }
      switchToTrackball()
      applyGameState(msg.state)
      startAnimating()
      platform.gameplayStart()
      audio.enterMatch(game.selectedCharacter.value)
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
      nameplateSystem?.setLocalPlayer(null)
      if (nameplateSystem && msg.playerInfo) {
        matchInfo.value = msg.playerInfo
        nameplateSystem.setInfo('A', msg.playerInfo.A)
        nameplateSystem.setInfo('B', msg.playerInfo.B)
        nameplateSystem.setVisible(true)
      }
      switchToTrackball()
      applyGameState(msg.state)
      startAnimating()
      platform.gameplayStart()
      audio.enterMatch(game.selectedCharacter.value)
      audio.play('match-found')
      break
    }
    case 'architect:prompt': {
      architectHudRef.value?.startCountdown()
      break
    }
    case 'watcher:redirect': {
      platform.gameplayStop()
      resetVisuals()
      audio.stopWeather()
      socket.joinWatch()
      break
    }
    case 'tick:start': {
      previewSystem?.hide()
      playersSystem?.hideMoveOptions()
      menuVisible.value = false
      // Every tick spent is the front a fifth of the way closer; by the last one
      // it is standing at the board's edge. Live matches only — replay frames
      // arrive out of order and never build toward anything.
      if (!replayMode.value) {
        stormSystem?.setProgress((msg.tick + 1) / TICKS_PER_ROUND)
        // The wind hums up ahead of the cataclysm: silent on tick 1, full bed
        // hum by tick 5. setStormBed(0) is a no-op once startWind() has taken
        // ownership, so this never fights the real gale.
        audio.setStormBed(msg.tick >= 1 ? (msg.tick + 1) / TICKS_PER_ROUND : 0)
        // The fifth tick (0-based: 4) is the worst of it — a shiver in the camera
        // right up to the strike.
        stormSystem?.setTremor(msg.tick === 4)
      }
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
      // The cataclysm takes the soundscape and the camera over from here —
      // whatever the tick-driven bed and tremor were doing, this is the last
      // word.
      audio.setStormBed(0)
      stormSystem?.setTremor(false)
      // The hush plus a two-act strike stretches this chain to ~1.4s of real
      // time, wide enough for a watcher:redirect, a reconnect, or a fresh
      // round:start to land underneath it (any of which calls resetVisuals()
      // and so bumps liveStormGeneration). Captured synchronously, before any
      // of that async work starts.
      const gen = liveStormGeneration
      terrainState.applyBoardState(msg.result.state.board)
      const weather = msg.result.state.weather
      const stormy = weather ? hasLightning(weather.type) : false
      // Nothing about the round is announced until the whole storm has played —
      // and with a bolt in it, the storm now starts before the wind does.
      weatherAnimDone = false
      const deaths = msg.result.deaths as ('A' | 'B')[]
      const causeOf = (pid: 'A' | 'B') => msg.result.deathCauses[pid]?.type
      // Only the wind takes a body away with it; the water keeps the one it drowned.
      const blownAway = deaths.filter(pid => causeOf(pid) === 'wind')
      const drowned = deaths.filter(pid => causeOf(pid) === 'rain')
      const struckDead = (['A', 'B'] as const).filter(pid => causeOf(pid) === 'lightning')
      // Own hollows aside, water has to be built for a drowning on the far side
      // too: the player watches it through the glass.
      const flooding = msg.result.floodedCells.length > 0 || drowned.length > 0
      if (flooding) pendingWaterVolume = msg.result.waterVolume
      // Claimed here, not after the hush: the hollows can finish filling while the
      // sky is still holding its breath, and the storm must not wait on a promise
      // made after the water already stopped rising.
      const floodWait = flooding ? waitForFlood() : null
      // The storm has already resolved, so showing the opponent gives nothing away.
      if (deaths.length > 0) glassSystem?.open()
      startAnimating()

      /** The verdict, once nothing on the board is moving any more. */
      const concludeStorm = () => {
        weatherAnimDone = true
        if (pendingGameEnd) {
          // The match is over: whatever sky is left lets go slowly, behind the
          // verdict overlay rather than under it. A stale chain has already been
          // discharged by the reset that made it stale, and the sky above the
          // screen now belongs to someone else's round.
          if (gen === liveStormGeneration) stormSystem?.discharge('exhale')
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
      }

      /**
       * The cataclysm, in order: the sky goes quiet, the leader crawls down, and
       * everything loud lands on the frame it touches. The gale is held back until
       * then — a hush you can hear the wind through is no hush at all.
       */
      const touchdown = () => {
        audio.play('thunder-crack')
        audio.duckMusic(300)
        if ('vibrate' in navigator) navigator.vibrate?.(40)
        for (const pid of struckDead) playersSystem?.flashDeath(pid)
        glassSystem?.pulse()
      }

      const runStorm = async () => {
        if (!stormy) return
        audio.beginHush()
        // A bolt that kills stops the sky dead: the front freezes where it stands
        // for the length of the hush, and the strike is what releases it.
        if (struckDead.length > 0) stormSystem?.halt()
        await new Promise(r => setTimeout(r, HUSH_MS))
        // Watchers and the architect have no side; they stand where A stands.
        const mySide = game.myPlayerId.value ?? 'A'
        const bolt = msg.result.boltCell?.[mySide] ?? null
        // Null on the side the bolt passed over: nothing falls on this half of the
        // slab, so the thunder is all there is, and it carries at once.
        if (bolt && lightningSystem) await lightningSystem.strike(bolt, terrainState, touchdown)
        else touchdown()
        audio.endHush()
        // The bolt was the whole storm: with the round already decided by it, the
        // frozen front is released straight into its fade. Skipped once the chain
        // has gone stale — a discharge would drain the next round's sky instead.
        if (struckDead.length > 0 && gen === liveStormGeneration) stormSystem?.discharge('cataclysm')
      }

      // Whatever the sky does, the wind, the water and the verdict still have to
      // follow: a thrown prelude must never be what strands the round.
      runStorm().catch(err => console.warn('[storm] the bolt sequence failed', err)).then(() => {
        // Stale means some later transition (redirect, reconnect, a fresh
        // round:start, ...) already reset the visuals this chain was built
        // for. Skip applying wind/rain/position visuals from the old message
        // onto whatever is on screen now — but concludeStorm() below still
        // has to run either way, or a game:end deferred into pendingGameEnd
        // while this chain was in flight would be stuck there forever.
        const stale = gen !== liveStormGeneration

        // The front's crossing, joined to the storm barrier below so the verdict
        // still waits for the sky as well as for the bodies and the water.
        let sweepWait: Promise<unknown> | null = null

        // A lethal bolt cancels the wind and the rain in the engine (deaths.length
        // === 0 gates both there), so the client must not start visuals or loops
        // that nothing will ever turn off before Play Again.
        if (!stale && weather && hasWind(weather.type) && struckDead.length === 0) {
          windSystem?.setDirection(weather.dir)
          // The gale is born out of the front's leading edge rather than out of
          // nowhere: the curtain starts crossing the board first, and the lines
          // only fade in once it is far enough over to have brought them.
          sweepWait = stormSystem?.sweep(weather.dir) ?? Promise.resolve()
          setTimeout(() => {
            if (gen !== liveStormGeneration) return
            windSystem?.setVisible(true)
            audio.startWind()
          }, WIND_ONSET_MS)
        }
        if (!stale && weather && hasRain(weather.type) && struckDead.length === 0) {
          rainSystem?.setVisible(true)
          audio.startRain()
        }
        // Every storm that actually resolved spends itself here: the mass that was
        // building all round drains away while what it brought plays out.
        if (!stale) stormSystem?.discharge('cataclysm')

        if (playersSystem) {
          const paths = msg.result.windPath as Record<'A' | 'B', { x: number; y: number }[]>
          if (!stale && (paths.A.length > 1 || paths.B.length > 1)) audio.play('wind-push')
          // The storm is over once the wind has carried everyone it could and the
          // water has stopped rising — only then is the round decided out loud.
          // A stale chain skips the actual animation (it would move today's
          // players along yesterday's path) and resolves that leg at once —
          // concludeStorm() below still needs to run, just without waiting
          // out a movement nobody should see.
          const storm: Promise<unknown>[] = [stale ? Promise.resolve() : playersSystem.animateWindPaths(paths, blownAway)]
          if (floodWait) storm.push(floodWait)
          if (sweepWait) storm.push(sweepWait)
          Promise.all(storm).then(() => {
            if (gen === liveStormGeneration && playersSystem) {
              playersSystem.applyPositions(msg.result.state.players.A, msg.result.state.players.B, drowned)
              if (deaths.length > 0) audio.play('death')
            }
            audio.stopWeather()
            concludeStorm()
          })
        } else {
          audio.stopWeather()
          concludeStorm()
        }
      })
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
let lightningSystem: ReturnType<typeof createLightningSystem> | null = null
let stormSystem: ReturnType<typeof createStormSystem> | null = null
/** Water that came down and still has to be built, in cell-depths. */
let pendingWaterVolume: number | null = null
/** Set while the storm waits for the hollows to finish filling. */
let floodResolve: (() => void) | null = null
let previewSystem: ReturnType<typeof createPreviewSystem> | null = null
let glassSystem: ReturnType<typeof createGlassSystem> | null = null
let pendingGameEnd: { type: 'game:end'; winner: 'A' | 'B' | 'draw' } | null = null
let lobbyDemo: ReturnType<typeof createLobbyDemo> | null = null
let lobbyDemoActive = false

function waitForFlood(): Promise<void> {
  floodResolve?.()
  return new Promise<void>((resolve) => { floodResolve = resolve })
}

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
  camera.updateProjectionMatrix()
  fitCameraToBoard(camera)
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
  topMesh.renderOrder = GLASS_ORDER.nearFace
  scene.add(topMesh)

  const bottomGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS)
  bottomGeo.rotateX(-Math.PI / 2)
  const bottomPos = bottomGeo.attributes.position as THREE.BufferAttribute
  const bottomMesh = new THREE.Mesh(bottomGeo, terrainMat)
  bottomMesh.renderOrder = GLASS_ORDER.farFace
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
  const skirtMesh = new THREE.Mesh(skirtGeo, terrainMat)
  skirtMesh.renderOrder = GLASS_ORDER.farFace
  scene.add(skirtMesh)

  const gridStep = SIZE / SEGMENTS
  const gridLineCount = (7 + 1) * SEGMENTS * 4
  const gridPts = new Float32Array(gridLineCount * 3)
  const gridGeo = new THREE.BufferGeometry()
  const gridPos = new THREE.BufferAttribute(gridPts, 3)
  gridGeo.setAttribute('position', gridPos)
  // Bright enough to read cell borders at a glance — the old 0.35 swamp-green
  // vanished into the grass (UX review §3).
  const gridLineMat = new THREE.LineBasicMaterial({ color: 0x69b869, transparent: true, opacity: 0.6 })
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
  const lightning = createLightningSystem(scene, camera)
  lightningSystem = lightning
  const storm = createStormSystem(scene, new THREE.Color(CROP_THEME[game.selectedCharacter.value].skyTint))
  stormSystem = storm
  const compass = createCompassSystem(scene)
  const preview = createPreviewSystem(scene, terrainState)
  previewSystem = preview

  // The opponent is hidden under the slab; butterflies gather over their cell.
  const insects = createInsectSystem(scene, terrainState, () => {
    const myId = game.myPlayerId.value
    const p = game.phase.value
    if (!myId || (p !== 'forecast' && p !== 'ticking' && p !== 'weather')) return null
    const opp = game.opponentPlayer.value
    if (!opp || !opp.alive) return null
    const hidden = myId === 'A' ? players.playerB : players.playerA
    return {
      cx: hidden.state.cx,
      cz: hidden.state.cz,
      character: opp.character,
      scatter: p === 'weather',
    }
  })

  // A storm that kills someone clears the slab, so the player sees the verdict
  // instead of only being told it.
  const glass = createGlassSystem(terrainMat)
  glassSystem = glass

  const bonus = createBonusSystem(scene, terrainState)
  bonusSystem = bonus

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
            myActionLabel.value = t('action.move')
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
    myActionLabel.value = t(action === 'raise' ? 'action.raise' : 'action.lower')
    audio.play('action-submit')
    if (action === 'raise') preview.showRaise(cx, cz)
    else if (action === 'lower') preview.showLower(cx, cz)
  }

  // The terrain palette carries the current crop's decorative accent
  // (lib/cropTheme.ts); every repaint goes through here so the accent can't
  // drift between the initial paint, the animation loop, and a lobby change.
  const repaintTerrain = () => {
    const accent = CROP_THEME[game.selectedCharacter.value].paletteAccent
    terrainState.paintColors(geo, false, accent)
    terrainState.paintColors(bottomGeo, true, accent)
    terrainState.paintColors(skirtGeo, false, accent)
  }

  // Start flat
  terrainState.resetFlat()

  terrainState.rebuildMesh(pos, bottomPos, skirtPos)
  terrainState.rebuildHeightCache()
  geo.computeVertexNormals()
  bottomGeo.computeVertexNormals()
  skirtGeo.computeVertexNormals()
  repaintTerrain()
  rebuildGrid()

  watch(() => game.selectedCharacter.value, (character) => {
    storm.setBaseColor(new THREE.Color(CROP_THEME[character].skyTint))
    repaintTerrain()
  })

  sceneReady = true
  audio.enterLobby(game.selectedCharacter.value)

  document.addEventListener('contextmenu', preventContextMenu)
  window.addEventListener('beforeunload', handleBeforeUnload)

  platform.ready()

  // Sticky banner from the start, with the UI above it kept clear of the strip
  // it occupies. Platforms without a banner report nothing and nothing moves.
  const unsubSticky = platform.onStickyChange((heightPx) => {
    stickyInset.value = heightPx
    document.documentElement.style.setProperty('--sticky-inset', `${heightPx}px`)
  })
  platform.showSticky()
  refreshRewardedAvailability()

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
    // The demo has no storm behind it, so let the rain fill every hollow.
    onRequestFlood() { pendingWaterVolume = CELLS * CELLS },
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
      repaintTerrain()
      rebuildGrid()
      if (done) {
        animating = false
        terrainState.rebuildHeightCache()
        if (pendingWaterVolume !== null) {
          terrainState.computeFlood()
          terrainState.computeFloodBot()
          water.buildTop(pendingWaterVolume)
          water.buildBot(pendingWaterVolume)
          pendingWaterVolume = null
          if (!lobbyDemoActive) audio.play('water-rise')
          if (floodResolve) window.setTimeout(floodResolve, WATER_FILL_MS)
        }
      }
    }

    water.update(dt)
    wind.update(dt)
    rain.update(dt)
    lightning.update(dt)
    storm.update(dt)
    players.update(dt)
    nameplates.update(dt)
    interaction.update(dt)
    preview.update(dt)
    insects.update(dt)
    glass.update(dt)
    bonus.update(dt)
    audio.update(dt)
    const tremorOffset = storm.getCameraOffset()
    if (tremorOffset.lengthSq() > 0) {
      camera.position.add(tremorOffset)
      renderer.render(scene, camera)
      camera.position.sub(tremorOffset)
    } else {
      renderer.render(scene, camera)
    }
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
    Howler.mute(document.hidden || audio.isMuted())
    cancelAnimationFrame(animId)
    if (!document.hidden) {
      prevTime = performance.now()
      animate()
    }
  }
  document.addEventListener('visibilitychange', onVisibility)

  const stallTimer = setInterval(checkTickStall, 2_000)

  const unsubPause = platform.onPause(() => {
    Howler.mute(true)
  })
  const unsubResume = platform.onResume(() => {
    if (!audio.isMuted()) Howler.mute(false)
  })

  const onResize = () => {
    const rw = el.clientWidth, rh = el.clientHeight
    camera.aspect = rw / rh
    camera.updateProjectionMatrix()
    renderer.setSize(rw, rh)
    // Turning a phone sideways changes what fits, so the framing is redone.
    if (!introActive.value && !demoOrbitActive) fitCameraToBoard(camera)
    if (controls instanceof TrackballControls) controls.handleResize()
  }
  window.addEventListener('resize', onResize)

  sceneCleanup = () => {
    document.removeEventListener('visibilitychange', onVisibility)
    clearInterval(stallTimer)
    unsubSticky()
    unsubPause()
    unsubResume()
    clearTimeout(contextLostTimer)
    window.removeEventListener('resize', onResize)
    water.dispose()
    wind.dispose()
    rain.dispose()
    lightning.dispose()
    storm.dispose()
    compass.dispose()
    players.dispose()
    nameplates.dispose()
    interaction.dispose()
    preview.dispose()
    insects.dispose()
    glass.dispose()
    bonus.dispose()
    handleAction = null
    playersSystem = null
    nameplateSystem = null
    previewSystem = null
    glassSystem = null
    bonusSystem = null
    waterSystem = null
    windSystem = null
    rainSystem = null
    lightningSystem = null
    stormSystem = null
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
  clearBootRestoreTimer()
  if (baroAmbienceTimer !== null) clearInterval(baroAmbienceTimer)
  disposeCelebrate()
  pendingGameEnd = null
  unsubMessage1?.()
  unsubMessage2?.()
  unsubAuth()
  document.removeEventListener('contextmenu', preventContextMenu)
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  window.removeEventListener('beforeunload', handleBeforeUnload)
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
        <div class="reconnect-text">{{ t('app.contextLost') }}</div>
      </div>
    </div>
  </Transition>

  <!-- Reconnecting overlay — also covers the boot-time "restoring a reloaded
       match" wait (see showReconnecting), so a resume that never resolves
       still surfaces the give-up retry/lobby buttons instead of a bare
       spinner with no way out. bootRestoreGaveUp forces those buttons on its
       own short timer (BOOT_RESTORE_TIMEOUT_MS), well before socket.gaveUp
       would ever flip on a boot restore's much longer in-match budget. -->
  <Transition name="rc">
    <div v-if="showReconnecting" class="reconnect-overlay">
      <div class="reconnect-card">
        <template v-if="socket.gaveUp.value || bootRestoreGaveUp">
          <div class="reconnect-text">{{ t('app.connectionLost') }}</div>
          <div class="reconnect-actions">
            <button class="reconnect-btn primary" @click="onRetryConnection">{{ t('app.retry') }}</button>
            <button class="reconnect-btn" @click="onGiveUpToLobby">{{ t('app.toLobby') }}</button>
          </div>
        </template>
        <template v-else>
          <div class="reconnect-spinner" />
          <div class="reconnect-text">{{ showRestoringSession ? t('app.restoringSession') : t('app.reconnecting') }}</div>
        </template>
      </div>
    </div>
  </Transition>

  <!-- A queued lobby action waiting on a socket that has not come up. This
       card only reports the wait: `pendingAction` stays armed, so a late
       connect still starts the match and dismisses this on its own. Gated off
       `showReconnecting` too: that overlay already owns the screen (and its
       own retry/give-up buttons) during a boot restore or a mid-match
       reconnect, and this card must not paint over it. -->
  <Transition name="rc">
    <div v-if="connectFailed && !showReconnecting" class="reconnect-overlay">
      <div class="reconnect-card">
        <div class="reconnect-text">{{ t('net.connectFailed') }}</div>
        <div class="reconnect-actions">
          <button class="reconnect-btn primary" @click="onRetryConnect">{{ t('app.retry') }}</button>
          <button class="reconnect-btn" @click="onCancelConnect">{{ t('lobby.cancel') }}</button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- Crate collected — says plainly whose badge just started -->
  <Transition name="crate-pop">
    <div v-if="cratePopup" class="crate-banner" :class="{ mine: cratePopup.mine }">
      <span class="crate-gem">◈</span>
      {{ cratePopup.mine ? t('crate.youTook') : t('crate.theyTook') }}
    </div>
  </Transition>

  <!-- Opponent disconnected banner -->
  <Transition name="od">
    <div v-if="showOpponentDisconnected" class="opponent-dc-banner">
      <div class="opponent-dc-dot" />
      {{ t('app.opponentDc') }}
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
    :live-matches="liveMatches"
    :queue-countdown="game.queueCountdown.value"
    :invite-url="inviteUrl"
    :can-share="canShareInvite"
    :is-instance-wait="isInstanceWait"
    :has-incoming-invite="!!incomingInvite"
    :invite-failed="game.inviteFailed.value"
    :replay-failed="replayLoadFailed"
    :offline="socket.offline.value && !restoringSession"
    :connecting="connectPending"
    @select="onSelectCharacter"
    @play="onPlay"
    @how-to-play="onHowToPlay"
    @watch="onWatch"
    @architect="onArchitect"
    @watch-replay="startReplay"
    @retry-replay="onRetryReplay"
    @retry-connect="onRetryConnection"
    @cancel-search="onCancelSearch"
    @invite="onInvite"
    @share-invite="onShareInvite"
  />

  <GameHud
    v-if="showHud"
    :phase="(game.phase.value as 'forecast' | 'ticking' | 'weather')"
    :round="game.gameState.value?.round ?? 1"
    :tick="game.currentTick.value"
    :tick-deadline="game.tickDeadline.value"
    :forecast-deadline="game.forecastDeadline.value"
    :action-submitted="game.actionSubmitted.value"
    :my-action-label="myActionLabel"
    :opponent-acted="game.opponentActed.value"
    :show-opponent="!game.isPractice.value"
    :my-player-id="game.myPlayerId.value ?? 'A'"
    :bounce-flip="introBounceFlip || tutorialHint === 'tutorial.flip'"
    @flip="onFlipView"
  />

  <ForecastPanel
    v-if="showHud && game.forecast.value"
    :wind-candidates="game.forecast.value.windCandidates"
    :rain-probability="game.forecast.value.rainProbability"
    :lightning-probability="game.forecast.value.lightningProbability"
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
    :replay-failed="replayLoadFailed"
    :character="game.selectedCharacter.value"
    :death-causes="game.deathCauses.value"
    :wind-spared="game.windSpared.value"
    :rain-spared="game.rainSpared.value"
    :lightning-spared="game.lightningSpared.value"
    :show-rewarded-button="hasRewardedAds"
    :can-rescue-streak="streakAtRisk && lostRescuable && hasRewardedAds"
    :streak-badge="streakLabel"
    :rescue-busy="rescueBusy"
    :rewarded-busy="rewardedBusy"
    :rematch-state="rematchState"
    @rematch="onRematch"
    @rematch-cancel="onRematchCancel"
    @play-again="onPlayAgain"
    @rewarded-play-again="onRewardedPlayAgain"
    @rescue-streak="onRescueStreak"
    @watch-replay="startReplay"
    @retry-replay="onRetryReplay"
    @back-to-lobby="onBackToLobby"
  />

  <ReplayOverlay
    v-if="replayMode && replayPlayer"
    :player="replayPlayer"
    @exit="exitReplay"
  />

  <TutorialHud
    v-if="game.isPractice.value && showHud"
    :phase="(game.phase.value as 'forecast' | 'ticking' | 'weather')"
    :tick="game.currentTick.value"
    :round="game.gameState.value?.round ?? 1"
    :action-submitted="game.actionSubmitted.value"
    @hint="tutorialHint = $event"
  />

  <VolumeControl />

  <!-- Intro labels -->
  <Transition name="intro-label">
    <div v-if="introShowLabels" class="intro-labels">
      <div class="intro-label intro-you" :style="{ left: introYouPos.x + 'px', top: introYouPos.y + 'px' }">
        <div class="intro-label-dot" />
        <span>{{ t('app.you') }}</span>
      </div>
      <div class="intro-label intro-opp" :style="{ left: introOpponentPos.x + 'px', top: introOpponentPos.y + 'px' }">
        <div class="intro-label-dot" />
        <span>{{ t('app.opponent') }}</span>
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
          <div class="wp-text">{{ t('app.winnerPredicted') }}</div>
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

.crate-banner {
  position: fixed;
  top: calc(var(--sg-safe-top, 0px) + 92px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 320;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 22px;
  border-radius: 999px;
  background: rgba(18, 22, 30, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(14px);
  font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.6px;
  color: rgba(200, 210, 230, 0.72);
}

.crate-banner.mine {
  border-color: rgba(232, 197, 71, 0.45);
  color: #f0d678;
  box-shadow: 0 0 24px rgba(232, 197, 71, 0.18);
}

.crate-gem {
  font-size: 15px;
  color: rgba(200, 210, 230, 0.5);
}

.crate-banner.mine .crate-gem {
  color: #e8c547;
  text-shadow: 0 0 10px rgba(232, 197, 71, 0.8);
}

.crate-pop-enter-active { transition: opacity 0.3s, transform 0.35s cubic-bezier(0.16, 1, 0.3, 1); }
.crate-pop-leave-active { transition: opacity 0.4s, transform 0.4s ease; }
.crate-pop-enter-from { opacity: 0; transform: translateX(-50%) translateY(-10px) scale(0.94); }
.crate-pop-leave-to { opacity: 0; transform: translateX(-50%) translateY(-6px); }

.reconnect-actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

.reconnect-btn {
  font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.6px;
  padding: 9px 18px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(215, 224, 240, 0.85);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.reconnect-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.24);
}

.reconnect-btn.primary {
  border-color: rgba(232, 197, 71, 0.5);
  background: rgba(232, 197, 71, 0.14);
  color: #e8c547;
}

.reconnect-btn.primary:hover {
  background: rgba(232, 197, 71, 0.22);
  border-color: rgba(232, 197, 71, 0.7);
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
  top: calc(var(--sg-safe-top, 0px) + 16px);
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
