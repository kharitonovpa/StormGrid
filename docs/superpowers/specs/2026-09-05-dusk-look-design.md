# Dusk look — light, palette and baked shadows — design

Date: 2026-09-05

## Problem

Measured on a frozen lobby frame (1280×800, headless Chromium, overlay hidden):
42% of the frame is near-black void; the scene itself has a mean saturation of 0.29
with a third of its pixels below 0.25; its lightness splits 2% dark / 91% mid / 7%
light; 65% of hues sit in a 30° olive band, 24% in beige-brown, and there is no
cool hue anywhere. The board reads flat and "dusty" — not because the palette is
muted on purpose but because nothing structures light: the ambient is a white
0.5 (`App.vue:1910`), the sun is white (`App.vue:1912-1918`, one from above and a
mirrored one from below for the slab's underside), there are no shadows, no tone
mapping (`App.vue:1899`), the sky dome rests on `#0a0e14` (`storm.ts:8`), the
grass palette is an olive `(0.18, 0.44, 0.10)` lifted warm by height
(`terrain.ts:131-215`), rocks are neutral grey, mud is brown.

Disney-style "juiciness" is not saturation; it is hierarchy: a value structure
(dark / mid / light zones), saturated accents on a calmer field, a warm key light
against a cool fill, and contact shadows that give objects weight.

## Decisions taken during brainstorming

- **Direction: dusk** (indigo sky with a warm horizon, low warm sun, cool sky fill) —
  keeps the storm dome's drama legible (a bright daytime sky would fight it).
- **Nothing GPU-expensive**: no shadow maps, no post-processing passes. Volume comes
  from the light rig, tone mapping, palette, and CPU-baked shadows/occlusion in the
  terrain's vertex colours.
- **Characters stay pastel**: their materials, colours and scale are untouched
  (`models.ts` `softenColor`/`mattifyMaterials` stay); they only receive the new light.
- **Approach 2**: light + palette + tone mapping **plus** heightmap-baked sun shadows
  and contact occlusion.

## Goal

1. The arena reads with depth: clear dark/mid/light zones, warm-lit faces against
   cool-shaded ones, dark block feet, long dusk shadows across the board.
2. Colours read clean instead of dusty: fresh (not olive) grass, warm limestone
   rock, terracotta mud, teal water, an indigo-to-warm sky.
3. Gameplay signals keep their priority: wind lines, rain, lightning and the storm
   front remain the most saturated / highest-contrast things on screen.
4. Zero added GPU cost; terrain repaint stays under a few milliseconds.

Measurable targets on the same frozen frame, scene region (sky excluded):
lightness ≥ 12% dark (L < 0.25) / ≤ 70% mid / ≥ 15% light (L > 0.65) — today
2 / 91 / 7; mean saturation 0.33–0.42 — today 0.29; cool-hue share (180°–300°)
≥ 12% — today 0%; storm mass vs. the horizon band it sits on ΔL* ≥ 12 (CIE lightness, 0–100 scale).

## Non-goals

- No shadow maps, no `EffectComposer`/bloom/SSAO, no new dependencies.
- No changes to wind/rain/lightning colours (`wind.ts`, `rain.ts`, `lightning.ts`),
  to character models/materials/scale, to UI, or to the lobby demo camera.
- No visual presets or runtime flags: one look. Before/after comparison is done
  against the previous commit's build.
- No gameplay effect; no engine file changes.

## Design

### Look tokens (new `packages/client/src/lib/look.ts`)

A single source of truth, pure data, no `three` import (so `terrain.ts`'s CPU code
and unit tests consume it without a renderer):

```ts
export const LOOK = {
  sky:     { zenith: 0x10163a, mid: 0x2b2350, horizon: 0x8a4a52, rim: 0xc9754e,
             storm: 0x2a1636, dim: 0x0b0d22 },
  sun:     { color: 0xffc98a, intensity: 2.2, direction: [-0.55, 0.47, 0.69] },  // unit vector towards the sun; elevation ≈ 28°
  hemi:    { sky: 0x5a6cc8, ground: 0x2b2333, intensity: 0.8 },
  terrain: { grass: 0x3f7a3a, rock: 0xb9aa9e, mud: 0x8a4b2a, snow: 0xf2ead8,
             checkerAmp: 0.08, aoStrength: 0.35, shadowStrength: 0.45,
             shadowTint: [0.85, 0.95, 1.25] },   // multiplier at full shadow: sky-lit, so cooler
  water:   { deep: 0x1e5d6e, rim: 0x3d9aa8, opacity: 0.6 },
  grid:    { color: 0xc8c4ff, opacity: 0.28 },
  tone:    { mode: 'agx', exposure: 1.05 },
} as const
```

Hex values are sRGB (what a designer reads); `look.ts` also exports
`srgbHexToLinear(hex): [r, g, b]` — the standard piecewise sRGB→linear transfer —
because `MeshStandardMaterial({ vertexColors: true })` treats vertex colours as
linear and `paintColors` writes raw floats. `THREE.Color(hex)` performs the same
conversion for lights and materials, so both paths end up in linear space.

The exact numbers are starting values; they are tuned against the acceptance
metrics on the frozen-frame harness (see Testing) and may move within the stated
targets. The token *structure* is the contract.

### Light rig and renderer (`App.vue`, scene setup around lines 1889–1918)

- `renderer.toneMapping = THREE.AgXToneMapping`, `toneMappingExposure` from
  `LOOK.tone` (AgX keeps saturated colours from skewing hue; available in three r183).
- Remove the white `AmbientLight`.
- Sun: `DirectionalLight(LOOK.sun.color, LOOK.sun.intensity)` positioned along
  `LOOK.sun.direction`; a mirrored sun (direction with `y` negated) lights the
  slab's underside, replacing today's `dirLightBottom`.
- Fill: two `HemisphereLight(LOOK.hemi.sky, LOOK.hemi.ground, LOOK.hemi.intensity)`,
  one with its up vector `+Y`, one with `−Y`, so each face of the slab gets cool
  sky fill from "its" sky; the dark plum ground colour keeps the wrong-side
  contribution small.
- `scene.background = LOOK.sky.zenith` (only visible if the dome is ever clipped).
- Grid lines: `LineBasicMaterial` colour/opacity from `LOOK.grid` (lavender at 0.28
  reads as etched cell borders rather than green paint; the underside grid shares it).

The lobby's `CharacterPreview.vue` owns a second renderer with its own white
ambient/sun/fill (`CharacterPreview.vue:57-72`); it gets the same tone mapping and
the same sun/hemisphere colours from `LOOK` so the cards and the scene agree.

### Terrain palette and baked shading (`terrain.ts`, new `terrainShade.ts`)

`paintColors(geo, isBottom?, accent?)` keeps its signature and its structure
(mud/grass/snow weights by height, rock by slope, noise, height lift/sink,
checkerboard, crop accent, clamp). Changes:

- Base colours come from `LOOK.terrain` converted to linear once at module load;
  `checkerAmp` from `LOOK` (≈ ±6% lightness on grass instead of ±2%).
- Two new multiplicative terms, computed by pure functions in
  `packages/client/src/lib/terrainShade.ts` over the **cell** heightmap
  (`terrain.current`, 8×8, O(1) lookups, no noise — always fresh during animation,
  unlike the fine height cache), applied after the checkerboard and before the
  crop accent and the clamp:

  ```ts
  // heights(cx, cz): cell height in levels (world Y = level * HEIGHT_SCALE)
  contactOcclusion(heights, gx, gz, hLevels): number   // 0..1
  sunOcclusion(heights, gx, gz, hLevels, sun): number  // 0..1
  ```

  - **Contact occlusion**: for the 8 neighbouring cells, take how far each rises
    above the vertex (levels, clamped 0..2) weighted by the vertex's proximity to
    that neighbour's shared edge (linear falloff over 0.6 cell); combine with
    `1 − Π(1 − w)`. Darkens block feet and pit walls toward their bottom:
    `rgb *= 1 − ao · aoStrength`.
  - **Sun occlusion**: march from the vertex toward the sun in the horizontal
    plane in ¼-cell steps up to 4 cells; the ray rises by `tan(elevation)` per
    world unit; a step is occluded when the cell height there exceeds the ray by
    more than a soft threshold (smoothstep over 0.15 level → penumbra). The result
    is the occlusion: `rgb *= (1 − shadow · shadowStrength) · mix(1, shadowTint, shadow)`
    (shadows are lit by the sky, so they go cooler, not just darker — a
    multiplier, because an additive cool shift would zero the grass's small
    linear red channel). At 28° a one-level block casts a ≈1.25-cell shadow
    (5 world units / tan 28° ≈ 9.4 units, cell = 7.5).
  - The underside (`isBottom`) uses the same functions with the mirrored sun and
    `h = −wy` exactly as the existing code already mirrors heights.
  - Grid coordinates: `gx = (wx + HALF) / CELL_SIZE`, `gz` likewise.
  - `paintColors` reads the shadow term from a lattice built once per call
    (`buildShadowField`, 4 samples per cell, one bilinear read per vertex) instead
    of marching per vertex; the per-vertex `sunOcclusion` stays as the reference
    and the two agree on lattice points.

- Cost: ~20 O(1) lookups per vertex × ~29k vertices (top, bottom, skirt) ≈ 1–2 ms
  per repaint on a laptop; repaints happen only when the terrain animates or the
  crop changes, as today. Budget: ≤ 3 ms per full repaint on a laptop, asserted by
  a timing test with a generous ceiling.

### Sky dome (`storm.ts`)

- The calm base colour becomes a gradient of the view direction, symmetric in
  `|vDir.y|` so the underside sees the same sky: `zenith` at |y| = 1 → `mid` at
  |y| ≈ 0.45 → `horizon` at |y| ≈ 0.08, with a narrow `rim` band
  (smoothstep, |y| ∈ [0, 0.06]) for the warm edge. Exposed as a pure
  `skyGradient(y, tokens): [r, g, b]` in TypeScript for tests, and mirrored in GLSL.
- Storm sectors, the zenith mode and the "whole world dims" mix stay; `STORM` and
  `DIM` move to `LOOK.sky.storm`/`LOOK.sky.dim`. The mass colour is now *darker*
  than the horizon it sits on, so a front reads as a dark bank against the warm
  edge (today the violet mass is lighter than the black void).
- Crop theming: `uBase` (a colour) becomes `uTint` (a multiplier, default
  `[1, 1, 1]`) applied to the gradient; `createStormSystem(scene, tint?)`,
  `setTint(t)`, `getTint()` replace `baseTint`/`setBaseColor`/`getBaseColor`.
  `cropTheme.ts` `skyTint` becomes a `readonly [number, number, number]`
  multiplier: wheat `[1, 1, 1]`, rice `[0.94, 0.98, 1.08]`, corn
  `[1.10, 0.98, 0.90]`; `paletteAccent` re-expressed in linear units (≈ 10% of the grass channels, since the palette is now linear); `resultAccent` unchanged. `App.vue`'s
  mount call and the crop watcher pass the tuple.
- Lightning (`lightning.ts`) is untouched: white-blue on indigo/plum reads at least
  as well as on black.

### Water and the rest

- `water.ts`: the two vertex colours (deep body / rim) come from `LOOK.water`,
  opacity from `LOOK.water.opacity` (0.55 → 0.6).
- Emissive glows (`bonus.ts`, `glass.ts`) may look dimmer under AgX; their
  `emissiveIntensity` values are retuned by eye against the harness in a dedicated
  task — no structural change.
- Everything listed under Non-goals stays as is.

## Testing

Unit (`bun:test`, `packages/client/src/lib/__tests__/`):

- `look.test.ts`: every hex in `0..0xffffff`, opacities in `0..1`, exposure in
  `0.5..2`, sun direction normalised with elevation in 15°–45°, `tone.mode` is
  `'agx'`; `srgbHexToLinear` matches known points (`0x000000 → 0`, `0xffffff → 1`,
  `0x808080 → ≈0.2158`); storm mass vs. horizon ΔL* ≥ 12 (CIE L*, computed from relative luminance).
- `terrainShade.test.ts` on a synthetic 3×3 map with one raised cell: a vertex on
  the down-sun side is occluded (> 0.5) and one on the sun side is not (0); a
  lower sun occludes a cell two steps away that a 45° sun does not; a flat map
  yields 0 for both functions; contact occlusion is > 0 at the raised cell's foot
  and 0 on its top.
- `terrain.test.ts`: existing accent test; plus "a vertex at the foot of a taller
  cell ends darker than an equivalent vertex on open ground"; plus the repaint
  timing ceiling.
- `storm.test.ts`: rewritten for `getTint`/`setTint` (default `[1,1,1]`, round
  trip, no leak between instances) and `skyGradient` (zenith at |y| = 1, horizon
  band at 0, symmetric for ±y).
- `cropTheme.test.ts`: `skyTint` components within `[0.85, 1.15]`, wheat exactly
  `[1, 1, 1]`, `paletteAccent` checks unchanged.

Visual acceptance (controller, outside the repo): the existing headless harness
(Playwright, `performance.now` frozen so the lobby camera stands still) captures
the same frame before (previous commit) and after, computes the metrics from
Goal and builds a montage for the human. Token values are iterated against those
captures until every target holds. The captures also confirm wind/rain/lightning
colours are byte-identical to before.

Manual (human, phone in Telegram and desktop): frame rate unchanged; a storm
front is visible before the wind arrives; lightning reads; the slab's underside
is lit like the top; lobby cards do not clash with the scene; crop switching
still retints instantly.

## Risks

- Emissive glows dim under tone mapping → retune task (see Water and the rest).
- Storm legibility on a gradient → ΔL* guard in `look.test.ts`; tuned on captures.
- Repaint cost grows → cell-level lookups only, timing test, ≤ 3 ms budget.
- Colour-space mistakes (sRGB hex used as linear) → single conversion helper with
  its own test; `paintColors` never sees hex.

## Files touched

- `packages/client/src/lib/look.ts` — new, tokens + `srgbHexToLinear`.
- `packages/client/src/lib/terrainShade.ts` — new, `contactOcclusion`, `sunOcclusion`.
- `packages/client/src/lib/terrain.ts` — palette from tokens, shading terms in `paintColors`.
- `packages/client/src/lib/storm.ts` — gradient sky, tint multiplier API.
- `packages/client/src/lib/cropTheme.ts` — `skyTint` as multiplier tuple.
- `packages/client/src/lib/water.ts` — colours/opacity from tokens.
- `packages/client/src/App.vue` — tone mapping, light rig, background, grid material, storm tint calls.
- `packages/client/src/components/CharacterPreview.vue` — tone mapping and lights from tokens.
- `packages/client/src/lib/bonus.ts`, `glass.ts` — emissive retune only.
- Tests alongside each of the above.
