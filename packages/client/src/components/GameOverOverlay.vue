<script setup lang="ts">
import { onMounted, onUnmounted, computed, inject } from 'vue'
import type { DeathCause, PlayerId } from '@wheee/shared'
import type { AudioSystem } from '../lib/audio'
import { celebrate, disposeCelebrate } from '../lib/celebrate'
import { t } from '../lib/i18n'
import { formatDuration, streakChip, type MatchStats } from '../lib/matchSummary'

function dirLabel(d: string): string {
  return t(`dir.${d}`)
}

const props = defineProps<{
  winner: PlayerId | 'draw' | null
  myPlayerId: PlayerId | null
  roomId: string | null
  deathCauses?: Partial<Record<PlayerId, DeathCause>> | null
  /** Player the wind released because the other one left the board first. */
  windSpared?: PlayerId | null
  /** Player the water released because the other one went under first. */
  rainSpared?: PlayerId | null
  /** Player spared because the other one stood taller and took the bolt. */
  lightningSpared?: PlayerId | null
  showRewardedButton?: boolean
  /** A badge streak is about to be wiped and the one rescue is still unspent. */
  canRescueStreak?: boolean
  /** Rendered badge, e.g. "🌧 7" — shown on the rescue button. */
  streakBadge?: string
  /** Ads in flight. Owned by the parent, the only side that knows when they end. */
  rescueBusy?: boolean
  rewardedBusy?: boolean
  /**
   * Whether playing this same person again is on the table, and how far the
   * handshake has got. Only ever leaves 'none' for a PvP match both players
   * finished — see the server's Room.humanPair.
   */
  rematchState?: 'none' | 'available' | 'waiting' | 'offered'
  /** Rounds, length and badge — the match the card is about. */
  stats?: MatchStats | null
}>()

const emit = defineEmits<{
  playAgain: []
  rematch: []
  rematchCancel: []
  rewardedPlayAgain: []
  rescueStreak: []
  watchReplay: [roomId: string]
  backToLobby: []
}>()

const audio = inject<AudioSystem>('audio')

const isWin = computed(() => props.myPlayerId && props.winner === props.myPlayerId)
const isDraw = computed(() => props.winner === 'draw')
const isSpectator = computed(() => !props.myPlayerId)

const rematchLabel = computed(() => {
  if (props.rematchState === 'waiting') return t('gameover.rematchWaiting')
  if (props.rematchState === 'offered') return t('gameover.rematchOffered')
  return t('gameover.rematch')
})

/** Asking twice would be a no-op on the server, so a second press withdraws. */
function onRematchClick() {
  audio?.play('ui-click')
  if (props.rematchState === 'waiting') emit('rematchCancel')
  else emit('rematch')
}

const title = computed(() => {
  if (isDraw.value) return t('gameover.stalemate')
  if (isSpectator.value) return t('gameover.playerWins', props.winner!)
  if (isWin.value) return t('gameover.victory')
  return t('gameover.defeated')
})

const subtitle = computed(() => {
  const causes = props.deathCauses
  if (!causes) {
    if (isDraw.value) return t('gameover.bothFell')
    if (isSpectator.value) return t('gameover.concluded')
    if (isWin.value) return t('gameover.stormBends')
    return t('gameover.tryAgain')
  }

  const myId = props.myPlayerId
  const oppId: PlayerId | null = myId === 'A' ? 'B' : myId === 'B' ? 'A' : null

  if (isDraw.value) {
    const aCause = causes.A
    const bCause = causes.B
    if (aCause?.type === 'wind' && bCause?.type === 'wind') return t('gameover.bothBlown')
    if (aCause?.type === 'rain' && bCause?.type === 'rain') return t('gameover.bothDrowned')
    if (aCause?.type === 'lightning' && bCause?.type === 'lightning') return t('gameover.bothStruck')
    return t('gameover.bothFell')
  }

  if (isSpectator.value) {
    const loserId = props.winner === 'A' ? 'B' : 'A'
    const cause = causes[loserId]
    if (props.windSpared === props.winner) return t('gameover.flewFirst', loserId)
    if (props.rainSpared === props.winner) return t('gameover.drownedFirst', loserId)
    if (props.lightningSpared === props.winner) return t('gameover.stoodTaller', loserId)
    if (cause?.type === 'wind') return t('gameover.blownOff', loserId, dirLabel(cause.dir))
    if (cause?.type === 'rain') return t('gameover.drowned', loserId)
    if (cause?.type === 'lightning') return t('gameover.struck', loserId)
    if (cause?.type === 'disconnect') return t('gameover.disconnected', loserId)
    return t('gameover.concluded')
  }

  if (isWin.value) {
    const oppCause = oppId ? causes[oppId] : null
    if (props.windSpared === myId) return t('gameover.opponentFlewFirst')
    if (props.rainSpared === myId) return t('gameover.opponentDrownedFirst')
    if (props.lightningSpared === myId) return t('gameover.opponentStoodTaller')
    if (oppCause?.type === 'wind') return t('gameover.opponentBlown', dirLabel(oppCause.dir))
    if (oppCause?.type === 'rain') return t('gameover.opponentDrowned')
    if (oppCause?.type === 'lightning') return t('gameover.opponentStruck')
    if (oppCause?.type === 'disconnect') return t('gameover.opponentDisconnected')
    return t('gameover.stormBends')
  }

  const myCause = myId ? causes[myId] : null
  if (props.windSpared === oppId) return t('gameover.youFlewFirst')
  if (props.rainSpared === oppId) return t('gameover.youDrownedFirst')
  if (props.lightningSpared === oppId) return t('gameover.youStoodTaller')
  if (myCause?.type === 'wind') return t('gameover.youBlown', dirLabel(myCause.dir))
  if (myCause?.type === 'rain') return t('gameover.youDrowned')
  if (myCause?.type === 'lightning') return t('gameover.youStruck')
  return t('gameover.tryAgain')
})

