#!/usr/bin/env bun
/**
 * Build the rice and corn versions of the two music loops.
 *
 *   bun run music:build                          → all four into packages/client/public/sounds
 *   MUSIC_OUT=/tmp/x bun run music:build         → write elsewhere (listening rounds)
 *   MUSIC_ONLY=lobby-music-rice bun run music:build → one file
 *
 * Decodes the base with ffmpeg, renders the crop layer (render.ts — seeded, so a
 * rebuild is sample-identical), levels it 14 dB under the base's RMS, matches the
 * output loudness to the base, soft-clips above 0.85, asserts everything and only
 * then encodes 128 kbps MP3. Tune by editing scores.ts / voices.ts and rebuilding.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { SR, rms } from './synth.ts'
import { softClip } from './fx.ts'
import { renderLayer } from './render.ts'
import { BASES, type BaseId, type Crop } from './scores.ts'

const ROOT = resolve(import.meta.dir, '../..')
const SOUNDS = resolve(ROOT, 'packages/client/public/sounds')
const OUT_DIR = process.env.MUSIC_OUT ?? SOUNDS
const ONLY = process.env.MUSIC_ONLY
const SEED = 20260905
const LAYER_DB = -14
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

const dB = (ratio: number) => 20 * Math.log10(ratio)
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
    const layer = renderLayer(baseId, crop, loopSamples, beatSeconds, SEED)
    if (layer[0].length !== loopSamples) throw new Error(`${id}: layer length ${layer[0].length} !== ${loopSamples}`)
    const layerRms = rms(mid(layer[0], layer[1]))
    // A silent layer would otherwise pass every assertion below (Δ 0, peak = the
    // base's peak) and ship four files identical to the base.
    if (layerRms <= 1e-6) throw new Error(`${id}: rendered layer is silent (rms ${layerRms})`)
    // Level the layer (tails included) 14 dB under the base, on its mid signal.
    const layerGain = (baseRms * Math.pow(10, LAYER_DB / 20)) / layerRms
    const outL = new Float32Array(loopSamples), outR = new Float32Array(loopSamples)
    for (let i = 0; i < loopSamples; i++) {
      outL[i] = left[i] + layer[0][i] * layerGain
      outR[i] = right[i] + layer[1][i] * layerGain
    }
    // Match the base loudness, then keep every sample inside the range.
    const g = baseRms / rms(mid(outL, outR))
    let peak = 0
    for (let i = 0; i < loopSamples; i++) {
      outL[i] = softClip(outL[i] * g); outR[i] = softClip(outR[i] * g)
      peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]))
    }
    const deltaDb = dB(rms(mid(outL, outR)) / baseRms)
    const file = resolve(OUT_DIR, `${id}.mp3`)
    console.log(`${id}: ${(loopSamples / SR).toFixed(2)} s, ${(60 / beatSeconds).toFixed(1)} BPM, base ${dB(baseRms).toFixed(1)} dBFS, Δ ${deltaDb.toFixed(2)} dB, peak ${peak.toFixed(3)}`)
    if (Math.abs(deltaDb) > 0.5) throw new Error(`${file}: loudness off by more than 0.5 dB`)
    if (peak >= 0.95) throw new Error(`${file}: peak ${peak.toFixed(3)} ≥ 0.95`)
    encode(file, outL, outR)
  }
}
