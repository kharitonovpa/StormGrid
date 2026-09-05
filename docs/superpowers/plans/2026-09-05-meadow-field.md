# Meadow Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the flat starting board read as a dusk meadow — a tiny baked swell that the sun lights, a colour field driven by that swell, a grooved seam at cell borders, a soft shadow under each character — and let the grass show wind gusts only from the bearings the sky already names.

**Architecture:** Everything static is baked into the terrain's vertex positions and colours by pure functions in a new `lib/meadow.ts`, wired through `terrain.ts`'s `getHeightRaw` and `paintColors` (both run only while the terrain animates, so the resting frame costs nothing). Foot shadows are a small terrain-following mesh per character (`lib/footShadow.ts`), built like the existing player ring. The living layer is a pure gust scheduler (`lib/sheen.ts`) fed each frame by a new read-only `storm.masses()` — the grass reads the sky, never the forecast — and rendered by an `onBeforeCompile` patch on the shared terrain material: one uniform array per frame, a few ALU ops per terrain fragment.

**Tech Stack:** Bun workspaces monorepo — `packages/client` (Vue 3 + Three.js r183, Vite), tests with `bun test` (`bun:test`), types with `bunx vue-tsc -b --noEmit`. Captures: Playwright 1.62.1 + pngjs 7 from the bun cache (offline), headless Chromium with SwiftShader.

Spec: `docs/superpowers/specs/2026-09-05-meadow-field-design.md`.

## Global Constraints

