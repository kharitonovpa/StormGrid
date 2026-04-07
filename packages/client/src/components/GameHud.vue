<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { TICK_DURATION_MS } from '@stormgrid/shared'

const TICK_SECONDS = TICK_DURATION_MS / 1000

const props = defineProps<{
  phase: string
  round: number
  tick: number
  tickDeadline: number
  actionSubmitted: boolean
  myPlayerId: string
}>()

const now = ref(Date.now())
let timer: ReturnType<typeof setInterval>

onMounted(() => {
  timer = setInterval(() => { now.value = Date.now() }, 100)
})
onUnmounted(() => clearInterval(timer))

const remaining = computed(() => {
  if (props.phase !== 'ticking' || !props.tickDeadline) return 0
  return Math.max(0, Math.ceil((props.tickDeadline - now.value) / 1000))
})

const phaseLabel = computed(() => {
  switch (props.phase) {
    case 'forecast': return 'Weather Forecast'
    case 'ticking': return `Tick ${props.tick + 1} / 5`
    case 'weather': return 'Cataclysm!'
    default: return ''
  }
})
</script>

<template>
  <div class="hud">
    <div class="hud-top">
      <div class="hud-badge">Player {{ myPlayerId }}</div>
      <div class="hud-round">Round {{ round }}</div>
      <div class="hud-phase">{{ phaseLabel }}</div>
    </div>

    <div v-if="phase === 'ticking'" class="hud-timer">
      <div class="timer-bar-bg">
        <div
          class="timer-bar"
          :style="{ width: (remaining / TICK_SECONDS * 100) + '%' }"
          :class="{ urgent: remaining <= 2 }"
        />
      </div>
      <span class="timer-num">{{ remaining }}s</span>
      <span v-if="actionSubmitted" class="submitted-badge">Action sent</span>
    </div>

    <div v-if="phase === 'forecast'" class="hud-forecast">
      Studying the skies...
    </div>

    <div v-if="phase === 'weather'" class="hud-weather">
      Brace yourself!
    </div>
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
  padding: 16px 20px;
}

.hud-top {
  display: flex;
  align-items: center;
  gap: 12px;
}

.hud-badge {
  background: #e94560;
  color: white;
  padding: 4px 12px;
  border-radius: 6px;
  font-family: monospace;
  font-size: 13px;
  font-weight: 700;
}

.hud-round {
  background: rgba(22, 26, 36, 0.8);
  color: rgba(200, 205, 215, 0.8);
  padding: 4px 12px;
  border-radius: 6px;
  font-family: monospace;
  font-size: 13px;
  border: 1px solid rgba(100, 110, 130, 0.2);
}

.hud-phase {
  color: rgba(200, 205, 215, 0.6);
  font-family: monospace;
  font-size: 13px;
}

.hud-timer {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.timer-bar-bg {
  width: 200px;
  height: 6px;
  background: rgba(40, 44, 54, 0.8);
  border-radius: 3px;
  overflow: hidden;
}

.timer-bar {
  height: 100%;
  background: #50fa7b;
  border-radius: 3px;
  transition: width 0.15s linear;
}

.timer-bar.urgent {
  background: #e94560;
}

.timer-num {
  color: rgba(200, 205, 215, 0.8);
  font-family: monospace;
  font-size: 14px;
  min-width: 24px;
}

.submitted-badge {
  background: rgba(80, 250, 123, 0.15);
  color: #50fa7b;
  padding: 2px 10px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
}

.hud-forecast, .hud-weather {
  margin-top: 8px;
  color: rgba(200, 205, 215, 0.5);
  font-family: monospace;
  font-size: 13px;
  font-style: italic;
}

.hud-weather {
  color: #e94560;
}
</style>
