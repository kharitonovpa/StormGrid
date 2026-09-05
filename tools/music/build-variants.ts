#!/usr/bin/env bun
/**
 * Build the rice and corn versions of the two music loops.
 *
 *   bun run music:build                          → all four into packages/client/public/sounds
 *   MUSIC_OUT=/tmp/x bun run music:build         → write elsewhere (listening rounds)
 *   MUSIC_ONLY=lobby-music-rice bun run music:build → one file
 *
 * Decodes the base with ffmpeg, renders the crop layer (render.ts — seeded, so a
 * rebuild is sample-identical), balances every ornament phrase against the base's
 * own level in that phrase's window, matches the output loudness to the base,
 * soft-clips above 0.85, asserts everything and only then encodes 128 kbps MP3.
 * Tune with PHRASE_DB below, or by editing scores.ts / voices.ts, and rebuild.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { SR, rms } from './synth.ts'
import { softClip } from './fx.ts'
import { renderLayer, type PhraseGains } from './render.ts'
import { BASES, PARTS, phrasesOf, type BaseId, type Crop } from './scores.ts'

const ROOT = resolve(import.meta.dir, '../..')
const SOUNDS = resolve(ROOT, 'packages/client/public/sounds')
const OUT_DIR = process.env.MUSIC_OUT ?? SOUNDS
const ONLY = process.env.MUSIC_ONLY
const SEED = 20260905
/**
 * How loud each ornament phrase sits against the base inside its own window.
 * One number for the whole layer does not work: the base's level differs by
 * ~15 dB between its gaps, so a whole-loop RMS match left some runs level with
 * the base and others inaudible. This is the knob for "can I hear the koto".
 */
const PHRASE_DB = Number(process.env.MUSIC_PHRASE_DB ?? -6)
/** Peak the mix must stay under; the target backs off 1 dB at a time until it does. */
const PEAK_CEILING = 0.9
const MAX_BACKOFF_DB = 8
/** Bounds on the automatic per-phrase correction, so one odd window cannot shout. */
const GAIN_MIN = 0.2, GAIN_MAX = 12
const CROPS: Crop[] = ['rice', 'corn']

function decode(file: string): { left: Float32Array; right: Float32Array } {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '2', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 })
  if (r.error || r.status !== 0) throw new Error(`ffmpeg decode failed for ${file}: ${r.error?.message ?? r.stderr}`)
  const bytes = new Uint8Array(r.stdout.byteLength)
  bytes.set(r.stdout)
  const inter = new Float32Array(bytes.buffer, 0, bytes.byteLength >> 2)
  const n = inter.length / 2
  const left = new Float32Array(n), right = new Float32Array(n)
  for (let i = 0; i < n; i++) { left[i] = inter[2 * i]; right[i] = inter[2 * i + 1] }
  return { left, right }
}

function encode(file: string, left: Float32Array, right: Float32Array): void {
  const inter = new Float32Array(left.length * 2)
  for (let i = 0; i < left.length; i++) { inter[2 * i] = left[i]; inter[2 * i + 1] = right[i] }
  const r = spawnSync('ffmpeg', [
    '-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', 'pipe:0',
    '-codec:a', 'libmp3lame', '-b:a', '128k', file,
  ], { input: Buffer.from(inter.buffer, inter.byteOffset, inter.byteLength), maxBuffer: 1 << 28 })
  if (r.error || r.status !== 0) throw new Error(`ffmpeg encode failed for ${file}: ${r.error?.message ?? r.stderr}`)
}

const dB = (ratio: number) => 20 * Math.log10(Math.max(ratio, 1e-12))
/** Seconds of ring counted into a phrase's window past its last onset. */
const WINDOW_TAIL = 1.2
const mid = (l: Float32Array, r: Float32Array) => Float32Array.from(l, (v, i) => (v + r[i]) / 2)

