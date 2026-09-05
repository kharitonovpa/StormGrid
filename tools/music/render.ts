/**
 * Render one crop layer for one base loop: each part → voice → pan → delay and
 * reverb sends → sum. Tails (voices, delay, reverb) wrap to the loop start so the
 * loop point stays seamless. Pure; the build script adds ffmpeg and levelling.
 */
import { SR, seedRandom, midiToFreq, mixInto } from './synth.ts'
import { reverb, pingPong, haas, pan, addStereo, type Stereo } from './fx.ts'
import { modalString, KOTO, NYLON, breathTone, mutedTrumpet } from './voices.ts'
import { PARTS, type BaseId, type Crop, type Part, type VoiceName } from './scores.ts'

/** Seconds of tail rendered past the loop end before wrapping (reverb RT60 + delay). */
const TAIL_SECONDS = 8

const REVERB = {
  'lobby-music': { rt60: 5, damping: 0.3, preDelayMs: 25 },
  'match-music': { rt60: 6, damping: 0.3, preDelayMs: 25 },
} as const

function voiceFor(name: VoiceName, rand: () => number): (freq: number, seconds: number) => Float32Array {
  switch (name) {
    case 'koto': return (f, s) => modalString(f, s + KOTO.decay, KOTO, rand)
    case 'nylon': return (f, s) => modalString(f, s + NYLON.decay, NYLON, rand)
    case 'shakuhachi': return (f, s) => breathTone(f, s + 1.2, rand)
    case 'trumpet': return (f, s) => mutedTrumpet(f, s + 0.6)
  }
}

/** Fold everything past `loopSamples` back onto the start. */
function wrap(buf: Float32Array, loopSamples: number): Float32Array {
  const out = new Float32Array(loopSamples)
  for (let i = 0; i < buf.length; i++) out[i % loopSamples] += buf[i]
  return out
}

export function renderLayer(baseId: BaseId, crop: Crop, loopSamples: number, beatSeconds: number, seed: number): Stereo {
  const rand = seedRandom(seed)
  const total = loopSamples + Math.round(TAIL_SECONDS * SR)
  const dry: Stereo = [new Float32Array(total), new Float32Array(total)]
  const toReverb: Stereo = [new Float32Array(total), new Float32Array(total)]
  const toDelay: Stereo = [new Float32Array(total), new Float32Array(total)]
  for (const part of PARTS[baseId][crop] as Part[]) {
    const voice = voiceFor(part.voice, rand)
    const mono = new Float32Array(total)
    for (const note of part.notes) {
      const tone = voice(midiToFreq(note.midi), note.dur * beatSeconds)
      mixInto(mono, tone, note.beat * beatSeconds * SR, (note.gain ?? 1) * part.level)
    }
    const stereo = pan(mono, part.pan)
    addStereo(dry, stereo, 1)
    addStereo(toReverb, stereo, part.reverbSend)
    addStereo(toDelay, stereo, part.delaySend)
  }
  const delayed = pingPong(toDelay[0], toDelay[1], 0.75 * beatSeconds, 0.35, 3000)
  // The delay repeats also feed the room.
  addStereo(toReverb, delayed, 0.5)
  const wet = haas(...reverb(toReverb[0], toReverb[1], REVERB[baseId]), 12)
  const sum: Stereo = [new Float32Array(total), new Float32Array(total)]
  addStereo(sum, dry, 1)
  addStereo(sum, delayed, 0.6)
  addStereo(sum, wet, 0.9)
  return [wrap(sum[0], loopSamples), wrap(sum[1], loopSamples)]
}
