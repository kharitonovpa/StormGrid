/**
 * Effects for the crop music layers: filters, a Freeverb-style stereo reverb,
 * a ping-pong delay, a Haas widener, a threshold soft clip and equal-power
 * panning. Pure functions on Float32Arrays at SR; wet-only outputs so the
 * caller decides the balance.
 */
import { SR } from './synth.ts'

export type Stereo = [Float32Array, Float32Array]

/** One-pole low-pass, −3 dB at cutoffHz. */
export function onePoleLowpass(buf: Float32Array, cutoffHz: number): Float32Array {
  const a = Math.exp((-2 * Math.PI * cutoffHz) / SR)
  const out = new Float32Array(buf.length)
  let y = 0
  for (let i = 0; i < buf.length; i++) {
    y = (1 - a) * buf[i] + a * y
    out[i] = y
  }
  return out
}

/** RBJ constant-peak-gain band-pass (unity at the centre). */
export function biquadBandpass(buf: Float32Array, centerHz: number, q: number): Float32Array {
  const w0 = (2 * Math.PI * centerHz) / SR
  const alpha = Math.sin(w0) / (2 * q)
  const b0 = alpha, b2 = -alpha
  const a0 = 1 + alpha, a1 = -2 * Math.cos(w0), a2 = 1 - alpha
  const out = new Float32Array(buf.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < buf.length; i++) {
    const x0 = buf[i]
    const y0 = (b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2) / a0
    x2 = x1; x1 = x0; y2 = y1; y1 = y0
    out[i] = y0
  }
  return out
}

export interface ReverbOpts {
  /** Seconds for the tail to fall 60 dB (with damping 0). */
  rt60: number
  /** 0..1 — how much high end each comb pass loses; 0 = none. */
  damping: number
  preDelayMs: number
}

// Freeverb tunings at 44.1 kHz: eight parallel combs, four series all-passes,
// right channel offset by 23 samples for decorrelation.
const COMB_DELAYS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]
const ALLPASS_DELAYS = [556, 441, 341, 225]
const STEREO_SPREAD = 23
const ALLPASS_FEEDBACK = 0.5

function reverbChannel(input: Float32Array, opts: ReverbOpts, spread: number): Float32Array {
  const n = input.length
  const pre = Math.round((opts.preDelayMs / 1000) * SR)
  const out = new Float32Array(n)
  // Combs — feedback per comb chosen so every comb decays 60 dB in rt60 seconds.
  const combs = COMB_DELAYS.map((d) => ({
    buf: new Float32Array(d + spread), idx: 0, store: 0,
    g: Math.pow(10, (-3 * ((d + spread) / SR)) / opts.rt60),
  }))
  const allpasses = ALLPASS_DELAYS.map((d) => ({ buf: new Float32Array(d + spread), idx: 0 }))
  for (let i = 0; i < n; i++) {
    const x = i >= pre ? input[i - pre] : 0
    let acc = 0
    for (const c of combs) {
      const y = c.buf[c.idx]
      c.store = y * (1 - opts.damping) + c.store * opts.damping
      c.buf[c.idx] = x + c.store * c.g
      c.idx = (c.idx + 1) % c.buf.length
      acc += y
    }
    let s = acc
    for (const a of allpasses) {
      const y = a.buf[a.idx]
      const v = s + y * ALLPASS_FEEDBACK
      a.buf[a.idx] = v
      a.idx = (a.idx + 1) % a.buf.length
      s = y - v * ALLPASS_FEEDBACK
    }
    out[i] = s
  }
  return out
}

/** Stereo reverb, wet only, same length as the input — pad the input with silence for the tail. */
export function reverb(inL: Float32Array, inR: Float32Array, opts: ReverbOpts): Stereo {
  const wetL = reverbChannel(inL, opts, 0)
  const wetR = reverbChannel(inR, opts, STEREO_SPREAD)
  // Normalise so a unit impulse yields a wet peak near 1 (eight combs sum ~8).
  const g = 1 / COMB_DELAYS.length
  for (let i = 0; i < wetL.length; i++) { wetL[i] *= g; wetR[i] *= g }
  return [wetL, wetR]
}

/** Ping-pong delay, wet only: left input echoes right first, then alternates. */
export function pingPong(inL: Float32Array, inR: Float32Array, delaySeconds: number, feedback: number, lowpassHz: number): Stereo {
  const n = inL.length
  const d = Math.max(1, Math.round(delaySeconds * SR))
  const outL = new Float32Array(n), outR = new Float32Array(n)
  const lineL = new Float32Array(d), lineR = new Float32Array(d)
  const a = Math.exp((-2 * Math.PI * lowpassHz) / SR)
  let idx = 0, lpL = 0, lpR = 0
  for (let i = 0; i < n; i++) {
    const tapL = lineL[idx], tapR = lineR[idx]
    outL[i] = tapL
    outR[i] = tapR
    // What came out of the right line feeds the left line and vice versa.
    lpL = (1 - a) * (inR[i] + tapR * feedback) + a * lpL
    lpR = (1 - a) * (inL[i] + tapL * feedback) + a * lpR
    lineL[idx] = lpL
    lineR[idx] = lpR
    idx = (idx + 1) % d
  }
  return [outL, outR]
}

/** Haas widening: delays the right channel by `ms`. */
export function haas(left: Float32Array, right: Float32Array, ms: number): Stereo {
  const d = Math.round((ms / 1000) * SR)
  const outR = new Float32Array(right.length)
  for (let i = d; i < right.length; i++) outR[i] = right[i - d]
  return [Float32Array.from(left), outR]
}

/** Identity below `threshold`, tanh-shaped above it, continuous at the knee, bounded by 1. */
export function softClip(x: number, threshold = 0.85): number {
  const ax = Math.abs(x)
  if (ax <= threshold) return x
  const room = 1 - threshold
  const y = threshold + room * Math.tanh((ax - threshold) / room)
  return x < 0 ? -y : y
}

/** Equal-power pan: position −1 = hard left, 0 = centre, +1 = hard right. */
export function pan(mono: Float32Array, position: number): Stereo {
  const angle = ((position + 1) * Math.PI) / 4
  const gl = Math.cos(angle), gr = Math.sin(angle)
  return [Float32Array.from(mono, (v) => v * gl), Float32Array.from(mono, (v) => v * gr)]
}

export function addStereo(dest: Stereo, src: Stereo, gain: number): void {
  for (let i = 0; i < dest[0].length; i++) {
    dest[0][i] += src[0][i] * gain
    dest[1][i] += src[1][i] * gain
  }
}
