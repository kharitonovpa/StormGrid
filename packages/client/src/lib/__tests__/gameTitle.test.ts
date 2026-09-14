import { describe, it, expect } from 'bun:test'
import { gameTitle, usesCatalogTitle } from '../gameTitle.js'

describe('gameTitle', () => {
  it('keeps the bare brand outside the portals', () => {
    for (const p of ['web', 'telegram', 'discord', 'itch', '']) {
      expect(gameTitle(p, 'en')).toEqual({ name: 'wheee', subtitle: null, full: 'wheee' })
      expect(gameTitle(p, 'ru')).toEqual({ name: 'wheee', subtitle: null, full: 'wheee' })
    }
  })

  it('spells the Yandex catalog title per language on portal builds', () => {
    for (const p of ['yandex', 'gamepush']) {
      expect(gameTitle(p, 'en').full).toBe('Wheee! Storm Tactics')
      expect(gameTitle(p, 'ru').full).toBe('Wheee! Штормовая тактика')
    }
  })

  it('splits the portal title into heading and subtitle that recompose exactly', () => {
    const t = gameTitle('yandex', 'ru')
    expect(t.name).toBe('Wheee!')
    expect(t.subtitle).toBe('Штормовая тактика')
    expect(`${t.name} ${t.subtitle}`).toBe(t.full)
  })

  it('falls back to English for a language the catalog does not list', () => {
    expect(gameTitle('gamepush', 'tr').full).toBe('Wheee! Storm Tactics')
  })

  it('names the platforms that carry the catalog title', () => {
    expect(usesCatalogTitle('yandex')).toBe(true)
    expect(usesCatalogTitle('gamepush')).toBe(true)
    expect(usesCatalogTitle('web')).toBe(false)
  })
})
