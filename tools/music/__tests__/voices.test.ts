import { describe, it, expect } from 'bun:test'
import { SR, seedRandom, rms } from '../synth.ts'
import { goertzelPower, spectralPeak } from './spectrum.ts'
import { modalString, KOTO, NYLON, breathTone, mutedTrumpet } from '../voices.ts'

const cents = (measured: number, target: number) => 1200 * Math.log2(measured / target)
const peakOf = (buf: Float32Array) => { let m = 0; for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i])); return m }
/** Scan ±0.3 % around the target in 0.01 % steps on the steady part of the tone. */
const fundamental = (buf: Float32Array, target: number) =>
  spectralPeak(buf.subarray(Math.round(0.05 * SR), Math.round(1.5 * SR)), target * 0.997, target * 1.003, target * 1e-4)

describe('modalString', () => {
  it.each([220, 440, 659.26, 783.99])('koto is within 1 cent at %p Hz', (f) => {
    const tone = modalString(f, 1.6, KOTO, seedRandom(1))
    expect(Math.abs(cents(fundamental(tone, f), f))).toBeLessThan(1)
  })

  it.each([110, 220, 440])('nylon is within 1 cent at %p Hz', (f) => {
    const tone = modalString(f, 1.6, NYLON, seedRandom(2))
    expect(Math.abs(cents(fundamental(tone, f), f))).toBeLessThan(1)
  })

  it('is peak-normalised, decays, and is deterministic for a seed', () => {
    const a = modalString(440, 2, KOTO, seedRandom(3))
    const b = modalString(440, 2, KOTO, seedRandom(3))
    expect(peakOf(a)).toBeCloseTo(0.9, 2)
    expect(Array.from(a.subarray(0, 1000))).toEqual(Array.from(b.subarray(0, 1000)))
    const head = rms(a.subarray(0, Math.round(0.1 * SR)))
    const tail = rms(a.subarray(a.length - Math.round(0.1 * SR)))
    expect(20 * Math.log10(head / tail)).toBeGreaterThan(20)
  })

  it('nylon is darker than koto (less energy above 2 kHz)', () => {
    const highRatio = (buf: Float32Array) => {
      let hi = 0, all = 0
      for (let f = 2200; f <= 6000; f += 200) hi += goertzelPower(buf, f)
      for (let f = 200; f <= 6000; f += 200) all += goertzelPower(buf, f)
      return hi / all
    }
    const k = modalString(330, 1, KOTO, seedRandom(4)), ny = modalString(330, 1, NYLON, seedRandom(4))
    expect(highRatio(ny)).toBeLessThan(highRatio(k))
  })
})

describe('breathTone and mutedTrumpet', () => {
  it.each([329.63, 659.26])('breathTone is within 1 cent at %p Hz', (f) => {
    const tone = breathTone(f, 2, seedRandom(5))
    expect(Math.abs(cents(fundamental(tone, f), f))).toBeLessThan(1)
    expect(peakOf(tone)).toBeCloseTo(0.9, 2)
  })

  it.each([493.88, 659.26])('mutedTrumpet is within 1 cent at %p Hz', (f) => {
    const tone = mutedTrumpet(f, 2)
    expect(Math.abs(cents(fundamental(tone, f), f))).toBeLessThan(1)
    expect(peakOf(tone)).toBeCloseTo(0.9, 2)
  })

  it('mutedTrumpet has no energy above 6 kHz worth hearing', () => {
    const tone = mutedTrumpet(440, 1)
    const p6k = goertzelPower(tone, 6600)
    const pf = goertzelPower(tone, 440)
    expect(10 * Math.log10(p6k / pf)).toBeLessThan(-30)
  })

  it('mutedTrumpet is not silent above 4 kHz (harmonics floor of 1)', () => {
    const tone = mutedTrumpet(4100, 0.5)
    expect(peakOf(tone)).toBeCloseTo(0.9, 2)
  })
})
