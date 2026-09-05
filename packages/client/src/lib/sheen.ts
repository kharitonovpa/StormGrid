import type { WindDir } from '@wheee/shared'
import * as THREE from 'three'
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
/** Half the board's diagonal: the furthest a corner can sit from the centre along any bearing. */
const FAR_CORNER = Math.SQRT2 * HALF
/**
 * Where a gust of this width is born, along its own direction. 3σ upwind of the
 * far corner — the mirror of the retirement rule — so the head's Gaussian
 * (exp(-d²/w²) = e⁻⁹) is invisible on the upwind edge at birth whatever azimuth
 * a broken vane picks. A fixed edge would pop a wide gust in at full strength.
 */
export function spawnEdge(width: number): number { return -(FAR_CORNER + 3 * width) }
/** Where it is dropped: 3σ plus its tail past the far corner, the tail being the part still behind. */
function retireEdge(width: number, tail: number): number { return FAR_CORNER + 3 * width + tail }
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
    live.push({ dirX, dirZ, pos: spawnEdge(width), strength, width, tail: T.tail, speed })
  }

  return {
    follow(m: ReadonlyArray<Mass>) { masses = m },
    sweep(dir: WindDir) {
      if (reduced) return
      live.length = 0
      const width = T.width * 2
      // sweepMs is the time the storm front takes to cross the BOARD, so that is
      // the distance to time against: the board's full diagonal. The wider gust's
      // birth position (3σ further upwind) only delays its arrival by ~0.4 s.
      const crossing = 2 * Math.SQRT2 * HALF
      spawn(DIR_AZIMUTH[dir], 1, width, crossing / (sweepMs / 1000))
      nextIn = interval(1)
    },
    update(dt: number) {
      // advance and retire
      for (let i = live.length - 1; i >= 0; i--) {
        const g = live[i]
        g.pos += g.speed * dt
        // 3σ past the far corner: the Gaussian has to be invisible before the gust is dropped
        if (g.pos > retireEdge(g.width, g.tail)) live.splice(i, 1)
      }
      if (reduced) return
      // pick the live masses (in slot order, so two candidates alternate)
      let liveCount = 0
      let maxWeight = 0
      for (const m of masses) if (m.weight > LIVE_WEIGHT) { liveCount++; maxWeight = Math.max(maxWeight, m.weight) }
      if (liveCount === 0) return
      nextIn -= dt
      // Never bank time while every slot is taken. The spawn below fires on
      // `nextIn <= 0` either way, so this changes no cadence today; it keeps
      // nextIn an honest countdown, so a capped stretch can never hand a later,
      // fainter interval a head start it did not earn.
      if (live.length >= MAX_GUSTS) { nextIn = Math.max(nextIn, 0); return }
      if (nextIn > 0) return
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

export interface SheenHandle { follow(masses: ReadonlyArray<Mass>): void }

// MAX_GUSTS is interpolated into both chunks so the GLSL array bounds and the
// loop can never drift from the uniform arrays createSheenSystem allocates.
const GLSL_DECL = /* glsl */ `
uniform vec4 uGust[${MAX_GUSTS}];        // dirX, dirZ, pos, strength
uniform float uGustWidth[${MAX_GUSTS}];  // per-gust width (world units)
uniform float uGustTail[${MAX_GUSTS}];   // per-gust tail (world units)
uniform vec3 uSheenColor;
varying vec2 vWorldXZ;
`

// Applied to the diffuse colour BEFORE lighting, so the sun and fill stay honest.
// Leading highlight around the head, a shorter shade behind it (grass laid
// over, away from the sun); a cheap sine along the band breaks the ruler line.
const GLSL_BAND = /* glsl */ `
for (int i = 0; i < ${MAX_GUSTS}; i++) {
  vec4 g = uGust[i];
  if (g.w <= 0.0) continue;
  vec2 dir = g.xy;
  float p = dot(vWorldXZ, vec2(-dir.y, dir.x));
  float edge = sin(p * 0.35) * 2.5 + sin(p * 0.9 + 1.7) * 1.2;
  float d = dot(vWorldXZ, dir) - g.z + edge;
  float w = uGustWidth[i];
  float lead = exp(-(d * d) / (w * w));
  float t = (d + uGustTail[i]) / uGustTail[i];
  float trail = exp(-t * t);
  diffuseColor.rgb *= 1.0 + g.w * (lead * uSheenColor - 0.5 * trail);
}
`

/**
 * Patches the shared terrain material (top, underside and skirt) so a gust
 * from the scheduler is drawn as a moving band in world space. Installed
 * before the first render — the program compiles once, with every strength
 * at 0, and never again (customProgramCacheKey pins it; `transparent` is
 * already flipped on by lib/glass.ts at creation, so no flag changes later).
 */
export function createSheenSystem(material: THREE.MeshStandardMaterial, scheduler: ReturnType<typeof createGustScheduler>) {
  const T = LOOK.terrain.sheen
  const uniforms = {
    uGust: { value: new Float32Array(MAX_GUSTS * 4) },
    uGustWidth: { value: new Float32Array(MAX_GUSTS).fill(1) },   // never 0: an idle slot must not divide by zero
    uGustTail: { value: new Float32Array(MAX_GUSTS).fill(1) },
    uSheenColor: { value: new THREE.Color(T.color) },
  }
  const previous = material.onBeforeCompile
  const previousCacheKey = material.customProgramCacheKey
  material.onBeforeCompile = (shader, renderer) => {
    previous?.(shader, renderer)
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = 'varying vec2 vWorldXZ;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;')
    shader.fragmentShader = GLSL_DECL + shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + GLSL_BAND)
  }
  material.customProgramCacheKey = () => 'meadow-sheen'
  material.needsUpdate = true

  return {
    uniforms,
    follow(masses: ReadonlyArray<Mass>) { scheduler.follow(masses) },
    sweep(dir: WindDir) { scheduler.sweep(dir) },
    update(dt: number) {
      scheduler.update(dt)
      const g = scheduler.gusts()
      const u = uniforms.uGust.value
      for (let i = 0; i < MAX_GUSTS; i++) {
        const o = i * 4
        if (i < g.length) {
          u[o] = g[i].dirX; u[o + 1] = g[i].dirZ; u[o + 2] = g[i].pos; u[o + 3] = g[i].strength
          uniforms.uGustWidth.value[i] = g[i].width
          uniforms.uGustTail.value[i] = g[i].tail
        } else {
          u[o] = 0; u[o + 1] = 0; u[o + 2] = 0; u[o + 3] = 0
          uniforms.uGustWidth.value[i] = 1
          uniforms.uGustTail.value[i] = 1
        }
      }
    },
    dispose() {
      material.onBeforeCompile = previous ?? (() => {})
      // The cache key has to go back with it: left pinned at 'meadow-sheen',
      // needsUpdate resolves the same cached patched program and dispose draws
      // the gusts on forever.
      material.customProgramCacheKey = previousCacheKey
      material.needsUpdate = true
    },
  }
}
