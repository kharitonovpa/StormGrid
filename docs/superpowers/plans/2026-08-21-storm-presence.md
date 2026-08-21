# Storm Presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the storm a body — a sky dome that darkens toward the coming wind across the five ticks, a particle storm-front that advances and sweeps the board at the cataclysm, a rising audio bed, and a restored Python sound pipeline.

**Architecture:** One new client module `lib/storm.ts` owns a permanent gradient dome (ShaderMaterial hemisphere; intensity 0 is pixel-identical to today's void) and a particle front curtain, exposed through a small API that App.vue feeds from messages it already receives. No server, protocol, or engine changes of any kind.

**Tech Stack:** Vue 3 + Three.js (client), Howler (audio automation only), Python 3 + numpy + ffmpeg (sound generator script).

## Global Constraints

- **No server/protocol/engine changes.** The engine test suite must be byte-identical in outcome (run it once at the end to prove nothing leaked).
- **The sky never knows more than the instruments:** broken vane → azimuth scrambles chaotically; the dome/front render only what the dial already shows (spec hard constraint, lesson of the barometer-rim leak).
- Intensity 0 must render **pixel-identical** to the current `scene.background = 0x0a0e14` void (verified by screenshot diff).
- **No light flashes** in this feature — the dome only darkens; the photosensitivity budget stays with the bolt.
- Discharge rules (spec "Discharge"): cataclysm drains the sector over ~1.5–2 s; match end ~2 s exhale; `resetVisuals()` paths fade ~0.3 s; never an instant snap; azimuth never jumps while the storm is visible.
- The front sweep obeys the existing `liveStormGeneration` guard and the `struckDead.length === 0` gate in App.vue's `weather:result`.
- `prefers-reduced-motion`: dome still animates (slow, low contrast), curtain cross-fades instead of sweeping, camera tremor off entirely.
- Replays and the lobby get NO storm presence (reset to 0 on those paths).
- Direction mapping matches the board compass (`compass.ts`: N is −z): world azimuth angle = `atan2(x, z)`, table `{ N: Math.PI, E: Math.PI / 2, S: 0, W: -Math.PI / 2 }`.
- Commit style: short imperative sentence, no prefixes, trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Client verification command: `bun run --cwd packages/client build` (vue-tsc + vite) — must be clean after every task.

---

### Task 1: The sky dome (`lib/storm.ts`, dome half)

**Files:**
- Create: `packages/client/src/lib/storm.ts`
- Reference (read, do not modify): `packages/client/src/lib/wind.ts` (system shape), `packages/client/src/components/ForecastPanel.vue:24-41,115-144` (needle spring/oscillation), `packages/client/src/App.vue` (grep `new THREE.PerspectiveCamera` for the camera's far plane — pick a dome radius comfortably inside it).

**Interfaces:**
- Consumes: nothing new.
- Produces (Tasks 2–4 rely on these exact names):
  ```ts
  export function createStormSystem(scene: THREE.Scene): StormSystem
  export type StormSystem = {
    /** What the dial knows: wind candidates, vane state, whether lightning threatens (calm+stormy = zenith mode). */
    setForecast(candidates: WindDir[], vaneBroken: boolean, stormy: boolean): void
    /** Eased build-up 0..1 across the ticking phase. */
    setProgress(t: number): void
    /** Cataclysm crossing (Task 2). Resolves when the curtain has crossed. */
    sweep(dir: WindDir): Promise<void>
    /** Lightning hush: freeze the front, then disperse (Task 2). */
    halt(): void
    /** Discharge to zero. mode: 'cataclysm' ~1.8s | 'exhale' ~2s | 'fast' ~0.3s */
    discharge(mode: 'cataclysm' | 'exhale' | 'fast'): void
    /** Tick-5 tremor gate (Task 4 reads getCameraOffset). */
    setTremor(active: boolean): void
    getCameraOffset(): THREE.Vector3
    update(dt: number): void
    dispose(): void
  }
  ```

- [ ] **Step 1: Create the module with the dome implementation**

```ts
import * as THREE from 'three'
import type { WindDir } from '@wheee/shared'

/* ── Constants ──────────────────────────────────────────── */

const DOME_RADIUS = 220            // verify: must sit inside the camera far plane
const BASE = new THREE.Color(0x0a0e14)          // today's void, exactly
const STORM = new THREE.Color(0x1a1230)         // deep slate-violet mass
const DIM = new THREE.Color(0x070a10)           // the rest of the sky sinks slightly

const DIR_AZIMUTH: Record<WindDir, number> = { N: Math.PI, E: Math.PI / 2, S: 0, W: -Math.PI / 2 }

// The dial needle's spring feel (ForecastPanel), slowed for a sky-sized mass.
const SPRING_K = 3.2
const SPRING_D = 2.6
const OSC_RATE = 0.65              // needle uses 1.3; the sky drifts at half tempo
const BROKEN_JUMP_MIN = 0.5
const BROKEN_JUMP_MAX = 1.2

const SPREAD_MIN = 0.55            // radians, sector half-width at intensity 0
const SPREAD_MAX = 1.15            // swollen mass at intensity 1

const DISCHARGE_RATES = { cataclysm: 1 / 1.8, exhale: 1 / 2.0, fast: 1 / 0.3 }

const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function createStormSystem(scene: THREE.Scene) {
  /* ── Dome ── */
  const geo = new THREE.SphereGeometry(DOME_RADIUS, 48, 24)
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uAzimuth:   { value: 0 },
      uIntensity: { value: 0 },
      uSpread:    { value: SPREAD_MIN },
      uZenith:    { value: 0 },      // 1 = calm+stormy: menace overhead, horizon clean
      uBase:  { value: BASE },
      uStorm: { value: STORM },
      uDim:   { value: DIM },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uAzimuth, uIntensity, uSpread, uZenith;
      uniform vec3 uBase, uStorm, uDim;
      varying vec3 vDir;
      void main() {
        float ang = atan(vDir.x, vDir.z);
        float d = abs(mod(ang - uAzimuth + 3.14159265, 6.2831853) - 3.14159265);
        // horizon sector: strongest at the horizon, fading by 45 degrees up
        float horizon = smoothstep(uSpread, 0.0, d) * smoothstep(0.7, 0.05, vDir.y) * (1.0 - uZenith);
        // zenith mode: darkness pools overhead instead
        float zenith = smoothstep(0.25, 0.9, vDir.y) * uZenith;
        float mass = clamp(horizon + zenith, 0.0, 1.0) * uIntensity;
        vec3 sky = mix(uBase, uDim, uIntensity * 0.6);   // the whole world dims a little
        gl_FragColor = vec4(mix(sky, uStorm, mass), 1.0);
      }
    `,
  })
  const dome = new THREE.Mesh(geo, mat)
  dome.renderOrder = -1
  scene.add(dome)

  /* ── State ── */
  let candidates: WindDir[] = []
  let vaneBroken = false
  let zenithTarget = 0
  let azimuth = 0
  let azVel = 0
  let oscT = 0
  let brokenT = 0
  let brokenTarget = 0
  let progress = 0                  // set by ticks
  let intensity = 0                 // eased toward progress, or drained by discharge
  let discharging: keyof typeof DISCHARGE_RATES | null = null
  let sleeping = true               // true while intensity === 0 and target === 0

  function shortestArc(from: number, to: number): number {
    let d = to - from
    while (d > Math.PI) d -= 2 * Math.PI
    while (d < -Math.PI) d += 2 * Math.PI
    return d
  }

  function azimuthTarget(): number {
    if (vaneBroken) return brokenTarget
    if (candidates.length === 0) return azimuth
    if (candidates.length === 1) return DIR_AZIMUTH[candidates[0]]
    const a = DIR_AZIMUTH[candidates[0]]
    const b = DIR_AZIMUTH[candidates[1]]
    const t = (Math.sin(oscT * OSC_RATE) + 1) / 2
    return a + shortestArc(a, b) * t
  }

  return {
    setForecast(c: WindDir[], broken: boolean, stormy: boolean) {
      candidates = [...c]
      vaneBroken = broken
      zenithTarget = c.length === 0 && stormy ? 1 : 0
      discharging = null
      // A dead sky may snap its azimuth to the newborn storm — invisible at intensity 0.
      if (sleeping && c.length > 0) { azimuth = DIR_AZIMUTH[c[0]]; azVel = 0 }
    },
    setProgress(t: number) {
      progress = Math.max(0, Math.min(1, t))
      discharging = null
    },
    discharge(mode: 'cataclysm' | 'exhale' | 'fast') {
      discharging = mode
      progress = 0
    },
    setTremor(_active: boolean) { /* Task 4 */ },
    getCameraOffset() { return new THREE.Vector3() },  // Task 4
    sweep(_dir: WindDir) { return Promise.resolve() }, // Task 2
    halt() { /* Task 2 */ },
    update(dt: number) {
      oscT += dt
      if (vaneBroken) {
        brokenT += dt
        if (brokenT > BROKEN_JUMP_MIN + Math.random() * (BROKEN_JUMP_MAX - BROKEN_JUMP_MIN)) {
          brokenTarget = Math.random() * 2 * Math.PI - Math.PI
          brokenT = 0
        }
      }
      // azimuth spring (drifting mass, never a visible jump)
      const force = shortestArc(azimuth, azimuthTarget()) * SPRING_K - azVel * SPRING_D
      azVel += force * dt
      azimuth += azVel * dt

      // intensity: eased toward progress, or drained by a discharge
      if (discharging) {
        intensity = Math.max(0, intensity - DISCHARGE_RATES[discharging] * dt)
        if (intensity === 0) discharging = null
      } else {
        const target = progress
        intensity += (target - intensity) * Math.min(1, dt * 1.6)
        if (Math.abs(target - intensity) < 0.004) intensity = target
      }
      sleeping = intensity < 0.002 && progress === 0 && !discharging

      const u = mat.uniforms
      u.uAzimuth.value = azimuth
      u.uIntensity.value = intensity
      u.uSpread.value = SPREAD_MIN + (SPREAD_MAX - SPREAD_MIN) * intensity
      u.uZenith.value += (zenithTarget - u.uZenith.value) * Math.min(1, dt * 2)
    },
    dispose() {
      scene.remove(dome)
      geo.dispose()
      mat.dispose()
    },
  }
}

