import { describe, it, expect } from 'bun:test'
import { CROP_THEME, hexToCss, hexToRgba, lightenHex, hexHue } from '../cropTheme.js'

describe('CROP_THEME', () => {
  it('has an entry for every crop with well-formed values', () => {
    for (const crop of ['wheat', 'rice', 'corn'] as const) {
      const theme = CROP_THEME[crop]
      expect(theme.paletteAccent).toHaveLength(3)
      for (const channel of theme.paletteAccent) {
        expect(channel).toBeGreaterThanOrEqual(-0.1)
        expect(channel).toBeLessThanOrEqual(0.1)
      }
      expect(theme.skyTint).toHaveLength(3)
      for (const channel of theme.skyTint) {
        expect(channel).toBeGreaterThanOrEqual(0.85)
        expect(channel).toBeLessThanOrEqual(1.15)
      }
      expect(typeof theme.resultAccent).toBe('string')
      expect(theme.resultAccent.length).toBeGreaterThan(0)
    }
  })

  it('leaves the sky untinted for wheat, the default crop', () => {
    expect(CROP_THEME.wheat.skyTint).toEqual([1, 1, 1])
  })
})

const CROPS = ['wheat', 'rice', 'corn'] as const

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

describe('CROP_THEME.identity', () => {
  it('is a 24-bit colour for every crop', () => {
    for (const crop of CROPS) {
      const hex = CROP_THEME[crop].identity
      expect(Number.isInteger(hex)).toBe(true)
      expect(hex).toBeGreaterThanOrEqual(0)
      expect(hex).toBeLessThanOrEqual(0xffffff)
    }
  })

  it('keeps the three identities at least 40° apart in hue', () => {
    for (const a of CROPS) {
      for (const b of CROPS) {
        if (a === b) continue
        expect(hueDistance(hexHue(CROP_THEME[a].identity), hexHue(CROP_THEME[b].identity))).toBeGreaterThanOrEqual(40)
      }
    }
  })
})

describe('colour helpers', () => {
  it('hexToCss keeps leading zeros', () => {
    expect(hexToCss(0xf0940f)).toBe('#f0940f')
    expect(hexToCss(0x0000ff)).toBe('#0000ff')
  })

  it('hexToRgba spells out the channels', () => {
    expect(hexToRgba(0xf0940f, 0.35)).toBe('rgba(240, 148, 15, 0.35)')
  })

  it('lightenHex mixes toward white per channel and rounds', () => {
    expect(lightenHex(0x000000, 0.5)).toBe(0x808080)
    expect(lightenHex(0xffffff, 0.4)).toBe(0xffffff)
    expect(lightenHex(0x16a8d2, 0)).toBe(0x16a8d2)
  })

  it('hexHue returns HSL hue in degrees', () => {
    expect(hexHue(0xff0000)).toBe(0)
    expect(hexHue(0x00ff00)).toBe(120)
    expect(hexHue(0x0000ff)).toBe(240)
    expect(hexHue(0x808080)).toBe(0)
  })
})
