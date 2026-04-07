<script setup lang="ts">
import { ref } from 'vue'
import type { CharacterType } from '@stormgrid/shared'

const props = defineProps<{
  phase: string
  connected: boolean
}>()

const emit = defineEmits<{
  connect: []
  play: [character: CharacterType]
  watch: []
  architect: []
}>()

const characters: { id: CharacterType; name: string; color: string }[] = [
  { id: 'wheat', name: 'Wheat', color: '#e8c547' },
  { id: 'rice', name: 'Rice', color: '#7bc47f' },
  { id: 'corn', name: 'Corn', color: '#e8874a' },
]

const selected = ref<CharacterType>('wheat')
</script>

<template>
  <div class="lobby-overlay">
    <div class="lobby-card">
      <h1 class="lobby-title">StormGrid</h1>
      <p class="lobby-sub">Choose your crop</p>

      <div class="char-select">
        <button
          v-for="ch in characters"
          :key="ch.id"
          class="char-btn"
          :class="{ active: selected === ch.id }"
          :style="{ '--accent': ch.color }"
          @click="selected = ch.id"
        >
          <div class="char-icon" :style="{ background: ch.color }" />
          <span>{{ ch.name }}</span>
        </button>
      </div>

      <button
        v-if="!connected"
        class="play-btn"
        @click="emit('connect')"
      >
        Connect
      </button>
      <template v-else-if="phase === 'lobby'">
        <div class="action-row">
          <button class="play-btn" @click="emit('play', selected)">Play</button>
          <button class="watch-btn" @click="emit('watch')">Watch</button>
          <button class="architect-btn" @click="emit('architect')">Architect</button>
        </div>
      </template>
      <div v-else-if="phase === 'queue'" class="queue-msg">
        Searching for opponent<span class="dots" />
      </div>
      <div v-else-if="phase === 'watch_queue'" class="queue-msg">
        Finding a match to watch<span class="dots" />
      </div>
      <div v-else-if="phase === 'architect_queue'" class="queue-msg">
        Finding a match to control<span class="dots" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.lobby-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 14, 20, 0.85);
  backdrop-filter: blur(8px);
}

.lobby-card {
  text-align: center;
  padding: 40px 48px;
  border-radius: 16px;
  background: rgba(22, 26, 36, 0.9);
  border: 1px solid rgba(100, 110, 130, 0.2);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.lobby-title {
  font-family: monospace;
  font-size: 36px;
  color: #e94560;
  margin-bottom: 4px;
  letter-spacing: 2px;
}

.lobby-sub {
  color: rgba(200, 205, 215, 0.6);
  font-size: 14px;
  margin-bottom: 28px;
}

.char-select {
  display: flex;
  gap: 12px;
  margin-bottom: 28px;
}

.char-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px 20px;
  border-radius: 12px;
  border: 2px solid rgba(100, 110, 130, 0.25);
  background: rgba(30, 34, 44, 0.8);
  color: rgba(200, 205, 215, 0.8);
  cursor: pointer;
  transition: all 0.2s;
  font-family: monospace;
  font-size: 13px;
}

.char-btn:hover {
  border-color: rgba(150, 160, 180, 0.4);
  background: rgba(35, 40, 52, 0.9);
}

.char-btn.active {
  border-color: var(--accent);
  box-shadow: 0 0 16px rgba(0, 0, 0, 0.3), inset 0 0 12px rgba(255, 255, 255, 0.03);
  color: #fff;
}

.char-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  opacity: 0.7;
}

.char-btn.active .char-icon {
  opacity: 1;
  box-shadow: 0 0 12px var(--accent);
}

.play-btn {
  padding: 12px 48px;
  border-radius: 8px;
  border: none;
  background: #e94560;
  color: white;
  font-family: monospace;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  letter-spacing: 1px;
  transition: all 0.2s;
}

.play-btn:hover {
  background: #d13a52;
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(233, 69, 96, 0.3);
}

.action-row {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.watch-btn {
  padding: 12px 32px;
  border-radius: 8px;
  border: 2px solid rgba(100, 160, 220, 0.4);
  background: transparent;
  color: rgba(140, 180, 220, 0.9);
  font-family: monospace;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  letter-spacing: 1px;
  transition: all 0.2s;
}

.watch-btn:hover {
  border-color: rgba(120, 180, 240, 0.6);
  background: rgba(60, 100, 150, 0.15);
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(80, 140, 220, 0.2);
}

.architect-btn {
  padding: 12px 24px;
  border-radius: 8px;
  border: 2px solid rgba(160, 120, 220, 0.4);
  background: transparent;
  color: rgba(180, 150, 230, 0.9);
  font-family: monospace;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  letter-spacing: 1px;
  transition: all 0.2s;
}

.architect-btn:hover {
  border-color: rgba(180, 140, 240, 0.6);
  background: rgba(100, 60, 160, 0.15);
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(140, 100, 220, 0.2);
}

.queue-msg {
  color: rgba(200, 205, 215, 0.7);
  font-family: monospace;
  font-size: 14px;
}

.dots::after {
  content: '';
  animation: dots 1.5s infinite;
}

@keyframes dots {
  0% { content: ''; }
  25% { content: '.'; }
  50% { content: '..'; }
  75% { content: '...'; }
}
</style>
