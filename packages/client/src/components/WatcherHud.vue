<script setup lang="ts">
import { computed, ref, watch, inject } from 'vue'
import type { PlayerId, WatcherPrediction, GamePhase } from '@wheee/shared'
import type { AudioSystem } from '../lib/audio'
import { t } from '../lib/i18n'

const props = defineProps<{
  phase: GamePhase | 'watching'
  score: number
  predictions: WatcherPrediction[]
  breakUsed: boolean
  winnerPredicted: boolean
  movePredicted: Partial<Record<PlayerId, boolean>>
}>()

const emit = defineEmits<{
  predictWinner: [playerId: PlayerId]
  breakInstrument: [instrument: 'vane' | 'barometer']
}>()

const audio = inject<AudioSystem>('audio')
const winnerPick = ref<PlayerId | null>(null)
const brokenInstrument = ref<'vane' | 'barometer' | null>(null)

watch(() => props.winnerPredicted, (v) => {
  if (!v) winnerPick.value = null
})

watch(() => props.breakUsed, (v) => {
  if (!v) brokenInstrument.value = null
})

function pickWinner(id: PlayerId) {
  if (props.winnerPredicted) return
  winnerPick.value = id
  audio?.play('ui-click')
  emit('predictWinner', id)
}

function breakIt(inst: 'vane' | 'barometer') {
  if (props.breakUsed) return
  brokenInstrument.value = inst
  emit('breakInstrument', inst)
}

const isForecast = computed(() => props.phase === 'forecast')
const isTicking = computed(() => props.phase === 'ticking')

const recentPredictions = computed(() =>
  [...props.predictions].reverse().slice(0, 5),
)
</script>

