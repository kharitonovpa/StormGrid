# Crop music layer redesign — design

Date: 2026-09-05. Supersedes the "Music variants" section of
`2026-09-05-crop-identity-design.md`.

## Problem

The first rice/corn variants of the two music loops (`tools/music`, merged 2026-09-05)
were rejected on listening: "как на денди или миди-синтезаторе, фальшивит, без объёма,
без амплитуды, без глубины, без идеи". Analysis agrees:

- **Tuning.** The base loops are exactly A440 (global offset 0 cents, measured). The
  Karplus–Strong string used an integer delay line, so its notes sit flat by up to
  16 cents (G5 −15.3, E5 −15.6, D5 −9.5, E4 −9.2 cents) against an in-tune base.
- **Space and timbre.** The layer is dry and mono: no reverb, no delay, no width, fixed
  velocities. The "trumpet" is a raw additive saw with vibrato — a MIDI lead. The base,
  by contrast, is sustained and spacious: single notes ringing for 5–7 beats, decaying
  15–20 dB, moderate stereo width (L/R correlation 0.93), peak/RMS 11.5 dB.
- **Writing.** The motifs are pentatonic runs on a fixed grid, unrelated to where the
  base plays or breathes; several land on the base's own attacks.

The original loops' generator is not in the repository or its history (the MP3s were
committed as binaries in April), so the new layer is designed from analysis of the
files, not from the original recipe.

## Goal

Rice and corn variants of `lobby-music` and `match-music` that sound like they belong
to the base: in tune, spacious, soft, sparse, recognisably "Asian" (rice) and
"mariachi at a distance" (corn), written into the base's pauses. Plus a lobby that
switches crops without a musical hiccup. Built by the same committed, deterministic tool;
accepted by the human's ear in listening rounds.

## Non-goals

- The base loops and wheat are untouched.
- No sampled instruments (none in the repo, none downloaded) — everything is synthesised.
- No runtime synthesis or effects in the client; the client still plays MP3 files.
- No change to volumes, layers or fades outside the lobby crossfade described below.

## What the base does (measured, drives the writing)

Lobby — E minor, 100 BPM, 42 beats of 0.600 s. Dominant pitch per beat, with the
level relative to the loop's loudest beat:

```
beat   0-1: D5 B4          (−4 … −7 dB)
beat   2-5: E4 G4 G4 G4    (−2 … −10)
beat  6-11: E4 ringing     (0 → −17)      ← gap A: beats 8–11
beat 12-13: B4 B4
beat 14-16: D5 D5 D5       (0 → −10)
beat 17-23: G4 ringing     (−1 → −23)     ← gap B: beats 19–23
beat 24-26: E5 E5 E5
beat 27-29: B4 B4 B4
beat 30-35: E4 ringing     (0 → −17)      ← gap C: beats 33–35
beat 36-37: G4 G4
beat 38-40: B4 B4 B4
beat    41: D5
```

Match — A minor, 66.7 BPM, 28 beats of 0.900 s:

```
beat   0: A3            beat  1-2: E4 (A3, G4)     beat 3-4: C4
beat 5-7: A3 ringing    ← gap A                     beat   8: E4
beat 9-10: G4 (E4)      beat 11-13: A4 ringing      ← gap B
beat 14-15: D4          beat 16-17: C4
beat 18-21: A3 / C4 ringing ← gap C                 beat 22-23: E4
beat 24-25: G4          beat 26-27: A3
```

Rules derived from this: ornaments live in the gaps, start 0.25–0.5 beat after the
last base attack, use the chord tones the base is holding (E minor pentatonic
E G A B D; A minor pentatonic A C D E G), and never coincide with a base attack.

## Design

### 1. Sound engine (`tools/music/`)

`synth.ts` keeps the sample-rate constant, PRNG, envelopes, `mixInto`, `rms`,
`scaleTo`, `normalize`, `renderScore`. New modules:

