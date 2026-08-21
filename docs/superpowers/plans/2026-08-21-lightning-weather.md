# Lightning Weather Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lightning as the third weather element per `docs/superpowers/specs/2026-08-21-lightning-weather-design.md`: it strikes the highest point on each side, empty higher cells are lightning rods, and it resolves before wind and rain.

**Architecture:** Server engine gains `resolveLightning` (a sibling of `resolveWind`/`resolveRain`), the weather enum grows four lightning combos with `hasWind/hasRain/hasLightning` predicates, and `randomWeatherDecision` becomes round-gated by a schedule table. The bot learns lightning for free by replaying the real resolver. Client gets a `lightningProbability` on the existing forecast dial (icon remap + electrified rim), a procedural bolt system in Three.js, three sounds, and lightning branches on the game-over screen.

**Tech Stack:** Bun workspaces, TypeScript, Three.js, Vue 3, Howler, `bun test`.

## Global Constraints

- Order of elements: **lightning → wind → rain**; the storm stops at the first death (existing rule, extended).
- Crown height constant: `CROWN_HEIGHT = 0.5`. A player is exposed when **no cell on their side is strictly higher than `cellHeight + CROWN_HEIGHT`**.
- Rounds 1–2 must NEVER produce lightning from random generation.
- `lightningProbability` quantization: exactly `0 | 0.25 | 0.75 | 1.0` (same as rain).
- Weather stays an **enum** (`'wind' | 'rain' | 'wind_rain' | 'lightning' | 'wind_lightning' | 'rain_lightning' | 'wind_rain_lightning'`) — no flags struct, old replays must parse unchanged.
- **No full-screen flash, ever. No scorch decals, no charred/blackened characters or cells.** Bolt light is local (`PointLight` + plate emissive). At most 3 flashes within ~1.2 s, respect `prefers-reduced-motion`.
- Deterministic rod pick for replays: highest cell, then nearest to the player (Chebyshev), then lowest `y`, then lowest `x`.
- All user-facing strings in both EN and RU i18n tables.
- Engine-only test runs: `bun test packages/server/src/engine/__tests__/<file>` (no live server needed). The full suite additionally needs a live `:3001` server with `RECONNECT_GRACE_MS=2000 BOT_MATCH_DELAY_MS=800 BOT_MATCH_DELAY_LONG_MS=800`.
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Shared types, predicates, schedule constant, and green stubs

Extends the type layer and stubs the new `WeatherResult` fields so the repo compiles and the existing suite stays green before the resolver lands.

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/constants.ts`
- Modify: `packages/shared/src/index.ts` (export the new names)
- Modify: `packages/server/src/engine/forecast.ts` (stub field)
- Modify: `packages/server/src/engine/board.ts` (forecast init + clone)
- Modify: `packages/server/src/engine/GameEngine.ts` (stub result fields)

**Interfaces:**
- Consumes: nothing.
- Produces (later tasks rely on these exact names):
  - `WeatherType` = `'wind' | 'rain' | 'wind_rain' | 'lightning' | 'wind_lightning' | 'rain_lightning' | 'wind_rain_lightning'`
  - `hasWind(t: WeatherType): boolean`, `hasRain(t: WeatherType): boolean`, `hasLightning(t: WeatherType): boolean`
  - `CROWN_HEIGHT = 0.5`
  - `WEATHER_SCHEDULE: { upToRound: number; weights: [WeatherType, number][] }[]`
  - `ForecastData.lightningProbability: number`
  - `DeathCause` includes `{ type: 'lightning' }`
  - `WeatherResult.boltCell: Record<PlayerId, { x: number; y: number } | null>` and `WeatherResult.lightningSpared: PlayerId | null`
  - `ReplayFrame.weather` gains optional `boltCell?: Record<PlayerId, { x: number; y: number } | null>`

- [ ] **Step 1: Extend `packages/shared/src/types.ts`**

```ts
// replace the current WeatherType line:
export type WeatherType =
  | 'wind' | 'rain' | 'wind_rain'
  | 'lightning' | 'wind_lightning' | 'rain_lightning' | 'wind_rain_lightning'
```

In `ForecastData` add after `rainProbability`:

```ts
  lightningProbability: number
```

In `DeathCause` add a variant:

```ts
  | { type: 'lightning' }
```

In `WeatherResult` add after `rainSpared`:

```ts
  /** Where the bolt landed on each side: the player's cell on a kill, the absorbing rod otherwise. Null when no lightning fell on that side. */
  boltCell: Record<PlayerId, { x: number; y: number } | null>
  /** Player the bolt passed over because the other crown stood taller. */
  lightningSpared: PlayerId | null
```

- [ ] **Step 2: Extend `packages/shared/src/constants.ts`**

Replace `WEATHER_TYPES` and append the new block:

```ts
export const WEATHER_TYPES: readonly WeatherType[] = [
  'wind', 'rain', 'wind_rain',
  'lightning', 'wind_lightning', 'rain_lightning', 'wind_rain_lightning',
]

/* ── Lightning ── */

/** A standing character pokes half a cell above the ground — the crown the bolt aims at. */
export const CROWN_HEIGHT = 0.5

export function hasWind(t: WeatherType): boolean {
  return t === 'wind' || t === 'wind_rain' || t === 'wind_lightning' || t === 'wind_rain_lightning'
}

export function hasRain(t: WeatherType): boolean {
  return t === 'rain' || t === 'wind_rain' || t === 'rain_lightning' || t === 'wind_rain_lightning'
}

export function hasLightning(t: WeatherType): boolean {
  return t === 'lightning' || t === 'wind_lightning' || t === 'rain_lightning' || t === 'wind_rain_lightning'
}

/**
 * Round-gated weather mix. Lightning never falls in rounds 1–2 (newcomers meet
 * only today's weather); late rounds escalate so matches must end. Playtest draft —
 * tune weights here, nowhere else.
 */
export const WEATHER_SCHEDULE: { upToRound: number; weights: [WeatherType, number][] }[] = [
  { upToRound: 2, weights: [['wind', 55], ['wind_rain', 45]] },
  { upToRound: 4, weights: [['wind', 40], ['wind_rain', 35], ['wind_lightning', 15], ['lightning', 10]] },
  { upToRound: 6, weights: [['wind', 25], ['wind_rain', 25], ['wind_lightning', 25], ['wind_rain_lightning', 15], ['lightning', 10]] },
  { upToRound: Infinity, weights: [['wind_rain_lightning', 40], ['wind_lightning', 30], ['wind_rain', 20], ['lightning', 10]] },
]
```

Add `import type { WeatherType } ...` — the file already imports `WindDir, MoveDir, WeatherType, CharacterType` from `./types.js`, so only the new exports need wiring in `packages/shared/src/index.ts` (add `CROWN_HEIGHT, hasWind, hasRain, hasLightning, WEATHER_SCHEDULE` to the existing `export {}` block that carries `WEATHER_TYPES`).

- [ ] **Step 3: Extend `ReplayFrame` in `packages/shared/src/protocol.ts`**

In the `weather?:` object of `ReplayFrame` add:

```ts
    boltCell?: Record<PlayerId, { x: number; y: number } | null>
```

- [ ] **Step 4: Stub the new fields so the server compiles**

`packages/server/src/engine/forecast.ts` — in `generateForecast`'s return object add:

```ts
    lightningProbability: 0,
