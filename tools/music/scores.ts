/**
 * What the base loops do, and what the crop layers add — as data.
 *
 * The base maps were measured from the files (dominant pitch per beat, onset
 * detection): the loops play one long note at a time and let it ring, so the
 * ornaments are written into the gaps where a note is fading, on the chord tones
 * the base is holding, never on a base attack.
 */
import type { Note } from './synth.ts'

export type BaseId = 'lobby-music' | 'match-music'
export type Crop = 'rice' | 'corn'
export type VoiceName = 'koto' | 'nylon' | 'shakuhachi' | 'trumpet'

export interface BaseInfo {
  id: BaseId
  beats: number
  /** Beats where the base strikes a new note. */
  attacks: number[]
  /** Pitch classes of the base's minor pentatonic. */
  scale: number[]
}

// Lobby (E minor, 100 BPM): D5 B4 | E4 G4 G4 G4 | E4 (rings to beat 11) | B4 B4 | D5 ×3 |
// G4 (rings to beat 23) | E5 ×3 | B4 ×3 | E4 (rings to 35) | G4 G4 | B4 ×3 | D5.
// Match (A minor, 66.7 BPM): A3 | E4 | E4 | C4 C4 | A3 (rings to 7) | E4 | G4 G4 | A4 (rings
// to 13) | D4 D4 | C4 C4 | A3 (C4 joins at 20, rings to 21) | E4 E4 | G4 G4 | A3 A3.
export const BASES: Record<BaseId, BaseInfo> = {
  'lobby-music': { id: 'lobby-music', beats: 42, attacks: [0, 2, 3, 6, 12, 14, 17, 24, 27, 30, 36, 38, 41], scale: [4, 7, 9, 11, 2] },
  'match-music': { id: 'match-music', beats: 28, attacks: [0, 1, 3, 5, 8, 9, 11, 14, 16, 18, 20, 22, 24, 26], scale: [9, 0, 2, 4, 7] },
}

export function isInScale(midi: number, scale: number[]): boolean {
  return scale.includes(((midi % 12) + 12) % 12)
}

export interface Part {
  voice: VoiceName
  notes: Note[]
  /** −1 left … +1 right. */
  pan: number
  /** Linear gain of the dry part before the layer is levelled as a whole. */
  level: number
  /** 0..1 share sent to the reverb. */
  reverbSend: number
  /** 0..1 share sent to the ping-pong delay. */
  delaySend: number
}

// MIDI: E3 52, G3 55, B3 59, E4 64, G4 67, B4 71, D5 74, E5 76, G5 79; A2 45, E3 52, A3 57,
// C4 60, E4 64, A4 69, C5 72, D5 74, E5 76.

const LOBBY_RICE: Part[] = [
  {
    voice: 'koto', pan: 0.3, level: 1, reverbSend: 0.45, delaySend: 0.25,
    notes: [
      // gap A — answer falling back onto the held E
      { beat: 8.5, midi: 71, dur: 1, gain: 0.8 }, { beat: 9, midi: 74, dur: 1, gain: 0.7 }, { beat: 9.5, midi: 76, dur: 1.5, gain: 0.75 },
      { beat: 10.5, midi: 74, dur: 1, gain: 0.55 }, { beat: 11, midi: 71, dur: 1.5, gain: 0.45 },
      // gap B — around the held G
      { beat: 19.5, midi: 79, dur: 1, gain: 0.7 }, { beat: 20, midi: 76, dur: 1, gain: 0.6 }, { beat: 21, midi: 74, dur: 1, gain: 0.5 }, { beat: 22, midi: 71, dur: 1.5, gain: 0.4 },
      // gap C — three notes, quieter still
      { beat: 33.5, midi: 76, dur: 1, gain: 0.55 }, { beat: 34.25, midi: 74, dur: 1, gain: 0.45 }, { beat: 35, midi: 71, dur: 1.5, gain: 0.4 },
    ],
  },
  {
    voice: 'shakuhachi', pan: -0.3, level: 0.6, reverbSend: 0.6, delaySend: 0,
    notes: [{ beat: 24.4, midi: 76, dur: 4.6, gain: 1 }],
  },
]

