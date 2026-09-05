/**
 * The meadow: what a FLAT cell looks like. Pure functions over world x/z, no
 * `three`, deterministic — the top face, the underside, the height cache and
 * the frozen-frame captures must all agree.
 *
 * Nothing here may read as a height level: swell + groove stay under the
 * baked shading's DEAD_ZONE (lib/terrainShade.ts) and under the palette's
 * lift/sink thresholds (lib/terrain.ts paintColors). lib/__tests__/look.test.ts
 * pins that invariant on the tokens.
 */
import { CELL_SIZE, HALF, SIZE, SEGMENTS } from './constants'
import { noise2d, clamp, sstep, mix } from './noise'
import { LOOK, srgbHexToLinear } from './look'

const { amp, wavelength, tint } = LOOK.terrain.swell
export const SWELL_AMP = amp
export const GROOVE_DEPTH = LOOK.terrain.groove.depth
/** One mesh segment is SIZE / SEGMENTS: the V uses the existing vertex rows. */
export const GROOVE_HALF_WIDTH = LOOK.terrain.groove.halfWidth * (SIZE / SEGMENTS)

/** Cycles per world unit: one lattice cell of noise2d per `wavelength` board cells. */
const FREQ = 1 / (wavelength * CELL_SIZE)

/**
 * Two octaves of the deterministic value noise, centred and normalised to
 * ±amp. Offsets keep it off the hill noise's lattice (terrain.ts uses fbm at
 * NOISE_FREQ with no offset) so a swell crest never lines up with a hill wobble.
 */
export function swell(wx: number, wz: number): number {
  const a = noise2d(wx * FREQ + 311.7, wz * FREQ + 97.3) - 0.5
  const b = noise2d(wx * FREQ * 2.1 + 53.1, wz * FREQ * 2.1 + 191.9) - 0.5
  return clamp((a + b * 0.5) / 0.75, -1, 1) * amp
}

/** World distance from `w` to the nearest cell border along one axis (0 on a border). */
function borderDistance(w: number): number {
  const g = (w + HALF) / CELL_SIZE
  const f = g - Math.floor(g)
  return Math.min(f, 1 - f) * CELL_SIZE
}

/**
 * V-groove at every cell border, the slab's outer edge included (there it is a
 * small chamfer). ≤ 0; −depth on the border line, 0 one half-width away.
 */
export function groove(wx: number, wz: number): number {
  const d = Math.min(borderDistance(wx), borderDistance(wz))
  if (d >= GROOVE_HALF_WIDTH) return 0
  return -GROOVE_DEPTH * (1 - d / GROOVE_HALF_WIDTH)
}

/**
 * How much of the meadow a cell carries: all of it flat, none at a full level.
 * Fades out early (by 0.6 level) so a rising cell hands over to the hill noise
 * before its vertices start to be displaced sideways (terrain.ts rebuildMesh).
 */
export function flatWeight(levels: number): number {
  return 1 - sstep(0, 0.6, Math.abs(levels))
}

const GRASS = srgbHexToLinear(LOOK.terrain.grass)
const CREST = srgbHexToLinear(LOOK.terrain.swell.crest)
const TROUGH = srgbHexToLinear(LOOK.terrain.swell.trough)

/**
 * Multiplicative linear RGB factors for the grass at swell `s = swell / amp`:
 * crests lean toward `crest`, hollows toward `trough`, by `tint`. Relative to
 * the grass token, so paintColors can apply it on top of its own grain. Writes
 * into `out` — this runs per vertex.
 */
export function meadowTint(s: number, out: [number, number, number]): void {
  const k = clamp(s, -1, 1) * tint
  const target = k >= 0 ? CREST : TROUGH
  const w = Math.abs(k)
  out[0] = mix(1, target[0] / GRASS[0], w)
  out[1] = mix(1, target[1] / GRASS[1], w)
  out[2] = mix(1, target[2] / GRASS[2], w)
}
