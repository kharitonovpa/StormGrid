# Discord Rich Presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a text-only Discord Rich Presence status ("Looking for an opponent", "In a match", ...) on wheee's Discord Activity, updated as the player's game phase changes, in EN/RU.

**Architecture:** A new pure module (`discordPresence.ts`) maps the client's existing `ClientPhase` enum to a small `PresenceBucket` set and holds the EN/RU text for each bucket. `discordBridge.ts` (the existing SDK-free bridge) gains a deduplicating `setDiscordPresence()` entry point, mirroring its existing `shareDiscordLink`/`onDiscordParticipantCount` pattern. `discord.ts` (the Discord `PlatformAdapter`) registers the actual `sdk.commands.setActivity` call as a handle, gated on the existing `authed` check. `App.vue` wires a `watch()` on `game.phase` to call it.

**Tech Stack:** Vue 3 (`<script setup>`), TypeScript, `@discord/embedded-app-sdk` 2.5.0, `bun:test` for unit tests.

## Global Constraints

- Text-only status for this iteration — no join button (no `party`/`secrets`, no `ACTIVITY_JOIN` subscription). See design doc "Вне скоупа".
- No opponent name, score, or round number in the status text — generic phrasing only.
- `type: 0` (Playing) on every `setActivity` call; the top line ("Playing wheee") is drawn by Discord from the app itself and is not settable via `SetActivityInput` (confirmed against `@discord/embedded-app-sdk@2.5.0`'s `output/commands/setActivity.d.ts` — `name` is not part of the input's picked keys).
- `setActivity` calls only fire after `authed` is true in `discord.ts # init()` — the same gate already used for `userSettingsGetLocale()` / `getInstanceConnectedParticipants()`, since these RPC commands don't respond before `authenticate()`.
- New OAuth scope `rpc.activities.write` added to the existing `authorize()` scope array — additive, no other auth-flow change.
- No automated test can exercise the real Discord SDK call — that path is verified manually (Task 5), matching how the rest of `discord.ts` is already covered (there is no existing test file for `discord.ts`).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `packages/client/src/lib/platform/discordPresence.ts` | Create | Pure logic: `ClientPhase` → `PresenceBucket` mapping, EN/RU text lookup with locale fallback. No SDK, no Vue — importable and testable standalone. |
| `packages/client/src/lib/platform/__tests__/discordPresence.test.ts` | Create | Unit tests for the above. |
| `packages/client/src/lib/platform/discordBridge.ts` | Modify | Add `PresenceBucket` to `DiscordHandles`, add exported `setDiscordPresence()` with dedup-by-last-bucket. |
| `packages/client/src/lib/platform/__tests__/discordBridge.test.ts` | Create | Unit tests for the dedup behavior (no SDK involved — this file is already SDK-free). |
| `packages/client/src/lib/platform/discord.ts` | Modify | Add `rpc.activities.write` scope; register the `setPresence` handle that calls `sdk.commands.setActivity`. |
| `packages/client/src/App.vue` | Modify | Import `setDiscordPresence` + `presenceBucketForPhase`; add a top-level `watch()` on `game.phase`. |

---

### Task 1: `discordPresence.ts` — phase mapping and localized text

**Files:**
- Create: `packages/client/src/lib/platform/discordPresence.ts`
- Test: `packages/client/src/lib/platform/__tests__/discordPresence.test.ts`

**Interfaces:**
- Consumes: `ClientPhase` type from `packages/client/src/composables/useGameState.ts` (values: `'lobby' | 'queue' | 'friend_wait' | 'forecast' | 'ticking' | 'weather' | 'finished' | 'watching' | 'watch_queue' | 'architect_queue'`).
- Produces:
  - `export type PresenceBucket = 'lobby' | 'queue' | 'waiting_friend' | 'in_match' | 'watching'`
  - `export function presenceBucketForPhase(phase: ClientPhase): PresenceBucket | null`
  - `export function presenceText(locale: string, bucket: PresenceBucket): string`

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/lib/platform/__tests__/discordPresence.test.ts
import { describe, it, expect } from 'bun:test'
import { presenceBucketForPhase, presenceText } from '../discordPresence.js'
import type { ClientPhase } from '../../../composables/useGameState.js'