const chips = computed(() => {
  const s = props.stats
  if (!s) return []
  const out = [t('gameover.statRound', s.round), t('gameover.statTime', formatDuration(s.durationMs))]
  const sc = streakChip(s.streak)
  if (sc) out.push(sc)
  return out
})

const resultClass = computed(() => {
  if (isDraw.value) return 'draw'
  if (isSpectator.value) return 'spectator'
  if (isWin.value) return 'win'
  return 'lose'
})

function onRescueClick() {
  if (props.rescueBusy) return
  audio?.play('ui-click')
  emit('rescueStreak')
}

function onRewardedClick() {
  if (props.rewardedBusy) return
  audio?.play('ui-click')
  emit('rewardedPlayAgain')
}

let fireworkInterval = 0
const fireworkTimeouts: number[] = []

function launchFireworks() {
  const w = window.innerWidth
  const h = window.innerHeight
  const cx = w / 2
  const cy = h * 0.3

  for (let i = 0; i < 5; i++) {
    fireworkTimeouts.push(window.setTimeout(() => {
      const sx = cx + (Math.random() - 0.5) * w * 0.6
      const sy = cy + (Math.random() - 0.5) * h * 0.4
      const tx = sx + (Math.random() - 0.5) * 100
      const ty = sy - 40 - Math.random() * 60
      celebrate(sx, sy, tx, ty, 0)
    }, i * 200))
  }

  fireworkInterval = window.setInterval(() => {
    const sx = Math.random() * w
    const sy = h * 0.08 + Math.random() * h * 0.4
    const tx = sx + (Math.random() - 0.5) * 80
    const ty = sy - 30 - Math.random() * 50
    celebrate(sx, sy, tx, ty, 0)
  }, 800)
}

onMounted(() => {
  if (isWin.value) {
    launchFireworks()
  }
})

onUnmounted(() => {
  for (const tid of fireworkTimeouts) clearTimeout(tid)
  fireworkTimeouts.length = 0
  if (fireworkInterval) {
    clearInterval(fireworkInterval)
    fireworkInterval = 0
  }
  disposeCelebrate()
})
</script>

