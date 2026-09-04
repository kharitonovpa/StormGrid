import { describe, it, expect } from 'bun:test'
import {
  contactOcclusion, sunOcclusion, buildShadowField, sampleShadowField, type SunParams,
} from '../terrainShade.js'

// A cells×cells map with raised blocks; heights(cx, cz) reads it like terrain.current[cz][cx].
function mapWith(cells: number, blocks: Array<[cx: number, cz: number, level: number]>) {
  const grid = Array.from({ length: cells }, () => new Float32Array(cells))
  for (const [cx, cz, level] of blocks) grid[cz][cx] = level
  return (cx: number, cz: number) => grid[cz][cx]
}

// 7.5 world units per cell and 5 per level are the game's CELL_SIZE / HEIGHT_SCALE.
const sunFromEast = (elevationDeg: number): SunParams => ({
  dirX: 1, dirZ: 0, riseLevelsPerCell: (Math.tan((elevationDeg * Math.PI) / 180) * 7.5) / 5,
})

describe('contactOcclusion', () => {
  const flat = mapWith(3, [])
  const block = mapWith(3, [[1, 1, 2]])

  it('is zero everywhere on a flat map', () => {
    expect(contactOcclusion(flat, 3, 0.5, 0.5, 0)).toBe(0)
    expect(contactOcclusion(flat, 3, 2.9, 1.2, 0)).toBe(0)
  })

  it('darkens the foot of a taller neighbour and fades out within 0.6 cell', () => {
    expect(contactOcclusion(block, 3, 0.95, 1.5, 0)).toBeGreaterThan(0.8)
    expect(contactOcclusion(block, 3, 0.5, 1.5, 0)).toBeGreaterThan(0)
    expect(contactOcclusion(block, 3, 0.3, 1.5, 0)).toBe(0)
  })

  it('leaves the top of the block itself untouched', () => {
    expect(contactOcclusion(block, 3, 1.5, 1.5, 2)).toBe(0)
    expect(contactOcclusion(block, 3, 1.05, 1.5, 2)).toBe(0)
  })

  it('ignores surface noise that dips below the cell it belongs to', () => {
    expect(contactOcclusion(flat, 3, 1.5, 1.5, -0.24)).toBe(0)
  })
})

describe('sunOcclusion', () => {
  const block = mapWith(3, [[1, 1, 2]])
  const sun28 = sunFromEast(28)

  it('shadows the side facing away from the sun and not the sunlit side', () => {
    expect(sunOcclusion(block, 3, 0.5, 1.5, 0, sun28)).toBe(1)   // west of the block, sun in the east
    expect(sunOcclusion(block, 3, 2.5, 1.5, 0, sun28)).toBe(0)   // east of the block: nothing toward the sun
  })

  it('is zero on a flat map', () => {
    expect(sunOcclusion(mapWith(3, []), 3, 1.5, 1.5, 0, sun28)).toBe(0)
  })

  it('casts a longer shadow when the sun is lower', () => {
    const wide = mapWith(6, [[4, 2, 2]])   // 2-level block at cx = 4; the point is 3 cells from its west face
    expect(sunOcclusion(wide, 6, 1.0, 2.5, 0, sunFromEast(20))).toBeGreaterThan(0.5)
    expect(sunOcclusion(wide, 6, 1.0, 2.5, 0, sunFromEast(45))).toBe(0)
  })

  it('ignores surface noise that dips below the cell it belongs to', () => {
    expect(sunOcclusion(mapWith(3, []), 3, 1.5, 1.5, -0.24, sun28)).toBe(0)
  })
})

describe('buildShadowField / sampleShadowField', () => {
  it('agrees with the per-vertex reference on lattice points', () => {
    const map = mapWith(6, [[4, 2, 2], [1, 4, 1]])
    const sun = sunFromEast(28)
    const field = buildShadowField(map, 6, sun, 4)
    const points: Array<[number, number, number]> = [[1.0, 2.5, 0], [3.75, 2.25, 0], [0.5, 4.5, 0], [4.5, 2.5, 2], [2.0, 0.0, 0], [5.75, 5.75, 0]]
    for (const [gx, gz, h] of points) {
      expect(sampleShadowField(field, map, 6, 4, gx, gz, h)).toBeCloseTo(sunOcclusion(map, 6, gx, gz, h, sun), 6)
    }
  })

  it('has one value per lattice point', () => {
    expect(buildShadowField(mapWith(3, []), 3, sunFromEast(28), 4)).toHaveLength(13 * 13)
  })
})