export type StormSystem = ReturnType<typeof createStormSystem>
```

(`REDUCED` is intentionally declared now and consumed in Tasks 2/4 — if `vue-tsc` flags it unused after this task, prefix it `_REDUCED` and rename back in Task 2.)

- [ ] **Step 2: Verify the camera far plane fits the dome**

Run: `grep -n "PerspectiveCamera" packages/client/src/App.vue`
Expected: the far argument ≥ 300. If it is smaller, lower `DOME_RADIUS` to `far * 0.8` and note it in the commit message.

- [ ] **Step 3: Build**

Run: `bun run --cwd packages/client build`
Expected: clean (the module compiles standalone; nothing imports it yet).

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/lib/storm.ts
git commit -m "Raise a sky dome that leans toward the wind"
```

---

### Task 2: The storm front (curtain + sweep + halt)

**Files:**
- Modify: `packages/client/src/lib/storm.ts`
- Reference: `packages/client/src/lib/wind.ts:14-57` (stream/dust particle idiom), `packages/client/src/lib/constants.ts` (`SIZE`, `HALF`).

**Interfaces:**
- Consumes: Task 1's module internals (`azimuth`, `intensity`, `sleeping`, `REDUCED`).
- Produces: working `sweep(dir: WindDir): Promise<void>` and `halt(): void` with the exact semantics below; Task 3 wires them.

