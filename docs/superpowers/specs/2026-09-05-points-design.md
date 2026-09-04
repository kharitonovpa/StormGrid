# Match points — design

Date: 2026-09-05

## Problem

The only progression a player has is a leaderboard sorted by wins, and it only
exists for signed-in accounts. Wins reward volume (the top row is whoever
played most), draws count for nothing although they are a third of new-player
matches, and bot matches (about two thirds of all matches) count the same as
human ones. A guest — most players — sees nothing at all after a match except
**Play again**.

The point of a points system here is not a fairer top ten. It is a personal
number that always grows, shown to every player including guests, so a
30-second match leaves something behind.

## Formula

One pure function on the server, `packages/server/src/points.ts`:

```ts
export type PointsInput = {
  result: 'win' | 'draw' | 'loss'
  /** Round the match ended in (GameState.round at game end, 1-based). */
  rounds: number
  vsBot: boolean
  /** This player lost by dropping the connection. */
  ownDisconnect: boolean
}
export function pointsFor(i: PointsInput): number
```

| Term | Points |
|---|---|
| Win | 10 |
| Draw | 3 |
| Loss | 1 |
| Survival: each round survived after the first | +2 × (rounds − 1) |
| Against a bot | the sum halved, rounded up |
| Own disconnect | 0 (nothing to reward; the opponent's win is unaffected) |
| Tutorial (practice) | not scored — `Room.saveReplay` already returns before `onMatchEnd` |

Examples: round-1 win vs bot = 5; round-1 loss vs human = 1; round-3 draw vs
human = 7; round-4 win vs human = 16. Surviving storms is worth more than
beating a bot once. Points never go down.

Draw stays above loss on purpose: a draw is "neither built shelter", a loss is
"the opponent did and you did not". The table is the only place to change
that.

## Storage

Migration `0010_add_points.sql`:

- `user_stats.points integer not null default 0`, plus index `user_stats_points_idx`.
- `device_points (device_id text primary key, points integer not null default 0, matches integer not null default 0, updated_at integer not null)` — the guest's copy, keyed by the same device id the analytics identity carries, mirroring `device_streaks`.

`packages/server/src/db/pointsStore.ts`:

```ts
export function awardPoints(deviceId: string, userId: string | null, earned: number): { total: number }
export function getPoints(deviceId: string | null, userId: string | null): number
```

`awardPoints` adds to the device row always and to `user_stats.points` when a
user id is present, in one transaction, and returns the total the player sees:
the user total when signed in, else the device total. `getPoints` reads the
same way. Signing in does not migrate device points onto the account (a later
"claim" step if ever wanted); the account starts its own count.

No backfill from the `matches` table: everyone starts from zero at deploy and
W/L stays visible as history. (A backfill would be wrong anyway — `vs_bot`
only exists since Aug 20.)

## Wire

`onMatchEnd` currently returns nothing. It gains a return value so the award
can ride inside `game:end`, the one message the game-over card is drawn from:

```ts
// Room.ts callbacks
onMatchEnd?: (data: MatchEndData, replay: ReplayData) => Partial<Record<PlayerId, PointsAward>> | void
// shared/src/protocol.ts
export type PointsAward = { earned: number; total: number }
export type GameEndMsg = { type: 'game:end'; winner; deathCauses?; rematchOffered?: boolean; points?: PointsAward }
export type PointsTotalMsg = { type: 'points:total'; total: number }
```

`Room` sends `game:end` per player (`sendEach`) with that player's award, and
the plain message (no `points`) to spectators. Both `game:end` sites — the
weather ending and the forfeit ending — go through the same helper.

On socket open the server sends `points:total` computed from the socket's user
id and analytics device id, so the lobby shows the number before any match.
Old clients ignore unknown message types already (`useGameState` switch has a
default).

`index.ts` `onMatchEnd`: for each human slot, `pointsFor(...)` from `winner`,
`rounds`, `vsBot`, and `deathCauses[pid].type === 'disconnect'`, then
`awardPoints(deviceId, userId, earned)`; returns the map. Wrapped in the same
try/catch pattern as the neighbouring stores — a DB failure logs and returns
`{}`, never breaks the ending.

## Client

`packages/client/src/lib/points.ts`: `total` (ref), `lastAward` (ref), fed by
`points:total` and `game:end.points`; `total` is persisted through
`lib/storage.ts` (`wheee:points-v1`) so the lobby can draw it before the
socket connects, and overwritten by the server's number as soon as it arrives.

UI:

- **Lobby**: next to the online counter, a chip `★ 123` for the local player,
  shown once `total > 0`. Tooltip/title: "Your points".
- **Game-over card**: the stat row gets a highlighted chip `+7 ★` first; the
  stat row is already there from the playtest-fixes work.
- **Leaderboard**: rows show `★ 123` where W/L is now, with `12W 3L` moved to
  a smaller secondary run; the list is sorted by `points desc, wins desc, userId`.
  `PlayerLeaderboardEntry` gains `points: number`.

Copy: no plural forms — the star carries the unit. i18n keys:
`points.yours` ("Your points" / "Ваши очки"), `points.earned` ("+{0} ★").

## Tests

- `points.test.ts` (server): every row of the table, the bot halving with
  rounding, disconnect zero, and that survival is counted from round 2.
- `pointsStore` in `db.test.ts`: device-only award, device+user award, totals
  read back for guest and for user, transaction atomicity not asserted.
- `game-end-rematch.test.ts` grows a case: with an `onMatchEnd` that returns
  awards, each human's `game:end` carries its own `points`, the other's is
  absent from it.
- Leaderboard sort by points in `db.test.ts`.
- Client `points.test.ts`: total persists and is replaced by a server value.

## Out of scope

Rating that can go down, seasons, claiming device points on sign-in, a points
history screen.
