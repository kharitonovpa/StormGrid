# Crop Identity in Play Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each player's markers carry their crop's jewel colour (my ring/arrow/highlight, the opponent's butterflies, the winner's confetti), human nameplates show total points next to the flag, and rice/corn get their own lobby and match music built by a committed generator.

**Architecture:** One identity colour per crop lives in `cropTheme.ts` and is read by the lobby cards, the player system, the butterfly palette and the victory confetti — no colour literal is repeated. Points travel in the existing `PlayerInfo` object (server fills an optional field at join through a callback; the nameplate renderer draws it). Music variants are offline assets: a pure-DSP TypeScript module (`tools/music/synth.ts`, unit-tested) plus a build script that decodes the base loops with ffmpeg, mixes a synthesised crop layer on top and encodes four MP3s that `audio.ts` maps through the already-existing `MUSIC_TRACKS` indirection.

**Tech Stack:** Bun workspaces monorepo — `packages/client` (Vue 3 + Three.js r183 + Howler, Vite), `packages/server` (Bun + Hono + WS), `packages/shared`; tests with `bun test`; types with `bunx vue-tsc -b --noEmit` (client) and `bunx tsc --noEmit` (server); ffmpeg 7 at `/usr/local/bin/ffmpeg` for the music tool.

Spec: `docs/superpowers/specs/2026-09-05-crop-identity-design.md`.

## Global Constraints

- Identity colours (sRGB hex, from the butterflies' jewel palette): wheat `0xf0940f` (topaz), rice `0x16a8d2` (aquamarine), corn `0xb23bd6` (amethyst). One source of truth: `CROP_THEME[crop].identity` in `packages/client/src/lib/cropTheme.ts`. No other file may hold these literals (the tests in Task 1 read them from `CROP_THEME`).
- Pairwise hue distance between the three identities ≥ 40° (test).
- Move-mode ring = identity lightened 40 % toward white (`lightenHex(identity, 0.4)`); rest/hover ring, arrows and cell highlight = identity unchanged.
- Butterflies keep their hand-tuned `deep`/`bright`/`edge`; only `mid` derives from `identity` (it already equals it, so no visual change).
- Confetti: victory bursts use the winner's identity hue ±12°; points bursts keep the gold range `38 + random·20`; watchers/draw fall back to gold.
- `PlayerInfo.points?: number` — optional, humans only, omitted when unknown or `≤ 0`, fixed at join. Rendering: `★ 1 240` (U+2605, then digits with U+2009 THIN SPACE as thousands separator); `''` for `undefined`/`0`. Drawn after the flag, or after the badge when the badge has replaced the flag, in the plate's suffix font at reduced alpha.
- Music: four files `packages/client/public/sounds/{lobby,match}-music-{rice,corn}.mp3`, 128 kbps MP3, same length as the base loop (base loops are 25.2 s; lobby 42 beats ≈ 100 BPM E minor, match 28 beats ≈ 66.7 BPM A minor), note tails wrap to the loop start, layer RMS 12 dB below the base RMS, soft limiter (no sample ≥ 1.0), output RMS within ±1 dB of the base. Wheat keeps the base files. Generator is reproducible (seeded PRNG); ffmpeg is the only external dependency and only the build script touches it.
- Client audio: variant ids are `LoopId`s with `preload: false` (already the rule for every Howl — they load on first `fadeIn`); `resolveMusicId` and the layer-based fade-outs are unchanged.
- No gameplay/engine changes; no new client dependencies; no changes to wind/rain/lightning visuals, terrain/sky theming or character models.
- Tests: client `cd packages/client && bun test`, server `cd packages/server && bun test` (server WS integration suites need a server on :3001 — not touched here; run the unit files by path), tool `bun test tools/music`. Types: `cd packages/client && bunx vue-tsc -b --noEmit`; `cd packages/server && bunx tsc --noEmit`.
- Every commit message ends with the trailer line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Never kill dev servers you did not start (other worktrees hold :3001/:5173).

---

## File structure

| File | Responsibility |
|---|---|
| `packages/client/src/lib/cropTheme.ts` | Per-crop tokens; gains `identity` + pure colour helpers (`hexToCss`, `hexToRgba`, `lightenHex`, `hexHue`). |
| `packages/client/src/components/LobbyOverlay.vue` | Card accent/glow read from `CROP_THEME`. |
| `packages/client/src/lib/insects.ts` | `GEMS[*].mid` derived from `identity`; `GEMS` exported for the alignment test. |
| `packages/client/src/lib/player.ts` | Ring/arrow/highlight colours follow the local player's crop (`refreshIdentity`). |
| `packages/client/src/lib/celebrate.ts` | Optional hue for a burst; pure `pickHue`. |
| `packages/client/src/components/GameOverOverlay.vue`, `packages/client/src/App.vue` | Winner's crop → firework hue. |
| `packages/shared/src/types.ts` | `PlayerInfo.points?`. |
| `packages/server/src/Room.ts`, `RoomManager.ts`, `index.ts` | `pointsFor(ws)` callback plumbed to `join`. |
| `packages/client/src/lib/formatPoints.ts` | Pure `formatPoints`. |
| `packages/client/src/lib/nameplate.ts` | Draws the points text. |
| `tools/music/synth.ts` | Pure DSP: voices, envelope, mixing, limiter, loudness, score rendering, seeded PRNG. |
| `tools/music/build-variants.ts` | Scores + ffmpeg decode/encode → four MP3s. |
| `tools/music/tsconfig.json`, root `package.json` scripts | Type-check and run the tool. |
| `packages/client/src/lib/audio.ts` | Four `LoopId`s, `def()` cases, `MUSIC_TRACKS` entries, `LOOP_IDS` exported. |

---

### Task 1: Identity colour tokens, colour helpers, lobby cards, butterfly alignment

**Files:**
- Modify: `packages/client/src/lib/cropTheme.ts`
- Modify: `packages/client/src/components/LobbyOverlay.vue` (the `characters` computed, ~line 93)
- Modify: `packages/client/src/lib/insects.ts` (imports, `GEMS` ~line 59)
- Test: `packages/client/src/lib/__tests__/cropTheme.test.ts`
- Test: `packages/client/src/lib/__tests__/insectsPalette.test.ts`

**Interfaces:**
- Produces: `CropTheme.identity: number`; `hexToCss(hex: number): string` (`'#rrggbb'`), `hexToRgba(hex: number, alpha: number): string` (`'rgba(r, g, b, a)'`), `lightenHex(hex: number, t: number): number` (mix toward white, `t ∈ [0, 1]`, channels rounded), `hexHue(hex: number): number` (HSL hue in degrees `[0, 360)`, `0` for greys); `export const GEMS` in `insects.ts`.
- Consumed by Tasks 2, 3.

- [ ] **Step 1: Write the failing tests**

Append to `packages/client/src/lib/__tests__/cropTheme.test.ts` (keep the existing tests; extend the import line):

```ts
import { CROP_THEME, hexToCss, hexToRgba, lightenHex, hexHue } from '../cropTheme.js'

const CROPS = ['wheat', 'rice', 'corn'] as const

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

describe('CROP_THEME.identity', () => {
  it('is a 24-bit colour for every crop', () => {
    for (const crop of CROPS) {
      const hex = CROP_THEME[crop].identity
      expect(Number.isInteger(hex)).toBe(true)
      expect(hex).toBeGreaterThanOrEqual(0)
      expect(hex).toBeLessThanOrEqual(0xffffff)
    }
  })

  it('keeps the three identities at least 40° apart in hue', () => {
    for (const a of CROPS) {
      for (const b of CROPS) {
        if (a === b) continue
        expect(hueDistance(hexHue(CROP_THEME[a].identity), hexHue(CROP_THEME[b].identity))).toBeGreaterThanOrEqual(40)
      }
    }
  })
})

describe('colour helpers', () => {
  it('hexToCss keeps leading zeros', () => {
    expect(hexToCss(0xf0940f)).toBe('#f0940f')
    expect(hexToCss(0x0000ff)).toBe('#0000ff')
  })

  it('hexToRgba spells out the channels', () => {
    expect(hexToRgba(0xf0940f, 0.35)).toBe('rgba(240, 148, 15, 0.35)')
  })

  it('lightenHex mixes toward white per channel and rounds', () => {
    expect(lightenHex(0x000000, 0.5)).toBe(0x808080)
    expect(lightenHex(0xffffff, 0.4)).toBe(0xffffff)
    expect(lightenHex(0x16a8d2, 0)).toBe(0x16a8d2)
  })

  it('hexHue returns HSL hue in degrees', () => {
    expect(hexHue(0xff0000)).toBe(0)
    expect(hexHue(0x00ff00)).toBe(120)
    expect(hexHue(0x0000ff)).toBe(240)
    expect(hexHue(0x808080)).toBe(0)
  })
})
```

Create `packages/client/src/lib/__tests__/insectsPalette.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import { GEMS } from '../insects.js'
import { CROP_THEME, hexToCss } from '../cropTheme.js'

describe('butterfly gems', () => {
  it('use the crop identity colour as the wing mid tone', () => {
    for (const crop of ['wheat', 'rice', 'corn'] as const) {
      expect(GEMS[crop].mid).toBe(hexToCss(CROP_THEME[crop].identity))
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/client && bun test src/lib/__tests__/cropTheme.test.ts src/lib/__tests__/insectsPalette.test.ts`
Expected: FAIL — `hexToCss`/`hexHue`… are not exported; `GEMS` is not exported.

- [ ] **Step 3: Add `identity` and the helpers to `cropTheme.ts`**

Extend the interface (after `resultAccent`):

```ts
  /**
   * sRGB hex of the crop's identity colour — the local player's ring, arrow and
   * cell highlight, the opponent's butterfly wings, the winner's confetti and
   * the lobby card accent all read this one value. Taken from the butterflies'
   * jewel palette (topaz / aquamarine / amethyst): spread around the hue circle
   * and chosen to read over grass, which the crops' "natural" colours are not.
   */
  identity: number
```

Extend the table (add the `identity` field to each entry, keeping the existing values):

```ts
  wheat: { paletteAccent: [0.012, 0.006, -0.006], skyTint: [1, 1, 1], resultAccent: 'rgba(210, 180, 90, 0.55)', identity: 0xf0940f },
  rice: { paletteAccent: [-0.006, 0.003, 0.012], skyTint: [0.90, 0.96, 1.14], resultAccent: 'rgba(220, 70, 70, 0.5)', identity: 0x16a8d2 },
  corn: { paletteAccent: [0.016, 0.010, -0.010], skyTint: [1.14, 0.96, 0.86], resultAccent: 'rgba(230, 160, 40, 0.55)', identity: 0xb23bd6 },
```

Append the helpers at the end of the file:

```ts
/** `0xf0940f` → `'#f0940f'`. */
export function hexToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`
}

