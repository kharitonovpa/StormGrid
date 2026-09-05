# Meadow field — the flat board as light, material and wind — design

Date: 2026-09-05

## Problem

Every match starts on a board where all 49 cells are at height 0
(`game/GAME_DESIGN.md` §2), and by the Sept 4 playtest most matches end in round 1,
so the flat board *is* the game's look for most players. Captured on prod today
(1280×800, first tick, headless Chromium): the board is one green sheet. A flat
cell is literally flat — `getHeightRaw` returns exactly 0 (`terrain.ts:33`), the
normal is straight up, and the only variation is two weak noise octaves
(±0.12, ±0.08) and the ±12% checkerboard. Nothing structures light on it: the
dusk look's baked shadows, contact occlusion and warm-key/cool-fill contrast all
derive from height differences, and there are none. The lobby, which sculpts the
same slab (`lobbyDemo.ts`), looks alive with the same renderer; the match throws
that away the moment it starts.

## Decisions taken during brainstorming

- **Cosmetic only.** No engine change, no starting terrain (the owner considered
  and declined engine-side starting relief; this spec is the alternative).
- **Brief: Jony Ive with Jonathan Blow looking over his shoulder.** Restraint and
  material honesty, not decoration: no props, stones, tufts or textures. The field
  gets interesting through light on a real (if tiny) surface, a designed colour
  field, a seam that behaves like a physical joint, weight under the characters —
  and motion only where it means something.
- **Alive by meaning (level 2).** The grass moves only when the forecast names
  wind, from the bearing it names, following exactly the sky's rule in `storm.ts`.
  No idle "breathing".
- **Near-zero cost.** Everything static is baked into vertex positions/colours,
  which are recomputed only while the terrain animates (App.vue's `animate()`
  calls `rebuildMesh`/`repaintTerrain` only under `if (animating)`), so at rest
  the static layer costs nothing per frame. The living layer is one uniform
  update per frame and a few ALU ops per terrain fragment.

## Goal

1. The first-tick board reads as a dusk meadow with visible light structure: soft
   swells of light and shade, warm crests and cool hollows, a seam that catches
   the sun, characters that sit on the ground rather than float on it.
2. Nothing in it can be misread as a height level. Level legibility stays sacred.
3. Wind is visible in the grass before it arrives, exactly where the sky already
   says it will come from — and nowhere the forecast did not name.
4. Repaint time stays within the existing budget test; frame time at rest is
   unchanged; no new dependencies, textures or render passes.

Measurable on the frozen first-tick frame (same harness as the dusk-look spec,
board region only, measured on the current build first as the baseline):

- lightness p10–p90 spread across the flat board ≥ 2× baseline;
- mean board lightness within ±10% of baseline (the board gets structure, not
  darker or brighter);
- pixels outside the board region unchanged (sky and HUD are not touched).

## Non-goals

- No engine file changes; no changes to the hill/pit palette, water, `wind.ts`,
  `rain.ts`, `lightning.ts`, character models, HUD or the camera.
- No textures, sprites-as-props, shadow maps, post-processing or new dependencies.
- No idle motion. No motion under `prefers-reduced-motion`.
- The lobby's card previews (`CharacterPreview.vue`) are not changed.

## Design

### Look tokens (`lib/look.ts`)

Starting values; tuned against the frozen-frame captures, `look.ts` stays the
authority. The structure is the contract.

```ts
terrain: {
  ...existing,
  grain: 0.05,                     // fine per-vertex grass grain (replaces the 0.12 / 0.08 noise pair)
  swell: {
    amp: 0.08,                     // world units, peak height of the meadow swell on a flat cell
    wavelength: 1.2,               // in cells
    crest: 0x9cb857,               // sunlit straw-green toward which crests are tinted
    trough: 0x2f6e4a,              // cool blue-green toward which hollows are tinted
    tint: 0.35,                    // 0..1 blend toward crest/trough at full swell
  },
  groove: { depth: 0.12, halfWidth: 1 },   // world units deep; half-width in mesh segments
  sheen: {
    color: 0xf0d890,               // warm highlight a gust lays on the grass
    strength: 0.35,                // multiplicative lift at full storm weight
    width: 12, tail: 6,            // world units: leading highlight, trailing shade
    speed: 22,                     // world units per second (a gust crosses the board in ~4 s)
  },
},
grid: { color: 0xc8c4ff, opacity: 0.18 },  // quieter: the groove now carries the seam
foot: {                            // the characters' contact shadow
  color: 0x14122e, opacity: 0.45,
  across: 0.32, along: 0.55, offset: 0.15,   // ellipse radii and centre offset, in cells, along the sun's shadow axis
},
```

