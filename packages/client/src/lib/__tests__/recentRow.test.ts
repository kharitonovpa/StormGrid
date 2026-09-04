import { describe, it, expect } from 'bun:test'
import { recentRowLabels } from '../recentRow.js'

const t = (key: string, ...args: (string | number)[]) =>
  key === 'lobby.won' ? `${args[0]} won` : key === 'lobby.draw' ? 'Draw' : key === 'lobby.vs' ? 'vs' : key
const chars = { wheat: 'Wheat', rice: 'Rice' }

describe('recentRowLabels', () => {
  it('prefers player names and names the winner', () => {
    const r = { id: '1', charA: 'wheat', charB: 'rice', winner: 'B', frameCount: 3, nameA: 'Bilibin', nameB: 'Lavrushka' } as const
    expect(recentRowLabels(r, chars, t)).toEqual({ title: 'Bilibin vs Lavrushka', result: 'Lavrushka won' })
  })

  it('falls back to crop labels and the slot letter for old replays', () => {
    const r = { id: '1', charA: 'wheat', charB: 'rice', winner: 'A', frameCount: 3 } as const
    expect(recentRowLabels(r, chars, t)).toEqual({ title: 'Wheat vs Rice', result: 'A won' })
  })

  it('says draw', () => {
    const r = { id: '1', charA: 'wheat', charB: 'rice', winner: 'draw', frameCount: 3, nameA: 'X', nameB: 'Y' } as const
    expect(recentRowLabels(r, chars, t).result).toBe('Draw')
  })
})
