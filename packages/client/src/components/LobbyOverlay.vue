<script setup lang="ts">
import { ref } from 'vue'
import type { CharacterType } from '@stormgrid/shared'
import { GAME_TITLE } from '@stormgrid/shared'
import CharacterPreview from './CharacterPreview.vue'

defineProps<{
  phase: string
  onlineCount: number
}>()

const emit = defineEmits<{
  play: [character: CharacterType]
  watch: []
  architect: []
}>()

const characters: { id: CharacterType; name: string; color: string; glow: string }[] = [
  { id: 'wheat', name: 'Wheat', color: '#e8c547', glow: 'rgba(232, 197, 71, 0.35)' },
  { id: 'rice', name: 'Rice', color: '#7bc47f', glow: 'rgba(123, 196, 127, 0.35)' },
  { id: 'corn', name: 'Corn', color: '#e8874a', glow: 'rgba(232, 135, 74, 0.35)' },
]

const selected = ref<CharacterType>('wheat')
</script>

<template>
  <div class="lobby">
    <!-- Title -->
    <div class="lobby-title-area">
      <h1 class="lobby-title">{{ GAME_TITLE }}</h1>
      <p class="lobby-tagline">Reshape the land. Command the storm.</p>
    </div>

    <!-- Bottom glass panel -->
    <div class="lobby-panel">
      <div class="panel-fade" />
      <div class="panel-content">
        <!-- Crop selector -->
        <div class="panel-section crops-section">
          <div class="char-select">
            <button
              v-for="ch in characters"
              :key="ch.id"
              class="char-btn"
              :class="{ active: selected === ch.id }"
              :style="{ '--accent': ch.color, '--glow': ch.glow }"
              @click="selected = ch.id"
            >
              <div class="char-preview-wrap">
                <CharacterPreview :character="ch.id" :active="selected === ch.id" />
              </div>
              <span class="char-name">{{ ch.name }}</span>
            </button>
          </div>
        </div>

        <!-- Divider -->
        <div class="panel-divider" />

        <!-- Actions -->
        <div class="panel-section actions-section">
          <template v-if="phase === 'queue' || phase === 'watch_queue' || phase === 'architect_queue'">
            <div class="queue-status">
              <div class="queue-spinner" />
              <span v-if="phase === 'queue'">Searching for opponent<span class="dots" /></span>
              <span v-else-if="phase === 'watch_queue'">Finding a match<span class="dots" /></span>
              <span v-else>Finding a match<span class="dots" /></span>
            </div>
          </template>
          <template v-else>
            <div class="actions-primary">
              <button class="btn-play" @click="emit('play', selected)">
                <span class="btn-play-text">Play</span>
                <svg class="btn-play-arrow" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
              <button class="btn-signin" disabled title="Coming soon">
                Sign In
              </button>
            </div>
            <div class="actions-secondary">
              <button class="btn-role" @click="emit('watch')">
                <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor"><path d="M10 3C5 3 1.7 7.1 1 10c.7 2.9 4 7 9 7s8.3-4.1 9-7c-.7-2.9-4-7-9-7zm0 11.5a4.5 4.5 0 110-9 4.5 4.5 0 010 9zm0-7a2.5 2.5 0 100 5 2.5 2.5 0 000-5z"/></svg>
                Watch
              </button>
              <button class="btn-role btn-architect" @click="emit('architect')">
                <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor"><path d="M17.4 2.6a2 2 0 00-2.8 0L3 14.2V17h2.8L17.4 5.4a2 2 0 000-2.8zM5.1 15.5H4.5V15l9.3-9.3.6.6-9.3 9.2z"/></svg>
                Architect
              </button>
            </div>
          </template>
        </div>

        <!-- Online counter -->
        <div class="panel-divider" v-if="onlineCount > 0" />
        <div class="online-badge" v-if="onlineCount > 0">
          <div class="online-dot" />
          <span>{{ onlineCount }} online</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lobby {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  pointer-events: none;
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
}

/* ── Title ── */

