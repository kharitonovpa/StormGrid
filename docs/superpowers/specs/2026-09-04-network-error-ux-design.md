# Transparent network-failure UX — design

Date: 2026-09-04

## Problem

Yandex Games moderation rejected the GamePush build with this note:

> Игра должна прозрачно коммуницировать с пользователем, если не удалось получить
> данные с внешних ресурсов: дать информативное сообщение и предложить действие,
> которое поможет ему избежать ошибки, например, через кнопку повторного запроса
> или предложение перезагрузить страницу.

Reproduced in the Yandex test sandbox: the portal's CSP blocks every request to
`api.wheee.io` (`connect-src` violation, blocked — not report-only), so all
leaderboard, replay, auth and WebSocket traffic fails. The game says nothing.

The in-match case is already correct — `socket.gaveUp` renders a "Соединение
потеряно" card with **Повторить** / **В лобби** (`App.vue:2356-2371`). Every other
surface is silent, and two of them actively lie:

| Surface | Current behaviour | What the player sees |
|---|---|---|
| `App.vue:220` `ensureConnected` | queues `pendingAction`, waits forever | taps **Play** → nothing at all |
| `LeaderboardPanel.vue:30` `fetchLeaderboard` | 2 retries, then `loaded = true` regardless | "Пока нет игроков" — a lie |
| `LobbyOverlay.vue:155` `fetchReplayList` | throws, unhandled rejection in `onMounted` | recent matches silently absent |
| `App.vue:810` `startReplay` | `fetchReplayData` throws, unhandled rejection | clicking a replay does nothing |
| `LobbyOverlay.vue:106` `login(provider)` | called without `await`/`catch` | **Sign In** does nothing |
| `main.ts:16` boot failure | Reload button exists, but hardcoded English | RU players get an English screen |
| `gamepush.ts:118` `authenticateWithServer` | silent anonymous fallback | nothing (correct degradation) |

## Goal

Every failure to reach an external resource produces a message naming what failed
and an action that can fix it — a retry button, or a page reload on the boot
screen. Localized in both shipped languages.

## Non-goals

- **The CSP block itself.** The game is not yet live on Yandex production; whether
  `api.wheee.io` is reachable there is a separate question for GamePush/Yandex,
  to be raised after this moderation item is closed. This spec makes failure
  legible, it does not make the requests succeed.
- **Reconnect mechanics.** Backoff, attempt budgets, `gaveUp`, `retryConnection`,
  heartbeat and the two-socket race guard stay byte-for-byte unchanged.
- **The anonymous auth fallback in `gamepush.ts`.** Playing signed-out when the
  auth POST fails is correct degradation, not an error to report.
- No server changes.

## Design

### Shared component

`components/RetryNotice.vue` — one row: message text plus a **Повторить** button.
Props `message: string`, `busy?: boolean`; emits `retry`. Three consumers
(leaderboard, replays, sign-in), which is why it is extracted rather than copied.
The full-screen `.reconnect-overlay` card already exists in `App.vue` and is reused
as-is for the connection case.

### a) Connection — `useGameSocket.ts` + `App.vue`

Add `offline: Ref<boolean>` to the socket: "no open connection for longer than
`OFFLINE_AFTER_MS = 8_000`". Armed in `createSocket()` (so it covers first connect,
reconnect and `refreshConnection` uniformly), cleared in `onopen` and in
`disconnect()`. Arming is a no-op while a timer is already pending, so the
reconnect loop cannot keep pushing the deadline out.

8 s is chosen so a normal `refreshConnection()` — fired on every auth change and on
a stalled tick (`App.vue:803`), and completing in well under a second — never trips
it.

**Lobby:** when `socket.offline && game.phase === 'lobby' && !restoringSession`,
show a `RetryNotice` reading "Нет связи с сервером". Its retry calls the existing
`retryConnection()`, the same function the in-match card already uses. The phase
gate is what keeps this from stacking on the in-match overlay
(`!connected && isInGame`) or on the F5 restore screen (`bootRestoreGaveUp`).

**Play:** `ensureConnected` (`App.vue:220`) gains `connectPending` — the Play
button becomes a disabled "Подключение…" — and a `PLAY_CONNECT_TIMEOUT_MS = 8_000`
timer. On expiry it shows the `.reconnect-overlay` card: "Не удалось подключиться к
серверу. Проверь интернет-соединение." with **Повторить** and **Отмена**.

