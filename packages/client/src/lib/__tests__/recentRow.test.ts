import { describe, it, expect } from 'bun:test'
import { recentRowSides } from '../recentRow.js'

const chars = { wheat: 'Wheat', rice: 'Rice' }

/*
 * A "Recent" row is two names; the colour says who won. No result column —
 * "Hippolyte won" next to "Scherer vs Hippolyte" said the same thing twice.
 */
describe('recentRowSides', () => {
  it('names the players and marks winner and loser', () => {
    const r = { id: '1', charA: 'wheat', charB: 'rice', winner: 'B', frameCount: 3, nameA: 'Bilibin', nameB: 'Lavrushka' } as const
    expect(recentRowSides(r, chars)).toEqual([
      { label: 'Bilibin', outcome: 'lose' },
      { label: 'Lavrushka', outcome: 'win' },
    ])
  })

  it('falls back to crop labels for old replays', () => {
    const r = { id: '1', charA: 'wheat', charB: 'rice', winner: 'A', frameCount: 3 } as const
    expect(recentRowSides(r, chars)).toEqual([
      { label: 'Wheat', outcome: 'win' },
      { label: 'Rice', outcome: 'lose' },
    ])
  })

  it('marks both sides of a draw', () => {
    const r = { id: '1', charA: 'wheat', charB: 'rice', winner: 'draw', frameCount: 3, nameA: 'X', nameB: 'Y' } as const
    expect(recentRowSides(r, chars).map((s) => s.outcome)).toEqual(['draw', 'draw'])
  })

  it('leaves an unfinished match uncoloured', () => {
    const r = { id: '1', charA: 'wheat', charB: 'rice', winner: null, frameCount: 3 } as const
    expect(recentRowSides(r, chars).map((s) => s.outcome)).toEqual(['none', 'none'])
  })
})
