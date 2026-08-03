import { ref, computed } from 'vue'
import { storageGet, storageSet } from './storage'

/**
 * The badge streak.
 *
 * A crate on the board seeds it, wins grow it, a loss wipes it — unless the
 * player spends their one rescue on it. The whole state machine lives here on
 * the client and is persisted through `lib/storage.ts`, which means it survives
 * on platforms where the player is anonymous and has no server account at all
 * (GameDistribution above all). It is cosmetic, so client-side is enough:
 * forging a badge fools nobody but its owner.
 *
 * The server never judges the streak. It only relays the number to the opponent
 * so both screens draw the same plate.
 */

const STORAGE_KEY = 'wheee:streak-v1'

/**
 * The server rejects a `queue:join` carrying a streak above this, so the counter
 * has to stop here too — otherwise a number nobody will ever reach would quietly
 * lock its owner out of matchmaking.
 */
const MAX_STREAK = 9999

type Saved = {
  streak: number
  /** One rescue per streak. Spent, the next loss wipes it for good. */
  rescueUsed: boolean
}

const DEFAULTS: Saved = { streak: 0, rescueUsed: false }

function load(): Saved {
  try {
    const raw = storageGet(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw)
    const raw2 = Number.isInteger(parsed.streak) && parsed.streak > 0 ? parsed.streak : 0
    const streak = Math.min(raw2, MAX_STREAK)
    return {
      streak,
      // A wiped streak carries no spent rescue into the next one.
      rescueUsed: streak > 0 && parsed.rescueUsed === true,
    }
  } catch { return { ...DEFAULTS } }
}

const state = ref<Saved>(load())

function persist() {
  storageSet(STORAGE_KEY, JSON.stringify(state.value))
}

export const streak = computed(() => state.value.streak)
/** A rescue is on offer only while there is something left to rescue. */
export const canRescue = computed(() => state.value.streak > 0 && !state.value.rescueUsed)

/** Picked the crate up: the badge starts here. */
export function seedStreak(): void {
  if (state.value.streak > 0) return
  state.value = { streak: 1, rescueUsed: false }
  persist()
}

export function winStreak(): void {
  if (state.value.streak === 0) return
  state.value = { ...state.value, streak: Math.min(state.value.streak + 1, MAX_STREAK) }
  persist()
}

export function breakStreak(): void {
  state.value = { ...DEFAULTS }
  persist()
}

/**
 * Watched the ad: put the number back, and that was the one rescue.
 *
 * A loss is committed the moment it happens — otherwise closing the tab on the
 * result screen would be a free save. So the rescue restores rather than
 * prevents, and the caller keeps the pre-loss value to hand back.
 */
export function restoreStreak(value: number): void {
  if (value <= 0) return
  state.value = { streak: value, rescueUsed: true }
  persist()
}
