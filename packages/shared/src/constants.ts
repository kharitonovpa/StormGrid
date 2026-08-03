import type { WindDir, MoveDir, WeatherType, CharacterType } from './types.js'

export const GAME_TITLE = 'wheee'

export const BOARD_SIZE = 7

export const TICKS_PER_ROUND = 5

export const TICK_DURATION_MS = 6_000

export const HEIGHTS = [-1, 0, 1] as const

export const WIND_DIRS: readonly WindDir[] = ['N', 'S', 'E', 'W']

export const WEATHER_TYPES: readonly WeatherType[] = ['wind', 'rain', 'wind_rain']

export const CHARACTERS: readonly CharacterType[] = ['wheat', 'rice', 'corn']

export const DIRECTIONS: Record<WindDir, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  S: { dx: 0, dy: 1 },
  E: { dx: 1, dy: 0 },
  W: { dx: -1, dy: 0 },
}

export const SPAWN_PAIRS: { A: { x: number; y: number }; B: { x: number; y: number } }[] = [
  { A: { x: 3, y: 5 }, B: { x: 3, y: 1 } },
  { A: { x: 1, y: 3 }, B: { x: 5, y: 3 } },
  { A: { x: 2, y: 4 }, B: { x: 4, y: 2 } },
  { A: { x: 4, y: 4 }, B: { x: 2, y: 2 } },
]

export const RECONNECT_GRACE_MS = 30_000

export const MOVE_DIRS: Record<MoveDir, { dx: number; dy: number }> = {
  N:  { dx: 0,  dy: -1 },
  S:  { dx: 0,  dy: 1 },
  E:  { dx: 1,  dy: 0 },
  W:  { dx: -1, dy: 0 },
  NE: { dx: 1,  dy: -1 },
  NW: { dx: -1, dy: -1 },
  SE: { dx: 1,  dy: 1 },
  SW: { dx: -1, dy: 1 },
}

/* ── Streak badge ── */

/**
 * The badge climbs the weather it is made of: a leaf that anything can move,
 * up to the storm everyone runs from. `from` is the streak at which the rung
 * starts; the exact count is shown next to the emoji.
 */
export const BADGE_TIERS: { from: number; emoji: string }[] = [
  { from: 1,  emoji: '🍃' },
  { from: 3,  emoji: '💨' },
  { from: 6,  emoji: '🌧' },
  { from: 10, emoji: '⛈' },
  { from: 20, emoji: '🌪' },
  { from: 50, emoji: '🌀' },
]

/** From this rung on the badge takes the flag's place, so the plate stays compact. */
export const BADGE_REPLACES_FLAG_FROM = 6

/** The rung a streak sits on, or null when there is no badge yet. */
export function badgeFor(streak: number): string | null {
  let emoji: string | null = null
  for (const tier of BADGE_TIERS) {
    if (streak >= tier.from) emoji = tier.emoji
  }
  return emoji
}