The timeout **only shows the card. It never clears `pendingAction`.** A socket that
lands late still fires the queued action and auto-dismisses the card; only
**Отмена** clears `pendingAction`. This preserves today's behaviour for a player
whose connection succeeds at, say, 11 s, and keeps the Discord automatch guard
`if (pendingAction) return` (`App.vue:259`) behaving exactly as it does now.

The dedicated 8 s timer is necessary because `socket.gaveUp` in the lobby is
20 attempts of capped exponential backoff — roughly 2.5 minutes.

The two mechanisms are independent and both arm on their own schedule: a player
who taps Play while the lobby line is already showing waits a further
`PLAY_CONNECT_TIMEOUT_MS` before the card appears. The lobby line stays visible
underneath the card; it is the card, not the line, that carries **Отмена**.

### b) Leaderboard — `LeaderboardPanel.vue`

Add `failed = ref(false)`. Today, when both requests fail after the two retries,
`loaded` is set to `true` anyway and the panel renders "Пока нет игроков". Instead,
render a `RetryNotice` — "Не удалось загрузить таблицу лидеров" — in place of the
empty lists. `loadMore` flags its failure the same way instead of swallowing it in
`catch`.

Note the existing `catch` already distinguishes the two cases correctly: a
CSP-blocked `fetch` rejects, so `Promise.all` rejects and `failed` is set. The
information exists; it is simply never rendered.

### c) Replays — `replayPlayer.ts`, `LobbyOverlay.vue`, `App.vue`

`fetchReplayList` and `fetchReplayData` currently throw on a network error. Both
get a `try/catch` and return `null`: `null` means "could not fetch", `[]` means
"fetched, genuinely empty". `fetchReplayList`'s return type changes from
`Promise<ReplaySummary[]>` to `Promise<ReplaySummary[] | null>`; it has exactly one
caller and `vue-tsc -b` catches a miss at build time.

`fetchReplayData` is strictly safer after the change — `startReplay` already guards
with `if (!data || ...) return`, so a network failure lands in an existing branch
instead of becoming an unhandled rejection.

Lobby renders "Не удалось загрузить последние матчи" for a failed list, and
"Не удалось загрузить повтор" for a failed individual replay.

### d) Boot screen — `main.ts`

The Reload button is already there; only the copy is hardcoded English. In the
`catch`, call `setLanguage(navigator.language.slice(0, 2))` and build the markup
from `t()` — `i18n.ts` has no platform dependency, so it works even though platform
init just failed. Add a second line explaining the likely cause.

### e) Sign-in — `useAuth.ts` + `LobbyOverlay.vue`

`login(provider)` is called at `LobbyOverlay.vue:106` with neither `await` nor
`catch`, so a failure is an unhandled rejection and the button appears dead. `login`
gains a `catch` that sets `authError`; the lobby shows "Не удалось войти" with a
retry. Callers do not await it today, so adding the `catch` cannot change their
behaviour.

## Copy

New `net.*` keys in both `en` and `ru`: `offline`, `connectFailed`,
`leaderboardFailed`, `replaysFailed`, `replayFailed`, `loginFailed`. New `boot.*`
keys: `failed`, `failedHint`, `reload`. Buttons reuse the existing `app.retry` and
`lobby.cancel`.

## Testing

`bun test` (plain TS, no Vue rendering in this repo's suite):

- `replayPlayer`: returns `null` when `fetch` rejects and `[]` on an empty
  successful response — the distinction the UI depends on.
- `useGameSocket`: `offline` flips true exactly at `OFFLINE_AFTER_MS` and clears on
  `onopen`, driven by a stub `WebSocket` and fake timers. Same test asserts the
  reconnect counters are untouched by the new timer.

Manual pass in a dev build with `api.wheee.io` blocked (DevTools → Network → block
request domain) — the exact condition from the moderator's sandbox — covering the
lobby line, the Play card, the leaderboard, the replay list and the boot screen.

## Risks

The one regression this design had to design around is the Play timeout cancelling
a slow-but-successful connect; resolved by never clearing `pendingAction` on
timeout (see **a**). Everything else is additive: new refs, new render branches, and
`catch` blocks where an unhandled rejection sits today.