```

`packages/server/src/engine/board.ts` — in `createInitialState`'s `forecast:` literal add `lightningProbability: 0,`; in `cloneForecast` add `lightningProbability: f.lightningProbability,`.

`packages/server/src/engine/GameEngine.ts` — in `executeWeather`'s return object add:

```ts
      boltCell: { A: null, B: null },
      lightningSpared: null,
```

- [ ] **Step 5: Run the engine suite to verify green**

Run: `bun test packages/server/src/engine/__tests__/engine.test.ts packages/server/src/engine/__tests__/wind.test.ts packages/server/src/engine/__tests__/rain.test.ts packages/server/src/engine/__tests__/bot.test.ts`
Expected: PASS (no behavior changed).

- [ ] **Step 6: Commit**

```bash
git add packages/shared packages/server/src/engine
git commit -m "Extend weather types for lightning"
```

---

### Task 2: `resolveLightning` (TDD)

**Files:**
- Create: `packages/server/src/engine/lightning.ts`
- Test: `packages/server/src/engine/__tests__/lightning.test.ts`

**Interfaces:**
- Consumes: `CROWN_HEIGHT`, `BOARD_SIZE`, `hasLightning` from `@wheee/shared`; `GameState`.
- Produces: `resolveLightning(state: GameState): LightningResult` with
  `LightningResult = { deaths: PlayerId[]; deathCauses: Partial<Record<PlayerId, DeathCause>>; boltCell: Record<PlayerId, {x,y} | null>; spared: PlayerId | null }`.
  Mutates `state.players[pid].alive` exactly like `resolveWind`/`resolveRain` do.

- [ ] **Step 1: Write the failing tests**

Create `packages/server/src/engine/__tests__/lightning.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import type { GameState, Height } from '@wheee/shared'
import { hasWind, hasRain, hasLightning } from '@wheee/shared'
import { createInitialState } from '../board.js'
import { resolveLightning } from '../lightning.js'

/** Board helper: place players and paint heights (canonical frame). */
function makeState(aPos: [number, number], bPos: [number, number], heights: [number, number, Height][] = []): GameState {
  const s = createInitialState({ A: { x: aPos[0], y: aPos[1] }, B: { x: bPos[0], y: bPos[1] } })
  for (const [x, y, h] of heights) s.board[y][x].height = h
  return s
}

describe('weather predicates', () => {
  test('cover every combo', () => {
    expect(hasWind('wind_rain_lightning')).toBe(true)
    expect(hasWind('rain_lightning')).toBe(false)
    expect(hasRain('rain_lightning')).toBe(true)
    expect(hasRain('wind_lightning')).toBe(false)
    expect(hasLightning('lightning')).toBe(true)
    expect(hasLightning('wind_rain')).toBe(false)
  })
})

