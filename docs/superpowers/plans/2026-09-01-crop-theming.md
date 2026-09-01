# Crop Identity Theming + Geo Suggestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each crop (wheat/rice/corn) a consistent decorative regional identity across the arena, result screen, and (architecture-only) music, and suggest a crop to first-time players based on their connection's detected country.

**Architecture:** A new server route reuses the existing `detectCountry()` header-based signal to map a country to a crop; the client fetches that suggestion once at boot (parallel with the existing platform-init step) and applies it only when no persisted preference exists. A new client-side `cropTheme.ts` table feeds small, additive parameters into the already-existing terrain-painting, storm-sky, result-screen, and music-track-selection functions — none of which take a character-driven parameter today.

**Tech Stack:** Vue 3 (Composition API) + Three.js client, Bun + Hono + WebSocket server, `bun:test` for unit tests (both packages), Howler.js for audio.

## Global Constraints

- No renaming of lobby UI — cards stay `wheat`/`rice`/`corn` (spec Non-goals).
- No gameplay/balance effect — both players remain fully symmetric; no engine file may read `player.character` for any rule.
- No new audio asset files — only a swap-by-crop mechanism; it must produce byte-identical behavior to today until real tracks are added later.
- No recoloring of wind/rain/lightning functional particle/line colors.
- No new GeoIP dependency — reuse `detectCountry()` (`packages/server/src/index.ts:830-845`) verbatim.
- Region→crop mapping: Asia → `rice`, Americas → `corn`, everything else (including Europe, Africa, Oceania, and unknown/unresolvable) → `wheat`.
- A returning player's saved crop preference always overrides the geo suggestion.

## Note on test coverage for Task 8 (storm.ts)

`createStormSystem()` (`packages/client/src/lib/storm.ts`) returns a closure-encapsulated object with no accessor for its internal `THREE.ShaderMaterial`/uniforms, and no test file exists for this module today (nor for `wind.ts`/`rain.ts`/`lightning.ts` — this codebase does not unit-test its Three.js visual modules). Adding an accessor purely so a test can read `uniforms.uBase.value` would be test-driven pollution of a module that has deliberately kept its internals private. Task 8 is implemented with a plain code change and verified manually (steps included) rather than with an automated test — flagging this explicitly per TDD's "ask your human partner" exception, since it departs from the otherwise-uniform TDD cycle used in every other task. If this trade-off doesn't sit right, the alternative is exposing `dome`/`material` on the returned object for testability — say so before/while executing Task 8.

---

## Task 1: Server region→crop mapping

**Files:**
- Create: `packages/server/src/regionCrop.ts`
- Test: `packages/server/src/__tests__/regionCrop.test.ts`

**Interfaces:**
- Produces: `countryToCrop(countryCode: string | null): CharacterType` — pure, synchronous. Consumed by Task 2.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/src/__tests__/regionCrop.test.ts
import { describe, it, expect } from 'bun:test'
import { countryToCrop } from '../regionCrop.js'

