# Crop Music Layer Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rejected rice/corn ornament layer with an in-tune, spacious, sparse layer written into the base loops' pauses, and make the lobby switch crops without a musical hiccup.

**Architecture:** `tools/music` grows three pure modules — `fx.ts` (filters, Freeverb reverb, ping-pong delay, Haas widener, threshold soft clip, equal-power pan), `voices.ts` (modal string with koto/nylon presets, shakuhachi breath tone, distant muted trumpet) and `scores.ts` (the measured base note map, scales, and the ornament parts as data) — and `build-variants.ts` becomes a stereo renderer: per part → voice → pan → delay/reverb sends → sum, mixed −14 dB RMS under the base, threshold-clipped, loudness-matched, asserted, then encoded. The client's `audio.ts` gains a position-preserving `switchMusic` so a lobby pick crossfades ornaments over the same base position, and preloads the lobby variants in the background.

**Tech Stack:** Bun 1.3 + TypeScript (tool run with `bun`, typed with `tsc -p tools/music`), ffmpeg 7 (decode/encode only), Howler 2 in the Vue 3 client, `bun test`.

Spec: `docs/superpowers/specs/2026-09-05-music-layer-redesign-design.md`.

## Global Constraints

- Sample rate `SR = 44100`. All DSP is pure functions on `Float32Array`; only `build-variants.ts` touches ffmpeg or the filesystem. Builds are deterministic (seeded PRNG, `SEED = 20260905`).
- Base loops are untouched: `packages/client/public/sounds/lobby-music.mp3` (E minor, 42 beats, 0.600 s/beat) and `match-music.mp3` (A minor, 28 beats, 0.900 s/beat), both 25.2 s, exactly A440.
- Pitch: every synthesised note within **1 cent** of its equal-tempered frequency (tests at 220, 440, 659.26, 783.99 Hz).
- Scales: lobby ornaments use pitch classes {E, G, A, B, D} = MIDI mod 12 ∈ {4, 7, 9, 11, 2}; match ornaments use {A, C, D, E, G} = {9, 0, 2, 4, 7}.
- Placement: every ornament onset is ≥ 0.25 beat away from every base attack in `BASE_ATTACKS` (test); the scores below use ≥ 0.4.
- Reverb: Freeverb topology, RT60 target 5 s (lobby) and 6 s (match), pre-delay 25 ms, damping 0.3; right channel comb/allpass delays +23 samples. Ping-pong delay = dotted eighth (0.75 beat: 450 ms lobby, 675 ms match), feedback 0.35, low-pass 3 kHz in the loop. Haas 12 ms on wet paths only.
- Mix: layer (with tails) at RMS −14 dB relative to the base's mono RMS; output RMS within ±0.5 dB of the base; peak < 0.95 after a threshold soft clip (identity below 0.85); output length equals the base's sample count; tails wrap to the loop start. Encode 128 kbps MP3 with `libmp3lame`.
- Assets are written only after every assertion passes; `MUSIC_OUT=<dir>` redirects output; `MUSIC_ONLY=<id>` (e.g. `lobby-music-rice`) builds one file.
- Client: `switchMusic(id, duration = 600)` keeps the playhead (`outgoing.seek()`), crossfades, stops the outgoing loop after the fade; a still-loading incoming file re-reads the position on its `load` event. `enterLobby` uses it when lobby music is already playing; otherwise today's fade-out/fade-in. Entering the lobby `load()`s the other lobby variants. No other change to volumes, layers or fades.
- Tests: `bun test tools/music` (from the repo root), client `cd packages/client && bun test`; types `bunx tsc --noEmit -p tools/music`, `cd packages/client && bunx vue-tsc -b --noEmit`.
- Every commit message ends with the trailer line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Code style: no semicolons, single quotes, 2-space indent.
- The working tree of the main checkout currently holds another session's uncommitted client changes (PointsStar, points.ts, i18n, style.css, …). Never stage, revert or reformat files you did not change for this plan; stage by explicit path.

---

## File structure

