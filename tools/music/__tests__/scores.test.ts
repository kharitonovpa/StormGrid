import { describe, it, expect } from 'bun:test'
import { BASES, PARTS, isInScale } from '../scores.ts'

const BASE_IDS = ['lobby-music', 'match-music'] as const
const CROPS = ['rice', 'corn'] as const

describe('ornament scores', () => {
  it('keep every onset at least a quarter beat away from every base attack', () => {
    for (const baseId of BASE_IDS) {
      const base = BASES[baseId]
      for (const crop of CROPS) {
        for (const part of PARTS[baseId][crop]) {
          for (const note of part.notes) {
            const beat = ((note.beat % base.beats) + base.beats) % base.beats
            for (const attack of base.attacks) {
              const d = Math.min(Math.abs(beat - attack), base.beats - Math.abs(beat - attack))
              expect(d).toBeGreaterThanOrEqual(0.25)
            }
          }
        }
      }
    }
  })

  it('stay in the base\'s pentatonic scale and inside the loop', () => {
    for (const baseId of BASE_IDS) {
      const base = BASES[baseId]
      for (const crop of CROPS) {
        for (const part of PARTS[baseId][crop]) {
          expect(part.notes.length).toBeGreaterThan(0)
          for (const note of part.notes) {
            expect(isInScale(note.midi, base.scale)).toBe(true)
            expect(note.beat).toBeGreaterThanOrEqual(0)
            expect(note.beat).toBeLessThan(base.beats)
            expect(note.gain ?? 1).toBeGreaterThan(0)
            expect(note.gain ?? 1).toBeLessThanOrEqual(1)
          }
        }
      }
    }
  })

  it('give every part sane mix parameters', () => {
    for (const baseId of BASE_IDS) for (const crop of CROPS) for (const part of PARTS[baseId][crop]) {
      expect(Math.abs(part.pan)).toBeLessThanOrEqual(1)
      expect(part.level).toBeGreaterThan(0)
      expect(part.level).toBeLessThanOrEqual(1)
      expect(part.reverbSend).toBeGreaterThanOrEqual(0)
      expect(part.reverbSend).toBeLessThanOrEqual(1)
      expect(part.delaySend).toBeGreaterThanOrEqual(0)
      expect(part.delaySend).toBeLessThanOrEqual(1)
    }
  })

  it('isInScale compares pitch classes', () => {
    expect(isInScale(64, BASES['lobby-music'].scale)).toBe(true)   // E4
    expect(isInScale(65, BASES['lobby-music'].scale)).toBe(false)  // F4
    expect(isInScale(60, BASES['match-music'].scale)).toBe(true)   // C4
    expect(isInScale(61, BASES['match-music'].scale)).toBe(false)  // C#4
  })
})
