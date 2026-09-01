# F5 / page-reload match recovery — design

Date: 2026-09-01

## Problem

Pressing F5 (or otherwise reloading the page) during a live match currently forfeits
the match. The server already implements a full reconnect protocol — a
`reconnectToken` issued on `game:start`, a 30 s grace period
(`RECONNECT_GRACE_MS`, `packages/shared/src/constants.ts:36`) during which the paused
match waits for `{type:'reconnect', token}`, and a `reconnect:ok`/`reconnect:fail`
response — but the client never persists the token anywhere, so a reload always
starts a brand-new, tokenless connection. The server times out after 30 s and calls
`forfeitPlayer`.

## Goal

Full UX fix:
1. A reload during a live match auto-reconnects into the same match via the
   existing server protocol.
2. A "Restoring match…" screen covers the gap between boot and
   `reconnect:ok`/`reconnect:fail`.
3. A native `beforeunload` prompt warns the player before they navigate away or
   reload while a match is actually in progress.

Applies uniformly to all client platforms (web, Discord Activity, Telegram,
GamePush, Yandex) since the change lives in the shared composable/App shell, not in
a platform adapter.

## Non-goals

- No changes to server-side reconnect logic (`Room.ts`, `RoomManager.ts`) — it's
  already correct.
- Practice/tutorial matches keep their current behavior: no grace period, instant
  teardown on disconnect (`Room.ts:438-444`). Intentional, not a bug.
- Watchers/architects have no `reconnectToken` and are unaffected.
- No custom TTL/expiry bookkeeping on the client — the server is the source of
  truth for token validity (`reconnect:fail` covers "too late" or "match already
  gone").

## Design

### Token persistence (`useGameSocket.ts`)

- Wrap `sessionStorage` access in try/catch helpers (`loadPersistedToken`,
  `savePersistedToken`, `clearPersistedToken`) under a single key (e.g.
  `wheee:reconnectToken`). Any failure (storage unavailable/partitioned in an
  embedded iframe) degrades silently to today's behavior — no persistence, no
  crash.
- `setReconnectToken(token)` additionally persists (`token` truthy) or clears
  (`token` null) via these helpers — this already runs on every point that matters
  today: `game:start`, `reconnect:ok` (persist), `game:end`, `reconnect:fail`,
  `disconnect()` (clear).
- On composable construction, synchronously seed `reconnectToken.value` from
  `sessionStorage` *before* the first `connect()` call. The existing
  `createSocket().onopen` handler already sends `{type:'reconnect', token}`
  whenever `reconnectToken.value` is set (`useGameSocket.ts:82-84`) — no change
  needed there.
- `sessionStorage` (not the app's persistent cross-platform `storage.ts`) is a
  deliberate choice: it survives F5 within the tab, and disappears when the tab is
  actually closed — which matches "closing the tab = leaving the match" and needs
  no manual expiry.

### "Restoring match…" screen (`App.vue`)

- New ref `restoringSession`, initialized to whether a token was found in
  `sessionStorage` at boot (i.e., mirrors `!!socket.reconnectToken.value` right
  after construction, captured once).
- Cleared to `false` on `reconnect:ok`, `reconnect:fail`, and `game:start` (defensive
  — covers any interleaving with a fresh match).
- New computed `showRestoringSession = restoringSession && !isInGame` (once
  `reconnect:ok` flips phase into an in-game state, the existing
  `showReconnecting`/game UI takes over).
- Reuses the existing `.reconnect-overlay`/`.reconnect-card`/`.reconnect-spinner`
  styling with a new copy key `app.restoringSession` ("Restoring match…" /
  "Восстанавливаем матч…" — EN/RU, matching the existing i18n table in
  `packages/client/src/lib/i18n.ts`).
- While `restoringSession` is true, suppress the initial Discord presence push
  from the boot-time `watch(() => game.phase.value, ...)` (`App.vue:87-89`) so
  presence doesn't flash "lobby" before a successful resume.

### `beforeunload` warning (`App.vue`)

- Register `window.addEventListener('beforeunload', handler)` in `onMounted`,
  remove in `onUnmounted`.
- Handler calls `e.preventDefault(); e.returnValue = ''` only when `isInGame.value`
  is true (phase is `forecast`/`ticking`/`weather`) — no prompt in lobby, queue,
  friend-wait, watch, architect, or game-over.
- Text is not customizable in modern browsers (standard "Leave site?" dialog) —
  accepted trade-off.

## Testing

- Unit (`useGameSocket`): token set via `setReconnectToken` is readable by a
  freshly-constructed instance sharing the same (mocked) `sessionStorage`; a
  throwing/absent `sessionStorage` doesn't break `connect()`.
- Unit/component (`App.vue`): `restoringSession` true when a token is present at
  boot, flips false on `reconnect:ok` / `reconnect:fail`.
- Manual: start a match → reload the page → see "Restoring match…" → match resumes
  with the same board state. Reload after the 30 s grace window has elapsed →
  lands cleanly in the lobby, no hang. `beforeunload` dialog appears only mid-match.

## Files touched

- `packages/client/src/composables/useGameSocket.ts` — persistence helpers, seed on
  construction.
- `packages/client/src/App.vue` — `restoringSession` state/computed, overlay markup,
  `beforeunload` listener, presence-suppression guard.
- `packages/client/src/lib/i18n.ts` — new `app.restoringSession` key (EN/RU).
- Tests alongside `useGameSocket.ts` / `App.vue`'s existing test files.
