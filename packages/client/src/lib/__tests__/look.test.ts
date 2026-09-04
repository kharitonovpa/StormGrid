import { describe, it, expect } from 'bun:test'
import { LOOK, srgbToLinear, srgbHexToLinear, cieLightness } from '../look.js'

const isHex = (v: number) => Number.isInteger(v) && v >= 0 && v <= 0xffffff

describe('LOOK tokens', () => {
  it('holds valid sRGB hex colours everywhere a colour is expected', () => {
    const colours = [
      ...Object.values(LOOK.sky), LOOK.sun.color, LOOK.hemi.sky, LOOK.hemi.ground,
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
    expect(LOOK.hemi.intensity).toBeGreaterThan(0)
  })

  it('points the sun along a unit vector at a low dusk elevation (15°–45°)', () => {
    const [x, y, z] = LOOK.sun.direction
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 2)
    const elevationDeg = (Math.asin(y) * 180) / Math.PI
    expect(elevationDeg).toBeGreaterThanOrEqual(15)
    expect(elevationDeg).toBeLessThanOrEqual(45)
  })

  it('keeps the storm mass legible against the horizon band (ΔL* ≥ 12)', () => {
    expect(cieLightness(LOOK.sky.horizon) - cieLightness(LOOK.sky.storm)).toBeGreaterThanOrEqual(12)
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
