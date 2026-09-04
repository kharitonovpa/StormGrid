# Transparent network-failure UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every failed request to an external resource shows the player a message naming what failed and a button that can fix it, so the Yandex Games moderation item is closed.

**Architecture:** Additive only. A new `RetryNotice.vue` row is dropped into the three panels that load remote data; the socket gains an `offline` flag that latches after 8 s without a connection; `ensureConnected` gains a card that reports a slow connect **without cancelling the queued action**. Reconnect mechanics — backoff, attempt budgets, `gaveUp`, `retryConnection`, heartbeat, the two-socket race guard — are not edited.

**Tech Stack:** Vue 3 `<script setup>` SFCs, TypeScript, Vite, `bun test` (`bun:test`, plain TS — no Vue component rendering in this suite).

**Spec:** `docs/superpowers/specs/2026-09-04-network-error-ux-design.md`

## Global Constraints

- Copy ships in **both** `en` and `ru` in `packages/client/src/lib/i18n.ts`. A key present in `en` but missing in `ru` silently falls back to English — it will not throw, so it must be checked deliberately.
- Reconnect logic in `useGameSocket.ts` is off-limits: `scheduleReconnect`, `MAX_RECONNECT_ATTEMPTS`, `IN_MATCH_MAX_RECONNECT_ATTEMPTS`, `gaveUp`, `retryConnection`, `startHeartbeat`, and the `if (ws.value !== socket) return` guard in `onclose` must come out of this work byte-for-byte identical.
- `pendingAction` in `App.vue` is never cleared by a timeout. Only the explicit **Cancel** button clears it. A connect that lands late must still run the queued action.
- `OFFLINE_AFTER_MS = 8_000` (`useGameSocket.ts`) and `PLAY_CONNECT_TIMEOUT_MS = 8_000` (`App.vue`) — two separate constants that happen to share a value, in two modules. Do not merge them.
- **No component-test infrastructure is added.** This repo's suite is plain TS under `bun:test`; `@vue/test-utils` and a DOM shim are not installed, and installing them is a larger change than this fix. `.vue` edits are covered by `vue-tsc` typecheck in `bun run build` plus the manual pass in Task 8. Tasks 1, 3 and 4 carry real unit tests.
- Every test that imports anything reaching `src/lib/config.ts` must install a `globalThis.location` stub **before** the import, or module evaluation throws `ReferenceError: location is not defined`. Use a dynamic `await import()` inside the test body, not a top-level `import`.
- Run tests from `packages/client` with `bun test`. Run the typecheck with `bun run build` from the same directory.
- **`vue-tsc -b` typechecks test files too, and this repo sets `"erasableSyntaxOnly": true` (`tsconfig.app.json:11`).** So test helpers must avoid TypeScript parameter properties (`constructor(public url: string)`), `enum`, and namespaces — declare the field explicitly and assign it in the constructor body instead. `bun test` does not typecheck, so a violation here passes the suite and only fails the build.
- **Line numbers in this plan are from the pre-change files.** Earlier steps insert lines above later targets, so by the time you reach a step its quoted `file.vue:NNN` will have drifted — often by ten or twenty lines. Always locate the target by the quoted code, and treat the line number as a hint about roughly where to look. `App.vue`, `LobbyOverlay.vue` and `LeaderboardPanel.vue` are each edited by more than one task.

---

### Task 1: Copy for every new message

**Files:**
- Modify: `packages/client/src/lib/i18n.ts:154-163` (en `app.*` block) and `:317-326` (ru `app.*` block)
- Test: `packages/client/src/lib/__tests__/networkCopy.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: i18n keys used by every later task — `net.offline`, `net.connectFailed`, `net.leaderboardFailed`, `net.replaysFailed`, `net.replayFailed`, `net.loginFailed`, `lobby.connecting`, `boot.failed`, `boot.failedHint`, `boot.reload`. Read with the existing `t(key: string, ...args: (string | number)[]): string` from `../lib/i18n`.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/lib/__tests__/networkCopy.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import { setLanguage, t } from '../i18n.js'

/**
 * `t()` falls back to the English string when a key is missing from the active
 * language, so "the Russian build shows English" is a silent failure. Asserting
 * the two differ is what actually catches a forgotten ru entry.
 */
const KEYS = [
  'net.offline',
  'net.connectFailed',
  'net.leaderboardFailed',
  'net.replaysFailed',
  'net.replayFailed',
  'net.loginFailed',
  'lobby.connecting',
  'boot.failed',
  'boot.failedHint',
  'boot.reload',
]

describe('network failure copy', () => {
  it('resolves every key in English', () => {
    setLanguage('en')
    for (const key of KEYS) {
      expect(t(key)).not.toBe(key)
      expect(t(key).length).toBeGreaterThan(0)
    }
  })

  it('has a distinct Russian string for every key', () => {
    for (const key of KEYS) {
      setLanguage('en')
      const en = t(key)
      setLanguage('ru')
      const ru = t(key)
      expect(ru).not.toBe(key)
      expect(ru).not.toBe(en)
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/client && bun test src/lib/__tests__/networkCopy.test.ts`
Expected: FAIL — `expect(t(key)).not.toBe(key)` fails on `net.offline`, because an unknown key falls through to `?? key`.

- [ ] **Step 3: Add the English strings**

In `packages/client/src/lib/i18n.ts`, inside the `en:` object, insert directly after the line `'app.winnerPredicted': 'Winner predicted',`:

```ts
    'net.offline': 'No connection to the server',
    'net.connectFailed': 'Could not reach the server. Check your internet connection.',
    'net.leaderboardFailed': 'Could not load the leaderboard',
    'net.replaysFailed': 'Could not load recent matches',
    'net.replayFailed': 'Could not load that replay',
    'net.loginFailed': 'Sign-in failed',

    'boot.failed': 'Failed to load the game',
    'boot.failedHint': 'Check your internet connection and try again',
    'boot.reload': 'Reload',
```

Still inside `en:`, add one line directly after `'lobby.cancel': 'Cancel',`:

```ts
    'lobby.connecting': 'Connecting…',
```

- [ ] **Step 4: Add the Russian strings**

In the `ru:` object, insert directly after `'app.winnerPredicted': 'Победитель угадан',`:

