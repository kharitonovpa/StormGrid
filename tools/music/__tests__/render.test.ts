import { describe, it, expect } from 'bun:test'
import { SR, rms } from '../synth.ts'
import { renderLayer } from '../render.ts'

describe('renderLayer', () => {
  it('renders a stereo layer of exactly the loop length, deterministically, with tails wrapped', () => {
    const loopSamples = Math.round(25.2 * SR)
    const a = renderLayer('lobby-music', 'rice', loopSamples, 0.6, 20260905)
    const b = renderLayer('lobby-music', 'rice', loopSamples, 0.6, 20260905)
    expect(a[0].length).toBe(loopSamples)
    expect(a[1].length).toBe(loopSamples)
    expect(Array.from(a[0].subarray(0, 2000))).toEqual(Array.from(b[0].subarray(0, 2000)))
    // The koto's gap-C phrase at beat 33.5–36.5 rings past the loop end and wraps: the
    // first 200 ms carry reverb tail energy, not silence.
    expect(rms(a[0].subarray(0, Math.round(0.2 * SR)))).toBeGreaterThan(0)
    // Left and right differ (pan + decorrelated reverb).
    let diff = 0
    for (let i = 0; i < loopSamples; i += 97) diff += Math.abs(a[0][i] - a[1][i])
    expect(diff).toBeGreaterThan(0)
  })

  it('renders every variant without NaN and with finite peaks', () => {
    for (const baseId of ['lobby-music', 'match-music'] as const) {
      const beats = baseId === 'lobby-music' ? 42 : 28
      const loopSamples = Math.round(25.2 * SR)
      for (const crop of ['rice', 'corn'] as const) {
        const [l, r] = renderLayer(baseId, crop, loopSamples, 25.2 / beats, 1)
        let peak = 0
        for (let i = 0; i < loopSamples; i++) {
          expect(Number.isFinite(l[i]) && Number.isFinite(r[i])).toBe(true)
          peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]))
        }
        expect(peak).toBeGreaterThan(0)
      }
    }
  })
})
