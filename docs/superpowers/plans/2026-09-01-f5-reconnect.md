# F5 / Page-Reload Match Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player who reloads the page (F5) during a live match auto-reconnects into the same match instead of forfeiting it 30 seconds later, with a "Restoring match…" screen covering the gap and a native `beforeunload` warning before they navigate away mid-match.

**Architecture:** The server's reconnect protocol (`reconnectToken`, 30 s grace period, `reconnect:ok`/`reconnect:fail`) already works end-to-end for a socket that drops without a page reload. The only missing piece is persisting the token across a reload: a new small helper module (`sessionToken.ts`) wraps `sessionStorage` behind try/catch, `useGameSocket.ts` seeds its in-memory token from it at construction and keeps it in sync, and `App.vue` adds a boot-time "restoring match" screen plus a `beforeunload` prompt, both gated on existing phase state.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, `bun:test` for unit tests (no DOM/component-test harness exists in this codebase — App.vue changes are verified manually via the `run` skill, matching how the rest of App.vue is already tested today).

## Global Constraints

- Server-side files (`packages/server/src/Room.ts`, `RoomManager.ts`, `index.ts`) are NOT modified — the protocol they implement is already correct.
- Practice/tutorial matches keep their current no-grace-period behavior — do not touch `Room.ts:438-444` or any practice-specific path.
- Persistence uses `sessionStorage`, not the app's cross-platform persistent `storage.ts`/`localStorage` — no custom TTL/expiry logic on the client; the server's `reconnect:fail` is the sole authority on token validity.
- All storage access is wrapped in try/catch — a throwing/absent `sessionStorage` (private browsing, a partitioned embed) must degrade silently to today's no-persistence behavior, never crash the app.
- i18n additions follow the existing two-locale table in `packages/client/src/lib/i18n.ts` (`en` then `ru`, same key in both).
- Match existing code style: no comments restating the obvious; comments explain *why*, matching the density already in the touched files.

---

## File Structure

- **Create** `packages/client/src/composables/sessionToken.ts` — the only file with actual `sessionStorage` calls. Three tiny functions: `loadReconnectToken`, `saveReconnectToken`, `clearReconnectToken`. Isolated here specifically so it can be unit tested without `useGameSocket.ts`'s WebSocket/`location`-dependent import chain (see Task 1 note).
- **Create** `packages/client/src/composables/__tests__/sessionToken.test.ts` — unit tests for the above, following the `discordBridge.test.ts` pattern (`bun:test`, a fake backing store installed per test).
- **Modify** `packages/client/src/composables/useGameSocket.ts` — seed `reconnectToken` from storage at construction; route every place that mutates it through the persistence helpers.
- **Modify** `packages/client/src/App.vue` — new `restoringSession` state/computed + overlay markup, `beforeunload` listener, presence-suppression guard, one new i18n key.
- **Modify** `packages/client/src/lib/i18n.ts` — add `app.restoringSession` (en/ru).

---

### Task 1: `sessionToken.ts` persistence helper + unit tests

**Files:**
- Create: `packages/client/src/composables/sessionToken.ts`
- Test: `packages/client/src/composables/__tests__/sessionToken.test.ts`

**Interfaces:**
- Produces: `loadReconnectToken(): string | null`, `saveReconnectToken(token: string): void`, `clearReconnectToken(): void` — consumed by Task 2.

**Why a separate file:** `useGameSocket.ts` imports `WS_URL` from `../lib/config`, and `config.ts` reads `location.origin`/`location.protocol` at module scope — these throw under `bun test`'s non-DOM environment (verified: `location` is `undefined` there), so `useGameSocket.ts` cannot be imported directly in a unit test today. Keeping the storage logic in its own dependency-free file makes it testable in isolation; `useGameSocket.ts` itself stays covered by manual/`run`-skill verification, consistent with the rest of the file (it already has no automated tests).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/client/src/composables/__tests__/sessionToken.test.ts
import { describe, it, expect, beforeEach } from 'bun:test'
import { loadReconnectToken, saveReconnectToken, clearReconnectToken } from '../sessionToken.js'

