import { describe, it, expect } from 'bun:test'
import { CROP_THEME } from '../cropTheme.js'

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
