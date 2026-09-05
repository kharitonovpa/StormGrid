#!/usr/bin/env bun
/**
 * Build the rice and corn versions of the two music loops.
 *
 *   bun run music:build              → writes into packages/client/public/sounds
 *   MUSIC_OUT=/tmp/x bun run music:build   → writes elsewhere (listening tests)
 *
 * Decodes the base loop with ffmpeg, renders a crop layer from the scores
 * below (seeded, so a rebuild is sample-identical), mixes it 12 dB under the
 * base's RMS, soft-limits, matches the base loudness and encodes 128 kbps MP3.
 * Tails that run past the loop end wrap to its start, so the loop point stays
 * seamless. Tune by editing the scores and voices, then rebuild.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  SR, seedRandom, pluck, sawVoice, breathVoice, renderScore, mixInto,
  softLimit, rms, scaleTo, type Note, type Voice,
} from './synth.ts'

const ROOT = resolve(import.meta.dir, '../..')
const SOUNDS = resolve(ROOT, 'packages/client/public/sounds')
const OUT_DIR = process.env.MUSIC_OUT ?? SOUNDS
const SEED = 20260905
const LAYER_DB = -12

// ── Bases ──────────────────────────────────────────────────────────────────
// Beat counts measured from the files (onset autocorrelation): the loops are
// 25.2 s; 42 beats ≈ 100 BPM (E minor), 28 beats ≈ 66.7 BPM (A minor).
interface Base { id: 'lobby-music' | 'match-music'; beats: number }
const BASES: Base[] = [
  { id: 'lobby-music', beats: 42 },
  { id: 'match-music', beats: 28 },
]

// ── Scores ─────────────────────────────────────────────────────────────────
// Minor pentatonic of each base: E G A B D (lobby), A C D E G (match).
// Rice: one koto phrase per 14 beats plus one long breath tone per loop.
const RICE_LOBBY_PLUCKS: Note[] = [
  { beat: 1, midi: 64, dur: 0.5 }, { beat: 1.5, midi: 67, dur: 0.5 }, { beat: 2, midi: 69, dur: 0.5 }, { beat: 2.5, midi: 71, dur: 2 },
  { beat: 15, midi: 76, dur: 0.5 }, { beat: 15.5, midi: 74, dur: 0.5 }, { beat: 16, midi: 71, dur: 0.5 }, { beat: 16.5, midi: 69, dur: 2 },
  { beat: 29, midi: 67, dur: 0.5 }, { beat: 29.5, midi: 71, dur: 0.5 }, { beat: 30, midi: 74, dur: 2.5 },
]
const RICE_LOBBY_BREATH: Note[] = [{ beat: 35, midi: 59, dur: 6, gain: 0.6 }]
const RICE_MATCH_PLUCKS: Note[] = [
  { beat: 1, midi: 57, dur: 0.5 }, { beat: 1.5, midi: 60, dur: 0.5 }, { beat: 2, midi: 62, dur: 0.5 }, { beat: 2.5, midi: 64, dur: 2 },
  { beat: 15, midi: 67, dur: 0.5 }, { beat: 15.5, midi: 64, dur: 0.5 }, { beat: 16, midi: 62, dur: 2 },
]
const RICE_MATCH_BREATH: Note[] = [{ beat: 20, midi: 52, dur: 5, gain: 0.6 }]

// Corn: sparse nylon strums (30 ms stagger between strings) and one trumpet
// third per phrase. Chords stay in the base's key.
function strum(beat: number, midis: number[], dur: number, beatSeconds: number): Note[] {
  const stagger = 0.03 / beatSeconds
  return midis.map((midi, i) => ({ beat: beat + i * stagger, midi, dur }))
}
function cornLobbyStrums(beatSeconds: number): Note[] {
  return [
    ...strum(4, [52, 55, 59, 64], 3, beatSeconds),   // Em
    ...strum(12, [57, 60, 64], 3, beatSeconds),      // Am
    ...strum(20, [52, 55, 59, 64], 3, beatSeconds),  // Em
    ...strum(28, [48, 52, 55, 60], 3, beatSeconds),  // C
    ...strum(36, [59, 62, 66], 3, beatSeconds),      // Bm → back to Em at the loop point
  ]
}
const CORN_LOBBY_TRUMPET: Note[] = [
  { beat: 7, midi: 76, dur: 1.5, gain: 0.7 }, { beat: 7, midi: 79, dur: 1.5, gain: 0.5 },
  { beat: 35, midi: 71, dur: 1.5, gain: 0.7 }, { beat: 35, midi: 74, dur: 1.5, gain: 0.5 },
]
function cornMatchStrums(beatSeconds: number): Note[] {
  return [
    ...strum(3, [45, 48, 52, 57], 3, beatSeconds),   // Am
    ...strum(11, [50, 53, 57], 3, beatSeconds),      // Dm
    ...strum(19, [45, 48, 52, 57], 3, beatSeconds),  // Am
    ...strum(27, [52, 55, 59], 3, beatSeconds),      // Em → wraps into the loop start
  ]
}
const CORN_MATCH_TRUMPET: Note[] = [
  { beat: 13, midi: 69, dur: 2, gain: 0.7 }, { beat: 13, midi: 72, dur: 2, gain: 0.5 },
]

// ── Voices ─────────────────────────────────────────────────────────────────
const koto = (rand: () => number): Voice => (f, s) => pluck(f, s + 1.2, { brightness: 1, decay: 1.2, rand })
const nylon = (rand: () => number): Voice => (f, s) => pluck(f, s + 1.6, { brightness: 0.35, decay: 1.6, rand })
const trumpet: Voice = (f, s) => sawVoice(f, s, { vibratoHz: 5.5, vibratoCents: 25, harmonics: 12, attack: 0.08, release: 0.25 })
const breath = (rand: () => number): Voice => (f, s) => breathVoice(f, s, { noise: 0.35, attack: 1.2, release: 1.5, rand })

type Crop = 'rice' | 'corn'
function layerFor(crop: Crop, base: Base, beatSeconds: number, loopSamples: number): Float32Array {
  const rand = seedRandom(SEED)
  const layer = new Float32Array(loopSamples)
  const add = (notes: Note[], voice: Voice) => mixInto(layer, renderScore(notes, beatSeconds, loopSamples, voice), 0, 1)
  if (crop === 'rice') {
    add(base.id === 'lobby-music' ? RICE_LOBBY_PLUCKS : RICE_MATCH_PLUCKS, koto(rand))
    add(base.id === 'lobby-music' ? RICE_LOBBY_BREATH : RICE_MATCH_BREATH, breath(rand))
  } else {
    add(base.id === 'lobby-music' ? cornLobbyStrums(beatSeconds) : cornMatchStrums(beatSeconds), nylon(rand))
    add(base.id === 'lobby-music' ? CORN_LOBBY_TRUMPET : CORN_MATCH_TRUMPET, trumpet)
  }
  return layer
}

// ── ffmpeg I/O ─────────────────────────────────────────────────────────────
function decode(file: string): { left: Float32Array; right: Float32Array } {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '2', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 })
  if (r.error || r.status !== 0) throw new Error(`ffmpeg decode failed for ${file}: ${r.error?.message ?? r.stderr}`)
  // Copy into a fresh, 4-byte-aligned buffer — a Buffer slice's byteOffset need not be.
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

// ── Build ──────────────────────────────────────────────────────────────────
const dB = (ratio: number) => 20 * Math.log10(ratio)

mkdirSync(OUT_DIR, { recursive: true })
for (const base of BASES) {
  const { left, right } = decode(resolve(SOUNDS, `${base.id}.mp3`))
  const loopSamples = left.length
  const beatSeconds = loopSamples / SR / base.beats
  const mono = Float32Array.from(left, (v, i) => (v + right[i]) / 2)
  const baseRms = rms(mono)
  for (const crop of ['rice', 'corn'] as const) {
    const layer = scaleTo(layerFor(crop, base, beatSeconds, loopSamples), baseRms * Math.pow(10, LAYER_DB / 20))
    const outL = new Float32Array(loopSamples), outR = new Float32Array(loopSamples)
    for (let i = 0; i < loopSamples; i++) { outL[i] = left[i] + layer[i]; outR[i] = right[i] + layer[i] }
    // Match the base loudness, then keep every sample inside the range.
    const mixedRms = rms(Float32Array.from(outL, (v, i) => (v + outR[i]) / 2))
    const g = baseRms / mixedRms
    let peak = 0
    for (let i = 0; i < loopSamples; i++) {
      outL[i] = softLimit(outL[i] * g); outR[i] = softLimit(outR[i] * g)
      peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]))
    }
    const outRms = rms(Float32Array.from(outL, (v, i) => (v + outR[i]) / 2))
    const file = resolve(OUT_DIR, `${base.id}-${crop}.mp3`)
    const deltaDb = dB(outRms / baseRms)
    console.log(`${base.id}-${crop}: ${(loopSamples / SR).toFixed(2)} s, ${(60 / beatSeconds).toFixed(1)} BPM, base ${dB(baseRms).toFixed(1)} dBFS, out ${dB(outRms).toFixed(1)} dBFS (Δ ${deltaDb.toFixed(2)} dB), peak ${peak.toFixed(3)}`)
    if (Math.abs(deltaDb) > 1) throw new Error(`${file}: loudness off by more than 1 dB`)
    if (peak >= 1) throw new Error(`${file}: peak reached full scale`)
    encode(file, outL, outR)
  }
}
