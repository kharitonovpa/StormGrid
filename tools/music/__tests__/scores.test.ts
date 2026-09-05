import { describe, it, expect } from 'bun:test'
import { BASES, PARTS, isInScale, phrasesOf } from '../scores.ts'

const BASE_IDS = ['lobby-music', 'match-music'] as const
const CROPS = ['rice', 'corn'] as const

describe('ornament scores', () => {
  it('keep every onset at least 0.4 beat away from every base attack', () => {
    for (const baseId of BASE_IDS) {
      const base = BASES[baseId]
      for (const crop of CROPS) {
        for (const part of PARTS[baseId][crop]) {
          for (const note of part.notes) {
            const beat = ((note.beat % base.beats) + base.beats) % base.beats
            for (const attack of base.attacks) {
              const d = Math.min(Math.abs(beat - attack), base.beats - Math.abs(beat - attack))
              // Floating point: e.g. 24.4 - 24 is 0.3999999999999986, not 0.4.
              expect(d).toBeGreaterThanOrEqual(0.4 - 1e-9)
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

  it('keeps every trumpet note inside mutedTrumpet\'s valid range (midi <= 91)', () => {
    for (const baseId of BASE_IDS) for (const crop of CROPS) for (const part of PARTS[baseId][crop]) {
      if (part.voice !== 'trumpet') continue
      for (const note of part.notes) expect(note.midi).toBeLessThanOrEqual(91)
    }
  })

  it('isInScale compares pitch classes', () => {
    expect(isInScale(64, BASES['lobby-music'].scale)).toBe(true)   // E4
    expect(isInScale(65, BASES['lobby-music'].scale)).toBe(false)  // F4
    expect(isInScale(60, BASES['match-music'].scale)).toBe(true)   // C4
    expect(isInScale(61, BASES['match-music'].scale)).toBe(false)  // C#4
  })
})

describe('phrasesOf', () => {
  it('groups a run of notes and splits on a gap longer than 1.5 beats', () => {
    const part = {
      voice: 'koto' as const, pan: 0, level: 1, reverbSend: 0, delaySend: 0,
      notes: [
        { beat: 1, midi: 64, dur: 1 }, { beat: 1.5, midi: 67, dur: 1 }, { beat: 2.5, midi: 69, dur: 1 },
        { beat: 9, midi: 71, dur: 1 }, { beat: 9.5, midi: 74, dur: 1 },
      ],
    }
    const phrases = phrasesOf(part)
    expect(phrases.map((p) => p.key)).toEqual(['koto@1', 'koto@9'])
    expect(phrases.map((p) => p.notes.length)).toEqual([3, 2])
  })

  it('covers every note of every part exactly once', () => {
    for (const baseId of BASE_IDS) for (const crop of CROPS) for (const part of PARTS[baseId][crop]) {
      const grouped = phrasesOf(part).flatMap((p) => p.notes)
      expect(grouped.length).toBe(part.notes.length)
      expect(new Set(grouped).size).toBe(part.notes.length)
    }
  })
})
