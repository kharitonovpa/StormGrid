/**
 * Pure-function DSP for the crop music layers. No I/O here — the build script
 * (build-variants.ts) owns ffmpeg. Everything runs at SR and returns
 * Float32Array mono buffers in [-1, 1] unless stated otherwise.
 */

export const SR = 44100

/** mulberry32 — a small seeded PRNG so a build is reproducible sample for sample. */
export function seedRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/** Linear attack, sustain at 1, linear release; release is measured from the end. */
export function envelope(n: number, attackSeconds: number, releaseSeconds: number): Float32Array {
  const env = new Float32Array(n)
  const a = Math.max(1, Math.round(attackSeconds * SR))
  const r = Math.max(1, Math.round(releaseSeconds * SR))
  for (let i = 0; i < n; i++) {
    const up = Math.min(1, i / a)
    const down = Math.min(1, (n - 1 - i) / r)
    env[i] = Math.min(up, down)
  }
  return env
}

export interface PluckOpts {
  /** 1 = raw white-noise excitation (koto); lower values pre-smooth it (nylon guitar). */
  brightness: number
  /** Seconds for the string to fall 60 dB. */
  decay: number
  rand?: () => number
}

/** Karplus–Strong plucked string: a noise burst circulating through a two-point average. */
export function pluck(freq: number, seconds: number, opts: PluckOpts): Float32Array {
  const rand = opts.rand ?? Math.random
  const n = Math.round(seconds * SR)
  const period = Math.max(2, Math.round(SR / freq))
  const line = new Float32Array(period)
  let prev = 0
  for (let i = 0; i < period; i++) {
    const white = rand() * 2 - 1
    line[i] = white * opts.brightness + prev * (1 - opts.brightness)
    prev = line[i]
  }
  // Each delay-line slot is refreshed once per period, i.e. decay·freq times
  // in `decay` seconds; g is the per-refresh gain that reaches −60 dB by then.
  const g = Math.pow(0.001, 1 / (opts.decay * freq))
  const out = new Float32Array(n)
  let j = 0
  for (let i = 0; i < n; i++) {
    const cur = line[j]
    const next = line[(j + 1) % period]
    out[i] = cur
    line[j] = (cur + next) * 0.5 * g
    j = (j + 1) % period
  }
  return out
}

export interface SawOpts {
  vibratoHz: number
  vibratoCents: number
  /** Number of harmonics summed (1/k amplitudes) — keeps the top band-limited. */
  harmonics: number
  attack: number
  release: number
}

/** Additive saw with vibrato and an envelope — the "trumpet" third. Peak 0.9. */
export function sawVoice(freq: number, seconds: number, opts: SawOpts): Float32Array {
  const n = Math.round(seconds * SR)
  const out = new Float32Array(n)
  const env = envelope(n, opts.attack, opts.release)
  const depth = Math.pow(2, opts.vibratoCents / 1200) - 1
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const f = freq * (1 + depth * Math.sin(2 * Math.PI * opts.vibratoHz * t))
    phase += (2 * Math.PI * f) / SR
    let s = 0
    for (let k = 1; k <= opts.harmonics; k++) s += Math.sin(k * phase) / k
    out[i] = s * env[i]
  }
  return normalize(out, 0.9)
}

export interface BreathOpts {
  /** Share of resonant noise mixed with the sine, 0..1. */
  noise: number
  attack: number
  release: number
  rand?: () => number
}

/** A sine with a whisper of noise resonating at the same pitch — the long rice tone. Peak 0.9. */
export function breathVoice(freq: number, seconds: number, opts: BreathOpts): Float32Array {
  const rand = opts.rand ?? Math.random
  const n = Math.round(seconds * SR)
  const out = new Float32Array(n)
  const env = envelope(n, opts.attack, opts.release)
  // Two-pole resonator (constant-peak-gain band-pass) tuned to freq, Q ≈ 40.
  const q = 40
  const w0 = (2 * Math.PI * freq) / SR
  const alpha = Math.sin(w0) / (2 * q)
  const b0 = alpha, b2 = -alpha
  const a0 = 1 + alpha, a1 = -2 * Math.cos(w0), a2 = 1 - alpha
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  let phase = 0
  for (let i = 0; i < n; i++) {
    const x0 = rand() * 2 - 1
    const y0 = (b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2) / a0
    x2 = x1; x1 = x0; y2 = y1; y1 = y0
    phase += w0
    out[i] = (Math.sin(phase) * (1 - opts.noise) + y0 * opts.noise * 4) * env[i]
  }
  return normalize(out, 0.9)
}

/** Add `src · gain` into `dest` starting at `offset`; samples past the end wrap to the start. */
export function mixInto(dest: Float32Array, src: Float32Array, offset: number, gain: number): void {
  const len = dest.length
  let j = ((Math.round(offset) % len) + len) % len
  for (let i = 0; i < src.length; i++) {
    dest[j] += src[i] * gain
    j++
    if (j === len) j = 0
  }
}

export function softLimit(x: number): number {
  return Math.tanh(x)
}

export function rms(buf: Float32Array): number {
  let s = 0
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]
  return buf.length ? Math.sqrt(s / buf.length) : 0
}

/** A copy scaled so its RMS equals `targetRms` (silence stays silent). */
export function scaleTo(buf: Float32Array, targetRms: number): Float32Array {
  const r = rms(buf)
  const g = r > 0 ? targetRms / r : 1
  return Float32Array.from(buf, (v) => v * g)
}

/** A copy scaled so its absolute peak equals `peak` (silence stays silent). */
export function normalize(buf: Float32Array, peak: number): Float32Array {
  let max = 0
  for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]))
  const g = max > 0 ? peak / max : 1
  return Float32Array.from(buf, (v) => v * g)
}

export interface Note {
  /** Position in beats from the loop start; fractions allowed (strum stagger). */
  beat: number
  midi: number
  /** Nominal length in beats — voices may ring past it; tails wrap. */
  dur: number
  gain?: number
}

export type Voice = (freq: number, seconds: number) => Float32Array

/** Render notes onto a loop-length buffer; anything past the loop end wraps to its start. */
export function renderScore(notes: Note[], beatSeconds: number, loopSamples: number, voice: Voice): Float32Array {
  const out = new Float32Array(loopSamples)
  for (const note of notes) {
    const tone = voice(midiToFreq(note.midi), note.dur * beatSeconds)
    mixInto(out, tone, note.beat * beatSeconds * SR, note.gain ?? 1)
  }
  return out
}