| File | Responsibility |
|---|---|
| `tools/music/synth.ts` | Core kept: `SR`, `seedRandom`, `midiToFreq`, `envelope`, `mixInto`, `rms`, `scaleTo`, `normalize`, `Note`, `Voice`, `renderScore`. Old `pluck`/`sawVoice`/`breathVoice`/`softLimit` removed. |
| `tools/music/fx.ts` (new) | `onePoleLowpass`, `biquadBandpass`, `reverb`, `pingPong`, `haas`, `softClip`, `pan`, `addStereo`. |
| `tools/music/voices.ts` (new) | `modalString` + `KOTO`/`NYLON` presets, `breathTone`, `mutedTrumpet`. |
| `tools/music/scores.ts` (new) | `BASES`, `BASE_ATTACKS`, `SCALES`, `Part`, `PARTS` (the four variants' parts). |
| `tools/music/build-variants.ts` | Stereo render + mix + assertions + encode; `MUSIC_ONLY`. |
| `tools/music/__tests__/fx.test.ts`, `voices.test.ts`, `scores.test.ts`, `synth.test.ts` | Unit tests. |
| `packages/client/src/lib/audio.ts` | `switchMusic`, `preloadLobbyVariants`, `enterLobby` change. |
| `packages/client/src/lib/__tests__/audio.switch.test.ts` | FakeHowl gains `seek`/`once`; crossfade tests. |
| `packages/client/public/sounds/*-music-{rice,corn}.mp3` | Regenerated after the human's verdict (Task 6). |

---

### Task 1: Effects module (`tools/music/fx.ts`)

**Files:**
- Create: `tools/music/fx.ts`
- Test: `tools/music/__tests__/fx.test.ts`

**Interfaces:**
- Produces:
  - `onePoleLowpass(buf: Float32Array, cutoffHz: number): Float32Array`
  - `biquadBandpass(buf: Float32Array, centerHz: number, q: number): Float32Array` (constant-peak-gain RBJ band-pass)
  - `interface ReverbOpts { rt60: number; damping: number; preDelayMs: number }`
  - `reverb(inL: Float32Array, inR: Float32Array, opts: ReverbOpts): [Float32Array, Float32Array]` — wet signal only, same length as the input (the caller pads the input with silence for the tail)
  - `pingPong(inL: Float32Array, inR: Float32Array, delaySeconds: number, feedback: number, lowpassHz: number): [Float32Array, Float32Array]` — wet only
  - `haas(left: Float32Array, right: Float32Array, ms: number): [Float32Array, Float32Array]` — delays the right channel by `ms`
  - `softClip(x: number, threshold = 0.85): number`
  - `pan(mono: Float32Array, position: number): [Float32Array, Float32Array]` — equal power, position −1 (left) … +1 (right)
  - `addStereo(dest: [Float32Array, Float32Array], src: [Float32Array, Float32Array], gain: number): void`
- Consumed by Tasks 2 and 4.

- [ ] **Step 1: Write the failing tests**

Create `tools/music/__tests__/fx.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import { SR, rms } from '../synth.ts'
import { onePoleLowpass, biquadBandpass, reverb, pingPong, haas, softClip, pan, addStereo } from '../fx.ts'

const sine = (freq: number, seconds: number) => Float32Array.from({ length: Math.round(seconds * SR) }, (_, i) => Math.sin((2 * Math.PI * freq * i) / SR))
const dB = (ratio: number) => 20 * Math.log10(ratio)

describe('filters', () => {
  it('onePoleLowpass passes low tones and attenuates high ones', () => {
    const lo = onePoleLowpass(sine(100, 0.5), 1000)
    const hi = onePoleLowpass(sine(8000, 0.5), 1000)
    expect(dB(rms(lo) / rms(sine(100, 0.5)))).toBeGreaterThan(-1)
    expect(dB(rms(hi) / rms(sine(8000, 0.5)))).toBeLessThan(-12)
  })

  it('biquadBandpass passes the centre and rejects a tone two octaves away', () => {
    const inBand = biquadBandpass(sine(900, 0.5), 900, 4)
    const outBand = biquadBandpass(sine(3600, 0.5), 900, 4)
    expect(dB(rms(inBand) / rms(sine(900, 0.5)))).toBeGreaterThan(-2)
    expect(dB(rms(outBand) / rms(sine(3600, 0.5)))).toBeLessThan(-15)
  })
})

describe('reverb', () => {
  it('decays 60 dB in about the requested time (Schroeder integration, damping 0)', () => {
    const n = Math.round(7 * SR)
    const impulse = new Float32Array(n); impulse[0] = 1
    const [wetL] = reverb(impulse, impulse, { rt60: 5, damping: 0, preDelayMs: 0 })
    // Backward energy integration → decay curve; RT60 from the −5…−25 dB slope.
    const edc = new Float64Array(n)
    let acc = 0
    for (let i = n - 1; i >= 0; i--) { acc += wetL[i] * wetL[i]; edc[i] = acc }
    const level = (i: number) => 10 * Math.log10(edc[i] / edc[0])
    let t5 = -1, t25 = -1
    for (let i = 0; i < n; i++) {
      if (t5 < 0 && level(i) <= -5) t5 = i
      if (t25 < 0 && level(i) <= -25) { t25 = i; break }
    }
    const rt60 = (3 * (t25 - t5)) / SR
    expect(rt60).toBeGreaterThan(4)
    expect(rt60).toBeLessThan(6)
  })

  it('keeps the input length and respects the pre-delay', () => {
    const n = SR
    const impulse = new Float32Array(n); impulse[0] = 1
    const [wetL, wetR] = reverb(impulse, impulse, { rt60: 2, damping: 0.3, preDelayMs: 25 })
    expect(wetL.length).toBe(n)
    expect(wetR.length).toBe(n)
    const preDelay = Math.round(0.025 * SR)
    for (let i = 0; i < preDelay - 1; i++) expect(wetL[i]).toBe(0)
    let energyAfter = 0
    for (let i = preDelay; i < n; i++) energyAfter += wetL[i] * wetL[i]
    expect(energyAfter).toBeGreaterThan(0)
  })
})

describe('pingPong', () => {
  it('echoes left input on the right after one delay and back on the left after two', () => {
    const n = SR
    const inL = new Float32Array(n); inL[0] = 1
    const inR = new Float32Array(n)
    const [outL, outR] = pingPong(inL, inR, 0.1, 0.5, 20000)
    const d = Math.round(0.1 * SR)
    expect(Math.abs(outR[d])).toBeGreaterThan(0.3)
    expect(Math.abs(outL[2 * d])).toBeGreaterThan(0.1)
    for (let i = 0; i < d; i++) { expect(outL[i]).toBe(0); expect(outR[i]).toBe(0) }
  })
})

describe('haas, softClip, pan, addStereo', () => {
  it('haas delays only the right channel', () => {
    const l = new Float32Array(SR); l[0] = 1
    const r = new Float32Array(SR); r[0] = 1
    const [outL, outR] = haas(l, r, 12)
    expect(outL[0]).toBe(1)
    expect(outR[0]).toBe(0)
    expect(outR[Math.round(0.012 * SR)]).toBe(1)
  })

  it('softClip is the identity below the threshold and bounded above', () => {
    expect(softClip(0.5)).toBe(0.5)
    expect(softClip(-0.84)).toBe(-0.84)
    expect(softClip(3)).toBeLessThan(1)
    expect(softClip(3)).toBeGreaterThan(0.85)
    expect(softClip(-3)).toBeGreaterThan(-1)
    // continuous at the threshold
    expect(Math.abs(softClip(0.8501) - 0.85)).toBeLessThan(0.001)
  })

  it('pan is equal-power', () => {
    const mono = Float32Array.from([1, 1])
    const [cl, cr] = pan(mono, 0)
    expect(cl[0]).toBeCloseTo(Math.SQRT1_2, 5)
    expect(cr[0]).toBeCloseTo(Math.SQRT1_2, 5)
    const [ll, lr] = pan(mono, -1)
    expect(ll[0]).toBeCloseTo(1, 5)
    expect(lr[0]).toBeCloseTo(0, 5)
  })

  it('addStereo accumulates with gain', () => {
    const dest: [Float32Array, Float32Array] = [new Float32Array(2), new Float32Array(2)]
    addStereo(dest, [Float32Array.from([1, 2]), Float32Array.from([3, 4])], 0.5)
    expect(Array.from(dest[0])).toEqual([0.5, 1])
    expect(Array.from(dest[1])).toEqual([1.5, 2])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tools/music/__tests__/fx.test.ts`
Expected: FAIL — cannot resolve `../fx.ts`.

- [ ] **Step 3: Implement `tools/music/fx.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests and the type check**

Run: `bun test tools/music/__tests__/fx.test.ts && bunx tsc --noEmit -p tools/music`
Expected: PASS (the reverb test renders 7 s through 8 combs — under a second); no type errors.

If the RT60 assertion misses, check the comb gain formula first (`g = 10^(−3·(delay/SR)/rt60)` gives exactly −60 dB after `rt60` seconds of recirculation for damping 0); do not widen the assertion.

- [ ] **Step 5: Commit**

```bash
git add tools/music/fx.ts tools/music/__tests__/fx.test.ts
git commit -m "Add reverb, delay, widener, soft clip and panning for the music layers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Voices (`tools/music/voices.ts`) and pruning `synth.ts`

**Files:**
- Create: `tools/music/voices.ts`
- Modify: `tools/music/synth.ts` (remove `PluckOpts`, `pluck`, `SawOpts`, `sawVoice`, `BreathOpts`, `breathVoice`, `softLimit`)
- Modify: `tools/music/__tests__/synth.test.ts` (drop the `pluck`/`voices`/`softLimit` tests)
- Test: `tools/music/__tests__/voices.test.ts`

**Interfaces:**
- Consumes: `SR`, `envelope`, `normalize` from `synth.ts`; `onePoleLowpass`, `biquadBandpass` from `fx.ts` (Task 1).
- Produces:
  - `interface StringPreset { partials: number; inharmonicity: number; decay: number; decaySlope: number; attackMs: number; attackLowpassHz: number; bodyHz: number; bodyLevel: number }`
  - `KOTO: StringPreset`, `NYLON: StringPreset`
  - `modalString(freq: number, seconds: number, preset: StringPreset, rand: () => number): Float32Array` (peak 0.9)
  - `breathTone(freq: number, seconds: number, rand: () => number): Float32Array` (shakuhachi, peak 0.9)
  - `mutedTrumpet(freq: number, seconds: number): Float32Array` (peak 0.9)
- Consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

Create `tools/music/__tests__/voices.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import { SR, seedRandom, rms } from '../synth.ts'
import { spectralPeak } from './spectrum.ts'
import { modalString, KOTO, NYLON, breathTone, mutedTrumpet } from '../voices.ts'

const cents = (measured: number, target: number) => 1200 * Math.log2(measured / target)
const peakOf = (buf: Float32Array) => { let m = 0; for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i])); return m }
/** Scan ±0.3 % around the target in 0.01 % steps on the steady part of the tone. */
const fundamental = (buf: Float32Array, target: number) =>
  spectralPeak(buf.subarray(Math.round(0.05 * SR), Math.round(1.5 * SR)), target * 0.997, target * 1.003, target * 1e-4)

describe('modalString', () => {
  it.each([220, 440, 659.26, 783.99])('koto is within 1 cent at %p Hz', (f) => {
    const tone = modalString(f, 1.6, KOTO, seedRandom(1))
    expect(Math.abs(cents(fundamental(tone, f), f))).toBeLessThan(1)
  })

  it.each([110, 220, 440])('nylon is within 1 cent at %p Hz', (f) => {
    const tone = modalString(f, 1.6, NYLON, seedRandom(2))
    expect(Math.abs(cents(fundamental(tone, f), f))).toBeLessThan(1)
  })

  it('is peak-normalised, decays, and is deterministic for a seed', () => {
    const a = modalString(440, 2, KOTO, seedRandom(3))
    const b = modalString(440, 2, KOTO, seedRandom(3))
    expect(peakOf(a)).toBeCloseTo(0.9, 2)
    expect(Array.from(a.subarray(0, 1000))).toEqual(Array.from(b.subarray(0, 1000)))
    const head = rms(a.subarray(0, Math.round(0.1 * SR)))
    const tail = rms(a.subarray(a.length - Math.round(0.1 * SR)))
    expect(20 * Math.log10(head / tail)).toBeGreaterThan(20)
  })

  it('nylon is darker than koto (less energy above 2 kHz)', () => {
    const highRatio = (buf: Float32Array) => {
      let hi = 0, all = 0
      for (let f = 2200; f <= 6000; f += 200) hi += spectralPeakPower(buf, f)
      for (let f = 200; f <= 6000; f += 200) all += spectralPeakPower(buf, f)
      return hi / all
    }
    const k = modalString(330, 1, KOTO, seedRandom(4)), ny = modalString(330, 1, NYLON, seedRandom(4))
    expect(highRatio(ny)).toBeLessThan(highRatio(k))
  })
})

describe('breathTone and mutedTrumpet', () => {
  it.each([329.63, 659.26])('breathTone is within 1 cent at %p Hz', (f) => {
    const tone = breathTone(f, 2, seedRandom(5))
    expect(Math.abs(cents(fundamental(tone, f), f))).toBeLessThan(1)
    expect(peakOf(tone)).toBeCloseTo(0.9, 2)
  })

  it.each([493.88, 659.26])('mutedTrumpet is within 1 cent at %p Hz', (f) => {
    const tone = mutedTrumpet(f, 2)
    expect(Math.abs(cents(fundamental(tone, f), f))).toBeLessThan(1)
    expect(peakOf(tone)).toBeCloseTo(0.9, 2)
  })

  it('mutedTrumpet has no energy above 6 kHz worth hearing', () => {
    const tone = mutedTrumpet(440, 1)
    const p6k = spectralPeakPower(tone, 6600)
    const pf = spectralPeakPower(tone, 440)
    expect(10 * Math.log10(p6k / pf)).toBeLessThan(-30)
  })
})

// Local helper: Goertzel power at one frequency (spectrum.ts exposes the peak finder).
function spectralPeakPower(buf: Float32Array, freq: number): number {
  const w = (2 * Math.PI * freq) / SR
  const coeff = 2 * Math.cos(w)
  let s0 = 0, s1 = 0, s2 = 0
  for (let i = 0; i < buf.length; i++) { s0 = buf[i] + coeff * s1 - s2; s2 = s1; s1 = s0 }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tools/music/__tests__/voices.test.ts`
Expected: FAIL — cannot resolve `../voices.ts`.

- [ ] **Step 3: Implement `tools/music/voices.ts`**

```ts
/**
 * Instruments for the crop music layers. All exact-pitch (the fundamental is
 * generated at its equal-tempered frequency, never a rounded delay line),
 * peak-normalised to 0.9, mono; space and width come from fx.ts.
 */
import { SR, envelope, normalize } from './synth.ts'
import { onePoleLowpass, biquadBandpass } from './fx.ts'

export interface StringPreset {
  /** Partials summed above the fundamental. */
  partials: number
  /** Stiffness: partial k sits at k·f·sqrt(1 + B·k²). */
  inharmonicity: number
  /** Seconds for the fundamental to fall 60 dB. */
  decay: number
  /** How much faster each higher partial decays: τ_k = τ₁ / (1 + slope·(k−1)). */
  decaySlope: number
  /** Length of the noise burst that is the pluck. */
  attackMs: number
  /** Low-pass on the burst — lower = softer pluck. */
  attackLowpassHz: number
  /** Body resonance (band-pass on the string sum) and its level. */
  bodyHz: number
  bodyLevel: number
}

/** Bright, quick, a little stiff — a plucked silk string over a paulownia body. */
export const KOTO: StringPreset = {
  partials: 12, inharmonicity: 0.0004, decay: 1.6, decaySlope: 0.45,
  attackMs: 8, attackLowpassHz: 6000, bodyHz: 620, bodyLevel: 0.15,
}

/** Warm and round — nylon over a spruce top. */
export const NYLON: StringPreset = {
  partials: 8, inharmonicity: 0.0001, decay: 2.2, decaySlope: 0.7,
  attackMs: 12, attackLowpassHz: 3000, bodyHz: 180, bodyLevel: 0.25,
}

/** Modal string: decaying partials at exact frequencies plus a filtered noise pluck. */
export function modalString(freq: number, seconds: number, preset: StringPreset, rand: () => number): Float32Array {
  const n = Math.round(seconds * SR)
  const out = new Float32Array(n)
  const tau1 = preset.decay / 6.9078 // e^(−t/τ) reaches −60 dB (0.001) at t = 6.9078·τ
  for (let k = 1; k <= preset.partials; k++) {
    const fk = k * freq * Math.sqrt(1 + preset.inharmonicity * k * k)
    if (fk >= SR / 2) break
    const tau = tau1 / (1 + preset.decaySlope * (k - 1))
    const amp = 1 / k
    const w = (2 * Math.PI * fk) / SR
    for (let i = 0; i < n; i++) out[i] += amp * Math.sin(w * i) * Math.exp(-i / (tau * SR))
  }
  // Pluck: a short noise burst, low-passed, fading over attackMs.
  const burstLen = Math.round((preset.attackMs / 1000) * SR)
  const burst = new Float32Array(n)
  for (let i = 0; i < burstLen; i++) burst[i] = (rand() * 2 - 1) * (1 - i / burstLen)
  const softBurst = onePoleLowpass(burst, preset.attackLowpassHz)
  for (let i = 0; i < n; i++) out[i] += softBurst[i] * 0.6
  // Body: the string sum through a resonance, mixed back in.
  const body = biquadBandpass(out, preset.bodyHz, 3)
  for (let i = 0; i < n; i++) out[i] += body[i] * preset.bodyLevel
  return normalize(out, 0.9)
}

/** Shakuhachi-like breath tone: soft partials, vibrato that arrives late, air in the band of the note. */
export function breathTone(freq: number, seconds: number, rand: () => number): Float32Array {
  const n = Math.round(seconds * SR)
  const out = new Float32Array(n)
  const env = envelope(n, 0.35, 1.2)
  const vibratoStart = 0.4 * SR
  const vibratoDepth = Math.pow(2, 12 / 1200) - 1
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const vib = i < vibratoStart ? 0 : Math.min(1, (i - vibratoStart) / (0.6 * SR))
    const f = freq * (1 + vibratoDepth * vib * Math.sin(2 * Math.PI * 4.5 * t))
    phase += (2 * Math.PI * f) / SR
    out[i] = (Math.sin(phase) + 0.25 * Math.sin(2 * phase) + 0.125 * Math.sin(3 * phase)) * env[i]
  }
  const air = biquadBandpass(Float32Array.from({ length: n }, () => rand() * 2 - 1), freq, 12)
  for (let i = 0; i < n; i++) out[i] += air[i] * 0.1 * env[i]
  return normalize(out, 0.9)
}

/** Distant muted trumpet: band-limited pulse through two formants and a 4 kHz roof, slow late vibrato. */
export function mutedTrumpet(freq: number, seconds: number): Float32Array {
  const n = Math.round(seconds * SR)
  const raw = new Float32Array(n)
  const env = envelope(n, 0.12, 0.6)
  const harmonics = Math.floor(4000 / freq)
  const vibratoStart = 0.5 * SR
  const vibratoDepth = Math.pow(2, 10 / 1200) - 1
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const vib = i < vibratoStart ? 0 : Math.min(1, (i - vibratoStart) / (0.5 * SR))
    const f = freq * (1 + vibratoDepth * vib * Math.sin(2 * Math.PI * 5 * t))
    phase += (2 * Math.PI * f) / SR
    let s = 0
    // Pulse-like spectrum: odd and even harmonics, gently rolling off.
    for (let k = 1; k <= harmonics; k++) s += Math.sin(k * phase) / Math.sqrt(k)
    raw[i] = s * env[i]
  }
  const f1 = biquadBandpass(raw, 900, 4)
  const f2 = biquadBandpass(raw, 1800, 4)
  const mixed = new Float32Array(n)
  for (let i = 0; i < n; i++) mixed[i] = raw[i] * 0.35 + f1[i] + f2[i] * 0.7
  return normalize(onePoleLowpass(onePoleLowpass(mixed, 4000), 4000), 0.9)
}
```

- [ ] **Step 4: Prune `synth.ts` and its tests**

In `tools/music/synth.ts` delete `PluckOpts`, `pluck`, `SawOpts`, `sawVoice`, `BreathOpts`, `breathVoice` and `softLimit` (everything between `envelope` and `mixInto`, plus the `softLimit` function). Update the module doc comment's first sentence to: "Core helpers for the crop music layers: sample rate, seeded PRNG, envelope, mixing, loudness and score rendering (instruments live in voices.ts, effects in fx.ts)."

In `tools/music/__tests__/synth.test.ts` remove the `describe('pluck', …)` and `describe('voices', …)` blocks and the `softLimit` case (rename the last describe to `'rms, scaleTo, normalize'` and drop the `softLimit` `it`); trim the import to `SR, seedRandom, midiToFreq, envelope, mixInto, rms, scaleTo, normalize, renderScore` and drop the `spectralPeak` import if unused.

- [ ] **Step 5: Run the tool tests and the type check**

Run: `bun test tools/music && bunx tsc --noEmit -p tools/music`
Expected: PASS (fx, voices, synth); no type errors. `build-variants.ts` still imports the removed voices and will fail the type check — that is expected until Task 4; if `tsc` reports only `build-variants.ts` errors here, note it in the report and continue (Task 4 rewrites the file).

- [ ] **Step 6: Commit**

```bash
git add tools/music/voices.ts tools/music/synth.ts tools/music/__tests__/voices.test.ts tools/music/__tests__/synth.test.ts
git commit -m "Add exact-pitch modal string, breath tone and muted trumpet voices

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Scores as data (`tools/music/scores.ts`)

**Files:**
- Create: `tools/music/scores.ts`
- Test: `tools/music/__tests__/scores.test.ts`

**Interfaces:**
- Consumes: `Note` from `synth.ts`.
- Produces:
  - `type BaseId = 'lobby-music' | 'match-music'`; `type Crop = 'rice' | 'corn'`
  - `interface BaseInfo { id: BaseId; beats: number; attacks: number[]; scale: number[] }`; `BASES: Record<BaseId, BaseInfo>`
  - `type VoiceName = 'koto' | 'nylon' | 'shakuhachi' | 'trumpet'`
  - `interface Part { voice: VoiceName; notes: Note[]; pan: number; level: number; reverbSend: number; delaySend: number }`
  - `PARTS: Record<BaseId, Record<Crop, Part[]>>`
  - `isInScale(midi: number, scale: number[]): boolean`
- Consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

Create `tools/music/__tests__/scores.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import { BASES, PARTS, isInScale } from '../scores.ts'

const BASE_IDS = ['lobby-music', 'match-music'] as const
const CROPS = ['rice', 'corn'] as const

describe('ornament scores', () => {
  it('keep every onset at least a quarter beat away from every base attack', () => {
    for (const baseId of BASE_IDS) {
      const base = BASES[baseId]
      for (const crop of CROPS) {
        for (const part of PARTS[baseId][crop]) {
          for (const note of part.notes) {
            const beat = ((note.beat % base.beats) + base.beats) % base.beats
            for (const attack of base.attacks) {
              const d = Math.min(Math.abs(beat - attack), base.beats - Math.abs(beat - attack))
              expect(d).toBeGreaterThanOrEqual(0.25)
            }
          }
        }
      }
    }
  })

  it('stay in the base\'s pentatonic scale and inside the loop', () => {
    for (const baseId of BASE_IDS) {
      const base = BASES[baseId]
      for (const crop of CROPS) {
        for (const part of PARTS[baseId][crop]) {
          expect(part.notes.length).toBeGreaterThan(0)
          for (const note of part.notes) {
            expect(isInScale(note.midi, base.scale)).toBe(true)
            expect(note.beat).toBeGreaterThanOrEqual(0)
            expect(note.beat).toBeLessThan(base.beats)
            expect(note.gain ?? 1).toBeGreaterThan(0)
            expect(note.gain ?? 1).toBeLessThanOrEqual(1)
          }
        }
      }
    }
  })

  it('give every part sane mix parameters', () => {
    for (const baseId of BASE_IDS) for (const crop of CROPS) for (const part of PARTS[baseId][crop]) {
      expect(Math.abs(part.pan)).toBeLessThanOrEqual(1)
      expect(part.level).toBeGreaterThan(0)
      expect(part.level).toBeLessThanOrEqual(1)
      expect(part.reverbSend).toBeGreaterThanOrEqual(0)
      expect(part.reverbSend).toBeLessThanOrEqual(1)
      expect(part.delaySend).toBeGreaterThanOrEqual(0)
      expect(part.delaySend).toBeLessThanOrEqual(1)
    }
  })

  it('isInScale compares pitch classes', () => {
    expect(isInScale(64, BASES['lobby-music'].scale)).toBe(true)   // E4
    expect(isInScale(65, BASES['lobby-music'].scale)).toBe(false)  // F4
    expect(isInScale(60, BASES['match-music'].scale)).toBe(true)   // C4
    expect(isInScale(61, BASES['match-music'].scale)).toBe(false)  // C#4
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tools/music/__tests__/scores.test.ts`
Expected: FAIL — cannot resolve `../scores.ts`.

- [ ] **Step 3: Implement `tools/music/scores.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests and the type check**

Run: `bun test tools/music/__tests__/scores.test.ts && bunx tsc --noEmit -p tools/music`
Expected: PASS (placement ≥ 0.25 beat holds: the closest onsets are 0.4 beat from an attack); type errors only in `build-variants.ts` (pending Task 4) are acceptable here.

- [ ] **Step 5: Commit**

```bash
git add tools/music/scores.ts tools/music/__tests__/scores.test.ts
git commit -m "Write the crop ornament parts into the base loops' pauses

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Stereo build with sends, assertions before encode, demo build

**Files:**
- Modify: `tools/music/build-variants.ts` (full rewrite below)
- Test: `tools/music/__tests__/render.test.ts`

**Interfaces:**
- Consumes: `fx.ts` (Task 1), `voices.ts` (Task 2), `scores.ts` (Task 3), `synth.ts` core.
- Produces: `renderLayer(baseId, crop, loopSamples, beatSeconds, seed): Stereo` exported from a new `tools/music/render.ts` (pure, so it is testable); `build-variants.ts` imports it. Env: `MUSIC_OUT`, `MUSIC_ONLY`.

- [ ] **Step 1: Write the failing test**

Create `tools/music/__tests__/render.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import { SR, rms } from '../synth.ts'
import { renderLayer } from '../render.ts'

describe('renderLayer', () => {
  it('renders a stereo layer of exactly the loop length, deterministically, with tails wrapped', () => {
    const loopSamples = Math.round(25.2 * SR)
    const a = renderLayer('lobby-music', 'rice', loopSamples, 0.6, 20260905)
    const b = renderLayer('lobby-music', 'rice', loopSamples, 0.6, 20260905)
    expect(a[0].length).toBe(loopSamples)
    expect(a[1].length).toBe(loopSamples)
    expect(Array.from(a[0].subarray(0, 2000))).toEqual(Array.from(b[0].subarray(0, 2000)))
    // The koto's gap-C phrase at beat 33.5–36.5 rings past the loop end and wraps: the
    // first 200 ms carry reverb tail energy, not silence.
    expect(rms(a[0].subarray(0, Math.round(0.2 * SR)))).toBeGreaterThan(0)
    // Left and right differ (pan + decorrelated reverb).
    let diff = 0
    for (let i = 0; i < loopSamples; i += 97) diff += Math.abs(a[0][i] - a[1][i])
    expect(diff).toBeGreaterThan(0)
  })

  it('renders every variant without NaN and with finite peaks', () => {
    for (const baseId of ['lobby-music', 'match-music'] as const) {
      const beats = baseId === 'lobby-music' ? 42 : 28
      const loopSamples = Math.round(25.2 * SR)
      for (const crop of ['rice', 'corn'] as const) {
        const [l, r] = renderLayer(baseId, crop, loopSamples, 25.2 / beats, 1)
        let peak = 0
        for (let i = 0; i < loopSamples; i++) {
          expect(Number.isFinite(l[i]) && Number.isFinite(r[i])).toBe(true)
          peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]))
        }
        expect(peak).toBeGreaterThan(0)
      }
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tools/music/__tests__/render.test.ts`
Expected: FAIL — cannot resolve `../render.ts`.

- [ ] **Step 3: Implement `tools/music/render.ts`**

```ts
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
```

- [ ] **Step 4: Rewrite `tools/music/build-variants.ts`**

```ts
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
    // Level the layer (tails included) 14 dB under the base, on its mid signal.
    const layerGain = (baseRms * Math.pow(10, LAYER_DB / 20)) / Math.max(rms(mid(layer[0], layer[1])), 1e-9)
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
```

- [ ] **Step 5: Run the tests, the type check, and a demo build into scratch**

Run: `bun test tools/music && bunx tsc --noEmit -p tools/music`
Expected: PASS, no type errors (the old voice imports are gone).

Demo build (do NOT write into `public/sounds` in this task):

```bash
MUSIC_OUT=/private/tmp/claude-501/-Users-pohare-Desktop-my-StormGrid/95029ca5-b47d-4c57-bce9-7c3c5cbf12b5/scratchpad/music-v2 MUSIC_ONLY=lobby-music-rice bun tools/music/build-variants.ts
ffprobe -v error -show_entries format=duration:stream=bit_rate -of default=nw=1 /private/tmp/claude-501/-Users-pohare-Desktop-my-StormGrid/95029ca5-b47d-4c57-bce9-7c3c5cbf12b5/scratchpad/music-v2/lobby-music-rice.mp3
```

Expected: one log line with `100.0 BPM`, `|Δ| ≤ 0.5 dB`, `peak < 0.95`; duration ≈ 25.2 s, 128 kbps. Report the printed numbers. If the loudness assertion trips, the reverb tails made the layer's RMS large relative to its audible level — lower `LAYER_DB` is NOT the fix; report it and stop (the controller decides).

- [ ] **Step 6: Commit (code only — no assets)**

```bash
git add tools/music/render.ts tools/music/build-variants.ts tools/music/__tests__/render.test.ts
git commit -m "Render the crop layers in stereo with reverb and delay sends, assert before encoding

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Seamless lobby crop switch in the client

**Files:**
- Modify: `packages/client/src/lib/audio.ts` (`enterLobby` ~line 306; add `switchMusic`, `preloadLobbyVariants` next to it; export nothing new except through the returned API)
- Test: `packages/client/src/lib/__tests__/audio.switch.test.ts` (extend the FakeHowl and add two tests)

**Interfaces:**
- Produces: `switchMusic(id: LoopId, duration = 600)` on the audio system's returned object (for tests); `enterLobby(character)` behaviour change per Global Constraints.

- [ ] **Step 1: Extend the FakeHowl and write the failing tests**

In `packages/client/src/lib/__tests__/audio.switch.test.ts`, extend `FakeHowl`:

```ts
  private pos = 0
  private loadListeners: Array<() => void> = []
  seek(v?: number) {
    if (v === undefined) return this.pos
    if (this.state_ !== 'loaded') { this.queue.push(() => this.seek(v)); return this }
    this.pos = v
    return this
  }
  once(event: string, cb: () => void) { if (event === 'load') this.loadListeners.push(cb); return this }
```

and make `finishLoad()` fire the load listeners after draining the queue:

```ts
  finishLoad() {
    this.state_ = 'loaded'
    const q = this.queue
    this.queue = []
    for (const fn of q) fn()
    const ls = this.loadListeners
    this.loadListeners = []
    for (const cb of ls) cb()
  }
```

Add tests:

```ts
describe('switchMusic keeps the playhead across a crop switch', () => {
  beforeEach(() => { FakeHowl.bySrc.clear() })

  it('starts the new variant at the old one\'s position and stops the old one after the fade', async () => {
    const audio = createAudioSystem()
    audio.enterLobby('rice')
    await sleep(450)
    const rice = howl('lobby-music-rice')
    rice.finishLoad()
    expect(rice.playing()).toBe(true)
    rice.seek(7.3)
    // Preloading put the sibling variants into 'loading'; let corn finish.
    const corn = howl('lobby-music-corn')
    corn.finishLoad()

    audio.enterLobby('corn')
    expect(corn.seek()).toBe(7.3)
    expect(corn.playing()).toBe(true)
    await sleep(700) // fade 600 ms + stop timer
    expect(rice.playing()).toBe(false)
    audio.dispose()
  })

  it('lands in sync when the incoming file is still loading', async () => {
    const audio = createAudioSystem()
    audio.enterLobby('rice')
    await sleep(450)
    const rice = howl('lobby-music-rice')
    rice.finishLoad()
    const corn = howl('lobby-music-corn')
    expect(corn.state()).toBe('loading') // preloaded on entering the lobby

    audio.enterLobby('corn')
    rice.seek(9.1) // the base keeps running while corn downloads
    corn.finishLoad()
    expect(corn.seek()).toBe(9.1)
    expect(corn.playing()).toBe(true)
    audio.dispose()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/client && bun test src/lib/__tests__/audio.switch.test.ts`
Expected: the two new tests FAIL (`corn.seek()` is 0 — today's `enterLobby` restarts from the beginning; corn is not preloaded).

- [ ] **Step 3: Implement `switchMusic`, `preloadLobbyVariants`, and the `enterLobby` change**

In `audio.ts`, above `function enterLobby(...)`:

```ts
  const LOBBY_MUSIC_IDS: LoopId[] = LOOP_IDS.filter((id) => id === 'lobby-music' || id.startsWith('lobby-music-'))

  /** Start the download of the other lobby variants so a later pick switches without a gap. */
  function preloadLobbyVariants() {
    for (const id of LOBBY_MUSIC_IDS) {
      const h = howls.get(id)!
      if (h.state() === 'unloaded') h.load()
    }
  }

  function currentMusic(): LoopId | null {
    for (const id of activeLoops) if (defs.get(id)!.layer === 'music') return id as LoopId
    return null
  }

  /**
   * Crossfade the music layer to `id`, keeping the playhead — the crop variants
   * share the base loop, so a lobby pick changes the ornaments without a hiccup.
   * A file that is still downloading re-reads the position when it lands.
   */
  function switchMusic(id: LoopId, duration = 600) {
    if (disposed) return
    const outgoingId = currentMusic()
    if (outgoingId === id) return
    const outgoing = outgoingId ? howls.get(outgoingId)! : null
    const h = howls.get(id)!
    const d = defs.get(id)!
    const target = d.baseVolume * layerGain(d.layer)
    cancelPendingStop(id)
    const start = () => {
      if (disposed) return
      const position = outgoing && outgoing.playing() ? (outgoing.seek() as number) : 0
      h.volume(0)
      h.seek(position)
      h.play()
      h.fade(0, target, duration)
    }
    if (h.state() === 'loaded') start()
    else { h.once('load', start); h.load() }
    activeLoops.add(id)
    if (outgoingId) fadeOut(outgoingId, duration)
  }
```

Replace `enterLobby`:

```ts
  function enterLobby(character?: CharacterType) {
    cancelSceneTimers()
    stopWeather()
    const id = resolveMusicId('lobby-music', character)
    const current = currentMusic()
    const lobbyMusicOn = current !== null && LOBBY_MUSIC_IDS.includes(current) && activeLoops.has('lobby-pad')
    if (lobbyMusicOn) {
      // Already in the lobby: only the crop changed — keep the base running.
      switchMusic(id)
      preloadLobbyVariants()
      return
    }
    fadeOutLayer('ambient', 1000)
    fadeOutLayer('music', 1000)
    sceneTimers.push(safeTimeout(() => {
      fadeIn('lobby-pad', 1200)
      fadeIn(id, 1500)
      preloadLobbyVariants()
    }, 400))
  }
```

Add `switchMusic,` to the returned object (next to `enterLobby`).

Note on Howler: `seek(position)` on a loaded Howl before `play()` sets the sound's start position (`sound._seek`), which `play()` honours; on a loading Howl both calls are queued in order and run when the file lands — but `start` itself runs on the `load` event, so the position it reads is current. `fadeOut` (already fixed for loading Howls) handles the outgoing side.

- [ ] **Step 4: Run the tests and the type check**

Run: `cd packages/client && bun test && bunx vue-tsc -b --noEmit`
Expected: PASS (all client tests incl. the four in `audio.switch.test.ts`); no type errors. If `vue-tsc` fails only inside files this plan did not touch (another session's in-progress work in the same checkout), report which files and treat the check as passed for this task.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/lib/audio.ts packages/client/src/lib/__tests__/audio.switch.test.ts
git commit -m "Crossfade lobby music between crop variants at the same playhead

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Listening rounds, final assets, docs (controller + human)

Not a subagent task. After Task 4 the controller sends the demo `lobby-music-rice.mp3` (scratch build) to the chat and records the human's verdict. Adjustments go into `scores.ts` (notes, gains, sends) or `voices.ts`/`render.ts` (timbre, reverb, levels) as ordinary commits with the tool tests green, then a new scratch build and a new file to the chat. When the demo is accepted:

1. `bun run music:build` (all four into `public/sounds`), `ffprobe` each (≈ 25.2 s, 128 kbps), `bun test tools/music`, `cd packages/client && bun test`.
2. Send the three remaining files to the chat; one more round if needed.
3. Commit the four MP3s: `git add packages/client/public/sounds/lobby-music-rice.mp3 packages/client/public/sounds/lobby-music-corn.mp3 packages/client/public/sounds/match-music-rice.mp3 packages/client/public/sounds/match-music-corn.mp3` with message "Regenerate the crop music variants with the redesigned layer" + trailer.
4. Append an Outcome section to the spec (what changed after listening, final levels) and commit it.

---

## Self-review notes

- Spec coverage: engine (Tasks 1–2), writing (Task 3), mix and build (Task 4), client crossfade + preload (Task 5), process/acceptance (Task 6). The spec's "layer at −14 dB RMS with tails" → `LAYER_DB = -14` on the layer's mid RMS after rendering (tails included) ✓; "peak < 0.95, clip above 0.85" ✓; "output ±0.5 dB" ✓; "assert before writing" ✓ (`encode` last).
- Type consistency: `Stereo` from `fx.ts` is used by `render.ts`; `Part`/`PARTS`/`BASES`/`BaseId`/`Crop` from `scores.ts`; `modalString(freq, seconds, preset, rand)`, `breathTone(freq, seconds, rand)`, `mutedTrumpet(freq, seconds)` match between Task 2 and `render.ts`; `renderLayer(baseId, crop, loopSamples, beatSeconds, seed)` matches its test and the build script; `switchMusic(id, duration)` matches the tests.
- Placement check by hand: lobby onsets 8.5–11 (attacks 6, 12 → ≥ 1), 19.5–22 (17, 24 → ≥ 2), 33.5–35 (30, 36 → 1), 24.4 (24 → 0.4), 12.4/14.4 (12/14 → 0.4); match onsets 5.4–6.9 (5, 8 → 0.4), 11.3 (11 → 0.3 ✓ ≥ 0.25), 18.4–19.6 (18, 20 → 0.4), 20.4/20.9 (20, 22 → 0.4). Scale check: all pitch classes listed in Global Constraints.
