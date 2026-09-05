import { describe, it, expect } from 'bun:test'
import { resolveMusicId, LOOP_IDS } from '../audio.js'

describe('resolveMusicId', () => {
  it('picks the regional variant for rice and corn', () => {
    expect(resolveMusicId('lobby-music', 'rice')).toBe('lobby-music-rice')
    expect(resolveMusicId('match-music', 'rice')).toBe('match-music-rice')
    expect(resolveMusicId('lobby-music', 'corn')).toBe('lobby-music-corn')
    expect(resolveMusicId('match-music', 'corn')).toBe('match-music-corn')
  })

  it('keeps the base track for wheat', () => {
    expect(resolveMusicId('match-music', 'wheat')).toBe('match-music')
    expect(resolveMusicId('lobby-music', 'wheat')).toBe('lobby-music')
  })

  it('falls back to the base track when no character is given', () => {
    expect(resolveMusicId('match-music')).toBe('match-music')
    expect(resolveMusicId('lobby-music')).toBe('lobby-music')
  })

  it('only ever resolves to a registered loop id', () => {
    for (const base of ['lobby-music', 'match-music'] as const) {
      for (const crop of ['wheat', 'rice', 'corn'] as const) {
        expect(LOOP_IDS).toContain(resolveMusicId(base, crop))
      }
    }
  })
})