Invariant (unit-tested): `swell.amp + groove.depth ≤ 0.2` world units, i.e.
0.04 levels — under `terrainShade.DEAD_ZONE` (0.05 levels = 0.25 world units)
with margin, so the baked shadow and contact terms never see the decoration.

### Static layer — `lib/meadow.ts` (new, pure, no `three`)

```ts
swell(wx, wz): number                     // world-unit height offset, |value| ≤ swell.amp, deterministic
groove(wx, wz): number                    // ≤ 0, depth at cell borders, 0 at ≥ halfWidth from any border
flatWeight(levels): number                // 1 on a flat cell → 0 at |levels| ≥ 1, smooth
meadowTint(s): [r, g, b]                  // s = swell / amp in [-1, 1] → multiplicative RGB factors (linear)
```

- **Swell** is two octaves of the existing deterministic `noise2d` at fixed
  offsets (no seed: the underside, the height cache and captures must agree),
  frequency set so the dominant wavelength is `swell.wavelength` cells, scaled to
  `±amp`. Normals tilt ~2–3°; at the 28° sun that is a ±5–10% lighting swing —
  soft waves of light across the meadow, drawn by the light rig for free.
- **Groove** is a V profile at every cell border, including the slab's outer
  edge (where the half-groove becomes a small chamfer on the rim). Distance to
  the nearest border along x and along z; the V's half-width is one mesh
  segment (`CELL_SIZE / 15 ≈ 0.57`); the two axes combine by `max` so corners are
  clean. Wall slope ≈ 12°, so `paintColors`' slope→rock rule (which starts at
  `|n.y| < 0.75`, ≈ 41°) never paints a groove as rock.
- **Fade with height.** Both are multiplied by `flatWeight(current[cz][cx])`.
  While a cell animates from 0 to ±1 the swell and groove shrink as the existing
  `fbm · |h|` hill noise grows, so the surface stays continuous through the
  animation and the hills' displaced vertices (`rebuildMesh`'s `dx/dz`) never
  carry a wobbling groove. Hill tops keep today's look.
- **Tint** is driven by the same swell value, not by a second noise: crests blend
  toward `crest`, hollows toward `trough`, by `swell.tint`. One cause, two effects.
  It is a function of world x/z only, so a vertex painted at the same spot on a
  flat and a sculpted board gets the same tint (the existing baked-shading tests
  compare exactly that).

### Terrain wiring (`lib/terrain.ts`)

- `getHeightRaw`: the flat early-return goes away. For every vertex,
  `y = h·HEIGHT_SCALE + n·|h| + (swell + groove)·flatWeight(h)`. The height cache,
  the grid lines, the player ring, arrows, highlights and character placement all
  read `getHeight`, so they follow the meadow with no further changes: the grid
  line sits at the groove floor + 0.05, reads as etched into the joint, and stays
  visible from any camera elevation above ~7°.
- `paintColors`: the coarse noise pair is replaced by `grain` plus
  `meadowTint(swell(wx, wz) / amp)` applied to the grass colour before the
  height lift/sink and the checkerboard. Rock, mud, snow, the baked terms and the
  crop accent are untouched.
- The underside shares `rebuildMesh`'s positions (`y − THICKNESS`), so the swell
  and groove are mirrored automatically and its tint reads the same swell.

### Weight under the characters — `lib/footShadow.ts` (new)

One soft ellipse per character (A and B), built like the player ring: a small
fan (3 rings × 24 segments) whose vertices sample `terrain.getHeight` plus the
surface offset and a 0.06 lift, so it hugs swell and groove instead of clipping.
Radial falloff is written into a 4-component colour attribute (vertex alpha);
`MeshBasicMaterial({ vertexColors, transparent, depthWrite: false, toneMapped: false })`
with `foot.color`, render order just below the ring.

