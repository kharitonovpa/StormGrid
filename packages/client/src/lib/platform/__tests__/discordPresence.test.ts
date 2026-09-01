import { describe, it, expect } from 'bun:test'
import { presenceBucketForPhase, presenceText } from '../discordPresence.js'
import type { ClientPhase } from '../../../composables/useGameState.js'

describe('presenceBucketForPhase', () => {
  const cases: Array<[ClientPhase, ReturnType<typeof presenceBucketForPhase>]> = [
    ['lobby', 'lobby'],
    ['queue', 'queue'],
    ['architect_queue', 'queue'],
    ['friend_wait', 'waiting_friend'],
    ['forecast', 'in_match'],
    ['ticking', 'in_match'],
    ['weather', 'in_match'],
    ['finished', null],
    ['watching', 'watching'],
    ['watch_queue', 'watching'],
  ]

  for (const [phase, expected] of cases) {
    it(`maps '${phase}' to ${expected === null ? 'null' : `'${expected}'`}`, () => {
      expect(presenceBucketForPhase(phase)).toBe(expected)
    })
  }
})

describe('presenceText', () => {
  it('returns the Russian text for a known ru bucket', () => {
    expect(presenceText('ru', 'queue')).toBe('Ищет соперника')
  })

  it('returns the English text for a known en bucket', () => {
    expect(presenceText('en', 'queue')).toBe('Looking for an opponent')
  })

  it('falls back to English for a locale outside the dictionary', () => {
    expect(presenceText('fr', 'lobby')).toBe(presenceText('en', 'lobby'))
  })
})
