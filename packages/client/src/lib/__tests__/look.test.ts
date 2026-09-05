import { describe, it, expect } from 'bun:test'
import { LOOK, srgbToLinear, srgbHexToLinear, cieLightness } from '../look.js'
import { MARCH_MAX, DEAD_ZONE } from '../terrainShade.js'
import { CELL_SIZE, HEIGHT_SCALE } from '../constants.js'

const isHex = (v: number) => Number.isInteger(v) && v >= 0 && v <= 0xffffff

describe('LOOK tokens', () => {
  it('holds valid sRGB hex colours everywhere a colour is expected', () => {
    const colours = [
      ...Object.values(LOOK.sky), LOOK.sun.color, LOOK.fill.color,
      LOOK.terrain.grass, LOOK.terrain.rock, LOOK.terrain.mud, LOOK.terrain.snow,
      LOOK.water.deep, LOOK.water.rim, LOOK.grid.color,
    ]
    for (const c of colours) expect(isHex(c)).toBe(true)
  })

  it('keeps opacities, strengths, tints and exposure in sane ranges', () => {
    for (const v of [LOOK.water.opacity, LOOK.grid.opacity, LOOK.terrain.checkerAmp, LOOK.terrain.aoStrength, LOOK.terrain.shadowStrength]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
    for (const t of LOOK.terrain.shadowTint) {
      expect(t).toBeGreaterThanOrEqual(0.5)
      expect(t).toBeLessThanOrEqual(1.5)
    }
    expect(LOOK.tone.mode).toBe('agx')
    expect(LOOK.tone.exposure).toBeGreaterThanOrEqual(0.5)
    expect(LOOK.tone.exposure).toBeLessThanOrEqual(2)
    expect(LOOK.sun.intensity).toBeGreaterThan(0)
    expect(LOOK.sun.intensity).toBeLessThanOrEqual(6)
    expect(LOOK.fill.intensity).toBeGreaterThan(0)
    expect(LOOK.fill.intensity).toBeLessThanOrEqual(2)
  })

  it('points the sun along a unit vector at a low dusk elevation (22°–45°)', () => {
    // Below 22° a 2-level rise's shadow outruns the baked march (MARCH_MAX cells).
    const [x, y, z] = LOOK.sun.direction
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 2)
    const elevationDeg = (Math.asin(y) * 180) / Math.PI
    expect(elevationDeg).toBeGreaterThanOrEqual(22)
    expect(elevationDeg).toBeLessThanOrEqual(45)
  })

  it('marches far enough to shadow a 2-level rise at the tuned sun', () => {
    // The engine clamps heights to ±1, so the largest relative rise is 2 levels;
    // the sun climbs riseLevelsPerCell per cell of march (lib/terrain.ts).
    const [x, y, z] = LOOK.sun.direction
    const riseLevelsPerCell = ((y / Math.hypot(x, z)) * CELL_SIZE) / HEIGHT_SCALE
    expect(MARCH_MAX).toBeGreaterThanOrEqual(2 / riseLevelsPerCell)
  })

  it('keeps the storm mass legible against the horizon band (ΔL* ≥ 12)', () => {
    expect(cieLightness(LOOK.sky.horizon) - cieLightness(LOOK.sky.storm)).toBeGreaterThanOrEqual(12)
  })

  it('holds the meadow, sheen and foot tokens in range', () => {
    const { swell, groove, sheen, grain } = LOOK.terrain
    for (const c of [swell.crest, swell.trough, sheen.color, LOOK.foot.color]) expect(isHex(c)).toBe(true)
    expect(swell.amp).toBeGreaterThan(0)
    expect(swell.wavelength).toBeGreaterThan(0.5)
    expect(swell.tint).toBeGreaterThanOrEqual(0)
    expect(swell.tint).toBeLessThanOrEqual(1)
    expect(groove.depth).toBeGreaterThan(0)
    expect(groove.halfWidth).toBeGreaterThanOrEqual(1)
    expect(grain).toBeGreaterThanOrEqual(0)
    expect(grain).toBeLessThanOrEqual(0.2)
    expect(sheen.strength).toBeGreaterThan(0)
    expect(sheen.strength).toBeLessThanOrEqual(1)
    expect(sheen.width).toBeGreaterThan(0)
    expect(sheen.tail).toBeGreaterThan(0)
    expect(sheen.speed).toBeGreaterThan(0)
    expect(LOOK.foot.opacity).toBeGreaterThan(0)
    expect(LOOK.foot.opacity).toBeLessThanOrEqual(1)
    for (const v of [LOOK.foot.across, LOOK.foot.along, LOOK.foot.offset]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('keeps the meadow decoration under the baked-shading dead zone and the palette lift/sink thresholds', () => {
    // DEAD_ZONE is in levels; the palette's lift starts at +0.2 and sink ends at −0.2 world units.
    const decoration = LOOK.terrain.swell.amp + LOOK.terrain.groove.depth
    expect(decoration).toBeLessThanOrEqual(0.2)
    expect(decoration).toBeLessThan(DEAD_ZONE * HEIGHT_SCALE)
  })
})

describe('colour helpers', () => {
  it('converts sRGB to linear at the known points', () => {
    expect(srgbToLinear(0)).toBe(0)
    expect(srgbToLinear(1)).toBeCloseTo(1, 6)
    expect(srgbToLinear(128 / 255)).toBeCloseTo(0.2158, 3)
    const red = srgbHexToLinear(0xff0000)
    expect(red[0]).toBeCloseTo(1, 6)
    expect(red[1]).toBe(0)
    expect(red[2]).toBe(0)
    for (const c of srgbHexToLinear(0x808080)) expect(c).toBeCloseTo(0.2158, 3)
  })

  it('measures CIE lightness from black to white', () => {
    expect(cieLightness(0x000000)).toBe(0)
    expect(cieLightness(0xffffff)).toBeCloseTo(100, 3)
    expect(cieLightness(0x808080)).toBeCloseTo(53.6, 0)
  })
})
