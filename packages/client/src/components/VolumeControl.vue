<script setup lang="ts">
import { ref, inject, onMounted, onUnmounted } from 'vue'
import type { AudioSystem } from '../lib/audio'
import { t } from '../lib/i18n'

const audio = inject<AudioSystem>('audio')
const open = ref(false)

const settings = audio?.getSettings()
const musicVol = ref(Math.round((settings?.music ?? 0.4) * 100))
const sfxVol = ref(Math.round((settings?.sfx ?? 0.7) * 100))
const muted = ref(audio?.isMuted() ?? false)

function toggleOpen() { open.value = !open.value }

function toggleMute() {
  audio?.toggleMute()
  muted.value = audio?.isMuted() ?? false
}

function onMusicInput(e: Event) {
  const v = +(e.target as HTMLInputElement).value
  musicVol.value = v
  audio?.setMusicVolume(v / 100)
}

function onSfxInput(e: Event) {
  const v = +(e.target as HTMLInputElement).value
  sfxVol.value = v
  audio?.setSfxVolume(v / 100)
}

function onClickOutside(e: PointerEvent) {
  const el = (e.target as HTMLElement)
  if (!el.closest('.vol-root')) open.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', onClickOutside, true)
})
onUnmounted(() => {
  document.removeEventListener('pointerdown', onClickOutside, true)
})
</script>

<template>
  <div class="vol-root">
    <button class="vol-btn" :class="{ muted }" @click="toggleOpen">
      <svg v-if="muted" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="11,5 6,9 2,9 2,15 6,15 11,19" />
        <line x1="23" y1="9" x2="17" y2="15" />
        <line x1="17" y1="9" x2="23" y2="15" />
      </svg>
      <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="11,5 6,9 2,9 2,15 6,15 11,19" />
        <path d="M15.54 8.46a5 5 0 010 7.07" />
        <path d="M19.07 4.93a10 10 0 010 14.14" />
      </svg>
    </button>

    <Transition name="vol-pop">
      <div v-if="open" class="vol-panel">
        <button class="vol-mute-row" @click="toggleMute">
          <span class="vol-mute-icon">{{ muted ? '🔇' : '🔊' }}</span>
          <span class="vol-mute-label">{{ muted ? t('volume.unmute') : t('volume.mute') }}</span>
        </button>

        <div class="vol-group">
          <label class="vol-label">{{ t('volume.music') }}</label>
          <input
            type="range" min="0" max="100" :value="musicVol"
            class="vol-range" @input="onMusicInput"
          />
        </div>

        <div class="vol-group">
          <label class="vol-label">{{ t('volume.sfx') }}</label>
          <input
            type="range" min="0" max="100" :value="sfxVol"
            class="vol-range" @input="onSfxInput"
          />
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.vol-root {
  position: fixed;
  bottom: 18px;
  right: 18px;
  z-index: 300;
  font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
}

.vol-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(12, 16, 24, 0.5);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  color: rgba(200, 210, 225, 0.5);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: auto;
}

.vol-btn:hover {
  background: rgba(20, 24, 36, 0.7);
  border-color: rgba(255, 255, 255, 0.12);
  color: rgba(220, 225, 235, 0.8);
  transform: scale(1.08);
}

.vol-btn.muted {
  color: rgba(233, 69, 96, 0.6);
}

.vol-panel {
  position: absolute;
  bottom: 52px;
  right: 0;
  width: 180px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(12, 16, 24, 0.75);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  gap: 14px;
  pointer-events: auto;
}

.vol-mute-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  color: rgba(200, 210, 225, 0.6);
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.3px;
  cursor: pointer;
  transition: all 0.2s;
}

.vol-mute-row:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(220, 225, 235, 0.8);
}

.vol-mute-icon { font-size: 14px; }
.vol-mute-label { flex: 1; }

.vol-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.vol-label {
  font-size: 9px;
  font-weight: 600;
  color: rgba(200, 210, 225, 0.3);
  letter-spacing: 0.8px;
  text-transform: uppercase;
}

.vol-range {
  width: 100%;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.vol-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: rgba(200, 210, 225, 0.7);
  border: none;
  box-shadow: 0 0 8px rgba(0, 0, 0, 0.3);
  cursor: pointer;
  transition: transform 0.15s;
}

.vol-range::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

.vol-pop-enter-active {
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.vol-pop-leave-active {
  transition: all 0.15s ease;
}
.vol-pop-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(0.95);
}
.vol-pop-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

@media (max-width: 640px) {
  .vol-root { bottom: 12px; right: 12px; }
  .vol-btn { width: 44px; height: 44px; }
}
</style>
