import { describe, it, expect } from 'bun:test'
import { replyForUpdate } from '../tgBot.js'
import { createQueueAlert } from '../queueAlert.js'

describe('replyForUpdate — bot command routing', () => {
  it('answers /start with the pitch and a Play button', () => {
    const r = replyForUpdate({ message: { text: '/start', chat: { id: 42 }, from: { language_code: 'en' } } })!
    expect(r.chatId).toBe(42)
    expect(r.text).toContain('wheee')
    expect(JSON.stringify(r.replyMarkup)).toContain('t.me')
  })

  it('answers /start in Russian for ru clients', () => {
    const r = replyForUpdate({ message: { text: '/start', chat: { id: 42 }, from: { language_code: 'ru' } } })!
    expect(r.text).toContain('дуэль')
  })

  it('answers /chatid with the chat id itself', () => {
    const r = replyForUpdate({ message: { text: '/chatid', chat: { id: 777 } } })!
    expect(r.chatId).toBe(777)
    expect(r.text).toContain('777')
  })

  it('stays silent on anything else', () => {
    expect(replyForUpdate({ message: { text: 'hello', chat: { id: 1 } } })).toBeNull()
    expect(replyForUpdate({})).toBeNull()
  })
})

describe('createQueueAlert — lone-waiter notifications', () => {
  it('sends a message naming the waiter and the window', () => {
    const sent: { chatId: string; text: string }[] = []
    const alert = createQueueAlert({
      chatId: '99',
      cooldownMs: 60_000,
      send: (chatId, text) => { sent.push({ chatId, text }) },
      now: () => 1_000,
    })
    alert({ name: 'ovi8x', waitMs: 30_000 })
    expect(sent).toHaveLength(1)
    expect(sent[0].chatId).toBe('99')
    expect(sent[0].text).toContain('ovi8x')
    expect(sent[0].text).toContain('30')
  })

  it('swallows repeats inside the cooldown and speaks again after it', () => {
    const sent: string[] = []
    let t = 0
    const alert = createQueueAlert({
      chatId: '99',
      cooldownMs: 60_000,
      send: (_c, text) => { sent.push(text) },
      now: () => t,
    })
    alert({ name: 'a', waitMs: 8_000 })
    t = 30_000
    alert({ name: 'b', waitMs: 8_000 })
    expect(sent).toHaveLength(1)
    t = 61_000
    alert({ name: 'c', waitMs: 8_000 })
    expect(sent).toHaveLength(2)
    expect(sent[1]).toContain('c')
  })

  it('is a no-op without a chat id', () => {
    const sent: string[] = []
    const alert = createQueueAlert({
      chatId: '',
      cooldownMs: 0,
      send: (_c, text) => { sent.push(text) },
      now: () => 0,
    })
    alert({ name: 'a', waitMs: 8_000 })
    expect(sent).toHaveLength(0)
  })
})
