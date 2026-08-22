#!/usr/bin/env python3
"""Reproducible sound synthesis for wheee. Requires numpy and ffmpeg.

Usage: python3 scripts/gen_sounds.py            # regenerate every sound this script owns
       python3 scripts/gen_sounds.py thunder-crack

Each sound is a pure function of the fixed seed. The original 26 sounds were
made by a script that never reached the repo; new sounds join this one."""
import numpy as np, subprocess, sys, wave, tempfile, os

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), "..", "packages", "client", "public", "sounds")
SEED = 20260821

def _envelope(n, attack, decay):   # exponential attack/decay envelope
    t = np.arange(n) / SR
    return np.minimum(t / attack, 1.0) * np.exp(-np.maximum(t - attack, 0) / decay)

def _lowpass(x, cutoff_hz):        # simple one-pole lowpass
    dt = 1 / SR
    rc = 1 / (2 * np.pi * cutoff_hz)
    a = dt / (rc + dt)
    y = np.empty_like(x); acc = 0.0
    for i, v in enumerate(x): acc += a * (v - acc); y[i] = acc
    return y

def thunder_crack(rng):
    n = int(SR * 2.6)
    body = rng.standard_normal(n)
    # falling lowpass sweep: bright crack collapsing into a rumble
    out = np.zeros(n)
    for i, (lo, hi) in enumerate([(0.0, 0.12), (0.12, 0.6), (0.6, 2.6)]):
        a, b = int(lo * SR), int(hi * SR)
        out[a:b] = _lowpass(body[a:b], [2800, 900, 220][i])
    out *= _envelope(n, 0.004, 0.9)
    out[: int(0.01 * SR)] += rng.standard_normal(int(0.01 * SR)) * 0.8   # the whip transient
    return out

def thunder_distant(rng):
    n = int(SR * 4.0)
    out = _lowpass(rng.standard_normal(n), 160)
    swell = np.sin(np.linspace(0, np.pi, n)) ** 2
    return out * swell

def static_crackle(rng):
    n = int(SR * 3.0)
    out = _lowpass(rng.standard_normal(n), 6000) * 0.06
    ticks = rng.random(n) < (28 / SR)          # sparse impulse train
    out[ticks] += rng.standard_normal(ticks.sum()) * 0.9
    return out

SOUNDS = {"thunder-crack": thunder_crack, "thunder-distant": thunder_distant, "static-crackle": static_crackle}

def write(name, data):
    data = (data / (np.abs(data).max() + 1e-9) * 32767 * 0.9).astype(np.int16)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        with wave.open(f, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(data.tobytes())
        tmp = f.name
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp,
                    "-codec:a", "libmp3lame", "-qscale:a", "4", "-bitexact", "-map_metadata", "-1",
                    os.path.join(OUT, name + ".mp3")], check=True)
    os.unlink(tmp)

if __name__ == "__main__":
    names = sys.argv[1:] or list(SOUNDS)
    for name in names:
        rng = np.random.default_rng([SEED, *name.encode()])
        write(name, SOUNDS[name](rng))
        print("wrote", name + ".mp3")
