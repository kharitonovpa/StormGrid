import type { WindDir, MoveDir, WeatherType, CharacterType } from './types.js'

export const GAME_TITLE = 'wheee'

export const BOARD_SIZE = 7

export const TICKS_PER_ROUND = 5

export const TICK_DURATION_MS = 6_000

export const HEIGHTS = [-1, 0, 1] as const

export const WIND_DIRS: readonly WindDir[] = ['N', 'S', 'E', 'W']

export const WEATHER_TYPES: readonly WeatherType[] = [
  'wind', 'rain', 'wind_rain',
  'lightning', 'wind_lightning', 'rain_lightning', 'wind_rain_lightning',
]

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

/* ── Lightning ── */

/** A standing character pokes half a cell above the ground — the crown the bolt aims at. */
export const CROWN_HEIGHT = 0.5

export function hasWind(t: WeatherType): boolean {
  return t === 'wind' || t === 'wind_rain' || t === 'wind_lightning' || t === 'wind_rain_lightning'
}

export function hasRain(t: WeatherType): boolean {
  return t === 'rain' || t === 'wind_rain' || t === 'rain_lightning' || t === 'wind_rain_lightning'
}

export function hasLightning(t: WeatherType): boolean {
  return t === 'lightning' || t === 'wind_lightning' || t === 'rain_lightning' || t === 'wind_rain_lightning'
}

/**
 * Round-gated weather mix. Lightning never falls in rounds 1–2 (newcomers meet
 * only today's weather); late rounds escalate so matches must end. Playtest draft —
 * tune weights here, nowhere else.
 */
export const WEATHER_SCHEDULE: { upToRound: number; weights: [WeatherType, number][] }[] = [
  { upToRound: 2, weights: [['wind', 55], ['wind_rain', 45]] },
  { upToRound: 4, weights: [['wind', 40], ['wind_rain', 35], ['wind_lightning', 15], ['lightning', 10]] },
  { upToRound: 6, weights: [['wind', 25], ['wind_rain', 25], ['wind_lightning', 25], ['wind_rain_lightning', 15], ['lightning', 10]] },
  { upToRound: Infinity, weights: [['wind_rain_lightning', 40], ['wind_lightning', 30], ['wind_rain', 20], ['lightning', 10]] },
]
