<script setup lang="ts">
import { computed } from 'vue'
import { t } from '../lib/i18n'

const props = defineProps<{
  phase: 'forecast' | 'ticking' | 'weather'
  tick: number
  round: number
  actionSubmitted: boolean
}>()

const hintKey = computed<string | null>(() => {
  // The engine bumps `round` right after a survived cataclysm, so during the
  // first storm the client may already see round 2 — hence `round <= 2` here.
  if (props.phase === 'weather') return props.round <= 2 ? 'tutorial.weather' : null

  if (props.round === 1) {
    if (props.phase === 'forecast') return 'tutorial.forecast'
    if (props.tick === 0) return props.actionSubmitted ? 'tutorial.submitted' : 'tutorial.raise'
    if (props.tick === 1) return props.actionSubmitted ? 'tutorial.submitted' : 'tutorial.move'
    if (props.tick === 2) return 'tutorial.flip'
    if (props.tick === 3) return 'tutorial.shelter'
    return 'tutorial.lastTick'
  }
  if (props.round === 2 && props.phase === 'forecast') return 'tutorial.round2'
  return null
})

const hintHtml = computed(() =>
  hintKey.value
    ? t(hintKey.value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    : '',
)
</script>

<template>
  <div class="tut-root">
    <Transition name="tut-hint" mode="out-in">
      <div v-if="hintKey" class="tut-card" :key="hintKey">
        <div class="tut-badge">{{ t('tutorial.badge') }}</div>
        <!-- eslint-disable-next-line vue/no-v-html — content comes from our own i18n table -->
        <div class="tut-text" v-html="hintHtml" />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.tut-root {
  position: fixed;
  bottom: 76px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 60;
  pointer-events: none;
  display: flex;
  justify-content: center;
  width: min(560px, calc(100vw - 32px));
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
}

.tut-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 18px;
  border-radius: 14px;
  background: rgba(12, 16, 24, 0.72);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(232, 197, 71, 0.22);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35), 0 0 24px rgba(232, 197, 71, 0.06);
}

.tut-badge {
  align-self: flex-start;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1.6px;
  text-transform: uppercase;
  color: rgba(232, 197, 71, 0.85);
  padding: 2px 8px;
  border-radius: 5px;
  background: rgba(232, 197, 71, 0.1);
  border: 1px solid rgba(232, 197, 71, 0.18);
}

.tut-text {
  font-size: 13px;
  line-height: 1.55;
  color: rgba(225, 230, 240, 0.9);
  letter-spacing: 0.2px;
}

.tut-text :deep(strong) {
  color: #e8c547;
  font-weight: 700;
}

.tut-hint-enter-active {
  transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}
.tut-hint-leave-active {
  transition: all 0.2s ease;
}
.tut-hint-enter-from {
  opacity: 0;
  transform: translateY(10px) scale(0.97);
}
.tut-hint-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

@media (max-width: 640px) {
  .tut-root {
    bottom: 68px;
    width: calc(100vw - 20px);
  }
  .tut-card { padding: 10px 14px; }
  .tut-text { font-size: 12px; }
}
</style>
