<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import type { GamePhase, WeatherType, WindDir, BonusType } from '@stormgrid/shared'

const props = defineProps<{
  phase: GamePhase | 'watching'
  deadline: number
  weatherSubmitted: boolean
}>()

const emit = defineEmits<{
  setWeather: [weatherType: WeatherType, dir: WindDir]
  startBonusPlace: [bonusType: BonusType]
}>()

const weatherType = ref<WeatherType>('wind')
const windDir = ref<WindDir>('N')
const bonusPlacing = ref(false)

const isForecast = computed(() => props.phase === 'forecast')

const remaining = ref(0)
let countdownId = 0

function updateCountdown() {
  const left = Math.max(0, Math.ceil((props.deadline - Date.now()) / 1000))
  remaining.value = left
  if (left > 0) countdownId = window.setTimeout(updateCountdown, 250)
}

const startCountdown = () => {
  clearTimeout(countdownId)
  if (props.deadline > 0) updateCountdown()
}

startCountdown()

onUnmounted(() => clearTimeout(countdownId))

const weatherTypes: { id: WeatherType; label: string; icon: string }[] = [
  { id: 'wind', label: 'Wind', icon: '💨' },
  { id: 'wind_rain', label: 'Storm', icon: '⛈' },
  { id: 'rain', label: 'Rain', icon: '🌧' },
]

const directions: WindDir[] = ['N', 'E', 'S', 'W']

function confirmWeather() {
  if (props.weatherSubmitted) return
  emit('setWeather', weatherType.value, windDir.value)
}

function selectBonus(type: BonusType) {
  bonusPlacing.value = true
  emit('startBonusPlace', type)
}

function resetBonusState() {
  bonusPlacing.value = false
}

defineExpose({ startCountdown, resetBonusState })


</script>

<template>
  <div class="ah">
    <!-- Weather Picker -->
    <div v-if="isForecast && !weatherSubmitted" class="ah-section">
      <div class="ah-timer">
        <span class="ah-timer-num">{{ remaining }}</span>
        <span class="ah-timer-label">s</span>
      </div>

      <div class="ah-weather-types">
        <button
          v-for="wt in weatherTypes"
          :key="wt.id"
          class="ah-wt"
          :class="{ active: weatherType === wt.id }"
          @click="weatherType = wt.id"
        >
          <span class="ah-wt-icon">{{ wt.icon }}</span>
          <span class="ah-wt-label">{{ wt.label }}</span>
        </button>
      </div>

      <div class="ah-compass">
        <button
          v-for="d in directions"
          :key="d"
          class="ah-dir"
          :class="[d.toLowerCase(), { active: windDir === d }]"
          @click="windDir = d"
        >{{ d }}</button>
        <div class="ah-compass-center" />
      </div>

      <button class="ah-confirm" @click="confirmWeather">
        Confirm Weather
      </button>
    </div>

    <!-- Weather Locked -->
    <div v-if="isForecast && weatherSubmitted" class="ah-section ah-locked">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span>Weather locked</span>
    </div>

    <!-- Bonus Placement -->
    <div v-if="isForecast" class="ah-section">
      <div class="ah-bonus-row">
        <button class="ah-bonus" @click="selectBonus('time_extend')">
          <span class="ah-bonus-icon">⏱</span>
          <span class="ah-bonus-label">Time</span>
        </button>
        <button class="ah-bonus" @click="selectBonus('intel')">
          <span class="ah-bonus-icon">🔍</span>
          <span class="ah-bonus-label">Intel</span>
        </button>
        <button class="ah-bonus" @click="selectBonus('clear_sky')">
          <span class="ah-bonus-icon">☀️</span>
          <span class="ah-bonus-label">Clear</span>
        </button>
      </div>
      <div v-if="bonusPlacing" class="ah-hint">click a cell to place</div>
    </div>
  </div>
</template>

<style scoped>
.ah {
  position: fixed;
  top: 18px;
  left: 18px;
  z-index: 55;
  display: flex;
  flex-direction: column;
  gap: 14px;
  pointer-events: auto;
  animation: ah-in 0.5s cubic-bezier(0.16, 1, 0.3, 1);
  font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
}