describe('resolveLightning', () => {
  test('flat-0 board: both exposed, equal crowns — both die', () => {
    const s = makeState([1, 1], [5, 5])
    const r = resolveLightning(s)
    expect(r.deaths.sort()).toEqual(['A', 'B'])
    expect(r.deathCauses.A).toEqual({ type: 'lightning' })
    expect(r.spared).toBeNull()
    expect(s.players.A.alive).toBe(false)
    expect(r.boltCell.A).toEqual({ x: 1, y: 1 })
    expect(r.boltCell.B).toEqual({ x: 5, y: 5 })
  })

  test('flat -1 board kills the same (rule is relative, not absolute)', () => {
    const heights: [number, number, Height][] = []
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) heights.push([x, y, -1])
    // Canonical -1 everywhere = A's side all -1, B's side all +1: both flat.
    const s = makeState([1, 1], [5, 5], heights)
    const r = resolveLightning(s)
    expect(r.deaths.sort()).toEqual(['A', 'B'])
  })

  test('a pit is grounded: its wall out-tops the crown', () => {
    // A in a -1 pit (crown -0.5): the 0-level plain is strictly higher. B gets a rod.
    const s = makeState([1, 1], [5, 5], [[1, 1, -1], [4, 4, -1]]) // (4,4) canonical -1 = B-side +1 rod
    const r = resolveLightning(s)
    expect(r.deaths).toEqual([])
    expect(s.players.A.alive).toBe(true)
    // A's bolt went into the nearest strictly-higher ground, not the player.
    expect(r.boltCell.A).not.toEqual({ x: 1, y: 1 })
  })

  test('a rod anywhere on the side saves a 0-level player', () => {
    // Canonical +1 at (6,6) = A-side rod. B stands exposed on their flat side.
    const s = makeState([1, 1], [5, 5], [[6, 6, 1]])
    const r = resolveLightning(s)
    expect(r.deaths).toEqual(['B'])
    expect(r.boltCell.A).toEqual({ x: 6, y: 6 })
    expect(r.spared).toBeNull() // only one was exposed — no arbitration happened
  })

  test('standing on +1 dies through any rod', () => {
    // A on a +1 hill (crown 1.5); another +1 rod exists — nothing out-tops 1.5.
    // B is saved by a B-side rod (canonical -1 at (4,4)).
    const s = makeState([2, 2], [5, 5], [[2, 2, 1], [6, 6, 1], [4, 4, -1]])
    const r = resolveLightning(s)
    expect(r.deaths).toEqual(['A'])
    expect(r.boltCell.A).toEqual({ x: 2, y: 2 })
  })

  test('both exposed, unequal crowns: the taller dies, the shorter is spared', () => {
    // A on +1 (crown 1.5), B flat on their side (crown 0.5): bolt takes A.
    const s = makeState([2, 2], [5, 5], [[2, 2, 1]])
    const r = resolveLightning(s)
    expect(r.deaths).toEqual(['A'])
    expect(r.spared).toBe('B')
    expect(s.players.B.alive).toBe(true)
  })

  test('per-side resolution: B sees negated heights', () => {
    // Canonical -1 at (0,0) is a +1 rod on B's side only. A stays exposed.
    const s = makeState([1, 1], [5, 5], [[0, 0, -1]])
    const r = resolveLightning(s)
    expect(r.deaths).toEqual(['A'])
    expect(r.boltCell.B).toEqual({ x: 0, y: 0 })
  })

  test('deterministic rod pick: highest, then nearest, then lowest y, then lowest x', () => {
    // Two +1 rods for A at Chebyshev distance 2 and 4: nearest wins.
    const s = makeState([3, 3], [5, 5], [[1, 3, 1], [3, 0, 1], [4, 4, -1]])
    const r = resolveLightning(s)
    expect(r.boltCell.A).toEqual({ x: 1, y: 3 }) // dist 2 beats dist 3
  })

  test('dead player is not a target', () => {
    const s = makeState([1, 1], [5, 5])
    s.players.A.alive = false
    const r = resolveLightning(s)
    expect(r.deaths).toEqual(['B'])
    expect(r.boltCell.A).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/server/src/engine/__tests__/lightning.test.ts`
Expected: FAIL — `Cannot find module '../lightning.js'`.

- [ ] **Step 3: Implement `packages/server/src/engine/lightning.ts`**

```ts
import type { DeathCause, GameState, PlayerId } from '@wheee/shared'
import { BOARD_SIZE, CROWN_HEIGHT } from '@wheee/shared'

export type LightningResult = {
  deaths: PlayerId[]
  deathCauses: Partial<Record<PlayerId, DeathCause>>
  /** Where the bolt landed on each side: the player's cell on a kill, the absorbing rod otherwise. */
  boltCell: Record<PlayerId, { x: number; y: number } | null>
  /** Player the bolt passed over because the other crown stood taller. */
  spared: PlayerId | null
}

type Judgement = {
  exposed: boolean
  crown: number
  bolt: { x: number; y: number }
}

/**
 * Lightning resolution — the bolt takes the highest point of each side.
 *
 * A standing character pokes CROWN_HEIGHT above their cell. Any cell strictly
 * higher than that crown, anywhere on the side, is a lightning rod: the bolt
 * dives into it and the player lives. No higher point means the player IS the
 * highest point — exposed. The rule is relative, so a uniformly lowered board
 * is exactly as deadly as a flat one.
 *
 * When both players stand exposed there is one bolt and it picks the taller
 * crown (experienced heights compared across sides); the shorter one is spared.
 * Equal crowns die together — the draw of full symmetry, like equal runways.
 */
export function resolveLightning(state: GameState): LightningResult {
  const judged: Partial<Record<PlayerId, Judgement>> = {}
  for (const pid of ['A', 'B'] as PlayerId[]) {
    if (state.players[pid].alive) judged[pid] = judge(state, pid)
  }

  let spared: PlayerId | null = null
  const a = judged.A
  const b = judged.B
  if (a?.exposed && b?.exposed && a.crown !== b.crown) {
    spared = a.crown > b.crown ? 'B' : 'A'
    judged[spared]!.exposed = false
  }

  const deaths: PlayerId[] = []
  const deathCauses: Partial<Record<PlayerId, DeathCause>> = {}
  const boltCell: Record<PlayerId, { x: number; y: number } | null> = { A: null, B: null }

  for (const pid of ['A', 'B'] as PlayerId[]) {
    const j = judged[pid]
    if (!j) continue
    boltCell[pid] = j.bolt
    if (j.exposed) {
      state.players[pid].alive = false
      deaths.push(pid)
      deathCauses[pid] = { type: 'lightning' }
    }
  }

  return { deaths, deathCauses, boltCell, spared }
}

/** One side's verdict: is the player the highest point, and where does the bolt go? */
function judge(state: GameState, pid: PlayerId): Judgement {
  const sign = pid === 'A' ? 1 : -1
  const h = (x: number, y: number) => state.board[y][x].height * sign
  const p = state.players[pid]
  const crown = h(p.x, p.y) + CROWN_HEIGHT

  let rod: { x: number; y: number; h: number; dist: number } | null = null
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const hh = h(x, y)
      if (hh <= crown) continue
      const dist = Math.max(Math.abs(x - p.x), Math.abs(y - p.y))
      if (
        rod === null
        || hh > rod.h
        || (hh === rod.h && dist < rod.dist)
        || (hh === rod.h && dist === rod.dist && (y < rod.y || (y === rod.y && x < rod.x)))
      ) {
        rod = { x, y, h: hh, dist }
      }
    }
  }

  return rod
    ? { exposed: false, crown, bolt: { x: rod.x, y: rod.y } }
    : { exposed: true, crown, bolt: { x: p.x, y: p.y } }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/server/src/engine/__tests__/lightning.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/engine/lightning.ts packages/server/src/engine/__tests__/lightning.test.ts
git commit -m "Resolve lightning against the tallest crown"
```

---

### Task 3: Forecast generation and the round-gated schedule (TDD)

**Files:**
- Modify: `packages/server/src/engine/forecast.ts`
- Modify: `packages/server/src/engine/GameEngine.ts:37` (`startRound` passes the round)
- Test: `packages/server/src/engine/__tests__/forecast.test.ts` (create)

**Interfaces:**
- Consumes: `hasWind/hasRain/hasLightning`, `WEATHER_SCHEDULE` from Task 1.
- Produces: `randomWeatherDecision(round: number): WeatherDecision`; `generateForecast` fills `lightningProbability` for real. Signature change ripples only into `GameEngine.startRound()`.

- [ ] **Step 1: Write the failing tests**

Create `packages/server/src/engine/__tests__/forecast.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { hasLightning, hasWind } from '@wheee/shared'
import { generateForecast, randomWeatherDecision } from '../forecast.js'

describe('randomWeatherDecision schedule', () => {
  test('rounds 1-2 never produce lightning', () => {
    for (let i = 0; i < 500; i++) {
      expect(hasLightning(randomWeatherDecision(1).type)).toBe(false)
      expect(hasLightning(randomWeatherDecision(2).type)).toBe(false)
    }
  })

  test('round 3 produces lightning sometimes, round 7 mostly', () => {
    const hits = (round: number) =>
      Array.from({ length: 1000 }, () => randomWeatherDecision(round))
        .filter(d => hasLightning(d.type)).length
    expect(hits(3)).toBeGreaterThan(100)   // ~25% scheduled
    expect(hits(7)).toBeGreaterThan(600)   // ~80% scheduled
  })
})

describe('generateForecast lightning', () => {
  test('lightning weather reads >= 0.5, dry weather < 0.5, quantized', () => {
    for (let i = 0; i < 200; i++) {
      const stormy = generateForecast({ type: 'wind_lightning', dir: 'N' })
      expect(stormy.lightningProbability).toBeGreaterThanOrEqual(0.5)
      expect([0.75, 1.0]).toContain(stormy.lightningProbability)
      const dry = generateForecast({ type: 'wind_rain', dir: 'N' })
      expect(dry.lightningProbability).toBeLessThan(0.5)
      expect([0, 0.25]).toContain(dry.lightningProbability)
    }
  })

  test('pure lightning has a calm vane and no rain promise', () => {
    for (let i = 0; i < 50; i++) {
      const f = generateForecast({ type: 'lightning', dir: 'N' })
      expect(f.windCandidates).toEqual([])
      expect(f.rainProbability).toBeLessThan(0.5)
      expect(f.lightningProbability).toBeGreaterThanOrEqual(0.5)
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/server/src/engine/__tests__/forecast.test.ts`
Expected: FAIL — `randomWeatherDecision` takes no argument / lightningProbability is always 0.

- [ ] **Step 3: Implement in `forecast.ts`**

Replace the `hasWind`/`hasRain` locals in `generateForecast` with the shared predicates, add lightning, and rewrite `randomWeatherDecision`:

```ts
import type { ForecastData, WeatherType, WindDir } from '@wheee/shared'
import { WIND_DIRS, WEATHER_SCHEDULE, hasWind, hasRain, hasLightning } from '@wheee/shared'
```

In `generateForecast`, replace the first two lines with:

```ts
  const windy = hasWind(decision.type)
  const rainy = hasRain(decision.type)
  const stormy = hasLightning(decision.type)
```

(rename usages `hasWind` → `windy`, `hasRain` → `rainy` inside the function), and before the `return` add:

```ts
  const lightningProbability = stormy
    ? (Math.random() < 0.4 ? 0.75 : 1.0)
    : (Math.random() < 0.3 ? 0.25 : 0)
```

and put `lightningProbability,` into the returned object (replacing the Task 1 stub).

Replace `randomWeatherDecision`:

```ts
/**
 * Weather for the round, drawn from the round-gated schedule: rounds 1–2 are
 * today's game, lightning creeps in from round 3, late rounds must end matches.
 */
export function randomWeatherDecision(round: number): WeatherDecision {
  const tier = WEATHER_SCHEDULE.find(t => round <= t.upToRound) ?? WEATHER_SCHEDULE[WEATHER_SCHEDULE.length - 1]
  const total = tier.weights.reduce((s, [, w]) => s + w, 0)
  let roll = Math.random() * total
  let type: WeatherType = tier.weights[0][0]
  for (const [t, w] of tier.weights) {
    roll -= w
    if (roll <= 0) { type = t; break }
  }
  const dir = WIND_DIRS[Math.floor(Math.random() * WIND_DIRS.length)]
  return { type, dir }
}
```

In `GameEngine.startRound()` change the call to:

```ts
    this.weatherDecision = randomWeatherDecision(this.state.round)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/server/src/engine/__tests__/forecast.test.ts packages/server/src/engine/__tests__/engine.test.ts`
Expected: PASS. If any `engine.test.ts` test drives many rounds and asserts weather types, update it to the predicates.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/engine
git commit -m "Gate the weather mix by round and forecast lightning"
```

---

### Task 4: Wire lightning into `GameEngine.executeWeather` (TDD)

**Files:**
- Modify: `packages/server/src/engine/GameEngine.ts:80-137`
- Test: `packages/server/src/engine/__tests__/engine.test.ts` (append)

**Interfaces:**
- Consumes: `resolveLightning` (Task 2), predicates (Task 1).
- Produces: `WeatherResult` with real `boltCell`/`lightningSpared`; resolution order lightning → wind → rain with first-death cutoff. Room.ts needs no change (it forwards `WeatherResult` opaquely; `resultForPlayer` spreads unknown fields).

- [ ] **Step 1: Write the failing tests** (append to `engine.test.ts`, mirroring its existing helper style — it constructs a `GameEngine`, calls `startRound/beginTicking/submitTick×5/executeWeather`; use `setWeatherDecision` to force weather):

```ts
import { hasLightning } from '@wheee/shared'
// inside describe('GameEngine') or a new describe block:

test('lightning kill ends the storm before wind and rain', () => {
  const engine = new GameEngine(SPAWN_PAIRS[0]) // A(3,5) B(3,1)
  engine.startRound()
  engine.setWeatherDecision('wind_rain_lightning', 'S')
  engine.beginTicking()
  // A raises their own cell over five ticks is impossible (cap +1) — one raise
  // under A makes A the tallest crown; B digs a B-side rod (canonical raise = B pit... use lower).
  engine.submitTick({ A: { kind: 'raise', x: 3, y: 5 }, B: { kind: 'lower', x: 6, y: 6 } })
  for (let i = 0; i < 4; i++) engine.submitTick({})
  const r = engine.executeWeather()
  expect(r.deathCauses.A).toEqual({ type: 'lightning' })
  expect(r.deaths).toEqual(['A'])
  // storm broke off: no wind path beyond standing cells, no water
  expect(r.windPath.A.length).toBeLessThanOrEqual(1)
  expect(r.waterVolume).toBe(0)
  expect(r.boltCell.A).toEqual({ x: 3, y: 5 })
  expect(r.state.winner).toBe('B')
})

test('no lightning in the decision leaves boltCell empty', () => {
  const engine = new GameEngine(SPAWN_PAIRS[0])
  engine.startRound()
  engine.setWeatherDecision('wind', 'N')
  engine.beginTicking()
  for (let i = 0; i < 5; i++) engine.submitTick({})
  const r = engine.executeWeather()
  expect(r.boltCell).toEqual({ A: null, B: null })
  expect(r.lightningSpared).toBeNull()
})
```

(Adopt the file's actual import/helper names when appending — `SPAWN_PAIRS` comes from `@wheee/shared`.)

- [ ] **Step 2: Run to verify the first test fails**

Run: `bun test packages/server/src/engine/__tests__/engine.test.ts`
Expected: FAIL — nobody dies of lightning yet (stub returns nulls).

- [ ] **Step 3: Implement in `executeWeather`**

Add imports: `import { resolveLightning } from './lightning.js'` and `hasWind, hasRain, hasLightning` from `@wheee/shared`. Inside `executeWeather`, after `this.state.weather = ...`, add the new locals and the lightning pass **before** the wind block, and switch the wind/rain conditions to predicates:

```ts
    let boltCell: Record<PlayerId, { x: number; y: number } | null> = { A: null, B: null }
    let lightningSpared: PlayerId | null = null

    if (hasLightning(decision.type)) {
      const lr = resolveLightning(this.state)
      deaths.push(...lr.deaths)
      Object.assign(deathCauses, lr.deathCauses)
      boltCell = lr.boltCell
      lightningSpared = lr.spared
    }

    // The storm breaks off on the first death: a bolt that took someone ends
    // the round before the gale, exactly as the gale ends it before the rain.
    if (hasWind(decision.type) && deaths.length === 0) {
      const wr = resolveWind(this.state, decision.dir)
      ...existing wind block body...
    }

    const rains = hasRain(decision.type) && deaths.length === 0
```

and add `boltCell, lightningSpared,` to the returned object (replacing the Task 1 stubs).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/server/src/engine/__tests__/`
Expected: PASS across the whole engine directory.

- [ ] **Step 5: Record the bolt into replays**

`packages/server/src/Room.ts:749` — the weather replay frame push. Add `boltCell: result.boltCell,` next to the existing `deaths/windPath/floodedCells` fields.

Run: `bun test packages/server/src/engine/__tests__/` again — expected PASS (replay shape is structural).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src
git commit -m "Strike lightning before the wind"
```

---

### Task 5: Teach the bot the third sky (TDD)

**Files:**
- Modify: `packages/server/src/engine/bot.ts:55-135`
- Test: `packages/server/src/engine/__tests__/bot.test.ts` (append)

**Interfaces:**
- Consumes: `resolveLightning` (Task 2), `ForecastData.lightningProbability` (Task 3).
- Produces: nothing new outward — `chooseBotAction` signature unchanged.

- [ ] **Step 1: Write the failing tests** (append to `bot.test.ts`, matching its existing state-construction helpers):

```ts
test('under certain lightning the bot never ends the tick on a hill', () => {
  // Bot as A on a +1 hill, forecast promises lightning, no wind, no rain.
  const s = createInitialState({ A: { x: 3, y: 3 }, B: { x: 5, y: 5 } })
  s.board[3][3].height = 1
  s.board[6][6].height = 1 // a rod exists — stepping off is fully safe
  s.forecast = {
    windCandidates: [],
    rainProbability: 0,
    lightningProbability: 1.0,
    instrumentsBroken: { A: { vane: false, barometer: false }, B: { vane: false, barometer: false } },
  }
  for (let i = 0; i < 50; i++) {
    const a = chooseBotAction(s, 'A', { skip: 0, blunder: 0, hunt: false })
    // Surviving choices: move off the hill, or lower the hill under itself.
    expect(a).not.toBeNull()
    if (a!.kind === 'move') {
      // any move leaves (3,3), fine
    } else {
      expect(a).toEqual({ kind: 'lower', x: 3, y: 3 })
    }
  }
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/server/src/engine/__tests__/bot.test.ts`
Expected: FAIL — the bot ignores lightning (its `possibleWeather` has no lightning dimension, standing still judges as safe).

- [ ] **Step 3: Implement in `bot.ts`**

Extend the local `Weather` type and `possibleWeather`:

```ts
type Weather = { dir: WindDir | null; rain: boolean; lightning: boolean }
```

In `possibleWeather`, read `lightningProbability` alongside `rainProbability`; a broken barometer blinds the whole sky:

```ts
  const rains = broken.barometer ? [false, true] : [rainProbability >= 0.5]
  const lightnings = broken.barometer ? [false, true] : [state.forecast.lightningProbability >= 0.5]

  const out: Weather[] = []
  for (const dir of dirs) {
    for (const rain of rains) {
      for (const lightning of lightnings) out.push({ dir, rain, lightning })
    }
  }
```

In `judge`, mirror the engine's order (import `resolveLightning`):

```ts
    const s = cloneState(after)
    const struck = w.lightning ? resolveLightning(s).deaths.length > 0 : false
    const blown = !struck && w.dir ? resolveWind(s, w.dir).deaths.length > 0 : false
    if (w.rain && !struck && !blown) resolveRain(s)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/server/src/engine/__tests__/bot.test.ts packages/server/src/engine/__tests__/bot-room.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/engine/bot.ts packages/server/src/engine/__tests__/bot.test.ts
git commit -m "Let the bot fear the bolt"
```

---

### Task 6: Game-over causes and `lightningSpared` plumbing (client)

**Files:**
- Modify: `packages/client/src/composables/useGameState.ts:104-107` (new computed)
- Modify: `packages/client/src/components/GameOverOverlay.vue:16,53-98`
- Modify: `packages/client/src/lib/i18n.ts` (EN block near line 56-79, RU block near line 204-226)
- Modify: `packages/client/src/App.vue:1971-1972` (pass the prop)

**Interfaces:**
- Consumes: `WeatherResult.lightningSpared`, `DeathCause 'lightning'` (Tasks 1/4).
- Produces: `game.lightningSpared` computed; `GameOverOverlay` prop `lightningSpared: PlayerId | null`; i18n keys `gameover.bothStruck`, `gameover.struck`, `gameover.opponentStruck`, `gameover.youStruck`, `gameover.stoodTaller`, `gameover.opponentStoodTaller`, `gameover.youStoodTaller`.

- [ ] **Step 1: `useGameState.ts`** — next to `rainSpared` (line 107) add:

```ts
  const lightningSpared = computed<PlayerId | null>(() => weatherResult.value?.lightningSpared ?? null)
```

and add `lightningSpared,` to the returned object (next to `windSpared, rainSpared`).

- [ ] **Step 2: i18n keys** — EN block (after `'gameover.youDrownedFirst'`):

```ts
    'gameover.bothStruck': 'One bolt, two equal crowns',
    'gameover.struck': 'Lightning found {0} — the tallest point around',
    'gameover.opponentStruck': 'Lightning found the opponent',
    'gameover.youStruck': 'Lightning found you — the tallest point around',
    'gameover.stoodTaller': 'Both stood exposed — {0} stood taller and took the bolt',
    'gameover.opponentStoodTaller': 'Both stood exposed — the opponent stood taller and took the bolt',
    'gameover.youStoodTaller': 'Both stood exposed — you stood taller and took the bolt',
```

RU block (after the RU `gameover.youDrownedFirst`):

```ts
    'gameover.bothStruck': 'Один разряд — две равные макушки',
    'gameover.struck': 'Молния нашла {0} — самую высокую точку в округе',
    'gameover.opponentStruck': 'Молния нашла соперника',
    'gameover.youStruck': 'Молния нашла тебя — самую высокую точку в округе',
    'gameover.stoodTaller': 'Оба стояли открытыми — {0} стоял выше и принял разряд',
    'gameover.opponentStoodTaller': 'Оба стояли открытыми — соперник стоял выше и принял разряд',
    'gameover.youStoodTaller': 'Оба стояли открытыми — ты стоял выше и принял разряд',
```

- [ ] **Step 3: `GameOverOverlay.vue`** — add to props (line 16 area):

```ts
  lightningSpared?: PlayerId | null
```

In the `subtitle` computed, extend each of the four branches — every wind/rain pair gets a lightning sibling, in the same tie-break-first order the file already uses:

```ts
  // draw branch, after the bothDrowned line:
  if (aCause?.type === 'lightning' && bCause?.type === 'lightning') return t('gameover.bothStruck')

  // spectator branch, after the rainSpared line / before cause checks:
  if (props.lightningSpared === props.winner) return t('gameover.stoodTaller', loserId)
  // and after the rain cause line:
  if (cause?.type === 'lightning') return t('gameover.struck', loserId)

  // win branch:
  if (props.lightningSpared === myId) return t('gameover.opponentStoodTaller')
  ...
  if (oppCause?.type === 'lightning') return t('gameover.opponentStruck')

  // lose branch:
  if (props.lightningSpared === oppId) return t('gameover.youStoodTaller')
  ...
  if (myCause?.type === 'lightning') return t('gameover.youStruck')
```

- [ ] **Step 4: `App.vue`** — where the overlay receives `:wind-spared`/`:rain-spared` (lines 1971-1972) add:

```
    :lightning-spared="game.lightningSpared.value"
```

- [ ] **Step 5: Typecheck the client**

Run: `bun run --cwd packages/client build`
Expected: `vue-tsc` clean, vite build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src
git commit -m "Explain lightning deaths on the game-over screen"
```

---

### Task 7: The dial — icon remap and the electrified rim

**Files:**
- Modify: `packages/client/src/components/ForecastPanel.vue`
- Modify: `packages/client/src/App.vue` (pass `:lightning-probability` where `<ForecastPanel>` receives `:rain-probability`; grep the template for `rain-probability`)

**Interfaces:**
- Consumes: `forecast.lightningProbability` from game state.
- Produces: `ForecastPanel` prop `lightningProbability: number`. Icon contract: **bolt icons appear only when lightning ≥ 0.5** — the rain ladder is capped at the rain icon.

- [ ] **Step 1: Props and icon logic**

Add to props: `lightningProbability: number`.

Cap the rain ladder (line 48-54) — level 4 is no longer reachable by rain alone:

```ts
function rainLevel(p: number): number {
  if (p < 0.15) return 0
  if (p < 0.35) return 1
  if (p < 0.55) return 2
  return 3
}
```

Add a stormy computed and final icon key:

```ts
const stormy = computed(() => props.lightningProbability >= 0.5)
// icon key: 'sun'|'partly'|'cloudy'|'rain' from iconLevel, overridden by storms:
// stormy && rain>=0.5 → 'storm' (existing level-4 icon)
// stormy && rain<0.5 → 'drystorm' (new icon: dark cloud + bolt, NO rain strokes)
```

Broken barometer chaos: extend the random `displayLevel` roll to also randomly flip a `brokenStormy` ref so the bolt icons join the flicker (the whole sky is one instrument now).

Template: keep the four existing icons keyed 0-3; change the `v-else` storm icon's condition to the storm override; add the `drystorm` SVG — copy the `storm` icon (lines 305-315) and delete its two rain `<line>` strokes.

- [ ] **Step 2: The rim sparks**

In script, a spark generator driven by tiers (`0` at <0.15, `1` at ~0.25, `2` at ~0.75, `3` at 1.0):

```ts
const sparkTier = computed(() => {
  const p = props.lightningProbability
  if (p >= 0.9) return 3
  if (p >= 0.5) return 2
  if (p >= 0.15) return 1
  return 0
})
const sparks = ref<{ angle: number; len: number; delay: number }[]>([])
// regenerate on an interval in the existing tick() loop (every ~1.2s):
// count = [0, 1, 4, 8][sparkTier], each spark = random angle, len 4-9, random delay
```

Template, after the outer face circles (line 211): a `<g>` of short jagged polylines sitting ON the r=92 ring at each spark's angle, class `rim-spark`, plus at tier 3 one extra circle `r="94"` class `rim-glow`.

Styles:

```css
.rim-spark { stroke: #9fd0ff; stroke-width: 1.1; fill: none; opacity: 0;
  animation: spark-flick 1.2s linear infinite; }
@keyframes spark-flick { 0%,100% { opacity: 0 } 8% { opacity: .9 } 16% { opacity: .1 } 22% { opacity: .7 } 30% { opacity: 0 } }
.rim-glow { stroke: #7a5cff; stroke-width: 1.5; fill: none; opacity: .25;
  filter: drop-shadow(0 0 4px #7a5cff); }
@media (prefers-reduced-motion: reduce) { .rim-spark { animation: none; opacity: .5 } }
```

(Each spark gets `animation-delay` from its `delay` so they don't blink in unison.)

- [ ] **Step 3: Pass the prop in `App.vue`** — every `<ForecastPanel ... :rain-probability="...">` usage gains `:lightning-probability="<same source>.lightningProbability"`.

- [ ] **Step 4: Verify**

Run: `bun run --cwd packages/client build`
Expected: clean. Visual check rides Task 11.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src
git commit -m "Electrify the forecast dial"
```

---

### Task 8: Sounds — thunder, distant rumble, rim crackle

**Files:**
- Create: `packages/client/public/sounds/thunder-crack.mp3`, `thunder-distant.mp3`, `static-crackle.mp3`
- Modify: `packages/client/src/lib/audio.ts` (ids, defs, hush/duck helpers, storm ambience)

**Interfaces:**
- Consumes: nothing.
- Produces: sfx ids `'thunder-crack' | 'thunder-distant'`, loop id `'static-crackle'`; methods `beginHush(): void`, `endHush(): void` (fade wind-loop+music near zero / restore), `duckMusic(ms: number): void`, `setStormAmbience(active: boolean)` (random `thunder-distant` every 10–20 s while active), `startCrackle()/stopCrackle()`.

- [ ] **Step 1: Placeholder assets via ffmpeg** (synthesized stand-ins, replaced later through the same pipeline that produced the existing 26 sounds — flag in the commit message):

```bash
cd packages/client/public/sounds
ffmpeg -y -f lavfi -i "anoisesrc=color=brown:duration=2.5:amplitude=0.8" \
  -af "lowpass=f=700,afade=in:st=0:d=0.02,afade=out:st=1.6:d=0.9,volume=1.4" thunder-crack.mp3
ffmpeg -y -f lavfi -i "anoisesrc=color=brown:duration=4:amplitude=0.4" \
  -af "lowpass=f=220,afade=in:st=0:d=1.2,afade=out:st=2.2:d=1.8" thunder-distant.mp3
ffmpeg -y -f lavfi -i "anoisesrc=color=white:duration=3:amplitude=0.12" \
  -af "highpass=f=4000,tremolo=f=18:d=0.9" static-crackle.mp3
```

- [ ] **Step 2: Register in `audio.ts`** — add `'static-crackle'` to `LOOP_IDS`, `'thunder-crack', 'thunder-distant'` to `SFX_IDS`; in the `def()` switch add:

```ts
    case 'static-crackle':   return { src, loop: true,  layer: 'sfx', baseVolume: 0.12 }
    case 'thunder-crack':    return { src, loop: false, layer: 'sfx', baseVolume: 0.72 }
    case 'thunder-distant':  return { src, loop: false, layer: 'sfx', baseVolume: 0.22 }
```

(the file derives `src` from the id; follow the existing pattern above the switch).

- [ ] **Step 3: Helpers** — inside `createAudioSystem`, following the house patterns (`safeTimeout`, `activeLoops`, `resolveVolume`):

```ts
  /** The hush before the strike: wind and music sink almost to silence. */
  function beginHush() {
    for (const id of ['wind-loop', 'match-music', 'game-drone'] as SoundId[]) {
      const h = howls.get(id)!
      if (activeLoops.has(id)) h.fade(h.volume() as number, resolveVolume(id) * 0.05, 200)
    }
  }
  function endHush() {
    for (const id of ['wind-loop', 'match-music', 'game-drone'] as SoundId[]) {
      const h = howls.get(id)!
      if (activeLoops.has(id)) h.fade(h.volume() as number, resolveVolume(id), 400)
    }
  }
  /** Cinema duck: dip active music-layer loops for `ms` so the crack cuts through. */
  function duckMusic(ms: number) {
    for (const id of activeLoops) {
      if (defs.get(id)!.layer === 'sfx') continue
      const h = howls.get(id)!
      h.fade(h.volume() as number, resolveVolume(id) * 0.2, 60)
      safeTimeout(() => { if (activeLoops.has(id)) h.fade(h.volume() as number, resolveVolume(id), 300) }, ms)
    }
  }
  let stormAmbienceTimer: ReturnType<typeof setTimeout> | null = null
  function setStormAmbience(active: boolean) {
    if (!active) { if (stormAmbienceTimer) clearTimeout(stormAmbienceTimer); stormAmbienceTimer = null; return }
    if (stormAmbienceTimer) return
    const tick = () => {
      play('thunder-distant')
      stormAmbienceTimer = safeTimeout(tick, 10_000 + Math.random() * 10_000)
    }
    stormAmbienceTimer = safeTimeout(tick, 3_000 + Math.random() * 5_000)
  }
  function startCrackle() { startLoop('static-crackle') }
  function stopCrackle() { stopLoop('static-crackle') }
```

(Adapt `startLoop`/`stopLoop` to the file's actual loop-management function names — the ones `startWind`/`startRain` use.) Export all five from the returned object. Ensure `setStormAmbience(false)` is called from the existing `stopWeather()`/scene-change path (`cancelSceneTimers` companions) so rumbles never leak into the lobby.

- [ ] **Step 4: Verify**

Run: `bun run --cwd packages/client build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/client/public/sounds packages/client/src/lib/audio.ts
git commit -m "Give the storm its thunder (placeholder assets)"
```

---

### Task 9: The bolt — visual system and cataclysm choreography

**Files:**
- Create: `packages/client/src/lib/lightning.ts`
- Modify: `packages/client/src/App.vue:1181-1236` (`weather:result` handler), `~600` (replay frame playback), system setup/dispose where `windSystem`/`rainSystem` are created
- Modify: `packages/client/src/lib/player.ts` (emissive flash helper — follow its existing method style)

**Interfaces:**
- Consumes: `WeatherResult.boltCell`, `hasLightning` predicate, audio helpers from Task 8; the cell→world transform used by `player.ts` (copy its exact formula — players sit on cell centers, so the same math places the bolt).
- Produces: `createLightningSystem(scene: THREE.Scene)` returning `{ strike(cell: {x,y}, terrain: TerrainState): Promise<void>; update(dt: number): void; dispose(): void }`. `playersSystem.flashDeath(pid: 'A' | 'B'): void` (bright emissive surge, ~400 ms fade — **no darkening, no charring**).

- [ ] **Step 1: `lib/lightning.ts`**

```ts
import * as THREE from 'three'
import { HALF } from './constants'
import type { TerrainState } from './terrain'

const SKY_Y = 9
const SEGMENTS = 6           // midpoint-displacement depth → 2^6 points
const RIBBON_W = 0.14
const FORKS = 3
const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Jagged strand from sky to target via midpoint displacement. */
function makeStrand(from: THREE.Vector3, to: THREE.Vector3, jitter: number): THREE.Vector3[] {
  let pts = [from.clone(), to.clone()]
  for (let d = 0; d < SEGMENTS; d++) {
    const next: THREE.Vector3[] = [pts[0]]
    for (let i = 1; i < pts.length; i++) {
      const mid = pts[i - 1].clone().add(pts[i]).multiplyScalar(0.5)
      mid.x += (Math.random() - 0.5) * jitter
      mid.z += (Math.random() - 0.5) * jitter
      next.push(mid, pts[i])
    }
    pts = next
    jitter *= 0.55
  }
  return pts
}

/** Camera-facing ribbon for one strand: two triangles per segment, additive. */
function strandGeometry(pts: THREE.Vector3[], width: number): THREE.BufferGeometry {
  const verts: number[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    // horizontal side vector is enough — the bolt is near-vertical
    const side = new THREE.Vector3(b.z - a.z, 0, -(b.x - a.x)).normalize().multiplyScalar(width / 2)
    verts.push(
      a.x - side.x, a.y, a.z - side.z, a.x + side.x, a.y, a.z + side.z, b.x - side.x, b.y, b.z - side.z,
      a.x + side.x, a.y, a.z + side.z, b.x + side.x, b.y, b.z + side.z, b.x - side.x, b.y, b.z - side.z,
    )
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  return geo
}

export function createLightningSystem(scene: THREE.Scene) {
  const group = new THREE.Group()
  group.visible = false
  scene.add(group)

  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xf4faff, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0x86b8ff, transparent: true, opacity: 0.45,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  const light = new THREE.PointLight(0xbfd8ff, 0, 30, 1.6)
  scene.add(light)

  const sparkGeo = new THREE.BufferGeometry()
  const sparkPos = new Float32Array(40 * 3)
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3))
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    color: 0xcfe4ff, size: 0.18, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }))
  scene.add(sparks)
  let sparkVel: THREE.Vector3[] = []
  let sparkLife = 0

  function build(target: THREE.Vector3) {
    group.clear()
    const from = new THREE.Vector3(target.x + (Math.random() - 0.5) * 2, SKY_Y, target.z + (Math.random() - 0.5) * 2)
    const main = makeStrand(from, target, 2.4)
    group.add(new THREE.Mesh(strandGeometry(main, RIBBON_W), coreMat))
    group.add(new THREE.Mesh(strandGeometry(main, RIBBON_W * 3.2), glowMat))
    for (let f = 0; f < FORKS; f++) {
      const at = main[Math.floor(main.length * (0.25 + Math.random() * 0.4))]
      const tip = at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, -(1 + Math.random() * 2), (Math.random() - 0.5) * 3))
      group.add(new THREE.Mesh(strandGeometry(makeStrand(at, tip, 1.2), RIBBON_W * 0.6), glowMat))
    }
    light.position.copy(target).setY(target.y + 1.5)
  }

  function burst(target: THREE.Vector3) {
    sparkVel = []
    for (let i = 0; i < 40; i++) {
      sparkPos.set([target.x, target.y, target.z], i * 3)
      sparkVel.push(new THREE.Vector3((Math.random() - 0.5) * 6, 2 + Math.random() * 5, (Math.random() - 0.5) * 6))
    }
    sparkGeo.attributes.position.needsUpdate = true
    ;(sparks.material as THREE.PointsMaterial).opacity = 0.9
    sparkLife = 0.7
  }

  const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

  /** Flash pattern: 120ms on, 60 off, 90 on (rebuilt), 60 off, 70 on weaker. ≤3 flashes. */
  async function strike(cell: { x: number; y: number }, terrain: TerrainState): Promise<void> {
    // Same placement math as player.ts — copy its cell-center formula verbatim.
    const target = terrain.cellTopWorld(cell.x, cell.y) // see Step 2: helper added to terrain
    const flashes: [number, number][] = REDUCED ? [[140, 0.7]] : [[120, 1], [90, 0.85], [70, 0.6]]
    build(target)
    burst(target)
    for (let i = 0; i < flashes.length; i++) {
      const [ms, strength] = flashes[i]
      if (i > 0) { await wait(60); build(target) }
      group.visible = true
      coreMat.opacity = strength
      glowMat.opacity = 0.45 * strength
      light.intensity = 26 * strength
      await wait(ms)
      group.visible = false
      light.intensity = 0
    }
  }

  return {
    strike,
    update(dt: number) {
      if (sparkLife <= 0) return
      sparkLife -= dt
      for (let i = 0; i < sparkVel.length; i++) {
        sparkVel[i].y -= 9 * dt
        sparkPos[i * 3] += sparkVel[i].x * dt
        sparkPos[i * 3 + 1] += sparkVel[i].y * dt
        sparkPos[i * 3 + 2] += sparkVel[i].z * dt
      }
      sparkGeo.attributes.position.needsUpdate = true
      ;(sparks.material as THREE.PointsMaterial).opacity = Math.max(0, sparkLife / 0.7) * 0.9
    },
    dispose() {
      scene.remove(group, light, sparks)
      group.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose() })
      coreMat.dispose(); glowMat.dispose(); sparkGeo.dispose()
    },
  }
}
```

- [ ] **Step 2: `cellTopWorld` helper** — in `lib/terrain.ts` (TerrainState), add a method returning the world-space top-center of a cell: reuse the same x/z formula `player.ts` uses to place characters and the terrain's current height for y. Keep the name `cellTopWorld(x: number, y: number): THREE.Vector3`.

- [ ] **Step 3: `playersSystem.flashDeath(pid)`** — in `lib/player.ts`: briefly raise the character material's emissive intensity (white surge, ease back over ~400 ms). No color darkening. Follow the file's animation conventions.

- [ ] **Step 4: Choreography in `App.vue` `weather:result` (lines 1181-1236)**

Create `lightningSystem` next to `windSystem` (setup + `update(dt)` in the render loop + dispose in `resetVisuals` teardown). Rework the handler start:

```ts
    case 'weather:result': {
      terrainState.applyBoardState(msg.result.state.board)
      const weather = msg.result.state.weather
      const stormy = weather ? hasLightning(weather.type) : false
      const struckDead = (['A', 'B'] as const).filter(pid => msg.result.deathCauses[pid]?.type === 'lightning')

      const runStorm = async () => {
        if (stormy) {
          audio.beginHush()
          await new Promise(r => setTimeout(r, 800))            // the hush + cloud glows
          const mySide = game.myPlayerId.value ?? 'A'            // spectators watch A's side
          const bolt = msg.result.boltCell?.[mySide]
          audio.play('thunder-crack')
          audio.duckMusic(300)
          if ('vibrate' in navigator) navigator.vibrate?.(40)
          for (const pid of struckDead) playersSystem?.flashDeath(pid)
          glassSystem?.pulse?.()                                 // reuse/extend the plate emissive
          if (bolt && lightningSystem) await lightningSystem.strike(bolt, terrainState)
          audio.endHush()
        }
        // …then the existing wind/rain block runs unchanged (they were skipped
        // server-side if the bolt killed: paths are empty, floodedCells empty).
      }
      runStorm().then(() => { /* existing wind/rain + Promise.all storm code moves here */ })
```

Concretely: wrap the current body from `if (weather) { windSystem…` through the `Promise.all(storm)` chain into the continuation, so wind lines/rain/glass and `pendingGameEnd` resolution all run **after** the bolt sequence. Keep `weatherAnimDone` semantics identical (set `false` at handler start, `true` at the very end). The wind-freeze during the hush = simply not calling `windSystem.setVisible(true)` until after the strike.

Also: `wind_rain` check at line 1189 becomes `hasRain(weather.type)`, and the `setDirection/setVisible` gate becomes `hasWind(weather.type)` — pure-lightning rounds must not start gale visuals or `audio.startWind()`.

- [ ] **Step 5: Storm ambience + crackle wiring** — in `applyGameState` (or a watcher on the forecast): during `forecast`/`ticking` phases call `audio.setStormAmbience(f.lightningProbability >= 0.25)` and `f.lightningProbability >= 0.75 ? audio.startCrackle() : audio.stopCrackle()`; both off in `round:start` reset path and `resetVisuals`.

- [ ] **Step 6: Replay playback** — in the replay frame branch (App.vue ~line 600): when `frame.weather?.boltCell` is present and `frame.state.weather` satisfies `hasLightning`, fire `lightningSystem.strike(frame.weather.boltCell.A, terrainState)` (replays are watched from A's side) before animating wind paths.

- [ ] **Step 7: Verify**

Run: `bun run --cwd packages/client build`
Expected: clean build.

- [ ] **Step 8: Commit**

```bash
git add packages/client/src
git commit -m "Draw the bolt and choreograph the strike"
```

---

### Task 10: Architect picker + ws round-trip test

**Files:**
- Modify: `packages/client/src/components/ArchitectHud.vue:47-58`
- Modify: `packages/client/src/lib/i18n.ts` (architect keys, EN + RU)
- Test: `packages/server/src/engine/__tests__/architect.test.ts` (append)

**Interfaces:**
- Consumes: extended `WeatherType` (server already validates against `WEATHER_TYPES`, updated in Task 1 — verify with a grep for `WEATHER_TYPES` in `packages/server/src/index.ts`; if validation is structural, nothing to change).
- Produces: architect can order every combo via base type + a ⚡ toggle.

- [ ] **Step 1: ws test first** (append to `architect.test.ts`, following its existing connect/assign helpers):

```ts
test('architect can order a dry thunderstorm', async () => {
  // setup mirrors the existing set_weather test in this file
  architect.send({ type: 'architect:set_weather', weatherType: 'wind_lightning', dir: 'E' })
  // assert the players' next forecast:update carries lightningProbability >= 0.5
  // and windCandidates containing 'E'
})
```

Run: `bun test packages/server/src/engine/__tests__/architect.test.ts` (this file may need the live-server env — check its header; if it spins its own Room, no server needed).
Expected: FAIL only if validation rejects the type; PASS immediately is acceptable (Task 1 widened `WEATHER_TYPES`) — then this test is the regression guard.

- [ ] **Step 2: `ArchitectHud.vue`** — extend the base list with pure lightning and add the toggle:

```ts
const weatherTypes = computed(() => [
  { id: 'wind' as WeatherType, label: t('architect.wind'), icon: '💨' },
  { id: 'wind_rain' as WeatherType, label: t('architect.storm'), icon: '⛈' },
  { id: 'rain' as WeatherType, label: t('architect.rain'), icon: '🌧' },
  { id: 'lightning' as WeatherType, label: t('architect.lightning'), icon: '🌩' },
])
const addLightning = ref(false)

const COMBINE: Partial<Record<WeatherType, WeatherType>> = {
  wind: 'wind_lightning', wind_rain: 'wind_rain_lightning', rain: 'rain_lightning',
}
function confirmWeather() {
  if (props.weatherSubmitted) return
  const base = weatherType.value
  const finalType = addLightning.value ? (COMBINE[base] ?? base) : base
  emit('setWeather', finalType, windDir.value)
}
```

Template: a `⚡ {{ t('architect.addLightning') }}` toggle button next to the type row, `disabled` when `weatherType === 'lightning'`. i18n: EN `'architect.lightning': 'Lightning'`, `'architect.addLightning': '+ lightning'`; RU `'architect.lightning': 'Гроза'`, `'architect.addLightning': '+ молния'`.

- [ ] **Step 3: Verify** — `bun test packages/server/src/engine/__tests__/architect.test.ts` PASS, `bun run --cwd packages/client build` clean.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src packages/server/src/engine/__tests__/architect.test.ts
git commit -m "Hand the architect the bolt"
```

---

### Task 11: Docs, tutorial line, and full verification

**Files:**
- Modify: `game/GAME_DESIGN.md`
- Modify: `packages/client/src/lib/i18n.ts` + the tutorial copy (`TutorialHud.vue` steps or the how-to overlay — grep `tutorial.` keys)
- Verify: everything.

- [ ] **Step 1: GAME_DESIGN.md** — add §"Lightning" after the Rain section: the crown rule (one sentence + derived corollaries), order `молния → ветер → дождь` with the first-death cutoff note in §12, the `WEATHER_SCHEDULE` table, forecast dial behavior (icon ladder capped at rain; bolt icons only from lightning; rim static) in §11, `lightning` in the DeathCause list in the type appendix, and the escalation rationale (replaces a shrinking-board mechanic). Update §12's "Wind (55%) / Wind+Rain (45%)" to point at the schedule table.

- [ ] **Step 2: Tutorial line** — add i18n key `'tutorial.lightning'`: EN `'Lightning strikes the tallest point around — don't be it.'`, RU `'Молния бьёт в самую высокую точку в округе — не будь ею.'` and append it to the tutorial's closing card / how-to copy (grep the existing `tutorial.` keys to find the list it joins).

- [ ] **Step 3: Full suite**

```bash
cd packages/server && RECONNECT_GRACE_MS=2000 BOT_MATCH_DELAY_MS=800 BOT_MATCH_DELAY_LONG_MS=800 bun run dev &   # live :3001 for ws tests
RECONNECT_GRACE_MS=2000 BOT_MATCH_DELAY_MS=800 BOT_MATCH_DELAY_LONG_MS=800 bun test
```

Expected: full pass (148 existing + new lightning/forecast/bot/architect tests).

- [ ] **Step 4: Live visual check (playwright, local)**

For the check only (do NOT commit): edit `WEATHER_SCHEDULE`'s first tier to `[['wind_lightning', 100]]`. Then: dev server + `bun run dev:client`, fresh storage, Play → bot match in 8 s, verify with screenshots: (1) dial shows bolt icon + rim sparks during forecast; (2) cataclysm shows hush → bolt ribbon → sparks, **no full-screen flash**; (3) survivor case shows the bolt diving into a rod; (4) a lightning death shows the game-over subtitle from Task 6. Revert the schedule edit, confirm `git diff` is clean of it.

- [ ] **Step 5: Commit docs**

```bash
git add game/GAME_DESIGN.md packages/client/src/lib/i18n.ts packages/client/src/components
git commit -m "Document the third sky"
```

---

## Self-review notes (already applied)

- Spec coverage: rule/order/tie-break (T2/T4), schedule (T3), dial (T7), bolt+choreography+haptics+reduced-motion (T9), audio+hush+duck (T8), game-over + `lightningSpared` (T6), architect (T10), replays `boltCell` (T4 step 5 + T9 step 6), docs/tutorial (T11), enum-not-flags (T1), bot (T5).
- Deliberately out (spec non-goals): electric flood, scorch decals, full-screen flash, analytics changes, lightning in tutorial rounds 1–2.
- Placeholder sounds are explicitly temporary; replacement rides the user's asset pipeline.
