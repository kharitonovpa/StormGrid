import { describe, it, expect } from 'bun:test'
import { formatDuration, streakChip } from '../matchSummary.js'

describe('formatDuration', () => {
  it('renders minutes:seconds', () => {
    expect(formatDuration(84_000)).toBe('1:24')
  })
  it('pads seconds', () => {
    expect(formatDuration(65_000)).toBe('1:05')
  })
  it('renders sub-minute as 0:ss', () => {
    expect(formatDuration(31_400)).toBe('0:31')
  })
  it('never goes negative', () => {
    expect(formatDuration(-5)).toBe('0:00')
  })
})

describe('streakChip', () => {
  it('is empty at zero', () => {
    expect(streakChip(0)).toBe('')
  })
  it('is badge + count otherwise', () => {
    expect(streakChip(3)).toBe('💨 3')
  })
})
