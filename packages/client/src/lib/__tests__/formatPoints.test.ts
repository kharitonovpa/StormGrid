import { describe, it, expect } from 'bun:test'
import { formatPoints } from '../formatPoints.js'

describe('formatPoints', () => {
  it('splits thousands with a thin space', () => {
    expect(formatPoints(1240)).toBe('1 240')
    expect(formatPoints(1234567)).toBe('1 234 567')
    expect(formatPoints(999)).toBe('999')
  })

  it('renders nothing for zero, negative, fractional-noise and unknown totals', () => {
    expect(formatPoints(0)).toBe('')
    expect(formatPoints(-5)).toBe('')
    expect(formatPoints(undefined)).toBe('')
    expect(formatPoints(Number.NaN)).toBe('')
    expect(formatPoints(12.7)).toBe('12')
  })
})
