import { ref } from 'vue'
import type { PointsAward } from '@wheee/shared'
import { storageGet, storageSet } from './storage'

/**
 * Match points on the client: a mirror of the server's number for display.
 * The total is persisted so the lobby can show it before the socket connects;
 * whatever the server says (`points:total`, `game:end.points`) wins over it.
 */
const STORAGE_KEY = 'wheee:points-v1'

function load(): number {
  const raw = storageGet(STORAGE_KEY)
  const n = raw === null ? 0 : Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : 0
}

export function createPoints() {
  const total = ref(load())
  /** What the last match paid, until the next match starts. */
  const lastEarned = ref<number | null>(null)

  function setTotal(n: number) {
    total.value = n
    storageSet(STORAGE_KEY, String(n))
  }
  function award(a: PointsAward) {
    lastEarned.value = a.earned
    setTotal(a.total)
  }
  function clearAward() { lastEarned.value = null }

  return { total, lastEarned, setTotal, award, clearAward }
}

export const points = createPoints()