mkdirSync(OUT_DIR, { recursive: true })
for (const baseId of Object.keys(BASES) as BaseId[]) {
  const base = BASES[baseId]
  const { left, right } = decode(resolve(SOUNDS, `${baseId}.mp3`))
  const loopSamples = left.length
  const beatSeconds = loopSamples / SR / base.beats
  const baseRms = rms(mid(left, right))
  for (const crop of CROPS) {
    const id = `${baseId}-${crop}`
    if (ONLY && ONLY !== id) continue
    // Pass 1: render at the scores' own levels and see where each phrase lands
    // against the base in its window; pass 2 re-renders with the correction.
    const probe = renderLayer(baseId, crop, loopSamples, beatSeconds, SEED)
    if (probe[0].length !== loopSamples) throw new Error(`${id}: layer length ${probe[0].length} !== ${loopSamples}`)
    // A silent layer would otherwise pass every assertion below (Δ 0, peak = the
    // base's peak) and ship four files identical to the base.
    if (rms(mid(probe[0], probe[1])) <= 1e-6) throw new Error(`${id}: rendered layer is silent (rms ${rms(mid(probe[0], probe[1]))})`)
    const probeMid = mid(probe[0], probe[1])
    const baseMid = mid(left, right)
    const gains = new Map<string, number>()
    const report: string[] = []
    for (const part of PARTS[baseId][crop]) {
      for (const phrase of phrasesOf(part)) {
        const first = phrase.notes[0].beat, last = phrase.notes[phrase.notes.length - 1].beat
        const from = Math.floor(first * beatSeconds * SR)
        const to = Math.min(loopSamples, Math.floor((last * beatSeconds + WINDOW_TAIL) * SR))
        const heard = dB(rms(probeMid.subarray(from, to))) - dB(rms(baseMid.subarray(from, to)))
        const gain = Math.min(GAIN_MAX, Math.max(GAIN_MIN, Math.pow(10, (PHRASE_DB - heard) / 20)))
        gains.set(phrase.key, gain)
        report.push(`${phrase.key} ${heard.toFixed(1)}→${PHRASE_DB} (×${gain.toFixed(2)})`)
      }
    }
    // Where an ornament coincides with a loud base moment the sum can approach full
    // scale; rather than let the soft clip work hard (audible on sustained tones),
    // back the whole layer off a decibel at a time until the peak is comfortable.
    let backoff = 0
    let outL = new Float32Array(loopSamples), outR = new Float32Array(loopSamples)
    let peak = 0
    for (;;) {
      const trim = Math.pow(10, -backoff / 20)
      const scaled: PhraseGains = new Map([...gains].map(([k, v]) => [k, v * trim]))
      const layer = renderLayer(baseId, crop, loopSamples, beatSeconds, SEED, scaled)
      outL = new Float32Array(loopSamples); outR = new Float32Array(loopSamples)
      for (let i = 0; i < loopSamples; i++) {
        outL[i] = left[i] + layer[0][i]
        outR[i] = right[i] + layer[1][i]
      }
      // Match the base loudness, then keep every sample inside the range.
      const g = baseRms / rms(mid(outL, outR))
      peak = 0
      for (let i = 0; i < loopSamples; i++) {
        outL[i] = softClip(outL[i] * g); outR[i] = softClip(outR[i] * g)
        peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]))
      }
      if (peak < PEAK_CEILING || backoff >= MAX_BACKOFF_DB) break
      backoff += 1
    }
    const deltaDb = dB(rms(mid(outL, outR)) / baseRms)
    const file = resolve(OUT_DIR, `${id}.mp3`)
    console.log(`${id}: ${(loopSamples / SR).toFixed(2)} s, ${(60 / beatSeconds).toFixed(1)} BPM, base ${dB(baseRms).toFixed(1)} dBFS, Δ ${deltaDb.toFixed(2)} dB, peak ${peak.toFixed(3)}`)
    console.log(`  phrases at ${(PHRASE_DB - backoff).toFixed(0)} dB${backoff ? ` (backed off ${backoff} dB for headroom)` : ''}: ${report.join('  ')}`)
    if (Math.abs(deltaDb) > 0.5) throw new Error(`${file}: loudness off by more than 0.5 dB`)
    if (peak >= 0.95) throw new Error(`${file}: peak ${peak.toFixed(3)} ≥ 0.95`)
    encode(file, outL, outR)
  }
}
