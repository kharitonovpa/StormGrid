<script setup lang="ts">
import { computed, inject } from 'vue'
import type { ReplayPlayer } from '../lib/replayPlayer'
import type { AudioSystem } from '../lib/audio'
import { t } from '../lib/i18n'

const props = defineProps<{ player: ReplayPlayer }>()
const emit = defineEmits<{ exit: [] }>()
const audio = inject<AudioSystem>('audio')

const frameLabel = computed(() => `${props.player.currentFrame.value + 1} / ${props.player.total}`)

function togglePlay() {
  audio?.play('ui-click')
  if (props.player.playing.value) {
    props.player.pause()
  } else {
    props.player.play()
  }
}

function onPrev() {
  audio?.play('ui-click')
  props.player.prev()
}

function onNext() {
  audio?.play('ui-click')
  props.player.next()
}

function onExit() {
  audio?.play('ui-click')
  emit('exit')
}
</script>

<template>
  <div class="replay-bar">
    <button class="ctrl-btn" :title="t('replay.prev')" @click="onPrev">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
    </button>

    <button class="ctrl-btn play-btn" :title="player.playing.value ? t('replay.pause') : t('replay.play')" @click="togglePlay">
      <svg v-if="!player.playing.value" viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      <svg v-else viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 19h4V5H6zm8-14v14h4V5z"/></svg>
    </button>

    <button class="ctrl-btn" :title="t('replay.next')" @click="onNext">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 18l8.5-6L6 6zm10-12v12h2V6z"/></svg>
    </button>

    <span class="frame-label">{{ frameLabel }}</span>

    <button class="ctrl-btn exit-btn" :title="t('replay.exit')" @click="onExit">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>
</template>

<style scoped>
.replay-bar {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: rgba(10, 12, 20, 0.7);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  z-index: 100;
  user-select: none;
}

.ctrl-btn {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  padding: 6px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.ctrl-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}
.play-btn {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 50%;
  width: 38px;
  height: 38px;
}

.frame-label {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
  white-space: nowrap;
  min-width: 48px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.exit-btn {
  margin-left: 4px;
  color: rgba(255, 100, 100, 0.7);
}
.exit-btn:hover {
  color: #ff6464;
  background: rgba(255, 100, 100, 0.12);
}
</style>
