# Crop identity — visual/audio theming + geo suggestion — design

Date: 2026-09-01

## Problem

The crop pick in the lobby (`wheat`/`rice`/`corn`, `CHARACTERS` in
`packages/shared/src/constants.ts:20`) is 100% cosmetic: it only swaps the 3D model
(`MODEL_PATHS`, `packages/client/src/lib/models.ts:7-11`) and, as of this session's
earlier fix, persists across reloads (`packages/client/src/lib/characterPreference.ts`).
No engine module reads `player.character` for any rule
(`packages/server/src/engine/{tick,wind,rain,lightning,forecast,bot}.ts`), and no
surface outside the lobby preview reflects it at all. The choice was originally meant
to carry a real-world regional identity (wheat/rice/corn ↔ Europe/Asia/Americas
agriculture), but nothing in the codebase expresses that — visually or mechanically.

## Goal

Give each crop a consistent decorative identity across the app, and suggest a crop to
first-time players based on where they're connecting from — without touching match
balance.

1. A crop's regional character (rice ~ Asia, wheat ~ Europe, corn ~ Americas) shows up
   subtly in the arena's ambient look, the post-match result screen, and (as
   architecture only, no assets yet) the music layer.
2. A first-time player (no saved preference) sees the lobby crop card pre-selected
   based on their connection's detected country — still freely changeable before the
   match starts.
3. A returning player's saved preference always wins; the suggestion never overrides
   an explicit choice.

## Non-goals

- No renaming of the lobby UI to "America/Europe/Asia" — cards stay wheat/rice/corn.
  The regional framing decided in this design is a codebase-internal detail (a naming
  and theming approach), not a decision to relabel player-facing UI.
- No gameplay/balance effect. Both players remain fully symmetric — the engine's
  sign-mirroring math (`board.ts:88-95`) and the bot's simulation (`bot.ts`) are
  unaffected; `player.character` still isn't read by any rule.
- No new audio assets. `audio.ts` gets a swap-by-crop *mechanism*; actual regional
  tracks are a follow-up once files exist.
- No recoloring of the *functional* weather-effect indicators — wind, rain, and
  lightning particle/line colors (`wind.ts`, `rain.ts`, `lightning.ts`) stay universal.
  They carry gameplay-relevant signal (direction, imminent danger); reskinning them
  per crop risks hurting legibility in a competitive match. Theming is scoped to
  decorative layers only: ambient sky/lighting mood, terrain palette accent, the
  result screen, and music.
- No new GeoIP dependency/database. The server already derives a country code from
  request headers (`detectCountry()`, `packages/server/src/index.ts:830-845`) for the
  nameplate flag emoji (`Room.ts:322`) — this design reuses that signal rather than
  adding MaxMind/GeoLite or any IP-lookup library.

## Design

### Region → crop mapping (server)

New file `packages/server/src/regionCrop.ts`:

- A static `Record<string, CharacterType>`-backed lookup (or a small
  country→continent table plus a continent→crop map) covering ISO country codes:
  Asia → `rice`, Europe → `wheat`, Americas → `corn`. Any country outside those three
  buckets, and any unresolvable/unknown code, falls back to `wheat` — matching the
  existing default so nobody is surprised or excluded.
- Exported as `countryToCrop(countryCode: string | null): CharacterType`, pure and
  synchronous — easy to unit test standalone.

### Suggestion endpoint (server)

- New route `GET /api/character-suggestion` in `packages/server/src/index.ts`,
  registered alongside the existing `/api/*` routes so it inherits the existing CORS
  and rate-limit middleware (`index.ts:231-244`).
- Handler: `countryToCrop(detectCountry(c.req.raw.headers))` → `{ character }` JSON.
  Reuses `detectCountry()` verbatim (no changes to it) — same header precedence
  (`cf-ipcountry` → `x-country-code` → `Accept-Language` fallback) already trusted for
  the flag emoji.

### Applying the suggestion (client)

- `characterPreference.ts`: `loadCharacterPreference()` changes return type from
  `CharacterType` to `CharacterType | null` (`null` = nothing was ever saved), so
  callers can distinguish "never played" from "explicitly picked wheat".
- `main.ts`: `useGameState()` runs synchronously during `App.vue`'s `setup()`
  (`App.vue:97`), so the suggestion must be resolved *before* `createApp(App).mount()`
  — same constraint `initPlatform()` already satisfies for `storage.ts`. Run both
  concurrently: `Promise.all([initPlatform(), fetchSuggestedCharacter()])`, where
  `fetchSuggestedCharacter()` wraps `fetch('/api/character-suggestion')` in an
  ~800 ms timeout (`AbortController`) and a `try/catch` that resolves to `null` on
  any failure (timeout, network error, malformed response) — it must never throw and
  never meaningfully delay boot beyond its own timeout. The resolved value is stored
  in a small module-level `getSuggestedCharacter(): CharacterType | null` accessor
  (mirrors how `storage.ts` exposes `cache` post-hydration), read once by
  `useGameState.ts` below.
