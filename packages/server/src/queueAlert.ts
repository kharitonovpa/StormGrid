/**
 * Pings the developer's Telegram when a player starts waiting alone in the
 * queue — a short window in which a human can still jump in and turn the
 * match into real PvP. Off unless QUEUE_ALERT_CHAT_ID is set.
 */

export type LoneWaiterInfo = { name: string; waitMs: number }

export type QueueAlertDeps = {
  chatId: string
  cooldownMs: number
  send: (chatId: string, text: string) => void
  now: () => number
}

export function createQueueAlert(deps: QueueAlertDeps): (info: LoneWaiterInfo) => void {
  if (!deps.chatId) return () => {}

  let lastSentAt = -Infinity
  return (info) => {
    const t = deps.now()
    if (t - lastSentAt < deps.cooldownMs) return
    lastSentAt = t
    const secs = Math.round(info.waitMs / 1000)
    deps.send(deps.chatId, `🎮 ${info.name} ждёт соперника в очереди — окно ${secs}с`)
  }
}
