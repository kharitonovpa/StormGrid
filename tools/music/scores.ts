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
// Match (A minor, 100 BPM — the same pulse as the lobby, 42 beats): A3 A3 | E4 (rings to 4) |
// C4 (to 7) | A3 (rings to 11) | E4 E4 | G4 (to 16) | A4 (rings to 20) | D4 (to 23) | C4 (to 26) |
// A3 (rings to 30) | C4 (to 33) | E4 (to 36) | G4 (to 39) | A3 A3. Gaps: A 9.5–11.5, B 17.5–21,
// C 28.5–30.5.
export const BASES: Record<BaseId, BaseInfo> = {
  'lobby-music': { id: 'lobby-music', beats: 42, attacks: [0, 2, 3, 6, 12, 14, 17, 24, 27, 30, 36, 38, 41], scale: [4, 7, 9, 11, 2] },
  'match-music': { id: 'match-music', beats: 42, attacks: [0, 2, 5, 8, 12, 14, 17, 21, 24, 27, 31, 34, 37, 40], scale: [9, 0, 2, 4, 7] },
}

export interface Part {
  voice: VoiceName
  notes: Note[]
  /** −1 left … +1 right. */
  pan: number
  /** Linear gain of the dry part, before the per-phrase balance below. */
  level: number
  /** 0..1 share sent to the reverb. */
  reverbSend: number
  /** 0..1 share sent to the ping-pong delay. */
  delaySend: number
}

export function isInScale(midi: number, scale: number[]): boolean {
  return scale.includes(((midi % 12) + 12) % 12)
}

/** One run of notes: consecutive onsets no more than 1.5 beats apart. */
export interface Phrase {
  /** Stable name for the mix map — `voice@firstBeat`. */
  key: string
  notes: Note[]
}

/**
 * A part's notes grouped into phrases. The mix balances a phrase at a time: the
 * base's level differs from gap to gap, so one gain for a whole part leaves some
 * runs shouting and others inaudible.
 */
export function phrasesOf(part: Part): Phrase[] {
  const notes = [...part.notes].sort((a, b) => a.beat - b.beat)
  const groups: Note[][] = []
  for (const note of notes) {
    const last = groups[groups.length - 1]
    if (last && note.beat - last[last.length - 1].beat <= 1.5) last.push(note)
    else groups.push([note])
  }
  return groups.map((g) => ({ key: `${part.voice}@${g[0].beat}`, notes: g }))
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
      // gap A — rising over the held A3
      { beat: 9.5, midi: 69, dur: 1, gain: 0.75 }, { beat: 10, midi: 72, dur: 1, gain: 0.7 }, { beat: 10.5, midi: 74, dur: 1, gain: 0.65 }, { beat: 11, midi: 76, dur: 1, gain: 0.6 },
      // gap C — falling back onto the A
      { beat: 28.5, midi: 76, dur: 1, gain: 0.7 }, { beat: 29, midi: 74, dur: 1, gain: 0.6 }, { beat: 29.5, midi: 72, dur: 1, gain: 0.5 }, { beat: 30, midi: 69, dur: 1, gain: 0.45 },
    ],
  },
  {
    voice: 'shakuhachi', pan: -0.3, level: 0.6, reverbSend: 0.65, delaySend: 0,
    notes: [{ beat: 17.5, midi: 76, dur: 3.5, gain: 1 }],
  },
]

const MATCH_CORN: Part[] = [
  {
    voice: 'nylon', pan: -0.35, level: 1, reverbSend: 0.45, delaySend: 0.15,
    notes: [
      { beat: 9.5, midi: 45, dur: 2.5, gain: 0.8 }, { beat: 10.1, midi: 52, dur: 2.5, gain: 0.7 }, { beat: 10.7, midi: 57, dur: 2.5, gain: 0.65 }, { beat: 11.3, midi: 60, dur: 2.5, gain: 0.55 },
      { beat: 28.5, midi: 45, dur: 2.5, gain: 0.75 }, { beat: 29, midi: 52, dur: 2.5, gain: 0.65 }, { beat: 29.5, midi: 57, dur: 2.5, gain: 0.6 }, { beat: 30, midi: 60, dur: 2.5, gain: 0.5 }, { beat: 30.5, midi: 64, dur: 2.5, gain: 0.45 },
    ],
  },
  {
    voice: 'trumpet', pan: 0.4, level: 0.3, reverbSend: 0.65, delaySend: 0.2,
    notes: [{ beat: 17.5, midi: 72, dur: 3, gain: 1 }, { beat: 17.5, midi: 76, dur: 3, gain: 0.7 }],
  },
]

export const PARTS: Record<BaseId, Record<Crop, Part[]>> = {
  'lobby-music': { rice: LOBBY_RICE, corn: LOBBY_CORN },
  'match-music': { rice: MATCH_RICE, corn: MATCH_CORN },
}