- `useGameState.ts:33`: `selectedCharacter = ref(loadCharacterPreference() ??
  getSuggestedCharacter() ?? 'wheat')` — the suggestion is consulted only when there
  is no persisted preference at all; a returning player's saved crop is never
  disturbed. This resolves once at composable construction, same as today — no new
  reactivity/race needed against `LobbyOverlay.vue`'s mount-time sync
  (`LobbyOverlay.vue:152`), since the value is already final by the time `App.vue`
  constructs `useGameState()` and passes it down.

### Arena theming (client)

New module `packages/client/src/lib/cropTheme.ts`:

```ts
export const CROP_THEME: Record<CharacterType, {
  skyTint: number       // base THREE.Color hex for calm-sky / ambient light warmth
  paletteAccent: number // subtle hue-shift accent blended into terrain colors
  resultAccent: string  // CSS color for the result-screen motif
}> = { wheat: {...}, rice: {...}, corn: {...} }
```

Threaded from `App.vue` (where `game.selectedCharacter` is already in scope) into:

- `paintColors()` (`packages/client/src/lib/terrain.ts:131-193`) — takes an optional
  accent color blended a small amount into the existing procedural grass/mud/rock
  palette. Falls back to today's untinted output if no accent is passed, so terrain
  rendering for e.g. replays/watchers with unknown character stays unaffected.
- The calm-sky base color consumed by `createStormSystem` (`storm.ts:8-10`) — only
  the resting-state tint, not the storm/lightning gradient the system lerps toward
  during weather.

Wind, rain, and lightning particle systems are explicitly untouched (see Non-goals).

### Result screen theming (client)

- `GameOverOverlay.vue` gains a `character: CharacterType` prop (passed from
  `App.vue`, same source as above).
- A computed `cropAccent` reads `CROP_THEME[character].resultAccent` and feeds a CSS
  custom property already scoped to the overlay's existing win/lose/draw styling
  (`resultClass`, `GameOverOverlay.vue:131-136`) — additive, not a restructure of the
  component.

### Audio — architecture only (client)

- `audio.ts`: `def(id, character?)` gains an optional crop parameter. A new
  `MUSIC_TRACKS: Partial<Record<CharacterType, string>>` map is consulted when
  resolving the `lobby-music`/`match-music` source; if no entry exists for a crop
  (true today, for all three), the existing fixed `${BASE_URL}sounds/${id}.mp3` path
  is used unchanged.
- `enterLobby()`/`enterMatch()` (`audio.ts:283-303`) accept an optional character
  argument and forward it to `def()`. Callers in `App.vue` pass
  `game.selectedCharacter.value`.
- No track files are added in this pass. This lands as dead-until-populated
  plumbing, verified by a test asserting the fallback path is used when a crop has no
  configured track.

## Testing

- `regionCrop.test.ts` (new, server): `countryToCrop` for a representative country in
  each bucket, plus unknown/`null`/empty-string → `wheat`.
- `characterPreference.test.ts` (update): `loadCharacterPreference()` returns `null`
  (not `'wheat'`) when nothing is stored; still returns the saved value on a
  round-trip; still falls back on corrupted data (falls back to `null`, since
  "corrupted" and "absent" are the same "nothing usable" case — the `'wheat'` default
  moves to the `useGameState.ts` call site).
- `useGameState` (update existing persistence tests + new case): with no stored
  preference and a stubbed suggestion, `selectedCharacter` initializes to the
  suggestion; with a stored preference present, the suggestion is ignored even if
  different.
- `audio.ts`: a crop with no `MUSIC_TRACKS` entry resolves to the existing default
  path (proves the fallback, since no real per-crop files exist yet).
- Manual: fresh browser profile (no storage) with a spoofed `cf-ipcountry`/
  `x-country-code` header hitting `/api/character-suggestion` directly → confirms the
  mapping end to end; reload after picking a different crop → confirms the saved
  choice, not the suggestion, wins.

## Files touched

- `packages/server/src/regionCrop.ts` — new, country→crop mapping.
- `packages/server/src/index.ts` — new `/api/character-suggestion` route.
- `packages/client/src/lib/characterPreference.ts` — `null`-when-unset semantics.
- `packages/client/src/main.ts` — suggestion fetch alongside `initPlatform()`.
- `packages/client/src/composables/useGameState.ts` — suggestion precedence at
  `selectedCharacter` init.
- `packages/client/src/lib/cropTheme.ts` — new, per-crop decorative theme table.
- `packages/client/src/lib/terrain.ts` — optional accent param on `paintColors()`.
- `packages/client/src/lib/storm.ts` — optional calm-sky tint override.
- `packages/client/src/App.vue` — thread `selectedCharacter`/theme into the scene,
  `GameOverOverlay`, and audio calls.
- `packages/client/src/components/GameOverOverlay.vue` — `character` prop, accent
  styling.
- `packages/client/src/lib/audio.ts` — `MUSIC_TRACKS` map, crop-aware `def()`/
  `enterLobby()`/`enterMatch()`.
- Tests alongside each of the above (`__tests__/` per package convention).
