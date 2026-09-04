/**
 * Who is a potential opponent. The matchmaking bot window is short when the
 * queuer is alone and long when another human might still press Play — and
 * "might" needs a heartbeat: a tab left open on the lobby is not a human.
 *
 * Activity comes from the client's ping (`active: true` while the tab is
 * visible and recently touched). A ping without the flag is an old client;
 * it keeps the pre-flag behaviour and counts as active.
 */
export const IDLE_HUMAN_WINDOW_MS = 90_000

export type PresenceClient = {
  readyState: number
  data: { roomId: string | null; lastActiveAt: number }
}

export function countIdleHumans(
  clients: Iterable<PresenceClient>,
  exclude: PresenceClient | null,
  now: number,
): number {
  let n = 0
  for (const ws of clients) {
    if (ws === exclude || ws.readyState !== 1 || ws.data.roomId !== null) continue
    if (now - ws.data.lastActiveAt < IDLE_HUMAN_WINDOW_MS) n++
  }
  return n
}