```ts
    'net.offline': 'Нет связи с сервером',
    'net.connectFailed': 'Не удалось подключиться к серверу. Проверь интернет-соединение.',
    'net.leaderboardFailed': 'Не удалось загрузить таблицу лидеров',
    'net.replaysFailed': 'Не удалось загрузить последние матчи',
    'net.replayFailed': 'Не удалось загрузить этот повтор',
    'net.loginFailed': 'Не удалось войти',

    'boot.failed': 'Не удалось загрузить игру',
    'boot.failedHint': 'Проверь подключение к интернету и попробуй снова',
    'boot.reload': 'Перезагрузить',
```

And after the `ru:` entry for `'lobby.cancel'` (find it by searching `'lobby.cancel':` inside the `ru:` block):

```ts
    'lobby.connecting': 'Подключение…',
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/client && bun test src/lib/__tests__/networkCopy.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/lib/i18n.ts packages/client/src/lib/__tests__/networkCopy.test.ts
git commit -m "Add copy for network-failure messages in both languages"
```

---

### Task 2: RetryNotice component and the leaderboard's failure state

**Files:**
- Create: `packages/client/src/components/RetryNotice.vue`
- Modify: `packages/client/src/components/LeaderboardPanel.vue`

**Interfaces:**
- Consumes: `net.leaderboardFailed` and `app.retry` from Task 1.
- Produces: `RetryNotice.vue` — props `{ message: string; busy?: boolean }`, emit `retry: []`. Used again in Tasks 3, 5 and 6. Its root element is `.rn`, a block-level flex column with `pointer-events: auto`, so a consumer can size and position it with an extra class.

**Why no unit test:** `RetryNotice.vue` and `LeaderboardPanel.vue` are SFCs; `bun test` cannot import them. `bun run build` typechecks both through `vue-tsc`, and Task 8 exercises them against a blocked domain.

- [ ] **Step 1: Create the component**

Create `packages/client/src/components/RetryNotice.vue`:

```vue
<script setup lang="ts">
import { t } from '../lib/i18n'

defineProps<{
  /** What failed, in the player's language. Never a raw error string. */
  message: string
  /** A retry is in flight — the button is dead until it settles. */
  busy?: boolean
}>()

const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="rn">
    <span class="rn-msg">{{ message }}</span>
    <button class="rn-btn" :disabled="busy" @click="emit('retry')">
      {{ busy ? '···' : t('app.retry') }}
    </button>
  </div>
</template>

<style scoped>
/* `.lobby` turns pointer events off for its whole subtree, so this has to
   claim them back or the retry button cannot be clicked from the lobby. */
.rn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(230, 160, 80, 0.25);
  background: rgba(230, 160, 80, 0.08);
  text-align: center;
  pointer-events: auto;
}

.rn-msg {
  font-size: 10px;
  line-height: 1.4;
  letter-spacing: 0.3px;
  color: rgba(230, 180, 100, 0.9);
}

.rn-btn {
  font-family: inherit;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.6px;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid rgba(232, 197, 71, 0.45);
  background: rgba(232, 197, 71, 0.14);
  color: #e8c547;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.rn-btn:hover:not(:disabled) {
  background: rgba(232, 197, 71, 0.22);
  border-color: rgba(232, 197, 71, 0.7);
}

.rn-btn:disabled {
  cursor: default;
  opacity: 0.5;
}
</style>
```

- [ ] **Step 2: Add the failure state to the leaderboard script**

In `packages/client/src/components/LeaderboardPanel.vue`, add the import next to the existing `UserAvatar` import:

```ts
import RetryNotice from './RetryNotice.vue'
```

Add three refs beside `const loadingMore = ref(false)`:

```ts
/** Both leaderboard requests failed — say so instead of rendering "no players". */
const failed = ref(false)
/** A "load more" page failed — its own notice, the first page is still good. */
const moreFailed = ref(false)
/** The failure notice's own button is mid-attempt. */
const retrying = ref(false)
```

Replace the whole of `fetchLeaderboard` (`packages/client/src/components/LeaderboardPanel.vue:30-53`). The function's local `let failed = false` disappears — the ref replaces it, so the outcome survives into render:

```ts
async function fetchLeaderboard(retries = 2) {
  try {
    const [pRaw, wRaw] = await Promise.all([
      fetch(`${API_BASE}/api/leaderboard/players?limit=${PAGE_SIZE}`).then(r => r.ok ? r.json() : null),
      fetch(`${API_BASE}/api/leaderboard/watchers?limit=${PAGE_SIZE}`).then(r => r.ok ? r.json() : null),
    ])
    if (isPaginated<PlayerLeaderboardEntry>(pRaw, isPlayerEntry)) {
      players.value = pRaw.items
      playersTotal.value = pRaw.total
    }
    if (isPaginated<WatcherLeaderboardEntry>(wRaw, isWatcherEntry)) {
      watchers.value = wRaw.items
      watchersTotal.value = wRaw.total
    }
    failed.value = pRaw === null && wRaw === null
  } catch {
    // A CSP-blocked fetch rejects, so this — not the null branch above — is the
    // path the Yandex sandbox actually takes.
    failed.value = true
  }
  if (failed.value && retries > 0) {
    setTimeout(() => fetchLeaderboard(retries - 1), 1500)
    return
  }
  loaded.value = true
}

/** The notice's button: one more full attempt, the button dead meanwhile. */
async function retryLeaderboard() {
  retrying.value = true
  await fetchLeaderboard(0)
  retrying.value = false
}
```

The retry deliberately passes `retries = 0`: the player pressing the button *is* the retry, and a silent 1.5 s re-attempt behind a dead button reads as a hang.

- [ ] **Step 3: Make `loadMore` report its failure**

Replace the body of `loadMore` (`packages/client/src/components/LeaderboardPanel.vue:56-72`):

```ts
async function loadMore(tab: Tab) {
  loadingMore.value = true
  moreFailed.value = false
  try {
    const offset = tab === 'players' ? players.value.length : watchers.value.length
    const url = `${API_BASE}/api/leaderboard/${tab}?limit=${PAGE_SIZE}&offset=${offset}`
    const raw = await fetch(url).then(r => r.ok ? r.json() : null)
    if (raw === null) moreFailed.value = true
    else if (tab === 'players' && isPaginated<PlayerLeaderboardEntry>(raw, isPlayerEntry)) {
      players.value = [...players.value, ...raw.items]
      playersTotal.value = raw.total
    } else if (tab === 'watchers' && isPaginated<WatcherLeaderboardEntry>(raw, isWatcherEntry)) {
      watchers.value = [...watchers.value, ...raw.items]
      watchersTotal.value = raw.total
    }
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[leaderboard] load more failed:', e)
    moreFailed.value = true
  }
  loadingMore.value = false
}
```

