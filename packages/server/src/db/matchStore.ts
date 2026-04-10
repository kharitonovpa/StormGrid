import { eq, or, desc } from 'drizzle-orm'
import { db, schema } from './index.js'
import type { ReplayData, ReplaySummary, MatchSummary } from '@wheee/shared'

export type MatchRecord = {
  roomId: string
  playerAId: string | null
  playerBId: string | null
  characterA: string
  characterB: string
  winner: string | null
  rounds: number
  durationMs: number
}

export function saveMatch(record: MatchRecord, replay: ReplayData): void {
  db.transaction((tx) => {
    const matchId = crypto.randomUUID()
    const now = new Date()

    tx.insert(schema.matches).values({
      id: matchId,
      roomId: record.roomId,
      playerAId: record.playerAId,
      playerBId: record.playerBId,
      characterA: record.characterA,
      characterB: record.characterB,
      winner: record.winner,
      rounds: record.rounds,
      durationMs: record.durationMs,
      createdAt: now,
    }).run()

    tx.insert(schema.replays).values({
      id: replay.id,
      matchId,
      charA: replay.charA,
      charB: replay.charB,
      winner: replay.winner,
      frameCount: replay.frames.length,
      frames: JSON.stringify(replay.frames),
      createdAt: now,
    }).run()
  })
}

export function listReplays(limit = 20): ReplaySummary[] {
  const rows = db.select({
    id: schema.replays.id,
    charA: schema.replays.charA,
    charB: schema.replays.charB,
    winner: schema.replays.winner,
    frameCount: schema.replays.frameCount,
  })
    .from(schema.replays)
    .orderBy(desc(schema.replays.createdAt))
    .limit(limit)
    .all()

  return rows.map((r) => ({
    id: r.id,
    charA: r.charA as ReplaySummary['charA'],
    charB: r.charB as ReplaySummary['charB'],
    winner: r.winner as ReplaySummary['winner'],
    frameCount: r.frameCount,
  }))
}

export function getReplay(id: string): ReplayData | null {
  const row = db.select().from(schema.replays)
    .where(eq(schema.replays.id, id))
    .get()

  if (!row) return null

  const frames = JSON.parse(row.frames) as ReplayData['frames']
  return {
    id: row.id,
    charA: row.charA as ReplayData['charA'],
    charB: row.charB as ReplayData['charB'],
    winner: row.winner as ReplayData['winner'],
    frameCount: frames.length,
    frames,
  }
}

export function getUserMatches(userId: string, limit = 50): MatchSummary[] {
  const rows = db.select().from(schema.matches)
    .where(or(eq(schema.matches.playerAId, userId), eq(schema.matches.playerBId, userId)))
    .orderBy(desc(schema.matches.createdAt))
    .limit(limit)
    .all()

  return rows.map((r) => ({
    id: r.id,
    roomId: r.roomId,
    characterA: r.characterA,
    characterB: r.characterB,
    winner: r.winner,
    rounds: r.rounds,
    durationMs: r.durationMs,
    playedAt: r.createdAt.toISOString(),
  }))
}
