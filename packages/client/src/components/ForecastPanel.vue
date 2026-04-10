<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import type { WindDir } from '@wheee/shared'

const props = defineProps<{
  windCandidates: WindDir[]
  rainProbability: number
  vaneBroken: boolean
  barometerBroken: boolean
}>()

/* ── Direction → angle ── */

const DIR_ANGLE: Record<WindDir, number> = { N: 0, E: 90, S: 180, W: 270 }

/* ── Wind vane state ── */

const needleAngle = ref(0)
let needleVel = 0
let oscTime = 0
let brokenVaneT = 0
let brokenVaneTarget = 0

const SPRING_K = 8
const SPRING_D = 5
const BROKEN_K = 30
const BROKEN_D = 10

function getVaneTarget(): number {
  if (props.vaneBroken) return brokenVaneTarget
  const c = props.windCandidates
  if (c.length === 0) return needleAngle.value
  if (c.length === 1) return DIR_ANGLE[c[0]]
  const a1 = DIR_ANGLE[c[0]]
  const a2 = DIR_ANGLE[c[1]]
  const t = (Math.sin(oscTime * 1.3) + 1) / 2
  let diff = a2 - a1
  if (diff > 180) diff -= 360
  if (diff < -180) diff += 360
  return a1 + diff * t
}

/* ── Rain barometer state ── */

const displayLevel = ref(0)
let brokenBaroT = 0

function rainLevel(p: number): number {
  if (p < 0.15) return 0
  if (p < 0.35) return 1
  if (p < 0.55) return 2
  if (p < 0.8) return 3
  return 4
}

const targetLevel = computed(() => rainLevel(props.rainProbability))
const iconLevel = computed(() => Math.max(0, Math.min(4, Math.round(displayLevel.value))))

/* ── Break flash ── */

const vaneFlash = ref(false)
const baroFlash = ref(false)
let vaneFlashTimer = 0
let baroFlashTimer = 0

watch(() => props.vaneBroken, (v) => {
  if (v) { vaneFlash.value = true; clearTimeout(vaneFlashTimer); vaneFlashTimer = window.setTimeout(() => { vaneFlash.value = false }, 700) }
})
watch(() => props.barometerBroken, (v) => {
  if (v) { baroFlash.value = true; clearTimeout(baroFlashTimer); baroFlashTimer = window.setTimeout(() => { baroFlash.value = false }, 700) }
})

/* ── Compass geometry (static) ── */

const compassTicks = (() => {
  const marks: { x1: number; y1: number; x2: number; y2: number; w: number; color: string }[] = []
  for (let i = 0; i < 24; i++) {
    const angle = i * 15
    const rad = (angle - 90) * Math.PI / 180
    const isMajor = angle % 90 === 0
    const isHalf = angle % 30 === 0
    const r1 = isMajor ? 73 : isHalf ? 78 : 82
    const r2 = 87
    marks.push({
      x1: 100 + r1 * Math.cos(rad),
      y1: 100 + r1 * Math.sin(rad),
      x2: 100 + r2 * Math.cos(rad),
      y2: 100 + r2 * Math.sin(rad),
      w: isMajor ? 2.2 : isHalf ? 1.2 : 0.5,
      color: isMajor ? '#4a6a88' : isHalf ? '#283848' : '#1c2838',
    })
  }
  return marks
})()

const roseLines = (() => {
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = []
  for (let a = 0; a < 360; a += 45) {
    const rad = (a - 90) * Math.PI / 180
    lines.push({
      x1: 100 + 30 * Math.cos(rad),
      y1: 100 + 30 * Math.sin(rad),
      x2: 100 + 66 * Math.cos(rad),
      y2: 100 + 66 * Math.sin(rad),
    })
  }
  return lines
})()

/* ── Animation loop ── */

let animId = 0
let prevTime = 0

