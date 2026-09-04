import { describe, it, expect } from 'bun:test'
import { resolveMusicId } from '../audio.js'

describe('resolveMusicId', () => {
  it('falls back to the base track when no crop-specific track is configured', () => {
    expect(resolveMusicId('match-music', 'rice')).toBe('match-music')
    expect(resolveMusicId('match-music', 'wheat')).toBe('match-music')
    expect(resolveMusicId('lobby-music', 'corn')).toBe('lobby-music')
  })

  it('falls back to the base track when no character is given', () => {
    expect(resolveMusicId('match-music')).toBe('match-music')
    expect(resolveMusicId('lobby-music')).toBe('lobby-music')
  })
})
