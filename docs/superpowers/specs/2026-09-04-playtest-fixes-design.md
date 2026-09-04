# Playtest fixes: fast bot, game-over screen, portrait camera, lobby cleanup — design

Date: 2026-09-04

## Problem

A headless playtest of prod (8 matches, desktop RU + mobile EN, bot and PvP)
surfaced four things that make the first session feel worse than the game is:

1. **The 8-second bot window never applies.** `countIdleHumans` (`index.ts:194`)
   counts every open socket without a room, so one tab parked on the lobby —
   the owner's own, a visitor who has not pressed Play, someone who walked away
   — holds the 30 s window for everybody. All solo queues in the playtest
   waited 31 s for a bot with "3 online"; the match itself lasted 30–43 s.
2. **The game-over card is empty.** Title, one-line cause, three buttons. No
   rounds survived, no badge streak, nothing that says what happened or what
   is next. The **Реванш** button pops in after the card is already up and
   shifts its neighbours. On win, the card covers the winner and the fireworks
   land in a corner of the screen.
3. **Portrait phones get a sliver of board.** At 390×844 the board is a diamond
   roughly 24 % of the viewport height, with the upper half of the screen
   empty; in the lobby the demo board sits behind the character cards and the
   top 500 px are black.
4. **Lobby noise.** Wind and rain particles keep drifting behind the queue after
   **Ещё раз**; **Sign In** wraps onto two lines on EN desktop at 1280 px;
   "Recent" lists crop names ("Пшеница vs Пшеница, B победил") instead of
   the players' names; the owner's own accounts occupy three of the top five
   leaderboard rows.

