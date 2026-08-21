# Storm presence: the sky becomes the antagonist

**Date:** 2026-08-21
**Status:** approved

## Problem

The game's slogan is «Один порыв. Одна сетка. Без пощады» — but the storm has no
body. The board floats in a flat void (`scene.background = 0x0a0e14`, App.vue:1414,
no dome, no fog), the forecast lives only in the corner dial, and the cataclysm's
wind lines switch on out of nowhere. Ticks feel administrative instead of dreadful.
First impressions and portal thumbnails carry none of the game's fantasy, and D1 on
portal traffic is ~1%. The five ticks should feel like watching something approach.

## Design

Two layers, both procedural, both client-only. No server or protocol changes: the
client already receives the forecast (wind candidates, vane state, lightning
probability), the phase, and the tick number.

### 1. Sky dome (`packages/client/src/lib/storm.ts`)

A single large inverted hemisphere (`THREE.SphereGeometry`, `BackSide`, radius well
beyond the board, inside the camera far plane) with a shader- or vertex-color
gradient. Base tone equals today's background `0x0a0e14`, so an intensity of 0 is
pixel-identical to the current void.

Driven by three values:

- **azimuth** — where the storm masses. One wind candidate → fixed over that
  horizon. Two candidates → the mass drifts along the arc between them with the same
  spring/oscillation feel as the dial needle (`ForecastPanel.vue`'s `getVaneTarget`
  rhythm; independent phase so the two do not read as mechanically linked).
  Direction mapping matches the board compass (`compass.ts`: N is −z).