- [ ] **Step 4: Render the notice instead of the lying empty state**

In the template, wrap the tabs and both lists so a total failure replaces them. Replace the opening of the panel — the `<div class="lb-tabs">` block through the closing `</div>` of the second `.lb-list` — with:

```html
    <RetryNotice
      v-if="failed"
      :message="t('net.leaderboardFailed')"
      :busy="retrying"
      @retry="retryLeaderboard"
    />

    <template v-else>
      <div class="lb-tabs">
        <button
          class="lb-tab"
          :class="{ active: activeTab === 'players' }"
          @click="activeTab = 'players'"
        >{{ t('leaderboard.players') }}</button>
        <button
          class="lb-tab"
          :class="{ active: activeTab === 'watchers' }"
          @click="activeTab = 'watchers'"
        >{{ t('leaderboard.watchers') }}</button>
      </div>

      <div class="lb-list" v-if="activeTab === 'players'">
        <div v-for="(p, i) in players" :key="p.userId" class="lb-row">
          <span class="lb-rank" :class="RANK_CLASS[i]">{{ i + 1 }}</span>
          <UserAvatar :src="p.avatar" :name="p.name" :size="20" />
          <span class="lb-name">{{ p.name }}</span>
          <span class="lb-stat lb-wins">{{ p.wins }}W</span>
          <span class="lb-stat lb-losses">{{ p.losses }}L</span>
        </div>
        <RetryNotice
          v-if="moreFailed"
          :message="t('net.leaderboardFailed')"
          :busy="loadingMore"
          @retry="loadMore('players')"
        />
        <button
          v-else-if="players.length < playersTotal"
          class="lb-more"
          :disabled="loadingMore"
          @click="loadMore('players')"
        >{{ loadingMore ? '···' : t('leaderboard.more', playersTotal - players.length) }}</button>
        <div v-if="players.length === 0" class="lb-empty">{{ t('leaderboard.noPlayers') }}</div>
      </div>

      <div class="lb-list" v-if="activeTab === 'watchers'">
        <div v-for="(w, i) in watchers" :key="w.userId" class="lb-row">
          <span class="lb-rank" :class="RANK_CLASS[i]">{{ i + 1 }}</span>
          <UserAvatar :src="w.avatar" :name="w.name" :size="20" />
          <span class="lb-name">{{ w.name }}</span>
          <span class="lb-stat lb-score">{{ w.watcherScore }}pts</span>
        </div>
        <RetryNotice
          v-if="moreFailed"
          :message="t('net.leaderboardFailed')"
          :busy="loadingMore"
          @retry="loadMore('watchers')"
        />
        <button
          v-else-if="watchers.length < watchersTotal"
          class="lb-more"
          :disabled="loadingMore"
          @click="loadMore('watchers')"
        >{{ loadingMore ? '···' : t('leaderboard.more', watchersTotal - watchers.length) }}</button>
        <div v-if="watchers.length === 0" class="lb-empty">{{ t('leaderboard.noWatchers') }}</div>
      </div>
    </template>
```

The `.lb-community` link below stays exactly where it is, outside this block.

- [ ] **Step 5: Typecheck**

Run: `cd packages/client && bun run build`
Expected: `vue-tsc -b` reports no errors and `vite build` completes.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/components/RetryNotice.vue packages/client/src/components/LeaderboardPanel.vue
git commit -m "Show a retry notice when the leaderboard cannot be loaded

An exhausted retry budget set loaded = true regardless and rendered
\"no players yet\" — a lie whenever the request never arrived."
```

---

### Task 3: Replay fetches report failure instead of throwing

**Files:**
- Modify: `packages/client/src/lib/replayPlayer.ts:5-15`
- Modify: `packages/client/src/components/LobbyOverlay.vue`
- Modify: `packages/client/src/App.vue` (`startReplay`, ~line 807; `LobbyOverlay` usage, ~line 2400)
- Test: `packages/client/src/lib/__tests__/replayFetch.test.ts`

**Interfaces:**
- Consumes: `RetryNotice.vue` from Task 2; `net.replaysFailed` and `net.replayFailed` from Task 1.
- Produces: `fetchReplayList(): Promise<ReplaySummary[] | null>` — `null` means the request failed, `[]` means it succeeded and there is nothing to show. `fetchReplayData(id: string): Promise<ReplayData | null>` keeps its signature but now returns `null` on a network error rather than throwing. `LobbyOverlay` gains prop `replayFailed: boolean` and emit `retryReplay: []`.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/lib/__tests__/replayFetch.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'bun:test'

/**
 * `config.ts` reads `location` at module scope, so the stub has to be in place
 * before the module under test is ever imported — hence the dynamic import.
 */
function installLocation(): void {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: {
      protocol: 'https:',
      hostname: 'wheee.io',
      origin: 'https://wheee.io',
      href: 'https://wheee.io/',
    },
  })
}

function stubFetch(impl: () => Promise<unknown>): void {
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: impl })
}

async function loadModule() {
  installLocation()
  return import('../replayPlayer.js')
}

describe('replay fetches', () => {
  beforeEach(installLocation)

  it('returns null when the request is blocked outright', async () => {
    const { fetchReplayList } = await loadModule()
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    expect(await fetchReplayList()).toBeNull()
  })

  it('returns null when the server answers with an error status', async () => {
    const { fetchReplayList } = await loadModule()
    stubFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve(null) }))
    expect(await fetchReplayList()).toBeNull()
  })

  it('returns an empty array when there are genuinely no replays', async () => {
    const { fetchReplayList } = await loadModule()
    stubFetch(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }))
    expect(await fetchReplayList()).toEqual([])
  })

  it('returns null when a single replay cannot be fetched', async () => {
    const { fetchReplayData } = await loadModule()
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    expect(await fetchReplayData('abc')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/client && bun test src/lib/__tests__/replayFetch.test.ts`
Expected: FAIL — the first and fourth tests reject with `TypeError: Failed to fetch` because neither function catches; the second returns `[]` instead of `null`.

