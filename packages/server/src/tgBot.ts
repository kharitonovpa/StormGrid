/**
 * What the bot says, decided apart from how it is delivered — the webhook
 * handler stays a thin transport and this stays testable without Telegram.
 */

const TG_APP_LINK = 'https://t.me/wheee_game_bot/play'

const START_REPLY = {
  en: '🌪 wheee — a 1v1 storm duel.\n\nShape the terrain, read the forecast, and let the wind blow your rival off the map. A match takes 1–3 minutes.',
  ru: '🌪 wheee — штормовая дуэль 1 на 1.\n\nМеняй рельеф, читай прогноз — и пусть ветер сдует соперника с карты. Матч занимает 1–3 минуты.',
}

export type TgUpdate = {
  message?: { text?: string; chat?: { id?: number }; from?: { language_code?: string } }
}

export type TgReply = { chatId: number; text: string; replyMarkup?: unknown }

export function replyForUpdate(update: TgUpdate): TgReply | null {
  const msg = update.message
  if (typeof msg?.text !== 'string' || !msg.chat?.id) return null

  if (msg.text.startsWith('/start')) {
    const ru = msg.from?.language_code === 'ru'
    return {
      chatId: msg.chat.id,
      text: ru ? START_REPLY.ru : START_REPLY.en,
      replyMarkup: { inline_keyboard: [[{ text: ru ? '▶️ Играть' : '▶️ Play', url: TG_APP_LINK }]] },
    }
  }

  // For wiring up QUEUE_ALERT_CHAT_ID and the like — echoes where you are.
  if (msg.text.startsWith('/chatid')) {
    return { chatId: msg.chat.id, text: `Ваш chat id: ${msg.chat.id}` }
  }

  return null
}
