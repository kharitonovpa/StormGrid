<script setup lang="ts">
import { t } from '../lib/i18n'

defineProps<{
  /** What failed, in the player's language. Never a raw error string. */
  message: string
  /** A retry is in flight — the button is dead until it settles. */
  busy?: boolean
}>()

const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="rn">
    <span class="rn-msg">{{ message }}</span>
    <button class="rn-btn" :disabled="busy" @click="emit('retry')">
      {{ busy ? '···' : t('app.retry') }}
    </button>
  </div>
</template>

<style scoped>
/* `.lobby` turns pointer events off for its whole subtree, so this has to
   claim them back or the retry button cannot be clicked from the lobby. */
.rn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(230, 160, 80, 0.25);
  background: rgba(230, 160, 80, 0.08);
  text-align: center;
  pointer-events: auto;
}

.rn-msg {
  font-size: 10px;
  line-height: 1.4;
  letter-spacing: 0.3px;
  color: rgba(230, 180, 100, 0.9);
}

.rn-btn {
  font-family: inherit;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.6px;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid rgba(232, 197, 71, 0.45);
  background: rgba(232, 197, 71, 0.14);
  color: #e8c547;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.rn-btn:hover:not(:disabled) {
  background: rgba(232, 197, 71, 0.22);
  border-color: rgba(232, 197, 71, 0.7);
}

.rn-btn:disabled {
  cursor: default;
  opacity: 0.5;
}
</style>