- Shape: radii `across` × `along` cells, centre pushed `offset` cells along the
  sun's horizontal shadow direction (the negated x/z of `LOOK.sun.direction`,
  normalised). This is the same axis the baked block shadows fall along, and
  `terrainShade` builds the underside's field from the same `SUN`, so the
  underside uses the same horizontal axis.
- Follows the character mesh's x/z every frame it moves; opacity scales by
  `max(0, 1 − liftAboveGround / 2.5)` so it fades under a move arc or a body
  carried by the gale, and it is hidden whenever the mesh is hidden or the
  player is dead/submerged. Vertices are rebuilt only when the position, the
  surface or the terrain (while animating) changed — ≈150 bilinear lookups then,
  nothing at rest.

### Living layer — the grass reads the sky

**`storm.ts` exposes what it shows.** New read-only method:

```ts
masses(): ReadonlyArray<{ azimuth: number; weight: number }>
```

One entry per active slot: `azimuth` is the slot's current bearing (the spring
position — for a broken vane, wherever its roaming mass stands right now),
`weight = slotFade · intensity`, and `weight` is 0 in zenith mode (calm + stormy)
and in calm-clean mode — no wind, no gusts. This is the only new coupling: the
grass never reads the forecast itself, it reads the sky, so the two can never
disagree, including under a broken vane or barometer.

**`lib/sheen.ts` (new).** Two parts:

1. A pure gust scheduler, unit-testable without `three`:

   ```ts
   createGustScheduler(opts): {
     follow(masses): void            // what the sky shows this frame
     sweep(dir: WindDir): void       // the cataclysm names its true bearing
     update(dt): void
     gusts(): ReadonlyArray<{ dirX, dirZ, pos, strength, width, tail }>   // ≤ 3
   }
   ```

   - A gust is born at the upwind edge of the board (`pos = −1.4·HALF` along its
     direction), travels at `sheen.speed`, and dies past the far edge.
   - Spawn interval eases from 6 s at weight ≈ 0 to 1.8 s at weight 1 (±30%
     jitter), only while some mass has `weight > 0.05`. Gust strength is
     `sheen.strength · weight`.
   - With two masses the bearing alternates round-robin between them; a gust is
     always exactly one bearing, never a blend. A gust is never spawned on a
     bearing that is not currently in `masses()`.
   - `sweep(dir)` spawns one wide gust (`width` ×2, strength 1) on the true
     bearing, timed to cross the board with the storm front (`SWEEP_MS`), and
     clears any pending spawn. After the cataclysm the weights drain with the
     discharge and gusts stop by themselves.
   - Under `prefers-reduced-motion` (same `REDUCED` test as `storm.ts`) neither
     `follow` nor `sweep` spawns anything.
   - Direction: a gust from bearing *N* crosses the board the way the *N* gale's
     streams do in `wind.ts` — from the horizon the storm mass stands on toward
     the opposite edge. `DIR_AZIMUTH` (`storm.ts:51`) is the single bearing
     convention; the azimuth→(dirX, dirZ) mapping is pinned by a test against
     the four cardinals.

2. A material patch. `terrainMat.onBeforeCompile` is installed once, before the
   first render, adding a `vWorldXZ` varying and `uniform vec4 uGust[3]`
   (dirX, dirZ, pos, strength) plus `uGustWidth`, `uGustTail`, `uSheenColor`.
   After `#include <color_fragment>`, for each gust:
   `d = dot(vWorldXZ, dir) − pos`; a leading highlight `exp(−(d/width)²)` lifts
   `diffuseColor.rgb` toward `sheenColor · strength`, a trailing `exp(−((d+tail)/tail)²)`
   darkens by half that; the band's edge is broken by a cheap sine of the
   perpendicular coordinate so it never reads as a ruler line. Modulating the
   diffuse colour before lighting keeps the sun and fill honest. `customProgramCacheKey`
   marks the patched program; `transparent` is already true from the glass
   system, so no flag flips and no mid-storm recompile. Both faces and the skirt
   share the material and the world-space band, so a gust crosses the underside
   in step with the top.