@keyframes ah-in {
  from { opacity: 0; transform: translateY(-12px) scale(0.96); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.ah-section { padding: 0; }

/* ── Timer ── */

.ah-timer {
  display: flex;
  align-items: baseline;
  gap: 2px;
  margin-bottom: 8px;
}

.ah-timer-num {
  font-size: 28px;
  font-weight: 900;
  letter-spacing: -1px;
  color: rgba(180, 150, 230, 0.9);
  text-shadow: 0 0 20px rgba(160, 120, 220, 0.25);
  line-height: 1;
}

.ah-timer-label {
  font-size: 10px;
  font-weight: 600;
  color: rgba(180, 150, 230, 0.3);
  text-transform: uppercase;
}

/* ── Weather Type Buttons ── */

.ah-weather-types {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}

.ah-wt {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 12px 5px;
  border-radius: 10px;
  border: none;
  background: rgba(255, 255, 255, 0.03);
  color: rgba(180, 170, 200, 0.5);
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.ah-wt:hover {
  background: rgba(160, 120, 220, 0.08);
  color: rgba(200, 180, 230, 0.8);
}

.ah-wt.active {
  background: rgba(160, 120, 220, 0.12);
  color: rgba(210, 190, 240, 0.95);
  box-shadow: 0 0 14px rgba(160, 120, 220, 0.1);
}

.ah-wt-icon { font-size: 18px; line-height: 1; }

.ah-wt-label {
  font-size: 7px;
  font-weight: 600;
  letter-spacing: 1px;
  text-transform: uppercase;
  opacity: 0.6;
}

.ah-wt.active .ah-wt-label { opacity: 0.9; }

/* ── Compass Direction Picker ── */

.ah-compass {
  position: relative;
  width: 80px;
  height: 80px;
  margin: 0 auto 10px;
}

.ah-compass-center {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(160, 120, 220, 0.15);
  transform: translate(-50%, -50%);
}

.ah-dir {
  position: absolute;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(180, 170, 200, 0.45);
  font-family: inherit;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.ah-dir.n { top: 0; left: 50%; transform: translateX(-50%); }
.ah-dir.s { bottom: 0; left: 50%; transform: translateX(-50%); }
.ah-dir.e { right: 0; top: 50%; transform: translateY(-50%); }
.ah-dir.w { left: 0; top: 50%; transform: translateY(-50%); }

.ah-dir:hover {
  background: rgba(160, 120, 220, 0.1);
  color: rgba(200, 180, 230, 0.8);
}

.ah-dir.active {
  background: rgba(160, 120, 220, 0.2);
  color: rgba(220, 200, 250, 0.95);
  box-shadow: 0 0 12px rgba(160, 120, 220, 0.15);
}

/* ── Confirm Button ── */

.ah-confirm {
  display: block;
  width: 100%;
  padding: 8px 0;
  border-radius: 10px;
  border: none;
  background: rgba(160, 120, 220, 0.1);
  color: rgba(200, 180, 240, 0.8);
  font-family: inherit;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.ah-confirm:hover {
  background: rgba(160, 120, 220, 0.18);
  color: rgba(220, 200, 250, 0.95);
  box-shadow: 0 0 18px rgba(160, 120, 220, 0.12);
  transform: translateY(-1px);
}

.ah-confirm:active { transform: scale(0.97); }

/* ── Locked ── */

.ah-locked {
  display: flex;
  align-items: center;
  gap: 5px;
  color: rgba(130, 200, 150, 0.35);
  font-size: 8px;
  font-weight: 600;
  letter-spacing: 0.5px;
}

/* ── Bonus ── */

.ah-bonus-row {
  display: flex;
  gap: 6px;
}

.ah-bonus {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 10px 4px;
  border-radius: 10px;
  border: none;
  background: rgba(255, 255, 255, 0.03);
  color: rgba(180, 170, 200, 0.45);
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s;
}

.ah-bonus:hover {
  background: rgba(200, 180, 100, 0.08);
  color: rgba(220, 200, 130, 0.8);
  transform: translateY(-1px);
}

.ah-bonus-icon { font-size: 16px; line-height: 1; }

.ah-bonus-label {
  font-size: 7px;
  font-weight: 600;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  opacity: 0.6;
}

.ah-hint {
  font-size: 8px;
  font-weight: 500;
  color: rgba(200, 180, 100, 0.3);
  margin-top: 4px;
  letter-spacing: 0.3px;
}

/* ── Mobile ── */

@media (max-width: 640px) {
  .ah { top: 12px; left: 12px; gap: 10px; }
  .ah-timer-num { font-size: 22px; }
  .ah-wt { padding: 8px 10px 5px; }
  .ah-wt-label { font-size: 9px; }
  .ah-dir { width: 44px; height: 44px; font-size: 12px; }
  .ah-confirm { min-height: 44px; font-size: 12px; }
  .ah-bonus { padding: 8px 10px 4px; }
  .ah-bonus-label { font-size: 9px; }
  .ah-hint { font-size: 9px; }
}
</style>