describe('presenceBucketForPhase', () => {
  const cases: Array<[ClientPhase, ReturnType<typeof presenceBucketForPhase>]> = [
    ['lobby', 'lobby'],
    ['queue', 'queue'],
    ['architect_queue', 'queue'],
    ['friend_wait', 'waiting_friend'],
    ['forecast', 'in_match'],
    ['ticking', 'in_match'],
    ['weather', 'in_match'],
    ['finished', null],
    ['watching', 'watching'],
    ['watch_queue', 'watching'],
  ]

  for (const [phase, expected] of cases) {
    it(`maps '${phase}' to ${expected === null ? 'null' : `'${expected}'`}`, () => {
      expect(presenceBucketForPhase(phase)).toBe(expected)
    })
  }
})

describe('presenceText', () => {
  it('returns the Russian text for a known ru bucket', () => {
    expect(presenceText('ru', 'queue')).toBe('Ищет соперника')
  })

  it('returns the English text for a known en bucket', () => {
    expect(presenceText('en', 'queue')).toBe('Looking for an opponent')
  })

  it('falls back to English for a locale outside the dictionary', () => {
    expect(presenceText('fr', 'lobby')).toBe(presenceText('en', 'lobby'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/client && bun test src/lib/platform/__tests__/discordPresence.test.ts`
Expected: FAIL — `discordPresence.js` (or `.ts`) does not exist / cannot be resolved.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/client/src/lib/platform/discordPresence.ts
import type { ClientPhase } from '../../composables/useGameState'

/**
 * Coarse buckets shown in the Discord Rich Presence card. Several
 * `ClientPhase` values fold into one bucket on purpose — `forecast` /
 * `ticking` / `weather` are sub-phases of a single match and would otherwise
 * bounce `setActivity` on every tick.
 */
export type PresenceBucket = 'lobby' | 'queue' | 'waiting_friend' | 'in_match' | 'watching'

const PHASE_TO_BUCKET: Record<ClientPhase, PresenceBucket | null> = {
  lobby: 'lobby',
  queue: 'queue',
  architect_queue: 'queue',
  friend_wait: 'waiting_friend',
  forecast: 'in_match',
  ticking: 'in_match',
  weather: 'in_match',
  // `finished` is brief (seconds) and always followed by another phase —
  // leave the presence card on whatever it last showed rather than churn it.
  finished: null,
  watching: 'watching',
  watch_queue: 'watching',
}

export function presenceBucketForPhase(phase: ClientPhase): PresenceBucket | null {
  return PHASE_TO_BUCKET[phase]
}

const PRESENCE_TEXT: Record<'en' | 'ru', Record<PresenceBucket, string>> = {
  en: {
    lobby: 'In the lobby',
    queue: 'Looking for an opponent',
    waiting_friend: 'Waiting for a friend',
    in_match: 'In a match',
    watching: 'Watching a replay',
  },
  ru: {
    lobby: 'В лобби',
    queue: 'Ищет соперника',
    waiting_friend: 'Ждёт друга',
    in_match: 'В матче',
    watching: 'Смотрит повтор',
  },
}

/**
 * `locale` comes from the Discord SDK's `userSettingsGetLocale()`, which
 * returns an arbitrary BCP-47 tag (`en-US`, `pt-BR`, ...) — callers are
 * expected to have already taken the language subtag (`locale.split('-')[0]`)
 * the way `discord.ts` already does for the rest of the adapter. Anything
 * outside `{en, ru}` falls back to English rather than throwing.
 */
export function presenceText(locale: string, bucket: PresenceBucket): string {
  const dict = locale === 'ru' ? PRESENCE_TEXT.ru : PRESENCE_TEXT.en
  return dict[bucket]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/client && bun test src/lib/platform/__tests__/discordPresence.test.ts`
Expected: PASS — 13 tests (10 mapping cases + 3 text cases).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/lib/platform/discordPresence.ts packages/client/src/lib/platform/__tests__/discordPresence.test.ts
git commit -m "Add Discord presence phase-to-text mapping

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `discordBridge.ts` — deduplicating presence entry point

**Files:**
- Modify: `packages/client/src/lib/platform/discordBridge.ts`
- Test: `packages/client/src/lib/platform/__tests__/discordBridge.test.ts`

**Interfaces:**
- Consumes: `PresenceBucket` from `discordPresence.ts` (Task 1).
- Produces:
  - `DiscordHandles` type gains `setPresence: (bucket: PresenceBucket) => void`.
  - `export function setDiscordPresence(bucket: PresenceBucket | null): void` — no-ops if `bucket` is `null`, no-ops if no handles are registered yet, forwards to `handles.setPresence(bucket)` only when `bucket` differs from the last bucket actually forwarded.

**Important:** `discordBridge.ts` keeps its live handles in module-level state (the existing `let handles: DiscordHandles | null = null`). The dedup state added in this task is also module-level, so **the "no handles registered yet" test in Step 1 below must run before any test in this file calls `registerDiscordHandles`** — declare it first in the file, matching `bun:test`'s in-order execution within a `describe` block.

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/lib/platform/__tests__/discordBridge.test.ts
import { describe, it, expect, mock } from 'bun:test'
import { registerDiscordHandles, setDiscordPresence } from '../discordBridge.js'
import type { DiscordHandles } from '../discordBridge.js'

function makeHandles(setPresence: DiscordHandles['setPresence']): DiscordHandles {
  return {
    instanceCode: null,
    customId: null,
    referrerId: null,
    guildId: null,
    shareLink: async () => false,
    onParticipantCount: () => () => {},
    setPresence,
  }
}

describe('setDiscordPresence', () => {
  // Must run first: no registerDiscordHandles call has happened yet anywhere
  // in this process at this point in the file.
  it('no-ops before any handles are registered', () => {
    expect(() => setDiscordPresence('lobby')).not.toThrow()
  })

  it('does nothing for a null bucket', () => {
    const setPresence = mock(() => {})
    registerDiscordHandles(makeHandles(setPresence))
    setDiscordPresence(null)
    expect(setPresence).not.toHaveBeenCalled()
  })

  it('forwards the first bucket after registration', () => {
    const setPresence = mock(() => {})
    registerDiscordHandles(makeHandles(setPresence))
    setDiscordPresence('queue')
    expect(setPresence).toHaveBeenCalledTimes(1)
    expect(setPresence).toHaveBeenCalledWith('queue')
  })

  it('does not repeat the same bucket twice in a row', () => {
    const setPresence = mock(() => {})
    registerDiscordHandles(makeHandles(setPresence))
    setDiscordPresence('in_match')
    setDiscordPresence('in_match')
    expect(setPresence).toHaveBeenCalledTimes(1)
  })

  it('forwards a genuinely new bucket', () => {
    const setPresence = mock(() => {})
    registerDiscordHandles(makeHandles(setPresence))
    setDiscordPresence('queue')
    setDiscordPresence('in_match')
    expect(setPresence).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/client && bun test src/lib/platform/__tests__/discordBridge.test.ts`
Expected: FAIL — `setDiscordPresence` is not exported / `DiscordHandles` has no `setPresence`.

- [ ] **Step 3: Write minimal implementation**

Modify `packages/client/src/lib/platform/discordBridge.ts`:

```ts
// add near the top, with the other imports (there are none currently — this is the first)
import type { PresenceBucket } from './discordPresence'
```

```ts
// extend the existing DiscordHandles type — add one field after onParticipantCount
export type DiscordHandles = {
  instanceCode: string | null
  customId: string | null
  referrerId: string | null
  guildId: string | null
  shareLink: (code: string, message: string) => Promise<boolean>
  onParticipantCount: (cb: (count: number) => void) => () => void
  setPresence: (bucket: PresenceBucket) => void
}
```

```ts
// add near the other module-level state (`let handles: DiscordHandles | null = null`)
let lastSentBucket: PresenceBucket | null = null
```

```ts
// add at the end of the file, alongside the other exported functions
/**
 * Update the Discord Rich Presence card. `null` (the `finished` phase has no
 * bucket of its own — see discordPresence.ts) leaves the card as it was.
 * Deduplicates against the last bucket actually sent so a run of ticks
 * within the same match phase doesn't call `setActivity` repeatedly.
 */
export function setDiscordPresence(bucket: PresenceBucket | null): void {
  if (bucket === null) return
  if (bucket === lastSentBucket) return
  if (!handles) return
  lastSentBucket = bucket
  handles.setPresence(bucket)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/client && bun test src/lib/platform/__tests__/discordBridge.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/lib/platform/discordBridge.ts packages/client/src/lib/platform/__tests__/discordBridge.test.ts
git commit -m "Add deduplicating Discord presence bridge

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `discord.ts` — wire the real `setActivity` call

**Files:**
- Modify: `packages/client/src/lib/platform/discord.ts`

**Interfaces:**
- Consumes: `presenceText` from `discordPresence.ts` (Task 1); `PresenceBucket` type (Task 1); `registerDiscordHandles` shape now requiring `setPresence` (Task 2).
- Produces: nothing new consumed by later tasks beyond the already-existing `registerDiscordHandles` call now being complete.

No automated test — this task only wires a real SDK call, and no test file exists for `discord.ts` in this codebase today (verified: none). Verification is mechanical (type-check) here and manual in Task 5.

- [ ] **Step 1: Add the new OAuth scope**

In `packages/client/src/lib/platform/discord.ts`, inside `loginWithRetry()`:

```ts
;({ code } = await sdk.commands.authorize({
  client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
  response_type: 'code',
  state: '',
  prompt: 'none',
  scope: ['identify', 'applications.commands', 'rpc.activities.write'],
}))
```

(This replaces the existing `scope: ['identify', 'applications.commands']` array — one line changed.)

- [ ] **Step 2: Import the presence helper**

Add to the top of the file, with the other local imports:

```ts
import { presenceText } from './discordPresence'
import type { PresenceBucket } from './discordPresence'
```

- [ ] **Step 3: Register the `setPresence` handle**

In the `registerDiscordHandles({ ... })` call inside `init()`, add a new field after `onParticipantCount`:

```ts
registerDiscordHandles({
  instanceCode: `dc-${sdk.instanceId}`.toUpperCase(),
  customId: cleanLaunchParam(sdk.customId),
  referrerId: cleanLaunchParam(sdk.referrerId),
  guildId: sdk.guildId,
  shareLink: async (code, message) => {
    try {
      const { success } = await sdk.commands.shareLink({ message, custom_id: code })
      return success
    } catch { return false }
  },
  onParticipantCount: (cb) => {
    this.participantCbs.add(cb)
    cb(this.participantCount)
    return () => this.participantCbs.delete(cb)
  },
  setPresence: (bucket: PresenceBucket) => {
    // Presence is a nice-to-have, not a critical path — swallow failures
    // silently rather than surfacing them anywhere a player would see.
    sdk.commands.setActivity({
      activity: { type: 0, details: presenceText(this.locale, bucket) },
    }).catch(() => {})
  },
})
```

**Note:** this whole `registerDiscordHandles` call already runs only inside the `if (authed) { ... }` block's sibling code path — check the current file: it actually sits *after* that block, unconditionally. Re-read the surrounding code before editing: `registerDiscordHandles` must move inside (or stay guarded by) the `if (authed)` block so `setPresence` is never registered — and therefore never callable — before `authenticate()` has succeeded, matching the Global Constraints gate. Concretely: the existing code has `registerDiscordHandles({...})` as a top-level call in `init()`, unconditional. Wrap it:

```ts
if (authed) {
  // ... existing locale + participants code stays here ...

  registerDiscordHandles({
    instanceCode: `dc-${sdk.instanceId}`.toUpperCase(),
    customId: cleanLaunchParam(sdk.customId),
    referrerId: cleanLaunchParam(sdk.referrerId),
    guildId: sdk.guildId,
    shareLink: async (code, message) => {
      try {
        const { success } = await sdk.commands.shareLink({ message, custom_id: code })
        return success
      } catch { return false }
    },
    onParticipantCount: (cb) => {
      this.participantCbs.add(cb)
      cb(this.participantCount)
      return () => this.participantCbs.delete(cb)
    },
    setPresence: (bucket: PresenceBucket) => {
      sdk.commands.setActivity({
        activity: { type: 0, details: presenceText(this.locale, bucket) },
      }).catch(() => {})
    },
  })
}
```

This is a real behavior change beyond adding presence: `shareLink`/`instanceCode`/`customId`/`referrerId`/`guildId` handles become unavailable whenever `authed` is false (auth failed → anonymous mode). That is the correct behavior per the Global Constraints gate (all of these are equally RPC-dependent), but it is a slightly bigger diff than "just add one field" — call this out explicitly in the commit message.

- [ ] **Step 4: Type-check**

Run: `cd packages/client && bun run build`
Expected: succeeds (`vue-tsc -b && vite build`) — no type errors. This is the only mechanical check available for this file; it does not exercise the Discord SDK call itself (Task 5 does that).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/lib/platform/discord.ts
git commit -m "Wire Discord Rich Presence into the platform adapter

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `App.vue` — trigger presence updates from game phase

**Files:**
- Modify: `packages/client/src/App.vue`

**Interfaces:**
- Consumes: `presenceBucketForPhase` (Task 1), `setDiscordPresence` (Task 2), the existing `game.phase` ref from `useGameState()` (already in scope as `game`, per the existing `const game = useGameState()` at line 57).

No automated test — no test file exists for `App.vue` in this codebase today. Verification is the type-check in Step 2 and the manual pass in Task 5.

- [ ] **Step 1: Add the import and the watch**

In `packages/client/src/App.vue`, extend the existing discord-bridge import (currently `import { getDiscordInstanceCode, onDiscordParticipantCount, shareDiscordLink } from './lib/platform/discordBridge'`):

```ts
import { getDiscordInstanceCode, onDiscordParticipantCount, shareDiscordLink, setDiscordPresence } from './lib/platform/discordBridge'
import { presenceBucketForPhase } from './lib/platform/discordPresence'
```

Add a new top-level `watch()` near the other top-level `watch()` calls (e.g. right after the one at line 82, `watch(() => game.actionSubmitted.value, ...)`):

```ts
watch(() => game.phase.value, (phase) => {
  setDiscordPresence(presenceBucketForPhase(phase))
}, { immediate: true })
```

`setDiscordPresence` is already a safe no-op on every non-Discord platform (Task 2 — it does nothing until `registerDiscordHandles` has been called, which only ever happens from `discord.ts`), so this watch needs no `platform.type === 'discord'` guard.

- [ ] **Step 2: Type-check**

Run: `cd packages/client && bun run build`
Expected: succeeds, no type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/App.vue
git commit -m "Update Discord presence on game phase changes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Manual verification against a live Discord client

**Files:** none — this task produces no diff, only a pass/fail observation. If it fails, it produces a bug report to act on before considering the feature done.

**Prerequisites:** the dev loop from `marketing/DISCORD_LAUNCH_CHECKLIST.md` §5 — a dev Discord application, `cloudflared tunnel` pointed at the local Vite dev server, `VITE_PLATFORM=discord VITE_DISCORD_CLIENT_ID=<dev app client id> bun run dev:client`, plus `bun run dev:server`. Two Discord accounts that are friends with each other (or in a shared small test server), one of them running the tunneled dev build.

- [ ] **Step 1: Confirm the scope was actually granted**

Launch the Activity as the first account. If `authorize()` fails or the user declines the new-scope consent prompt, the whole `if (authed)` block (Task 3) — not just presence — degrades to anonymous mode. Confirm login still succeeds with `rpc.activities.write` in the requested scopes before checking anything presence-specific.

- [ ] **Step 2: Walk every phase and check the second account's profile card**

On the second account, open the first account's Discord profile (or hover their name) to see their Rich Presence card. For each transition below, trigger it on account 1 and confirm the exact text appears on account 2's view within a few seconds:

| Action on account 1 | Expected card text (EN) | Expected card text (RU, if account 1's Discord client locale is Russian) |
|---|---|---|
| Land in the lobby | In the lobby | В лобби |
| Tap Play (queue) | Looking for an opponent | Ищет соперника |
| Cancel, invite a friend instead (friend_wait) | Waiting for a friend | Ждёт друга |
| Match starts (forecast/ticking/weather) | In a match | В матче |
| Match ends, sit on the game-over screen | still "In a match" (unchanged — `finished` sends no update, per Task 1) | В матче |
| Back to lobby | In the lobby | В лобби |
| Watch a replay | Watching a replay | Смотрит повтор |

- [ ] **Step 3: Check both locales**

Repeat the "queue" step with account 1's Discord client language set to Russian, then to English (Discord Settings → Language), confirming the card text switches accordingly. This exercises `presenceText`'s locale-splitting against a real `userSettingsGetLocale()` return value, not just the unit test's hardcoded `'ru'`/`'en'` inputs.

- [ ] **Step 4: Record the result**

If every row matched: the feature is done, nothing further to commit (Tasks 1–4 already shipped the code). If any row didn't match, note exactly which transition/text was wrong — that becomes a new bug-fix task on top of this plan, not a reason to touch Tasks 1–4's already-passing unit tests.

---

## Self-Review Notes

- **Spec coverage:** phase→bucket table (Task 1), EN/RU text + locale fallback (Task 1), `rpc.activities.write` scope (Task 3), `authed` gate (Task 3), dedup-on-bucket-change (Task 2), `finished` sends no update (Task 1 + verified in Task 5's table), manual dev-loop verification (Task 5). All design-doc sections have a task.
- **Type consistency:** `PresenceBucket` defined once in Task 1, imported (never redefined) in Tasks 2–4. `presenceText(locale, bucket)` signature used identically in Task 1's test and Task 3's call site. `DiscordHandles.setPresence` signature (`(bucket: PresenceBucket) => void`) matches the object literal built in Task 3.
- **Scope check:** single subsystem (Discord presence only), five tasks, no decomposition needed.