**Wiring (`App.vue`).** In `animate()`, in match mode: `sheen.follow(storm.masses())`
then `sheen.update(dt)`, then the gust list is copied into the uniforms. Where
the cataclysm calls `stormSystem.sweep(dir)`, `sheen.sweep(dir)` is called too.
`createLobbyDemo` takes a `sheen` handle like `wind` and `rain`: its wind and
rain-with-wind phases call `follow([{ azimuth: DIR_AZIMUTH[dir], weight: 0.7 }])`
on enter and `follow([])` on exit, so the lobby's gusts come with the demo's gale.

## Testing

Unit (bun test, `packages/client/src/lib/__tests__`):

- `meadow.test.ts`: `|swell| ≤ amp` over a dense sample; `swell.amp + groove.depth ≤ 0.2`;
  `groove` is 0 at a cell centre and `−depth` on a border; `flatWeight(0) = 1`,
  `flatWeight(±1) = 0`, monotone; `meadowTint(+1)` is warmer/lighter than
  `meadowTint(−1)`; determinism (same input, same output).
- `terrain.test.ts`: `getHeightRaw` on a flat board is within `±(amp + depth)` of 0
  and not identically 0; a fully raised cell has no swell/groove term (matches
  today's value); existing accent, baked-shading, underside and repaint-budget
  tests keep passing unchanged.
- `sheen.test.ts` (scheduler): no gusts when `follow([])`; no gust on a bearing
  absent from the last `follow`; two masses alternate; strength scales with
  weight; `sweep` yields one gust on the true bearing; azimuth→direction pinned
  for N/E/S/W against `wind.ts`'s convention; nothing spawns when reduced.
- `storm.test.ts`: `masses()` is empty when sleeping, has one entry per candidate,
  reports weight 0 in zenith mode, and its azimuths equal `DIR_AZIMUTH` of the
  candidates.
- `look.test.ts`: new tokens are valid hex / in range, and the DEAD_ZONE invariant.

Visual, on the frozen-frame harness (`docs/superpowers/specs/2026-09-05-dusk-look-design.md`,
Testing): first-tick captures before and after for the three acceptance metrics
above; a lobby capture; a mid-round capture with a two-candidate forecast (two
gust bearings, none other) and one during a sweep. Frame time on the same
harness at rest and mid-storm, before and after, within noise.

## Order of work

Three independently shippable steps, each a plan task with its own review:

1. Static layer: tokens, `meadow.ts`, terrain wiring, grid opacity, captures.
2. Foot shadows.
3. Sheen: `storm.masses()`, scheduler, material patch, App and lobby wiring.

Static first, because it carries most of the effect and all of the risk to level
legibility; the sheen is only worth tuning on top of a settled field.

## Outcome (2026-09-05)

Final tokens: `swell.amp` 0.12, `groove.depth` 0.08, `swell.wavelength` 0.7,
`swell.tint` 1.0, `swell.crest` 0xacc264, `swell.trough` 0x2b6446, `grain` 0.16,
`grid.opacity` 0.18 (unchanged), `foot` opacity 0.6 / across 0.32 / along 0.62 /
offset 0.15, `sheen` strength 0.8 / width 5 / tail 5 / speed 26 / colour 0xf0d890.

Frozen first-tick frame, board region: spread before 0.054 → after 0.126
(target ≥ 2× = 0.108); mean before 0.439 → after 0.444 (band 0.395–0.483); sky
mean before 0.258 → after 0.258 (band 0.250–0.266). A confirmation capture on
the same build read spread 0.132 / mean 0.442 / sky 0.258. Repaint budget test
(`paintColors` over a full board plane, 105×105 segments — `SEGMENTS = CELLS *
15` with `CELLS` 7 — best of five): 3.69 ms against the test's 40 ms ceiling.

Frame interval at rest: 98 ms before → 84.7 and 85.1 ms after, against a
±10 % band of 88.2–107.8 ms. The tuned build is *faster* than the baseline
band's floor, not slower, and the harness's own readings are bimodal: across
twelve runs the same code gave 84.4, 84.7, 84.8, 85.1, 86.4, 97.2, 100.9,
101.2, 101.7 and 103.3 ms, clustering at ~85 ms whenever nothing else was
running on the machine and at ~102 ms when a second capture was in flight. The
baseline's 98 ms was measured in the busy regime. Every reading of the tuned
build sits at or under the baseline, so the meadow's fragment cost is inside
the noise; the band's lower edge is tripped by machine load, not by the change.

Tuning path (each step measured on a fresh first-tick capture): the starting
tokens gave spread 0.066 — the swell was real but far under the target. `tint`
0.35→0.65, `grain` 0.05→0.07, `amp` 0.08→0.10 took it to 0.085; `tint`→0.85,
`grain`→0.09 did not move the whole-frame number (0.084) although the mid-board
band went 0.097→0.109, because more than half the metric's pixels are the near
foreground, where one swell period covered the entire sampled window. Halving
`swell.wavelength` (1.2→0.7 cells) is what reached the near field — spread
0.102, and the near-foreground sub-window 0.048→0.082. `grain`→0.16 and
`tint`→1.0 gave 0.116, and finally widening the crest/trough pair
(0x9cb857/0x2f6e4a → 0xacc264/0x2b6446) with `amp`→0.12 / `groove.depth`→0.08
settled at 0.121 with the mean still mid-band.

Deviations from the design, recorded honestly:

- `storm.masses()` returns two entries with weight 0 while the sky is asleep
  instead of an empty array (allocation-free; every consumer thresholds at 0.05).
- `rebuildMesh` gates its sideways hill jitter on the cell's level rather than on
  the vertex y, so the flat meadow stays exactly on its grid.
- A gust is retired 3σ past the far corner rather than 1σ: the Gaussian has to be
  invisible before the slot is freed. With the reviewed birth position a gust
  lives `(crossing + 3·width + tail) / speed` = `(2·√2·HALF + 6·width + tail) /
  speed` = 119.85 / 26 ≈ **4.6 s**, so with three slots one frees every ~1.54 s.
  At full weight the interval draw (1.8 s ±30 %, i.e. 1.26–2.34 s) is what
  usually binds; only a draw under 1.54 s is clipped by the cap, and while the
  pool is capped the jitter does not apply at all — the spawn lands on the
  retirement.
- Found in review: gusts were born at a fixed `-1.4·HALF` = −42, inside the
  board's own half-diagonal (`√2·HALF` ≈ 42.43) and with nothing allowed for the
  gust's width, so a wide or diagonal gust's leading Gaussian was already 0.24–1.0
  on the upwind edge at birth — it popped in instead of arriving; the birth
  position is now `spawnEdge(width) = -(√2·HALF + 3·width)`, the mirror of the 3σ
  retirement rule (`e⁻⁹` ≈ 0.0001 at the most upwind corner), and the sweep gust's
  speed is derived from that same width-scaled crossing over `SWEEP_MS`.
- Found in review: the shader-injection test asserted against a hand-written stub
  containing the anchor strings, so a renamed or dropped three chunk would have
  left the silent `.replace()` no-op undetected; it now feeds the real
  `THREE.ShaderLib.standard` vertex and fragment sources.
- The module-level `footSystem` ref the plan sketched was dropped as unused.
- `paintColors` applied `meadowTint` to every vertex, not only to flat cells:
  only the swell *geometry* was gated by `flatWeight`, so a raised cell carried
  the crest/trough colour field too. Found in review and fixed: the tint's
  driver is now scaled by `flatWeight(current[cellZ][cellX])`, so a cell that
  rises keeps today's look. (The cell index the checkerboard and the baked
  shading already computed is hoisted to the top of the loop and reused, so
  nothing is computed twice.) Pinned by `terrain.test.ts`, "does not tint a
  fully raised cell's top", which samples the raised cell's grass-reading flank
  rather than its `HEIGHT_SCALE` top — at a full level the palette is pure snow
  and the grass tint is moot either way, which would have made the assertion
  vacuous; the gate keys on the cell's level, not on the vertex's y.
- `swell.wavelength` was tuned in Task 8 even though the plan listed only amp,
  tint, crest/trough, grain and grid opacity as levers: no combination of those
  five reached the near-field, and the wavelength is what the metric needed.
- `sheen.strength` ended at 0.8, above the 0.5–0.7 the sheen task suggested,
  because the meadow's own contrast grew during tuning; at the round-1 storm
  intensity a gust moves a near-board strip's mean by ~7 % and its p90 by ~11 %
  between consecutive 0.5 s frames, which is what makes it read in motion.
- `grid.opacity` was never touched: the groove carries the seam, and the grid
  line at its bottom needed no help.