describe('countryToCrop', () => {
  it('maps an Asian country to rice', () => {
    expect(countryToCrop('JP')).toBe('rice')
    expect(countryToCrop('IN')).toBe('rice')
  })

  it('maps an Americas country to corn', () => {
    expect(countryToCrop('US')).toBe('corn')
    expect(countryToCrop('BR')).toBe('corn')
  })

  it('maps a European country to wheat', () => {
    expect(countryToCrop('DE')).toBe('wheat')
    expect(countryToCrop('FR')).toBe('wheat')
  })

  it('falls back to wheat for a country outside all three buckets', () => {
    expect(countryToCrop('ZA')).toBe('wheat') // South Africa
    expect(countryToCrop('AU')).toBe('wheat') // Australia
  })

  it('falls back to wheat for null or unrecognized input', () => {
    expect(countryToCrop(null)).toBe('wheat')
    expect(countryToCrop('XX')).toBe('wheat')
    expect(countryToCrop('')).toBe('wheat')
  })

  it('is case-insensitive', () => {
    expect(countryToCrop('jp')).toBe('rice')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/server/`): `bun test src/__tests__/regionCrop.test.ts`
Expected: FAIL — `Cannot find module '../regionCrop.js'`

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/server/src/regionCrop.ts
import type { CharacterType } from '@wheee/shared'

/**
 * Suggests a crop for a first-time player based on connection country,
 * reflecting each crop's real-world region (rice paddies of Asia, corn's
 * Americas origin, wheat across Europe). Europe has no explicit list below:
 * DEFAULT_CROP is wheat, which is already Europe's crop, so leaving Europe —
 * along with Africa, Oceania, and anything unrecognized — to fall through to
 * the default does the right thing without a redundant list.
 */
const DEFAULT_CROP: CharacterType = 'wheat'

const ASIA = new Set([
  'CN', 'JP', 'KR', 'KP', 'IN', 'ID', 'TH', 'VN', 'PH', 'MY', 'SG', 'MM',
  'KH', 'LA', 'BD', 'PK', 'LK', 'NP', 'MN', 'TW', 'HK', 'MO', 'BN', 'TL',
  'KZ', 'UZ', 'TM', 'TJ', 'KG',
  'AE', 'SA', 'IL', 'TR', 'IR', 'IQ', 'JO', 'LB', 'SY', 'YE', 'OM', 'QA',
  'KW', 'BH', 'AF',
])

const AMERICAS = new Set([
  'US', 'CA', 'MX',
  'BR', 'AR', 'CL', 'CO', 'PE', 'VE', 'EC', 'BO', 'PY', 'UY', 'GY', 'SR',
  'GT', 'HN', 'SV', 'NI', 'CR', 'PA', 'BZ',
  'CU', 'DO', 'HT', 'JM', 'TT', 'BS', 'BB',
])

export function countryToCrop(countryCode: string | null): CharacterType {
  if (!countryCode) return DEFAULT_CROP
  const code = countryCode.toUpperCase()
  if (ASIA.has(code)) return 'rice'
  if (AMERICAS.has(code)) return 'corn'
  return DEFAULT_CROP
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/regionCrop.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/regionCrop.ts packages/server/src/__tests__/regionCrop.test.ts
git commit -m "Add country-to-crop mapping for the suggestion endpoint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Server suggestion endpoint

**Files:**
- Modify: `packages/server/src/index.ts`

**Interfaces:**
- Consumes: `countryToCrop` from Task 1 (`packages/server/src/regionCrop.ts`); existing `detectCountry(headers: Headers): string | null` (`index.ts:830-845`, unchanged).
- Produces: `GET /api/character-suggestion` → `{ character: CharacterType }`.

There is no existing automated test harness for Hono routes in this codebase (`app` is not exported from `index.ts`, and the file calls `Bun.serve()` at module scope on import — importing it in a test would start a real server). This task is verified manually with `curl` instead, consistent with the project's actual testing practice for this file.

- [ ] **Step 1: Add the import**

In `packages/server/src/index.ts`, near the top with the other local imports (after `import { CHARACTERS } from '@wheee/shared'`):

```ts
import { countryToCrop } from './regionCrop.js'
```

- [ ] **Step 2: Add the route**

Add this route in `packages/server/src/index.ts` directly after the `/api/leaderboard/watchers` route (the block ending `return c.json(getWatcherLeaderboard(limit, offset))\n})`):

```ts
app.get('/api/character-suggestion', (c) => {
  const country = detectCountry(c.req.raw.headers)
  return c.json({ character: countryToCrop(country) })
})
```

This lands under `/api/*`, so it inherits the existing CORS and rate-limit middleware already registered above it (`index.ts:231-244`). `detectCountry` is a hoisted function declaration defined later in the same file (`index.ts:830-845`), so referencing it here before its textual definition is valid.

- [ ] **Step 3: Type-check**

Run (from `packages/server/`): `bun run build` if a build script exists, otherwise `bunx tsc --noEmit`. Confirm no new errors.

- [ ] **Step 4: Manual verification**

Start the dev server (however this project normally runs it locally, e.g. `bun run dev` from `packages/server/`), then:

```bash
curl -s http://localhost:3001/api/character-suggestion
# {"character":"wheat"}  (no country header locally -> falls through to default)

curl -s -H 'x-country-code: JP' http://localhost:3001/api/character-suggestion
# {"character":"rice"}

curl -s -H 'x-country-code: US' http://localhost:3001/api/character-suggestion
# {"character":"corn"}

curl -s -H 'x-country-code: DE' http://localhost:3001/api/character-suggestion
# {"character":"wheat"}
```

Confirm each returns the expected crop before moving on.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "Add GET /api/character-suggestion endpoint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Client `characterPreference.ts` null semantics

**Files:**
- Modify: `packages/client/src/lib/characterPreference.ts`
- Modify: `packages/client/src/lib/__tests__/characterPreference.test.ts`

**Interfaces:**
- Produces (changed): `loadCharacterPreference(): CharacterType | null` — `null` now means "nothing was ever saved," replacing the old always-`'wheat'`-fallback behavior. Consumed by Task 5.
- `saveCharacterPreference(character: CharacterType): void` — unchanged.

This task changes an already-existing, already-tested module from this session's earlier work. Because the return type itself is the behavior under test, updating the existing tests *is* the RED step here — they must be changed to expect `null` and shown to fail against the current (`'wheat'`-returning) implementation before the implementation changes.

- [ ] **Step 1: Rewrite the test file to expect `null`**

```ts
// packages/client/src/lib/__tests__/characterPreference.test.ts
import { describe, it, expect, beforeEach } from 'bun:test'
import { loadCharacterPreference, saveCharacterPreference } from '../characterPreference.js'
import { hydrateStorage } from '../storage.js'

describe('character preference persistence', () => {
  beforeEach(async () => {
    // storage.ts caches values at module scope; re-hydrating from an empty
    // backend resets that cache between tests instead of leaking state.
    await hydrateStorage({ load: async () => ({}), set: () => {} })
  })

  it('returns null when nothing has been saved', () => {
    expect(loadCharacterPreference()).toBeNull()
  })

  it('round-trips a saved character', () => {
    saveCharacterPreference('rice')
    expect(loadCharacterPreference()).toBe('rice')
  })

  it('returns null for a corrupted/unknown value', async () => {
    await hydrateStorage({ load: async () => ({ 'wheee:character-v1': 'not-a-crop' }), set: () => {} })
    expect(loadCharacterPreference()).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/client/`): `bun test src/lib/__tests__/characterPreference.test.ts`
Expected: FAIL — the "returns null" tests get `'wheat'` instead of `null`.

- [ ] **Step 3: Update the implementation**

```ts
// packages/client/src/lib/characterPreference.ts
import { CHARACTERS } from '@wheee/shared'
import type { CharacterType } from '@wheee/shared'
import { storageGet, storageSet } from './storage'

/**
 * The crop picked in the lobby, persisted through `lib/storage.ts` so it
 * survives a reload instead of resetting to wheat every time (same treatment
 * as the streak and audio settings). Returns null when nothing is stored so
 * callers (useGameState) can tell "never played" apart from "explicitly
 * picked wheat" and layer a geo suggestion in between the two.
 */

const STORAGE_KEY = 'wheee:character-v1'

export function loadCharacterPreference(): CharacterType | null {
  const raw = storageGet(STORAGE_KEY)
  return (CHARACTERS as readonly string[]).includes(raw ?? '')
    ? (raw as CharacterType)
    : null
}

export function saveCharacterPreference(character: CharacterType): void {
  storageSet(STORAGE_KEY, character)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/__tests__/characterPreference.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/lib/characterPreference.ts packages/client/src/lib/__tests__/characterPreference.test.ts
git commit -m "Return null from loadCharacterPreference when unset

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Client geo-suggestion fetch module + boot wiring

**Files:**
- Create: `packages/client/src/lib/characterSuggestion.ts`
- Test: `packages/client/src/lib/__tests__/characterSuggestion.test.ts`
- Modify: `packages/client/src/main.ts`

**Interfaces:**
- Consumes: `API_BASE` from `packages/client/src/lib/config.ts` (existing, unchanged); `CHARACTERS`/`CharacterType` from `@wheee/shared`.
- Produces: `fetchCharacterSuggestion(timeoutMs?: number): Promise<void>` and `getSuggestedCharacter(): CharacterType | null`. Consumed by Task 5 (`useGameState.ts`) and by this task's own `main.ts` wiring.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/client/src/lib/__tests__/characterSuggestion.test.ts
import { describe, it, expect, afterEach } from 'bun:test'
import { fetchCharacterSuggestion, getSuggestedCharacter } from '../characterSuggestion.js'

const originalFetch = globalThis.fetch

describe('character suggestion fetch', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('stores the suggested character from a successful response', async () => {
    globalThis.fetch = (() => Promise.resolve(
      new Response(JSON.stringify({ character: 'rice' }), { status: 200 }),
    )) as typeof fetch
    await fetchCharacterSuggestion()
    expect(getSuggestedCharacter()).toBe('rice')
  })

  it('ignores a response with an unrecognized character', async () => {
    globalThis.fetch = (() => Promise.resolve(
      new Response(JSON.stringify({ character: 'nope' }), { status: 200 }),
    )) as typeof fetch
    await fetchCharacterSuggestion()
    expect(getSuggestedCharacter()).toBeNull()
  })

  it('resolves to null on a network error', async () => {
    globalThis.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch
    await fetchCharacterSuggestion()
    expect(getSuggestedCharacter()).toBeNull()
  })

  it('resolves to null when the request exceeds its timeout', async () => {
    globalThis.fetch = ((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })) as typeof fetch
    await fetchCharacterSuggestion(20)
    expect(getSuggestedCharacter()).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/client/`): `bun test src/lib/__tests__/characterSuggestion.test.ts`
Expected: FAIL — `Cannot find module '../characterSuggestion.js'`

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/client/src/lib/characterSuggestion.ts
import { CHARACTERS } from '@wheee/shared'
import type { CharacterType } from '@wheee/shared'
import { API_BASE } from './config'

/**
 * A crop suggested for first-time players based on connection country
 * (`GET /api/character-suggestion`, server-side mapping in
 * packages/server/src/regionCrop.ts). Fetched once at boot, before the app
 * mounts (see main.ts) — this call must never throw and never meaningfully
 * delay boot, so any failure (timeout, network error, bad payload) just
 * leaves the suggestion null and useGameState falls back to the persisted
 * preference or 'wheat'.
 */

let suggestion: CharacterType | null = null

export async function fetchCharacterSuggestion(timeoutMs = 800): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${API_BASE}/api/character-suggestion`, { signal: controller.signal })
    if (!res.ok) return
    const body = await res.json() as { character?: unknown }
    if (typeof body.character === 'string' && (CHARACTERS as readonly string[]).includes(body.character)) {
      suggestion = body.character as CharacterType
    }
  } catch {
    // network error, timeout, bad JSON — suggestion stays null
  } finally {
    clearTimeout(timer)
  }
}

export function getSuggestedCharacter(): CharacterType | null {
  return suggestion
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/__tests__/characterSuggestion.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire it into boot, before the existing `.catch`**

Read `packages/client/src/main.ts` first — it currently is:

```ts
import { createApp } from 'vue'
import './style.css'
import { initPlatform } from './lib/platform'
import { initAnalytics } from './lib/analytics'
import { setLanguage } from './lib/i18n'
import App from './App.vue'

initPlatform()
  .then((platform) => {
    setLanguage(platform.getLanguage())
    initAnalytics(platform)
    createApp(App).mount('#app')
  })
  .catch((err) => {
    console.error('[init] Platform initialization failed:', err)
    document.getElementById('app')!.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#fff;font-family:sans-serif;text-align:center;padding:24px">' +
      '<div><p style="font-size:18px;margin-bottom:12px">Failed to load</p>' +
      '<button onclick="location.reload()" style="padding:10px 24px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#fff;font-size:14px;cursor:pointer">Reload</button></div></div>'
  })
```

Replace it with:

```ts
import { createApp } from 'vue'
import './style.css'
import { initPlatform } from './lib/platform'
import { initAnalytics } from './lib/analytics'
import { setLanguage } from './lib/i18n'
import { fetchCharacterSuggestion } from './lib/characterSuggestion'
import App from './App.vue'

// useGameState() reads getSuggestedCharacter() synchronously during App's
// setup(), so the suggestion fetch must resolve before mount — same
// constraint initPlatform() already satisfies for storage.ts. It runs
// alongside initPlatform() rather than after it, and never rejects (see
// characterSuggestion.ts), so it can't be the reason this chain's .catch
// fires.
Promise.all([initPlatform(), fetchCharacterSuggestion()])
  .then(([platform]) => {
    setLanguage(platform.getLanguage())
    initAnalytics(platform)
    createApp(App).mount('#app')
  })
  .catch((err) => {
    console.error('[init] Platform initialization failed:', err)
    document.getElementById('app')!.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#fff;font-family:sans-serif;text-align:center;padding:24px">' +
      '<div><p style="font-size:18px;margin-bottom:12px">Failed to load</p>' +
      '<button onclick="location.reload()" style="padding:10px 24px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#fff;font-size:14px;cursor:pointer">Reload</button></div></div>'
  })
```

- [ ] **Step 6: Run the full client test suite**

Run (from `packages/client/`): `bun test`
Expected: all tests pass, output pristine.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/lib/characterSuggestion.ts packages/client/src/lib/__tests__/characterSuggestion.test.ts packages/client/src/main.ts
git commit -m "Fetch a geo-based character suggestion before app mount

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: `useGameState.ts` suggestion precedence

**Files:**
- Modify: `packages/client/src/composables/useGameState.ts`
- Modify: `packages/client/src/composables/__tests__/useGameState.characterPersistence.test.ts`

**Interfaces:**
- Consumes: `loadCharacterPreference(): CharacterType | null` (Task 3), `getSuggestedCharacter(): CharacterType | null` and `fetchCharacterSuggestion` (Task 4).
- Produces (changed behavior): `selectedCharacter` now initializes to `preference ?? suggestion ?? 'wheat'` instead of `preference ?? 'wheat'`.

- [ ] **Step 1: Extend the test file with the new precedence cases**

Read `packages/client/src/composables/__tests__/useGameState.characterPersistence.test.ts` first (it currently has two tests, from this session's earlier work). Replace its contents with:

```ts
// packages/client/src/composables/__tests__/useGameState.characterPersistence.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { nextTick } from 'vue'
import { useGameState } from '../useGameState.js'
import { hydrateStorage } from '../../lib/storage.js'
import { loadCharacterPreference } from '../../lib/characterPreference.js'
import { fetchCharacterSuggestion } from '../../lib/characterSuggestion.js'

const originalFetch = globalThis.fetch

function mockSuggestion(character: string) {
  globalThis.fetch = (() => Promise.resolve(
    new Response(JSON.stringify({ character }), { status: 200 }),
  )) as typeof fetch
}

describe('useGameState character persistence', () => {
  beforeEach(async () => {
    await hydrateStorage({ load: async () => ({}), set: () => {} })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('initializes selectedCharacter from the saved preference', async () => {
    await hydrateStorage({ load: async () => ({ 'wheee:character-v1': 'corn' }), set: () => {} })
    const game = useGameState()
    expect(game.selectedCharacter.value).toBe('corn')
  })

  it('persists a change to selectedCharacter', async () => {
    const game = useGameState()
    game.selectedCharacter.value = 'rice'
    await nextTick()
    expect(loadCharacterPreference()).toBe('rice')
  })

  it('applies a geo suggestion when no preference is saved', async () => {
    mockSuggestion('rice')
    await fetchCharacterSuggestion()
    const game = useGameState()
    expect(game.selectedCharacter.value).toBe('rice')
  })

  it('ignores the suggestion when a preference is already saved', async () => {
    await hydrateStorage({ load: async () => ({ 'wheee:character-v1': 'wheat' }), set: () => {} })
    mockSuggestion('corn')
    await fetchCharacterSuggestion()
    const game = useGameState()
    expect(game.selectedCharacter.value).toBe('wheat')
  })
})
```

- [ ] **Step 2: Run test to verify the new cases fail**

Run (from `packages/client/`): `bun test src/composables/__tests__/useGameState.characterPersistence.test.ts`
Expected: the two new tests FAIL (`selectedCharacter.value` is `'wheat'`, not the suggested crop, because `useGameState.ts` doesn't consult the suggestion yet); the two pre-existing tests still PASS.

- [ ] **Step 3: Update the implementation**

In `packages/client/src/composables/useGameState.ts`, this session's earlier addition is:

```ts
  const selectedCharacter = ref<CharacterType>(loadCharacterPreference())
  watch(selectedCharacter, saveCharacterPreference)
```

Replace it with:

```ts
  const selectedCharacter = ref<CharacterType>(loadCharacterPreference() ?? getSuggestedCharacter() ?? 'wheat')
  watch(selectedCharacter, saveCharacterPreference)
```

And update the import line just above it (currently `import { loadCharacterPreference, saveCharacterPreference } from '../lib/characterPreference'`) to also pull in the suggestion accessor:

```ts
import { loadCharacterPreference, saveCharacterPreference } from '../lib/characterPreference'
import { getSuggestedCharacter } from '../lib/characterSuggestion'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/composables/__tests__/useGameState.characterPersistence.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run the full client test suite**

Run: `bun test`
Expected: all tests pass, output pristine.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/composables/useGameState.ts packages/client/src/composables/__tests__/useGameState.characterPersistence.test.ts
git commit -m "Apply geo character suggestion only when no preference is saved

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: `cropTheme.ts` data table

**Files:**
- Create: `packages/client/src/lib/cropTheme.ts`
- Test: `packages/client/src/lib/__tests__/cropTheme.test.ts`

**Interfaces:**
- Produces: `CROP_THEME: Record<CharacterType, CropTheme>` and `interface CropTheme { paletteAccent: readonly [number, number, number]; skyTint: number; resultAccent: string }`. Consumed by Tasks 7 (`paletteAccent`), 8 (`skyTint`), 10 (`resultAccent`, plus wiring `paletteAccent`/`skyTint` into `App.vue`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/lib/__tests__/cropTheme.test.ts
import { describe, it, expect } from 'bun:test'
import { CROP_THEME } from '../cropTheme.js'

describe('CROP_THEME', () => {
  it('has an entry for every crop with well-formed values', () => {
    for (const crop of ['wheat', 'rice', 'corn'] as const) {
      const theme = CROP_THEME[crop]
      expect(theme.paletteAccent).toHaveLength(3)
      for (const channel of theme.paletteAccent) {
        expect(channel).toBeGreaterThanOrEqual(-1)
        expect(channel).toBeLessThanOrEqual(1)
      }
      expect(Number.isInteger(theme.skyTint)).toBe(true)
      expect(theme.skyTint).toBeGreaterThanOrEqual(0)
      expect(theme.skyTint).toBeLessThanOrEqual(0xffffff)
      expect(typeof theme.resultAccent).toBe('string')
      expect(theme.resultAccent.length).toBeGreaterThan(0)
    }
  })

  it('keeps wheat at today\'s exact sky color, so the default crop is visually unchanged', () => {
    expect(CROP_THEME.wheat.skyTint).toBe(0x0a0e14)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/client/`): `bun test src/lib/__tests__/cropTheme.test.ts`
Expected: FAIL — `Cannot find module '../cropTheme.js'`

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/client/src/lib/cropTheme.ts
import type { CharacterType } from '@wheee/shared'

/**
 * Small decorative parameters keyed by crop, giving each one a subtle
 * region-flavored identity (rice ~ Asia, wheat ~ Europe, corn ~ Americas)
 * across the arena, result screen, and (later) music — without touching
 * gameplay. Deliberately excludes wind/rain/lightning colors: those carry
 * functional signal and stay universal (see the design spec's Non-goals).
 */
export interface CropTheme {
  /** Small RGB delta blended into the terrain palette (paintColors), each channel roughly -0.1..0.1. */
  paletteAccent: readonly [number, number, number]
  /** Calm-sky base color for the storm system's resting state, 0xRRGGBB. */
  skyTint: number
  /** CSS color for the result-screen accent border. */
  resultAccent: string
}

export const CROP_THEME: Record<CharacterType, CropTheme> = {
  // wheat's skyTint matches today's BASE (packages/client/src/lib/storm.ts)
  // exactly, so picking the default crop looks identical to before this
  // feature existed.
  wheat: { paletteAccent: [0.05, 0.02, -0.03], skyTint: 0x0a0e14, resultAccent: 'rgba(210, 180, 90, 0.55)' },
  rice: { paletteAccent: [-0.02, 0.01, 0.04], skyTint: 0x0a1018, resultAccent: 'rgba(220, 70, 70, 0.5)' },
  corn: { paletteAccent: [0.06, 0.04, -0.04], skyTint: 0x120e0a, resultAccent: 'rgba(230, 160, 40, 0.55)' },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/__tests__/cropTheme.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/lib/cropTheme.ts packages/client/src/lib/__tests__/cropTheme.test.ts
git commit -m "Add per-crop decorative theme table

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Terrain palette accent

**Files:**
- Modify: `packages/client/src/lib/terrain.ts`
- Test: `packages/client/src/lib/__tests__/terrain.test.ts`

**Interfaces:**
- Consumes: nothing new (accent is passed in as a plain tuple by the caller — Task 10 — so this module doesn't need to import `cropTheme.ts` at all).
- Produces (changed): `paintColors(geo: THREE.BufferGeometry, isBottom?: boolean, accent?: readonly [number, number, number]): void`. The `TerrainState.paintColors` interface member (`terrain.ts:359`) gains the same optional third parameter.

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/lib/__tests__/terrain.test.ts
import { describe, it, expect } from 'bun:test'
import * as THREE from 'three'
import { paintColors } from '../terrain.js'

function makeSingleVertexGeo(x: number, y: number, z: number): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute([x, y, z], 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0], 3))
  return geo
}

describe('paintColors accent', () => {
  it('shifts the red channel toward a positive accent', () => {
    const plain = makeSingleVertexGeo(1, 0, 1)
    paintColors(plain)
    const baseRed = (plain.attributes.color as THREE.BufferAttribute).getX(0)

    const tinted = makeSingleVertexGeo(1, 0, 1)
    paintColors(tinted, false, [0.3, 0, 0])
    const tintedRed = (tinted.attributes.color as THREE.BufferAttribute).getX(0)

    expect(tintedRed).toBeGreaterThan(baseRed)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/client/`): `bun test src/lib/__tests__/terrain.test.ts`
Expected: FAIL — `tintedRed` equals `baseRed` (the extra argument is silently ignored by the current 2-parameter function), so `toBeGreaterThan` fails.

- [ ] **Step 3: Update the implementation**

In `packages/client/src/lib/terrain.ts`, the current signature and final line are:

```ts
export function paintColors(geo: THREE.BufferGeometry, isBottom = false) {
```//
```ts
    col.setXYZ(i, clamp(r, 0, 1), clamp(g, 0, 1), clamp(b, 0, 1))
  }
  col.needsUpdate = true
}
```

Change the signature to:

```ts
export function paintColors(geo: THREE.BufferGeometry, isBottom = false, accent?: readonly [number, number, number]) {
```

And change the body just before the final `col.setXYZ` call (inside the `for` loop, right after the height-lift/checkerboard adjustments and before `col.setXYZ(i, ...)`) to apply the accent:

```ts
    // A crop's decorative palette accent (see lib/cropTheme.ts), blended in
    // last so it rides on top of height/slope/checkerboard shading rather
    // than fighting it.
    if (accent) {
      r += accent[0]
      g += accent[1]
      b += accent[2]
    }

    col.setXYZ(i, clamp(r, 0, 1), clamp(g, 0, 1), clamp(b, 0, 1))
```

Then update the `TerrainState` interface (`terrain.ts:359`) to match:

```ts
  paintColors(geo: THREE.BufferGeometry, isBottom?: boolean, accent?: readonly [number, number, number]): void
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/__tests__/terrain.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Run the full client test suite**

Run: `bun test`
Expected: all tests pass, output pristine.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/lib/terrain.ts packages/client/src/lib/__tests__/terrain.test.ts
git commit -m "Add optional palette accent parameter to paintColors

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Storm calm-sky tint

**Files:**
- Modify: `packages/client/src/lib/storm.ts`

**Interfaces:**
- Produces (changed): `createStormSystem(scene: THREE.Scene, baseTint?: THREE.Color)`. Consumed by Task 10.

See "Note on test coverage for Task 8" above — this task has no automated test, by design, and is verified manually.

- [ ] **Step 1: Update the function signature and uniform**

In `packages/client/src/lib/storm.ts`, the current signature is:

```ts
export function createStormSystem(scene: THREE.Scene) {
```

and the uniform block is:

```ts
    uniforms: {
      ...
      uBase:  { value: BASE },
      uStorm: { value: STORM },
      uDim:   { value: DIM },
    },
```

Change the signature to:

```ts
export function createStormSystem(scene: THREE.Scene, baseTint: THREE.Color = BASE) {
```

and the uniform to:

```ts
      uBase:  { value: baseTint },
```

`BASE` stays defined and used as the parameter's own default, so every existing caller (none pass a second argument yet) keeps today's exact color.

- [ ] **Step 2: Type-check**

Run (from `packages/client/`): `bunx vue-tsc -b --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual verification**

This can't be meaningfully verified until Task 10 wires a real per-crop tint through from `App.vue` — defer the visual check to Task 10's manual verification step, which covers all three crops. For this task alone, confirm only that nothing regresses: run the app, start a match with no crop-specific change yet visible (expected, since nothing calls `createStormSystem` with a second argument until Task 10), and confirm the sky looks exactly as it does on `main` today.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/lib/storm.ts
git commit -m "Add optional calm-sky base tint parameter to createStormSystem

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: Audio per-crop track resolution (architecture only)

**Files:**
- Modify: `packages/client/src/lib/audio.ts`
- Test: `packages/client/src/lib/__tests__/audio.test.ts`

**Interfaces:**
- Produces: `resolveMusicId(base: 'lobby-music' | 'match-music', character?: CharacterType): SoundId` (exported, pure). `enterLobby`, `enterMatch`, `enterFinished` (all returned from `createAudioSystem()`, so part of `AudioSystem`) each gain an optional `character?: CharacterType` parameter. Consumed by Task 10.

`createAudioSystem()` itself is not unit-tested (it builds real `Howl` instances, which need a DOM/Web Audio environment this bun:test setup doesn't provide, and no existing test in this codebase exercises it) — `resolveMusicId` is written as a standalone pure function specifically so the new logic is testable without touching `createAudioSystem()`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/lib/__tests__/audio.test.ts
import { describe, it, expect } from 'bun:test'
import { resolveMusicId } from '../audio.js'

describe('resolveMusicId', () => {
  it('falls back to the base track when no crop-specific track is configured', () => {
    expect(resolveMusicId('match-music', 'rice')).toBe('match-music')
    expect(resolveMusicId('match-music', 'wheat')).toBe('match-music')
    expect(resolveMusicId('lobby-music', 'corn')).toBe('lobby-music')
  })

  it('falls back to the base track when no character is given', () => {
    expect(resolveMusicId('match-music')).toBe('match-music')
    expect(resolveMusicId('lobby-music')).toBe('lobby-music')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/client/`): `bun test src/lib/__tests__/audio.test.ts`
Expected: FAIL — `resolveMusicId` is not exported by `audio.ts`.

- [ ] **Step 3: Write minimal implementation**

Add this in `packages/client/src/lib/audio.ts` directly after the `// --- Per-sound config ---` section comment and before `interface SoundDef`:

```ts
// ---------------------------------------------------------------------------
// Per-sound config
// ---------------------------------------------------------------------------
```

(this comment block is immediately above `interface SoundDef` — the new code goes right after it, before the `interface`):

```ts
/**
 * Per-crop overrides for the two music loops. Empty today — no regional
 * tracks exist yet — so resolveMusicId always falls back to the shared
 * track below. Populating an entry here (plus adding its file under
 * public/sounds and its SoundId case in def()) is the whole integration
 * point for a future crop-specific track.
 */
const MUSIC_TRACKS: Partial<Record<CharacterType, Partial<Record<'lobby-music' | 'match-music', SoundId>>>> = {}

export function resolveMusicId(base: 'lobby-music' | 'match-music', character?: CharacterType): SoundId {
  return (character && MUSIC_TRACKS[character]?.[base]) || base
}
```

This needs `CharacterType` imported. `audio.ts` doesn't import from `@wheee/shared` today — its current top-of-file imports are just:

```ts
import { Howl, Howler } from 'howler'
import { storageGet, storageSet } from './storage'
import { usePlatform } from './platform'
```

Add a new import line after them:

```ts
import type { CharacterType } from '@wheee/shared'
```

Then update the three scene-transition functions inside `createAudioSystem()` to accept and use a character:

```ts
  function enterLobby(character?: CharacterType) {
    cancelSceneTimers()
    stopWeather()
    fadeOutLayer('ambient', 1000)
    fadeOutLayer('music', 1000)
    sceneTimers.push(safeTimeout(() => {
      fadeIn('lobby-pad', 1200)
      fadeIn(resolveMusicId('lobby-music', character), 1500)
    }, 400))
  }

  function enterMatch(character?: CharacterType) {
    cancelSceneTimers()
    stopWeather()
    fadeOut('lobby-pad', 1000)
    fadeOut(resolveMusicId('lobby-music', character), 1000)
    sceneTimers.push(safeTimeout(() => {
      fadeIn('game-drone', 1200)
      fadeIn(resolveMusicId('match-music', character), 1500)
    }, 600))
  }

  function enterFinished(character?: CharacterType) {
    stopWeather()
    fadeOut('game-drone', 800)
    fadeOut(resolveMusicId('match-music', character), 800)
  }
```

`enterMatch`'s `fadeOut('lobby-music', 1000)` and `enterFinished`'s `fadeOut('match-music', 800)` both change to `resolveMusicId(...)` too — not just the `fadeIn` calls — so that whichever track ID a scene actually faded in is the same one later faded out. `MUSIC_TRACKS` is empty today so this is a no-op change in current behavior, but it's the detail that would otherwise silently leak a still-playing per-crop track once one is configured.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/__tests__/audio.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Run the full client test suite and type-check**

Run: `bun test` then `bunx vue-tsc -b --noEmit`
Expected: all tests pass; no new type errors (the `enterLobby`/`enterMatch`/`enterFinished` call sites in `App.vue` still compile because the new parameter is optional — they get updated in Task 10).

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/lib/audio.ts packages/client/src/lib/__tests__/audio.test.ts
git commit -m "Add per-crop music track resolution (architecture only)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: Wire crop theme through App.vue and GameOverOverlay.vue

**Files:**
- Modify: `packages/client/src/App.vue`
- Modify: `packages/client/src/components/GameOverOverlay.vue`

**Interfaces:**
- Consumes: `CROP_THEME` (Task 6), `paintColors(geo, isBottom?, accent?)` (Task 7), `createStormSystem(scene, baseTint?)` (Task 8), `resolveMusicId`/character-aware `enterLobby`/`enterMatch`/`enterFinished` (Task 9), `game.selectedCharacter` (existing, `useGameState.ts:33`).

No new automated test: `App.vue` and `GameOverOverlay.vue` have no test files today, and this project has no `@vue/test-utils`/component-test setup at all — consistent with that, this task is verified manually. This is the same encapsulation trade-off called out for Task 8, extended to Vue component wiring that has never had test coverage in this codebase.

- [ ] **Step 1: Import `CROP_THEME` in `App.vue`**

Add near the top of `App.vue`'s `<script setup>`, alongside the existing `lib/` imports (e.g. near `import { terrainState } from './lib/terrain'`, `App.vue:9`):

```ts
import { CROP_THEME } from './lib/cropTheme'
```

- [ ] **Step 2: Thread the accent into `paintColors` calls**

`App.vue` calls `terrainState.paintColors` in two places, `App.vue:2087-2089` and `App.vue:2185-2187`:

```ts
  terrainState.paintColors(geo)
  terrainState.paintColors(bottomGeo, true)
  terrainState.paintColors(skirtGeo)
```

Change both occurrences (both triplets) to:

```ts
  terrainState.paintColors(geo, false, CROP_THEME[game.selectedCharacter.value].paletteAccent)
  terrainState.paintColors(bottomGeo, true, CROP_THEME[game.selectedCharacter.value].paletteAccent)
  terrainState.paintColors(skirtGeo, false, CROP_THEME[game.selectedCharacter.value].paletteAccent)
```

- [ ] **Step 3: Thread the sky tint into `createStormSystem`**

`App.vue:1890` currently reads:

```ts
  const storm = createStormSystem(scene)
```

Change to:

```ts
  const storm = createStormSystem(scene, new THREE.Color(CROP_THEME[game.selectedCharacter.value].skyTint))
```

(`THREE` is already imported at the top of `App.vue` for the rest of the scene setup.)

- [ ] **Step 4: Pass the character into every audio scene-transition call**

Update each of the following call sites in `App.vue` to pass `game.selectedCharacter.value`:

- `App.vue:320`: `audio.enterMatch()` → `audio.enterMatch(game.selectedCharacter.value)`
- `App.vue:374`: `audio.enterFinished()` → `audio.enterFinished(game.selectedCharacter.value)`
- `App.vue:594`: `audio.enterLobby()` → `audio.enterLobby(game.selectedCharacter.value)`
- `App.vue:667`: `audio.enterLobby()` → `audio.enterLobby(game.selectedCharacter.value)`
- `App.vue:883`: `audio.enterLobby()` → `audio.enterLobby(game.selectedCharacter.value)`
- `App.vue:1460`: `audio.enterMatch()` → `audio.enterMatch(game.selectedCharacter.value)`
- `App.vue:1470`: `audio.enterLobby()` → `audio.enterLobby(game.selectedCharacter.value)`
- `App.vue:1492`: `audio.enterMatch()` → `audio.enterMatch(game.selectedCharacter.value)`
- `App.vue:1515`: `audio.enterMatch()` → `audio.enterMatch(game.selectedCharacter.value)`
- `App.vue:1602`: `audio.enterFinished()` → `audio.enterFinished(game.selectedCharacter.value)`
- `App.vue:2093`: `audio.enterLobby()` → `audio.enterLobby(game.selectedCharacter.value)`

Before editing, re-read each surrounding block with the file's current line numbers (this task is the first to touch `App.vue`, so the numbers above match — but confirm locally since earlier tasks in this plan don't modify this file).

- [ ] **Step 5: Pass `character` to `GameOverOverlay`**

In `packages/client/src/components/GameOverOverlay.vue`, add `character` to the props type (`GameOverOverlay.vue:12-37`):

```ts
const props = defineProps<{
  winner: PlayerId | 'draw' | null
  myPlayerId: PlayerId | null
  roomId: string | null
  character: CharacterType
  deathCauses?: Partial<Record<PlayerId, DeathCause>> | null
  ...
```

(Insert the `character: CharacterType` line; leave every other prop as-is.) Add the import at the top of the file, alongside the existing `import type { DeathCause, PlayerId } from '@wheee/shared'`:

```ts
import type { DeathCause, PlayerId, CharacterType } from '@wheee/shared'
```

Add a computed accent just below the existing `resultClass` computed (`GameOverOverlay.vue:131-136`):

```ts
const cropAccent = computed(() => CROP_THEME[props.character].resultAccent)
```

and import it at the top of the file alongside the other lib imports:

```ts
import { CROP_THEME } from '../lib/cropTheme'
```

- [ ] **Step 6: Apply the accent in the template and CSS**

In the template (`GameOverOverlay.vue:197`), bind the accent as a CSS custom property on the existing card element:

```html
    <div class="gameover-card" :class="resultClass" :style="{ '--crop-accent': cropAccent }">
```

Add a new rule right after the existing state-specific border rules (after `.gameover-card.spectator { ... }`, `GameOverOverlay.vue:331-334`):

```css
.gameover-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--crop-accent, transparent);
  pointer-events: none;
}
```

`.gameover-card` already has `overflow: hidden` and `border-radius: 24px` (`GameOverOverlay.vue:299,307`), so the parent clips this strip's corners to match the card — no radius needed on the pseudo-element itself. This is purely additive — a thin accent strip along the top edge — and doesn't touch the existing win/lose/draw/spectator border-color or box-shadow rules.

- [ ] **Step 7: Pass `character` from `App.vue`'s `<GameOverOverlay>` usage**

`App.vue:2471-2493` currently is:

```html
  <GameOverOverlay
    v-if="showGameOver"
    :winner="game.winner.value"
    :my-player-id="game.myPlayerId.value"
    :room-id="lastRoomId"
    :death-causes="game.deathCauses.value"
    ...
```

Add the new prop right after `:room-id`:

```html
  <GameOverOverlay
    v-if="showGameOver"
    :winner="game.winner.value"
    :my-player-id="game.myPlayerId.value"
    :room-id="lastRoomId"
    :character="game.selectedCharacter.value"
    :death-causes="game.deathCauses.value"
    ...
```

- [ ] **Step 8: Type-check**

Run (from `packages/client/`): `bunx vue-tsc -b --noEmit`
Expected: no new errors.

- [ ] **Step 9: Run the full client test suite**

Run: `bun test`
Expected: all tests pass, output pristine (this task adds no new automated tests, so the count is unchanged from Task 9).

- [ ] **Step 10: Manual verification**

Run the app locally against a dev server. For each of the three crops (pick each in the lobby, in a fresh browser profile or after clearing site storage between runs so the persisted-preference precedence doesn't mask the change):

1. Start a practice/bot match and confirm the sky's calm-state color and the terrain's palette carry a subtle, crop-distinct tint (wheat should look identical to `main` before this feature; rice and corn should look subtly different from wheat and from each other).
2. Let the match end and confirm `GameOverOverlay`'s card shows a thin accent-colored strip along its top edge, colored per the crop that was played, on win, loss, and draw.
3. Confirm no wind/rain/lightning particle or line color changed for any crop (these must look identical across all three).

- [ ] **Step 11: Commit**

```bash
git add packages/client/src/App.vue packages/client/src/components/GameOverOverlay.vue
git commit -m "Wire per-crop theme into the arena, audio, and result screen

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Run `bun test` from `packages/server/` — all pass.
- [ ] Run `bun test` from `packages/client/` — all pass.
- [ ] Run `bunx vue-tsc -b --noEmit` from `packages/client/` — no errors.
- [ ] Re-run the Task 2 `curl` checks and the Task 10 manual walkthrough once more end to end (fresh browser profile, three crops, geo header spoofed via `x-country-code` for the suggestion, then an explicit in-lobby crop change to confirm the saved choice survives a reload and overrides the suggestion next time).
