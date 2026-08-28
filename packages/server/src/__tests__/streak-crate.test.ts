import { describe, it, expect } from 'bun:test'
import { RoomManager } from '../RoomManager.js'
import type { ServerMessage } from '../protocol.js'

/*
 * The badge crate is the only way into the only progression this game has, and
 * it used to arrive in a random round between the first and the fourth. The
 * first live match_result on production was a death by wind in round 1 — a
 * player who dies that early may never see the crate at all, so the single
 * entrance to the streak was unreachable by luck.
 *
 * The unpredictability was there to stop the arrival being timed by habit, and
 * that argument is about players who already carry a badge and could lie in
 * wait. For someone with no badge it only decides whether they live long
 * enough to reach it — so they get it in the first round.
 */

function makeFakeWs() {
  const messages: ServerMessage[] = []
  return {
    data: {
      sessionId: crypto.randomUUID(), userId: null, userName: null, countryCode: null,
      roomId: null, playerId: null, role: null, analytics: null,
    },
    readyState: 1,
    send(data: string) { messages.push(JSON.parse(data)) },
    messages,
  }
}

function roomWith(streakA: number, streakB: number | 'bot') {
  const room = new RoomManager().createRoom({ lightningEnabled: true })
  room.join(makeFakeWs() as never, 'wheat', streakA)
  if (streakB === 'bot') room.joinBot('rice')
  else room.join(makeFakeWs() as never, 'rice', streakB)
  return room
}

describe('badge crate timing', () => {
  it('drops in the first round for a player with no badge', () => {
    expect(roomWith(0, 4).crateDropRound).toBe(1)
  })

  it('drops in the first round when neither player has one', () => {
    expect(roomWith(0, 0).crateDropRound).toBe(1)
  })

  it('drops in the first round for a newcomer facing a bot', () => {
    expect(roomWith(0, 'bot').crateDropRound).toBe(1)
  })

  it('stays unpredictable when both players already carry a badge', () => {
    // Nobody there can be seeded, so the old anti-habit randomness is all that
    // the schedule is for. Sampled, because the claim is about variety.
    const rounds = new Set<number>()
    for (let i = 0; i < 40; i++) rounds.add(roomWith(3, 7).crateDropRound)
    expect(rounds.size).toBeGreaterThan(1)
    for (const r of rounds) {
      expect(r).toBeGreaterThanOrEqual(1)
      expect(r).toBeLessThanOrEqual(4)
    }
  })

  it('keeps the tick within the round unpredictable either way', () => {
    const ticks = new Set<number>()
    for (let i = 0; i < 40; i++) ticks.add(roomWith(0, 0).crateDropTick)
    expect(ticks.size).toBeGreaterThan(1)
    for (const t of ticks) {
      expect(t).toBeGreaterThanOrEqual(1)
      expect(t).toBeLessThanOrEqual(4)
    }
  })
})
