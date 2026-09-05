import { describe, it, expect } from 'bun:test'
import { GEMS } from '../insects.js'
import { CROP_THEME, hexToCss } from '../cropTheme.js'

describe('butterfly gems', () => {
  it('use the crop identity colour as the wing mid tone', () => {
    for (const crop of ['wheat', 'rice', 'corn'] as const) {
      expect(GEMS[crop].mid).toBe(hexToCss(CROP_THEME[crop].identity))
    }
  })
})