function tick(time: number) {
  animId = requestAnimationFrame(tick)
  if (!prevTime) { prevTime = time; return }
  const dt = Math.min((time - prevTime) / 1000, 0.05)
  prevTime = time
  oscTime += dt

  /* Vane spring */
  if (props.vaneBroken) {
    brokenVaneT += dt
    if (brokenVaneT > 0.08 + Math.random() * 0.12) {
      brokenVaneTarget = Math.random() * 360
      brokenVaneT = 0
    }
  }

  const target = getVaneTarget()
  let angleDiff = target - needleAngle.value
  while (angleDiff > 180) angleDiff -= 360
  while (angleDiff < -180) angleDiff += 360

  const k = props.vaneBroken ? BROKEN_K : SPRING_K
  const d = props.vaneBroken ? BROKEN_D : SPRING_D
  const force = angleDiff * k - needleVel * d
  needleVel += force * dt
  needleAngle.value += needleVel * dt

  if (!props.vaneBroken && props.windCandidates.length === 0) {
    needleAngle.value += Math.sin(oscTime * 0.3) * 0.1 * dt
  }

  /* Barometer smooth */
  if (props.barometerBroken) {
    brokenBaroT += dt
    if (brokenBaroT > 0.12 + Math.random() * 0.18) {
      displayLevel.value = Math.floor(Math.random() * 5)
      brokenBaroT = 0
    }
  } else {
    const tl = targetLevel.value
    const diff = tl - displayLevel.value
    if (Math.abs(diff) > 0.02) {
      displayLevel.value += Math.sign(diff) * Math.min(Math.abs(diff), dt * 3.5)
    } else {
      displayLevel.value = tl
    }
  }
}

onMounted(() => {
  prevTime = 0
  animId = requestAnimationFrame(tick)
})

onUnmounted(() => {
  cancelAnimationFrame(animId)
  clearTimeout(vaneFlashTimer)
  clearTimeout(baroFlashTimer)
})
</script>