<template>
  <div class="wh">
    <!-- Score -->
    <div class="wh-score">
      <span class="wh-score-num">{{ score }}</span>
      <span class="wh-score-pts">{{ t('watcher.pts') }}</span>
    </div>

    <!-- Predict Winner -->
    <div v-if="isForecast" class="wh-block">
      <div class="wh-winner">
        <button
          class="wh-pick wh-pick-a"
          :class="{ chosen: winnerPick === 'A', dimmed: winnerPick === 'B' }"
          :disabled="winnerPredicted"
          @click="pickWinner('A')"
        >
          <span class="wh-pick-letter">A</span>
          <span class="wh-pick-label">{{ t('watcher.wins') }}</span>
        </button>
        <span class="wh-or" :class="{ 'or-dimmed': winnerPredicted }">{{ t('watcher.or') }}</span>
        <button
          class="wh-pick wh-pick-b"
          :class="{ chosen: winnerPick === 'B', dimmed: winnerPick === 'A' }"
          :disabled="winnerPredicted"
          @click="pickWinner('B')"
        >
          <span class="wh-pick-letter">B</span>
          <span class="wh-pick-label">{{ t('watcher.wins') }}</span>
        </button>
      </div>
    </div>

    <!-- Break Instrument -->
    <div v-if="isForecast || isTicking" class="wh-block">
      <div class="wh-break">
        <button
          class="wh-brk"
          :class="{ 'brk-chosen': brokenInstrument === 'vane', 'brk-dimmed': brokenInstrument === 'barometer' }"
          :disabled="breakUsed"
          @click="breakIt('vane')"
        >
          <div class="wh-brk-icon">
            <svg viewBox="0 0 32 32" width="18" height="18" fill="none">
              <path d="M16 5L12 12h8l-4-7z" fill="currentColor" opacity="0.6"/>
              <line x1="16" y1="12" x2="16" y2="27" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <circle cx="16" cy="27" r="2" fill="currentColor" opacity="0.3"/>
            </svg>
            <svg v-if="brokenInstrument === 'vane'" class="brk-crack" viewBox="0 0 32 32" width="18" height="18" fill="none">
              <path d="M10 8l4 6-3 4 5 6" stroke="rgba(220,90,60,0.7)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <span class="wh-brk-text">{{ t('watcher.vane') }}</span>
        </button>
        <button
          class="wh-brk"
          :class="{ 'brk-chosen': brokenInstrument === 'barometer', 'brk-dimmed': brokenInstrument === 'vane' }"
          :disabled="breakUsed"
          @click="breakIt('barometer')"
        >
          <div class="wh-brk-icon">
            <svg viewBox="0 0 32 32" width="18" height="18" fill="none">
              <circle cx="16" cy="16" r="10" stroke="currentColor" stroke-width="1.2" opacity="0.4"/>
              <circle cx="16" cy="16" r="6" stroke="currentColor" stroke-width="1" opacity="0.25"/>
              <line x1="16" y1="16" x2="16" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <line x1="16" y1="16" x2="20" y2="19" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.5"/>
              <circle cx="16" cy="16" r="1.5" fill="currentColor" opacity="0.6"/>
            </svg>
            <svg v-if="brokenInstrument === 'barometer'" class="brk-crack" viewBox="0 0 32 32" width="18" height="18" fill="none">
              <path d="M10 8l4 6-3 4 5 6" stroke="rgba(220,90,60,0.7)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <span class="wh-brk-text">{{ t('watcher.baro') }}</span>
        </button>
      </div>
    </div>

    <!-- Prediction History -->
    <div v-if="recentPredictions.length" class="wh-block wh-history">
      <div
        v-for="(p, i) in recentPredictions"
        :key="i"
        class="wh-hist-row"
        :class="{ correct: p.correct === true, wrong: p.correct === false }"
      >
        <span class="wh-hist-dot" />
        <span class="wh-hist-label">
          {{ p.type === 'winner' ? 'W' : 'M' }}
          R{{ p.round }}<template v-if="p.type === 'move'">·T{{ p.tick }}</template>
        </span>
        <span class="wh-hist-pts">
          {{ p.correct === true ? `+${p.points}` : p.correct === false ? '×' : '…' }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wh {
  position: fixed;
  top: 18px;
  left: 18px;
  z-index: 55;
  display: flex;
  flex-direction: column;
  gap: 12px;
  pointer-events: auto;
  animation: wh-in 0.5s cubic-bezier(0.16, 1, 0.3, 1);
  font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
}

@keyframes wh-in {
  from { opacity: 0; transform: translateY(-12px) scale(0.96); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

/* ── Score ── */

.wh-score {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.wh-score-num {
  font-size: 32px;
  font-weight: 900;
  letter-spacing: -1px;
  color: rgba(255, 220, 120, 0.92);
  text-shadow: 0 0 24px rgba(255, 200, 60, 0.25), 0 0 4px rgba(255, 200, 60, 0.15);
  line-height: 1;
  transition: text-shadow 0.3s;
}

.wh-score-num.wh-score-pop {
  animation: score-pop 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes score-pop {
  0%   { transform: scale(1);   text-shadow: 0 0 24px rgba(255,200,60,0.25); }
  30%  { transform: scale(1.35); text-shadow: 0 0 40px rgba(255,200,60,0.6), 0 0 80px rgba(255,180,40,0.3); }
  100% { transform: scale(1);   text-shadow: 0 0 24px rgba(255,200,60,0.25); }
}

.wh-score-pts {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1px;
  color: rgba(255, 220, 120, 0.3);
  text-transform: uppercase;
}

/* ── Blocks ── */

.wh-block { padding: 0; }

/* ── Winner prediction ── */

.wh-winner {
  display: flex;
  align-items: center;
  gap: 8px;
}

.wh-or {
  font-size: 9px;
  font-weight: 500;
  color: rgba(160, 175, 200, 0.2);
  font-style: italic;
}

.wh-pick {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 8px 16px;
  border-radius: 12px;
  border: none;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  position: relative;
  overflow: hidden;
}

.wh-pick::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 12px;
  opacity: 0;
  transition: opacity 0.25s;
}

.wh-pick:hover:not(:disabled)::before { opacity: 1; }

.wh-pick-a {
  background: rgba(230, 180, 60, 0.08);
  color: rgba(240, 200, 90, 0.7);
}
.wh-pick-a::before { background: rgba(230, 180, 60, 0.12); }
.wh-pick-a:hover:not(:disabled) {
  color: rgba(255, 215, 100, 0.95);
  box-shadow: 0 0 20px rgba(230, 180, 60, 0.15);
  transform: scale(1.05);
}

.wh-pick-b {
  background: rgba(80, 180, 220, 0.08);
  color: rgba(100, 200, 230, 0.7);
}
.wh-pick-b::before { background: rgba(80, 180, 220, 0.12); }
.wh-pick-b:hover:not(:disabled) {
  color: rgba(120, 220, 250, 0.95);
  box-shadow: 0 0 20px rgba(80, 180, 220, 0.15);
  transform: scale(1.05);
}

.wh-pick:active:not(:disabled) { transform: scale(0.95); }

.wh-pick:disabled { cursor: default; }

.wh-pick-letter {
  font-size: 18px;
  font-weight: 900;
  line-height: 1;
}

.wh-pick-label {
  font-size: 7px;
  font-weight: 600;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  opacity: 0.5;
}

/* chosen = this one was picked */
.wh-pick-a.chosen {
  background: rgba(230, 180, 60, 0.15);
  color: rgba(255, 215, 100, 0.95);
  box-shadow: 0 0 18px rgba(230, 180, 60, 0.12);
}
.wh-pick-b.chosen {
  background: rgba(80, 180, 220, 0.15);
  color: rgba(120, 220, 250, 0.95);
  box-shadow: 0 0 18px rgba(80, 180, 220, 0.12);
}

/* dimmed = the other one */
.wh-pick.dimmed {
  opacity: 0.2;
  transform: scale(0.92);
}
.wh-pick.dimmed:hover { transform: scale(0.92); box-shadow: none; }

.or-dimmed { opacity: 0.1; }

/* ── Break ── */

.wh-break {
  display: flex;
  gap: 8px;
}

.wh-brk {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 10px 14px 6px;
  border-radius: 14px;
  border: none;
  background: rgba(255, 255, 255, 0.03);
  color: rgba(200, 160, 140, 0.45);
  font-family: inherit;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  position: relative;
}

.wh-brk::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 14px;
  border: 1px solid rgba(200, 130, 100, 0.06);
  transition: border-color 0.3s;
  pointer-events: none;
}

.wh-brk:hover:not(:disabled) {
  background: rgba(220, 100, 70, 0.08);
  color: rgba(240, 170, 140, 0.8);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(200, 70, 40, 0.08);
}

.wh-brk:hover:not(:disabled)::after {
  border-color: rgba(220, 130, 100, 0.15);
}

.wh-brk:active:not(:disabled) {
  transform: translateY(0) scale(0.95);
}

.wh-brk:disabled { cursor: default; }

/* chosen = this instrument was broken */
.wh-brk.brk-chosen {
  background: rgba(220, 90, 60, 0.1);
  color: rgba(220, 120, 100, 0.7);
}
.wh-brk.brk-chosen::after {
  border-color: rgba(220, 90, 60, 0.18);
}
.wh-brk.brk-chosen .wh-brk-icon {
  background: rgba(220, 90, 60, 0.12);
  box-shadow: 0 0 10px rgba(220, 90, 60, 0.08);
}

/* dimmed = the other instrument */
.wh-brk.brk-dimmed {
  opacity: 0.18;
  transform: scale(0.92);
}
.wh-brk.brk-dimmed:hover { transform: scale(0.92); box-shadow: none; background: rgba(255,255,255,0.03); }

.wh-brk-icon {
  position: relative;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(200, 100, 70, 0.06);
  transition: all 0.3s;
}

.wh-brk:hover:not(:disabled) .wh-brk-icon {
  background: rgba(220, 110, 80, 0.12);
  box-shadow: 0 0 12px rgba(220, 100, 70, 0.1);
}

.wh-brk-text {
  font-size: 8px;
  font-weight: 600;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  opacity: 0.6;
}

.wh-brk:hover:not(:disabled) .wh-brk-text { opacity: 0.9; }

.brk-crack {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  animation: crack-in 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes crack-in {
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }
  to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}

/* ── History ── */

.wh-history {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 100px;
  overflow-y: auto;
}

.wh-hist-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 9px;
  color: rgba(140, 160, 190, 0.3);
}

.wh-hist-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: rgba(140, 160, 190, 0.2);
  flex-shrink: 0;
}

.wh-hist-row.correct .wh-hist-dot { background: rgba(100, 220, 140, 0.7); }
.wh-hist-row.wrong .wh-hist-dot { background: rgba(220, 90, 70, 0.5); }

.wh-hist-label { flex: 1; font-weight: 500; }

.wh-hist-pts { font-weight: 700; min-width: 18px; text-align: right; }

.wh-hist-row.correct .wh-hist-pts { color: rgba(100, 220, 140, 0.7); }
.wh-hist-row.wrong .wh-hist-pts { color: rgba(220, 90, 70, 0.4); }

/* ── Mobile ── */

@media (max-width: 640px) {
  .wh { top: 12px; left: 12px; gap: 10px; }
  .wh-score-num { font-size: 26px; }
  .wh-pick { min-height: 44px; padding: 8px 14px; }
  .wh-pick-label { font-size: 9px; }
  .wh-brk { min-height: 44px; padding: 10px 12px 6px; }
  .wh-brk-icon { width: 36px; height: 36px; }
  .wh-brk-text { font-size: 9px; }
  .wh-history { max-height: 80px; }
}
</style>
