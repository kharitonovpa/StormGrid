import type { ReplayData, ReplaySummary } from '@wheee/shared'

const MAX_REPLAYS = 50

export class ReplayStore {
  private data = new Map<string, ReplayData>()
  private order: string[] = []

  save(replay: ReplayData): void {
    if (this.data.has(replay.id)) return
    if (this.order.length >= MAX_REPLAYS) {
      const oldest = this.order.shift()!
      this.data.delete(oldest)
    }
    this.data.set(replay.id, replay)
    this.order.push(replay.id)
  }

  get(id: string): ReplayData | undefined {
    return this.data.get(id)
  }

  list(): ReplaySummary[] {
    const out: ReplaySummary[] = []
    for (let i = this.order.length - 1; i >= 0; i--) {
      const r = this.data.get(this.order[i])!
      out.push({ id: r.id, charA: r.charA, charB: r.charB, winner: r.winner, frameCount: r.frames.length })
    }
    return out
  }
}
