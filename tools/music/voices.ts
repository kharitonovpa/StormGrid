/**
 * Instruments for the crop music layers. All fundamentals within 0.35 cents of
 * equal temperament (the k = 1 stiffness term of the modal string); no rounded
 * delay lines. Peak-normalised to 0.9, mono; space and width come from fx.ts.
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

/** Distant muted trumpet: band-limited pulse through two formants and two one-pole
 *  low-passes at 4 kHz (12 dB/oct roof), slow late vibrato. */
export function mutedTrumpet(freq: number, seconds: number): Float32Array {
  const n = Math.round(seconds * SR)
  const raw = new Float32Array(n)
  const env = envelope(n, 0.12, 0.6)
  const harmonics = Math.max(1, Math.floor(4000 / freq))
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
