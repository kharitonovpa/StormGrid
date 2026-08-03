import { describe, it, expect } from 'bun:test'
import { Room } from '../../Room.js'
import type { ServerMessage } from '../../protocol.js'
import type { GameState } from '@wheee/shared'

type FakeWs = {
  data: Record<string, unknown>
  send: (data: string) => void
  messages: ServerMessage[]
}

function makeFakeWs(): FakeWs {
  const messages: ServerMessage[] = []
  return {
    data: { sessionId: crypto.randomUUID(), userId: null, roomId: null, playerId: null, role: null },
    send(data: string) { messages.push(JSON.parse(data)) },
    messages,
  }
}

function makeRoom(id: string): Room {
  return new Room(id, { onDispose: () => {}, gracePeriodMs: 30_000 })
}

/**
 * Drive the room straight to the tick the crate is scheduled for.
 *
 * The moment is drawn at construction, so the test reads it back rather than
 * guessing — that keeps the randomness real instead of pinning it down.
 */
function reachCrateMoment(room: Room, ws: FakeWs): GameState | null {
  const targetRound = (room as unknown as { crateRound: number }).crateRound
  const targetTick = (room as unknown as { crateTick: number }).crateTick
  const anyRoom = room as unknown as {
    proceedToTicking(): void
    resolveTick(): void
    beginTick(): void
  }

  anyRoom.proceedToTicking()
  // Only round 1 is reachable without playing whole rounds out on real timers.
  if (targetRound !== 1) return null

  for (let tick = 1; tick <= targetTick; tick++) {
    anyRoom.resolveTick()
  }

  const resolves = ws.messages.filter(m => m.type === 'tick:resolve')
  const last = resolves[resolves.length - 1] as { state: GameState } | undefined
  return last?.state ?? null
}

describe('Room — streak crate', () => {
  it('is absent when the round opens — it arrives between ticks', () => {
    const room = makeRoom('crate-open')
    const ws = makeFakeWs()

    room.join(ws as never, 'wheat', 0)
    room.joinBot('corn')

    const roundStart = ws.messages.find(m => m.type === 'round:start') as { state: GameState }
    expect(roundStart.state.activeBonus).toBeNull()

    room.dispose()
  })

  it('arrives at its scheduled tick, addressed to the player without a badge', () => {
    // Rooms pick their own moment, so try until one lands in round 1.
    for (let attempt = 0; attempt < 40; attempt++) {
      const room = makeRoom(`crate-when-${attempt}`)
      const ws = makeFakeWs()
      room.join(ws as never, 'wheat', 0)
      room.joinBot('corn')

      const state = reachCrateMoment(room, ws)
      room.dispose()
      if (!state) continue

      expect(state.activeBonus).not.toBeNull()
      expect(state.activeBonus!.for).toBe('A')
      return
    }
    throw new Error('no room scheduled its crate for round 1 in 40 tries')
  })

  it('is left open when neither player carries a badge', () => {
    // Nobody to guard against, so it belongs to whoever reaches it first.
    for (let attempt = 0; attempt < 40; attempt++) {
      const room = makeRoom(`crate-open-${attempt}`)
      const a = makeFakeWs()
      const b = makeFakeWs()
      room.join(a as never, 'wheat', 0)
      room.join(b as never, 'corn', 0)

      const state = reachCrateMoment(room, a)
      room.dispose()
      if (!state) continue

      expect(state.activeBonus).not.toBeNull()
      expect(state.activeBonus!.for).toBeUndefined()
      return
    }
    throw new Error('no room scheduled its crate for round 1 in 40 tries')
  })

  it('stays away when both humans already carry a badge', () => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const room = makeRoom(`crate-none-${attempt}`)
      const a = makeFakeWs()
      const b = makeFakeWs()
      room.join(a as never, 'wheat', 3)
      room.join(b as never, 'corn', 12)

      const state = reachCrateMoment(room, a)
      room.dispose()
      if (!state) continue

      expect(state.activeBonus).toBeNull()
      return
    }
    throw new Error('no room scheduled its crate for round 1 in 40 tries')
  })

  it('never drops on a living player', () => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const room = makeRoom(`crate-safe-${attempt}`)
      const ws = makeFakeWs()
      room.join(ws as never, 'wheat', 0)
      room.joinBot('corn')

      const state = reachCrateMoment(room, ws)
      room.dispose()
      if (!state?.activeBonus) continue

      const bonus = state.activeBonus
      for (const pid of ['A', 'B'] as const) {
        const p = state.players[pid]
        expect(p.x === bonus.x && p.y === bonus.y).toBe(false)
      }
      return
    }
    throw new Error('no room scheduled its crate for round 1 in 40 tries')
  })

  it('schedules the moment inside the documented window', () => {
    for (let i = 0; i < 50; i++) {
      const room = makeRoom(`crate-window-${i}`)
      const r = (room as unknown as { crateRound: number }).crateRound
      const t = (room as unknown as { crateTick: number }).crateTick
      expect(r).toBeGreaterThanOrEqual(1)
      expect(r).toBeLessThanOrEqual(4)
      expect(t).toBeGreaterThanOrEqual(1)
      expect(t).toBeLessThanOrEqual(4)
      room.dispose()
    }
  })
})
