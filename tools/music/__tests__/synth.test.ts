import { describe, it, expect } from 'bun:test'
import {
  SR, seedRandom, midiToFreq, envelope, pluck, sawVoice, breathVoice,
  mixInto, softLimit, rms, scaleTo, normalize, renderScore, spectralPeak,
} from '../synth.ts'

const dB = (ratio: number) => 20 * Math.log10(ratio)

describe('seedRandom', () => {
  it('is deterministic per seed and stays in [0, 1)', () => {
    const a = seedRandom(7), b = seedRandom(7), c = seedRandom(8)
    const sa = [a(), a(), a()], sb = [b(), b(), b()]
    expect(sa).toEqual(sb)
    expect(sa).not.toEqual([c(), c(), c()])
    for (const v of sa) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1) }
  })
})

describe('midiToFreq', () => {
  it('maps A4 to 440 Hz and A3 to 220 Hz', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6)
    expect(midiToFreq(57)).toBeCloseTo(220, 6)
  })
})

describe('envelope', () => {
  it('rises from 0, holds 1, falls back to 0', () => {
    const env = envelope(SR, 0.1, 0.2)
    expect(env.length).toBe(SR)
    expect(env[0]).toBe(0)
    expect(env[Math.floor(SR * 0.5)]).toBeCloseTo(1, 6)
    expect(env[SR - 1]).toBeCloseTo(0, 3)
  })
})

describe('pluck', () => {
  it('rings at the requested pitch within 2 %', () => {
    const tone = pluck(440, 1.0, { brightness: 1, decay: 1.2, rand: seedRandom(1) })
    const steady = tone.subarray(Math.floor(SR * 0.05), Math.floor(SR * 0.8))
    const peak = spectralPeak(steady, 380, 500, 1)
    expect(Math.abs(peak - 440) / 440).toBeLessThan(0.02)
  })

  it('decays: the last 100 ms is at least 40 dB below the first 100 ms', () => {
    const tone = pluck(440, 1.5, { brightness: 1, decay: 0.6, rand: seedRandom(2) })
    const head = rms(tone.subarray(0, Math.floor(SR * 0.1)))
    const tail = rms(tone.subarray(tone.length - Math.floor(SR * 0.1)))
    expect(dB(head / tail)).toBeGreaterThan(40)
  })
})

describe('voices', () => {
  it('sawVoice and breathVoice are peak-normalised and pitched', () => {
    const saw = sawVoice(220, 1.0, { vibratoHz: 5.5, vibratoCents: 0, harmonics: 12, attack: 0.05, release: 0.1 })
    expect(Math.max(...Array.from(saw, Math.abs))).toBeCloseTo(0.9, 2)
    expect(Math.abs(spectralPeak(saw, 180, 260, 1) - 220) / 220).toBeLessThan(0.02)

    const br = breathVoice(196, 1.0, { noise: 0.3, attack: 0.2, release: 0.2, rand: seedRandom(3) })
    expect(Math.max(...Array.from(br, Math.abs))).toBeCloseTo(0.9, 2)
    expect(Math.abs(spectralPeak(br, 160, 240, 1) - 196) / 196).toBeLessThan(0.02)
  })
})

describe('mixInto', () => {
  it('wraps a tail that runs past the end back to the start', () => {
    const dest = new Float32Array(1000)
    const src = new Float32Array(300).fill(1)
    mixInto(dest, src, 900, 0.5)
    expect(dest[899]).toBe(0)
    expect(dest[900]).toBe(0.5)
    expect(dest[999]).toBe(0.5)
    expect(dest[0]).toBe(0.5)
    expect(dest[199]).toBe(0.5)
    expect(dest[200]).toBe(0)
  })
})

describe('softLimit, rms, scaleTo, normalize', () => {
  it('softLimit bounds loud samples and leaves quiet ones alone', () => {
    expect(softLimit(3)).toBeLessThan(1)
    expect(softLimit(-3)).toBeGreaterThan(-1)
    expect(Math.abs(softLimit(0.1) - 0.1)).toBeLessThan(0.002)
  })

  it('scaleTo lands on the target loudness within 0.01 dB', () => {
    const rand = seedRandom(4)
    const noise = Float32Array.from({ length: 10_000 }, () => rand() * 2 - 1)
    const scaled = scaleTo(noise, 0.1)
    expect(Math.abs(dB(rms(scaled) / 0.1))).toBeLessThan(0.01)
  })

  it('normalize sets the absolute peak', () => {
    const buf = Float32Array.from([0.2, -0.5, 0.1])
    expect(Math.max(...Array.from(normalize(buf, 0.9), Math.abs))).toBeCloseTo(0.9, 6)
    expect(Array.from(normalize(new Float32Array(3), 0.9))).toEqual([0, 0, 0])
  })
})

describe('renderScore', () => {
  it('has exactly the loop length and wraps a note that crosses the loop end', () => {
    const loopSamples = SR // a 1 s loop of 4 beats
    const voice = (_freq: number, seconds: number) => new Float32Array(Math.round(seconds * SR)).fill(0.25)
    const out = renderScore([{ beat: 3.5, midi: 60, dur: 1 }], 0.25, loopSamples, voice)
    expect(out.length).toBe(loopSamples)
    expect(out[Math.floor(SR * 0.875) + 10]).toBeCloseTo(0.25, 6) // note start at beat 3.5
    expect(out[10]).toBeCloseTo(0.25, 6) // wrapped tail
    expect(out[Math.floor(SR * 0.5)]).toBe(0) // silence between
  })

  it('applies per-note gain', () => {
    const voice = (_f: number, seconds: number) => new Float32Array(Math.round(seconds * SR)).fill(1)
    const out = renderScore([{ beat: 0, midi: 60, dur: 0.5, gain: 0.3 }], 0.25, SR, voice)
    expect(out[100]).toBeCloseTo(0.3, 6)
  })
})
