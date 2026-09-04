import type { ReplaySummary } from '@wheee/shared'

type T = (key: string, ...args: (string | number)[]) => string

/** One "Recent" row: who played and who won, by name when the replay knows it. */
export function recentRowLabels(r: ReplaySummary, charLabel: Record<string, string>, t: T): { title: string; result: string } {
  const a = r.nameA || charLabel[r.charA] || r.charA
  const b = r.nameB || charLabel[r.charB] || r.charB
  const title = `${a} ${t('lobby.vs')} ${b}`
  if (r.winner === 'draw') return { title, result: t('lobby.draw') }
  const winnerName = r.winner === 'A' ? (r.nameA || 'A') : r.winner === 'B' ? (r.nameB || 'B') : ''
  return { title, result: t('lobby.won', winnerName) }
}