- [ ] **Step 1: Implement the curtain**

Inside `createStormSystem`, add a particle band (follow `wind.ts`'s BufferGeometry + PointsMaterial pattern — additive, `depthWrite: false`, no textures):

```ts
const FRONT_COUNT = 400
const FRONT_FAR = HALF * 3          // import { HALF } from './constants'
const FRONT_NEAR = HALF * 1.15      // just beyond the board edge at tick 5
const FRONT_HEIGHT = 9
const SWEEP_MS = 1200
```

Each particle: a slot along the arc (arc half-width = the dome's current spread), a height `0..FRONT_HEIGHT`, a personal jitter phase. Every `update(dt)`:

- curtain center distance `frontDist = FRONT_FAR - (FRONT_FAR - FRONT_NEAR) * intensity` (overridden during a sweep),
- world position per particle: `angle = azimuth + arcOffset`, `x = sin(angle) * (frontDist + jitter)`, `z = cos(angle) * (frontDist + jitter)`, `y` bobbing slowly,
- material opacity `= 0.35 * intensity` (0 → invisible, no separate visibility bookkeeping),
- hidden entirely while `zenithTarget === 1` (calm forecast: nothing comes along the ground).

- [ ] **Step 2: Implement `sweep` and `halt`**

```ts
let sweepToken = 0
let halted = false

function sweep(dir: WindDir): Promise<void> {
  if (REDUCED || halted) { /* reduced motion: cross-fade out instead */ discharge('cataclysm'); return Promise.resolve() }
  const token = ++sweepToken
  const from = frontDist
  const to = -HALF * 1.2            // across and past the board
  const started = performance.now()
  azVel = 0
  candidates = [dir]                // the storm commits to its real direction
  return new Promise((resolve) => {
    const step = () => {
      if (token !== sweepToken) return resolve()
      const t = Math.min(1, (performance.now() - started) / SWEEP_MS)
      sweepOverride = from + (to - from) * (t * t)   // accelerating crossing
      if (t >= 1) { sweepOverride = null; resolve() } else requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
}

function halt() {                    // lightning hush: the front freezes mid-air
  halted = true
  sweepToken++                       // cancels any sweep in flight (its promise resolves)
}
```

`discharge()` clears `halted`; a halted front just stops advancing (its `frontDist` freezes) and then drains with the cataclysm discharge. `sweepOverride: number | null` module state takes precedence over the intensity-derived `frontDist` in `update`.

- [ ] **Step 3: Build**

Run: `bun run --cwd packages/client build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/lib/storm.ts
git commit -m "March a particle front ahead of the gale"
```

---

### Task 3: App.vue wiring (lifecycle, forecast, ticks, cataclysm, discharge)

**Files:**
- Modify: `packages/client/src/App.vue` — system creation (where `windSystem`/`rainSystem`/`lightningSystem` are created, grep `createLightningSystem(`), render loop (`lightning.update(dt)` line), teardown (`sceneCleanup`), `applyGameState`, the `tick:start` / `round:start` / `weather:result` / `game:end`-flush handlers, `resetVisuals()`, replay paths.

**Interfaces:**
- Consumes: `createStormSystem`, `StormSystem` (Tasks 1–2); existing `liveStormGeneration`, `struckDead`, `hasWind`, `concludeStorm` machinery in the `weather:result` handler.
- Produces: a fully-driven storm presence; Task 4 adds audio/tremor calls at the points marked here.

- [ ] **Step 1: Lifecycle**

Create `stormSystem = createStormSystem(scene)` beside `lightningSystem`; call `stormSystem.update(dt)` in the render loop next to `lightning.update(dt)`; `dispose()` + null it in the same teardown; `stormSystem.discharge('fast')` inside `resetVisuals()` (this covers reconnect, watcher redirect, lobby return, replay enter/exit, and `round:start`'s reset path — verify `round:start` actually calls `resetVisuals`; it does at the `case 'round:start'` handler).

- [ ] **Step 2: Forecast → dome**

In `applyGameState` (or a `watch` beside the storm-ambience one added for lightning — find `setStormAmbience`), feed:

```ts
const f = state.forecast
stormSystem?.setForecast(
  f.windCandidates,
  f.instrumentsBroken[myViewSide].vane,     // same side the dial uses
  f.lightningProbability >= 0.5,
)
```

Guard: only during `forecast`/`ticking` phases; replay mode (`replayMode.value`) never calls it (replays keep intensity 0).

- [ ] **Step 3: Ticks → progress**

In `case 'tick:start'`: `stormSystem?.setProgress((msg.tick + 1) / 5)` (live matches only, not replay). In `case 'round:start'` the reset already happened via `resetVisuals`; the new forecast then rebuilds from zero — spec's "a storm dies, the next one is born".

- [ ] **Step 4: Cataclysm choreography**

In the `weather:result` handler, inside the existing generation-guarded block:

- Lethal bolt (`struckDead.length > 0`): call `stormSystem?.halt()` at the start of the hush (next to `audio.beginHush()`), and `stormSystem?.discharge('cataclysm')` right after the strike resolves.
- Wind runs (`hasWind(weather.type) && struckDead.length === 0`): replace the bare `windSystem?.setVisible(true)` moment with:

```ts
const sweepP = stormSystem?.sweep(weather.dir) ?? Promise.resolve()
setTimeout(() => { if (gen === liveStormGeneration) { windSystem?.setVisible(true); audio.startWind() } }, 400)
storm.push(sweepP)          // join the existing Promise.all storm array
stormSystem?.discharge('cataclysm')
```

  (The wind lines fade in 400 ms into the crossing — born from the front's leading edge; the sweep promise joins the storm barrier so `concludeStorm` still waits for everything.)
- No wind and no bolt (pure-rain architect weather): just `stormSystem?.discharge('cataclysm')`.
- The `pendingGameEnd` flush (`concludeStorm`) additionally calls `stormSystem?.discharge('exhale')` when a winner exists — the slow fade behind the overlay.

- [ ] **Step 5: Build + handler audit**

Run: `bun run --cwd packages/client build`
Expected: clean. Then re-read the `weather:result` handler top-to-bottom and confirm: every early-return path (stale generation, no playersSystem) still discharges the storm (add `stormSystem?.discharge('fast')` to the stale path).

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/App.vue
git commit -m "Let the match feed the storm"
```

---

### Task 4: Audio bed + camera tremor

**Files:**
- Modify: `packages/client/src/lib/audio.ts` (new `setStormBed`), `packages/client/src/lib/storm.ts` (tremor), `packages/client/src/App.vue` (bed calls + camera offset around the render call).

**Interfaces:**
- Consumes: audio.ts internals (`howls`, `activeLoops`, `resolveVolume`, the loop start/stop helpers `startWind` uses); `StormSystem.setTremor/getCameraOffset` stubs from Task 1.
- Produces: `audio.setStormBed(level: number): void` — 0 stops the bed; the cataclysm's `startWind()`/`beginHush()` always win over it.

- [ ] **Step 1: `setStormBed` in audio.ts**

```ts
let bedLevel = 0
let bedOwned = false   // true while the bed (not the cataclysm) started wind-loop
function setStormBed(level: number) {
  if (disposed) return
  bedLevel = Math.max(0, Math.min(1, level))
  const h = howls.get('wind-loop')!
  if (bedLevel > 0) {
    if (!activeLoops.has('wind-loop')) { startLoop('wind-loop'); bedOwned = true }
    if (bedOwned) h.volume(resolveVolume('wind-loop') * 0.35 * bedLevel)
  } else if (bedOwned && activeLoops.has('wind-loop')) {
    stopLoop('wind-loop'); bedOwned = false
  }
}
```

(Adapt `startLoop`/`stopLoop` to the file's actual loop helpers — the same ones `startWind()` uses. `startWind()` must set `bedOwned = false` so the cataclysm takes ownership at full volume; `stopWeather()` already stops the loop either way. `beginHush()` needs no change — it fades whatever volume the loop has.) Export `setStormBed` from the returned object.

- [ ] **Step 2: Drive the bed** — in App.vue's `tick:start` (same place as `setProgress`):

```ts
audio.setStormBed(msg.tick >= 1 ? (msg.tick + 1) / 5 : 0)   // silent tick 1, humming by tick 5
```

and `audio.setStormBed(0)` in `resetVisuals()` and at the start of the `weather:result` handler (the cataclysm takes over the soundscape).

- [ ] **Step 3: Tremor in storm.ts**

Fill the Task 1 stubs:

```ts
let tremorActive = false
let tremorAmp = 0
const tremorOffset = new THREE.Vector3()
// in update(dt):
tremorAmp += ((tremorActive && !REDUCED ? 1 : 0) - tremorAmp) * Math.min(1, dt * 2.5)
if (tremorAmp > 0.001) {
  const t = oscT * 9 * 2 * Math.PI
  tremorOffset.set(Math.sin(t) * 0.05, Math.sin(t * 1.31) * 0.03, Math.cos(t * 0.87) * 0.05).multiplyScalar(tremorAmp)
} else tremorOffset.set(0, 0, 0)
// setTremor(active) sets tremorActive; getCameraOffset() returns tremorOffset
```

- [ ] **Step 4: Apply the offset around the render call** — App.vue: grep `renderer.render`; wrap it:

```ts
const off = stormSystem?.getCameraOffset()
if (off && off.lengthSq() > 0) {
  camera.position.add(off)
  renderer.render(scene, camera)
  camera.position.sub(off)
} else {
  renderer.render(scene, camera)
}
```

Drive it from `tick:start`: `stormSystem?.setTremor(msg.tick === 4)` (the fifth tick; 0-based), and `setTremor(false)` in `resetVisuals()` and at `weather:result` start.

- [ ] **Step 5: Build + commit**

Run: `bun run --cwd packages/client build` → clean.

```bash
git add packages/client/src/lib/audio.ts packages/client/src/lib/storm.ts packages/client/src/App.vue
git commit -m "Give the storm a voice and a shiver"
```

---

### Task 5: The Python sound generator

**Files:**
- Create: `scripts/gen_sounds.py`
- Regenerate: `packages/client/public/sounds/thunder-crack.mp3`, `thunder-distant.mp3`, `static-crackle.mp3` (ONLY these three; the other 26 files are untouched)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: a committed, reproducible generator; deterministic output (fixed numpy seed).

- [ ] **Step 1: Write the script** — header documents usage (`python3 scripts/gen_sounds.py [name ...]`, requires numpy + ffmpeg on PATH). Structure:

```python
#!/usr/bin/env python3
"""Reproducible sound synthesis for wheee. Requires numpy and ffmpeg.

Usage: python3 scripts/gen_sounds.py            # regenerate every sound this script owns
       python3 scripts/gen_sounds.py thunder-crack

Each sound is a pure function of the fixed seed. The original 26 sounds were
made by a script that never reached the repo; new sounds join this one."""
import numpy as np, subprocess, sys, wave, tempfile, os

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), "..", "packages", "client", "public", "sounds")
rng = np.random.default_rng(20260821)

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

def thunder_crack():
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

def thunder_distant():
    n = int(SR * 4.0)
    out = _lowpass(rng.standard_normal(n), 160)
    swell = np.sin(np.linspace(0, np.pi, n)) ** 2
    return out * swell

def static_crackle():
    n = int(SR * 3.0)
    out = _lowpass(rng.standard_normal(n), 6000) * 0.06
    ticks = rng.random(n) < (28 / SR)          # sparse impulse train
    out[ticks] += rng.standard_normal(ticks.sum()) * 0.9
    return out

SOUNDS = {"thunder-crack": thunder_crack, "thunder-distant": thunder_distant, "static-crackle": static_crackle}

def write(name, data):
    data = (np.clip(data / (np.abs(data).max() + 1e-9), -1, 1) * 32767 * 0.9).astype(np.int16)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        with wave.open(f, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(data.tobytes())
        tmp = f.name
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp,
                    "-codec:a", "libmp3lame", "-qscale:a", "4", os.path.join(OUT, name + ".mp3")], check=True)
    os.unlink(tmp)

if __name__ == "__main__":
    names = sys.argv[1:] or list(SOUNDS)
    for name in names:
        write(name, SOUNDS[name]())
        print("wrote", name + ".mp3")
```

(The `_lowpass` Python loop is slow-but-fine at these lengths; if it drags past ~20 s total, vectorize with `scipy.signal.lfilter` only if scipy is already available — do not add a dependency file for it.)

- [ ] **Step 2: Run it**

Run: `python3 scripts/gen_sounds.py`
Expected: three `wrote …` lines; `ls -la packages/client/public/sounds/ | grep -E "thunder|static"` shows fresh non-empty files. Run twice and `shasum` the outputs — identical (deterministic).

- [ ] **Step 3: Build + commit**

Run: `bun run --cwd packages/client build` → clean (assets only).

```bash
git add scripts/gen_sounds.py packages/client/public/sounds/thunder-crack.mp3 packages/client/public/sounds/thunder-distant.mp3 packages/client/public/sounds/static-crackle.mp3
git commit -m "Restore the sound pipeline as a committed script"
```

---

### Task 6: Visual verification pass + doc note

**Files:**
- Modify: `game/GAME_DESIGN.md` (one paragraph in §11: the sky renders the forecast — sector toward the candidates, drift between two, zenith for calm storms, chaos on a broken vane; never more information than the instruments)
- No production code changes expected; fixes discovered here go back through the review loop.

- [ ] **Step 1: Doc paragraph** — add to §11 (forecast instruments) in the doc's tone, Russian.

- [ ] **Step 2: Playwright pass** (dev server + vite; force weather locally by editing `WEATHER_SCHEDULE`'s first tier — DO NOT COMMIT; revert after):

Capture and LOOK at (honest reporting — a black frame is a failure to report):
1. one-candidate forecast: sector darkens over that horizon; dial needle agrees;
2. two candidates: two screenshots 2 s apart show the mass in different positions along the arc;
3. tick 1 vs tick 5 frames: measurably darker sky + curtain visibly closer (compare frame means);
4. broken vane (watcher break or forced): sky scrambles;
5. pure lightning (`[['lightning',100]]` first tier): zenith dark, horizon clean, NO curtain;
6. cataclysm sweep: mid-crossing frame with wind lines behind the curtain's edge;
7. lethal-bolt round: front halts during the hush, no sweep;
8. `prefers-reduced-motion` (emulate via CDP): no sweep, no tremor, dome still readable;
9. pixel-identity: lobby frame + early-forecast (intensity 0) frame diffed against the same frames on `main` — identical (allow the dial/HUD regions to differ, mask them or compare the sky region only).

Save screenshots under the SDD workspace `qa/` directory.

- [ ] **Step 3: Prove the server untouched**

Run: `bun test packages/server/src/engine/__tests__/lightning.test.ts packages/server/src/engine/__tests__/engine.test.ts packages/server/src/engine/__tests__/forecast.test.ts`
Expected: pass, byte-identical outcomes (no server files in `git status`).

- [ ] **Step 4: Commit**

```bash
git add game/GAME_DESIGN.md
git commit -m "Teach the design doc about the living sky"
```

---

## Self-review notes (already applied)

- Spec coverage: dome incl. calm/broken-vane semantics (T1), front + sweep/halt (T2), lifecycle/discharge/generation-guard/struckDead gates (T3), audio bed + tremor + reduced-motion (T4), Python pipeline (T5), verification incl. pixel-identity and reduced-motion (T6). Non-goals honored: no killcam, no lobby, no replay buildup, no server changes.
- Type consistency: `StormSystem` API named identically across T1–T4; `discharge` modes match the spec's three exits.
- Deliberate simplification: the front curtain hides via opacity=f(intensity) rather than separate visibility state; reduced-motion sweep degrades to the cataclysm discharge cross-fade.
