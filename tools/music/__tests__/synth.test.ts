import { describe, it, expect } from 'bun:test'
import {
  SR, seedRandom, midiToFreq, envelope, mixInto, rms, scaleTo, normalize, renderScore,
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

describe('rms, scaleTo, normalize', () => {
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
