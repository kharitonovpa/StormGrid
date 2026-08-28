import { sql, inArray, eq } from 'drizzle-orm'
import { db, schema } from './index.js'

/**
 * The server's copy of the badge streak, per device.
 *
 * It mirrors the client's rules exactly (see the client's lib/streak.ts): the
 * crate seeds, wins grow, a loss wipes, a draw is neutral. Nothing on the wire
 * changes and the client keeps drawing its own copy, so a portal build several
 * versions behind is unaffected — this exists for the one thing a browser
 * cannot do, which is be read while the player is away.
 */

/** Matches the client's cap, and the ceiling the protocol already validates. */
const MAX_STREAK = 9999

export function getDeviceStreak(deviceId: string): number {
  const row = db.select({ streak: schema.deviceStreaks.streak })
    .from(schema.deviceStreaks)
    .where(eq(schema.deviceStreaks.deviceId, deviceId))
    .get()
  return row?.streak ?? 0
}

function put(deviceId: string, streak: number): void {
  const now = new Date()
  db.insert(schema.deviceStreaks)
    .values({ deviceId, streak, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.deviceStreaks.deviceId,
      set: { streak, updatedAt: now },
    })
    .run()
}

/** Picked the crate up. Only ever 0 → 1, like the client's seedStreak. */
export function seedDeviceStreak(deviceId: string): void {
  if (getDeviceStreak(deviceId) > 0) return
  put(deviceId, 1)
}

/** Won. A badge that does not exist cannot grow — the crate is the only door. */
export function growDeviceStreak(deviceId: string): void {
  const current = getDeviceStreak(deviceId)
  if (current === 0) return
  put(deviceId, Math.min(current + 1, MAX_STREAK))
}

/** Lost, other than to a dropped connection. */
export function wipeDeviceStreak(deviceId: string): void {
  if (getDeviceStreak(deviceId) === 0) return
  put(deviceId, 0)
}

/**
 * Take the client's word for a higher number, and keep the higher of the two.
 *
 * Two reasons it has to work this way rather than the server simply winning.
 * Players have carried badges in localStorage for weeks, and they must not
 * silently lose them the day the server starts keeping its own copy. And the
 * rescue is bought with a rewarded ad the client watches, so until that has a
 * message of its own the two copies would otherwise disagree forever after any
 * rescue. The number is cosmetic — forging it fools nobody but its owner — so
 * believing a larger one costs nothing.
 */
export function adoptDeviceStreak(deviceId: string, reported: number): number {
  const current = getDeviceStreak(deviceId)
  const sane = Number.isFinite(reported) ? Math.min(Math.max(Math.floor(reported), 0), MAX_STREAK) : 0
  if (sane <= current) return current
  put(deviceId, sane)
  return sane
}

/**
 * The best badge across every device a player has been seen on — one person may
 * open the game on a phone and a laptop, and the reminder should name the badge
 * they would actually be sorry to lose.
 */
export function bestStreakForDevices(deviceIds: string[]): number {
  if (deviceIds.length === 0) return 0
  const row = db.select({ best: sql<number>`COALESCE(MAX(${schema.deviceStreaks.streak}), 0)` })
    .from(schema.deviceStreaks)
    .where(inArray(schema.deviceStreaks.deviceId, deviceIds))
    .get()
  return row?.best ?? 0
}