- [ ] **Step 3: Make both functions total**

Replace `packages/client/src/lib/replayPlayer.ts:5-15`:

```ts
/**
 * `null` and `[]` mean different things and the lobby renders them differently:
 * `null` is "we could not reach the server, offer a retry", `[]` is "we asked
 * and there is nothing to show". A thrown fetch used to become an unhandled
 * rejection in the caller's `onMounted`, which the player saw as silence.
 */
export async function fetchReplayList(): Promise<ReplaySummary[] | null> {
  try {
    const res = await fetch(`${API_BASE}/api/replays`, { credentials: 'include' })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function fetchReplayData(id: string): Promise<ReplayData | null> {
  try {
    const res = await fetch(`${API_BASE}/api/replay/${id}`, { credentials: 'include' })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/client && bun test src/lib/__tests__/replayFetch.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire the lobby's recent-matches corner**

In `packages/client/src/components/LobbyOverlay.vue`, add the import beside `UserAvatar`:

```ts
import RetryNotice from './RetryNotice.vue'
```

Add to the `defineProps<{...}>()` object, after `inviteFailed: boolean`:

```ts
  /** The replay the player just clicked could not be fetched. */
  replayFailed: boolean
```

Add to `defineEmits<{...}>()`, after `watchReplay: [roomId: string]`:

```ts
  retryReplay: []
```

Beside `const replays = ref<ReplaySummary[]>([])` add:

```ts
const replaysFailed = ref(false)
const replaysRetrying = ref(false)

async function loadReplays() {
  const list = await fetchReplayList()
  replaysFailed.value = list === null
  replays.value = list ? list.slice(0, 5) : []
}

async function retryReplays() {
  replaysRetrying.value = true
  await loadReplays()
  replaysRetrying.value = false
}
```

Replace the `replays.value = ...` line inside `onMounted` (`packages/client/src/components/LobbyOverlay.vue:155`) with:

```ts
  loadReplays()
```

`onMounted`'s callback keeps its `async` keyword — `fetchMe()` above it is also fire-and-forget.

- [ ] **Step 6: Render the replay notices**

Replace the opening line of the recent-matches corner (`packages/client/src/components/LobbyOverlay.vue:324-325`):

```html
    <div v-if="replays.length > 0 || replaysFailed || replayFailed" class="recent-corner">
      <span class="recent-label">{{ t('lobby.recent') }}</span>
      <RetryNotice
        v-if="replaysFailed || replayFailed"
        :message="replaysFailed ? t('net.replaysFailed') : t('net.replayFailed')"
        :busy="replaysRetrying"
        @retry="replaysFailed ? retryReplays() : emit('retryReplay')"
      />
```

The rest of the block — the `v-for` over `replays` and the closing `</div>` — is unchanged. When the list loaded but one replay failed, both the list and the notice show; that is intended.

- [ ] **Step 7: Report a failed replay from App.vue**

In `packages/client/src/App.vue`, beside the other replay state, add:

```ts
/** The last replay the player asked for, so the notice's retry has a target. */
let lastReplayId: string | null = null
const replayLoadFailed = ref(false)
```

Replace the opening of `startReplay` (`packages/client/src/App.vue:807-811`):

```ts
async function startReplay(roomId: string) {
  track('replay_watch')
  lastReplayId = roomId
  replayLoadFailed.value = false
  const gen = ++replayGeneration
  const data = await fetchReplayData(roomId)
  // Generation first: a replay the player has already navigated away from must
  // not raise a notice for a screen they are no longer looking at.
  if (gen !== replayGeneration) return
  if (!data || data.frames.length === 0) {
    replayLoadFailed.value = true
    return
  }
```

Add the handler beside `onRetryConnection`:

```ts
function onRetryReplay() {
  if (lastReplayId) startReplay(lastReplayId)
}
```

- [ ] **Step 8: Pass the prop and handler through**

In the `<LobbyOverlay>` usage (`packages/client/src/App.vue:2400-2422`), add after `:invite-failed="game.inviteFailed.value"`:

```html
    :replay-failed="replayLoadFailed"
```

and after `@watch-replay="startReplay"`:

```html
    @retry-replay="onRetryReplay"
```

- [ ] **Step 9: Typecheck and run the full suite**

Run: `cd packages/client && bun run build && bun test`
Expected: build clean; all tests pass (32 + the new ones).

- [ ] **Step 10: Commit**

```bash
git add packages/client/src/lib/replayPlayer.ts packages/client/src/lib/__tests__/replayFetch.test.ts packages/client/src/components/LobbyOverlay.vue packages/client/src/App.vue
git commit -m "Tell the player when replays cannot be loaded

Both replay fetches threw on a network error, which surfaced as an
unhandled rejection and a lobby that silently dropped its recent-matches
corner. They now return null, and null gets a retry notice."
```

---

### Task 4: The socket knows when it has been down too long

**Files:**
- Modify: `packages/client/src/composables/useGameSocket.ts`
- Test: `packages/client/src/composables/__tests__/useGameSocket.offline.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `useGameSocket()` returns an additional `offline: Ref<boolean>` — true once there has been no open socket for `OFFLINE_AFTER_MS`, false whenever one is open. Task 5 reads it as `socket.offline.value`.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/composables/__tests__/useGameSocket.offline.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, jest } from 'bun:test'

/** Stand-in for the browser's WebSocket: nothing connects, the test drives it. */
class FakeSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: FakeSocket[] = []

  readyState = 0
  onopen: (() => void) | null = null
  onclose: ((e: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null

  constructor(public url: string) { FakeSocket.instances.push(this) }
  send(): void {}
  close(): void { this.readyState = FakeSocket.CLOSED }

  /** The server accepted the connection. */
  open(): void { this.readyState = FakeSocket.OPEN; this.onopen?.() }
  /** The connection died without ever opening, as a CSP block does. */
  fail(): void { this.readyState = FakeSocket.CLOSED; this.onclose?.({ code: 1006, reason: '' }) }
}

function installGlobals(): void {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: {
      protocol: 'https:',
      hostname: 'wheee.io',
      origin: 'https://wheee.io',
      href: 'https://wheee.io/',
    },
  })
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FakeSocket })
}

