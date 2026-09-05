import { describe, it, expect } from 'bun:test'
import { SR, rms } from '../synth.ts'
import { onePoleLowpass, biquadBandpass, reverb, pingPong, haas, softClip, pan, addStereo } from '../fx.ts'

const sine = (freq: number, seconds: number) => Float32Array.from({ length: Math.round(seconds * SR) }, (_, i) => Math.sin((2 * Math.PI * freq * i) / SR))
const dB = (ratio: number) => 20 * Math.log10(ratio)

describe('filters', () => {
  it('onePoleLowpass passes low tones and attenuates high ones', () => {
    const lo = onePoleLowpass(sine(100, 0.5), 1000)
    const hi = onePoleLowpass(sine(8000, 0.5), 1000)
    expect(dB(rms(lo) / rms(sine(100, 0.5)))).toBeGreaterThan(-1)
    expect(dB(rms(hi) / rms(sine(8000, 0.5)))).toBeLessThan(-12)
  })

  it('biquadBandpass passes the centre and rejects a tone two octaves away', () => {
    const inBand = biquadBandpass(sine(900, 0.5), 900, 4)
    const outBand = biquadBandpass(sine(3600, 0.5), 900, 4)
    expect(dB(rms(inBand) / rms(sine(900, 0.5)))).toBeGreaterThan(-2)
    expect(dB(rms(outBand) / rms(sine(3600, 0.5)))).toBeLessThan(-15)
  })
})

describe('reverb', () => {
  it('decays 60 dB in about the requested time (Schroeder integration, damping 0)', () => {
    const n = Math.round(7 * SR)
    const impulse = new Float32Array(n); impulse[0] = 1
    const [wetL] = reverb(impulse, impulse, { rt60: 5, damping: 0, preDelayMs: 0 })
    // Backward energy integration → decay curve; RT60 from the −5…−25 dB slope.
    const edc = new Float64Array(n)
    let acc = 0
    for (let i = n - 1; i >= 0; i--) { acc += wetL[i] * wetL[i]; edc[i] = acc }
    const level = (i: number) => 10 * Math.log10(edc[i] / edc[0])
    let t5 = -1, t25 = -1
    for (let i = 0; i < n; i++) {
      if (t5 < 0 && level(i) <= -5) t5 = i
      if (t25 < 0 && level(i) <= -25) { t25 = i; break }
    }
    const rt60 = (3 * (t25 - t5)) / SR
    expect(rt60).toBeGreaterThan(4)
    expect(rt60).toBeLessThan(6)
  })

  it('keeps the input length and respects the pre-delay', () => {
    const n = SR
    const impulse = new Float32Array(n); impulse[0] = 1
    const [wetL, wetR] = reverb(impulse, impulse, { rt60: 2, damping: 0.3, preDelayMs: 25 })
    expect(wetL.length).toBe(n)
    expect(wetR.length).toBe(n)
    const preDelay = Math.round(0.025 * SR)
    for (let i = 0; i < preDelay - 1; i++) expect(wetL[i]).toBe(0)
    let energyAfter = 0
    for (let i = preDelay; i < n; i++) energyAfter += wetL[i] * wetL[i]
    expect(energyAfter).toBeGreaterThan(0)
  })
})

describe('pingPong', () => {
  it('echoes left input on the right after one delay and back on the left after two', () => {
    const n = SR
    const inL = new Float32Array(n); inL[0] = 1
    const inR = new Float32Array(n)
    const [outL, outR] = pingPong(inL, inR, 0.1, 0.5, 20000)
    const d = Math.round(0.1 * SR)
    expect(Math.abs(outR[d])).toBeGreaterThan(0.3)
    expect(Math.abs(outL[2 * d])).toBeGreaterThan(0.1)
    for (let i = 0; i < d; i++) { expect(outL[i]).toBe(0); expect(outR[i]).toBe(0) }
  })
})

describe('haas, softClip, pan, addStereo', () => {
  it('haas delays only the right channel', () => {
    const l = new Float32Array(SR); l[0] = 1
    const r = new Float32Array(SR); r[0] = 1
    const [outL, outR] = haas(l, r, 12)
    expect(outL[0]).toBe(1)
    expect(outR[0]).toBe(0)
    expect(outR[Math.round(0.012 * SR)]).toBe(1)
  })

  it('softClip is the identity below the threshold and bounded above', () => {
    expect(softClip(0.5)).toBe(0.5)
    expect(softClip(-0.84)).toBe(-0.84)
    expect(softClip(3)).toBeLessThan(1)
    expect(softClip(3)).toBeGreaterThan(0.85)
    expect(softClip(-3)).toBeGreaterThan(-1)
    // continuous at the threshold
    expect(Math.abs(softClip(0.8501) - 0.85)).toBeLessThan(0.001)
  })

  it('pan is equal-power', () => {
    const mono = Float32Array.from([1, 1])
    const [cl, cr] = pan(mono, 0)
    expect(cl[0]).toBeCloseTo(Math.SQRT1_2, 5)
    expect(cr[0]).toBeCloseTo(Math.SQRT1_2, 5)
    const [ll, lr] = pan(mono, -1)
    expect(ll[0]).toBeCloseTo(1, 5)
    expect(lr[0]).toBeCloseTo(0, 5)
  })

  it('addStereo accumulates with gain', () => {
    const dest: [Float32Array, Float32Array] = [new Float32Array(2), new Float32Array(2)]
    addStereo(dest, [Float32Array.from([1, 2]), Float32Array.from([3, 4])], 0.5)
    expect(Array.from(dest[0])).toEqual([0.5, 1])
    expect(Array.from(dest[1])).toEqual([1.5, 2])
  })
})
