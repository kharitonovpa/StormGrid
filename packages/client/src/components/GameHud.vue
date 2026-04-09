<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import type { PlayerId } from '@stormgrid/shared'
import { TICK_DURATION_MS, TICKS_PER_ROUND } from '@stormgrid/shared'

const TICK_SECONDS = TICK_DURATION_MS / 1000

const props = defineProps<{
  phase: 'forecast' | 'ticking' | 'weather'
  round: number
  tick: number
  tickDeadline: number
  actionSubmitted: boolean
  myPlayerId: PlayerId
}>()

const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  if (timer) clearInterval(timer)
  timer = setInterval(() => { now.value = Date.now() }, 50)
})
onUnmounted(() => { if (timer) { clearInterval(timer); timer = null } })

const remaining = computed(() => {
  if (props.phase !== 'ticking' || !props.tickDeadline) return 0
  return Math.max(0, (props.tickDeadline - now.value) / 1000)
})

const remainingInt = computed(() => Math.ceil(remaining.value))

const progress = computed(() => {
  if (props.phase !== 'ticking') return 1
  return remaining.value / TICK_SECONDS
})

const arcPath = computed(() => {
  const r = 22
  const cx = 24
  const cy = 24
  const angle = progress.value * 360
  if (angle <= 0) return ''
  if (angle >= 360) return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.001} ${cy - r}`
  const rad = ((angle - 90) * Math.PI) / 180
  const x = cx + r * Math.cos(rad)
  const y = cy + r * Math.sin(rad)
  const large = angle > 180 ? 1 : 0
  return `M ${cx} ${cy - r} A ${r} ${r} 0 ${large} 1 ${x} ${y}`
})

const isUrgent = computed(() => remaining.value <= 2 && remaining.value > 0)
</script>

<template>
  <div class="hud">
    <!-- Ticking phase: timer + tick dots -->
    <Transition name="hud-fade">
      <div v-if="phase === 'ticking'" class="hud-strip" key="ticking">
        <!-- Circular timer -->
        <div class="timer-ring" :class="{ urgent: isUrgent, done: actionSubmitted }">
          <svg viewBox="0 0 48 48" class="ring-svg">
            <circle cx="24" cy="24" r="22" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="2.5" />
            <path
              v-if="arcPath"
              :d="arcPath"
              fill="none"
              :stroke="isUrgent ? '#e94560' : actionSubmitted ? '#4ade80' : '#e8c547'"
              stroke-width="2.5"
              stroke-linecap="round"
            />
          </svg>
          <span class="ring-num">{{ remainingInt }}</span>
        </div>

        <!-- Tick dots + round -->
        <div class="tick-info">
          <div class="tick-dots">
            <div
              v-for="i in TICKS_PER_ROUND"
              :key="i"
              class="tick-dot"
              :class="{
                past: i - 1 < tick,
                current: i - 1 === tick,
              }"
            />
          </div>
          <div class="round-label">Round {{ round }}</div>
        </div>

        <!-- Action status -->
        <Transition name="check-pop">
          <div v-if="actionSubmitted" class="action-check">
            <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4,10 8,14 16,6" />
            </svg>
          </div>
        </Transition>
      </div>
    </Transition>

    <!-- Forecast phase -->
    <Transition name="hud-fade">
      <div v-if="phase === 'forecast'" class="hud-strip forecast-strip" key="forecast">
        <div class="phase-icon forecast-icon">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        </div>
        <div class="phase-text">
          <span class="phase-title">Forecast</span>
          <span class="phase-sub">Reading the skies</span>
        </div>
        <div class="round-pill">R{{ round }}</div>
      </div>
    </Transition>

    <!-- Weather / Cataclysm phase -->
    <Transition name="cataclysm">
      <div v-if="phase === 'weather'" class="cataclysm-banner" key="weather">
        <div class="cataclysm-bg" />
        <div class="cataclysm-content">
          <svg class="cataclysm-bolt" viewBox="0 0 32 32" width="28" height="28">
            <polygon points="18,2 10,16 15,16 8,30 24,13 17,13 22,2" fill="currentColor" />
          </svg>
          <span class="cataclysm-text">Cataclysm</span>
          <svg class="cataclysm-bolt cataclysm-bolt-r" viewBox="0 0 32 32" width="28" height="28">
            <polygon points="18,2 10,16 15,16 8,30 24,13 17,13 22,2" fill="currentColor" />
          </svg>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.hud {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 50;
  pointer-events: none;
  display: flex;
  justify-content: center;
  padding: 16px;
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
}

/* ── Strip (ticking / forecast) ── */

.hud-strip {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 20px 10px 12px;
  border-radius: 16px;
  background: rgba(12, 16, 24, 0.5);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
}

/* ── Circular timer ── */

.timer-ring {
  position: relative;
  width: 48px;
  height: 48px;
  flex-shrink: 0;
}

.ring-svg {
  width: 48px;
  height: 48px;
  transform: rotate(-90deg);
}

.ring-num {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.85);
  letter-spacing: -0.5px;
}

.timer-ring.urgent .ring-num {
  color: #e94560;
  animation: pulse-num 0.5s ease-in-out infinite alternate;
}

.timer-ring.done .ring-num {
  color: #4ade80;
}

@keyframes pulse-num {
  from { opacity: 1; }
  to { opacity: 0.5; }
}

/* ── Tick dots ── */

.tick-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tick-dots {
  display: flex;
  gap: 6px;
}

.tick-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  border: 1.5px solid rgba(255, 255, 255, 0.12);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.tick-dot.past {
  background: rgba(228, 197, 71, 0.6);
  border-color: rgba(228, 197, 71, 0.8);
  box-shadow: 0 0 6px rgba(228, 197, 71, 0.3);
}

.tick-dot.current {
  background: #e8c547;
  border-color: #e8c547;
  box-shadow: 0 0 10px rgba(228, 197, 71, 0.5);
  animation: dot-pulse 1.2s ease-in-out infinite;
}

@keyframes dot-pulse {
  0%, 100% { box-shadow: 0 0 6px rgba(228, 197, 71, 0.3); }
  50% { box-shadow: 0 0 14px rgba(228, 197, 71, 0.6); }
}

.round-label {
  font-size: 11px;
  font-weight: 600;
  color: rgba(200, 210, 225, 0.35);
  letter-spacing: 0.5px;
}

/* ── Action check ── */

.action-check {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(74, 222, 128, 0.1);
  border: 1.5px solid rgba(74, 222, 128, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
}

.check-pop-enter-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.check-pop-enter-from {
  opacity: 0;
  transform: scale(0.5);
}

/* ── Forecast strip ── */

.forecast-strip {
  gap: 12px;
}

.phase-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.forecast-icon {
  background: rgba(255, 180, 60, 0.1);
  color: rgba(255, 180, 60, 0.7);
}

.phase-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.phase-title {
  font-size: 14px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.8);
  letter-spacing: 0.5px;
}

.phase-sub {
  font-size: 11px;
  color: rgba(200, 210, 225, 0.35);
  letter-spacing: 0.3px;
}

.round-pill {
  font-size: 11px;
  font-weight: 700;
  color: rgba(200, 210, 225, 0.3);
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  letter-spacing: 0.5px;
}

/* ── Cataclysm banner ── */

.cataclysm-banner {
  position: relative;
  padding: 14px 40px;
  border-radius: 16px;
  overflow: hidden;
}

.cataclysm-bg {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(233, 69, 96, 0.2), rgba(200, 60, 80, 0.08));
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(233, 69, 96, 0.2);
  border-radius: 16px;
  animation: cata-glow 1.5s ease-in-out infinite alternate;
}

@keyframes cata-glow {
  from { box-shadow: 0 0 30px rgba(233, 69, 96, 0.15), inset 0 0 30px rgba(233, 69, 96, 0.05); }
  to { box-shadow: 0 0 50px rgba(233, 69, 96, 0.25), inset 0 0 40px rgba(233, 69, 96, 0.08); }
}

.cataclysm-content {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
}

.cataclysm-text {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.9);
  text-shadow: 0 0 20px rgba(233, 69, 96, 0.5);
}

.cataclysm-bolt {
  color: rgba(233, 69, 96, 0.7);
  animation: bolt-flick 2s ease-in-out infinite;
}

.cataclysm-bolt-r {
  transform: scaleX(-1);
  animation-delay: 0.3s;
}

@keyframes bolt-flick {
  0%, 100% { opacity: 0.7; }
  5% { opacity: 0.2; }
  10% { opacity: 0.9; }
  15% { opacity: 0.3; }
  20% { opacity: 0.7; }
}

/* ── Transitions ── */

.hud-fade-enter-active {
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
.hud-fade-leave-active {
  transition: all 0.25s ease;
}
.hud-fade-enter-from {
  opacity: 0;
  transform: translateY(-12px) scale(0.95);
}
.hud-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.cataclysm-enter-active {
  transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}
.cataclysm-leave-active {
  transition: all 0.3s ease;
}
.cataclysm-enter-from {
  opacity: 0;
  transform: scale(0.8);
}
.cataclysm-leave-to {
  opacity: 0;
  transform: scale(0.9);
}

/* ── Mobile ── */

@media (max-width: 640px) {
  .hud { padding: 10px; }
  .hud-strip { gap: 10px; padding: 8px 14px 8px 10px; }
  .timer-ring, .ring-svg { width: 40px; height: 40px; }
  .ring-num { font-size: 14px; }
  .phase-title { font-size: 12px; }
  .phase-sub, .round-pill { font-size: 10px; }
  .cataclysm-banner { padding: 10px 24px; }
  .cataclysm-text { font-size: 16px; letter-spacing: 2px; }
}
</style>