const LOBBY_CORN: Part[] = [
  {
    voice: 'nylon', pan: -0.35, level: 1, reverbSend: 0.4, delaySend: 0.15,
    notes: [
      { beat: 8.5, midi: 52, dur: 2, gain: 0.8 }, { beat: 9.25, midi: 59, dur: 2, gain: 0.7 }, { beat: 10, midi: 64, dur: 2, gain: 0.65 }, { beat: 10.75, midi: 67, dur: 2, gain: 0.55 },
      { beat: 19.5, midi: 55, dur: 2, gain: 0.75 }, { beat: 20.25, midi: 62, dur: 2, gain: 0.65 }, { beat: 21, midi: 67, dur: 2, gain: 0.6 }, { beat: 21.75, midi: 71, dur: 2, gain: 0.5 },
      { beat: 33.5, midi: 52, dur: 2, gain: 0.7 }, { beat: 34.25, midi: 59, dur: 2, gain: 0.6 }, { beat: 35, midi: 64, dur: 2, gain: 0.5 },
    ],
  },
  {
    voice: 'trumpet', pan: 0.4, level: 0.35, reverbSend: 0.6, delaySend: 0.2,
    notes: [
      { beat: 12.4, midi: 71, dur: 1.4, gain: 1 }, { beat: 12.4, midi: 74, dur: 1.4, gain: 0.7 },
      { beat: 14.4, midi: 76, dur: 1.6, gain: 1 }, { beat: 14.4, midi: 79, dur: 1.6, gain: 0.7 },
    ],
  },
]

const MATCH_RICE: Part[] = [
  {
    voice: 'koto', pan: 0.3, level: 1, reverbSend: 0.5, delaySend: 0.25,
    notes: [
      { beat: 5.4, midi: 69, dur: 1, gain: 0.75 }, { beat: 5.9, midi: 72, dur: 1, gain: 0.7 }, { beat: 6.4, midi: 74, dur: 1, gain: 0.65 }, { beat: 6.9, midi: 76, dur: 1.5, gain: 0.6 },
      { beat: 18.4, midi: 76, dur: 1, gain: 0.7 }, { beat: 18.8, midi: 74, dur: 1, gain: 0.6 }, { beat: 19.2, midi: 72, dur: 1, gain: 0.5 }, { beat: 19.6, midi: 69, dur: 1.5, gain: 0.45 },
    ],
  },
  {
    voice: 'shakuhachi', pan: -0.3, level: 0.6, reverbSend: 0.65, delaySend: 0,
    notes: [{ beat: 11.3, midi: 76, dur: 2.7, gain: 1 }],
  },
]

const MATCH_CORN: Part[] = [
  {
    voice: 'nylon', pan: -0.35, level: 1, reverbSend: 0.45, delaySend: 0.15,
    notes: [
      { beat: 5.4, midi: 45, dur: 2.5, gain: 0.8 }, { beat: 6, midi: 52, dur: 2.5, gain: 0.7 }, { beat: 6.6, midi: 57, dur: 2.5, gain: 0.65 }, { beat: 7.2, midi: 60, dur: 2.5, gain: 0.55 },
      { beat: 18.4, midi: 45, dur: 2.5, gain: 0.75 }, { beat: 18.9, midi: 52, dur: 2.5, gain: 0.65 }, { beat: 19.4, midi: 57, dur: 2.5, gain: 0.6 }, { beat: 20.4, midi: 60, dur: 2.5, gain: 0.5 }, { beat: 20.9, midi: 64, dur: 2.5, gain: 0.45 },
    ],
  },
  {
    voice: 'trumpet', pan: 0.4, level: 0.3, reverbSend: 0.65, delaySend: 0.2,
    notes: [{ beat: 11.3, midi: 72, dur: 1.7, gain: 1 }, { beat: 11.3, midi: 76, dur: 1.7, gain: 0.7 }],
  },
]

export const PARTS: Record<BaseId, Record<Crop, Part[]>> = {
  'lobby-music': { rice: LOBBY_RICE, corn: LOBBY_CORN },
  'match-music': { rice: MATCH_RICE, corn: MATCH_CORN },
}
