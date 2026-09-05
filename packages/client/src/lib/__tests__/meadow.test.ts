import { describe, it, expect } from 'bun:test'
import { swell, groove, flatWeight, meadowTint, SWELL_AMP, GROOVE_DEPTH, GROOVE_HALF_WIDTH } from '../meadow.js'
import { HALF, CELL_SIZE, SIZE } from '../constants.js'
import { LOOK } from '../look.js'

const worldAt = (g: number) => -HALF + g * CELL_SIZE   // grid coordinate → world x/z

describe('swell', () => {
  it('stays within ±amp over a dense sample and is not flat', () => {
    let lo = Infinity, hi = -Infinity
    for (let z = -HALF; z <= HALF; z += 0.37) {
      for (let x = -HALF; x <= HALF; x += 0.41) {
        const v = swell(x, z)
        lo = Math.min(lo, v)
        hi = Math.max(hi, v)
      }
    }
    expect(lo).toBeGreaterThanOrEqual(-SWELL_AMP)
    expect(hi).toBeLessThanOrEqual(SWELL_AMP)
    expect(hi - lo).toBeGreaterThan(SWELL_AMP)   // uses at least half the range
  })

  it('is deterministic', () => {
    expect(swell(3.3, -7.1)).toBe(swell(3.3, -7.1))
    expect(SWELL_AMP).toBe(LOOK.terrain.swell.amp)
  })

  it('varies on the scale of a cell, not a vertex', () => {
    // Two points one mesh segment apart differ far less than the full range.
    const seg = SIZE / (7 * 15)
    const d = Math.abs(swell(2, 2) - swell(2 + seg, 2))
    expect(d).toBeLessThan(SWELL_AMP * 0.25)
  })
})

describe('groove', () => {
  it('is zero at a cell centre and −depth on a border', () => {
    expect(groove(worldAt(1.5), worldAt(1.5))).toBe(0)
    expect(groove(worldAt(1), worldAt(1.5))).toBeCloseTo(-GROOVE_DEPTH, 6)
    expect(groove(worldAt(1.5), worldAt(2))).toBeCloseTo(-GROOVE_DEPTH, 6)
  })

  it('is a V one half-width wide', () => {
    expect(groove(worldAt(1) + GROOVE_HALF_WIDTH, worldAt(1.5))).toBeCloseTo(0, 9)
    expect(groove(worldAt(1) + GROOVE_HALF_WIDTH / 2, worldAt(1.5))).toBeCloseTo(-GROOVE_DEPTH / 2, 6)
    expect(GROOVE_HALF_WIDTH).toBeCloseTo(LOOK.terrain.groove.halfWidth * SIZE / (7 * 15), 9)
  })

  it('chamfers the slab edge: full depth on the outer border', () => {
    expect(groove(-HALF, worldAt(3.5))).toBeCloseTo(-GROOVE_DEPTH, 6)
    expect(groove(worldAt(3.5), HALF)).toBeCloseTo(-GROOVE_DEPTH, 6)
  })
})

describe('flatWeight', () => {
  it('is 1 on a flat cell, 0 at a full level, and monotone between', () => {
    expect(flatWeight(0)).toBe(1)
    expect(flatWeight(1)).toBe(0)
    expect(flatWeight(-1)).toBe(0)
    let prev = 1
    for (let h = 0; h <= 1; h += 0.05) {
      const w = flatWeight(h)
      expect(w).toBeLessThanOrEqual(prev)
      prev = w
    }
  })
})

describe('meadowTint', () => {
  const tint = (s: number) => { const out: [number, number, number] = [1, 1, 1]; meadowTint(s, out); return out }

  it('is identity at zero swell', () => {
    expect(tint(0)).toEqual([1, 1, 1])
  })

  it('makes a crest lighter and warmer than a trough', () => {
    const crest = tint(1), trough = tint(-1)
    const sum = (c: number[]) => c[0] + c[1] + c[2]
    expect(sum(crest)).toBeGreaterThan(sum(trough))
    expect(crest[0] / crest[2]).toBeGreaterThan(trough[0] / trough[2])   // red over blue: warmth
  })

  it('clamps beyond ±1', () => {
    expect(tint(3)).toEqual(tint(1))
    expect(tint(-3)).toEqual(tint(-1))
  })
})
