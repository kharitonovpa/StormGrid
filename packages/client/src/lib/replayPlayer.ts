import { ref, computed } from 'vue'
import type { ReplayFrame, ReplayData, ReplaySummary } from '@wheee/shared'
import { API_BASE } from './config'

export async function fetchReplayList(): Promise<ReplaySummary[]> {
  const res = await fetch(`${API_BASE}/api/replays`)
  if (!res.ok) return []
  return res.json()
}

export async function fetchReplayData(id: string): Promise<ReplayData | null> {
  const res = await fetch(`${API_BASE}/api/replay/${id}`)
  if (!res.ok) return null
  return res.json()
}

export type ReplayPlayer = ReturnType<typeof createReplayPlayer>

const STEP_DELAY_MS = 1500
const WEATHER_DELAY_MS = 2500

export function createReplayPlayer(
  frames: ReplayFrame[],
  onFrame: (frame: ReplayFrame, index: number, animate: boolean) => void,
) {
  const currentFrame = ref(0)
  const playing = ref(false)
  const total = frames.length
  let timerId: ReturnType<typeof setTimeout> | null = null

  const finished = computed(() => currentFrame.value >= total - 1)

  function applyFrame(animate: boolean) {
    onFrame(frames[currentFrame.value], currentFrame.value, animate)
  }

  function scheduleAutoAdvance() {
    clearTimer()
    if (!playing.value) return
    const frame = frames[currentFrame.value]
    const delay = frame.weather ? WEATHER_DELAY_MS : STEP_DELAY_MS
    timerId = setTimeout(() => {
      timerId = null
      if (!playing.value) return
      if (currentFrame.value < total - 1) {
        currentFrame.value++
        applyFrame(true)
        scheduleAutoAdvance()
      } else {
        pause()
      }
    }, delay)
  }

  function next() {
    if (currentFrame.value < total - 1) {
      currentFrame.value++
      applyFrame(true)
      if (playing.value) scheduleAutoAdvance()
    } else {
      pause()
    }
  }

  function prev() {
    if (currentFrame.value > 0) {
      currentFrame.value--
      applyFrame(false)
      if (playing.value) scheduleAutoAdvance()
    }
  }

  function play() {
    if (playing.value) return
    if (finished.value) {
      currentFrame.value = 0
      applyFrame(false)
    }
    playing.value = true
    scheduleAutoAdvance()
  }

  function pause() {
    playing.value = false
    clearTimer()
  }

  function clearTimer() {
    if (timerId !== null) {
      clearTimeout(timerId)
      timerId = null
    }
  }

  function dispose() {
    pause()
  }

  applyFrame(false)

  return {
    currentFrame,
    playing,
    total,
    finished,
    next,
    prev,
    play,
    pause,
    dispose,
  }
}
