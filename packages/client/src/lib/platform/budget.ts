/**
 * Awaits `work`, but gives up after `ms` and returns instead of waiting on.
 *
 * A *rejection* still propagates: a platform module that fails outright is a
 * real boot failure and must reach main.ts's "failed to load / Reload" card.
 * Only silence is treated as "carry on without it" — because silence is what a
 * portal actually inflicts on the game. On Yandex Games the portal's CSP
 * blocked the GamePush SDK's own API hosts, so `gp.player.ready` never settled,
 * `init()` never returned, and `#app` stayed empty: a black screen with no
 * message and no way out.
 */
export async function withBudget(work: Promise<unknown>, ms: number, what: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expiry = new Promise<'expired'>((resolve) => {
    timer = setTimeout(() => resolve('expired'), ms)
  })
  try {
    const outcome = await Promise.race([work.then(() => 'done' as const), expiry])
    if (outcome === 'expired') {
      console.warn(`[platform] ${what} did not finish in ${ms}ms — continuing without it`)
      // `work` is still pending and nobody is waiting on it any more. Claim its
      // eventual rejection here so a late failure can't surface as an unhandled
      // rejection long after the game has moved on.
      work.catch(() => {})
    }
  } finally {
    clearTimeout(timer)
  }
}