Explicitly out of scope (owner's call): round-1 lethality / stalemate rules,
opponent-edit highlighting, starting terrain.

## 1. Fast bot: idle means an active tab

### Client

`useGameSocket` already sends `{ type: 'ping' }` every 25 s. The ping gains an
optional field:

```ts
export type PingMsg = { type: 'ping'; active?: boolean }
```

`active` is `true` when `document.visibilityState === 'visible'` **and** there
was pointer/key/touch input within the last 60 s. A client-side
`lib/presence.ts` owns this: it listens for `pointerdown`, `keydown`,
`touchstart` and `visibilitychange`, exposes `isActive(): boolean`, and calls a
subscriber on transitions so the socket can send an immediate ping when the tab
becomes visible again or goes hidden (rate limiting tolerates the extra
message; transitions are rare).

### Server

`WsData` gains `lastActiveAt: number` (0 on connect). On `ping` with
`active === true`, `ws.data.lastActiveAt = Date.now()`. On `ping` with
`active === false` nothing is written (the timestamp ages out).

`countIdleHumans` counts a socket only when it has no room **and**
`Date.now() - lastActiveAt < IDLE_HUMAN_WINDOW_MS` (90 s: three heartbeats).

**Legacy clients** — portal builds still shipping the old bundle send pings
without `active`. They keep the status quo: a legacy ping is treated as
`active: true`. So nothing gets worse for anyone until the portal archives are
re-uploaded, at which point the flag reaches everyone.

The `on connect` handshake counts as activity (`lastActiveAt = now`), so a
freshly opened tab is a potential opponent for its first 90 s even before the
first heartbeat.

### Tests

- `matchmaking-delay.test.ts` is untouched (it injects `countIdleHumans`).
- New `presence.test.ts` (server): a fake socket set that exercises the index
  counter extracted into `countIdleHumans(clients, exclude, now)` — pure
  function, no sockets: recent activity counts, stale does not, in-room does
  not, the queuer is excluded, legacy (`active` undefined) counts.
- New client `presence.test.ts`: visibility hidden → inactive; input → active;
  no input for 60 s → inactive; subscriber fires on transitions only.

## 2. Game-over card

### Content

Below the title and the existing cause line, a **stats strip** of two or three
chips:

| Chip | Source | Shown when |
|---|---|---|
| Rounds survived, e.g. `Раунд 3` | `game.gameState.round` at `game:end` | always |
| Match length, e.g. `1:24` | client clock from `game:start` to `game:end` | always |
| Badge streak, e.g. `🍃 3` | `lib/streak.ts` after the result is settled | streak > 0 |

No W/L totals: the client has no endpoint for them and guests have none.

### Rematch does not pop in

`GameEndMsg` gains `rematchOffered?: boolean`, set by the server from
`humanPair` in the same place it fires `onRematchReady` (`Room.ts:929`). The
client sets `rematchState = 'available'` from `game:end` when the flag is true.
`rematch:available` keeps being sent and handled, so an older client is
unaffected; a newer client simply learns the answer atomically with the result,
and the card renders its button row once, complete.

### The board stays visible

The card anchors to the lower part of the viewport instead of the centre:
`align-items: flex-end` with a bottom inset of 8 vh (landscape) / 6 vh
(portrait, above the safe area). The board — and the survivor on it — remains
in view above the card. Fireworks on win aim at the upper 55 % of the viewport
(the visible board), not at the card.

### Tests

`GameOverOverlay.test.ts` (client, existing test harness): renders the chips
from props; hides the streak chip at 0; renders **Реванш** on first mount when
`rematchState === 'available'`.

## 3. Portrait camera

### Match

`fitCameraToBoard` today only pulls the camera back when `aspect < 1.2`, along
whatever direction it already has (elevation ≈ 30°). A diamond seen from 30°
is wide and flat; on a portrait screen that fits the width and wastes the
height.

Change: the rest direction is a function of aspect.

```ts
const REST_AZIMUTH = Math.atan2(30, 30)          // unchanged, NW-horizon view
const REST_ELEVATION_LANDSCAPE = Math.atan2(25, Math.hypot(30, 30))  // ≈ 30.5°
const REST_ELEVATION_PORTRAIT = 52°               // aspect < 0.9
```

`fitCameraToBoard` builds the direction from the azimuth and the elevation
chosen by aspect, then runs the existing corner-fit loop. At 52° the diamond's
screen height grows from ≈ 0.5 to ≈ 0.79 of its width; on a 390×844 screen the
board goes from ≈ 24 % to ≈ 38 % of the viewport height with the same tap
targets scaled up. Landscape output is unchanged (the loop is a no-op there).

The forecast sky (storm dome) is direction-based and unaffected by elevation;
the NW horizon strip stays in frame.

Callers: the initial setup (`App.vue:1765`) and `onResize` (`App.vue:2266`).
`animateCameraToSide` (flip) mirrors `y` and keeps working. A resize while the
player has orbited snaps back to rest — acceptable, resizing is rare.

### Lobby

The lobby panel covers the lower ≈ 65 % of a portrait screen, so the demo board
is hidden. On portrait while `phase` is `lobby` / `queue` / `friend_wait`, the
camera applies `camera.setViewOffset(w, h, 0, 0.22 * h, w, h)`, which slides the
render up so the board centre sits at ≈ 28 % of the viewport, in the empty area
under the title. The offset is cleared (`clearViewOffset`) on `game:start`,
replay start and watcher join, and re-applied on return to the lobby. Nothing
about the demo orbit changes.

### Radial menu

On `max-width: 640px` the radial buttons drop from 56 px to 48 px and the ring
radius follows, so the three-button fan no longer covers a third of the board.

### Tests

Camera maths: `lib/cameraRest.ts` exports `restDirection(aspect)` — pure,
unit-tested for both aspects (elevation, azimuth preserved). The fit loop and
view offset are exercised by the existing App wiring; no headless WebGL test.

## 4. Lobby cleanup

### Particles after Ещё раз

`doPlayAgain` skips `resetVisuals()` on purpose (the crystal is cleared by hand)
but leaves wind and rain systems visible. It now also hides them and drains the
storm: `windSystem.setVisible(false)`, `rainSystem.setVisible(false)`,
`stormSystem.discharge('fast')`, `audio.setStormAmbience(false)`. Extracted
into `stopStormVisuals()` and called from both `resetVisuals` and
`doPlayAgain`.

### Sign In wrap

`.btn-signin { white-space: nowrap }`.

### Recent shows names

`ReplaySummary` gains `nameA?: string; nameB?: string` (the `PlayerInfo.displayName`
values the room already holds). `Room.saveReplay` fills them; `ReplayStore`
keeps them in memory; the `replays` table gets `name_a`, `name_b` (nullable,
migration `0009_add_replay_names.sql`); `listReplays` returns them. The lobby
renders `nameA vs nameB` and `won` with the winner's name; rows without names
(older replays) fall back to the current crop labels. `lobby.won` keeps its
`{0}` slot, so no i18n change beyond nothing.

### Hidden leaderboard accounts

`LEADERBOARD_EXCLUDE_USERS` — comma-separated `users.id` values — read once at
boot next to `STATS_EXCLUDE_DEVICES`. `getPlayerLeaderboard` and
`getWatcherLeaderboard` add `user_id NOT IN (...)` to both the page query and
the total. Stats are still recorded; only the public board hides the rows.
Documented in `.env.example`.

### Tests

- `matchStore` leaderboard test: excluded id absent, total decremented.
- `listReplays` returns names when present and `undefined` when the column is
  null.
- Lobby recent-row rendering: names preferred, crop fallback.

## Rollout

Server and client ship together (protocol additions are optional fields, so
either order is safe). Portal archives need re-uploading to get the presence
flag and the portrait camera; until then legacy pings count as active.