<template>
  <div class="forecast-panel">
    <div class="compass-wrap" :class="{ flash: vaneFlash || baroFlash }">
      <svg class="compass-svg" viewBox="0 0 200 200">
        <defs>
          <radialGradient id="sg-compass-bg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#161e2c" />
            <stop offset="85%" stop-color="#0c1018" />
            <stop offset="100%" stop-color="#080c14" />
          </radialGradient>
          <linearGradient id="sg-needle-n" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f0c848" />
            <stop offset="50%" stop-color="#d4a020" />
            <stop offset="100%" stop-color="#a07818" />
          </linearGradient>
          <linearGradient id="sg-needle-s" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#384858" />
            <stop offset="100%" stop-color="#222d3a" />
          </linearGradient>
          <filter id="sg-needle-glow">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="sg-center-bg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#131a28" />
            <stop offset="100%" stop-color="#0a0f18" />
          </radialGradient>
        </defs>

        <!-- Face -->
        <circle cx="100" cy="100" r="92" fill="url(#sg-compass-bg)" />
        <circle cx="100" cy="100" r="92" fill="none" stroke="#1e3048" stroke-width="2" />
        <circle cx="100" cy="100" r="90" fill="none" stroke="#0e1828" stroke-width="0.5" />

        <!-- Inner rings -->
        <circle cx="100" cy="100" r="66" fill="none" stroke="#141e2e" stroke-width="0.4" />
        <circle cx="100" cy="100" r="30" fill="none" stroke="#141e2e" stroke-width="0.4" />

        <!-- Rose lines -->
        <line
          v-for="(l, i) in roseLines" :key="'r' + i"
          :x1="l.x1" :y1="l.y1" :x2="l.x2" :y2="l.y2"
          stroke="#101a28" stroke-width="0.5"
        />

        <!-- Tick marks -->
        <line
          v-for="(t, i) in compassTicks" :key="'t' + i"
          :x1="t.x1" :y1="t.y1" :x2="t.x2" :y2="t.y2"
          :stroke="t.color" :stroke-width="t.w" stroke-linecap="round"
        />

        <!-- Cardinal letters -->
        <text x="100" y="40" text-anchor="middle" dominant-baseline="central"
          class="cardinal cardinal-n">N</text>
        <text x="164" y="103" text-anchor="middle" dominant-baseline="central"
          class="cardinal">E</text>
        <text x="100" y="166" text-anchor="middle" dominant-baseline="central"
          class="cardinal">S</text>
        <text x="36" y="103" text-anchor="middle" dominant-baseline="central"
          class="cardinal">W</text>

        <!-- Needle -->
        <g :transform="`rotate(${needleAngle} 100 100)`" filter="url(#sg-needle-glow)">
          <polygon points="100,18 96,90 104,90" fill="url(#sg-needle-n)" />
          <polygon points="100,182 96,110 104,110" fill="url(#sg-needle-s)" />
        </g>

        <!-- Center disc (covers needle ends, backdrop for weather icon) -->
        <circle cx="100" cy="100" r="26" fill="url(#sg-center-bg)" />
        <circle cx="100" cy="100" r="26" fill="none" stroke="#1a2a3e" stroke-width="0.8" />
        <circle cx="100" cy="100" r="26.8" fill="none" stroke="#b08820" stroke-width="0.4" opacity="0.25" />
      </svg>

      <!-- Weather icon in compass center -->
      <div class="baro-center" :class="{ broken: barometerBroken }">
        <Transition name="wicon" mode="out-in">
          <!-- Level 0: Sun -->
          <svg v-if="iconLevel === 0" key="sun" class="weather-icon" viewBox="0 0 50 50">
            <circle cx="25" cy="25" r="8.5" fill="#FFB040" />
            <g stroke="#FFB040" stroke-width="2.2" stroke-linecap="round" opacity="0.6">
              <line x1="25" y1="6" x2="25" y2="12" />
              <line x1="25" y1="38" x2="25" y2="44" />
              <line x1="6" y1="25" x2="12" y2="25" />
              <line x1="38" y1="25" x2="44" y2="25" />
              <line x1="11.6" y1="11.6" x2="15.8" y2="15.8" />
              <line x1="34.2" y1="34.2" x2="38.4" y2="38.4" />
              <line x1="38.4" y1="11.6" x2="34.2" y2="15.8" />
              <line x1="15.8" y1="34.2" x2="11.6" y2="38.4" />
            </g>
          </svg>

          <!-- Level 1: Partly cloudy -->
          <svg v-else-if="iconLevel === 1" key="partly" class="weather-icon" viewBox="0 0 50 50">
            <circle cx="17" cy="16" r="7" fill="#FFB040" opacity="0.75" />
            <g stroke="#FFB040" stroke-width="1.5" stroke-linecap="round" opacity="0.4">
              <line x1="17" y1="3" x2="17" y2="7" />
              <line x1="7" y1="10" x2="10" y2="12.5" />
              <line x1="4" y1="16" x2="8" y2="16" />
            </g>
            <ellipse cx="30" cy="31" rx="11" ry="7" fill="#7a90a8" />
            <circle cx="24" cy="25" r="6.5" fill="#8da0b5" />
            <circle cx="35" cy="28" r="5.5" fill="#7a90a8" />
          </svg>

          <!-- Level 2: Overcast -->
          <svg v-else-if="iconLevel === 2" key="cloudy" class="weather-icon" viewBox="0 0 50 50">
            <circle cx="18" cy="19" r="5" fill="#d0a840" opacity="0.25" />
            <ellipse cx="27" cy="27" rx="13" ry="8" fill="#5a7088" />
            <circle cx="20" cy="22" r="7" fill="#6a8098" />
            <circle cx="34" cy="25" r="6" fill="#5a7088" />
          </svg>

          <!-- Level 3: Rain -->
          <svg v-else-if="iconLevel === 3" key="rain" class="weather-icon" viewBox="0 0 50 50">
            <ellipse cx="27" cy="21" rx="13" ry="8" fill="#4a6878" />
            <circle cx="20" cy="16" r="7" fill="#5a7888" />
            <circle cx="34" cy="19" r="6" fill="#4a6878" />
            <g stroke="#4a90e0" stroke-width="1.8" stroke-linecap="round" opacity="0.75">
              <line x1="19" y1="33" x2="17" y2="40" />
              <line x1="27" y1="31" x2="25" y2="38" />
              <line x1="35" y1="33" x2="33" y2="40" />
            </g>
          </svg>

          <!-- Level 4: Storm -->
          <svg v-else key="storm" class="weather-icon" viewBox="0 0 50 50">
            <ellipse cx="27" cy="18" rx="13" ry="8" fill="#3a4a60" />
            <circle cx="20" cy="13" r="7" fill="#445870" />
            <circle cx="34" cy="16" r="6" fill="#3a4a60" />
            <polygon points="29,25 23,34 27,34 21,45 33,31 28,31 34,25"
              fill="#ffe566" opacity="0.85" class="bolt" />
            <g stroke="#3a70b0" stroke-width="1.5" stroke-linecap="round" opacity="0.5">
              <line x1="15" y1="32" x2="13" y2="39" />
              <line x1="39" y1="30" x2="37" y2="37" />
            </g>
          </svg>
        </Transition>
      </div>

      <!-- Crack overlays -->
      <svg v-if="vaneBroken" class="crack-overlay" viewBox="0 0 100 100">
        <path d="M48,3 L46,20 L53,30 L43,48 L51,60 L45,77 L48,97"
          stroke="rgba(255,50,35,0.5)" fill="none" stroke-width="1.5" stroke-linecap="round" />
        <path d="M20,28 L36,33 L50,48 L64,42 L82,45"
          stroke="rgba(255,50,35,0.3)" fill="none" stroke-width="1" stroke-linecap="round" />
      </svg>

      <svg v-if="barometerBroken" class="crack-overlay" viewBox="0 0 100 100">
        <path d="M55,5 L58,22 L50,35 L60,50 L52,65 L56,85"
          stroke="rgba(255,50,35,0.4)" fill="none" stroke-width="1.2" stroke-linecap="round" />
        <path d="M70,20 L65,38 L72,52 L66,68"
          stroke="rgba(255,50,35,0.25)" fill="none" stroke-width="0.8" stroke-linecap="round" />
      </svg>
    </div>
  </div>
