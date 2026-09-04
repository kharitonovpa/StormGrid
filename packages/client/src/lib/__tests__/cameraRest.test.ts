import { describe, it, expect } from 'bun:test'
import { restDirection, isPortrait } from '../cameraRest.js'

/*
 * The resting camera looks at the board from the same compass bearing on every
 * screen (the storm sky is read against the NW horizon), but on a portrait
 * phone it climbs higher so the diamond is taller on screen instead of a flat
 * sliver across the middle.
 */
describe('restDirection', () => {
  const landscape = restDirection(1.6)
  const portrait = restDirection(0.46)

  it('is a unit vector', () => {
    for (const d of [landscape, portrait]) {
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6)
    }
  })

  it('keeps the landscape bearing of (30, 25, 30)', () => {
    const len = Math.hypot(30, 25, 30)
    expect(landscape.x).toBeCloseTo(30 / len, 6)
    expect(landscape.y).toBeCloseTo(25 / len, 6)
    expect(landscape.z).toBeCloseTo(30 / len, 6)
  })

  it('keeps the azimuth on portrait', () => {
    expect(Math.atan2(portrait.z, portrait.x)).toBeCloseTo(Math.atan2(landscape.z, landscape.x), 6)
  })

  it('climbs to 52 degrees on portrait', () => {
    const elev = Math.asin(portrait.y)
    expect(elev * 180 / Math.PI).toBeCloseTo(52, 3)
  })

  it('switches at aspect 0.9', () => {
    expect(isPortrait(0.89)).toBe(true)
    expect(isPortrait(0.9)).toBe(false)
  })
})