- `voices.ts`
  - **Modal string** (`modalString(freq, seconds, preset)`): sum of N decaying partials
    `a_k · sin(2π f_k t) · e^(−t/τ_k)` with `f_k = k·f·sqrt(1 + B·k²)` (inharmonicity
    `B`), per-partial decay `τ_k = τ₁ / (1 + d·(k−1))`, a short noise burst through a
    one-pole low-pass for the attack, and a body resonance (second-order band-pass at
    the preset's body frequency) mixed in at low level. Pitch error < 1 cent by
    construction. Presets: `koto` (12 partials, B 0.0004, τ₁ 1.6 s, bright attack,
    body 620 Hz), `nylon` (8 partials, B 0.0001, τ₁ 2.2 s, soft attack low-passed at
    3 kHz, body 180 Hz).
  - **Shakuhachi** (`breathTone`): fundamental + 2nd/3rd partials (−12/−18 dB) with
    vibrato that starts after 0.4 s (4.5 Hz, ±12 cents), breath noise band-passed at the
    fundamental (Q 12) at −20 dB, attack 0.35 s, release 1.2 s.
  - **Distant muted trumpet** (`mutedTrumpet`): band-limited pulse (harmonics up to
    4 kHz), two formant band-passes (900 Hz and 1.8 kHz, Q 4) summed, one-pole low-pass
    at 4 kHz, vibrato 5 Hz ±10 cents from 0.5 s, attack 0.12 s, release 0.6 s. Always
    rendered at low level with a long reverb send.
- `fx.ts`
  - **Reverb**: Freeverb topology per channel — 8 parallel comb filters with low-pass
    damping in the feedback, 4 series all-passes; right channel delays offset by 23
    samples for decorrelation. Parameters: room size → RT60 4–6 s, damping 0.35,
    pre-delay 25 ms, wet/dry per instrument. Verified by a test that measures the
    impulse response's RT60 within ±25 % of the target.
  - **Ping-pong delay**: dotted-eighth (450 ms lobby, 675 ms match), feedback 0.35,
    low-pass 3 kHz in the loop, alternating L/R.
  - **Widener**: Haas 12 ms on the wet path only (dry stays centred so mono playback is
    unaffected).
  - **Threshold soft clip**: identity below 0.85, tanh-shaped above; replaces the global
    `tanh` (the base passes through unchanged).
- `scores.ts`: the base note map above as data (`BASE_MAP`), the two scale tables, and
  the ornament scores below. A test asserts every ornament onset is ≥ 0.25 beat from
  every base attack in `BASE_MAP` and every pitch is in the base's pentatonic.

### 2. Writing

Rice (koto + shakuhachi):

- Lobby: gap A (beats 8.5–11) koto answer descending to the held E: `B4 D5 E5 · D5 B4`
  → soft, velocities 0.8→0.45; gap B (19.5–22.5) around the held G: `G5 E5 D5 B4`;
  gap C (33.5–35.5) three notes `E5 D5 B4`; shakuhachi one long `E5` from beat 24.4 to
  29 (over the E5–B4 section) at low level with slow vibrato.
- Match: gap A (5.4–7.5) koto `A4 C5 D5 E5` ascending, gap C (18.4–21.5) `E5 D5 C5 A4`
  descending; shakuhachi `E5` beats 11.3–14.

Corn (nylon + distant trumpet):

- Lobby: gap A nylon broken chord `E3 B3 E4 G4` (one note per 0.75 beat), gap B
  `G3 D4 G4 B4`, gap C `E3 B3 E4`; trumpet dyad `B4+D5` beats 12.4–13.8 then `E5+G5`
  beats 14.4–16, once per loop, at −20 dB with 60 % reverb.
- Match: gap A nylon `A2 E3 A3 C4`, gap C `A2 E3 A3 C4 E4`; trumpet dyad `C5+E5` beats
  11.3–13 at −22 dB.

Every note carries a velocity; phrases decay; koto is panned 0.3 right, shakuhachi 0.3
left, nylon 0.35 left, trumpet 0.4 right, reverb returns full width.

### 3. Mix

Layer RMS −14 dB relative to the base's RMS (with reverb tails included in the RMS),
threshold soft clip, output RMS within ±0.5 dB of the base, peak < 0.95. Stereo: the
base is untouched; the layer is stereo. Encoded 128 kbps like today, same length, tails
wrapped to the loop start (as today). The build asserts all of this before writing any
file.

### 4. Client: seamless crop switch in the lobby

All lobby variants share the base, so a switch can keep the playhead. `audio.ts` gains
`switchMusic(id, duration = 600)`: if a music-layer loop is playing and `id` differs,
read `position = outgoing.seek()`, start `id` at that position (`seek` then `play`;
Howler queues both if the file is still loading, and the playhead is re-read on its
`load` event so a slow download still lands in sync), crossfade both over `duration`,
then stop the outgoing one. `enterLobby(character)` uses `switchMusic` when lobby music
is already playing, and its full fade-out/fade-in otherwise (arriving from a match).
On entering the lobby the two other lobby variants are `load()`ed in the background so
a later click switches instantly (≈ 0.8 MB, after the lobby is already audible).

### 5. Process and acceptance

- Demo first: `lobby-music-rice` alone is built and sent to the chat; the human's
  verdict (in tune / spacious / recognisable / level) drives one or two adjustment
  rounds. Then the other three files, one round. Each round is `bun run music:build`
  plus `SendUserFile`.
- Objective gates (tests): modal string pitch within 1 cent at 220/440/659/784 Hz;
  reverb RT60 within ±25 % of target; delay period exact; soft clip identity below
  threshold and bounded above; ornament placement rules against `BASE_MAP`; build
  assertions (level, peak, length, determinism).
- The client crossfade is unit-tested with the fake Howl from `audio.switch.test.ts`
  (position carried over; outgoing stopped after the fade; loading file lands in sync).

## Files touched

- `tools/music/synth.ts` (core kept), new `voices.ts`, `fx.ts`, `scores.ts`, tests.
- `tools/music/build-variants.ts` — uses the new voices/fx and scores; stereo layer.
- `packages/client/public/sounds/*-music-{rice,corn}.mp3` — regenerated.
- `packages/client/src/lib/audio.ts` — `switchMusic`, preload of lobby variants,
  `enterLobby` change; `audio.switch.test.ts` extended.