</template>

<style scoped>
.forecast-panel {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 55;
  pointer-events: none;
  animation: fp-enter 0.6s cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes fp-enter {
  from { opacity: 0; transform: translateX(20px) scale(0.92); }
  to   { opacity: 1; transform: translateX(0) scale(1); }
}

/* ── Compass container ── */

.compass-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.compass-svg {
  width: 160px;
  height: 160px;
  filter: drop-shadow(0 4px 16px rgba(0, 0, 0, 0.5));
}

.cardinal {
  fill: #4a6a88;
  font-size: 11px;
  font-weight: 700;
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
}

.cardinal-n {
  fill: #c04525;
  font-size: 13px;
  font-weight: 800;
}

/* ── Weather icon in center ── */

.baro-center {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}

.weather-icon {
  width: 34px;
  height: 34px;
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.4));
}

.baro-center.broken .weather-icon {
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.4)) hue-rotate(-30deg) saturate(0.5);
}

.bolt {
  animation: bolt-flicker 2.5s ease-in-out infinite;
}

@keyframes bolt-flicker {
  0%, 100% { opacity: 0.85; }
  6%       { opacity: 0.3; }
  12%      { opacity: 0.9; }
  18%      { opacity: 0.4; }
  24%      { opacity: 0.85; }
}

/* ── Weather icon transition ── */

.wicon-enter-active,
.wicon-leave-active {
  transition: opacity 0.28s ease, transform 0.28s ease;
}

.wicon-enter-from {
  opacity: 0;
  transform: scale(0.7);
}

.wicon-leave-to {
  opacity: 0;
  transform: scale(0.7);
}

/* ── Broken vane ── */

.compass-wrap:has(.crack-overlay) .compass-svg {
  filter: drop-shadow(0 4px 16px rgba(0, 0, 0, 0.5)) hue-rotate(-10deg) saturate(0.75);
}

/* ── Crack overlay ── */

.crack-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  animation: crack-appear 0.4s ease-out;
}

@keyframes crack-appear {
  from { opacity: 0; }
  to   { opacity: 1; }
}

/* ── Break flash ── */

.compass-wrap::after {
  content: '';
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  pointer-events: none;
  opacity: 0;
}

.compass-wrap.flash::after {
  background: radial-gradient(circle, rgba(255, 50, 35, 0.3), transparent 70%);
  animation: break-flash 0.7s ease-out forwards;
}

@keyframes break-flash {
  0%   { opacity: 1; transform: scale(0.95); }
  40%  { opacity: 0.8; transform: scale(1.06); }
  100% { opacity: 0; transform: scale(1); }
}

/* ── Mobile ── */

@media (max-width: 640px) {
  .forecast-panel { top: 10px; right: 10px; }
  .compass-svg { width: 120px; height: 120px; }
  .cardinal { font-size: 10px; }
  .cardinal-n { font-size: 11px; }
}
</style>
