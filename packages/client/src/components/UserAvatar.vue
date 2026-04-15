<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  src: string | null
  name: string
  size?: number
}>()

const failed = ref(false)
const sz = computed(() => props.size ?? 20)

const initial = computed(() => {
  const n = props.name.trim()
  return n ? n[0].toUpperCase() : '?'
})

const bgColor = computed(() => {
  let h = 0
  for (const ch of props.name) h = ((h << 5) - h + ch.charCodeAt(0)) | 0
  const hue = ((h % 360) + 360) % 360
  return `hsl(${hue}, 45%, 35%)`
})

const showImg = computed(() =>
  !failed.value && !!props.src && props.src.startsWith('https://'),
)
</script>

<template>
  <img
    v-if="showImg"
    :src="src!"
    :width="sz"
    :height="sz"
    class="ua-img"
    alt=""
    referrerpolicy="no-referrer"
    @error="failed = true"
  />
  <span
    v-else
    class="ua-fallback"
    :style="{ width: sz + 'px', height: sz + 'px', fontSize: sz * 0.5 + 'px', background: bgColor }"
  >{{ initial }}</span>
</template>

<style scoped>
.ua-img {
  border-radius: 50%;
  flex-shrink: 0;
  object-fit: cover;
}

.ua-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.85);
  font-weight: 700;
  line-height: 1;
  user-select: none;
}
</style>
