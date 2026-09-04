import type { ReplaySummary } from '@wheee/shared'

export type SideOutcome = 'win' | 'lose' | 'draw' | 'none'
export type RecentSide = { label: string; outcome: SideOutcome }

/**
 * One "Recent" row: the two players, by name when the replay knows them, each
 * with how it went for them — the colour of the name carries the result.
 */
export function recentRowSides(r: ReplaySummary, charLabel: Record<string, string>): [RecentSide, RecentSide] {
  const outcomeFor = (side: 'A' | 'B'): SideOutcome => {
    if (r.winner === null || r.winner === undefined) return 'none'
    if (r.winner === 'draw') return 'draw'
    return r.winner === side ? 'win' : 'lose'
  }
  return [
    { label: r.nameA || charLabel[r.charA] || r.charA, outcome: outcomeFor('A') },
    { label: r.nameB || charLabel[r.charB] || r.charB, outcome: outcomeFor('B') },
  ]
}
