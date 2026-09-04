import { describe, it, expect } from 'bun:test'
import { pointsFor } from '../points.js'

const base = { rounds: 1, vsBot: false, ownDisconnect: false, crate: false } as const

/*
 * Points are a number that only grows — a reason to come back, not a rating.
 * The table lives in points.ts; these pin every row of it.
 */
describe('pointsFor', () => {
  it('scores the result', () => {
    expect(pointsFor({ ...base, result: 'win' })).toBe(10)
    expect(pointsFor({ ...base, result: 'draw' })).toBe(3)
    expect(pointsFor({ ...base, result: 'loss' })).toBe(1)
  })
  it('pays 2 per round survived after the first', () => {
    expect(pointsFor({ ...base, result: 'loss', rounds: 3 })).toBe(5)
    expect(pointsFor({ ...base, result: 'win', rounds: 4 })).toBe(16)
  })
  it('pays 2 for the crate', () => {
    expect(pointsFor({ ...base, result: 'draw', crate: true })).toBe(5)
  })
  it('halves a bot match, rounding up', () => {
    expect(pointsFor({ ...base, result: 'win', vsBot: true })).toBe(5)
    expect(pointsFor({ ...base, result: 'loss', vsBot: true })).toBe(1)
    expect(pointsFor({ ...base, result: 'draw', rounds: 2, vsBot: true })).toBe(3)
  })
  it('gives a leaver nothing, whatever else happened', () => {
    expect(pointsFor({ ...base, result: 'loss', rounds: 5, crate: true, ownDisconnect: true })).toBe(0)
  })
})