/** `0xf0940f, 0.35` → `'rgba(240, 148, 15, 0.35)'`. */
export function hexToRgba(hex: number, alpha: number): string {
  const r = (hex >> 16) & 0xff
  const g = (hex >> 8) & 0xff
  const b = hex & 0xff
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Mix a colour toward white by `t` (0 = unchanged, 1 = white), per channel, rounded. */
export function lightenHex(hex: number, t: number): number {
  const mix = (c: number) => Math.round(c + (255 - c) * t)
  const r = mix((hex >> 16) & 0xff)
  const g = mix((hex >> 8) & 0xff)
  const b = mix(hex & 0xff)
  return (r << 16) | (g << 8) | b
}

/** HSL hue of a colour in degrees, in [0, 360); greys report 0. */
export function hexHue(hex: number): number {
  const r = ((hex >> 16) & 0xff) / 255
  const g = ((hex >> 8) & 0xff) / 255
  const b = (hex & 0xff) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return 0
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h *= 60
  return h < 0 ? h + 360 : h
}
```

- [ ] **Step 4: Read the card colours from `CROP_THEME` in `LobbyOverlay.vue`**

Add to the script imports: `import { CROP_THEME, hexToCss, hexToRgba } from '../lib/cropTheme'` (if `CROP_THEME` is already imported there, extend that line).

Replace the `characters` computed:

```ts
const characters = computed(() => (['wheat', 'rice', 'corn'] as const).map((id) => ({
  id: id as CharacterType,
  name: t(`char.${id}`),
  color: hexToCss(CROP_THEME[id].identity),
  glow: hexToRgba(CROP_THEME[id].identity, 0.35),
})))
```

- [ ] **Step 5: Derive the gem mid tone in `insects.ts`**

Add the import: `import { CROP_THEME, hexToCss } from './cropTheme'`.

Replace the `GEMS` table (export it; only `mid` changes to a derived value):

```ts
export const GEMS: Record<CharacterType, Gem> = {
  // Topaz: warm amber, reads instantly against grass.
  wheat: { deep: '#a8500a', mid: hexToCss(CROP_THEME.wheat.identity), bright: '#ffd763', edge: '#fff6d0', span: 1, tilt: 0 },
  // Aquamarine: cold cyan, the strongest contrast of the three.
  rice: { deep: '#0a5a8c', mid: hexToCss(CROP_THEME.rice.identity), bright: '#86ecf8', edge: '#e2fdff', span: 0.92, tilt: 0.16 },
  // Amethyst: violet through rose.
  corn: { deep: '#5f1a8a', mid: hexToCss(CROP_THEME.corn.identity), bright: '#f7a6f2', edge: '#ffe6fc', span: 1.08, tilt: -0.14 },
}
```

Add one sentence to the file's doc comment: "The mid tone is the crop's identity colour (`cropTheme.ts`), the same colour the marked player sees on their own ring."

- [ ] **Step 6: Run the tests and the type check**

Run: `cd packages/client && bun test src/lib/__tests__/cropTheme.test.ts src/lib/__tests__/insectsPalette.test.ts && bunx vue-tsc -b --noEmit`
Expected: PASS (both files), no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/lib/cropTheme.ts packages/client/src/lib/insects.ts packages/client/src/components/LobbyOverlay.vue packages/client/src/lib/__tests__/cropTheme.test.ts packages/client/src/lib/__tests__/insectsPalette.test.ts
git commit -m "Add crop identity colours and read them in the lobby cards and butterfly palette

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: My ring, arrow and cell highlight in my crop's colour

**Files:**
- Modify: `packages/client/src/lib/player.ts` (imports line 1–5; `hlMat` ~line 51; `ringMat` ~line 123; `arrowMat` ~line 194; `makePlayer` ~line 288–410; `applyPositions` ~line 608; `setActivePlayer` ~line 627; `applyPositionsImmediate` ~line 654; ring colour block ~line 720–735)

**Interfaces:**
- Consumes: `CROP_THEME[crop].identity`, `lightenHex(hex, t)` from Task 1.
- Produces: nothing new outside the file — the player system recolours itself whenever the active player or a character changes. No `App.vue` wiring is needed (the spec's `setIdentity` is realised internally: the system already learns both characters through `applyPositions*` and the local side through `setActivePlayer`).

There is no unit test for `player.ts` (it builds Three.js meshes from loaded models); the colour maths is covered by Task 1's helper tests and the result is checked visually in Task 8.

- [ ] **Step 1: Import the tokens**

Add after the existing imports:

```ts
import { CROP_THEME, lightenHex } from './cropTheme'
```

- [ ] **Step 2: Start every marker material on the wheat identity**

`hlMat` (~line 51): replace `color: 0xffcc66,` with `color: CROP_THEME.wheat.identity,`.
`ringMat` (~line 123): replace `color: 0x66ddff,` with `color: CROP_THEME.wheat.identity,`.
`arrowMat` (~line 194): replace `color: 0xffcc55,` with `color: CROP_THEME.wheat.identity,`.

- [ ] **Step 3: Let a player report the crop it was asked to wear**

In `makePlayer`, right after `let currentCharacter: CharacterType | null = null` add:

```ts
    // What the caller asked for, independent of whether the model has loaded yet
    // (currentCharacter stays null until it has) — the marker colour must not wait.
    let requestedCharacter: CharacterType = 'wheat'
```

In `setCharacter(type)` make the first statement `requestedCharacter = type` (before the `if (currentCharacter === type && modelsLoaded()) return` line).

In the returned object add, next to `get surface()`:

```ts
      get character() { return requestedCharacter },
```

- [ ] **Step 4: Add `refreshIdentity` and call it where the local player or a character changes**

Directly above `function setActivePlayer(...)` add:

```ts
  // The local player's crop colours their own markers — ring, arrow and cell
  // highlight — so "mine" reads by colour as well as by shape. Watchers and
  // replays have no local player; their ring is hidden already (rest = 0).
  let identity = CROP_THEME.wheat.identity
  let identityMove = lightenHex(identity, 0.4)
  function refreshIdentity() {
    const me = activePlayerId === 'A' ? playerA : playerB
    identity = CROP_THEME[me.character].identity
    identityMove = lightenHex(identity, 0.4)
    hlMat.color.setHex(identity)
    arrowMat.color.setHex(identity)
  }
```

Append `refreshIdentity()` as the last statement of `setActivePlayer`, and add `refreshIdentity()` right after the pair of `setCharacter` calls in both `applyPositions` (after `if (b.character) playerB.setCharacter(b.character)`) and `applyPositionsImmediate` (same place).

- [ ] **Step 5: Use the identity in the ring colour block**

In the per-frame ring update (~line 720–735): replace `ringMat.color.setHex(0xffcc44)` with `ringMat.color.setHex(identityMove)` and both `ringMat.color.setHex(0x66ddff)` with `ringMat.color.setHex(identity)`.

Verify no literal `0xffcc66`, `0x66ddff`, `0xffcc55`, `0xffcc44` remains: `grep -n "0xffcc66\|0x66ddff\|0xffcc55\|0xffcc44" packages/client/src/lib/player.ts` prints nothing.

- [ ] **Step 6: Type check and run the client suite**

Run: `cd packages/client && bunx vue-tsc -b --noEmit && bun test`
Expected: no type errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/lib/player.ts
git commit -m "Colour the local player's ring, arrows and highlight with their crop identity

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Victory confetti in the winner's colour

**Files:**
- Modify: `packages/client/src/lib/celebrate.ts` (`celebrate()` ~line 124–155)
- Modify: `packages/client/src/components/GameOverOverlay.vue` (props ~line 15; imports line 2–9; `launchFireworks` ~line 179–200, the two `celebrate(sx, sy, tx, ty, 0)` calls at lines 191 and 200)
- Modify: `packages/client/src/App.vue` (`showGameOver` ~line 469; the `<GameOverOverlay` block ~line 2664)
- Test: `packages/client/src/lib/__tests__/celebrate.test.ts`

**Interfaces:**
- Consumes: `CROP_THEME`, `hexHue` (Task 1).
- Produces: `celebrate(sx, sy, tx, ty, points, onArrive?, hue?)`; `pickHue(hue: number | undefined, rand: number): number`; GameOverOverlay prop `winnerCharacter?: CharacterType | null`.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/lib/__tests__/celebrate.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import { pickHue } from '../celebrate.js'

describe('pickHue', () => {
  it('keeps the gold range when no hue is given', () => {
    expect(pickHue(undefined, 0)).toBe(38)
    expect(pickHue(undefined, 1)).toBe(58)
  })

  it('spreads ±12° around a given hue', () => {
    expect(pickHue(193, 0)).toBe(181)
    expect(pickHue(193, 0.5)).toBe(193)
    expect(pickHue(193, 1)).toBe(205)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/client && bun test src/lib/__tests__/celebrate.test.ts`
Expected: FAIL — `pickHue` is not exported. (If the import itself fails because `celebrate.ts` touches `document` at module scope — it does not today; `ensureCanvas()` runs lazily — report it rather than adding a DOM stub.)

- [ ] **Step 3: Add `pickHue` and the `hue` parameter**

In `celebrate.ts`, above `export function celebrate(`, add:

```ts
/**
 * Particle hue for a burst: the gold range for the points bursts (no hue
 * given), or ±12° around the caller's hue — the winner's crop colour.
 * `rand` is the 0..1 draw, passed in so the spread is testable.
 */
export function pickHue(hue: number | undefined, rand: number): number {
  return hue === undefined ? 38 + rand * 20 : hue + (rand - 0.5) * 24
}
```

Change the signature and the particle hue:

```ts
export function celebrate(
  sx: number, sy: number,
  tx: number, ty: number,
  points: number,
  onArrive?: () => void,
  hue?: number,
) {
```

and inside the particle loop replace `hue: 38 + Math.random() * 20,` with `hue: pickHue(hue, Math.random()),`.

- [ ] **Step 4: Pass the winner's hue from `GameOverOverlay.vue`**

Extend the import on line 7 to `import { CROP_THEME, hexHue } from '../lib/cropTheme'`.

Add to the props after `character: CharacterType`:

```ts
  /** Crop of the winning player — colours the fireworks. Null for draws and watchers. */
  winnerCharacter?: CharacterType | null
```

Add after the props block:

```ts
const fireworkHue = computed(() =>
  props.winnerCharacter ? hexHue(CROP_THEME[props.winnerCharacter].identity) : undefined,
)
```

Change both firework calls in `launchFireworks` (lines 191 and 200) from `celebrate(sx, sy, tx, ty, 0)` to `celebrate(sx, sy, tx, ty, 0, undefined, fireworkHue.value)`.

- [ ] **Step 5: Compute the winner's crop in `App.vue`**

Below `const showGameOver = computed(() => game.phase.value === 'finished')` add:

```ts
/** The winner's crop for the result-screen confetti; null for draws and watchers. */
const winnerCharacter = computed<CharacterType | null>(() => {
  const w = game.winner.value
  if (!w || w === 'draw') return null
  const me = game.myPlayer.value
  if (me?.id === w) return me.character
  const opp = game.opponentPlayer.value
  if (opp?.id === w) return opp.character
  return null
})
```

(`CharacterType` is already imported on line 6.) In the `<GameOverOverlay` block add the attribute after `:character="game.selectedCharacter.value"`:

```vue
    :winner-character="winnerCharacter"
```

- [ ] **Step 6: Run the tests and the type check**

Run: `cd packages/client && bun test src/lib/__tests__/celebrate.test.ts && bunx vue-tsc -b --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/lib/celebrate.ts packages/client/src/lib/__tests__/celebrate.test.ts packages/client/src/components/GameOverOverlay.vue packages/client/src/App.vue
git commit -m "Burst the victory confetti in the winner's crop colour

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `PlayerInfo.points` filled by the server at join

**Files:**
- Modify: `packages/shared/src/types.ts` (`PlayerInfo` line 167–172)
- Modify: `packages/server/src/Room.ts` (`RoomCallbacks` ~line 123; `join` ~line 308–340)
- Modify: `packages/server/src/RoomManager.ts` (`RoomManagerOpts` ~line 19; fields/constructor ~line 33–50; `createRoom` ~line 52–66)
- Modify: `packages/server/src/index.ts` (`new RoomManager({...})` ~line 68)
- Test: `packages/server/src/__tests__/nameplate-points.test.ts`

**Interfaces:**
- Produces: `PlayerInfo.points?: number`; `RoomCallbacks.pointsFor?: (ws: ServerWebSocket<WsData>) => number | undefined`; `RoomManagerOpts.pointsFor?: RoomCallbacks['pointsFor']`.
- Consumed by Task 5 (client reads `info.points`).

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/__tests__/nameplate-points.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import { RoomManager } from '../RoomManager.js'
import type { ServerMessage } from '../protocol.js'
import type { PlayerId, PlayerInfo } from '@wheee/shared'

/**
 * The nameplate shows each human's points total. The server copies it into
 * PlayerInfo once, at join, through the pointsFor callback; bots have none.
 */

function makeFakeWs(deviceId: string, userId: string | null = null) {
  const messages: ServerMessage[] = []
  return {
    data: {
      sessionId: crypto.randomUUID(),
      userId,
      userName: null,
      countryCode: null,
      roomId: null,
      playerId: null,
      role: null,
      analytics: { deviceId, sessionId: `s-${deviceId}`, platform: 'web', host: null },
    },
    readyState: 1,
    send(data: string) { messages.push(JSON.parse(data)) },
    messages,
  }
}

function playerInfoFrom(messages: ServerMessage[]): Record<PlayerId, PlayerInfo> {
  const withInfo = messages.find((m) => 'playerInfo' in m) as { playerInfo: Record<PlayerId, PlayerInfo> } | undefined
  expect(withInfo).toBeDefined()
  return withInfo!.playerInfo
}

describe('PlayerInfo.points', () => {
  it('copies pointsFor(ws) for the human and leaves the bot without', () => {
    const rm = new RoomManager({ pointsFor: (ws) => (ws.data.userId === 'u-1' ? 1240 : 0) })
    const room = rm.createRoom({ practice: true, lightningEnabled: false })
    const ws = makeFakeWs('dev-1', 'u-1')
    const pid = room.join(ws as never, 'wheat')!
    room.joinBot('rice')
    const info = playerInfoFrom(ws.messages)
    expect(info[pid].points).toBe(1240)
    expect(info[pid === 'A' ? 'B' : 'A'].points).toBeUndefined()
  })

  it('omits points when the callback returns 0 or is absent', () => {
    const rmZero = new RoomManager({ pointsFor: () => 0 })
    const roomZero = rmZero.createRoom({ practice: true, lightningEnabled: false })
    const wsZero = makeFakeWs('dev-2')
    const pidZero = roomZero.join(wsZero as never, 'wheat')!
    roomZero.joinBot('rice')
    expect(playerInfoFrom(wsZero.messages)[pidZero].points).toBeUndefined()

    const rmNone = new RoomManager({})
    const roomNone = rmNone.createRoom({ practice: true, lightningEnabled: false })
    const wsNone = makeFakeWs('dev-3')
    const pidNone = roomNone.join(wsNone as never, 'wheat')!
    roomNone.joinBot('rice')
    expect(playerInfoFrom(wsNone.messages)[pidNone].points).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/server && bun test src/__tests__/nameplate-points.test.ts`
Expected: FAIL — type/runtime: `pointsFor` is not a known option and `points` is never set (`expect(1240)` receives `undefined`).

- [ ] **Step 3: Add the field to `PlayerInfo`**

In `packages/shared/src/types.ts` extend the type:

```ts
export type PlayerInfo = {
  displayName: string
  flag: string
  /** Length of the badge streak; 0 means no badge. Cosmetic — see badgeFor(). */
  streak: number
  /**
   * Total match points when the player sat down — the leaderboard's number,
   * drawn on the nameplate. Cosmetic; absent for bots, for unknown totals and
   * for servers that predate it. Not updated during the match.
   */
  points?: number
}
```

- [ ] **Step 4: Add the callback to `Room.ts` and fill the field in `join`**

In `RoomCallbacks` add (after `onAbandon?`):

```ts
  /** The player's points total for the nameplate — see PlayerInfo.points. */
  pointsFor?: (ws: ServerWebSocket<WsData>) => number | undefined
```

In `join(...)` replace the `this.playerInfoCache[pid] = { ... }` assignment with:

```ts
    const info: PlayerInfo = {
      displayName: ws.data.userName ?? randomSurname(),
      flag: ws.data.countryCode ? countryToFlag(ws.data.countryCode) : randomFlag(),
      // Self-reported and purely cosmetic — see PlayerInfo.streak.
      streak: Number.isFinite(streak) && streak > 0 ? Math.floor(streak) : 0,
    }
    // Cosmetic too; only a known positive total is worth a field on the wire.
    const points = this.callbacks.pointsFor?.(ws)
    if (typeof points === 'number' && Number.isFinite(points) && points > 0) info.points = Math.floor(points)
    this.playerInfoCache[pid] = info
```

(`PlayerInfo` is already in the type import on line 2.)

- [ ] **Step 5: Plumb it through `RoomManager.ts`**

In `RoomManagerOpts` add:

```ts
  /** Nameplate points total for a joining human — see RoomCallbacks.pointsFor. */
  pointsFor?: RoomCallbacks['pointsFor']
```

Add the field `private pointsFor?: RoomCallbacks['pointsFor']`, the constructor line `this.pointsFor = opts?.pointsFor`, and in `createRoom` pass `pointsFor: this.pointsFor,` next to `onStreakChange: this.onStreakChange,`.

- [ ] **Step 6: Supply the real total in `index.ts`**

In the `new RoomManager({ ... })` options add:

```ts
  /** Nameplate points — the same total the leaderboard orders by. */
  pointsFor(ws) {
    return getPoints(ws.data.analytics?.deviceId ?? null, ws.data.userId)
  },
```

(`getPoints` is already imported from `./db/pointsStore.js`.)

- [ ] **Step 7: Run the test and both type checks**

Run: `cd packages/server && bun test src/__tests__/nameplate-points.test.ts && bunx tsc --noEmit && cd ../client && bunx vue-tsc -b --noEmit`
Expected: PASS; no type errors in server or client.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/types.ts packages/server/src/Room.ts packages/server/src/RoomManager.ts packages/server/src/index.ts packages/server/src/__tests__/nameplate-points.test.ts
git commit -m "Send each human player's points total in PlayerInfo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Points on the nameplate

**Files:**
- Create: `packages/client/src/lib/formatPoints.ts`
- Modify: `packages/client/src/lib/nameplate.ts` (constants ~line 15–23; `renderPlate` line 44–140; `draw` line 204–218)
- Test: `packages/client/src/lib/__tests__/formatPoints.test.ts`

**Interfaces:**
- Consumes: `PlayerInfo.points?` (Task 4).
- Produces: `formatPoints(points?: number): string`.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/lib/__tests__/formatPoints.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import { formatPoints } from '../formatPoints.js'

describe('formatPoints', () => {
  it('prefixes a star and splits thousands with a thin space', () => {
    expect(formatPoints(1240)).toBe('★ 1 240')
    expect(formatPoints(1234567)).toBe('★ 1 234 567')
    expect(formatPoints(999)).toBe('★ 999')
  })

  it('renders nothing for zero, negative, fractional-noise and unknown totals', () => {
    expect(formatPoints(0)).toBe('')
    expect(formatPoints(-5)).toBe('')
    expect(formatPoints(undefined)).toBe('')
    expect(formatPoints(Number.NaN)).toBe('')
    expect(formatPoints(12.7)).toBe('★ 12')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/client && bun test src/lib/__tests__/formatPoints.test.ts`
Expected: FAIL — module `../formatPoints.js` not found.

- [ ] **Step 3: Implement `formatPoints.ts`**

```ts
/**
 * Nameplate points: `★ 1 240` — a star, then the total with a THIN SPACE
 * (U+2009) between thousands groups. Empty for unknown, zero or negative totals
 * so the plate shows nothing rather than a "★ 0".
 */
export function formatPoints(points?: number): string {
  if (points === undefined || !Number.isFinite(points) || points < 1) return ''
  const digits = String(Math.floor(points))
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `★ ${grouped}`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/client && bun test src/lib/__tests__/formatPoints.test.ts`
Expected: PASS.

- [ ] **Step 5: Draw the points in `nameplate.ts`**

Add the import `import { formatPoints } from './formatPoints'` and, next to the other constants (after `GAP`):

```ts
const POINTS_FONT = SUFFIX_FONT
const POINTS_COLOR = 'rgba(255, 255, 255, 0.72)'
```

Extend `renderPlate`'s signature with a last parameter `pointsText: string`:

```ts
function renderPlate(
  canvas: HTMLCanvasElement,
  name: string,
  suffix: string,
  flag: string,
  pid: PlayerId,
  badgeText: string,
  pointsText: string,
): void {
```

After the `badgeW` measurement block add:

```ts
  let pointsW = 0
  if (pointsText) {
    ctx.font = POINTS_FONT
    pointsW = ctx.measureText(pointsText).width
  }
```

Extend `contentW`:

```ts
  const contentW = nameW
    + (suffix ? SUFFIX_GAP + suffixW : 0)
    + (flag ? GAP + flagW : 0)
    + (badgeText ? GAP + badgeW : 0)
    + (pointsText ? GAP + pointsW : 0)
```

Replace the final `if (badgeText) { ... }` drawing block with:

```ts
  if (badgeText) {
    ctx.font = FLAG_FONT
    ctx.fillText(badgeText, cursor + GAP, textY + 2 * CANVAS_SCALE)
    cursor += GAP + badgeW
  }

  // Points sit last — after the flag, or after the badge once it has replaced
  // the flag — quieter than the name so the plate still reads name-first.
  if (pointsText) {
    ctx.font = POINTS_FONT
    ctx.fillStyle = POINTS_COLOR
    ctx.fillText(pointsText, cursor + GAP, textY + 1 * CANVAS_SCALE)
  }
```

In `draw(pid)` change the render call to:

```ts
    renderPlate(plate.canvas, plate.info.displayName, suffix, showFlag ? plate.info.flag : '', pid, badgeText, formatPoints(plate.info.points))
```

- [ ] **Step 6: Type check and run the client suite**

Run: `cd packages/client && bunx vue-tsc -b --noEmit && bun test`
Expected: no type errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/lib/formatPoints.ts packages/client/src/lib/__tests__/formatPoints.test.ts packages/client/src/lib/nameplate.ts
git commit -m "Show each human player's points total on the nameplate

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Music synthesis core (`tools/music/synth.ts`)

**Files:**
- Create: `tools/music/synth.ts`
- Create: `tools/music/tsconfig.json`
- Modify: root `package.json` (scripts)
- Test: `tools/music/__tests__/synth.test.ts`

**Interfaces:**
- Produces (all exported from `tools/music/synth.ts`):
  - `SR = 44100`
  - `seedRandom(seed: number): () => number` — mulberry32, returns draws in `[0, 1)`
  - `midiToFreq(midi: number): number`
  - `envelope(n: number, attackSeconds: number, releaseSeconds: number): Float32Array` — linear in/out, 1 in the middle
  - `pluck(freq, seconds, { brightness, decay, rand })` — Karplus–Strong string; `brightness ∈ (0, 1]` (1 = raw noise excitation), `decay` = seconds to −60 dB
  - `sawVoice(freq, seconds, { vibratoHz, vibratoCents, harmonics, attack, release })` — additive band-limited saw with vibrato, peak-normalised to 0.9
  - `breathVoice(freq, seconds, { noise, attack, release, rand })` — sine + resonant noise, peak-normalised to 0.9
  - `mixInto(dest: Float32Array, src: Float32Array, offset: number, gain: number): void` — adds `src` at `offset`, wrapping past the end
  - `softLimit(x: number): number` — `Math.tanh(x)`
  - `rms(buf: Float32Array): number`
  - `scaleTo(buf: Float32Array, targetRms: number): Float32Array` — returns a scaled copy
  - `normalize(buf: Float32Array, peak: number): Float32Array` — scaled copy with the given absolute peak (unchanged if silent)
  - `interface Note { beat: number; midi: number; dur: number; gain?: number }`
  - `type Voice = (freq: number, seconds: number) => Float32Array`
  - `renderScore(notes: Note[], beatSeconds: number, loopSamples: number, voice: Voice): Float32Array`
  - `goertzelPower(buf: Float32Array, freq: number): number` and `spectralPeak(buf: Float32Array, fLo: number, fHi: number, stepHz: number): number`
- Consumed by Task 7.

- [ ] **Step 1: Write the failing tests**

Create `tools/music/__tests__/synth.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import {
  SR, seedRandom, midiToFreq, envelope, pluck, sawVoice, breathVoice,
  mixInto, softLimit, rms, scaleTo, normalize, renderScore, spectralPeak,
} from '../synth.ts'

const dB = (ratio: number) => 20 * Math.log10(ratio)

describe('seedRandom', () => {
  it('is deterministic per seed and stays in [0, 1)', () => {
    const a = seedRandom(7), b = seedRandom(7), c = seedRandom(8)
    const sa = [a(), a(), a()], sb = [b(), b(), b()]
    expect(sa).toEqual(sb)
    expect(sa).not.toEqual([c(), c(), c()])
    for (const v of sa) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1) }
  })
})

describe('midiToFreq', () => {
  it('maps A4 to 440 Hz and A3 to 220 Hz', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6)
    expect(midiToFreq(57)).toBeCloseTo(220, 6)
  })
})

describe('envelope', () => {
  it('rises from 0, holds 1, falls back to 0', () => {
    const env = envelope(SR, 0.1, 0.2)
    expect(env.length).toBe(SR)
    expect(env[0]).toBe(0)
    expect(env[Math.floor(SR * 0.5)]).toBeCloseTo(1, 6)
    expect(env[SR - 1]).toBeCloseTo(0, 3)
  })
})

describe('pluck', () => {
  it('rings at the requested pitch within 2 %', () => {
    const tone = pluck(440, 1.0, { brightness: 1, decay: 1.2, rand: seedRandom(1) })
    const steady = tone.subarray(Math.floor(SR * 0.05), Math.floor(SR * 0.8))
    const peak = spectralPeak(steady, 380, 500, 1)
    expect(Math.abs(peak - 440) / 440).toBeLessThan(0.02)
  })

  it('decays: the last 100 ms is at least 40 dB below the first 100 ms', () => {
    const tone = pluck(440, 1.5, { brightness: 1, decay: 0.6, rand: seedRandom(2) })
    const head = rms(tone.subarray(0, Math.floor(SR * 0.1)))
    const tail = rms(tone.subarray(tone.length - Math.floor(SR * 0.1)))
    expect(dB(head / tail)).toBeGreaterThan(40)
  })
})

describe('voices', () => {
  it('sawVoice and breathVoice are peak-normalised and pitched', () => {
    const saw = sawVoice(220, 1.0, { vibratoHz: 5.5, vibratoCents: 0, harmonics: 12, attack: 0.05, release: 0.1 })
    expect(Math.max(...Array.from(saw, Math.abs))).toBeCloseTo(0.9, 2)
    expect(Math.abs(spectralPeak(saw, 180, 260, 1) - 220) / 220).toBeLessThan(0.02)

    const br = breathVoice(196, 1.0, { noise: 0.3, attack: 0.2, release: 0.2, rand: seedRandom(3) })
    expect(Math.max(...Array.from(br, Math.abs))).toBeCloseTo(0.9, 2)
    expect(Math.abs(spectralPeak(br, 160, 240, 1) - 196) / 196).toBeLessThan(0.02)
  })
})

describe('mixInto', () => {
  it('wraps a tail that runs past the end back to the start', () => {
    const dest = new Float32Array(1000)
    const src = new Float32Array(300).fill(1)
    mixInto(dest, src, 900, 0.5)
    expect(dest[899]).toBe(0)
    expect(dest[900]).toBe(0.5)
    expect(dest[999]).toBe(0.5)
    expect(dest[0]).toBe(0.5)
    expect(dest[199]).toBe(0.5)
    expect(dest[200]).toBe(0)
  })
})

describe('softLimit, rms, scaleTo, normalize', () => {
  it('softLimit bounds loud samples and leaves quiet ones alone', () => {
    expect(softLimit(3)).toBeLessThan(1)
    expect(softLimit(-3)).toBeGreaterThan(-1)
    expect(Math.abs(softLimit(0.1) - 0.1)).toBeLessThan(0.002)
  })

  it('scaleTo lands on the target loudness within 0.01 dB', () => {
    const rand = seedRandom(4)
    const noise = Float32Array.from({ length: 10_000 }, () => rand() * 2 - 1)
    const scaled = scaleTo(noise, 0.1)
    expect(Math.abs(dB(rms(scaled) / 0.1))).toBeLessThan(0.01)
  })

  it('normalize sets the absolute peak', () => {
    const buf = Float32Array.from([0.2, -0.5, 0.1])
    expect(Math.max(...Array.from(normalize(buf, 0.9), Math.abs))).toBeCloseTo(0.9, 6)
    expect(Array.from(normalize(new Float32Array(3), 0.9))).toEqual([0, 0, 0])
  })
})

describe('renderScore', () => {
  it('has exactly the loop length and wraps a note that crosses the loop end', () => {
    const loopSamples = SR // a 1 s loop of 4 beats
    const voice = (_freq: number, seconds: number) => new Float32Array(Math.round(seconds * SR)).fill(0.25)
    const out = renderScore([{ beat: 3.5, midi: 60, dur: 1 }], 0.25, loopSamples, voice)
    expect(out.length).toBe(loopSamples)
    expect(out[Math.floor(SR * 0.875) + 10]).toBeCloseTo(0.25, 6) // note start at beat 3.5
    expect(out[10]).toBeCloseTo(0.25, 6) // wrapped tail
    expect(out[Math.floor(SR * 0.5)]).toBe(0) // silence between
  })

  it('applies per-note gain', () => {
    const voice = (_f: number, seconds: number) => new Float32Array(Math.round(seconds * SR)).fill(1)
    const out = renderScore([{ beat: 0, midi: 60, dur: 0.5, gain: 0.3 }], 0.25, SR, voice)
    expect(out[100]).toBeCloseTo(0.3, 6)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tools/music`
Expected: FAIL — cannot resolve `../synth.ts`.

- [ ] **Step 3: Implement `tools/music/synth.ts`**

```ts
/**
 * Pure-function DSP for the crop music layers. No I/O here — the build script
 * (build-variants.ts) owns ffmpeg. Everything runs at SR and returns
 * Float32Array mono buffers in [-1, 1] unless stated otherwise.
 */

export const SR = 44100

/** mulberry32 — a small seeded PRNG so a build is reproducible sample for sample. */
export function seedRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/** Linear attack, sustain at 1, linear release; release is measured from the end. */
export function envelope(n: number, attackSeconds: number, releaseSeconds: number): Float32Array {
  const env = new Float32Array(n)
  const a = Math.max(1, Math.round(attackSeconds * SR))
  const r = Math.max(1, Math.round(releaseSeconds * SR))
  for (let i = 0; i < n; i++) {
    const up = Math.min(1, i / a)
    const down = Math.min(1, (n - 1 - i) / r)
    env[i] = Math.min(up, down)
  }
  return env
}

export interface PluckOpts {
  /** 1 = raw white-noise excitation (koto); lower values pre-smooth it (nylon guitar). */
  brightness: number
  /** Seconds for the string to fall 60 dB. */
  decay: number
  rand?: () => number
}

/** Karplus–Strong plucked string: a noise burst circulating through a two-point average. */
export function pluck(freq: number, seconds: number, opts: PluckOpts): Float32Array {
  const rand = opts.rand ?? Math.random
  const n = Math.round(seconds * SR)
  const period = Math.max(2, Math.round(SR / freq))
  const line = new Float32Array(period)
  let prev = 0
  for (let i = 0; i < period; i++) {
    const white = rand() * 2 - 1
    line[i] = white * opts.brightness + prev * (1 - opts.brightness)
    prev = line[i]
  }
  // Each delay-line slot is refreshed once per period, i.e. decay·freq times
  // in `decay` seconds; g is the per-refresh gain that reaches −60 dB by then.
  const g = Math.pow(0.001, 1 / (opts.decay * freq))
  const out = new Float32Array(n)
  let j = 0
  for (let i = 0; i < n; i++) {
    const cur = line[j]
    const next = line[(j + 1) % period]
    out[i] = cur
    line[j] = (cur + next) * 0.5 * g
    j = (j + 1) % period
  }
  return out
}

export interface SawOpts {
  vibratoHz: number
  vibratoCents: number
  /** Number of harmonics summed (1/k amplitudes) — keeps the top band-limited. */
  harmonics: number
  attack: number
  release: number
}

/** Additive saw with vibrato and an envelope — the "trumpet" third. Peak 0.9. */
export function sawVoice(freq: number, seconds: number, opts: SawOpts): Float32Array {
  const n = Math.round(seconds * SR)
  const out = new Float32Array(n)
  const env = envelope(n, opts.attack, opts.release)
  const depth = Math.pow(2, opts.vibratoCents / 1200) - 1
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const f = freq * (1 + depth * Math.sin(2 * Math.PI * opts.vibratoHz * t))
    phase += (2 * Math.PI * f) / SR
    let s = 0
    for (let k = 1; k <= opts.harmonics; k++) s += Math.sin(k * phase) / k
    out[i] = s * env[i]
  }
  return normalize(out, 0.9)
}

export interface BreathOpts {
  /** Share of resonant noise mixed with the sine, 0..1. */
  noise: number
  attack: number
  release: number
  rand?: () => number
}

/** A sine with a whisper of noise resonating at the same pitch — the long rice tone. Peak 0.9. */
export function breathVoice(freq: number, seconds: number, opts: BreathOpts): Float32Array {
  const rand = opts.rand ?? Math.random
  const n = Math.round(seconds * SR)
  const out = new Float32Array(n)
  const env = envelope(n, opts.attack, opts.release)
  // Two-pole resonator (constant-peak-gain band-pass) tuned to freq, Q ≈ 40.
  const q = 40
  const w0 = (2 * Math.PI * freq) / SR
  const alpha = Math.sin(w0) / (2 * q)
  const b0 = alpha, b2 = -alpha
  const a0 = 1 + alpha, a1 = -2 * Math.cos(w0), a2 = 1 - alpha
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  let phase = 0
  for (let i = 0; i < n; i++) {
    const x0 = rand() * 2 - 1
    const y0 = (b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2) / a0
    x2 = x1; x1 = x0; y2 = y1; y1 = y0
    phase += w0
    out[i] = (Math.sin(phase) * (1 - opts.noise) + y0 * opts.noise * 4) * env[i]
  }
  return normalize(out, 0.9)
}

/** Add `src · gain` into `dest` starting at `offset`; samples past the end wrap to the start. */
export function mixInto(dest: Float32Array, src: Float32Array, offset: number, gain: number): void {
  const len = dest.length
  let j = ((Math.round(offset) % len) + len) % len
  for (let i = 0; i < src.length; i++) {
    dest[j] += src[i] * gain
    j++
    if (j === len) j = 0
  }
}

export function softLimit(x: number): number {
  return Math.tanh(x)
}

export function rms(buf: Float32Array): number {
  let s = 0
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]
  return buf.length ? Math.sqrt(s / buf.length) : 0
}

/** A copy scaled so its RMS equals `targetRms` (silence stays silent). */
export function scaleTo(buf: Float32Array, targetRms: number): Float32Array {
  const r = rms(buf)
  const g = r > 0 ? targetRms / r : 1
  return Float32Array.from(buf, (v) => v * g)
}

/** A copy scaled so its absolute peak equals `peak` (silence stays silent). */
export function normalize(buf: Float32Array, peak: number): Float32Array {
  let max = 0
  for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]))
  const g = max > 0 ? peak / max : 1
  return Float32Array.from(buf, (v) => v * g)
}

export interface Note {
  /** Position in beats from the loop start; fractions allowed (strum stagger). */
  beat: number
  midi: number
  /** Nominal length in beats — voices may ring past it; tails wrap. */
  dur: number
  gain?: number
}

export type Voice = (freq: number, seconds: number) => Float32Array

/** Render notes onto a loop-length buffer; anything past the loop end wraps to its start. */
export function renderScore(notes: Note[], beatSeconds: number, loopSamples: number, voice: Voice): Float32Array {
  const out = new Float32Array(loopSamples)
  for (const note of notes) {
    const tone = voice(midiToFreq(note.midi), note.dur * beatSeconds)
    mixInto(out, tone, note.beat * beatSeconds * SR, note.gain ?? 1)
  }
  return out
}

/** Goertzel power of one frequency — enough for a test's pitch check. */
export function goertzelPower(buf: Float32Array, freq: number): number {
  const w = (2 * Math.PI * freq) / SR
  const coeff = 2 * Math.cos(w)
  let s0 = 0, s1 = 0, s2 = 0
  for (let i = 0; i < buf.length; i++) {
    s0 = buf[i] + coeff * s1 - s2
    s2 = s1
    s1 = s0
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2
}

/** Frequency of maximum Goertzel power scanned from fLo to fHi in stepHz steps. */
export function spectralPeak(buf: Float32Array, fLo: number, fHi: number, stepHz: number): number {
  let best = fLo, bestPower = -1
  for (let f = fLo; f <= fHi; f += stepHz) {
    const p = goertzelPower(buf, f)
    if (p > bestPower) { bestPower = p; best = f }
  }
  return best
}
```

- [ ] **Step 4: Add the tool's tsconfig and the root scripts**

Create `tools/music/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "strict": true,
    "types": ["bun-types"],
    "skipLibCheck": true
  },
  "include": ["*.ts", "__tests__/*.ts"]
}
```

In the root `package.json` add to `scripts` (after `"test:watch"`):

```json
    "music:build": "bun tools/music/build-variants.ts",
    "music:test": "bun test tools/music",
    "music:check": "bunx tsc --noEmit -p tools/music",
```

(`bun-types` is installed by `packages/server` and hoisted to the root `node_modules`.)

- [ ] **Step 5: Run the tests and the type check**

Run: `bun test tools/music && bunx tsc --noEmit -p tools/music`
Expected: all synth tests PASS (`spectralPeak` scans ~120 frequencies over ~33k samples — a few hundred ms); no type errors. (Task 7 adds `build-variants.ts`; until then `music:build` has no target — that is fine.)

- [ ] **Step 6: Commit**

```bash
git add tools/music/synth.ts tools/music/tsconfig.json tools/music/__tests__/synth.test.ts package.json
git commit -m "Add the pure-DSP core for the crop music layers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Build the four music variants and wire them into the client

**Files:**
- Create: `tools/music/build-variants.ts`
- Create (generated): `packages/client/public/sounds/lobby-music-rice.mp3`, `lobby-music-corn.mp3`, `match-music-rice.mp3`, `match-music-corn.mp3`
- Modify: `packages/client/src/lib/audio.ts` (`LOOP_IDS` line 10–15; `MUSIC_TRACKS` doc + table line 81–88; `def()` cases line 109–110)
- Test: `packages/client/src/lib/__tests__/audio.test.ts`

**Interfaces:**
- Consumes: everything exported from `tools/music/synth.ts` (Task 6).
- Produces: `export const LOOP_IDS` (readonly tuple) in `audio.ts`; `LoopId` gains `'lobby-music-rice' | 'lobby-music-corn' | 'match-music-rice' | 'match-music-corn'`; `resolveMusicId('lobby-music', 'rice') === 'lobby-music-rice'` etc.

- [ ] **Step 1: Write the failing client test**

Replace `packages/client/src/lib/__tests__/audio.test.ts` with:

```ts
import { describe, it, expect } from 'bun:test'
import { resolveMusicId, LOOP_IDS } from '../audio.js'

describe('resolveMusicId', () => {
  it('picks the regional variant for rice and corn', () => {
    expect(resolveMusicId('lobby-music', 'rice')).toBe('lobby-music-rice')
    expect(resolveMusicId('match-music', 'rice')).toBe('match-music-rice')
    expect(resolveMusicId('lobby-music', 'corn')).toBe('lobby-music-corn')
    expect(resolveMusicId('match-music', 'corn')).toBe('match-music-corn')
  })

  it('keeps the base track for wheat', () => {
    expect(resolveMusicId('match-music', 'wheat')).toBe('match-music')
    expect(resolveMusicId('lobby-music', 'wheat')).toBe('lobby-music')
  })

  it('falls back to the base track when no character is given', () => {
    expect(resolveMusicId('match-music')).toBe('match-music')
    expect(resolveMusicId('lobby-music')).toBe('lobby-music')
  })

  it('only ever resolves to a registered loop id', () => {
    for (const base of ['lobby-music', 'match-music'] as const) {
      for (const crop of ['wheat', 'rice', 'corn'] as const) {
        expect(LOOP_IDS).toContain(resolveMusicId(base, crop))
      }
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/client && bun test src/lib/__tests__/audio.test.ts`
Expected: FAIL — `LOOP_IDS` is not exported; rice resolves to `'lobby-music'`.

- [ ] **Step 3: Register the variants in `audio.ts`**

`LOOP_IDS` (export it and add the four ids):

```ts
export const LOOP_IDS = [
  'lobby-pad', 'game-drone',
  'lobby-music', 'match-music',
  'lobby-music-rice', 'lobby-music-corn',
  'match-music-rice', 'match-music-corn',
  'wind-loop', 'rain-loop',
  'static-crackle',
] as const
```

Replace the `MUSIC_TRACKS` doc comment and table:

```ts
/**
 * Per-crop versions of the two music loops: the same loops with a sparse
 * ornamental layer mixed in offline (tools/music/build-variants.ts) — koto
 * plucks for rice, nylon strums and a trumpet third for corn. Wheat keeps the
 * base files. Every Howl is created with preload: false and loaded on its first
 * fadeIn, so the variants cost nothing until a rice or corn player hears them.
 */
const MUSIC_TRACKS: Partial<Record<CharacterType, Partial<Record<'lobby-music' | 'match-music', LoopId>>>> = {
  rice: { 'lobby-music': 'lobby-music-rice', 'match-music': 'match-music-rice' },
  corn: { 'lobby-music': 'lobby-music-corn', 'match-music': 'match-music-corn' },
}
```

In `def()` replace the two music cases with:

```ts
    case 'lobby-music':
    case 'lobby-music-rice':
    case 'lobby-music-corn':  return { src, loop: true,  layer: 'music',   baseVolume: 0.75 }
    case 'match-music':
    case 'match-music-rice':
    case 'match-music-corn':  return { src, loop: true,  layer: 'music',   baseVolume: 0.70 }
```

- [ ] **Step 4: Run the client test and type check**

Run: `cd packages/client && bun test src/lib/__tests__/audio.test.ts && bunx vue-tsc -b --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 5: Write `tools/music/build-variants.ts`**

```ts
#!/usr/bin/env bun
/**
 * Build the rice and corn versions of the two music loops.
 *
 *   bun run music:build              → writes into packages/client/public/sounds
 *   MUSIC_OUT=/tmp/x bun run music:build   → writes elsewhere (listening tests)
 *
 * Decodes the base loop with ffmpeg, renders a crop layer from the scores
 * below (seeded, so a rebuild is sample-identical), mixes it 12 dB under the
 * base's RMS, soft-limits, matches the base loudness and encodes 128 kbps MP3.
 * Tails that run past the loop end wrap to its start, so the loop point stays
 * seamless. Tune by editing the scores and voices, then rebuild.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  SR, seedRandom, pluck, sawVoice, breathVoice, renderScore, mixInto,
  softLimit, rms, scaleTo, type Note, type Voice,
} from './synth.ts'

const ROOT = resolve(import.meta.dir, '../..')
const SOUNDS = resolve(ROOT, 'packages/client/public/sounds')
const OUT_DIR = process.env.MUSIC_OUT ?? SOUNDS
const SEED = 20260905
const LAYER_DB = -12

// ── Bases ──────────────────────────────────────────────────────────────────
// Beat counts measured from the files (onset autocorrelation): the loops are
// 25.2 s; 42 beats ≈ 100 BPM (E minor), 28 beats ≈ 66.7 BPM (A minor).
interface Base { id: 'lobby-music' | 'match-music'; beats: number }
const BASES: Base[] = [
  { id: 'lobby-music', beats: 42 },
  { id: 'match-music', beats: 28 },
]

// ── Scores ─────────────────────────────────────────────────────────────────
// Minor pentatonic of each base: E G A B D (lobby), A C D E G (match).
// Rice: one koto phrase per 14 beats plus one long breath tone per loop.
const RICE_LOBBY_PLUCKS: Note[] = [
  { beat: 1, midi: 64, dur: 0.5 }, { beat: 1.5, midi: 67, dur: 0.5 }, { beat: 2, midi: 69, dur: 0.5 }, { beat: 2.5, midi: 71, dur: 2 },
  { beat: 15, midi: 76, dur: 0.5 }, { beat: 15.5, midi: 74, dur: 0.5 }, { beat: 16, midi: 71, dur: 0.5 }, { beat: 16.5, midi: 69, dur: 2 },
  { beat: 29, midi: 67, dur: 0.5 }, { beat: 29.5, midi: 71, dur: 0.5 }, { beat: 30, midi: 74, dur: 2.5 },
]
const RICE_LOBBY_BREATH: Note[] = [{ beat: 35, midi: 59, dur: 6, gain: 0.6 }]
const RICE_MATCH_PLUCKS: Note[] = [
  { beat: 1, midi: 57, dur: 0.5 }, { beat: 1.5, midi: 60, dur: 0.5 }, { beat: 2, midi: 62, dur: 0.5 }, { beat: 2.5, midi: 64, dur: 2 },
  { beat: 15, midi: 67, dur: 0.5 }, { beat: 15.5, midi: 64, dur: 0.5 }, { beat: 16, midi: 62, dur: 2 },
]
const RICE_MATCH_BREATH: Note[] = [{ beat: 20, midi: 52, dur: 5, gain: 0.6 }]

// Corn: sparse nylon strums (30 ms stagger between strings) and one trumpet
// third per phrase. Chords stay in the base's key.
function strum(beat: number, midis: number[], dur: number, beatSeconds: number): Note[] {
  const stagger = 0.03 / beatSeconds
  return midis.map((midi, i) => ({ beat: beat + i * stagger, midi, dur }))
}
function cornLobbyStrums(beatSeconds: number): Note[] {
  return [
    ...strum(4, [52, 55, 59, 64], 3, beatSeconds),   // Em
    ...strum(12, [57, 60, 64], 3, beatSeconds),      // Am
    ...strum(20, [52, 55, 59, 64], 3, beatSeconds),  // Em
    ...strum(28, [48, 52, 55, 60], 3, beatSeconds),  // C
    ...strum(36, [59, 62, 66], 3, beatSeconds),      // Bm → back to Em at the loop point
  ]
}
const CORN_LOBBY_TRUMPET: Note[] = [
  { beat: 7, midi: 76, dur: 1.5, gain: 0.7 }, { beat: 7, midi: 79, dur: 1.5, gain: 0.5 },
  { beat: 35, midi: 71, dur: 1.5, gain: 0.7 }, { beat: 35, midi: 74, dur: 1.5, gain: 0.5 },
]
function cornMatchStrums(beatSeconds: number): Note[] {
  return [
    ...strum(3, [45, 48, 52, 57], 3, beatSeconds),   // Am
    ...strum(11, [50, 53, 57], 3, beatSeconds),      // Dm
    ...strum(19, [45, 48, 52, 57], 3, beatSeconds),  // Am
    ...strum(27, [52, 55, 59], 3, beatSeconds),      // Em → wraps into the loop start
  ]
}
const CORN_MATCH_TRUMPET: Note[] = [
  { beat: 13, midi: 69, dur: 2, gain: 0.7 }, { beat: 13, midi: 72, dur: 2, gain: 0.5 },
]

// ── Voices ─────────────────────────────────────────────────────────────────
const koto = (rand: () => number): Voice => (f, s) => pluck(f, s + 1.2, { brightness: 1, decay: 1.2, rand })
const nylon = (rand: () => number): Voice => (f, s) => pluck(f, s + 1.6, { brightness: 0.35, decay: 1.6, rand })
const trumpet: Voice = (f, s) => sawVoice(f, s, { vibratoHz: 5.5, vibratoCents: 25, harmonics: 12, attack: 0.08, release: 0.25 })
const breath = (rand: () => number): Voice => (f, s) => breathVoice(f, s, { noise: 0.35, attack: 1.2, release: 1.5, rand })

type Crop = 'rice' | 'corn'
function layerFor(crop: Crop, base: Base, beatSeconds: number, loopSamples: number): Float32Array {
  const rand = seedRandom(SEED)
  const layer = new Float32Array(loopSamples)
  const add = (notes: Note[], voice: Voice) => mixInto(layer, renderScore(notes, beatSeconds, loopSamples, voice), 0, 1)
  if (crop === 'rice') {
    add(base.id === 'lobby-music' ? RICE_LOBBY_PLUCKS : RICE_MATCH_PLUCKS, koto(rand))
    add(base.id === 'lobby-music' ? RICE_LOBBY_BREATH : RICE_MATCH_BREATH, breath(rand))
  } else {
    add(base.id === 'lobby-music' ? cornLobbyStrums(beatSeconds) : cornMatchStrums(beatSeconds), nylon(rand))
    add(base.id === 'lobby-music' ? CORN_LOBBY_TRUMPET : CORN_MATCH_TRUMPET, trumpet)
  }
  return layer
}

// ── ffmpeg I/O ─────────────────────────────────────────────────────────────
function decode(file: string): { left: Float32Array; right: Float32Array } {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '2', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 })
  if (r.status !== 0) throw new Error(`ffmpeg decode failed for ${file}: ${r.stderr}`)
  // Copy into a fresh, 4-byte-aligned buffer — a Buffer slice's byteOffset need not be.
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
  if (r.status !== 0) throw new Error(`ffmpeg encode failed for ${file}: ${r.stderr}`)
}

// ── Build ──────────────────────────────────────────────────────────────────
const dB = (ratio: number) => 20 * Math.log10(ratio)

mkdirSync(OUT_DIR, { recursive: true })
for (const base of BASES) {
  const { left, right } = decode(resolve(SOUNDS, `${base.id}.mp3`))
  const loopSamples = left.length
  const beatSeconds = loopSamples / SR / base.beats
  const mono = Float32Array.from(left, (v, i) => (v + right[i]) / 2)
  const baseRms = rms(mono)
  for (const crop of ['rice', 'corn'] as const) {
    const layer = scaleTo(layerFor(crop, base, beatSeconds, loopSamples), baseRms * Math.pow(10, LAYER_DB / 20))
    const outL = new Float32Array(loopSamples), outR = new Float32Array(loopSamples)
    for (let i = 0; i < loopSamples; i++) { outL[i] = left[i] + layer[i]; outR[i] = right[i] + layer[i] }
    // Match the base loudness, then keep every sample inside the range.
    const mixedRms = rms(Float32Array.from(outL, (v, i) => (v + outR[i]) / 2))
    const g = baseRms / mixedRms
    let peak = 0
    for (let i = 0; i < loopSamples; i++) {
      outL[i] = softLimit(outL[i] * g); outR[i] = softLimit(outR[i] * g)
      peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]))
    }
    const outRms = rms(Float32Array.from(outL, (v, i) => (v + outR[i]) / 2))
    const file = resolve(OUT_DIR, `${base.id}-${crop}.mp3`)
    encode(file, outL, outR)
    console.log(`${base.id}-${crop}: ${(loopSamples / SR).toFixed(2)} s, ${(60 / beatSeconds).toFixed(1)} BPM, base ${dB(baseRms).toFixed(1)} dBFS, out ${dB(outRms).toFixed(1)} dBFS (Δ ${dB(outRms / baseRms).toFixed(2)} dB), peak ${peak.toFixed(3)}`)
    if (Math.abs(dB(outRms / baseRms)) > 1) throw new Error(`${file}: loudness off by more than 1 dB`)
    if (peak >= 1) throw new Error(`${file}: peak reached full scale`)
  }
}
```

- [ ] **Step 6: Build the assets and inspect them**

Run: `bunx tsc --noEmit -p tools/music && bun run music:build`
Expected: four lines like `lobby-music-rice: 25.20 s, 100.0 BPM, base -18.x dBFS, out -18.x dBFS (Δ 0.xx dB), peak 0.9xx` and no error; the four files exist under `packages/client/public/sounds/`.

Check them: `for f in packages/client/public/sounds/*-music-{rice,corn}.mp3; do ffprobe -v error -show_entries format=duration:stream=bit_rate -of default=nw=1 "$f"; done` — duration ≈ 25.2 (±0.1 s; the MP3 frame grid may add up to 26 ms) and bit_rate 128000 for each.

Listen check for the implementer (mandatory, `afplay` on macOS): `afplay packages/client/public/sounds/lobby-music-rice.mp3` — the plucks must sit clearly under the base, no clicks at the loop point (play twice in a row: `afplay a.mp3; afplay a.mp3`), no distortion. If a phrase sounds wrong, adjust its notes in the score and rebuild; report what you changed. If ffmpeg's decode trims the loop to a length that makes the BPM print far from 100.0/66.7, stop and report — the beat count assumption would be wrong.

- [ ] **Step 7: Run the client suite once more and commit**

Run: `cd packages/client && bun test && bunx vue-tsc -b --noEmit`
Expected: PASS.

```bash
git add tools/music/build-variants.ts packages/client/src/lib/audio.ts packages/client/src/lib/__tests__/audio.test.ts packages/client/public/sounds/lobby-music-rice.mp3 packages/client/public/sounds/lobby-music-corn.mp3 packages/client/public/sounds/match-music-rice.mp3 packages/client/public/sounds/match-music-corn.mp3
git commit -m "Add rice and corn music variants built by tools/music and map them per crop

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Acceptance — visual and listening checks (controller)

This task is run by the controller in the session, not by an implementer subagent; it produces evidence for the human, no code.

**Visual (headless, existing harness in the session scratchpad `pw/`):**

1. Start an own server and client build: `PORT=3011 ALLOWED_ORIGINS=http://localhost:5184 DB_PATH=/tmp/crop-identity.db bun run --cwd packages/server dev` and `VITE_API_URL=http://localhost:3011 bunx --cwd packages/client vite build && bunx --cwd packages/client vite preview --port 5184`. Never touch :3001/:5173.
2. Seed points for the harness device so the plate has something to show: `DB_PATH=/tmp/crop-identity.db bun -e "import { awardPoints } from './packages/server/src/db/pointsStore.ts'; awardPoints('<deviceId from localStorage>', null, 1240)"` (read the device id the client stored in `localStorage` after the first page load).
3. For each crop: pick the card in the lobby, start the tutorial/practice match (bot opponent), wait ~3 s after `game:start`, capture. Check: ring under my player and the arrows in my identity colour (topaz / aquamarine / amethyst), butterflies over the opponent in *their* crop's mid tone, `★ 1 240` after my flag, no points on the bot's plate. Then finish a match (or force `game:end` via the bot) to check the confetti hue.
4. Send the captures to the chat with `SendUserFile` and copy them to `~/Desktop/crop-identity-check/`.

**Listening (human):** send the four generated MP3s to the chat with `SendUserFile`; ask for a verdict per file. Tuning happens by editing the scores/voices in `tools/music/build-variants.ts` and re-running `bun run music:build` (then re-commit the assets).

---

## Self-review notes

- Spec coverage: identity tokens + lobby cards + butterflies (Task 1); my markers (Task 2 — `setIdentity` from the spec is realised as the internal `refreshIdentity`, no `App.vue` wiring needed because the player system already receives both characters and the local side); confetti (Task 3); `PlayerInfo.points` + `pointsFor` (Task 4); nameplate rendering + `formatPoints` (Task 5); DSP core + tests (Task 6); build script, assets, `audio.ts` wiring + tests (Task 7); visual and listening acceptance (Task 8). The spec's `insects.setPalette(crop)` is unnecessary — the atlas is already built per marked player's crop from `GEMS`; only `mid` is re-derived.
- Type consistency: `hexToCss/hexToRgba/lightenHex/hexHue` (Task 1) are the names used in Tasks 1–3; `pointsFor` is spelled the same in `RoomCallbacks`, `RoomManagerOpts` and `index.ts`; `formatPoints` lives in its own module and is imported by `nameplate.ts`; the `Voice`/`Note` types and function names in Task 7 match Task 6's exports.

## Amendments after execution (2026-09-05)

The tasks ran as written (subagent-driven, one fix round in Task 4, one fix wave after
the whole-branch review). The code is the source of truth for these; the task text is
left as it ran.

- **Task 4 (fix round):** `index.ts` wraps the `getPoints` call in `pointsFor(ws)` in
  try/catch (`[db] getPoints failed:`), matching the file's other DB callbacks, so a
  throwing points store cannot abort a join half-way.
- **Task 6:** `bun-types` became a root devDependency — bun 1.3's isolated linker does
  not hoist it from `packages/server`, so the brief's tsconfig could not resolve types.
- **Task 7:** the implementer session could not play audio (`afplay` fails session-wide);
  the mandatory listening check is owed by the human (files sent to the chat).
- **Layer level (final review I2):** Global Constraints restated the spec's
  *"layer peak ≈ 12 dB below the base's RMS-normalised level"* as *"layer RMS 12 dB
  below the base RMS"*, and the build follows the plan. Measured on the shipped files
  the ornament peaks land 1.9–3.0 dB below the base's own peak. Decision deferred to
  the human's listening verdict; a quieter mix is a one-line change in
  `build-variants.ts` plus `bun run music:build` (deterministic rebuild).
- **Fix wave (final review):** move-arc ribbon coloured by the local player's identity
  (`preview.showMove` colour parameter; watcher predictions keep gold); confetti arrival
  glow follows the burst hue; build script asserts before encoding and reports
  `spawnSync` errors; `tools/music` tests join the root `test` script; a client test
  asserts every `LOOP_IDS` MP3 exists; the `./points.js` import is aliased
  `matchPointsFor`; Goertzel helpers moved to `tools/music/__tests__/spectrum.ts`;
  README documents the tool.
- **Left as follow-ups (ledger):** threshold soft clip instead of global `tanh`;
  nameplate truncation by measured width (a 16-character wide-glyph name plus points
  can exceed the pill); watcher hover ring colour; `pickHue` hue wrap; `@types/bun` vs
  `bun-types` flavour.
