/**
 * CPU-baked shading terms for the terrain's vertex colours, computed over the
 * cell heightmap (heights in levels; world Y = level * HEIGHT_SCALE). Pure
 * functions with O(1) cell lookups, so paintColors stays cheap while the
 * terrain animates, and everything here is unit-testable on a synthetic map.
 *
 * Grid space: gx, gz are continuous cell coordinates (0..cells) on the same
 * lattice as terrain.current[cz][cx]; a vertex inside cell (cx, cz) has
 * gx in [cx, cx + 1).
 */
export type HeightAt = (cx: number, cz: number) => number

export interface SunParams {
  /** Horizontal unit direction toward the sun, in grid space. */
  dirX: number
  dirZ: number
  /** Levels the sun ray climbs per cell of horizontal travel (tan(elevation) in grid units). */
  riseLevelsPerCell: number
}

/** Height differences below this (levels) are ignored: the surface mesh carries
 *  decorative noise that must not read as occlusion. */
export const DEAD_ZONE = 0.05
/** Width (levels) of the soft edge that turns a hard shadow line into a penumbra. */
export const PENUMBRA = 0.15
const MARCH_STEP = 0.25   // cells
const MARCH_MAX = 4       // cells — covers a 3-level block at a 28° sun
const NO_CEILING = -100   // "nothing in the way", finite so fields interpolate

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
]

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

function cellIndex(g: number, cells: number): number {
  return Math.min(cells - 1, Math.max(0, Math.floor(g)))
}

/** The height a shading term starts from: the vertex itself or its own cell's
 *  nominal top, whichever is higher, so surface noise dipping below the cell
 *  never reads as "under" its own cell. */
function baseHeight(heights: HeightAt, cells: number, gx: number, gz: number, hLevels: number): number {
  return Math.max(hLevels, heights(cellIndex(gx, cells), cellIndex(gz, cells)))
}

/**
 * Contact occlusion 0..1: how much the taller neighbouring cells crowd the
 * point. Each neighbour contributes rise / 2 — rise clamped to 0..2 levels
 * above the dead zone — scaled by proximity to the shared edge or corner
 * (linear falloff over 0.6 cell); contributions combine as 1 − Π(1 − w), so
 * several tall neighbours saturate instead of stacking past 1.
 */
export function contactOcclusion(heights: HeightAt, cells: number, gx: number, gz: number, hLevels: number): number {
  const cx = cellIndex(gx, cells), cz = cellIndex(gz, cells)
  const h0 = baseHeight(heights, cells, gx, gz, hLevels)
  const fx = gx - cx, fz = gz - cz
  let clear = 1
  for (const [dx, dz] of NEIGHBOURS) {
    const nx = cx + dx, nz = cz + dz
    if (nx < 0 || nz < 0 || nx >= cells || nz >= cells) continue
    const rise = Math.min(2, Math.max(0, heights(nx, nz) - h0 - DEAD_ZONE))
    if (rise === 0) continue
    const ex = dx < 0 ? fx : dx > 0 ? 1 - fx : 0
    const ez = dz < 0 ? fz : dz > 0 ? 1 - fz : 0
    const near = Math.max(0, 1 - Math.hypot(ex, ez) / 0.6)
    clear *= 1 - (rise / 2) * near
  }
  return 1 - clear
}

/**
 * The shadow ceiling at (gx, gz): the highest level a point there could sit at
 * and still be shaded by something between it and the sun, or NO_CEILING when
 * nothing stands in the way. Marches toward the sun in ¼-cell steps up to
 * 4 cells; the ray climbs riseLevelsPerCell per cell of travel, so a blocker of
 * height H at distance t shades everything below H − rise·t.
 */
export function shadowCeiling(heights: HeightAt, cells: number, gx: number, gz: number, sun: SunParams): number {
  let ceiling = NO_CEILING
  for (let t = MARCH_STEP; t <= MARCH_MAX; t += MARCH_STEP) {
    const sx = gx + sun.dirX * t, sz = gz + sun.dirZ * t
    if (sx < 0 || sz < 0 || sx >= cells || sz >= cells) break
    const blocker = heights(Math.floor(sx), Math.floor(sz)) - sun.riseLevelsPerCell * t
    if (blocker > ceiling) ceiling = blocker
  }
  return ceiling
}

/** Occlusion 0..1 of a point at hLevels under a shadow ceiling: 0 once the
 *  point clears the ceiling, 1 once it is a full penumbra width below it. */
export function occlusionFromCeiling(ceiling: number, hLevels: number): number {
  return smoothstep(0, PENUMBRA, ceiling - hLevels - DEAD_ZONE)
}

/** Sun occlusion 0..1 at a vertex — the reference form of the shadow term. */
export function sunOcclusion(heights: HeightAt, cells: number, gx: number, gz: number, hLevels: number, sun: SunParams): number {
  return occlusionFromCeiling(shadowCeiling(heights, cells, gx, gz, sun), baseHeight(heights, cells, gx, gz, hLevels))
}

/**
 * Shadow ceilings on a lattice of `res` points per cell — (cells·res + 1)²
 * values, row-major by z. Building it once per repaint costs ~1k marches;
 * each vertex then needs one bilinear read instead of its own march.
 */
export function buildShadowField(heights: HeightAt, cells: number, sun: SunParams, res = 4): Float32Array {
  const n = cells * res + 1
  const field = new Float32Array(n * n)
  for (let iz = 0; iz < n; iz++)
    for (let ix = 0; ix < n; ix++)
      field[iz * n + ix] = shadowCeiling(heights, cells, ix / res, iz / res, sun)
  return field
}

/** Sun occlusion 0..1 at a vertex, read from a field built by buildShadowField. */
export function sampleShadowField(field: Float32Array, heights: HeightAt, cells: number, res: number, gx: number, gz: number, hLevels: number): number {
  const n = cells * res + 1
  const fx = Math.min(n - 1, Math.max(0, gx * res)), fz = Math.min(n - 1, Math.max(0, gz * res))
  const ix = Math.min(n - 2, Math.floor(fx)), iz = Math.min(n - 2, Math.floor(fz))
  const tx = fx - ix, tz = fz - iz
  const top = field[iz * n + ix] + (field[iz * n + ix + 1] - field[iz * n + ix]) * tx
  const bottom = field[(iz + 1) * n + ix] + (field[(iz + 1) * n + ix + 1] - field[(iz + 1) * n + ix]) * tx
  const ceiling = top + (bottom - top) * tz
  return occlusionFromCeiling(ceiling, baseHeight(heights, cells, gx, gz, hLevels))
}
