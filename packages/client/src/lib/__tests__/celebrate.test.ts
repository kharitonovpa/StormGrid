import { describe, it, expect } from 'bun:test'
import { pickHue } from '../celebrate.js'

describe('pickHue', () => {
  it('keeps the gold range when no hue is given', () => {
    expect(pickHue(undefined, 0)).toBe(38)
    expect(pickHue(undefined, 1)).toBe(58)
  })

  it('spreads ±12° around a given hue', () => {
    expect(pickHue(193, 0)).toBe(181)
    expect(pickHue(193, 0.5)).toBe(193)
    expect(pickHue(193, 1)).toBe(205)
  })
})