.lobby-title-area {
  padding: 40px 48px;
  animation: titleIn 1s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.lobby-title {
  font-size: 42px;
  font-weight: 800;
  letter-spacing: 3px;
  color: rgba(255, 255, 255, 0.92);
  text-shadow:
    0 0 40px rgba(233, 69, 96, 0.4),
    0 0 80px rgba(233, 69, 96, 0.15);
  margin: 0;
  line-height: 1;
}

.lobby-tagline {
  margin-top: 10px;
  font-size: 13px;
  font-weight: 400;
  letter-spacing: 1.5px;
  color: rgba(200, 210, 225, 0.45);
  text-transform: uppercase;
}

/* ── Bottom panel ── */

.lobby-panel {
  position: relative;
  pointer-events: auto;
  animation: panelIn 0.8s 0.2s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.panel-fade {
  position: absolute;
  top: -60px;
  left: 0;
  right: 0;
  height: 60px;
  background: linear-gradient(to bottom, transparent, rgba(10, 14, 20, 0.5));
  pointer-events: none;
}

.panel-content {
  display: flex;
  align-items: center;
  gap: 32px;
  padding: 28px 48px 36px;
  background: rgba(12, 16, 24, 0.55);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.panel-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel-divider {
  width: 1px;
  align-self: stretch;
  background: rgba(255, 255, 255, 0.06);
  margin: 4px 8px;
}

.section-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1.8px;
  text-transform: uppercase;
  color: rgba(200, 210, 225, 0.35);
}

/* ── Character select ── */

.char-select {
  display: flex;
  gap: 10px;
}

.char-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 10px 10px;
  border-radius: 16px;
  border: 1.5px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(200, 210, 225, 0.5);
  cursor: pointer;
  transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  font-family: inherit;
  font-size: 11px;
  letter-spacing: 0.5px;
}

.char-btn:hover {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(220, 225, 235, 0.75);
  transform: translateY(-2px);
}

.char-btn.active {
  border-color: var(--accent);
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  box-shadow: 0 0 28px var(--glow), inset 0 0 20px rgba(255, 255, 255, 0.02);
  transform: translateY(-4px);
}

.char-preview-wrap {
  width: 120px;
  height: 120px;
  position: relative;
  overflow: hidden;
  border-radius: 12px;
}

.char-btn.active .char-preview-wrap {
  filter: drop-shadow(0 0 8px var(--glow));
}

.char-name {
  font-weight: 600;
}

/* ── Actions ── */

.actions-section {
  flex: 1;
  min-width: 240px;
}

.actions-primary {
  display: flex;
  gap: 12px;
  align-items: center;
}

.btn-play {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 28px;
  border-radius: 10px;
  border: none;
  background: linear-gradient(135deg, #e94560, #c73750);
  color: white;
  font-family: inherit;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.8px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 4px 20px rgba(233, 69, 96, 0.25);
}

.btn-play:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 28px rgba(233, 69, 96, 0.4);
  background: linear-gradient(135deg, #ed5a73, #d14460);
}

.btn-play:active {
  transform: translateY(0);
}

.btn-play-arrow {
  transition: transform 0.2s;
}

.btn-play:hover .btn-play-arrow {
  transform: translateX(3px);
}

.btn-signin {
  padding: 12px 24px;
  border-radius: 10px;
  border: 1.5px solid rgba(255, 255, 255, 0.1);
  background: transparent;
  color: rgba(200, 210, 225, 0.4);
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.5px;
  cursor: not-allowed;
  transition: all 0.2s;
}

.actions-secondary {
  display: flex;
  gap: 16px;
  margin-top: 12px;
}

.btn-role {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: none;
  background: none;
  color: rgba(140, 180, 220, 0.6);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.5px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-role:hover {
  color: rgba(160, 200, 240, 0.9);
}

.btn-architect {
  color: rgba(180, 150, 230, 0.6);
}

.btn-architect:hover {
  color: rgba(200, 175, 245, 0.9);
}

/* ── Online badge ── */

.online-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  color: rgba(200, 210, 225, 0.45);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.5px;
  white-space: nowrap;
}

.online-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4ade80;
  box-shadow: 0 0 8px rgba(74, 222, 128, 0.5);
  animation: pulse-dot 2s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* ── Queue ── */

.queue-status {
  display: flex;
  align-items: center;
  gap: 12px;
  color: rgba(200, 210, 225, 0.55);
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.3px;
}

.queue-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(233, 69, 96, 0.2);
  border-top-color: #e94560;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.dots {
  display: inline-block;
  width: 1.5em;
  text-align: left;
  overflow: hidden;
}

.dots::after {
  content: '...';
  display: inline-block;
  animation: dots-clip 1.5s steps(4, end) infinite;
}

/* ── Animations ── */

@keyframes titleIn {
  0% { opacity: 0; transform: translateY(-20px); }
  100% { opacity: 1; transform: translateY(0); }
}

@keyframes panelIn {
  0% { opacity: 0; transform: translateY(40px); }
  100% { opacity: 1; transform: translateY(0); }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes dots-clip {
  0% { width: 0; }
  25% { width: 0.5em; }
  50% { width: 1em; }
  75% { width: 1.5em; }
}
</style>