<template>
  <div class="gameover">
    <div class="gameover-card" :class="resultClass">
      <!-- Glow ring behind title for win -->
      <div v-if="isWin" class="win-glow" />

      <h1 class="result-title">{{ title }}</h1>
      <p class="result-sub">{{ subtitle }}</p>

      <div v-if="chips.length" class="stat-row">
        <span v-for="c in chips" :key="c" class="stat-chip">{{ c }}</span>
      </div>

      <div class="btn-row">
        <!-- A human opponent is the scarce thing in this game: the queue hands
             out a bot after 8 seconds, so playing the same person again beats
             re-queueing, and it takes the primary slot whenever it is offered. -->
        <button
          v-if="rematchState && rematchState !== 'none'"
          class="btn-again btn-rematch"
          :class="[resultClass, { asked: rematchState === 'waiting', offered: rematchState === 'offered' }]"
          @click="onRematchClick"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 1l4 4-4 4" />
            <path d="M3 11V9a4 4 0 014-4h14" />
            <path d="M7 23l-4-4 4-4" />
            <path d="M21 13v2a4 4 0 01-4 4H3" />
          </svg>
          <span>{{ rematchLabel }}</span>
        </button>

        <button class="btn-again" :class="resultClass" @click="audio?.play('ui-click'); emit('playAgain')">
          <span>{{ t('gameover.playAgain') }}</span>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
        </button>

        <!-- A badge about to be lost is worth far more than a free replay, so it
             takes the rewarded slot whenever there is one at stake. -->
        <button
          v-if="canRescueStreak"
          class="btn-rewarded btn-rescue"
          :class="{ loading: rescueBusy }"
          :disabled="rescueBusy"
          @click="onRescueClick"
        >
          <svg v-if="!rescueBusy" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 21s-7-4.35-9.33-8.42A5.4 5.4 0 0112 5.5a5.4 5.4 0 019.33 7.08C19 16.65 12 21 12 21z" />
          </svg>
          <div v-else class="rewarded-spinner" />
          <span>{{ t('gameover.keepStreak', streakBadge ?? '') }}</span>
        </button>

        <button v-else-if="showRewardedButton" class="btn-rewarded" :class="{ loading: rewardedBusy }" :disabled="rewardedBusy" @click="onRewardedClick">
          <svg v-if="!rewardedBusy" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="8" width="18" height="13" rx="2" />
            <path d="M12 8V21" />
            <path d="M3 12h18" />
            <path d="M12 8c-2-3-6-4-6-1s4 1 6 1" />
            <path d="M12 8c2-3 6-4 6-1s-4 1-6 1" />
          </svg>
          <div v-else class="rewarded-spinner" />
          <span>{{ t('gameover.rewardedPlay') }}</span>
        </button>

        <button v-if="roomId" class="btn-replay" @click="audio?.play('ui-click'); emit('watchReplay', roomId!)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          <span>{{ t('gameover.replay') }}</span>
        </button>
      </div>

      <button
        type="button"
        class="btn-lobby"
        @click="audio?.play('ui-click'); emit('backToLobby')"
      >
        {{ t('gameover.backToLobby') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.gameover {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  /* Low on the screen, not over it: the board and whoever is still standing
     on it stay in view above the card. */
  align-items: flex-end;
  justify-content: center;
  padding-bottom: calc(8vh + var(--sg-safe-bottom, 0px));
  box-sizing: border-box;
  pointer-events: none;
  animation: overlayIn 0.5s ease both;
}

@keyframes overlayIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.gameover-card {
  position: relative;
  text-align: center;
  padding: 48px 64px;
  border-radius: 24px;
  background: rgba(12, 16, 24, 0.55);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  pointer-events: auto;
  animation: cardIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
  overflow: hidden;
}

@keyframes cardIn {
  0% { opacity: 0; transform: scale(0.85) translateY(20px); }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}

/* State-specific card borders */
.gameover-card.win {
  border-color: rgba(255, 215, 80, 0.15);
  box-shadow: 0 0 60px rgba(255, 200, 60, 0.08), 0 8px 32px rgba(0, 0, 0, 0.3);
}

.gameover-card.lose {
  border-color: rgba(180, 160, 200, 0.1);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.gameover-card.draw {
  border-color: rgba(200, 200, 160, 0.1);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.gameover-card.spectator {
  border-color: rgba(160, 140, 220, 0.12);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

/* ── Win glow ── */

.win-glow {
  position: absolute;
  top: -40px;
  left: 50%;
  transform: translateX(-50%);
  width: 200px;
  height: 200px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 200, 60, 0.15) 0%, transparent 70%);
  pointer-events: none;
  animation: glowPulse 2s ease-in-out infinite;
}

@keyframes glowPulse {
  0%, 100% { opacity: 0.8; transform: translateX(-50%) scale(1); }
  50% { opacity: 1; transform: translateX(-50%) scale(1.15); }
}

/* ── Title ── */

.result-title {
  font-size: 44px;
  font-weight: 800;
  letter-spacing: 2px;
  margin: 0 0 8px;
  line-height: 1.1;
  animation: titlePop 0.5s 0.2s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes titlePop {
  0% { opacity: 0; transform: scale(0.7); }
  100% { opacity: 1; transform: scale(1); }
}

.win .result-title {
  color: rgba(255, 220, 100, 0.95);
  text-shadow: 0 0 30px rgba(255, 200, 60, 0.3), 0 0 60px rgba(255, 200, 60, 0.1);
}

.lose .result-title {
  color: rgba(200, 180, 220, 0.85);
  text-shadow: 0 0 20px rgba(180, 160, 210, 0.15);
}

.draw .result-title {
  color: rgba(220, 220, 180, 0.85);
  text-shadow: 0 0 20px rgba(200, 200, 140, 0.15);
}

.spectator .result-title {
  color: rgba(180, 160, 240, 0.9);
  text-shadow: 0 0 20px rgba(160, 140, 220, 0.2);
}

/* ── Subtitle ── */

.result-sub {
  color: rgba(200, 210, 225, 0.4);
  font-size: 13px;
  font-weight: 400;
  letter-spacing: 0.5px;
  margin: 0 0 32px;
  animation: fadeUp 0.5s 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes fadeUp {
  0% { opacity: 0; transform: translateY(8px); }
  100% { opacity: 1; transform: translateY(0); }
}

/* ── Button ── */

/* ── Stats ── */

.stat-row {
  display: flex;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: -16px 0 24px;
  animation: fadeUp 0.5s 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.stat-chip {
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(200, 210, 225, 0.7);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.3px;
}

.btn-again {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 32px;
  border-radius: 12px;
  border: 1.5px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(220, 225, 235, 0.8);
  font-family: inherit;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.5px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

/* The offered state has to read as someone waiting on you, so it pulses; the
   asked state reads as spent and goes quiet. Both stay legible on either of
   the win/lose tints btn-again already carries. */
.btn-rematch.offered {
  border-color: rgba(120, 200, 255, 0.55);
  background: rgba(120, 200, 255, 0.16);
  color: rgba(235, 246, 255, 0.96);
  animation: rematch-pulse 1.8s ease-in-out infinite;
}

.btn-rematch.asked {
  opacity: 0.6;
  animation: none;
}

@keyframes rematch-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(120, 200, 255, 0.34); }
  50% { box-shadow: 0 0 0 7px rgba(120, 200, 255, 0); }
}

@media (prefers-reduced-motion: reduce) {
  .btn-rematch.offered { animation: none; }
}

.btn-again:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.15);
  transform: translateY(-2px);
}

.btn-again.win {
  border-color: rgba(255, 200, 60, 0.25);
  color: rgba(255, 220, 100, 0.9);
  box-shadow: 0 0 20px rgba(255, 200, 60, 0.08);
}

.btn-again.win:hover {
  border-color: rgba(255, 200, 60, 0.4);
  background: rgba(255, 200, 60, 0.08);
  box-shadow: 0 0 30px rgba(255, 200, 60, 0.15);
}

.btn-again.lose {
  border-color: rgba(180, 160, 210, 0.2);
  color: rgba(200, 185, 230, 0.8);
}

.btn-again.lose:hover {
  border-color: rgba(180, 160, 210, 0.35);
  background: rgba(160, 140, 200, 0.08);
}

.btn-again svg {
  transition: transform 0.3s;
}

.btn-again:hover svg {
  transform: rotate(-45deg);
}

.btn-row {
  display: flex;
  gap: 12px;
  justify-content: center;
  animation: fadeUp 0.5s 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.btn-rewarded {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 12px 24px;
  border-radius: 12px;
  border: 1.5px solid rgba(52, 211, 153, 0.2);
  background: rgba(52, 211, 153, 0.06);
  color: rgba(110, 231, 183, 0.8);
  font-family: inherit;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.5px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.btn-rewarded:hover:not(:disabled) {
  background: rgba(52, 211, 153, 0.1);
  border-color: rgba(110, 231, 183, 0.35);
  transform: translateY(-2px);
}
.btn-rewarded.loading {
  opacity: 0.5;
  cursor: wait;
}

/* Rescuing a badge is the warmer offer of the two — it keeps something. */
.btn-rescue {
  border-color: rgba(232, 197, 71, 0.35);
  background: rgba(232, 197, 71, 0.09);
  color: rgba(240, 214, 120, 0.92);
}
.btn-rescue:hover:not(:disabled) {
  background: rgba(232, 197, 71, 0.16);
  border-color: rgba(232, 197, 71, 0.6);
}

.rewarded-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(110, 231, 183, 0.2);
  border-top-color: rgba(110, 231, 183, 0.8);
  border-radius: 50%;
  animation: rc-spin 0.8s linear infinite;
}

@keyframes rc-spin {
  to { transform: rotate(360deg); }
}

.btn-replay {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 12px 24px;
  border-radius: 12px;
  border: 1.5px solid rgba(139, 180, 255, 0.2);
  background: rgba(139, 180, 255, 0.06);
  color: rgba(139, 180, 255, 0.8);
  font-family: inherit;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.5px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.btn-replay:hover {
  background: rgba(139, 180, 255, 0.1);
  border-color: rgba(139, 180, 255, 0.35);
  transform: translateY(-2px);
}

.btn-lobby {
  display: block;
  margin: 20px auto 0;
  padding: 8px 16px;
  border: none;
  background: none;
  color: rgba(160, 175, 200, 0.55);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  cursor: pointer;
  transition: color 0.2s, opacity 0.2s;
  animation: fadeUp 0.5s 0.55s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.btn-lobby:hover {
  color: rgba(200, 210, 225, 0.9);
}

/* ── Mobile ── */

@media (max-width: 640px) {
  .gameover { padding-bottom: calc(6vh + var(--sg-safe-bottom, 0px)); }
  .gameover-card { padding: 28px 24px; }
  .result-title { font-size: 32px; }
  .result-sub { margin: 0 0 20px; font-size: 12px; }
  .btn-row { flex-direction: column; align-items: center; }
}
</style>
