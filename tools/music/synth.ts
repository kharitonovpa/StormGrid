/**
 * Core helpers for the crop music layers: sample rate, seeded PRNG, envelope,
 * mixing, loudness and score rendering (instruments live in voices.ts,
 * effects in fx.ts). No I/O here — the build script (build-variants.ts) owns
 * ffmpeg. Everything runs at SR and returns Float32Array mono buffers in
 * [-1, 1] unless stated otherwise.
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
