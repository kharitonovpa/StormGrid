import { eq, or, desc, asc, sql } from 'drizzle-orm'
import { db, schema } from './index.js'
import type { ReplayData, ReplaySummary, MatchSummary, PlayerLeaderboardEntry, WatcherLeaderboardEntry, WatcherScoreEntry, Paginated } from '@wheee/shared'

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

/* ── Stats ── */

function ensureStats(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], userId: string) {
  const existing = tx.select({ userId: schema.userStats.userId })
    .from(schema.userStats)
    .where(eq(schema.userStats.userId, userId))
    .get()
  if (!existing) {
    tx.insert(schema.userStats).values({
      userId,
      wins: 0, losses: 0, draws: 0,
      watcherScore: 0, gamesPlayed: 0,
      updatedAt: new Date(),
    }).run()
  }
}

export function updatePlayerStats(
  playerAId: string | null,
  playerBId: string | null,
  winner: string,
): void {
  db.transaction((tx) => {
    const now = new Date()
    for (const [uid, side] of [[playerAId, 'A'], [playerBId, 'B']] as const) {
      if (!uid) continue
      ensureStats(tx, uid)
      const won = winner === side
      const drew = winner === 'draw'
      tx.update(schema.userStats)
        .set({
          wins: won ? sql`${schema.userStats.wins} + 1` : schema.userStats.wins,
          losses: !won && !drew ? sql`${schema.userStats.losses} + 1` : schema.userStats.losses,
          draws: drew ? sql`${schema.userStats.draws} + 1` : schema.userStats.draws,
          gamesPlayed: sql`${schema.userStats.gamesPlayed} + 1`,
          updatedAt: now,
        })
        .where(eq(schema.userStats.userId, uid))
        .run()
    }
  })
}

export function updateWatcherStats(entries: WatcherScoreEntry[]): void {
  if (entries.length === 0) return
  db.transaction((tx) => {
    const now = new Date()
    for (const { userId, score } of entries) {
      ensureStats(tx, userId)
      tx.update(schema.userStats)
        .set({
          watcherScore: sql`${schema.userStats.watcherScore} + ${score}`,
          updatedAt: now,
        })
        .where(eq(schema.userStats.userId, userId))
        .run()
    }
  })
}

/* ── Leaderboard ── */

export function getPlayerLeaderboard(limit = 20, offset = 0): Paginated<PlayerLeaderboardEntry> {
  const items = db.select({
    userId: schema.userStats.userId,
    name: schema.users.name,
    avatar: schema.users.avatar,
    wins: schema.userStats.wins,
    losses: schema.userStats.losses,
    draws: schema.userStats.draws,
    gamesPlayed: schema.userStats.gamesPlayed,
  })
    .from(schema.userStats)
    .innerJoin(schema.users, eq(schema.userStats.userId, schema.users.id))
    .where(sql`${schema.userStats.gamesPlayed} > 0`)
    .orderBy(desc(schema.userStats.wins), desc(schema.userStats.gamesPlayed), asc(schema.userStats.userId))
    .limit(limit)
    .offset(offset)
    .all()

  const { total } = db.select({ total: sql<number>`count(*)` })
    .from(schema.userStats)
    .where(sql`${schema.userStats.gamesPlayed} > 0`)
    .get()!

  return { items, total }
}

export function getWatcherLeaderboard(limit = 20, offset = 0): Paginated<WatcherLeaderboardEntry> {
  const items = db.select({
    userId: schema.userStats.userId,
    name: schema.users.name,
    avatar: schema.users.avatar,
    watcherScore: schema.userStats.watcherScore,
  })
    .from(schema.userStats)
    .innerJoin(schema.users, eq(schema.userStats.userId, schema.users.id))
    .where(sql`${schema.userStats.watcherScore} > 0`)
    .orderBy(desc(schema.userStats.watcherScore), asc(schema.userStats.userId))
    .limit(limit)
    .offset(offset)
    .all()

  const { total } = db.select({ total: sql<number>`count(*)` })
    .from(schema.userStats)
    .where(sql`${schema.userStats.watcherScore} > 0`)
    .get()!

  return { items, total }
}
