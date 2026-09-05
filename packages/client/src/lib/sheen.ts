import type { WindDir } from '@wheee/shared'
import { HALF } from './constants'
import { LOOK } from './look'
import { DIR_AZIMUTH, gustDirection } from './bearing'

/**
 * The grass reads the sky. Gusts run across the board only from bearings the
 * sky currently shows a mass on (storm.ts masses()), one bearing per gust,
 * never a blend; more often and stronger as the storm builds; one wide wave
 * with the cataclysm's front. Nothing at rest, nothing under reduced motion.
 *
 * This half is pure and unit-tested; createSheenSystem below owns the
 * material patch that draws the gusts.
 */
export interface Mass { azimuth: number; weight: number }
export interface Gust {
  dirX: number; dirZ: number
  /** Distance along (dirX, dirZ) of the gust's head, world units. */
  pos: number
  strength: number
  width: number
  tail: number
  speed: number
}
export interface SchedulerOptions {
  reduced?: boolean
  random?: () => number
  /** The storm front's crossing time (storm.ts SWEEP_MS): the sweep gust keeps step with it. */
  sweepMs: number
}

export const MAX_GUSTS = 3
/** A gust is born this far upwind of the centre and dies the same distance past it. */
export const SPAWN_EDGE = -1.4 * HALF
const LIVE_WEIGHT = 0.05
const INTERVAL_FAINT = 6      // seconds between gusts at weight → 0
const INTERVAL_FULL = 1.8     // at weight 1

export function createGustScheduler(opts: SchedulerOptions) {
  const { reduced = false, random = Math.random, sweepMs } = opts
  const T = LOOK.terrain.sheen
  const live: Gust[] = []
  let masses: ReadonlyArray<Mass> = []
  let turn = 0            // round-robin over the live masses
  let nextIn = 0          // seconds until the next spawn; only counts down while a mass is live

  function interval(weight: number): number {
    const base = INTERVAL_FAINT + (INTERVAL_FULL - INTERVAL_FAINT) * weight
    return base * (0.7 + 0.6 * random())
  }

  function spawn(azimuth: number, strength: number, width: number, speed: number) {
    const [dirX, dirZ] = gustDirection(azimuth)
    live.push({ dirX, dirZ, pos: SPAWN_EDGE, strength, width, tail: T.tail, speed })
  }

  return {
    follow(m: ReadonlyArray<Mass>) { masses = m },
    sweep(dir: WindDir) {
      if (reduced) return
      live.length = 0
      const crossing = 2 * -SPAWN_EDGE
      spawn(DIR_AZIMUTH[dir], 1, T.width * 2, crossing / (sweepMs / 1000))
      nextIn = interval(1)
    },
    update(dt: number) {
      // advance and retire
      for (let i = live.length - 1; i >= 0; i--) {
        const g = live[i]
        g.pos += g.speed * dt
        if (g.pos > -SPAWN_EDGE + g.width + g.tail) live.splice(i, 1)
      }
      if (reduced) return
      // pick the live masses (in slot order, so two candidates alternate)
      let liveCount = 0
      let maxWeight = 0
      for (const m of masses) if (m.weight > LIVE_WEIGHT) { liveCount++; maxWeight = Math.max(maxWeight, m.weight) }
      if (liveCount === 0) return
      nextIn -= dt
      if (nextIn > 0 || live.length >= MAX_GUSTS) return
      let k = turn % liveCount
      turn++
      for (const m of masses) {
        if (m.weight <= LIVE_WEIGHT) continue
        if (k-- === 0) { spawn(m.azimuth, T.strength * m.weight, T.width, T.speed); break }
      }
      nextIn = interval(maxWeight)
    },
    gusts(): ReadonlyArray<Gust> { return live },
  }
}
