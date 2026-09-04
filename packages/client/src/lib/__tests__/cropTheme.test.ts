import { describe, it, expect } from 'bun:test'
import { CROP_THEME } from '../cropTheme.js'

describe('CROP_THEME', () => {
  it('has an entry for every crop with well-formed values', () => {
    for (const crop of ['wheat', 'rice', 'corn'] as const) {
      const theme = CROP_THEME[crop]
      expect(theme.paletteAccent).toHaveLength(3)
      for (const channel of theme.paletteAccent) {
        expect(channel).toBeGreaterThanOrEqual(-1)
        expect(channel).toBeLessThanOrEqual(1)
      }
      expect(Number.isInteger(theme.skyTint)).toBe(true)
      expect(theme.skyTint).toBeGreaterThanOrEqual(0)
      expect(theme.skyTint).toBeLessThanOrEqual(0xffffff)
      expect(typeof theme.resultAccent).toBe('string')
      expect(theme.resultAccent.length).toBeGreaterThan(0)
    }
  })

  it('keeps wheat at today\'s exact sky color', () => {
    expect(CROP_THEME.wheat.skyTint).toBe(0x0a0e14)
  })
})
