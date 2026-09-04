import { eq, sql } from 'drizzle-orm'
import { db, schema } from './index.js'
import { ensureStatsRow } from './matchStore.js'

/**
 * The player's points, kept twice: on the device (every player has one) and on
 * the account (only signed-in players). The account total is the one shown
 * when there is an account, so a guest who signs in starts a fresh count —
 * claiming device points onto an account is a later feature.
 */
export function awardPoints(deviceId: string | null, userId: string | null, earned: number): number {
  return db.transaction((tx) => {
    const now = new Date()
    let deviceTotal = 0
    if (deviceId) {
      tx.insert(schema.devicePoints)
        .values({ deviceId, points: earned, matches: 1, updatedAt: now })
        .onConflictDoUpdate({
          target: schema.devicePoints.deviceId,
          set: {
            points: sql`${schema.devicePoints.points} + ${earned}`,
            matches: sql`${schema.devicePoints.matches} + 1`,
            updatedAt: now,
          },
        })
        .run()
      deviceTotal = tx.select({ p: schema.devicePoints.points })
        .from(schema.devicePoints)
        .where(eq(schema.devicePoints.deviceId, deviceId))
        .get()?.p ?? 0
    }
    if (!userId) return deviceTotal
    ensureStatsRow(tx, userId)
    tx.update(schema.userStats)
      .set({ points: sql`${schema.userStats.points} + ${earned}`, updatedAt: now })
      .where(eq(schema.userStats.userId, userId))
      .run()
    return tx.select({ p: schema.userStats.points })
      .from(schema.userStats)
      .where(eq(schema.userStats.userId, userId))
      .get()?.p ?? 0
  })
}

/** The number the player sees: the account's when signed in, else the device's. */
export function getPoints(deviceId: string | null, userId: string | null): number {
  if (userId) {
    const row = db.select({ p: schema.userStats.points })
      .from(schema.userStats)
      .where(eq(schema.userStats.userId, userId))
      .get()
    if (row) return row.p
  }
  if (!deviceId) return 0
  return db.select({ p: schema.devicePoints.points })
    .from(schema.devicePoints)
    .where(eq(schema.devicePoints.deviceId, deviceId))
    .get()?.p ?? 0
}
