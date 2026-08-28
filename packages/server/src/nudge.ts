import { badgeFor } from '@wheee/shared'
import { selectNudgeCandidates, markNudged, markUnreachable, type NudgeCandidate } from './db/nudgeStore.js'

/**
 * The return reminder: one Telegram message to a player who was here yesterday
 * and has not come back.
 *
 * Telegram is where it starts because it is the only platform with a delivery
 * channel of our own, and because its players already come back an order of
 * magnitude more often than the portals' do — so it is the cheapest honest test
 * of whether a reminder moves D1 at all, before the same loop is built where
 * the traffic actually is.
 *
 * Two rules the text obeys, because the audience is real people:
 * it states only things the server can verify, and it invents no urgency.
 */

const PLAY_LINK = 'https://t.me/wheee_game_bot/play'

export type NudgeStats = {
  name: string
  wins: number
  gamesPlayed: number
  lang: string
  /** Their badge, if the server knows of one. The strongest hook available. */
  streak?: number
}

/** Russian needs three forms; getting it wrong is the tell of a machine. */
function ruPlural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return many
  const mod10 = n % 10
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

export function composeNudge(s: NudgeStats): string {
  const ru = s.lang.toLowerCase().startsWith('ru')

  // A badge beats a scoreline: it is the one thing here that can be lost, and
  // it is already standing rather than something we are asking them to start.
  const streak = s.streak ?? 0
  const badge = streak > 0 ? badgeFor(streak) : null
  if (badge) {
    return ru
      ? `Твой бейдж ${badge} ${streak} всё ещё держится. Одно поражение — и он обнулится. Защитишь?`
      : `Your ${badge} ${streak} badge is still standing. One loss wipes it. Defend it?`
  }

  if (s.wins === 0) {
    // Never "0 wins" — a scoreline of zero reads as a scolding.
    return ru
      ? `Ты провёл ${s.gamesPlayed} ${ruPlural(s.gamesPlayed, 'дуэль', 'дуэли', 'дуэлей')} в wheee, и пока без победы. Шторм переменчив — попробуешь ещё?`
      : `${s.gamesPlayed} duels in wheee so far, and no win yet. The storm turns — one more?`
  }

  return ru
    ? `Твой счёт в wheee: ${s.wins} ${ruPlural(s.wins, 'победа', 'победы', 'побед')} из ${s.gamesPlayed} ${ruPlural(s.gamesPlayed, 'дуэли', 'дуэлей', 'дуэлей')}. Вернёшься за следующей?`
    : `Your wheee record: ${s.wins} ${s.wins === 1 ? 'win' : 'wins'} in ${s.gamesPlayed} duels. Back for another?`
}

export type NudgeSender = (
  chatId: string,
  text: string,
  replyMarkup: unknown,
) => Promise<{ ok: boolean; forbidden: boolean }>

export type NudgePassResult = {
  considered: number
  sent: number
  unreachable: number
  failed: number
  /** Filled instead of sending when the pass is a dry run. */
  preview: { chatId: string; text: string }[]
}

/**
 * One sweep. `dryRun` composes everything and sends nothing, which is how this
 * gets inspected against real players before a single message goes out.
 */
export async function runNudgePass(opts: {
  send: NudgeSender
  cooldownDays: number
  limit?: number
  dryRun: boolean
}): Promise<NudgePassResult> {
  const candidates = selectNudgeCandidates({ cooldownDays: opts.cooldownDays, limit: opts.limit })
  const result: NudgePassResult = {
    considered: candidates.length, sent: 0, unreachable: 0, failed: 0, preview: [],
  }

  for (const c of candidates) {
    const text = composeNudge(c)
    if (opts.dryRun) {
      result.preview.push({ chatId: c.chatId, text })
      continue
    }
    await sendOne(c, text, opts.send, result)
  }

  return result
}

async function sendOne(
  c: NudgeCandidate,
  text: string,
  send: NudgeSender,
  result: NudgePassResult,
): Promise<void> {
  const ru = c.lang.toLowerCase().startsWith('ru')
  const replyMarkup = {
    inline_keyboard: [[{ text: ru ? '▶️ Играть' : '▶️ Play', url: PLAY_LINK }]],
  }

  // Recorded before the attempt: if this process dies mid-send, the player must
  // end up with one message too few rather than one too many.
  markNudged(c.userId)

  const outcome = await send(c.chatId, text, replyMarkup).catch(() => ({ ok: false, forbidden: false }))
  if (outcome.ok) { result.sent++; return }
  if (outcome.forbidden) {
    markUnreachable(c.userId)
    result.unreachable++
    return
  }
  result.failed++
}
