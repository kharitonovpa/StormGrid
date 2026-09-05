/**
 * Spectral analysis helpers used only by the synth tests (pitch/frequency
 * checks on rendered voices) — kept out of the production DSP module
 * (synth.ts), which build-variants.ts also imports.
 */
import { SR } from '../synth.ts'

/** Goertzel power of one frequency — enough for a test's pitch check. */
export function goertzelPower(buf: Float32Array, freq: number): number {
  const w = (2 * Math.PI * freq) / SR
  const coeff = 2 * Math.cos(w)
  let s0 = 0, s1 = 0, s2 = 0
  for (let i = 0; i < buf.length; i++) {
    s0 = buf[i] + coeff * s1 - s2
    s2 = s1
    s1 = s0
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2
}

/** Frequency of maximum Goertzel power scanned from fLo to fHi in stepHz steps. */
export function spectralPeak(buf: Float32Array, fLo: number, fHi: number, stepHz: number): number {
  let best = fLo, bestPower = -1
  for (let f = fLo; f <= fHi; f += stepHz) {
    const p = goertzelPower(buf, f)
    if (p > bestPower) { bestPower = p; best = f }
  }
  return best
}
