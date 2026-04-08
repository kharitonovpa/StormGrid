<script setup lang="ts">
import { onMounted, onUnmounted, computed } from 'vue'
import type { PlayerId } from '@stormgrid/shared'
import { celebrate, disposeCelebrate } from '../lib/celebrate'

const props = defineProps<{
  winner: PlayerId | 'draw' | null
  myPlayerId: PlayerId | null
}>()

const emit = defineEmits<{
  playAgain: []
}>()

const isWin = computed(() => props.myPlayerId && props.winner === props.myPlayerId)
const isDraw = computed(() => props.winner === 'draw')
const isSpectator = computed(() => !props.myPlayerId)

const title = computed(() => {
  if (isDraw.value) return 'Stalemate'
  if (isSpectator.value) return `Player ${props.winner} Wins`
  if (isWin.value) return 'Victory!'
  return 'Defeated'
})

const subtitle = computed(() => {
  if (isDraw.value) return 'Both fell to the elements'
  if (isSpectator.value) return 'The match has concluded'
  if (isWin.value) return 'The storm bends to your will'
  return 'Every storm passes — try again?'
})

const resultClass = computed(() => {
  if (isDraw.value) return 'draw'
  if (isSpectator.value) return 'spectator'
  if (isWin.value) return 'win'
  return 'lose'
})

let fireworkInterval = 0

function launchFireworks() {
  const w = window.innerWidth
  const h = window.innerHeight
  const cx = w / 2
  const cy = h / 2

  for (let i = 0; i < 5; i++) {
    setTimeout(() => {
      const sx = cx + (Math.random() - 0.5) * w * 0.6
      const sy = cy + (Math.random() - 0.5) * h * 0.4
      const tx = sx + (Math.random() - 0.5) * 100
      const ty = sy - 40 - Math.random() * 60
      celebrate(sx, sy, tx, ty, 0)
    }, i * 200)
  }

  fireworkInterval = window.setInterval(() => {
    const sx = Math.random() * w
    const sy = h * 0.15 + Math.random() * h * 0.5
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
  if (fireworkInterval) {
    clearInterval(fireworkInterval)
    fireworkInterval = 0
  }
})
</script>

<template>
  <div class="gameover">
    <div class="gameover-card" :class="resultClass">
      <!-- Glow ring behind title for win -->
      <div v-if="isWin" class="win-glow" />

      <h1 class="result-title">{{ title }}</h1>
      <p class="result-sub">{{ subtitle }}</p>

      <button class="btn-again" :class="resultClass" @click="emit('playAgain')">
        <span>Play Again</span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 4v6h-6M1 20v-6h6" />
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
        </svg>
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
  align-items: center;
  justify-content: center;
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
  animation: fadeUp 0.5s 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
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
</style>