- Client only. No engine/server changes; no changes to `wind.ts`, `rain.ts`, `lightning.ts`, `water.ts`, character models, HUD, camera, `CharacterPreview.vue`.
- No new runtime dependencies, textures, sprites, shadow maps or post-processing passes.
- Level legibility is sacred: `LOOK.terrain.swell.amp + LOOK.terrain.groove.depth ≤ 0.2` world units (0.04 levels, under `terrainShade.DEAD_ZONE` = 0.05 levels = 0.25 world units; also under the palette's lift/sink thresholds at ±0.2 in `paintColors`). Unit-tested in `look.test.ts`.
- Nothing moves at rest. Gusts only from bearings present in the last `follow(masses)`; none when every weight ≤ 0.05; none under `prefers-reduced-motion`.
- Static layer cost: only inside `rebuildMesh`/`paintColors` (already gated by `if (animating)` in `App.vue`'s `animate()`). Living layer cost: one `Float32Array(12)` uniform upload per frame plus the fragment band.
- Token values in `lib/look.ts` are starting values; the structure is the contract. Tune against captures in Task 7, never by eye alone.
- Tests: `cd packages/client && bun test`. Types: `cd packages/client && bunx vue-tsc -b --noEmit`. Run both before every commit that touches `packages/client`.
- Every commit message ends with the trailer line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Never kill dev servers you did not start (other worktrees may hold :3001/:5173). The capture harness uses :5199 for Vite and reuses a server already on :3001 if one is listening.
- Working tree note: `main` currently carries uncommitted, unrelated edits (points/nameplate files). Do not stage them; `git add` only the files each task names.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/client/src/lib/look.ts` | New tokens: `terrain.grain`, `terrain.swell`, `terrain.groove`, `terrain.sheen`, `foot`; `grid.opacity` 0.18. |
| `packages/client/src/lib/meadow.ts` (new) | Pure: `swell`, `groove`, `flatWeight`, `meadowTint`. No `three`. |
| `packages/client/src/lib/terrain.ts` | `getHeightRaw` adds the meadow term; `paintColors` uses grain + swell tint. |
| `packages/client/src/lib/footShadow.ts` (new) | Contact-shadow ellipse per character; pure helpers `shadowAxis`, `footAlpha`, `liftFade`. |
| `packages/client/src/lib/bearing.ts` (new) | `DIR_AZIMUTH` (moved out of `storm.ts`) and `gustDirection(azimuth)`. |
| `packages/client/src/lib/storm.ts` | Imports `DIR_AZIMUTH` from `bearing.ts`; exports `SWEEP_MS`; new `masses()`. |
| `packages/client/src/lib/sheen.ts` (new) | `createGustScheduler` (pure) and `createSheenSystem` (material patch + uniforms). |
| `packages/client/src/lib/lobbyDemo.ts` | Takes a `sheen` handle; wind phases feed it. |
| `packages/client/src/App.vue` | Wires foot shadows, sheen system, lobby demo handle, cataclysm sweep, dispose. |
| `game/GAME_DESIGN.md` | Short "Луг" subsection: what the flat board shows and the grass-reads-the-sky rule. |
| `packages/client/src/lib/__tests__/{meadow,footShadow,bearing,sheen}.test.ts` (new), `{look,terrain,storm}.test.ts` | Tests per task. |

Capture harness (outside the repo, in the session scratchpad): `harness/capture.mjs`, `harness/metrics.mjs`.

---

### Task 1: Baseline captures (before any change)

The acceptance metrics are relative to today's build, so the harness and the baseline come first.

**Files:**
- Create (scratchpad, not in the repo): `harness/package.json`, `harness/capture.mjs`, `harness/metrics.mjs`

**Interfaces:**
- Produces: `harness/<name>-lobby.png`, `harness/<name>-tick1.png`, a JSON line with `frameMs`, and per-image board/sky lightness stats. Task 7 reruns the same scripts.

- [ ] **Step 1: Create the harness directory and install Playwright + pngjs from the bun cache**

In your scratchpad directory (the one your system prompt names), run:

```bash
mkdir -p harness && cd harness && printf '{ "name": "harness", "type": "module" }\n' > package.json && bun add playwright@1.62.1 pngjs@7.0.0
```

Expected: "packages installed" with no network errors (both are in `~/.bun/install/cache`).

- [ ] **Step 2: Write `harness/capture.mjs`**

```js
// Usage: URL=http://localhost:5199 node capture.mjs <name>
import { chromium } from 'playwright'

const name = process.argv[2] ?? 'after'
const url = process.env.URL ?? 'http://localhost:5199'
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(5000)
await page.screenshot({ path: `${name}-lobby.png` })
await page.click('.btn-play')
await page.waitForSelector('.hud', { timeout: 90000 })   // bot joins after BOT_MATCH_DELAY_MS
await page.waitForTimeout(7000)                            // the intro camera settles
await page.screenshot({ path: `${name}-tick1.png` })
// Mean frame interval at rest over 4 s (SwiftShader is CPU-bound, so fragment cost shows here).
const frameMs = await page.evaluate(() => new Promise((resolve) => {
  let n = 0
  const t0 = performance.now()
  const step = () => {
    n++
    if (performance.now() - t0 < 4000) requestAnimationFrame(step)
    else resolve((performance.now() - t0) / n)
  }
  requestAnimationFrame(step)
}))
console.log(JSON.stringify({ name, frameMs: Math.round(frameMs * 10) / 10 }))
await browser.close()
```

- [ ] **Step 3: Write `harness/metrics.mjs`**

```js
// Usage: node metrics.mjs <png>   → JSON with board and sky lightness stats
import { PNG } from 'pngjs'
import fs from 'node:fs'

const file = process.argv[2]
const png = PNG.sync.read(fs.readFileSync(file))
const L = (x, y) => {
  const i = (y * png.width + x) * 4
  const d = png.data
  return (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255
}
function stats(x0, y0, x1, y1, skip) {
  const v = []
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (skip && skip(x, y)) continue
    v.push(L(x, y))
  }
  v.sort((a, b) => a - b)
  const q = (t) => v[Math.floor(t * (v.length - 1))]
  const mean = v.reduce((a, b) => a + b, 0) / v.length
  const r = (n) => Math.round(n * 1000) / 1000
  return { mean: r(mean), p10: r(q(0.1)), p90: r(q(0.9)), spread: r(q(0.9) - q(0.1)) }
}
// Board region of the 1280×800 first-tick frame, minus the character + nameplate box.
const board = stats(250, 330, 1030, 760, (x, y) => x > 540 && x < 740 && y > 380 && y < 600)
// A sky band clear of the forecast panel and the compass.
const sky = stats(40, 90, 600, 170)
console.log(JSON.stringify({ file, board, sky }))
```

- [ ] **Step 4: Start a server with a fast bot (only if :3001 is free) and the client on :5199**

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN || echo "3001 free"
```

If it printed "3001 free", start (Bash `run_in_background: true`):

```bash
cd /Users/pohare/Desktop/my/StormGrid/packages/server && BOT_MATCH_DELAY_MS=1000 bun src/index.ts
```

If something else is already listening, use it as is (the bot then comes after its own delay; the capture waits up to 90 s).

Start the client (Bash `run_in_background: true`):

```bash
cd /Users/pohare/Desktop/my/StormGrid/packages/client && bunx vite --port 5199 --strictPort
```

Wait until `curl -s -o /dev/null -w '%{http_code}' http://localhost:5199/` prints `200`.

- [ ] **Step 5: Capture the baseline and record its numbers**

```bash
cd <scratchpad>/harness && node capture.mjs before && node metrics.mjs before-tick1.png && node metrics.mjs before-lobby.png
```

Open `before-tick1.png` with the Read tool and confirm it shows the first tick (HUD with round dots, a character on a flat green board). Record the three JSON lines in `docs/superpowers/plans/2026-09-05-meadow-field.md` under a new "## Baseline" section at the end of this file (board `spread`, `mean`, sky `mean`, `frameMs`). Targets for Task 7: board `spread` ≥ 2× baseline; board `mean` within ±10% of baseline; sky `mean` within ±3%; `frameMs` within ±10%.

- [ ] **Step 6: Commit the baseline numbers**

```bash
git add docs/superpowers/plans/2026-09-05-meadow-field.md
git commit -m "Record the flat-board baseline metrics for the meadow field

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Look tokens and the pure meadow functions

**Files:**
- Modify: `packages/client/src/lib/look.ts` (the `LOOK` object, `terrain` and `grid` entries; add `foot`)
- Create: `packages/client/src/lib/meadow.ts`
- Test: `packages/client/src/lib/__tests__/look.test.ts`, `packages/client/src/lib/__tests__/meadow.test.ts` (new)

**Interfaces:**
- Produces:
  - `LOOK.terrain.grain: number`, `LOOK.terrain.swell: { amp, wavelength, crest, trough, tint }`, `LOOK.terrain.groove: { depth, halfWidth }`, `LOOK.terrain.sheen: { color, strength, width, tail, speed }`, `LOOK.foot: { color, opacity, across, along, offset }`, `LOOK.grid.opacity = 0.18`.
  - `meadow.ts`: `swell(wx: number, wz: number): number` (world units, `|v| ≤ amp`), `groove(wx, wz): number` (≤ 0), `flatWeight(levels: number): number` (1 → 0), `meadowTint(s: number, out: [number, number, number]): void` (multiplicative linear RGB factors, `s ∈ [-1, 1]`), `SWELL_AMP`, `GROOVE_DEPTH`, `GROOVE_HALF_WIDTH` constants.

- [ ] **Step 1: Write the failing token tests**

Append to `look.test.ts` inside `describe('LOOK tokens', …)`:

```ts
  it('holds the meadow, sheen and foot tokens in range', () => {
    const { swell, groove, sheen, grain } = LOOK.terrain
    for (const c of [swell.crest, swell.trough, sheen.color, LOOK.foot.color]) expect(isHex(c)).toBe(true)
    expect(swell.amp).toBeGreaterThan(0)
    expect(swell.wavelength).toBeGreaterThan(0.5)
    expect(swell.tint).toBeGreaterThanOrEqual(0)
    expect(swell.tint).toBeLessThanOrEqual(1)
    expect(groove.depth).toBeGreaterThan(0)
    expect(groove.halfWidth).toBeGreaterThanOrEqual(1)
    expect(grain).toBeGreaterThanOrEqual(0)
    expect(grain).toBeLessThanOrEqual(0.2)
    expect(sheen.strength).toBeGreaterThan(0)
    expect(sheen.strength).toBeLessThanOrEqual(1)
    expect(sheen.width).toBeGreaterThan(0)
    expect(sheen.tail).toBeGreaterThan(0)
    expect(sheen.speed).toBeGreaterThan(0)
    expect(LOOK.foot.opacity).toBeGreaterThan(0)
    expect(LOOK.foot.opacity).toBeLessThanOrEqual(1)
    for (const v of [LOOK.foot.across, LOOK.foot.along, LOOK.foot.offset]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('keeps the meadow decoration under the baked-shading dead zone and the palette lift/sink thresholds', () => {
    // DEAD_ZONE is in levels; the palette's lift starts at +0.2 and sink ends at −0.2 world units.
    const decoration = LOOK.terrain.swell.amp + LOOK.terrain.groove.depth
    expect(decoration).toBeLessThanOrEqual(0.2)
    expect(decoration).toBeLessThan(DEAD_ZONE * HEIGHT_SCALE)
  })
```

Change the import line for `terrainShade` to `import { MARCH_MAX, DEAD_ZONE } from '../terrainShade.js'`.

- [ ] **Step 2: Run the token tests to verify they fail**

Run: `cd packages/client && bun test src/lib/__tests__/look.test.ts`
Expected: FAIL — `LOOK.terrain.swell` is undefined.

- [ ] **Step 3: Add the tokens to `look.ts`**

Replace the `terrain` and `grid` entries of `LOOK` and add `foot` after `grid`:

```ts
  terrain: {
    grass: 0x4f9048,
    rock: 0xc4b8aa,
    mud: 0x8a4b2a,
    snow: 0xfff6e6,
    checkerAmp: 0.12,       // ± relative lightness of alternate grass cells
    aoStrength: 0.5,        // darkening at a block's foot
    shadowStrength: 0.6,    // darkening inside the sun's shadow
    // Multiplies the albedo at full shadow. The sun still lights the vertex (no
    // shadow maps), so the baked shadow darkens far more than it cools; this
    // only nudges its hue toward sky-lit.
    shadowTint: [0.75, 0.88, 1.4] as Vec3,
    /** Fine per-vertex grass grain (± relative lightness). */
    grain: 0.05,
    /** The meadow swell on a flat cell (lib/meadow.ts): a tiny baked undulation
     *  the low sun lights, and the colour field it drives. amp is world units
     *  (a level is HEIGHT_SCALE = 5); wavelength is in cells. */
    swell: {
      amp: 0.08,
      wavelength: 1.2,
      crest: 0x9cb857,      // sunlit straw-green the crests lean toward
      trough: 0x2f6e4a,     // cool blue-green the hollows lean toward
      tint: 0.35,           // 0..1 blend toward crest/trough at full swell
    },
    /** V-groove at every cell border: depth in world units, half-width in mesh segments. */
    groove: { depth: 0.12, halfWidth: 1 },
    /** A gust's highlight on the grass (lib/sheen.ts). width/tail/speed in world units (/s). */
    sheen: { color: 0xf0d890, strength: 0.35, width: 12, tail: 6, speed: 22 },
  },
  water: { deep: 0x1e5d6e, rim: 0x3d9aa8, opacity: 0.6 },
  // Quieter than before (0.28): the groove now carries the seam itself.
  grid: { color: 0xc8c4ff, opacity: 0.18 },
  /** The characters' contact shadow (lib/footShadow.ts): radii and centre
   *  offset in cells, along the sun's horizontal shadow axis. */
  foot: { color: 0x14122e, opacity: 0.45, across: 0.32, along: 0.55, offset: 0.15 },
```

- [ ] **Step 4: Run the token tests to verify they pass**

Run: `cd packages/client && bun test src/lib/__tests__/look.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing meadow tests**

Create `packages/client/src/lib/__tests__/meadow.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import { swell, groove, flatWeight, meadowTint, SWELL_AMP, GROOVE_DEPTH, GROOVE_HALF_WIDTH } from '../meadow.js'
import { HALF, CELL_SIZE, SIZE } from '../constants.js'
import { LOOK } from '../look.js'

const worldAt = (g: number) => -HALF + g * CELL_SIZE   // grid coordinate → world x/z

describe('swell', () => {
  it('stays within ±amp over a dense sample and is not flat', () => {
    let lo = Infinity, hi = -Infinity
    for (let z = -HALF; z <= HALF; z += 0.37) {
      for (let x = -HALF; x <= HALF; x += 0.41) {
        const v = swell(x, z)
        lo = Math.min(lo, v)
        hi = Math.max(hi, v)
      }
    }
    expect(lo).toBeGreaterThanOrEqual(-SWELL_AMP)
    expect(hi).toBeLessThanOrEqual(SWELL_AMP)
    expect(hi - lo).toBeGreaterThan(SWELL_AMP)   // uses at least half the range
  })

  it('is deterministic', () => {
    expect(swell(3.3, -7.1)).toBe(swell(3.3, -7.1))
    expect(SWELL_AMP).toBe(LOOK.terrain.swell.amp)
  })

  it('varies on the scale of a cell, not a vertex', () => {
    // Two points one mesh segment apart differ far less than the full range.
    const seg = SIZE / (7 * 15)
    const d = Math.abs(swell(2, 2) - swell(2 + seg, 2))
    expect(d).toBeLessThan(SWELL_AMP * 0.25)
  })
})

describe('groove', () => {
  it('is zero at a cell centre and −depth on a border', () => {
    expect(groove(worldAt(1.5), worldAt(1.5))).toBe(0)
    expect(groove(worldAt(1), worldAt(1.5))).toBeCloseTo(-GROOVE_DEPTH, 6)
    expect(groove(worldAt(1.5), worldAt(2))).toBeCloseTo(-GROOVE_DEPTH, 6)
  })

  it('is a V one half-width wide', () => {
    expect(groove(worldAt(1) + GROOVE_HALF_WIDTH, worldAt(1.5))).toBe(0)
    expect(groove(worldAt(1) + GROOVE_HALF_WIDTH / 2, worldAt(1.5))).toBeCloseTo(-GROOVE_DEPTH / 2, 6)
    expect(GROOVE_HALF_WIDTH).toBeCloseTo(LOOK.terrain.groove.halfWidth * SIZE / (7 * 15), 9)
  })

  it('chamfers the slab edge: full depth on the outer border', () => {
    expect(groove(-HALF, worldAt(3.5))).toBeCloseTo(-GROOVE_DEPTH, 6)
    expect(groove(worldAt(3.5), HALF)).toBeCloseTo(-GROOVE_DEPTH, 6)
  })
})

describe('flatWeight', () => {
  it('is 1 on a flat cell, 0 at a full level, and monotone between', () => {
    expect(flatWeight(0)).toBe(1)
    expect(flatWeight(1)).toBe(0)
    expect(flatWeight(-1)).toBe(0)
    let prev = 1
    for (let h = 0; h <= 1; h += 0.05) {
      const w = flatWeight(h)
      expect(w).toBeLessThanOrEqual(prev)
      prev = w
    }
  })
})

describe('meadowTint', () => {
  const tint = (s: number) => { const out: [number, number, number] = [1, 1, 1]; meadowTint(s, out); return out }

  it('is identity at zero swell', () => {
    expect(tint(0)).toEqual([1, 1, 1])
  })

  it('makes a crest lighter and warmer than a trough', () => {
    const crest = tint(1), trough = tint(-1)
    const sum = (c: number[]) => c[0] + c[1] + c[2]
    expect(sum(crest)).toBeGreaterThan(sum(trough))
    expect(crest[0] / crest[2]).toBeGreaterThan(trough[0] / trough[2])   // red over blue: warmth
  })

  it('clamps beyond ±1', () => {
    expect(tint(3)).toEqual(tint(1))
    expect(tint(-3)).toEqual(tint(-1))
  })
})
```

- [ ] **Step 6: Run the meadow tests to verify they fail**

Run: `cd packages/client && bun test src/lib/__tests__/meadow.test.ts`
Expected: FAIL — cannot resolve `../meadow.js`.

- [ ] **Step 7: Write `packages/client/src/lib/meadow.ts`**

```ts
/**
 * The meadow: what a FLAT cell looks like. Pure functions over world x/z, no
 * `three`, deterministic — the top face, the underside, the height cache and
 * the frozen-frame captures must all agree.
 *
 * Nothing here may read as a height level: swell + groove stay under the
 * baked shading's DEAD_ZONE (lib/terrainShade.ts) and under the palette's
 * lift/sink thresholds (lib/terrain.ts paintColors). lib/__tests__/look.test.ts
 * pins that invariant on the tokens.
 */
import { CELL_SIZE, HALF, SIZE, SEGMENTS } from './constants'
import { noise2d, clamp, sstep, mix } from './noise'
import { LOOK, srgbHexToLinear } from './look'

const { amp, wavelength, tint } = LOOK.terrain.swell
export const SWELL_AMP = amp
export const GROOVE_DEPTH = LOOK.terrain.groove.depth
/** One mesh segment is SIZE / SEGMENTS: the V uses the existing vertex rows. */
export const GROOVE_HALF_WIDTH = LOOK.terrain.groove.halfWidth * (SIZE / SEGMENTS)

/** Cycles per world unit: one lattice cell of noise2d per `wavelength` board cells. */
const FREQ = 1 / (wavelength * CELL_SIZE)

/**
 * Two octaves of the deterministic value noise, centred and normalised to
 * ±amp. Offsets keep it off the hill noise's lattice (terrain.ts uses fbm at
 * NOISE_FREQ with no offset) so a swell crest never lines up with a hill wobble.
 */
export function swell(wx: number, wz: number): number {
  const a = noise2d(wx * FREQ + 311.7, wz * FREQ + 97.3) - 0.5
  const b = noise2d(wx * FREQ * 2.1 + 53.1, wz * FREQ * 2.1 + 191.9) - 0.5
  return clamp((a + b * 0.5) / 0.75, -1, 1) * amp
}

/** World distance from `w` to the nearest cell border along one axis (0 on a border). */
function borderDistance(w: number): number {
  const g = (w + HALF) / CELL_SIZE
  const f = g - Math.floor(g)
  return Math.min(f, 1 - f) * CELL_SIZE
}

/**
 * V-groove at every cell border, the slab's outer edge included (there it is a
 * small chamfer). ≤ 0; −depth on the border line, 0 one half-width away.
 */
export function groove(wx: number, wz: number): number {
  const d = Math.min(borderDistance(wx), borderDistance(wz))
  if (d >= GROOVE_HALF_WIDTH) return 0
  return -GROOVE_DEPTH * (1 - d / GROOVE_HALF_WIDTH)
}

/**
 * How much of the meadow a cell carries: all of it flat, none at a full level.
 * Fades out early (by 0.6 level) so a rising cell hands over to the hill noise
 * before its vertices start to be displaced sideways (terrain.ts rebuildMesh).
 */
export function flatWeight(levels: number): number {
  return 1 - sstep(0, 0.6, Math.abs(levels))
}

const GRASS = srgbHexToLinear(LOOK.terrain.grass)
const CREST = srgbHexToLinear(LOOK.terrain.swell.crest)
const TROUGH = srgbHexToLinear(LOOK.terrain.swell.trough)

/**
 * Multiplicative linear RGB factors for the grass at swell `s = swell / amp`:
 * crests lean toward `crest`, hollows toward `trough`, by `tint`. Relative to
 * the grass token, so paintColors can apply it on top of its own grain. Writes
 * into `out` — this runs per vertex.
 */
export function meadowTint(s: number, out: [number, number, number]): void {
  const k = clamp(s, -1, 1) * tint
  const target = k >= 0 ? CREST : TROUGH
  const w = Math.abs(k)
  out[0] = mix(1, target[0] / GRASS[0], w)
  out[1] = mix(1, target[1] / GRASS[1], w)
  out[2] = mix(1, target[2] / GRASS[2], w)
}
```

- [ ] **Step 8: Run the meadow and look tests to verify they pass**

Run: `cd packages/client && bun test src/lib/__tests__/meadow.test.ts src/lib/__tests__/look.test.ts`
Expected: PASS. If `varies on the scale of a cell` fails, the frequency is too high: check `FREQ` uses `wavelength * CELL_SIZE`.

- [ ] **Step 9: Type-check and commit**

```bash
cd packages/client && bunx vue-tsc -b --noEmit
git add packages/client/src/lib/look.ts packages/client/src/lib/meadow.ts packages/client/src/lib/__tests__/look.test.ts packages/client/src/lib/__tests__/meadow.test.ts
git commit -m "Add the meadow tokens and the pure swell, groove and tint functions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Wire the meadow into the terrain

**Files:**
- Modify: `packages/client/src/lib/terrain.ts` (`getHeightRaw` ~lines 30-40; `paintColors` noise lines ~205-230)
- Test: `packages/client/src/lib/__tests__/terrain.test.ts`

**Interfaces:**
- Consumes: `swell`, `groove`, `flatWeight`, `meadowTint`, `SWELL_AMP` from `meadow.ts`; `LOOK.terrain.grain`.
- Produces: `getHeightRaw` on a flat board returns `swell + groove` (no longer exactly 0); the grid lines, ring, arrows, highlights and characters follow through `getHeight` with no changes.

- [ ] **Step 1: Write the failing terrain tests**

Add to `terrain.test.ts`. Extend the import lines:

```ts
import { paintColors, current, getHeightRaw } from '../terrain.js'
import { SIZE, SEGMENTS, HALF, CELL_SIZE, THICKNESS, HEIGHT_SCALE, NOISE_AMP, NOISE_FREQ } from '../constants.js'
import { swell, groove, SWELL_AMP, GROOVE_DEPTH } from '../meadow.js'
import { fbm } from '../noise.js'
```

Add a new describe block:

```ts
describe('the meadow on a flat board', () => {
  it('lifts and dips the flat board within the decoration budget, never exactly flat', () => {
    let lo = Infinity, hi = -Infinity
    for (let z = -HALF; z <= HALF; z += 0.53) {
      for (let x = -HALF; x <= HALF; x += 0.47) {
        const y = getHeightRaw(x, z)
        lo = Math.min(lo, y)
        hi = Math.max(hi, y)
      }
    }
    expect(lo).toBeGreaterThanOrEqual(-(SWELL_AMP + GROOVE_DEPTH))
    expect(hi).toBeLessThanOrEqual(SWELL_AMP)
    expect(hi - lo).toBeGreaterThan(0.05)
  })

  it('cuts the groove at a cell border', () => {
    const wx = worldAt(2), wz = worldAt(3.5)
    expect(getHeightRaw(wx, wz)).toBeCloseTo(swell(wx, wz) + groove(wx, wz), 6)
    expect(getHeightRaw(wx, wz)).toBeLessThan(-GROOVE_DEPTH + SWELL_AMP + 1e-6)   // the swell can lift the floor by at most amp
  })

  it('carries no meadow on a fully raised cell', () => {
    current[2][2] = 1
    const wx = worldAt(2.5), wz = worldAt(2.5)
    const expected = HEIGHT_SCALE + fbm(wx * NOISE_FREQ, wz * NOISE_FREQ) * NOISE_AMP
    expect(getHeightRaw(wx, wz)).toBeCloseTo(expected, 6)
  })

  it('paints a crest warmer and lighter than a trough', () => {
    // Find the strongest crest and trough on the flat board, away from borders.
    let best = { s: -Infinity, x: 0, z: 0 }, worst = { s: Infinity, x: 0, z: 0 }
    for (let gz = 0.3; gz < 7; gz += 0.1) {
      for (let gx = 0.3; gx < 7; gx += 0.1) {
        const x = worldAt(gx), z = worldAt(gz)
        const s = swell(x, z)
        if (s > best.s) best = { s, x, z }
        if (s < worst.s) worst = { s, x, z }
      }
    }
    const crest = makeSingleVertexGeo(best.x, 0, best.z)
    const trough = makeSingleVertexGeo(worst.x, 0, worst.z)
    paintColors(crest)
    paintColors(trough)
    // The checkerboard could mask the tint: compare against the same spot with the tint's driver removed
    // is impossible, so require the tint to win by a margin larger than the checker's ±12 %.
    const [cr, , cb] = colourOf(crest)
    const [tr, , tb] = colourOf(trough)
    expect(cr / cb).toBeGreaterThan((tr / tb) * 1.05)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/client && bun test src/lib/__tests__/terrain.test.ts`
Expected: FAIL — `getHeightRaw` is not exported / returns 0 on the flat board.

- [ ] **Step 3: Add the meadow term to `getHeightRaw`**

In `terrain.ts`, add the import:

```ts
import { swell, groove, flatWeight, meadowTint, SWELL_AMP } from './meadow'
```

Replace `getHeightRaw`:

```ts
export function getHeightRaw(wx: number, wz: number): number {
  const gx = (wx + HALF) / CELL_SIZE
  const gz = (wz + HALF) / CELL_SIZE
  const cx = clamp(Math.floor(gx), 0, CELLS - 1) | 0
  const cz = clamp(Math.floor(gz), 0, CELLS - 1) | 0
  const h = current[cz][cx]
  // The meadow (lib/meadow.ts): a flat cell's swell and grooved borders, handed
  // over to the hill noise as the cell rises so the surface stays continuous.
  const flat = flatWeight(h)
  const meadow = flat > 0 ? (swell(wx, wz) + groove(wx, wz)) * flat : 0
  if (Math.abs(h) < 0.001) return meadow
  const n = fbm(wx * NOISE_FREQ, wz * NOISE_FREQ) * NOISE_AMP
  return h * HEIGHT_SCALE + n * Math.abs(h) + meadow
}
```

Confirm `getHeightRaw` is already exported (it is: `export function getHeightRaw`).

- [ ] **Step 4: Replace the coarse noise pair with grain + swell tint in `paintColors`**

Add a module-level scratch next to the palette constants:

```ts
const GRAIN = LOOK.terrain.grain
const _tint: [number, number, number] = [1, 1, 1]
```

In the vertex loop, replace

```ts
    const nv = noise2d(wx * 0.5 + 77, wz * 0.5 + 77) * 0.12
    const nv2 = noise2d(wx * 0.9 + 33, wz * 0.9 + 33) * 0.08
```

with

```ts
    // Fine grain only; the meadow swell below carries the coarse variation.
    const nv = noise2d(wx * 0.9 + 33, wz * 0.9 + 33) * GRAIN * 2
    meadowTint(swell(wx, wz) / SWELL_AMP, _tint)
```

and replace the grass line

```ts
    const gk = 1 + nv + nv2
    const gr0 = GRASS[0] * gk, gr1 = GRASS[1] * gk, gr2 = GRASS[2] * (1 + nv * 0.5)
```

with

```ts
    const gk = 1 + nv
    const gr0 = GRASS[0] * gk * _tint[0], gr1 = GRASS[1] * gk * _tint[1], gr2 = GRASS[2] * (1 + nv * 0.5) * _tint[2]
```

`nv` keeps feeding the mud, snow and rock modulations exactly as before (`mk`, `sk`, `rk`); only `nv2` disappears.

- [ ] **Step 5: Run the whole terrain suite**

Run: `cd packages/client && bun test src/lib/__tests__/terrain.test.ts src/lib/__tests__/terrainShade.test.ts`
Expected: PASS, including the pre-existing baked-shading tests (they compare the same spot on two boards, and the tint depends on x/z only) and the repaint budget (< 40 ms).

- [ ] **Step 6: Run the full client suite and types, then commit**

```bash
cd packages/client && bun test && bunx vue-tsc -b --noEmit
git add packages/client/src/lib/terrain.ts packages/client/src/lib/__tests__/terrain.test.ts
git commit -m "Bake the meadow swell, grooved seams and crest/trough tint into the flat board

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 7: Look at it**

With the server and the :5199 client from Task 1 still running (Vite hot-reloads), capture `node capture.mjs static` in the harness directory and open `static-tick1.png` and `static-lobby.png` with the Read tool. Check: soft light/shade waves across the flat board; borders read as thin grooves with the fainter line inside; the slab edge shows a small chamfer; hills and pits look as before; nothing reads as a level. Do not tune tokens yet (Task 7 does that against the metrics); if something is broken (e.g. grid lines vanish or z-fight), fix and recommit.

---

### Task 4: Foot shadows under the characters

**Files:**
- Create: `packages/client/src/lib/footShadow.ts`
- Modify: `packages/client/src/App.vue` (player refs ~lines 1960-1963; system creation after `players`; `animate()` after `players.update(dt)`; dispose block ~2466-2490)
- Test: `packages/client/src/lib/__tests__/footShadow.test.ts` (new)

**Interfaces:**
- Consumes: `LOOK.foot`, `LOOK.sun.direction`, `TerrainState.getHeight` and `.version`.
- Produces: `createFootShadows(scene, terrain)` → `{ setPlayerRefs(a, b), update(dt), dispose() }`; pure `shadowAxis(): [number, number]`, `footAlpha(t: number): number`, `liftFade(lift: number): number`.

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/lib/__tests__/footShadow.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import * as THREE from 'three'
import { createFootShadows, shadowAxis, footAlpha, liftFade } from '../footShadow.js'
import { LOOK } from '../look.js'
import { THICKNESS } from '../constants.js'
import type { TerrainState } from '../terrain.js'

function fakeTerrain(height = 0): TerrainState {
  return { getHeight: () => height, version: 0 } as unknown as TerrainState
}
function ref(x: number, y: number, z: number, surface: 'top' | 'bottom' = 'top') {
  const mesh = new THREE.Group()
  mesh.position.set(x, y, z)
  return { state: { cx: 0, cz: 0 }, mesh, surface }
}

describe('shadowAxis', () => {
  it('is a unit vector pointing away from the sun', () => {
    const [ax, az] = shadowAxis()
    const [sx, , sz] = LOOK.sun.direction
    expect(Math.hypot(ax, az)).toBeCloseTo(1, 6)
    expect(ax * sx + az * sz).toBeLessThan(0)
  })
})

describe('falloffs', () => {
  it('footAlpha is full at the centre, zero at the rim, monotone', () => {
    expect(footAlpha(0)).toBeCloseTo(LOOK.foot.opacity, 6)
    expect(footAlpha(1)).toBe(0)
    let prev = footAlpha(0)
    for (let t = 0.1; t <= 1; t += 0.1) { const a = footAlpha(t); expect(a).toBeLessThanOrEqual(prev); prev = a }
  })
  it('liftFade is 1 on the ground and 0 by 2.5 units up', () => {
    expect(liftFade(0)).toBe(1)
    expect(liftFade(1.25)).toBeCloseTo(0.5, 6)
    expect(liftFade(2.5)).toBe(0)
    expect(liftFade(9)).toBe(0)
  })
})

describe('createFootShadows', () => {
  it('adds two shadow meshes and shows them under grounded, visible characters', () => {
    const scene = new THREE.Scene()
    const foot = createFootShadows(scene, fakeTerrain())
    foot.setPlayerRefs(ref(1, 0, 1), ref(-1, -THICKNESS, -1, 'bottom'))
    foot.update(0.016)
    const shadows = scene.children.filter(o => o.name === 'footShadow') as THREE.Mesh[]
    expect(shadows).toHaveLength(2)
    for (const s of shadows) {
      expect(s.visible).toBe(true)
      expect((s.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(1, 6)
    }
  })

  it('fades a lifted character and hides a hidden one', () => {
    const scene = new THREE.Scene()
    const foot = createFootShadows(scene, fakeTerrain())
    const a = ref(0, 1.25, 0), b = ref(3, 0, 3)
    b.mesh.visible = false
    foot.setPlayerRefs(a, b)
    foot.update(0.016)
    const [sa, sb] = scene.children.filter(o => o.name === 'footShadow') as THREE.Mesh[]
    expect((sa.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.5, 6)
    expect(sb.visible).toBe(false)
  })

  it('hugs the terrain: vertices sit just above the ground height', () => {
    const scene = new THREE.Scene()
    const foot = createFootShadows(scene, fakeTerrain(2))
    foot.setPlayerRefs(ref(0, 2, 0), ref(5, 2, 5))
    foot.update(0.016)
    const [s] = scene.children.filter(o => o.name === 'footShadow') as THREE.Mesh[]
    const pos = s.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBeCloseTo(2.06, 6)
  })

  it('disposes cleanly', () => {
    const scene = new THREE.Scene()
    const foot = createFootShadows(scene, fakeTerrain())
    foot.setPlayerRefs(ref(0, 0, 0), ref(1, 0, 1))
    foot.dispose()
    expect(scene.children.filter(o => o.name === 'footShadow')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/client && bun test src/lib/__tests__/footShadow.test.ts`
Expected: FAIL — cannot resolve `../footShadow.js`.

- [ ] **Step 3: Write `packages/client/src/lib/footShadow.ts`**

```ts
import * as THREE from 'three'
import { CELL_SIZE, THICKNESS } from './constants'
import { LOOK } from './look'
import type { TerrainState } from './terrain'

/**
 * Contact shadow under each character: a soft ellipse that hugs the terrain
 * (built like the player ring in lib/player.ts), elongated along the same axis
 * the baked block shadows fall on (lib/terrainShade.ts uses the same SUN for
 * both faces, so the underside shares the axis). Gives the figure weight
 * without a shadow map. Vertices are rebuilt only when the character's
 * position, surface or the terrain changed — nothing at rest.
 */
type PlayerRef = {
  state: { cx: number; cz: number }
  mesh: THREE.Object3D
  surface: 'top' | 'bottom'
}

const RINGS = 3
const SEGS = 24
const LIFT = 0.06
/** World units of lift at which the shadow has faded out entirely. */
const FADE_LIFT = 2.5

/** Unit horizontal direction the sun's shadows fall along: away from the sun. */
export function shadowAxis(): [number, number] {
  const [x, , z] = LOOK.sun.direction
  const h = Math.hypot(x, z)
  return [-x / h, -z / h]
}

/** Alpha at normalised radius t (0 centre → 1 rim): a smooth (1 − t)² falloff. */
export function footAlpha(t: number): number {
  const u = Math.max(0, 1 - t)
  return LOOK.foot.opacity * u * u
}

/** 1 on the ground → 0 at FADE_LIFT world units above (or below, on the underside). */
export function liftFade(lift: number): number {
  return Math.max(0, 1 - lift / FADE_LIFT)
}

export function createFootShadows(scene: THREE.Scene, terrain: TerrainState) {
  const [axisX, axisZ] = shadowAxis()
  const perpX = -axisZ, perpZ = axisX
  const across = LOOK.foot.across * CELL_SIZE
  const along = LOOK.foot.along * CELL_SIZE
  const offset = LOOK.foot.offset * CELL_SIZE
  const color = new THREE.Color(LOOK.foot.color)   // sRGB hex → linear, like every THREE.Color

  const vertCount = 1 + RINGS * SEGS
  const index: number[] = []
  for (let s = 0; s < SEGS; s++) {
    // fan: centre → ring 1
    index.push(0, 1 + s, 1 + ((s + 1) % SEGS))
    for (let r = 1; r < RINGS; r++) {
      const a = 1 + (r - 1) * SEGS + s
      const b = 1 + (r - 1) * SEGS + ((s + 1) % SEGS)
      const c = 1 + r * SEGS + s
      const d = 1 + r * SEGS + ((s + 1) % SEGS)
      index.push(a, c, b, b, c, d)
    }
  }

  function makeShadow() {
    const positions = new Float32Array(vertCount * 3)
    const colors = new Float32Array(vertCount * 4)
    // Colour and alpha are fixed per vertex; only positions move.
    colors.set([color.r, color.g, color.b, footAlpha(0)], 0)
    for (let r = 1; r <= RINGS; r++) {
      const a = footAlpha(r / RINGS)
      for (let s = 0; s < SEGS; s++) colors.set([color.r, color.g, color.b, a], (1 + (r - 1) * SEGS + s) * 4)
    }
    const geo = new THREE.BufferGeometry()
    const posAttr = new THREE.BufferAttribute(positions, 3)
    geo.setAttribute('position', posAttr)
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 4))   // itemSize 4: vertex alpha
    geo.setIndex(index)
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = 'footShadow'
    mesh.renderOrder = 995   // under the player ring (996)
    mesh.visible = false
    scene.add(mesh)
    return { mesh, mat, posAttr, positions, lastX: NaN, lastZ: NaN, lastSurface: '' as string, lastVersion: -1 }
  }

  const shadows = [makeShadow(), makeShadow()]
  let refs: [PlayerRef | null, PlayerRef | null] = [null, null]

  function rebuild(sh: ReturnType<typeof makeShadow>, wx: number, wz: number, surface: 'top' | 'bottom') {
    const yOff = surface === 'bottom' ? -THICKNESS - LIFT : LIFT
    const cx = wx + axisX * offset
    const cz = wz + axisZ * offset
    const p = sh.positions
    p[0] = cx; p[1] = terrain.getHeight(cx, cz) + yOff; p[2] = cz
    for (let r = 1; r <= RINGS; r++) {
      const t = r / RINGS
      for (let s = 0; s < SEGS; s++) {
        const ang = (s / SEGS) * Math.PI * 2
        const u = Math.cos(ang) * across * t
        const v = Math.sin(ang) * along * t
        const x = cx + perpX * u + axisX * v
        const z = cz + perpZ * u + axisZ * v
        const o = (1 + (r - 1) * SEGS + s) * 3
        p[o] = x; p[o + 1] = terrain.getHeight(x, z) + yOff; p[o + 2] = z
      }
    }
    sh.posAttr.needsUpdate = true
  }

  function updateOne(sh: ReturnType<typeof makeShadow>, ref: PlayerRef | null) {
    if (!ref || !ref.mesh.visible) { sh.mesh.visible = false; return }
    const wx = ref.mesh.position.x, wz = ref.mesh.position.z
    const groundY = terrain.getHeight(wx, wz) + (ref.surface === 'bottom' ? -THICKNESS : 0)
    const fade = liftFade(Math.abs(ref.mesh.position.y - groundY))
    sh.mat.opacity = fade
    sh.mesh.visible = fade > 0.01
    if (!sh.mesh.visible) return
    if (wx !== sh.lastX || wz !== sh.lastZ || ref.surface !== sh.lastSurface || terrain.version !== sh.lastVersion) {
      rebuild(sh, wx, wz, ref.surface)
      sh.lastX = wx; sh.lastZ = wz; sh.lastSurface = ref.surface; sh.lastVersion = terrain.version
    }
  }

  return {
    setPlayerRefs(a: PlayerRef, b: PlayerRef) { refs = [a, b] },
    update(_dt: number) {
      updateOne(shadows[0], refs[0])
      updateOne(shadows[1], refs[1])
    },
    dispose() {
      for (const sh of shadows) {
        scene.remove(sh.mesh)
        sh.mesh.geometry.dispose()
        sh.mat.dispose()
      }
    },
  }
}

export type FootShadowSystem = ReturnType<typeof createFootShadows>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/client && bun test src/lib/__tests__/footShadow.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it in `App.vue`**

Add the import next to the other `./lib/*` imports:

```ts
import { createFootShadows } from './lib/footShadow'
```

Add a system ref next to `let glassSystem …` (~line 1889):

```ts
let footSystem: ReturnType<typeof createFootShadows> | null = null
```

Replace the `nameplates.setPlayerRefs(...)` call (~lines 1960-1963) so both systems share the same getter objects:

```ts
  const playerRefA = { get state() { return players.playerA.state }, get mesh() { return players.playerA.mesh }, get surface() { return players.playerA.surface } }
  const playerRefB = { get state() { return players.playerB.state }, get mesh() { return players.playerB.mesh }, get surface() { return players.playerB.surface } }
  nameplates.setPlayerRefs(playerRefA, playerRefB)
  const foot = createFootShadows(scene, terrainState)
  foot.setPlayerRefs(playerRefA, playerRefB)
  footSystem = foot
```

In `animate()`, right after `players.update(dt)`:

```ts
    foot.update(dt)
```

In the dispose block, after `players.dispose()`:

```ts
    foot.dispose()
```

and after `glassSystem = null`:

```ts
    footSystem = null
```

- [ ] **Step 6: Types, tests, commit**

```bash
cd packages/client && bunx vue-tsc -b --noEmit && bun test
git add packages/client/src/lib/footShadow.ts packages/client/src/lib/__tests__/footShadow.test.ts packages/client/src/App.vue
git commit -m "Give each character a soft contact shadow along the sun's shadow axis

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 7: Look at it**

Capture `node capture.mjs foot` and open `foot-tick1.png`: a soft dark ellipse under the character, offset toward screen-left (the side the block shadows fall to), the ring still readable on top. In the lobby capture the shadows sit under both demo characters.

---

### Task 5: Bearings and `storm.masses()`

**Files:**
- Create: `packages/client/src/lib/bearing.ts`
- Modify: `packages/client/src/lib/storm.ts` (line 51 `DIR_AZIMUTH`; `SWEEP_MS` const; return object)
- Test: `packages/client/src/lib/__tests__/bearing.test.ts` (new), `packages/client/src/lib/__tests__/storm.test.ts`

**Interfaces:**
- Produces:
  - `bearing.ts`: `DIR_AZIMUTH: Record<WindDir, number>` (N 0, E −π/2, S π, W π/2 — unchanged values), `gustDirection(azimuth: number): [number, number]` = `[-sin(az), -cos(az)]` (world x/z the gust travels).
  - `storm.ts`: `export const SWEEP_MS`; `masses(): ReadonlyArray<{ azimuth: number; weight: number }>` — always length 2, allocation-free; `weight = slotFade[k] · intensity · (1 − uZenith) · (1 − uCalmClean)`, `azimuth` = the angle the sky paints for that slot (the sweep anchor while a sweep is in flight, else the spring).

- [ ] **Step 1: Write the failing bearing test**

Create `packages/client/src/lib/__tests__/bearing.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import { DIR_AZIMUTH, gustDirection } from '../bearing.js'

describe('gustDirection', () => {
  // wind.ts: streams travel −z in local space; setDirection maps N→(0,−1), E→(+1,0), S→(0,+1), W→(−1,0) in world.
  it('crosses the board the way the gale from that bearing blows', () => {
    const near = (v: [number, number], e: [number, number]) => { expect(v[0]).toBeCloseTo(e[0], 6); expect(v[1]).toBeCloseTo(e[1], 6) }
    near(gustDirection(DIR_AZIMUTH.N), [0, -1])
    near(gustDirection(DIR_AZIMUTH.E), [1, 0])
    near(gustDirection(DIR_AZIMUTH.S), [0, 1])
    near(gustDirection(DIR_AZIMUTH.W), [-1, 0])
  })
  it('keeps the sky\'s bearing values', () => {
    expect(DIR_AZIMUTH).toEqual({ N: 0, E: -Math.PI / 2, S: Math.PI, W: Math.PI / 2 })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/client && bun test src/lib/__tests__/bearing.test.ts`
Expected: FAIL — cannot resolve `../bearing.js`.

- [ ] **Step 3: Create `bearing.ts` and point `storm.ts` at it**

`packages/client/src/lib/bearing.ts`:

```ts
import type { WindDir } from '@wheee/shared'

/**
 * The one bearing convention for anything that points at where weather comes
 * from. The sky (lib/storm.ts) stands a mass on axis (sin az, cos az) — the
 * source; the gale's streams (lib/wind.ts) and the grass sheen (lib/sheen.ts)
 * travel the opposite way, across the board.
 */
export const DIR_AZIMUTH: Record<WindDir, number> = { N: 0, E: -Math.PI / 2, S: Math.PI, W: Math.PI / 2 }

/** Unit world x/z a gust from `azimuth` travels along: away from the source. */
export function gustDirection(azimuth: number): [number, number] {
  return [-Math.sin(azimuth), -Math.cos(azimuth)]
}
```

In `storm.ts`, delete line 51 (`const DIR_AZIMUTH = …`) and add:

```ts
import { DIR_AZIMUTH } from './bearing'
```

Find the `SWEEP_MS` constant (`grep -n "SWEEP_MS" packages/client/src/lib/storm.ts`) and export it: `export const SWEEP_MS = …` (value unchanged).

- [ ] **Step 4: Run the bearing and storm tests**

Run: `cd packages/client && bun test src/lib/__tests__/bearing.test.ts src/lib/__tests__/storm.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `masses()` tests**

Append to `storm.test.ts` (add `import { DIR_AZIMUTH } from '../bearing.js'` at the top):

```ts
describe('masses — what the sky shows, for the grass', () => {
  const settle = (storm: ReturnType<typeof createStormSystem>, seconds = 6) => {
    for (let t = 0; t < seconds; t += 0.05) storm.update(0.05)
  }

  it('reports two zero-weight slots while asleep', () => {
    const m = createStormSystem(new THREE.Scene()).masses()
    expect(m).toHaveLength(2)
    expect(m[0].weight).toBe(0)
    expect(m[1].weight).toBe(0)
  })

  it('stands one mass on a single candidate\'s bearing', () => {
    const storm = createStormSystem(new THREE.Scene())
    storm.setForecast(['E'], false, false, false)
    storm.setProgress(1)
    settle(storm)
    const m = storm.masses()
    const live = m.filter(x => x.weight > 0.05)
    expect(live).toHaveLength(1)
    expect(live[0].azimuth).toBeCloseTo(DIR_AZIMUTH.E, 6)
    expect(live[0].weight).toBeGreaterThan(0.5)
  })

  it('stands two masses on two candidates and never elsewhere', () => {
    const storm = createStormSystem(new THREE.Scene())
    storm.setForecast(['N', 'W'], false, false, false)
    storm.setProgress(1)
    settle(storm)
    const az = storm.masses().filter(x => x.weight > 0.05).map(x => x.azimuth).sort()
    expect(az).toHaveLength(2)
    expect(az[0]).toBeCloseTo(Math.min(DIR_AZIMUTH.N, DIR_AZIMUTH.W), 6)
    expect(az[1]).toBeCloseTo(Math.max(DIR_AZIMUTH.N, DIR_AZIMUTH.W), 6)
  })

  it('weighs nothing in zenith mode (calm + stormy) and in calm-clean mode', () => {
    for (const stormy of [true, false]) {
      const storm = createStormSystem(new THREE.Scene())
      storm.setForecast([], false, stormy, false)
      storm.setProgress(1)
      settle(storm)
      for (const x of storm.masses()) expect(x.weight).toBeLessThan(0.05)
    }
  })

  it('does not allocate: the same array comes back each call', () => {
    const storm = createStormSystem(new THREE.Scene())
    expect(storm.masses()).toBe(storm.masses())
  })
})
```

- [ ] **Step 6: Run to verify they fail**

Run: `cd packages/client && bun test src/lib/__tests__/storm.test.ts`
Expected: FAIL — `storm.masses is not a function`.

- [ ] **Step 7: Implement `masses()` in `storm.ts`**

Next to the slot arrays (after `const slotDist = …`), add:

```ts
  /** What the sky shows, for the grass (lib/sheen.ts): one entry per slot,
   *  filled in update(), returned as-is — update() and its readers never allocate. */
  const massesOut: { azimuth: number; weight: number }[] = [
    { azimuth: 0, weight: 0 },
    { azimuth: 0, weight: 0 },
  ]
```

In `update()`, right after the block that sets `u.uCalmClean.value` (the uniform writes), add:

```ts
      // The grass reads these instead of the forecast, so it can never point
      // at a bearing the sky does not — zenith and calm-clean carry no wind.
      const windGate = (1 - u.uZenith.value) * (1 - u.uCalmClean.value)
      massesOut[0].azimuth = angle0
      massesOut[0].weight = slotFade[0] * intensity * windGate
      massesOut[1].azimuth = angle1
      massesOut[1].weight = slotFade[1] * intensity * windGate
```

In the returned object, after `getCameraOffset() { return tremorOffset },` add:

```ts
    masses(): ReadonlyArray<{ azimuth: number; weight: number }> { return massesOut },
```

- [ ] **Step 8: Run the storm tests to verify they pass**

Run: `cd packages/client && bun test src/lib/__tests__/storm.test.ts`
Expected: PASS. If the two-candidate test sees only one live mass, check `settle` runs long enough for `slotFade` (FADE_RATE) to reach 1 and that `setForecast` was called before `setProgress` (a sleeping storm snaps its layout).

- [ ] **Step 9: Types, full tests, commit**

```bash
cd packages/client && bunx vue-tsc -b --noEmit && bun test
git add packages/client/src/lib/bearing.ts packages/client/src/lib/storm.ts packages/client/src/lib/__tests__/bearing.test.ts packages/client/src/lib/__tests__/storm.test.ts
git commit -m "Expose the sky's masses from storm.ts and move the bearing convention to bearing.ts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The gust scheduler (pure)

**Files:**
- Create: `packages/client/src/lib/sheen.ts` (scheduler half; Task 7 adds the material half to the same file)
- Test: `packages/client/src/lib/__tests__/sheen.test.ts` (new)

**Interfaces:**
- Consumes: `gustDirection`, `DIR_AZIMUTH` from `bearing.ts`; `HALF` from `constants.ts`; `LOOK.terrain.sheen`.
- Produces:

```ts
export interface Mass { azimuth: number; weight: number }
export interface Gust { dirX: number; dirZ: number; pos: number; strength: number; width: number; tail: number; speed: number }
export const MAX_GUSTS = 3
export const SPAWN_EDGE = -1.4 * HALF          // where a gust is born along its direction
export interface SchedulerOptions { reduced?: boolean; random?: () => number; sweepMs: number }
export function createGustScheduler(opts: SchedulerOptions): {
  follow(masses: ReadonlyArray<Mass>): void
  sweep(dir: WindDir): void
  update(dt: number): void
  gusts(): ReadonlyArray<Gust>
}
```

- [ ] **Step 1: Write the failing scheduler tests**

Create `packages/client/src/lib/__tests__/sheen.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import { createGustScheduler, MAX_GUSTS, SPAWN_EDGE } from '../sheen.js'
import { DIR_AZIMUTH, gustDirection } from '../bearing.js'
import { LOOK } from '../look.js'
import { HALF } from '../constants.js'

const mk = (extra: Partial<Parameters<typeof createGustScheduler>[0]> = {}) =>
  createGustScheduler({ sweepMs: 1400, random: () => 0.5, ...extra })
const run = (s: ReturnType<typeof createGustScheduler>, seconds: number, dt = 0.05) => {
  for (let t = 0; t < seconds; t += dt) s.update(dt)
}

describe('gust scheduler', () => {
  it('spawns nothing with no masses', () => {
    const s = mk()
    s.follow([])
    run(s, 30)
    expect(s.gusts()).toHaveLength(0)
  })

  it('spawns nothing while every weight is at or under 0.05', () => {
    const s = mk()
    s.follow([{ azimuth: 0, weight: 0.05 }, { azimuth: 1, weight: 0 }])
    run(s, 30)
    expect(s.gusts()).toHaveLength(0)
  })

  it('spawns gusts on a single mass\'s bearing, born at the upwind edge, travelling at the token speed', () => {
    const s = mk()
    s.follow([{ azimuth: DIR_AZIMUTH.E, weight: 1 }])
    s.update(0.01)
    const [g] = s.gusts()
    expect(g).toBeDefined()
    const [dx, dz] = gustDirection(DIR_AZIMUTH.E)
    expect(g.dirX).toBeCloseTo(dx, 6)
    expect(g.dirZ).toBeCloseTo(dz, 6)
    expect(g.pos).toBe(SPAWN_EDGE)   // born this frame: update() advances first, then spawns
    expect(g.speed).toBe(LOOK.terrain.sheen.speed)
    expect(g.width).toBe(LOOK.terrain.sheen.width)
    expect(g.tail).toBe(LOOK.terrain.sheen.tail)
  })

  it('scales strength with the mass weight', () => {
    const a = mk(); a.follow([{ azimuth: 0, weight: 1 }]); a.update(0.01)
    const b = mk(); b.follow([{ azimuth: 0, weight: 0.4 }]); b.update(0.01)
    expect(a.gusts()[0].strength).toBeCloseTo(LOOK.terrain.sheen.strength, 6)
    expect(b.gusts()[0].strength).toBeCloseTo(LOOK.terrain.sheen.strength * 0.4, 6)
  })

  it('alternates between two masses and never picks another bearing', () => {
    const s = mk()
    s.follow([{ azimuth: DIR_AZIMUTH.N, weight: 1 }, { azimuth: DIR_AZIMUTH.S, weight: 1 }])
    const seen: string[] = []
    let last = 0
    for (let t = 0; t < 40; t += 0.05) {
      s.update(0.05)
      const gs = s.gusts()
      if (gs.length > last) seen.push(`${gs[gs.length - 1].dirX.toFixed(2)},${gs[gs.length - 1].dirZ.toFixed(2)}`)
      last = gs.length
    }
    expect(seen.length).toBeGreaterThanOrEqual(4)
    const n = `${gustDirection(DIR_AZIMUTH.N)[0].toFixed(2)},${gustDirection(DIR_AZIMUTH.N)[1].toFixed(2)}`
    const so = `${gustDirection(DIR_AZIMUTH.S)[0].toFixed(2)},${gustDirection(DIR_AZIMUTH.S)[1].toFixed(2)}`
    for (let i = 0; i < seen.length; i++) {
      expect([n, so]).toContain(seen[i])
      if (i > 0) expect(seen[i]).not.toBe(seen[i - 1])
    }
  })

  it('spawns faster at full weight than at a faint one, and never more than MAX_GUSTS', () => {
    const count = (w: number) => {
      const s = mk()
      s.follow([{ azimuth: 0, weight: w }])
      let spawned = 0, last = 0
      for (let t = 0; t < 20; t += 0.05) {
        s.update(0.05)
        if (s.gusts().length > last) spawned++
        last = s.gusts().length
        expect(s.gusts().length).toBeLessThanOrEqual(MAX_GUSTS)
      }
      return spawned
    }
    expect(count(1)).toBeGreaterThan(count(0.1))
  })

  it('retires a gust once it has crossed the board', () => {
    const s = mk()
    s.follow([{ azimuth: 0, weight: 1 }])
    s.update(0.01)
    s.follow([])                      // no more spawns
    run(s, (2 * 1.4 * HALF + 2 * LOOK.terrain.sheen.width) / LOOK.terrain.sheen.speed + 1)
    expect(s.gusts()).toHaveLength(0)
  })

  it('sweeps one wide, full-strength gust on the true bearing, timed to the front', () => {
    const s = mk({ sweepMs: 2000 })
    s.follow([{ azimuth: DIR_AZIMUTH.N, weight: 1 }, { azimuth: DIR_AZIMUTH.W, weight: 1 }])
    s.sweep('W')
    const gs = s.gusts()
    expect(gs).toHaveLength(1)
    const [dx, dz] = gustDirection(DIR_AZIMUTH.W)
    expect(gs[0].dirX).toBeCloseTo(dx, 6)
    expect(gs[0].dirZ).toBeCloseTo(dz, 6)
    expect(gs[0].strength).toBe(1)
    expect(gs[0].width).toBe(LOOK.terrain.sheen.width * 2)
    expect(gs[0].speed).toBeCloseTo((2 * 1.4 * HALF) / 2, 6)   // crossing distance / sweep seconds
  })

  it('spawns nothing under reduced motion, sweep included', () => {
    const s = mk({ reduced: true })
    s.follow([{ azimuth: 0, weight: 1 }])
    run(s, 10)
    s.sweep('N')
    expect(s.gusts()).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/client && bun test src/lib/__tests__/sheen.test.ts`
Expected: FAIL — cannot resolve `../sheen.js`.

- [ ] **Step 3: Write the scheduler in `packages/client/src/lib/sheen.ts`**

```ts
import type { WindDir } from '@wheee/shared'
import { HALF } from './constants'
import { LOOK } from './look'
import { DIR_AZIMUTH, gustDirection } from './bearing'

/**
 * The grass reads the sky. Gusts run across the board only from bearings the
 * sky currently shows a mass on (storm.ts masses()), one bearing per gust,
 * never a blend; more often and stronger as the storm builds; one wide wave
 * with the cataclysm's front. Nothing at rest, nothing under reduced motion.
 *
 * This half is pure and unit-tested; createSheenSystem below owns the
 * material patch that draws the gusts.
 */
export interface Mass { azimuth: number; weight: number }
export interface Gust {
  dirX: number; dirZ: number
  /** Distance along (dirX, dirZ) of the gust's head, world units. */
  pos: number
  strength: number
  width: number
  tail: number
  speed: number
}
export interface SchedulerOptions {
  reduced?: boolean
  random?: () => number
  /** The storm front's crossing time (storm.ts SWEEP_MS): the sweep gust keeps step with it. */
  sweepMs: number
}

export const MAX_GUSTS = 3
/** A gust is born this far upwind of the centre and dies the same distance past it. */
export const SPAWN_EDGE = -1.4 * HALF
const LIVE_WEIGHT = 0.05
const INTERVAL_FAINT = 6      // seconds between gusts at weight → 0
const INTERVAL_FULL = 1.8     // at weight 1

export function createGustScheduler(opts: SchedulerOptions) {
  const { reduced = false, random = Math.random, sweepMs } = opts
  const T = LOOK.terrain.sheen
  const live: Gust[] = []
  let masses: ReadonlyArray<Mass> = []
  let turn = 0            // round-robin over the live masses
  let nextIn = 0          // seconds until the next spawn; only counts down while a mass is live

  function interval(weight: number): number {
    const base = INTERVAL_FAINT + (INTERVAL_FULL - INTERVAL_FAINT) * weight
    return base * (0.7 + 0.6 * random())
  }

  function spawn(azimuth: number, strength: number, width: number, speed: number) {
    const [dirX, dirZ] = gustDirection(azimuth)
    live.push({ dirX, dirZ, pos: SPAWN_EDGE, strength, width, tail: T.tail, speed })
  }

  return {
    follow(m: ReadonlyArray<Mass>) { masses = m },
    sweep(dir: WindDir) {
      if (reduced) return
      live.length = 0
      const crossing = 2 * -SPAWN_EDGE
      spawn(DIR_AZIMUTH[dir], 1, T.width * 2, crossing / (sweepMs / 1000))
      nextIn = interval(1)
    },
    update(dt: number) {
      // advance and retire
      for (let i = live.length - 1; i >= 0; i--) {
        const g = live[i]
        g.pos += g.speed * dt
        if (g.pos > -SPAWN_EDGE + g.width + g.tail) live.splice(i, 1)
      }
      if (reduced) return
      // pick the live masses (in slot order, so two candidates alternate)
      let liveCount = 0
      let maxWeight = 0
      for (const m of masses) if (m.weight > LIVE_WEIGHT) { liveCount++; maxWeight = Math.max(maxWeight, m.weight) }
      if (liveCount === 0) return
      nextIn -= dt
      if (nextIn > 0 || live.length >= MAX_GUSTS) return
      let k = turn % liveCount
      turn++
      for (const m of masses) {
        if (m.weight <= LIVE_WEIGHT) continue
        if (k-- === 0) { spawn(m.azimuth, T.strength * m.weight, T.width, T.speed); break }
      }
      nextIn = interval(maxWeight)
    },
    gusts(): ReadonlyArray<Gust> { return live },
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/client && bun test src/lib/__tests__/sheen.test.ts`
Expected: PASS.

- [ ] **Step 5: Types and commit**

```bash
cd packages/client && bunx vue-tsc -b --noEmit && bun test
git add packages/client/src/lib/sheen.ts packages/client/src/lib/__tests__/sheen.test.ts
git commit -m "Add the pure gust scheduler: the grass follows the sky's masses

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Draw the gusts and wire the sheen (match, cataclysm, lobby)

**Files:**
- Modify: `packages/client/src/lib/sheen.ts` (add `createSheenSystem`)
- Modify: `packages/client/src/lib/lobbyDemo.ts` (factory signature; `wind` and `rain` phases; `stop()`)
- Modify: `packages/client/src/App.vue` (imports; after `terrainMat`; `animate()`; cataclysm block ~line 1816-1820; `createLobbyDemo` call ~line 2300; dispose)
- Test: `packages/client/src/lib/__tests__/sheen.test.ts`

**Interfaces:**
- Consumes: `createGustScheduler`, `SWEEP_MS` from `storm.ts`, `storm.masses()`, `DIR_AZIMUTH`.
- Produces:

```ts
export interface SheenHandle { follow(masses: ReadonlyArray<Mass>): void }
export function createSheenSystem(material: THREE.MeshStandardMaterial, scheduler: ReturnType<typeof createGustScheduler>): {
  follow(masses): void; sweep(dir: WindDir): void; update(dt): void
  uniforms: { uGust: { value: Float32Array }; uGustWidth: { value: Float32Array }; uGustTail: { value: Float32Array }; uSheenColor: { value: THREE.Color } }
  dispose(): void
}
```

`createLobbyDemo(terrain, wind, rain, water, sheen: SheenHandle, callbacks)`.

- [ ] **Step 1: Write the failing system tests**

Append to `sheen.test.ts` (add `import * as THREE from 'three'` and `import { createSheenSystem } from '../sheen.js'`):

```ts
describe('sheen system (material patch)', () => {
  const make = () => {
    const mat = new THREE.MeshStandardMaterial()
    const sys = createSheenSystem(mat, mk())
    return { mat, sys }
  }

  it('installs the patch once and marks the program', () => {
    const { mat } = make()
    expect(typeof mat.onBeforeCompile).toBe('function')
    expect(mat.customProgramCacheKey()).toContain('sheen')
  })

  it('injects the band into a standard shader', () => {
    const { mat } = make()
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: '#include <begin_vertex>\n',
      fragmentShader: '#include <color_fragment>\n',
    }
    mat.onBeforeCompile(shader as never, {} as never)
    expect(shader.vertexShader).toContain('vWorldXZ')
    expect(shader.fragmentShader).toContain('uGust')
    expect(shader.uniforms.uGust).toBeDefined()
  })

  it('copies live gusts into the uniform array and zeroes the rest', () => {
    const { sys } = make()
    sys.follow([{ azimuth: DIR_AZIMUTH.N, weight: 1 }])
    sys.update(0.02)
    const u = sys.uniforms.uGust.value
    expect(u).toHaveLength(12)
    expect(u[3]).toBeGreaterThan(0)                  // gust 0 strength
    expect(u[7]).toBe(0)
    expect(u[11]).toBe(0)
    const [dx, dz] = gustDirection(DIR_AZIMUTH.N)
    expect(u[0]).toBeCloseTo(dx, 5)
    expect(u[1]).toBeCloseTo(dz, 5)
  })

  it('leaves every strength at zero with no masses', () => {
    const { sys } = make()
    sys.follow([])
    sys.update(1)
    for (const i of [3, 7, 11]) expect(sys.uniforms.uGust.value[i]).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/client && bun test src/lib/__tests__/sheen.test.ts`
Expected: FAIL — `createSheenSystem` is not exported.

- [ ] **Step 3: Add `createSheenSystem` to `sheen.ts`**

Add at the top of `sheen.ts`: `import * as THREE from 'three'`. Append:

```ts
export interface SheenHandle { follow(masses: ReadonlyArray<Mass>): void }

const GLSL_DECL = /* glsl */ `
uniform vec4 uGust[3];        // dirX, dirZ, pos, strength
uniform float uGustWidth[3];  // per-gust width (world units)
uniform float uGustTail[3];   // per-gust tail (world units)
uniform vec3 uSheenColor;
varying vec2 vWorldXZ;
`

// Applied to the diffuse colour BEFORE lighting, so the sun and fill stay honest.
// Leading highlight around the head, a shorter shade behind it (grass laid
// over, away from the sun); a cheap sine along the band breaks the ruler line.
const GLSL_BAND = /* glsl */ `
for (int i = 0; i < 3; i++) {
  vec4 g = uGust[i];
  if (g.w <= 0.0) continue;
  vec2 dir = g.xy;
  float p = dot(vWorldXZ, vec2(-dir.y, dir.x));
  float edge = sin(p * 0.35) * 2.5 + sin(p * 0.9 + 1.7) * 1.2;
  float d = dot(vWorldXZ, dir) - g.z + edge;
  float w = uGustWidth[i];
  float lead = exp(-(d * d) / (w * w));
  float t = (d + uGustTail[i]) / uGustTail[i];
  float trail = exp(-t * t);
  diffuseColor.rgb *= 1.0 + g.w * (lead * uSheenColor - 0.5 * trail);
}
`

/**
 * Patches the shared terrain material (top, underside and skirt) so a gust
 * from the scheduler is drawn as a moving band in world space. Installed
 * before the first render — the program compiles once, with every strength
 * at 0, and never again (customProgramCacheKey pins it; `transparent` is
 * already flipped on by lib/glass.ts at creation, so no flag changes later).
 */
export function createSheenSystem(material: THREE.MeshStandardMaterial, scheduler: ReturnType<typeof createGustScheduler>) {
  const T = LOOK.terrain.sheen
  const uniforms = {
    uGust: { value: new Float32Array(MAX_GUSTS * 4) },
    uGustWidth: { value: new Float32Array(MAX_GUSTS).fill(1) },   // never 0: an idle slot must not divide by zero
    uGustTail: { value: new Float32Array(MAX_GUSTS).fill(1) },
    uSheenColor: { value: new THREE.Color(T.color) },
  }
  const previous = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    previous?.(shader, renderer)
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = 'varying vec2 vWorldXZ;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;')
    shader.fragmentShader = GLSL_DECL + shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + GLSL_BAND)
  }
  material.customProgramCacheKey = () => 'meadow-sheen'
  material.needsUpdate = true

  return {
    uniforms,
    follow(masses: ReadonlyArray<Mass>) { scheduler.follow(masses) },
    sweep(dir: WindDir) { scheduler.sweep(dir) },
    update(dt: number) {
      scheduler.update(dt)
      const g = scheduler.gusts()
      const u = uniforms.uGust.value
      for (let i = 0; i < MAX_GUSTS; i++) {
        const o = i * 4
        if (i < g.length) {
          u[o] = g[i].dirX; u[o + 1] = g[i].dirZ; u[o + 2] = g[i].pos; u[o + 3] = g[i].strength
          uniforms.uGustWidth.value[i] = g[i].width
          uniforms.uGustTail.value[i] = g[i].tail
        } else {
          u[o] = 0; u[o + 1] = 0; u[o + 2] = 0; u[o + 3] = 0
          uniforms.uGustWidth.value[i] = 1
          uniforms.uGustTail.value[i] = 1
        }
      }
    },
    dispose() {
      material.onBeforeCompile = previous ?? (() => {})
      material.needsUpdate = true
    },
  }
}
```

- [ ] **Step 4: Run the sheen tests to verify they pass**

Run: `cd packages/client && bun test src/lib/__tests__/sheen.test.ts`
Expected: PASS.

- [ ] **Step 5: Give the lobby demo a sheen handle**

In `lobbyDemo.ts`:

```ts
import type { SheenHandle } from './sheen'
import { DIR_AZIMUTH } from './bearing'
```

Change the factory signature to

```ts
export function createLobbyDemo(
  terrain: TerrainState,
  wind: WindSystem,
  rain: RainSystem,
  water: WaterSystem,
  sheen: SheenHandle,
  callbacks: DemoCallbacks,
): LobbyDemo {
```

In the `wind` phase:

```ts
      enter() {
        const dir = WIND_CYCLE[windDirIndex % WIND_CYCLE.length]
        wind.setDirection(dir)
        windDirIndex++
        wind.setVisible(true)
        sheen.follow([{ azimuth: DIR_AZIMUTH[dir], weight: 0.7 }])
        reposition(2)
      },
      exit() {
        wind.setVisible(false)
        sheen.follow([])
      },
```

In the `rain` phase (the one that also sets a wind direction, ~lines 91-104): compute `const dir = WIND_CYCLE[windDirIndex % WIND_CYCLE.length]` the same way, pass it to `wind.setDirection(dir)`, add `sheen.follow([{ azimuth: DIR_AZIMUTH[dir], weight: 0.7 }])` on enter and `sheen.follow([])` on exit. In `stop()` (where `wind.setVisible(false)` and `rain.setVisible(false)` are called, ~line 131 and ~142), add `sheen.follow([])`.

- [ ] **Step 6: Wire `App.vue`**

Imports:

```ts
import { createGustScheduler, createSheenSystem } from './lib/sheen'
import { SWEEP_MS } from './lib/storm'
```

(`createStormSystem` is already imported from `./lib/storm`; add `SWEEP_MS` to that import instead of a second line.)

System ref next to `footSystem`:

```ts
let sheenSystem: ReturnType<typeof createSheenSystem> | null = null
```

Right after `const terrainMat = new THREE.MeshStandardMaterial({ … })` (before any mesh is created):

```ts
  // The grass reads the sky: gusts only from bearings storm.masses() shows.
  // Patched here, before the first render, so the program compiles once.
  const sheen = createSheenSystem(terrainMat, createGustScheduler({
    sweepMs: SWEEP_MS,
    reduced: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  }))
  sheenSystem = sheen
```

In `animate()`, right after `storm.update(dt)`:

```ts
    if (!lobbyDemoActive) sheen.follow(storm.masses())
    sheen.update(dt)
```

In the cataclysm block, right after `sweepWait = stormSystem?.sweep(weather.dir) ?? Promise.resolve()`:

```ts
          sheenSystem?.sweep(weather.dir)
```

`createLobbyDemo` call: `lobbyDemo = createLobbyDemo(terrainState, wind, rain, water, sheen, { … })`.

Dispose: after `glass.dispose()` add `sheen.dispose()`; after `glassSystem = null` add `sheenSystem = null`.

- [ ] **Step 7: Types, tests, commit**

```bash
cd packages/client && bunx vue-tsc -b --noEmit && bun test
git add packages/client/src/lib/sheen.ts packages/client/src/lib/lobbyDemo.ts packages/client/src/App.vue packages/client/src/lib/__tests__/sheen.test.ts
git commit -m "Draw wind gusts on the grass from the sky's bearings, in matches and the lobby demo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 8: Look at it moving**

In the harness directory, capture with a longer wait so a mid-round frame lands during a gust: copy `capture.mjs` to `capture-gust.mjs`, replace the single tick-1 screenshot with a loop that takes six screenshots 0.5 s apart after the 7 s settle (`gust-0.png … gust-5.png`), and run it. Open two or three: a warm band should be crossing the board from the horizon the forecast dial points at, on both the top face and (if the FLIP button was pressed — optional) the underside; no band when the dial shows no wind. Also open the lobby capture from the same run taken during the demo's wind phase (extend the lobby wait to ~20 s in the copy so the demo reaches `wind`): a band moves with the streams.

If the WebGL program fails to compile, the console shows `THREE.WebGLProgram: Shader Error`; read it with `page.on('console', …)` in the copy and fix the GLSL (common causes: a missing `;`, `continue` outside WebGL2 — the renderer is WebGL2 by default in r183 — or a duplicate `varying` declaration).

---

### Task 8: Tune against the metrics, document, record the outcome

**Files:**
- Modify: `packages/client/src/lib/look.ts` (token values only), `game/GAME_DESIGN.md`, `docs/superpowers/specs/2026-09-05-meadow-field-design.md` (append "## Outcome"), this plan (append results under "## Baseline")

- [ ] **Step 1: Capture "after" and compute the metrics**

```bash
cd <scratchpad>/harness && node capture.mjs after && node metrics.mjs after-tick1.png && node metrics.mjs before-tick1.png
```

Compare with the baseline: board `spread` ≥ 2× baseline, board `mean` within ±10%, sky `mean` within ±3%, `frameMs` within ±10% (SwiftShader noise is real — rerun `capture.mjs` twice and take the better of each if they disagree by more than 10%).

- [ ] **Step 2: Tune tokens until every target holds**

Only `look.ts` values move. Levers, in order: `swell.amp` (up to the invariant: `amp + groove.depth ≤ 0.2`), `swell.tint`, `swell.crest`/`swell.trough`, `grain`, then `grid.opacity`. If the board `mean` drifted more than 10 %, adjust `terrain.grass` a step lighter/darker rather than the crest/trough. After each change: `bun test src/lib/__tests__/look.test.ts src/lib/__tests__/meadow.test.ts src/lib/__tests__/terrain.test.ts`, Vite reloads, re-capture, re-measure. Open the final `after-tick1.png` and `after-lobby.png` with the Read tool and confirm by eye: waves of light, grooved seams, character shadow, hills untouched, nothing reads as a level.

- [ ] **Step 3: Document the meadow in `game/GAME_DESIGN.md`**

Add a subsection after §5.3 «Это ты» (before §6), in Russian, matching the document's voice:

```markdown
### 5.4 Луг

Плоская клетка не плоская: по ней идёт запечённая зыбь высотой в сотые доли
уровня (`packages/client/src/lib/meadow.ts`), которую низкое солнце превращает в
мягкие волны света; гребни теплее и светлее, ложбины холоднее. Границы клеток
прорезаны канавкой, и линия сетки лежит на её дне. Под каждым персонажем мягкая
тень вдоль той же оси, по которой ложатся тени блоков. Ничто из этого не читается
как уровень: зыбь и канавка вместе ниже порога запечённой тени и порогов
подсветки высот.

Трава читает небо (`lib/sheen.ts`): порыв бежит по лугу только с того румба, на
котором стоит масса прогноза (§11), при двух кандидатах порывы чередуются и
никогда не смешиваются, при штиле, чистой молнии и чистом дожде их нет. С
интенсивностью бури порывы учащаются; в катаклизме одна широкая волна проходит
вместе с фронтом. При `prefers-reduced-motion` луг неподвижен.
```

- [ ] **Step 4: Record the outcome in the spec**

Append to `docs/superpowers/specs/2026-09-05-meadow-field-design.md`:

```markdown
## Outcome (2026-09-0X)

Final tokens: swell.amp …, groove.depth …, swell.tint …, grain …, grid.opacity ….
Frozen first-tick frame, board region: spread before … → after … (target ≥ 2×);
mean before … → after …; sky mean before … → after …; frame interval at rest
before … ms → after … ms. Repaint budget test: … ms. Deviations from the design:
… (or "none").
```

Fill every `…` with the measured numbers; delete the "Deviations" clause if there were none. Add the same numbers under "## Baseline" in this plan as an "after" row.

- [ ] **Step 5: Full verification and commit**

```bash
cd packages/client && bun test && bunx vue-tsc -b --noEmit
cd ../.. && git add packages/client/src/lib/look.ts game/GAME_DESIGN.md docs/superpowers/specs/2026-09-05-meadow-field-design.md docs/superpowers/plans/2026-09-05-meadow-field.md
git commit -m "Tune the meadow tokens against the first-tick captures and record the outcome

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 6: Hand the pictures to the owner**

Send `before-tick1.png` and `after-tick1.png` (and `after-lobby.png`) to the user with SendUserFile, caption "до / после: первый тик на плоской доске". Stop the server and Vite you started (only those). Delete nothing in the repo; the harness stays in the scratchpad.

---

## Self-review

- **Spec coverage.** Tokens → Task 2. Static layer (swell, groove, fade, tint, `getHeightRaw`, `paintColors`) → Tasks 2–3. Grid opacity → Task 2 (token) with tuning in Task 8. Foot shadows → Task 4. `storm.masses()`, bearing convention, `SWEEP_MS` → Task 5. Scheduler rules (edge spawn, interval by weight, round-robin, never an unnamed bearing, sweep, reduced motion) → Task 6. Material patch, per-frame uniforms, App/cataclysm/lobby wiring → Task 7. Acceptance metrics, frame time, GAME_DESIGN, outcome → Tasks 1 and 8. One spec deviation, recorded here on purpose: `masses()` returns two entries with weight 0 while asleep instead of an empty array (allocation-free; consumers threshold at 0.05).
- **Placeholders.** None: every step carries its code or exact command; the Outcome template's `…` are to be filled with measured numbers in Task 8, Step 4, and that step says so.
- **Type consistency.** `Mass`/`Gust`/`SheenHandle` names match between `sheen.ts`, `lobbyDemo.ts` and `App.vue`; `createGustScheduler({ sweepMs, reduced, random })` matches its tests; `masses()` returns `ReadonlyArray<{ azimuth, weight }>` everywhere; `createFootShadows` takes `(scene, terrain)` and `setPlayerRefs(a, b)` with the nameplate's `PlayerRef` shape; `gustDirection` is `[-sin, -cos]` in Task 5's code and tests and in Task 6's expectations.

## Baseline

(Filled by Task 1, Step 5 and Task 8, Step 4.)
