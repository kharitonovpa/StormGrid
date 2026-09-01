import type { ClientPhase } from '../../composables/useGameState'

/**
 * Coarse buckets shown in the Discord Rich Presence card. Several
 * `ClientPhase` values fold into one bucket on purpose — `forecast` /
 * `ticking` / `weather` are sub-phases of a single match and would otherwise
 * bounce `setActivity` on every tick.
 */
export type PresenceBucket = 'lobby' | 'queue' | 'waiting_friend' | 'in_match' | 'watching'

const PHASE_TO_BUCKET: Record<ClientPhase, PresenceBucket | null> = {
  lobby: 'lobby',
  queue: 'queue',
  architect_queue: 'queue',
  friend_wait: 'waiting_friend',
  forecast: 'in_match',
  ticking: 'in_match',
  weather: 'in_match',
  // `finished` is brief (seconds) and always followed by another phase —
  // leave the presence card on whatever it last showed rather than churn it.
  finished: null,
  watching: 'watching',
  watch_queue: 'watching',
}

export function presenceBucketForPhase(phase: ClientPhase): PresenceBucket | null {
  return PHASE_TO_BUCKET[phase]
}

const PRESENCE_TEXT: Record<'en' | 'ru', Record<PresenceBucket, string>> = {
  en: {
    lobby: 'In the lobby',
    queue: 'Looking for an opponent',
    waiting_friend: 'Waiting for a friend',
    in_match: 'In a match',
    watching: 'Watching a replay',
  },
  ru: {
    lobby: 'В лобби',
    queue: 'Ищет соперника',
    waiting_friend: 'Ждёт друга',
    in_match: 'В матче',
    watching: 'Смотрит повтор',
  },
}

/**
 * `locale` comes from the Discord SDK's `userSettingsGetLocale()`, which
 * returns an arbitrary BCP-47 tag (`en-US`, `pt-BR`, ...) — callers are
 * expected to have already taken the language subtag (`locale.split('-')[0]`)
 * the way `discord.ts` already does for the rest of the adapter. Anything
 * outside `{en, ru}` falls back to English rather than throwing.
 */
export function presenceText(locale: string, bucket: PresenceBucket): string {
  const dict = locale === 'ru' ? PRESENCE_TEXT.ru : PRESENCE_TEXT.en
  return dict[bucket]
}