async function freshSocket() {
  installGlobals()
  FakeSocket.instances = []
  const { useGameSocket } = await import('../useGameSocket.js')
  return useGameSocket()
}

const OFFLINE_AFTER_MS = 8_000

describe('offline flag', () => {
  beforeEach(() => {
    installGlobals()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('stays down until the connection has been missing long enough', async () => {
    const socket = await freshSocket()
    socket.connect()
    expect(socket.offline.value).toBe(false)
    jest.advanceTimersByTime(OFFLINE_AFTER_MS - 1)
    expect(socket.offline.value).toBe(false)
    jest.advanceTimersByTime(1)
    expect(socket.offline.value).toBe(true)
  })

  it('never fires for a connection that opens in time', async () => {
    const socket = await freshSocket()
    socket.connect()
    FakeSocket.instances[0]!.open()
    jest.advanceTimersByTime(OFFLINE_AFTER_MS * 2)
    expect(socket.offline.value).toBe(false)
    expect(socket.connected.value).toBe(true)
  })

  it('clears once a connection finally lands', async () => {
    const socket = await freshSocket()
    socket.connect()
    jest.advanceTimersByTime(OFFLINE_AFTER_MS)
    expect(socket.offline.value).toBe(true)
    FakeSocket.instances.at(-1)!.open()
    expect(socket.offline.value).toBe(false)
  })

  it('is not pushed back by the reconnect loop making new sockets', async () => {
    const socket = await freshSocket()
    socket.connect()
    // Fail early and let the backoff build several more sockets; the deadline
    // is measured from the first attempt, not from the latest one.
    FakeSocket.instances[0]!.fail()
    jest.advanceTimersByTime(OFFLINE_AFTER_MS)
    expect(FakeSocket.instances.length).toBeGreaterThan(1)
    expect(socket.offline.value).toBe(true)
  })

  it('leaves the give-up budget alone', async () => {
    const socket = await freshSocket()
    socket.connect()
    FakeSocket.instances[0]!.fail()
    jest.advanceTimersByTime(OFFLINE_AFTER_MS)
    // The reconnect loop is nowhere near its 20-attempt budget yet.
    expect(socket.gaveUp.value).toBe(false)
    expect(socket.reconnecting.value).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/client && bun test src/composables/__tests__/useGameSocket.offline.test.ts`
Expected: FAIL — `socket.offline` is `undefined`, so `socket.offline.value` throws `TypeError: undefined is not an object`.

- [ ] **Step 3: Add the constant**

In `packages/client/src/composables/useGameSocket.ts`, add below `const HEARTBEAT_MS = 25_000`:

```ts
/**
 * How long without an open socket before the UI is allowed to say so out loud.
 * Long enough that a normal `refreshConnection()` — fired on every auth change
 * and on a stalled tick — never flickers a "no connection" line at a player
 * whose connection is fine.
 */
const OFFLINE_AFTER_MS = 8_000
```

- [ ] **Step 4: Add the flag and its timer**

Inside `useGameSocket()`, below `const gaveUp = ref(false)`:

```ts
  /**
   * No open socket for OFFLINE_AFTER_MS. Purely a reporting flag: it is read by
   * the lobby and written by nothing in the reconnect path, whose counters and
   * budgets it must not touch.
   */
  const offline = ref(false)
```

Below `let intentionalClose = false`:

```ts
  let offlineTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * Armed once per outage, not once per attempt: the backoff loop builds a new
   * socket every few seconds, and re-arming there would push the deadline out
   * forever and the flag would never latch.
   */
  function armOfflineTimer() {
    if (offlineTimer || offline.value) return
    offlineTimer = setTimeout(() => {
      offlineTimer = null
      offline.value = true
    }, OFFLINE_AFTER_MS)
  }

  function clearOfflineTimer() {
    if (offlineTimer) { clearTimeout(offlineTimer); offlineTimer = null }
    offline.value = false
  }
```

- [ ] **Step 5: Hook it to the three points that already know**

In `createSocket()`, as the first statement of the function (above `const socket = new WebSocket(buildWsUrl())`):

```ts
    armOfflineTimer()
```

In `socket.onopen`, directly after `connected.value = true`:

```ts
      clearOfflineTimer()
```

In `disconnect()`, directly after `stopHeartbeat()`:

```ts
    clearOfflineTimer()
```

Arming in `createSocket` rather than in `onclose` is what makes this cover all three entry points uniformly — first `connect()`, every backoff retry, and `refreshConnection()`, which nulls `old.onclose` and would otherwise skip it.

- [ ] **Step 6: Export the flag**

In the returned object, add `offline` directly after `gaveUp`:

```ts
    connected,
    reconnecting,
    gaveUp,
    offline,
    reconnectToken,
    connect,
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd packages/client && bun test src/composables/__tests__/useGameSocket.offline.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 8: Confirm nothing else moved**

Run: `cd packages/client && git diff --stat src/composables/useGameSocket.ts && bun test`
Expected: only `useGameSocket.ts` changed in that file's diff; the whole suite passes.

- [ ] **Step 9: Commit**

```bash
git add packages/client/src/composables/useGameSocket.ts packages/client/src/composables/__tests__/useGameSocket.offline.test.ts
git commit -m "Track when the socket has been down long enough to mention

A reporting-only flag beside the reconnect state, armed once per outage
so the backoff loop cannot keep pushing its deadline out."
```

---

### Task 5: The lobby says it is offline, and a queued Play stops looking dead

**Files:**
- Modify: `packages/client/src/App.vue` (`ensureConnected` ~line 220, the `connected` watch ~line 230, overlay template ~line 2371, `LobbyOverlay` usage ~line 2400)
- Modify: `packages/client/src/components/LobbyOverlay.vue`

**Interfaces:**
- Consumes: `socket.offline` from Task 4; `RetryNotice.vue` from Task 2; `net.offline`, `net.connectFailed`, `lobby.connecting` from Task 1.
- Produces: `LobbyOverlay` gains props `offline: boolean` and `connecting: boolean`, and emit `retryConnect: []`.

- [ ] **Step 1: Add the connect-wait state to App.vue**

In `packages/client/src/App.vue`, directly **below** `let pendingAction: (() => void) | null = null` (`:219`) — the long comment above that line explains why the declaration sits where it does and must stay attached to it:

```ts
/**
 * How long a queued lobby action may sit waiting on a socket before the player
 * is told. The socket's own `gaveUp` is twenty backoff attempts — about two and
 * a half minutes — far too long to leave a tapped button looking dead.
 */
const PLAY_CONNECT_TIMEOUT_MS = 8_000

/** An action is queued behind a connect that has not landed yet. */
const connectPending = ref(false)
/** That connect has been slow enough to say so — without cancelling it. */
const connectFailed = ref(false)
let connectTimer = 0
```

- [ ] **Step 2: Replace `ensureConnected` and its watcher**

In `packages/client/src/App.vue`, replace the existing `function ensureConnected(then)` and the `watch(() => socket.connected.value, ...)` immediately below it — originally `:221-237`, shifted down by whatever Step 1 inserted — with:

```ts
function armConnectTimer() {
  if (connectTimer) clearTimeout(connectTimer)
  // Reports the wait; never drops `pendingAction`. A socket that lands at, say,
  // eleven seconds still starts the match and closes the card on its own — only
  // Cancel throws the queued action away.
  connectTimer = window.setTimeout(() => {
    connectTimer = 0
    if (pendingAction) connectFailed.value = true
  }, PLAY_CONNECT_TIMEOUT_MS)
}

function clearConnectWait() {
  if (connectTimer) { clearTimeout(connectTimer); connectTimer = 0 }
  connectPending.value = false
  connectFailed.value = false
}

function ensureConnected(then: () => void) {
  if (socket.connected.value) {
    then()
  } else {
    pendingAction = then
    connectPending.value = true
    connectFailed.value = false
    armConnectTimer()
    socket.connect()
  }
}

watch(() => socket.connected.value, (connected) => {
  if (!connected) return
  clearConnectWait()
  if (pendingAction) {
    const fn = pendingAction
    pendingAction = null
    fn()
  }
})
```

- [ ] **Step 3: Add the card's two handlers**

Beside `onRetryConnection` in `packages/client/src/App.vue`:

```ts
function onRetryConnect() {
  connectFailed.value = false
  armConnectTimer()
  socket.retryConnection()
}

function onCancelConnect() {
  pendingAction = null
  clearConnectWait()
}
```

- [ ] **Step 4: Render the card**

In the template, directly below the closing `</Transition>` of the reconnecting overlay (`packages/client/src/App.vue:2371`):

```html
  <!-- A queued lobby action waiting on a socket that has not come up. This
       card only reports the wait: `pendingAction` stays armed, so a late
       connect still starts the match and dismisses this on its own. -->
  <Transition name="rc">
    <div v-if="connectFailed" class="reconnect-overlay">
      <div class="reconnect-card">
        <div class="reconnect-text">{{ t('net.connectFailed') }}</div>
        <div class="reconnect-actions">
          <button class="reconnect-btn primary" @click="onRetryConnect">{{ t('app.retry') }}</button>
          <button class="reconnect-btn" @click="onCancelConnect">{{ t('lobby.cancel') }}</button>
        </div>
      </div>
    </div>
  </Transition>
```

- [ ] **Step 5: Pass the lobby its two new props**

In the `<LobbyOverlay>` usage, add after `:replay-failed="replayLoadFailed"`:

```html
    :offline="socket.offline.value && !restoringSession"
    :connecting="connectPending"
```

and after `@retry-replay="onRetryReplay"`:

```html
    @retry-connect="onRetryConnection"
```

`showLobby` is already false in every in-match phase, so the lobby line cannot stack on the in-match reconnect overlay; `!restoringSession` is what keeps it off the F5 restore screen.

- [ ] **Step 6: Declare the props in LobbyOverlay**

In `packages/client/src/components/LobbyOverlay.vue`, add to `defineProps<{...}>()` after `replayFailed: boolean`:

```ts
  /** No socket for long enough that it is worth saying so. */
  offline: boolean
  /** A tapped action is queued behind a connect that has not landed. */
  connecting: boolean
```

and to `defineEmits<{...}>()` after `retryReplay: []`:

```ts
  retryConnect: []
```

- [ ] **Step 7: Render the lobby line and the Play button's waiting state**

Replace the `invite-failed` line and the Play button's opening tag and label (`packages/client/src/components/LobbyOverlay.vue:236-245`):

```html
            <div v-if="inviteFailed" class="invite-failed">{{ t('lobby.inviteFail') }}</div>
            <RetryNotice
              v-if="offline"
              class="lobby-offline"
              :message="t('net.offline')"
              @retry="emit('retryConnect')"
            />
            <div class="actions-primary">
              <button
                class="btn-play"
                :class="{ 'btn-play-hot': props.inQueue > 0 }"
                :disabled="connecting"
                :aria-label="props.inQueue > 0 ? t('lobby.play.instant') : t('lobby.play')"
                @click="emit('play', selected)"
              >
                <span class="btn-play-text">{{ connecting ? t('lobby.connecting') : (hasIncomingInvite ? t('lobby.playFriend') : t('lobby.play')) }}</span>
```

The rest of the button — the arrow `<svg>`, the queue pip `<Transition>` and `</button>` — is unchanged.

- [ ] **Step 8: Style the two new bits**

In `LobbyOverlay.vue`'s `<style scoped>`, directly after the `.btn-play { ... }` rule:

```css
.btn-play:disabled {
  cursor: default;
  opacity: 0.65;
  box-shadow: none;
}
```

and directly after the `.invite-failed { ... }` rule:

```css
.lobby-offline {
  margin-bottom: 10px;
  max-width: 340px;
}
```

- [ ] **Step 9: Typecheck and run the full suite**

Run: `cd packages/client && bun run build && bun test`
Expected: build clean, all tests pass.

- [ ] **Step 10: Commit**

```bash
git add packages/client/src/App.vue packages/client/src/components/LobbyOverlay.vue
git commit -m "Say when the lobby has no server, instead of a dead Play button

ensureConnected queued the action and waited forever. It now reports the
wait after eight seconds and offers a retry, while leaving the queued
action armed so a late connect still starts the match."
```

---

### Task 6: A failed sign-in says so

**Files:**
- Modify: `packages/client/src/composables/useAuth.ts`
- Modify: `packages/client/src/components/LobbyOverlay.vue`

**Interfaces:**
- Consumes: `RetryNotice.vue` from Task 2; `net.loginFailed` from Task 1.
- Produces: `useAuth()` returns an additional `authError: Readonly<Ref<boolean>>` — true when `platform.login()` threw. A `null` return (the player closed the OAuth popup) is a cancel, not an error, and leaves it false.

- [ ] **Step 1: Catch the login failure**

In `packages/client/src/composables/useAuth.ts`, add beside `const loading = ref(false)`:

```ts
const authError = ref(false)
```

Replace the `login` function:

```ts
  async function login(provider?: string) {
    loading.value = true
    authError.value = false
    try {
      const u = await platform.login(provider)
      if (u) {
        user.value = u
        for (const cb of authCallbacks) cb()
      }
    } catch {
      // No caller awaits login(), so without this the failure is an unhandled
      // rejection and the Sign In button simply looks dead. A null return above
      // is a closed popup, not a failure — it deliberately does not land here.
      authError.value = true
    } finally {
      loading.value = false
    }
  }
```

Add to the returned object, after `loading: readonly(loading),`:

```ts
    authError: readonly(authError),
```

- [ ] **Step 2: Remember which provider to retry**

In `packages/client/src/components/LobbyOverlay.vue`, change the `useAuth()` destructuring:

```ts
const { user, login, logout, fetchMe, platformType, authError } = useAuth()
```

Add beside `const showAuthMenu = ref(false)`:

```ts
/** Which provider the retry should try again. */
const lastProvider = ref<'google' | 'github'>('google')
```

Replace `handleLogin`:

```ts
function handleLogin(provider: 'google' | 'github') {
  audio?.play('ui-click')
  lastProvider.value = provider
  login(provider)
  showAuthMenu.value = false
}
```

- [ ] **Step 3: Render the notice under the sign-in button**

In the `signin-wrap` block, directly after the closing `</button>` of `.btn-signin`:

```html
                  <RetryNotice
                    v-if="authError"
                    class="signin-error"
                    :message="t('net.loginFailed')"
                    @retry="handleLogin(lastProvider)"
                  />
```

- [ ] **Step 4: Style it**

In `LobbyOverlay.vue`'s `<style scoped>`, directly after the `.signin-wrap { position: relative; }` rule:

```css
/* Floats out of the row rather than reflowing the primary actions under it. */
.signin-error {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 200px;
  z-index: 10;
}
```

- [ ] **Step 5: Typecheck**

Run: `cd packages/client && bun run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/composables/useAuth.ts packages/client/src/components/LobbyOverlay.vue
git commit -m "Report a failed sign-in instead of swallowing the rejection

login() is called without await or catch, so a network failure was an
unhandled rejection and the button looked inert."
```

---

### Task 7: The boot failure screen speaks the player's language

**Files:**
- Modify: `packages/client/src/main.ts`

**Interfaces:**
- Consumes: `boot.failed`, `boot.failedHint`, `boot.reload` from Task 1.
- Produces: nothing.

- [ ] **Step 1: Localize the screen and drop the inline handler**

Replace the whole of `packages/client/src/main.ts`:

```ts
import { createApp } from 'vue'
import './style.css'
import { initPlatform } from './lib/platform'
import { initAnalytics } from './lib/analytics'
import { setLanguage, t } from './lib/i18n'
import App from './App.vue'

initPlatform()
  .then((platform) => {
    setLanguage(platform.getLanguage())
    initAnalytics(platform)
    createApp(App).mount('#app')
  })
  .catch((err) => {
    console.error('[init] Platform initialization failed:', err)
    // The adapter never came up, so its language is unknowable — fall back to
    // the browser's. i18n has no platform dependency, so it still works here.
    // Guarded like `web.ts`'s getLanguage: this runs before anything is
    // rendered, so a throw here would cost the player the whole message.
    setLanguage(navigator.language ? navigator.language.slice(0, 2) : 'en')

    const root = document.getElementById('app')!
    root.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#fff;font-family:sans-serif;text-align:center;padding:24px">' +
      '<div>' +
      '<p style="font-size:18px;margin:0 0 8px"></p>' +
      '<p style="font-size:13px;opacity:.6;margin:0 0 18px"></p>' +
      '<button style="padding:10px 24px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#fff;font-size:14px;cursor:pointer"></button>' +
      '</div></div>'

    // Text goes in through textContent, not the markup string: translated copy
    // must never be parsed as HTML. The reload handler is attached rather than
    // written as an inline onclick, which a strict CSP is entitled to refuse.
    const [title, hint] = root.querySelectorAll('p')
    title!.textContent = t('boot.failed')
    hint!.textContent = t('boot.failedHint')
    const button = root.querySelector('button')!
    button.textContent = t('boot.reload')
    button.addEventListener('click', () => location.reload())
  })
```

- [ ] **Step 2: Verify the screen renders**

Run: `cd packages/client && bun run dev`

In the browser, open DevTools → Network → "Block request domain" for the API host, then in the Console run `localStorage.clear()` and hard-reload. If the platform adapter still initializes (it usually will on web), force the branch instead by temporarily editing the `.then` callback to `throw new Error('probe')`, reloading, confirming the localized screen and a working Reload button, then reverting the edit.

Check both languages: `navigator.language` drives it, so switch the browser's preferred language to Russian for the second look.

- [ ] **Step 3: Typecheck**

Run: `cd packages/client && bun run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/main.ts
git commit -m "Localize the boot failure screen and attach its reload handler

The one screen a Russian player is most likely to hit was hardcoded
English, and its reload button relied on an inline onclick."
```

---

### Task 8: Verify against a blocked domain

**Files:** none — verification only.

**Interfaces:**
- Consumes: everything above.
- Produces: the evidence that closes the moderation item.

- [ ] **Step 1: Full suite and typecheck**

Run: `cd packages/client && bun test && bun run build`
Expected: all tests pass; build clean. Record the counts.

- [ ] **Step 2: Reproduce the moderator's condition**

Run: `cd /Users/pohare/Desktop/my/StormGrid && bun run dev:client`

In the browser open DevTools → Network, right-click any request to the API host → **Block request domain**. This reproduces the sandbox's CSP block: every `fetch` rejects and the WebSocket never opens.

- [ ] **Step 3: Walk the five surfaces**

With the domain blocked, confirm each and note what you saw:

1. **Lobby, after ~8 s** — an amber "Нет связи с сервером" row with a **Попробовать снова** button above the Play button.
2. **Tap Play** — the button reads "Подключение…" and is disabled; after ~8 s the full-screen card shows "Не удалось подключиться к серверу. Проверь интернет-соединение." with **Попробовать снова** and **Отмена**. **Отмена** closes it and re-enables Play.
3. **Leaderboard panel** — "Не удалось загрузить таблицу лидеров" with a retry, *not* "Пока нет игроков".
4. **Recent matches corner** — "Не удалось загрузить последние матчи" with a retry.
5. **Sign In → Google** (web build only) — "Не удалось войти" with a retry under the button.

- [ ] **Step 4: Verify nothing regressed with the domain unblocked**

Unblock the domain and confirm, in one session:

- The lobby shows no offline row at any point.
- Play queues normally and a match starts.
- Leaderboard and recent matches load.
- With a match running, kill the server (`Ctrl-C` on `dev:server`), confirm the in-match "Соединение потеряно" card still appears with **Попробовать снова** / **В лобби**, restart the server, and confirm **Попробовать снова** reconnects.
- Reload the page mid-match and confirm the F5 restore still works — the "Восстанавливаем матч…" screen, then the match.

- [ ] **Step 5: Confirm the late-connect path**

With the server stopped, tap Play and wait for the card. Start the server while the card is on screen. The queued action must fire on its own: the card closes and matchmaking starts, with no click on **Попробовать снова**. This is the one behaviour the design was built around — if it does not happen, `pendingAction` is being cleared somewhere it should not be.

- [ ] **Step 6: Check the Russian build**

Set the browser's preferred language to Russian, reload, and confirm every message from Step 3 is Russian, including the boot screen from Task 7.

- [ ] **Step 7: Commit the verification note**

Append a short "Verified 2026-09-04" section to `docs/superpowers/plans/2026-09-04-network-error-ux.md` recording the test counts and anything that behaved unexpectedly, then:

```bash
git add docs/superpowers/plans/2026-09-04-network-error-ux.md
git commit -m "Record the blocked-domain verification pass"
```

---

## Notes for the reviewer

- The single behavioural risk in this change is Task 5's timeout. It reports; it does not cancel. If a reviewer sees `pendingAction = null` anywhere other than the `connected` watch and `onCancelConnect`, that is the bug.
- `useGameSocket.ts` should show additions only. `git diff` on that file must not touch `scheduleReconnect`, `retryConnection`, `refreshConnection`'s body, or `onclose`.
- Neither the CSP block itself nor the GamePush anonymous-auth fallback is in scope; see the spec's non-goals.

---

## Verified 2026-09-04

No human/DevTools was available for this pass, so the blocked-domain condition
was reproduced by simply not starting the backend (dev client always points
at `:3001`) — the same observable state as a CSP block: every `fetch` rejects,
the WebSocket never opens. Driven with a small dependency-free Bun+CDP script
against headless Chrome (no Playwright/Puppeteer added). Full method,
screenshots, and every string read is in
`.superpowers/sdd/2026-09-04-network-error-ux/task-8-report.md`.

- `bun run build` (typecheck + vite build): clean.
- `bun test`: **42 pass, 0 fail**, 90 `expect()` calls across 10 files.
- Steps confirmed, each with a screenshot plus the actual DOM text read via
  `Runtime.evaluate` (not inferred from the screenshot):
  1. Lobby renders with the backend down; amber "No connection to the server"
     row present above Play.
  2. Leaderboard shows "Could not load the leaderboard" with a retry — and
     specifically *not* the empty-state string (the real string is
     "No ranked players yet", not "Пока нет игроков"'s literal English
     paraphrase "No players yet" — neither appears).
  3. Recent matches shows "Could not load recent matches" with a retry.
  4. Play → disabled "Connecting…" → after ~8s the full-screen card
     ("Could not reach the server. Check your internet connection.",
     "Try again" / "Cancel") → Cancel closes it and re-enables Play.
  5. **Late-connect, confirmed conclusively**: with the card showing (no
     Cancel this time), starting the backend made the queued action fire on
     its own — no click on "Try again". Resolution was fast enough (bot
     opponent) that a live match ("Round 1", then "Round 2") was already
     running by the first poll a couple of seconds later — stronger evidence
     than "matchmaking started". `pendingAction` behaves exactly as designed.
  6. Russian: offline row reads exactly "Нет связи с сервером"; leaderboard
     and recent-matches notices are correctly localized too. Chrome's
     `--lang` flag did **not** actually change `navigator.language` on the
     host used for this run (it stayed at the OS locale regardless); what
     worked was overriding `navigator.language`/`navigator.languages` via
     `Page.addScriptToEvaluateOnNewDocument` before navigation — worth
     knowing for any future headless run of this app.
- All processes started for this pass (headless Chrome, `dev:client`,
  `dev:server`) were killed; `lsof -i :3001 -i :5173` was empty afterward.

Two things behaved unexpectedly, both traced to the headless test harness,
**not** to this plan's code, and left for a human's awareness rather than
fixed here (Task 8 is verification-only):
- `--disable-gpu` on headless Chrome breaks WebGL, which crashed
  `CharacterPreview.vue`'s Three.js renderer during mount; that unhandled
  error was caught by `main.ts`'s `initPlatform().catch()` (which wraps the
  whole initial `app.mount()`, not just platform init) and showed the
  generic "Failed to load the game" boot screen instead of the lobby. Fixed
  in the harness by dropping the flag. Worth a follow-up ticket to narrow
  that catch so an unrelated mount-time exception doesn't get mislabeled as
  a network failure — out of this plan's scope.
- In this headless setup, `requestAnimationFrame` was serviced sparsely
  (a direct probe waited 20+s without a single tick), so the full-screen
  card's CSS leave-transition (`<Transition name="rc">`) sometimes lingered
  in the DOM well after the underlying `connectFailed`/`connecting` state
  had already flipped correctly (proven instantly via the Play button each
  time). Not a functional bug — recommend a human eyeball the ~250ms fade in
  a real browser as a final sanity check, since headless frame starvation is
  the kind of thing that can hide a real problem as easily as fake one.