function installFakeSessionStorage(): void {
  const store = new Map<string, string>()
  ;(globalThis as unknown as { sessionStorage: Storage }).sessionStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => store.clear(),
    key: () => null,
    get length() { return store.size },
  } as Storage
}

describe('reconnect token persistence', () => {
  beforeEach(() => {
    installFakeSessionStorage()
  })

  it('returns null when nothing has been saved', () => {
    expect(loadReconnectToken()).toBeNull()
  })

  it('round-trips a saved token', () => {
    saveReconnectToken('abc-123')
    expect(loadReconnectToken()).toBe('abc-123')
  })

  it('clears a saved token', () => {
    saveReconnectToken('abc-123')
    clearReconnectToken()
    expect(loadReconnectToken()).toBeNull()
  })

  it('degrades silently when sessionStorage is unavailable', () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() { throw new Error('blocked in this context') },
    })
    expect(() => saveReconnectToken('x')).not.toThrow()
    expect(loadReconnectToken()).toBeNull()
    expect(() => clearReconnectToken()).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/client && bun test src/composables/__tests__/sessionToken.test.ts`
Expected: FAIL — `Cannot find module '../sessionToken.js'` (or equivalent resolution error), since the module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/client/src/composables/sessionToken.ts
/**
 * Reconnect-token persistence, kept in its own file so it can be unit tested
 * without touching WebSocket/`location`-dependent machinery. Backed by
 * `sessionStorage`: it survives a same-tab reload (F5) but disappears when the
 * tab is actually closed — matching "closing the tab = leaving the match" and
 * needing no manual expiry. The server is the sole authority on whether a
 * token is still within its reconnect grace period (`reconnect:fail` covers
 * both "too late" and "match already gone").
 *
 * Every call is wrapped in try/catch: private browsing, or a storage-
 * partitioned embed (Discord Activity, Telegram, GamePush, Yandex), can make
 * touching `sessionStorage` throw. Any failure degrades silently to "no
 * persistence" — the behavior every platform already had before this file
 * existed.
 */

const STORAGE_KEY = 'wheee:reconnectToken'

export function loadReconnectToken(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function saveReconnectToken(token: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, token)
  } catch { /* private mode / partitioned storage */ }
}

export function clearReconnectToken(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch { /* private mode / partitioned storage */ }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/client && bun test src/composables/__tests__/sessionToken.test.ts`
Expected: PASS — 4 tests, 0 failures.

- [ ] **Step 5: Run the full client test suite to confirm no regressions**

Run: `cd packages/client && bun test`
Expected: all tests pass (baseline before this task: 18 pass / 0 fail across 2 files; expect 22 pass / 0 fail across 3 files after).

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/composables/sessionToken.ts packages/client/src/composables/__tests__/sessionToken.test.ts
git commit -m "Add sessionStorage-backed reconnect token persistence helper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Wire persistence into `useGameSocket.ts`

**Files:**
- Modify: `packages/client/src/composables/useGameSocket.ts:1-6` (imports), `:33` (initial ref), `:239-241` (`setReconnectToken`), `:262-272` (`disconnect`)

**Interfaces:**
- Consumes: `loadReconnectToken`, `saveReconnectToken`, `clearReconnectToken` from Task 1 (`./sessionToken`).
- Produces: no new exported symbols — `useGameSocket()`'s existing `reconnectToken` ref is now seeded from `sessionStorage` at construction, and every write to it (via `setReconnectToken` or `disconnect`) stays mirrored to storage. `createSocket().onopen`'s existing `if (reconnectToken.value) send({type:'reconnect', token: reconnectToken.value})` (line 82-84) needs no change — it already does the right thing once the ref is seeded correctly.

**Note on `reconnect:ok`:** the server does not issue a new token on reconnect (`Room.ts:490` — `reconnect:ok` has no `reconnectToken` field; `reconnectPlayer` never rotates `slot.reconnectToken`). So the token saved at `game:start` remains valid through any number of reconnects — there is nothing additional to persist when `reconnect:ok` arrives.

- [ ] **Step 1: Add the import**

In `packages/client/src/composables/useGameSocket.ts`, after the existing imports (after line 5, `import { getAuthToken } from './useAuth'`):

```typescript
import { loadReconnectToken, saveReconnectToken, clearReconnectToken } from './sessionToken'
```

- [ ] **Step 2: Seed the ref from storage**

Change line 33 from:

```typescript
  const reconnectToken = ref<string | null>(null)
```

to:

```typescript
  const reconnectToken = ref<string | null>(loadReconnectToken())
```

- [ ] **Step 3: Persist/clear on every write**

Change `setReconnectToken` (currently lines 239-241):

```typescript
  function setReconnectToken(token: string | null) {
    reconnectToken.value = token
  }
```

to:

```typescript
  function setReconnectToken(token: string | null) {
    reconnectToken.value = token
    if (token) saveReconnectToken(token)
    else clearReconnectToken()
  }
```

- [ ] **Step 4: Route `disconnect()` through the same setter**

In `disconnect()` (currently lines 262-272), change:

```typescript
  function disconnect() {
    intentionalClose = true
    reconnectToken.value = null
```

to:

```typescript
  function disconnect() {
    intentionalClose = true
    setReconnectToken(null)
```

- [ ] **Step 5: Type-check**

Run: `cd packages/client && bun run build`
Expected: `vue-tsc -b` passes with no new type errors (this also catches an import typo/path mistake in Step 1).

- [ ] **Step 6: Manual verification (no automated test — see Task 1 rationale)**

Run: `cd packages/client && bun run dev`, open the app, open devtools → Application → Session Storage.
1. Start a match (queue or practice against a bot — practice is fine for this check since we're only checking the ref/storage wiring, not the grace period).
2. Confirm a `wheee:reconnectToken` key appears in Session Storage once the match starts.
3. Let the match finish (or forfeit) and confirm the key disappears.

Expected: key appears on match start, disappears on match end. (Full F5-resume behavior is verified end-to-end in Task 3.)

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/composables/useGameSocket.ts
git commit -m "Seed and persist the reconnect token via sessionStorage

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: "Restoring match…" screen in `App.vue`

**Files:**
- Modify: `packages/client/src/App.vue:87-89` (presence watch), `:266-280` (message handler — `game:start`/`reconnect:fail`), `:355-360` (computed block), `:2233-2250` (template, new overlay block)
- Modify: `packages/client/src/lib/i18n.ts:154-159` (en), `:316-321` (ru)

**Interfaces:**
- Consumes: `socket.reconnectToken` (already returned by `useGameSocket()`, now seeded per Task 2), `game.phase` (`useGameState.ts`).
- Produces: `restoringSession: Ref<boolean>`, `showRestoringSession: ComputedRef<boolean>` — local to `App.vue`, nothing downstream depends on them yet.

- [ ] **Step 1: Add the i18n key**

In `packages/client/src/lib/i18n.ts`, English table, after line 155 (`'app.reconnecting': 'Reconnecting...',`):

```typescript
    'app.restoringSession': 'Restoring match…',
```

Russian table, after the equivalent line (`'app.reconnecting': 'Переподключение...',`):

```typescript
    'app.restoringSession': 'Восстанавливаем матч…',
```

- [ ] **Step 2: Add `restoringSession` state and `showRestoringSession` computed**

In `packages/client/src/App.vue`, right after the existing block that defines `showOpponentDisconnected` (currently lines 358-360):

```typescript
const showOpponentDisconnected = computed(() =>
  game.opponentDisconnected.value && isInGame.value,
)

/**
 * True from boot when a persisted reconnect token was found — i.e. this load
 * is a reload (F5) of a page that was mid-match, not a cold start. Cleared as
 * soon as the resume attempt resolves either way; `!isInGame.value` alone
 * would already flip this off on a *successful* resume (phase leaves 'lobby'),
 * but reconnect:fail sends phase back to 'lobby' too, so it needs an explicit
 * clear or this would get stuck showing "Restoring match…" forever.
 */
const restoringSession = ref(!!socket.reconnectToken.value)
const showRestoringSession = computed(() => restoringSession.value && !isInGame.value)
```

- [ ] **Step 3: Clear `restoringSession` on both resume outcomes**

In the same file's first message handler, change the existing `game:start` block (currently lines 266-277):

```typescript
  if (msg.type === 'game:start') {
    lastRoomId = msg.roomId
    socket.setReconnectToken(msg.reconnectToken)
```

to:

```typescript
  if (msg.type === 'game:start') {
    restoringSession.value = false
    lastRoomId = msg.roomId
    socket.setReconnectToken(msg.reconnectToken)
```

and the existing `reconnect:fail` block (currently lines 278-280):

```typescript
  if (msg.type === 'reconnect:fail') {
    socket.setReconnectToken(null)
  }
```

to:

```typescript
  if (msg.type === 'reconnect:fail') {
    restoringSession.value = false
    socket.setReconnectToken(null)
  }
  if (msg.type === 'reconnect:ok') {
    restoringSession.value = false
  }
```

- [ ] **Step 4: Suppress the boot-time presence flash while restoring**

Change the presence watch (currently lines 87-89):

```typescript
watch(() => game.phase.value, (phase) => {
  setDiscordPresence(presenceBucketForPhase(phase))
}, { immediate: true })
```

to:

```typescript
watch(() => game.phase.value, (phase) => {
  // Skip the immediate 'lobby' push while a reload might still resume into a
  // live match — reconnect:ok/reconnect:fail will drive a correct push once
  // the outcome is known (phase changes either way).
  if (restoringSession.value && phase === 'lobby') return
  setDiscordPresence(presenceBucketForPhase(phase))
}, { immediate: true })
```

This requires `restoringSession` to exist before this watch runs. Since Step 2 places its declaration after `showOpponentDisconnected` (line ~360), which is textually *after* this watch (line 87) — move the `restoringSession` declaration (just the `ref(...)` line, not `showRestoringSession`) up so it exists before line 87. Concretely: declare `const restoringSession = ref(!!socket.reconnectToken.value)` immediately after `const socket = useGameSocket()` (line 57), and leave only `const showRestoringSession = computed(...)` in the Step 2 location next to `showOpponentDisconnected`. Update Step 2's snippet accordingly: it now only adds the `showRestoringSession` computed there, not the `ref`.

- [ ] **Step 5: Add the overlay markup**

In the `<template>` block, right after the existing "Reconnecting overlay" `</Transition>` (currently line 2250):

```html
  <!-- Restoring a match after a page reload -->
  <Transition name="rc">
    <div v-if="showRestoringSession" class="reconnect-overlay">
      <div class="reconnect-card">
        <div class="reconnect-spinner" />
        <div class="reconnect-text">{{ t('app.restoringSession') }}</div>
      </div>
    </div>
  </Transition>
```

No new CSS — reuses `.reconnect-overlay`/`.reconnect-card`/`.reconnect-spinner`/`.reconnect-text`, already defined for the "Reconnecting overlay" block.

- [ ] **Step 6: Type-check**

Run: `cd packages/client && bun run build`
Expected: passes with no new errors.

- [ ] **Step 7: Manual end-to-end verification**

Use the `run` skill to launch the app (or `bun run dev` manually) and check both outcomes:

1. **Successful resume:** start a match (practice is fine), reload the page (F5 or browser refresh) while it's your turn. Expected: briefly see "Restoring match…" (or "Восстанавливаем матч…" if `?lang=ru` / browser locale is Russian), then the same board/turn state reappears, playable.
2. **Failed resume:** start a match, close the tab (or wait past 30 s after disconnecting without reloading) so the grace period lapses, then load the app fresh. Expected: lands cleanly in the lobby, no stuck spinner, no console errors.
3. Confirm Discord presence (if testing inside a Discord Activity, or by watching `setDiscordPresence` calls via a temporary `console.log`) does not flash "lobby" during a successful resume.

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/App.vue packages/client/src/lib/i18n.ts
git commit -m "Show a restoring-match screen and resume via persisted reconnect token

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `beforeunload` warning during a live match

**Files:**
- Modify: `packages/client/src/App.vue:1151` (new function, next to `preventContextMenu`), `:1981` (onMounted — register listener), `:2209-2210` (onUnmounted — remove listener)

**Interfaces:**
- Consumes: `isInGame` (already defined in Task 3's vicinity / pre-existing in `App.vue`).
- Produces: nothing consumed elsewhere — purely a browser-level side effect.

- [ ] **Step 1: Add the handler function**

In `packages/client/src/App.vue`, right after `function preventContextMenu(e: Event) { e.preventDefault() }` (currently line 1151):

```typescript
/** Only during an actual live turn — never in lobby, queue, or after game-over. */
function handleBeforeUnload(e: BeforeUnloadEvent) {
  if (isInGame.value) {
    e.preventDefault()
    e.returnValue = ''
  }
}
```

- [ ] **Step 2: Register it in `onMounted`**

Find `document.addEventListener('contextmenu', preventContextMenu)` inside the big `onMounted` block (currently line 1981) and add right after it:

```typescript
  document.addEventListener('contextmenu', preventContextMenu)
  window.addEventListener('beforeunload', handleBeforeUnload)
```

- [ ] **Step 3: Remove it in `onUnmounted`**

Find the matching cleanup lines inside `onUnmounted` (currently lines 2209-2210) and add the removal alongside:

```typescript
  document.removeEventListener('contextmenu', preventContextMenu)
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  window.removeEventListener('beforeunload', handleBeforeUnload)
```

- [ ] **Step 4: Type-check**

Run: `cd packages/client && bun run build`
Expected: passes with no new errors.

- [ ] **Step 5: Manual verification**

Use the `run` skill (or `bun run dev`) to launch the app:
1. Start a match, then try to close the tab or reload while it's mid-turn (`forecast`/`ticking`/`weather` phase). Expected: the browser's native "Leave site?" confirmation appears.
2. From the lobby (not in a match), try to close/reload the tab. Expected: no prompt.
3. After a match ends (game-over screen), try to close/reload. Expected: no prompt.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/App.vue
git commit -m "Warn before leaving the page during a live match

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** token persistence → Tasks 1-2; "Restoring match…" screen → Task 3; presence-flash fix → Task 3 Step 4; `beforeunload` warning → Task 4. All four spec items covered.
- **Deviation from spec, called out explicitly:** the spec's testing section assumed `useGameSocket.ts` would get direct unit tests; investigation during planning found that's not possible without a DOM/`location` shim this codebase doesn't have (config.ts reads `location.*` at module scope, which throws under `bun test`). Resolved by extracting the persistence logic into a dependency-free `sessionToken.ts` that *is* unit tested, and verifying its wiring into `useGameSocket.ts`/`App.vue` manually — consistent with the fact that neither file has automated tests today.
- **Deviation, minor:** the spec said "persist on `game:start`, `reconnect:ok`" — confirmed from `Room.ts`/`protocol.ts` that `reconnect:ok` never carries a new token (the one from `game:start` stays valid across reconnects), so Task 2 has nothing to do on `reconnect:ok` beyond what `game:start` already covers. No behavior gap — just fewer lines than the spec implied.
- **Type consistency:** `restoringSession: Ref<boolean>`, `showRestoringSession: ComputedRef<boolean>`, `loadReconnectToken(): string | null` / `saveReconnectToken(token: string): void` / `clearReconnectToken(): void` are used with matching names and signatures across Tasks 1-3.