- **intensity** — 0 when the forecast appears, eased up to 1 by the end of tick 5.
  The storm sector darkens and saturates toward a deep slate-violet (same family as
  the dial's rim glow) while the rest of the sky sinks slightly — the world dims as
  the storm grows.
- **spread** — angular width of the sector; grows with intensity (a swelling mass,
  not a spotlight).

Special skies:

- **Calm forecast** (empty candidates with an intact vane — pure lightning): no
  horizon sector. The zenith darkens instead — the menace is overhead. Pairs with
  the existing rim crackle and `thunder-distant` ambience.
- **Broken vane:** the azimuth jumps chaotically around the full circle (the
  `brokenVaneTarget` pattern). The sky must never know more than the instruments —
  the barometer-rim leak taught this lesson; it is a hard constraint here.
- **Weather phase / lobby / replays:** intensity returns to 0 (see Lifecycle).

### 2. Storm front (`storm.ts`, second subsystem)

A curtain of particles (the `wind.ts` streams-and-dust idiom: `BufferGeometry`,
additive, no textures) standing off-board at the storm azimuth:

- Distance shrinks with tick progress: ~3×HALF away at tick 1 → touching the board
  edge at tick 5. Density and opacity ramp with intensity.
- Two candidates: the curtain follows the drifting azimuth (it is the same mass the
  dome shows, at ground level).
- **At the cataclysm with wind:** the curtain sweeps across the board (~1.2 s) and
  the existing wind streams (`windSystem`) fade in behind its leading edge instead
  of appearing from nowhere — `App.vue`'s `weather:result` wind block gains a
  `stormSystem.sweep(dir)` that resolves when the crossing completes, sequenced
  before/with `windSystem.setVisible(true)`. The sweep obeys the existing
  `liveStormGeneration` guard and the `struckDead.length === 0` gate (a lethal bolt
  froze the world; the front halts in the hush and disperses after the strike).
- **Calm forecast:** no curtain (nothing is coming along the ground).

### 3. Escalation channels

- **Audio bed:** `wind-loop` becomes a rising bed during the ticking phase — silent
  through tick 1, creeping in from tick 2, clearly humming by tick 5. Implemented as
  a new `audio.setStormBed(level: 0..1)` (volume automation on the existing loop, no
  new assets); the cataclysm's full `startWind()` and the lightning `beginHush()`
  already own the loop afterward and win over the bed. Bed level follows the same
  eased intensity as the dome.
- **Camera tremor:** the last ~2 s of tick 5 add a sub-pixel camera tremor
  (amplitude ≈ 0.05 world units, ~9 Hz, eased in). Skipped entirely under
  `prefers-reduced-motion`.
- **Existing pieces untouched:** `tick-urgent`, the dial, the lightning hush and
  two-act bolt all keep their roles; the storm presence hands over to them.

### 4. Sound pipeline restoration (`scripts/gen_sounds.py`)

The original 26 sounds were synthesized by a Python script that never entered the
repo (they landed as binaries in commit `8599397`; duplicated byte sizes show a
common generator). This feature commits a reproducible generator:

- `scripts/gen_sounds.py` — numpy-based synthesis, no external samples, stdlib +
  numpy only; each sound is a named function; writes mp3/wav into
  `packages/client/public/sounds/` (document the invocation in the script header).
- Regenerates the three lightning placeholders with layered synthesis:
  `thunder-crack` (sharp transient + brown-noise body with a falling lowpass sweep +
  long tail), `thunder-distant` (band-limited rumble, slow swell), `static-crackle`
  (sparse impulse train over faint high-frequency noise).
- The existing 26 files are NOT regenerated or touched — the script only has to
  cover the new sounds, but is structured so future sounds join it.

### Lifecycle & state sources

- Created next to `windSystem`/`rainSystem` in App.vue; `update(dt)` in the render
  loop; disposed in the same teardown.
- Inputs wired from existing handlers: forecast (candidates, vane state, lightning
  probability) from `applyGameState`; progress from `tick:start` (`(tick+1)/5`,
  eased); reset to zero intensity on `round:start`, `resetVisuals()`, `game:end`,
  lobby return, replay enter/exit. Replays do not accumulate storm presence in v1
  (frames jump tick-to-tick; the buildup would strobe).
- Watchers and the architect get the effect for free (same state messages).
- API shape: `createStormSystem(scene, camera)` →
  `{ setForecast(candidates, vaneBroken, stormy), setProgress(t), sweep(dir): Promise<void>, halt(), reset(), update(dt), dispose() }`.

### Accessibility & performance

- `prefers-reduced-motion`: dome gradient still animates (it is slow and low
  contrast — information, not motion), the curtain appears at static density with no
  sweep (cross-fade instead), camera tremor off.
- No flashes: the dome only darkens; nothing in this feature emits light bursts.
  The photosensitivity budget stays entirely with the bolt.
- Cost: one dome mesh + one particle system; mobile-portal safe. The dome shader is
  the only new shader; fallback to vertex colors if it fights `vue-tsc`/driver
  quirks.

## Non-goals

- Killcam (rides with the replay/share work, not this).
- Lobby backdrop (backlog item 8 — the lobby keeps its current demo board).
- Replay storm buildup.
- No new forecast information: the sky is a *rendering* of what the dial already
  says, never more (broken instruments scramble it identically).
- No server/protocol/engine changes of any kind.

## Verification

- `bun run --cwd packages/client build` clean; no server test impact (nothing
  server-side changed — run the engine suite once to prove it).
- Playwright visual pass (schedule/architect-forced weather locally, NOT committed):
  1. forecast with one candidate → sector darkens over that horizon, dial needle
     agrees; 2. two candidates → mass drifts between them; 3. tick 5 screenshot
  visibly darker than tick 1 (compare frame means); 4. broken vane → sky scrambles;
  5. pure lightning → zenith darkens, horizon clean, no curtain; 6. cataclysm sweep
  frame: curtain mid-board, wind lines behind its edge; 7. lethal-bolt round: front
  halts, no sweep; 8. `prefers-reduced-motion` run: no sweep, no tremor.
- Sound: `python3 scripts/gen_sounds.py` regenerates the three thunder files
  deterministically (fixed seed); listen-check is the owner's.
- Intensity 0 renders pixel-identical to today's void (screenshot diff of the lobby
  and an early-forecast frame against main).
