# Playtest Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 8-second bot window actually apply, give the game-over card content, frame the board properly on portrait phones, and clean four lobby annoyances (particle leak, Sign In wrap, crop names in Recent, owner accounts in the top).

**Architecture:** Spec: `docs/superpowers/specs/2026-09-04-playtest-fixes-design.md`. Bun monorepo: `packages/shared` (protocol types), `packages/server` (Bun + Hono + Drizzle/SQLite, `Room.ts` runs a match, `matchmaking.ts` owns the queue, `index.ts` wires sockets), `packages/client` (Vue 3 + three.js, `App.vue` is the 3-k-line hub, `composables/useGameSocket.ts` speaks the protocol, `lib/*` are plain modules). Every new piece of logic goes into a small pure module with a `bun test` next to it; `App.vue` / `.vue` components only get wiring.

**Tech Stack:** TypeScript, Bun (`bun test`), Vue 3 `<script setup>`, three.js, Drizzle ORM migrations in `packages/server/drizzle`.

## Global Constraints

- Protocol additions are optional fields only (`active?`, `rematchOffered?`, `nameA?`, `nameB?`) so old clients and old portal builds keep working.
- A legacy `ping` without `active` counts as active (status quo).
- Idle window `IDLE_HUMAN_WINDOW_MS = 90_000`; client activity window `ACTIVITY_WINDOW_MS = 60_000`.
- Portrait means `aspect < 0.9`; portrait rest elevation 52°, azimuth unchanged (camera at `(30, 25, 30)` direction).
- Lobby portrait view offset: `0.22 * h` upward.
- Radial buttons on `max-width: 640px`: 48 px.
- Migration file `packages/server/drizzle/0009_add_replay_names.sql`, journal idx 9, tag `0009_add_replay_names`.
- Env var `LEADERBOARD_EXCLUDE_USERS` (comma-separated `users.id`), documented in `deploy/.env.example` next to `STATS_EXCLUDE_DEVICES`.
- Tests: server `cd packages/server && bun test`, client `cd packages/client && bun test`. Client tests have no DOM: pure modules take their environment as parameters.
- Commit after every task; message body ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Work in worktree `.claude/worktrees/playtest-fixes`, branch `playtest-fixes`.

---

### Task 1: Server presence — idle means a recently active tab

**Files:**
- Modify: `packages/shared/src/protocol.ts:47` (`PingMsg`)
- Modify: `packages/server/src/protocol.ts:214-225` (`WsData`), `:134` (ping parse)
- Create: `packages/server/src/presence.ts`
- Modify: `packages/server/src/index.ts:190-201` (`countIdleHumans`), `:510-514` (open), `:545-548` (ping)
- Test: `packages/server/src/__tests__/presence.test.ts`, `packages/server/src/__tests__/protocol.test.ts`

**Interfaces:**
- Produces: `PingMsg = { type: 'ping'; active?: boolean }`; `WsData.lastActiveAt: number`; `countIdleHumans(clients: Iterable<PresenceClient>, exclude: PresenceClient | null, now: number): number` and `IDLE_HUMAN_WINDOW_MS` from `presence.ts`.

- [ ] **Step 1: Write the failing presence test**

```ts
// packages/server/src/__tests__/presence.test.ts
import { describe, it, expect } from 'bun:test'
import { countIdleHumans, IDLE_HUMAN_WINDOW_MS, type PresenceClient } from '../presence.js'

function client(over: Partial<PresenceClient> = {}): PresenceClient {
  return { readyState: 1, data: { roomId: null, lastActiveAt: 1_000_000 }, ...over } as PresenceClient
}

/*
 * The bot-fallback window is short only when nobody is around to wait for. A
 * socket counts as "around" when it has no room and reported activity inside
 * the idle window — a tab parked on the lobby for an hour is not an opponent.
 */
describe('countIdleHumans', () => {
  const now = 1_000_000 + 10_000

  it('counts a lobby socket active within the window', () => {
    expect(countIdleHumans([client()], null, now)).toBe(1)
  })

  it('ignores a socket whose activity is older than the window', () => {
    const stale = client({ data: { roomId: null, lastActiveAt: now - IDLE_HUMAN_WINDOW_MS - 1 } })
    expect(countIdleHumans([stale], null, now)).toBe(0)
  })

  it('counts activity exactly at the window edge', () => {
    const edge = client({ data: { roomId: null, lastActiveAt: now - IDLE_HUMAN_WINDOW_MS + 1 } })
    expect(countIdleHumans([edge], null, now)).toBe(1)
  })

  it('ignores sockets in a room and closed sockets', () => {
    const playing = client({ data: { roomId: 'room-1', lastActiveAt: now } })
    const closed = client({ readyState: 3 })
    expect(countIdleHumans([playing, closed], null, now)).toBe(0)
  })

  it('excludes the queuer themself', () => {
    const me = client()
    const other = client()
    expect(countIdleHumans([me, other], me, now)).toBe(1)
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/server && bun test src/__tests__/presence.test.ts`
Expected: FAIL, cannot resolve `../presence.js`.

- [ ] **Step 3: Implement `presence.ts`**

```ts
// packages/server/src/presence.ts
/**
 * Who is a potential opponent. The matchmaking bot window is short when the
 * queuer is alone and long when another human might still press Play — and
 * "might" needs a heartbeat: a tab left open on the lobby is not a human.
 *
 * Activity comes from the client's ping (`active: true` while the tab is
 * visible and recently touched). A ping without the flag is an old client;
 * it keeps the pre-flag behaviour and counts as active.
 */
export const IDLE_HUMAN_WINDOW_MS = 90_000

export type PresenceClient = {
  readyState: number
  data: { roomId: string | null; lastActiveAt: number }
}

export function countIdleHumans(
  clients: Iterable<PresenceClient>,
  exclude: PresenceClient | null,
  now: number,
): number {
  let n = 0
  for (const ws of clients) {
    if (ws === exclude || ws.readyState !== 1 || ws.data.roomId !== null) continue
    if (now - ws.data.lastActiveAt < IDLE_HUMAN_WINDOW_MS) n++
  }
  return n
}
```

- [ ] **Step 4: Run the test, expect PASS**

Run: `cd packages/server && bun test src/__tests__/presence.test.ts`

- [ ] **Step 5: Add the protocol field and parse test**

In `packages/shared/src/protocol.ts` replace line 47:

```ts
/** `active` — the tab is visible and was touched within the last minute. Absent on old clients. */
export type PingMsg = { type: 'ping'; active?: boolean }
```

Append to `packages/server/src/__tests__/protocol.test.ts`:

```ts
describe('parseClientMessage — ping presence flag', () => {
  it('accepts a bare ping (old client)', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'ping' }))).toEqual({ type: 'ping' })
  })

  it('accepts a boolean active flag', () => {
    const msg = parseClientMessage(JSON.stringify({ type: 'ping', active: false }))
    expect(msg).toEqual({ type: 'ping', active: false })
  })

  it('rejects a non-boolean active flag', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'ping', active: 'yes' }))).toBeNull()
  })
})
```

Run: `cd packages/server && bun test src/__tests__/protocol.test.ts` — the third case fails (currently anything passes through for `ping`).

- [ ] **Step 6: Validate the flag in the server parser**

In `packages/server/src/protocol.ts`, the switch currently has `case 'ping': return msg` grouped with architect messages (line ~134). Split it out:

```ts
      case 'ping':
        if ('active' in msg && typeof (msg as { active?: unknown }).active !== 'boolean') return null
        return msg
```

Add to `WsData` (line ~221, after `role`):

```ts
  /** Last moment this socket reported an active tab (`ping.active`); see presence.ts. */
  lastActiveAt: number
```

Run the protocol test again: PASS. Run `bun run --cwd packages/server tsc --noEmit` (or `bunx tsc -p packages/server --noEmit`) to find every place that constructs `WsData` — the upgrade handler in `index.ts` builds the object; add `lastActiveAt: Date.now()` there (a fresh connection is activity).

- [ ] **Step 7: Wire `index.ts`**

Replace the inline counter at `index.ts:190-201`:

```ts
import { countIdleHumans } from './presence.js'
// ...
const matchmaking = new Matchmaking(roomManager, {
  // Idle = connected, in the lobby (no room), and recently active — see presence.ts.
  countIdleHumans(exclude) { return countIdleHumans(allClients, exclude, Date.now()) },
  onLoneWaiter: queueAlert,
})
```

In the `ping` case (line ~545):

```ts
        case 'ping': {
          // Absent flag = old client: keep counting it as a live human.
          if (msg.active !== false) ws.data.lastActiveAt = Date.now()
          send(ws, { type: 'pong' })
          break
        }
```

Fix the fake `WsData` in `__tests__/matchmaking-delay.test.ts` `makeFakeWs()` and any other test fakes if the type check complains (add `lastActiveAt: 0`).

- [ ] **Step 8: Run the whole server suite and type check**

Run: `cd packages/server && bun test && bunx tsc --noEmit -p .`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/protocol.ts packages/server/src
git commit -m "Count only recently active tabs as potential opponents

The 8-second bot window never applied: any socket parked on the lobby held
the 30-second one for everyone. The client's ping now carries an active flag
and the idle-human counter only counts sockets active in the last 90 s.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Client presence — report the active flag

**Files:**
- Create: `packages/client/src/lib/presence.ts`
- Test: `packages/client/src/lib/__tests__/presence.test.ts`
- Modify: `packages/client/src/composables/useGameSocket.ts:112-115` (heartbeat), `:285-315` (return)
- Modify: `packages/client/src/App.vue` (call `installPresence` once next to the socket setup, ~line 296)

**Interfaces:**
- Consumes: `PingMsg.active` (Task 1).
- Produces: `createPresence(env: PresenceEnv): Presence` with `Presence = { isActive(): boolean; noteInput(now?: number): void; setVisible(v: boolean): void; onChange(fn: (active: boolean) => void): () => void }`, `ACTIVITY_WINDOW_MS`, and `installPresence(presence: Presence, doc: Document, win: Window): () => void` which binds DOM listeners.

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/lib/__tests__/presence.test.ts
import { describe, it, expect } from 'bun:test'
import { createPresence, ACTIVITY_WINDOW_MS } from '../presence.js'

/*
 * The server only waits for humans who are actually there. "There" = the tab
 * is visible and was touched within the activity window. The module knows
 * nothing about the DOM — time and visibility come in through the env.
 */
describe('presence', () => {
  function make(start = 100_000) {
    let now = start
    const p = createPresence({ now: () => now })
    return { p, tick: (ms: number) => { now += ms } }
  }

  it('starts active: a fresh page load is a person looking at it', () => {
    const { p } = make()
    expect(p.isActive()).toBe(true)
  })

  it('goes inactive once the activity window passes without input', () => {
    const { p, tick } = make()
    tick(ACTIVITY_WINDOW_MS + 1)
    expect(p.isActive()).toBe(false)
  })

  it('input keeps it active', () => {
    const { p, tick } = make()
    tick(ACTIVITY_WINDOW_MS - 1)
    p.noteInput()
    tick(ACTIVITY_WINDOW_MS - 1)
    expect(p.isActive()).toBe(true)
  })

  it('a hidden tab is inactive regardless of input', () => {
    const { p } = make()
    p.setVisible(false)
    p.noteInput()
    expect(p.isActive()).toBe(false)
  })

  it('notifies on transitions only', () => {
    const { p, tick } = make()
    const seen: boolean[] = []
    p.onChange((a) => seen.push(a))
    p.setVisible(false)
    p.setVisible(false)
    p.setVisible(true)
    tick(ACTIVITY_WINDOW_MS + 1)
    p.noteInput()          // inactive -> active (timer-based inactivity is observed lazily here)
    expect(seen).toEqual([false, true, true])
  })
})
```

Note on the last case: `setVisible(true)` after `tick` is not called, so the sequence is: hide → `false`; hide again → nothing; show → `true`; the window passes silently (no timer in the pure module); `noteInput` re-evaluates and, because the last *notified* state was `true`, emits nothing — so the expected array is `[false, true]`. Use `expect(seen).toEqual([false, true])` and drop the misleading comment. (Written out so the implementer does not "fix" the module to emit spurious events.)

- [ ] **Step 2: Run it, expect failure**

Run: `cd packages/client && bun test src/lib/__tests__/presence.test.ts`

- [ ] **Step 3: Implement**

```ts
// packages/client/src/lib/presence.ts
/**
 * Are we a potential opponent right now? Sent with every ping so the server
 * can hand a lone queuer a bot quickly when the only other tabs are parked.
 * Pure: time and visibility arrive through the env, the DOM is bound by
 * installPresence().
 */
export const ACTIVITY_WINDOW_MS = 60_000

export type PresenceEnv = { now: () => number }

export type Presence = {
  isActive(): boolean
  noteInput(): void
  setVisible(visible: boolean): void
  /** Fires when isActive() flips as a result of noteInput/setVisible. Returns unsubscribe. */
  onChange(fn: (active: boolean) => void): () => void
}

export function createPresence(env: PresenceEnv): Presence {
  let lastInput = env.now()
  let visible = true
  let lastNotified = true
  const subs = new Set<(active: boolean) => void>()

  function isActive() {
    return visible && env.now() - lastInput < ACTIVITY_WINDOW_MS
  }
  function notify() {
    const a = isActive()
    if (a === lastNotified) return
    lastNotified = a
    for (const fn of subs) fn(a)
  }
  return {
    isActive,
    noteInput() { lastInput = env.now(); notify() },
    setVisible(v) { visible = v; notify() },
    onChange(fn) { subs.add(fn); return () => { subs.delete(fn) } },
  }
}

/** Binds the DOM: pointer/key/touch mark input, visibilitychange marks visibility. */
export function installPresence(presence: Presence, doc: Document, win: Window): () => void {
  const onInput = () => presence.noteInput()
  const onVis = () => presence.setVisible(doc.visibilityState === 'visible')
  win.addEventListener('pointerdown', onInput, { passive: true })
  win.addEventListener('keydown', onInput)
  win.addEventListener('touchstart', onInput, { passive: true })
  doc.addEventListener('visibilitychange', onVis)
  onVis()
  return () => {
    win.removeEventListener('pointerdown', onInput)
    win.removeEventListener('keydown', onInput)
    win.removeEventListener('touchstart', onInput)
    doc.removeEventListener('visibilitychange', onVis)
  }
}
```

- [ ] **Step 4: Run the test, expect PASS**

- [ ] **Step 5: Send the flag from the socket**

`useGameSocket.ts` has no access to the presence object; give it one through a module-level singleton in `presence.ts`:

```ts
export const presence: Presence = createPresence({ now: () => Date.now() })
```

In `useGameSocket.ts`:

```ts
import { presence } from '../lib/presence'
// ...
  function sendPing() { send({ type: 'ping', active: presence.isActive() }) }

  function startHeartbeat() {
    stopHeartbeat()
    heartbeatTimer = setInterval(sendPing, HEARTBEAT_MS)
  }
```

And once, at composable creation (next to the other module-level state, before `return`): `presence.onChange(() => sendPing())` so a tab that comes back is counted within a second rather than after the next heartbeat. Guard against double subscription if `useGameSocket()` can be called more than once: keep the unsubscribe in a module-level `let presenceUnsub: (() => void) | null` and call it before subscribing.

In `App.vue`, in `onMounted` near where the socket connects, add:

```ts
import { presence, installPresence } from './lib/presence'
// onMounted:
const uninstallPresence = installPresence(presence, document, window)
// onUnmounted:
uninstallPresence()
```

- [ ] **Step 6: Type check and test**

Run: `cd packages/client && bun test && bunx vue-tsc --noEmit` (if `vue-tsc` is not installed, `bun run build` is the type gate — check `package.json` scripts and use whichever exists).

- [ ] **Step 7: Commit**

```bash
git add packages/client/src
git commit -m "Report tab activity with the heartbeat

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Game-over card — stats chips, atomic rematch, board stays visible

**Files:**
- Modify: `packages/shared/src/protocol.ts:98` (`GameEndMsg`)
- Modify: `packages/server/src/Room.ts:924-931` (build `endMsg` with `rematchOffered`)
- Modify: `packages/server/src/__tests__/matchmaking-rematch.test.ts` (or `match-result.test.ts`, whichever drives a room to `game:end` with two humans) — assert the flag
- Create: `packages/client/src/lib/matchSummary.ts`
- Test: `packages/client/src/lib/__tests__/matchSummary.test.ts`
- Modify: `packages/client/src/App.vue:296-330` (game:start → `matchStartedAt`), `:355-380` (game:end → `rematchOffered`, `matchStats`), `:2471-2493` (props)
- Modify: `packages/client/src/components/GameOverOverlay.vue` (props, chips row, card anchor, fireworks)
- Modify: `packages/client/src/lib/i18n.ts` (keys in `en` block after `'gameover.backToLobby'`, and mirrored in `ru`)

**Interfaces:**
- Produces: `GameEndMsg = { type: 'game:end'; winner; deathCauses?; rematchOffered?: boolean }`; `formatDuration(ms: number): string` and `MatchStats = { round: number; durationMs: number; streak: number }` from `matchSummary.ts`; overlay prop `stats?: MatchStats | null`.

- [ ] **Step 1: Server — write the failing test**

Find the existing test that drives two human sockets through a whole match and reads `game:end` (grep `'game:end'` in `packages/server/src/__tests__/`). Add next to it:

```ts
  it('game:end tells both humans a rematch is on the table', () => {
    // reuse the room/socket fixture of the surrounding describe
    const end = a.messages.find((m) => m.type === 'game:end') as { rematchOffered?: boolean }
    expect(end.rematchOffered).toBe(true)
  })

  it('game:end against a bot carries no rematch offer', () => {
    // fixture with a bot in slot B
    const end = a.messages.find((m) => m.type === 'game:end') as { rematchOffered?: boolean }
    expect(end.rematchOffered).toBeUndefined()
  })
```

If no fixture reaches `game:end` with a bot, use the `Room` directly with `botStrength` as `matchmaking-rematch.test.ts` does for the human case, and skip the bot case only if building the fixture takes more than the test is worth — the human case is the one that matters.

- [ ] **Step 2: Run, expect failure**

Run: `cd packages/server && bun test src/__tests__/matchmaking-rematch.test.ts`

- [ ] **Step 3: Server implementation**

`packages/shared/src/protocol.ts:98`:

```ts
/** `rematchOffered` — a PvP ending with both humans still here; a `rematch:available` follows for old clients. */
export type GameEndMsg = { type: 'game:end'; winner: PlayerId | 'draw'; deathCauses?: Partial<Record<PlayerId, DeathCause>>; rematchOffered?: boolean }
```

`Room.ts:924-931`:

```ts
      // Read before the slots are released, so the pair is still nameable.
      const pair = this.humanPair
      const endMsg: ServerMessage = {
        type: 'game:end',
        winner: result.state.winner,
        deathCauses: result.deathCauses,
        ...(pair ? { rematchOffered: true } : {}),
      }
      this.broadcast(endMsg)
      this.broadcastSpectators(endMsg)
      this.releasePlayerSlots()
      if (pair) this.callbacks.onRematchReady?.(this.id, pair[0], pair[1], this.lightningEnabled)
```

There is a second `game:end` path for disconnect forfeits (`Room.ts:531` area, `saveReplay(opponent, dcCauses)`); a forfeit has no pair, leave it alone.

Run the server tests: PASS. Commit:

```bash
git add packages/shared packages/server
git commit -m "Carry the rematch offer inside game:end

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: Client — failing test for the summary helpers**

```ts
// packages/client/src/lib/__tests__/matchSummary.test.ts
import { describe, it, expect } from 'bun:test'
import { formatDuration, streakChip } from '../matchSummary.js'

describe('formatDuration', () => {
  it('renders minutes:seconds', () => {
    expect(formatDuration(84_000)).toBe('1:24')
  })
  it('pads seconds', () => {
    expect(formatDuration(65_000)).toBe('1:05')
  })
  it('renders sub-minute as 0:ss', () => {
    expect(formatDuration(31_400)).toBe('0:31')
  })
  it('never goes negative', () => {
    expect(formatDuration(-5)).toBe('0:00')
  })
})

describe('streakChip', () => {
  it('is empty at zero', () => {
    expect(streakChip(0)).toBe('')
  })
  it('is badge + count otherwise', () => {
    expect(streakChip(3)).toBe('💨 3')
  })
})
```

(`badgeFor(3)` is `'💨'` per `shared/src/constants.ts:69` — verify and adjust the literal if the ladder differs.)

- [ ] **Step 5: Run, expect failure; implement**

```ts
// packages/client/src/lib/matchSummary.ts
import { badgeFor } from '@wheee/shared'

/** What the game-over card shows under the cause line. */
export type MatchStats = {
  round: number
  durationMs: number
  /** Badge streak after the result is settled; 0 = no chip. */
  streak: number
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function streakChip(streak: number): string {
  const badge = badgeFor(streak)
  return badge ? `${badge} ${streak}` : ''
}
```

Run: `cd packages/client && bun test src/lib/__tests__/matchSummary.test.ts` — PASS.

- [ ] **Step 6: i18n keys**

In `i18n.ts`, after `'gameover.backToLobby': 'Back to lobby',` (en) add:

```ts
    'gameover.statRound': 'Round {0}',
    'gameover.statTime': '{0}',
```

and in `ru` after `'gameover.backToLobby'`:

```ts
    'gameover.statRound': 'Раунд {0}',
    'gameover.statTime': '{0}',
```

- [ ] **Step 7: App.vue wiring**

Near `lastRoomId` declarations add `let matchStartedAt = 0` and `const matchStats = ref<MatchStats | null>(null)`; import `type MatchStats` from `./lib/matchSummary`.

In the `game:start` handler (`:313`): `matchStartedAt = Date.now(); matchStats.value = null`.

In the `game:end` handler, right after `settleStreak(msg)` (`:361`):

```ts
    if ((msg as { rematchOffered?: boolean }).rematchOffered) rematchState.value = 'available'
    matchStats.value = {
      round: game.gameState.value?.round ?? 1,
      durationMs: matchStartedAt ? Date.now() - matchStartedAt : 0,
      streak: streak.value,
    }
```

(`streak` is already imported from `./lib/streak` for the queue join; confirm. `settleStreak` runs first so the chip shows the post-result number.)

Pass it: `:stats="matchStats"` on `<GameOverOverlay>`.

- [ ] **Step 8: Overlay — chips, anchor, fireworks**

Props: add `stats?: MatchStats | null` (import the type). Computed:

```ts
const chips = computed(() => {
  const s = props.stats
  if (!s) return []
  const out = [t('gameover.statRound', s.round), t('gameover.statTime', formatDuration(s.durationMs))]
  const sc = streakChip(s.streak)
  if (sc) out.push(sc)
  return out
})
```

Template, between `.result-sub` and `.btn-row`:

```html
      <div v-if="chips.length" class="stat-row">
        <span v-for="c in chips" :key="c" class="stat-chip">{{ c }}</span>
      </div>
```

Style:

```css
.stat-row {
  display: flex; justify-content: center; gap: 8px; flex-wrap: wrap;
  margin: -16px 0 24px;
  animation: fadeUp 0.5s 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.stat-chip {
  padding: 4px 10px; border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(200, 210, 225, 0.7);
  font-size: 12px; font-weight: 600; letter-spacing: 0.3px;
}
```

Anchor the card low so the board stays visible. In `.gameover` replace `align-items: center` with:

```css
  align-items: flex-end;
  padding-bottom: calc(8vh + var(--sg-safe-bottom, 0px));
```

and in the `@media (max-width: 640px)` block add `.gameover { padding-bottom: calc(6vh + var(--sg-safe-bottom, 0px)); }`. Check the card still clears the bottom on a 667-px-tall phone (portrait chips wrap, `btn-row` is already a column there); if the card is taller than ~60 vh on 640-wide, reduce `.gameover-card` padding to `24px 20px` in that media block.

Fireworks: in `launchFireworks()` change the initial burst centre to `const cy = h * 0.3` and the interval burst range to `const sy = h * 0.08 + Math.random() * h * 0.4` so they play over the board above the card.

- [ ] **Step 9: Type check, test, visual check**

Run: `cd packages/client && bun test && bun run build` (type gate).
Then `bun run dev` in `packages/server` and `packages/client`, play a practice match (How to play), and look at the card: chips present, card in the lower part, character visible above it. Screenshot at 1280×800 and 390×844 via the Playwright recipe in memory if a browser is not at hand.

- [ ] **Step 10: Commit**

```bash
git add packages/client/src
git commit -m "Give the game-over card its match: rounds, time, badge, atomic rematch

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Portrait camera

**Files:**
- Create: `packages/client/src/lib/cameraRest.ts`
- Test: `packages/client/src/lib/__tests__/cameraRest.test.ts`
- Modify: `packages/client/src/App.vue:940-978` (`fitCameraToBoard`), `:1761-1765` (setup), `:2260-2267` (`onResize`), lobby/game transitions for the view offset, `:3127-3129` (radial media query)

**Interfaces:**
- Produces: `restDirection(aspect: number): { x: number; y: number; z: number }` (unit vector), `isPortrait(aspect: number): boolean`, `LOBBY_PORTRAIT_OFFSET = 0.22`.

- [ ] **Step 1: Failing test**

```ts
// packages/client/src/lib/__tests__/cameraRest.test.ts
import { describe, it, expect } from 'bun:test'
import { restDirection, isPortrait } from '../cameraRest.js'

/*
 * The resting camera looks at the board from the same compass bearing on every
 * screen (the storm sky is read against the NW horizon), but on a portrait
 * phone it climbs higher so the diamond is taller on screen instead of a flat
 * sliver across the middle.
 */
describe('restDirection', () => {
  const landscape = restDirection(1.6)
  const portrait = restDirection(0.46)

  it('is a unit vector', () => {
    for (const d of [landscape, portrait]) {
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6)
    }
  })

  it('keeps the landscape bearing of (30, 25, 30)', () => {
    const len = Math.hypot(30, 25, 30)
    expect(landscape.x).toBeCloseTo(30 / len, 6)
    expect(landscape.y).toBeCloseTo(25 / len, 6)
    expect(landscape.z).toBeCloseTo(30 / len, 6)
  })

  it('keeps the azimuth on portrait', () => {
    expect(Math.atan2(portrait.z, portrait.x)).toBeCloseTo(Math.atan2(landscape.z, landscape.x), 6)
  })

  it('climbs to 52 degrees on portrait', () => {
    const elev = Math.asin(portrait.y)
    expect(elev * 180 / Math.PI).toBeCloseTo(52, 3)
  })

  it('switches at aspect 0.9', () => {
    expect(isPortrait(0.89)).toBe(true)
    expect(isPortrait(0.9)).toBe(false)
  })
})
```

- [ ] **Step 2: Run, expect failure; implement**

```ts
// packages/client/src/lib/cameraRest.ts
/** Where the camera rests, by screen shape. Direction only — distance is fitted in App.vue. */
const LANDSCAPE = { x: 30, y: 25, z: 30 }
const AZIMUTH = Math.atan2(LANDSCAPE.z, LANDSCAPE.x)
const ELEVATION_LANDSCAPE = Math.atan2(LANDSCAPE.y, Math.hypot(LANDSCAPE.x, LANDSCAPE.z))
const ELEVATION_PORTRAIT = 52 * Math.PI / 180
const PORTRAIT_ASPECT = 0.9
/** Fraction of the viewport height the lobby render slides up on portrait, out from under the panel. */
export const LOBBY_PORTRAIT_OFFSET = 0.22

export function isPortrait(aspect: number): boolean {
  return aspect < PORTRAIT_ASPECT
}

export function restDirection(aspect: number): { x: number; y: number; z: number } {
  const elev = isPortrait(aspect) ? ELEVATION_PORTRAIT : ELEVATION_LANDSCAPE
  const flat = Math.cos(elev)
  return { x: flat * Math.cos(AZIMUTH), y: Math.sin(elev), z: flat * Math.sin(AZIMUTH) }
}
```

Run the test: PASS.

- [ ] **Step 3: Use it in `fitCameraToBoard`**

Replace the head of the function (`App.vue:950-955`):

```ts
function fitCameraToBoard(cam: THREE.PerspectiveCamera) {
  const rest = restDirection(cam.aspect)
  const dir = new THREE.Vector3(rest.x, rest.y, rest.z)
  // Keep whichever side the player is looking from — flip mirrors y.
  if (cam.position.y < 0) dir.y = -dir.y
  let dist = cam.position.length() || Math.hypot(30, 25, 30)
  if (cam.aspect >= FIT_ASPECT && !isPortrait(cam.aspect)) {
    cam.position.copy(dir).multiplyScalar(dist)
    cam.lookAt(0, 0, 0)
    return
  }
```

and keep the corner-fit loop as is (it uses `dir` and `dist`). Import `restDirection, isPortrait, LOBBY_PORTRAIT_OFFSET` from `./lib/cameraRest`. Landscape output is identical to today's because the landscape direction equals the old `(30,25,30)` bearing and the early return path only re-normalises along it.

- [ ] **Step 4: Lobby view offset**

Add a helper next to `fitCameraToBoard`:

```ts
function applyLobbyViewOffset(cam: THREE.PerspectiveCamera, inLobby: boolean) {
  const el = renderer?.domElement
  if (!el) return
  const w = el.clientWidth, h = el.clientHeight
  if (inLobby && isPortrait(w / h)) cam.setViewOffset(w, h, 0, LOBBY_PORTRAIT_OFFSET * h, w, h)
  else cam.clearViewOffset()
}
```

Call it:
- in `onResize` (`:2261`) after `camera.updateProjectionMatrix()`: `applyLobbyViewOffset(camera, isLobbyPhase(game.phase.value))`;
- in a new watcher next to the phase watcher at `:126`: `watch(() => game.phase.value, (p) => { if (sceneCamera) applyLobbyViewOffset(sceneCamera, isLobbyPhase(p)) })`
- where `isLobbyPhase = (p: ClientPhase) => p === 'lobby' || p === 'queue' || p === 'friend_wait'` (check the exact `ClientPhase` union in `useGameState.ts:27` and include every pre-match lobby phase it has, e.g. `'friend_wait'`).
- once after the initial `fitCameraToBoard(camera)` at `:1765`.

`setViewOffset` changes the projection matrix, not the position, so `fitCameraToBoard` and the flip animation are unaffected. Replay and watcher entry go through phases other than the lobby ones, so the watcher clears the offset for them.

- [ ] **Step 5: Radial menu on phones**

`App.vue:3128`: `.radial-btn { width: 48px; height: 48px; }`. Find the ring radius used to place the buttons (grep `radius` near `menuStyle`/the `radial-btn` `:style` at `:1242`) and scale it in the same proportion (60 → 48 is ×0.8) when `window.innerWidth <= 640`; if the radius is a CSS custom property, set it in the same media block instead.

- [ ] **Step 6: Verify visually**

`bun run dev` both packages; open at 390×844 (DevTools device mode or the Playwright recipe): lobby board sits under the title, in-match board ≈ 38 % of height, flip still works, rotate to landscape and back. Run `cd packages/client && bun test && bun run build`.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src
git commit -m "Frame the board for portrait phones

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Lobby cleanup — particles, Sign In, names in Recent, hidden accounts

**Files:**
- Modify: `packages/client/src/App.vue:580-599` (`doPlayAgain`), `:1284-1311` (`resetVisuals`)
- Modify: `packages/client/src/components/LobbyOverlay.vue:263` area CSS `.btn-signin`, `:324-336` (recent rows)
- Modify: `packages/shared/src/protocol.ts:137-143` (`ReplaySummary`)
- Modify: `packages/server/src/Room.ts:938-950` (`saveReplay`), `packages/server/src/ReplayStore.ts:23-30`
- Modify: `packages/server/src/db/schema.ts:95-104`, `packages/server/src/db/matchStore.ts:36-97` and leaderboard functions `:180-230`
- Create: `packages/server/drizzle/0009_add_replay_names.sql`; modify `packages/server/drizzle/meta/_journal.json`
- Modify: `packages/server/src/index.ts:59` (exclusion boot), `deploy/.env.example`
- Test: `packages/server/src/__tests__/db.test.ts`, `packages/client/src/lib/__tests__/recentRow.test.ts`
- Create: `packages/client/src/lib/recentRow.ts`

**Interfaces:**
- Produces: `ReplaySummary.nameA?: string; nameB?: string`; `setExcludedLeaderboardUsers(ids: string[])` in `matchStore.ts`; `recentRowLabels(r: ReplaySummary, charLabel: Record<string,string>, t): { title: string; result: string }`.

- [ ] **Step 1: Particles after Ещё раз**

Extract from `resetVisuals` into a new function directly above it:

```ts
/** The storm is over for this screen: wind, rain, dome and its sound bed go. */
function stopStormVisuals() {
  windSystem?.setVisible(false)
  rainSystem?.setVisible(false)
  audio.setStormAmbience(false)
  audio.stopCrackle()
  stormSystem?.discharge('fast')
  audio.setStormBed(0)
  stormSystem?.setTremor(false)
}
```

Call `stopStormVisuals()` in `resetVisuals` in place of those seven lines, and in `doPlayAgain` right after `bonusSystem?.clear()`.

- [ ] **Step 2: Sign In wrap**

`LobbyOverlay.vue` `.btn-signin` (line ~615): add `white-space: nowrap;`.

Commit both:

```bash
git add packages/client/src
git commit -m "Stop the storm behind the queue and keep Sign In on one line

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 3: Names on replays — failing DB test**

In `db.test.ts`, inside the `matchStore` describe that already has `saveMatch` and a `ReplayData` fixture, add:

```ts
  test('listReplays carries player names when the replay has them', () => {
    const id = `room-names-${crypto.randomUUID()}`
    saveMatch({ roomId: id, playerAId: null, playerBId: null, characterA: 'wheat', characterB: 'rice', winner: 'A', rounds: 1, durationMs: 1000, vsBot: false },
      { id, charA: 'wheat', charB: 'rice', winner: 'A', frameCount: 0, frames: [], nameA: 'Bilibin', nameB: 'Lavrushka' })
    const row = listReplays(50).find((r) => r.id === id)!
    expect(row.nameA).toBe('Bilibin')
    expect(row.nameB).toBe('Lavrushka')
  })

  test('listReplays leaves names undefined for old rows', () => {
    const id = `room-nonames-${crypto.randomUUID()}`
    saveMatch({ roomId: id, playerAId: null, playerBId: null, characterA: 'wheat', characterB: 'rice', winner: 'B', rounds: 1, durationMs: 1000, vsBot: true },
      { id, charA: 'wheat', charB: 'rice', winner: 'B', frameCount: 0, frames: [] })
    const row = listReplays(50).find((r) => r.id === id)!
    expect(row.nameA).toBeUndefined()
  })
```

Import `listReplays` the same way the describe imports `saveMatch` (via the `mod` in `beforeAll`). If `saveMatch` needs `vsBot`, match the existing fixture's shape exactly.

- [ ] **Step 4: Run, expect failure (type error on `nameA`)**

- [ ] **Step 5: Implement names end to end**

`shared/src/protocol.ts:137`:

```ts
export type ReplaySummary = {
  id: string
  charA: CharacterType
  charB: CharacterType
  winner: PlayerId | 'draw' | null
  frameCount: number
  /** Display names as shown on the nameplates; absent on replays saved before they were stored. */
  nameA?: string
  nameB?: string
}
```

Migration `packages/server/drizzle/0009_add_replay_names.sql`:

```sql
ALTER TABLE `replays` ADD `name_a` text;--> statement-breakpoint
ALTER TABLE `replays` ADD `name_b` text;
```

Journal entry appended to `meta/_journal.json` `entries`:

```json
    {
      "idx": 9,
      "version": "6",
      "when": 1788230400000,
      "tag": "0009_add_replay_names",
      "breakpoints": true
    }
```

(Check how `0008` wrote `--> statement-breakpoint` in `0005`/`0007` and copy that exact separator.)

`schema.ts` replays table: add `nameA: text('name_a'), nameB: text('name_b'),` after `winner`.

`matchStore.ts` `saveMatch` `replayRow`: add `nameA: replay.nameA ?? null, nameB: replay.nameB ?? null`. `listReplays`: select `nameA: schema.replays.nameA, nameB: schema.replays.nameB` and map `nameA: r.nameA ?? undefined, nameB: r.nameB ?? undefined`. `getReplay`: same two fields.

`ReplayStore.ts` `list()`: include `nameA: r.nameA, nameB: r.nameB`.

`Room.ts` `saveReplay`: add to the `replay` object `nameA: this.playerInfoCache.A.displayName, nameB: this.playerInfoCache.B.displayName` (both are `''` if a slot never filled; write `|| undefined` so the empty string does not mask the fallback).

Run: `cd packages/server && bun test` — PASS (the migration runs in the test DB via `migrate`, so the new columns exist).

- [ ] **Step 6: Lobby rows — failing client test**

```ts
// packages/client/src/lib/__tests__/recentRow.test.ts
import { describe, it, expect } from 'bun:test'
import { recentRowLabels } from '../recentRow.js'

const t = (key: string, ...args: (string | number)[]) =>
  key === 'lobby.won' ? `${args[0]} won` : key === 'lobby.draw' ? 'Draw' : key === 'lobby.vs' ? 'vs' : key
const chars = { wheat: 'Wheat', rice: 'Rice' }

describe('recentRowLabels', () => {
  it('prefers player names and names the winner', () => {
    const r = { id: '1', charA: 'wheat', charB: 'rice', winner: 'B', frameCount: 3, nameA: 'Bilibin', nameB: 'Lavrushka' } as const
    expect(recentRowLabels(r, chars, t)).toEqual({ title: 'Bilibin vs Lavrushka', result: 'Lavrushka won' })
  })

  it('falls back to crop labels and the slot letter for old replays', () => {
    const r = { id: '1', charA: 'wheat', charB: 'rice', winner: 'A', frameCount: 3 } as const
    expect(recentRowLabels(r, chars, t)).toEqual({ title: 'Wheat vs Rice', result: 'A won' })
  })

  it('says draw', () => {
    const r = { id: '1', charA: 'wheat', charB: 'rice', winner: 'draw', frameCount: 3, nameA: 'X', nameB: 'Y' } as const
    expect(recentRowLabels(r, chars, t).result).toBe('Draw')
  })
})
```

- [ ] **Step 7: Implement and wire**

```ts
// packages/client/src/lib/recentRow.ts
import type { ReplaySummary } from '@wheee/shared'

type T = (key: string, ...args: (string | number)[]) => string

/** One "Recent" row: who played and who won, by name when the replay knows it. */
export function recentRowLabels(r: ReplaySummary, charLabel: Record<string, string>, t: T): { title: string; result: string } {
  const a = r.nameA || charLabel[r.charA] || r.charA
  const b = r.nameB || charLabel[r.charB] || r.charB
  const title = `${a} ${t('lobby.vs')} ${b}`
  if (r.winner === 'draw') return { title, result: t('lobby.draw') }
  const winnerName = r.winner === 'A' ? (r.nameA || 'A') : r.winner === 'B' ? (r.nameB || 'B') : ''
  return { title, result: t('lobby.won', winnerName) }
}
```

`LobbyOverlay.vue` template rows (`:332-333`):

```html
        <span class="ri-chars">{{ recentRowLabels(r, charLabel, t).title }}</span>
        <span class="ri-result">{{ recentRowLabels(r, charLabel, t).result }}</span>
```

(import `recentRowLabels`). Add `max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` to `.ri-chars` so two long surnames do not widen the corner.

Run: `cd packages/client && bun test && bun run build`. Commit:

```bash
git add packages/shared packages/server packages/client
git commit -m "Show who played in the lobby's recent matches

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 8: Hidden leaderboard accounts — failing test**

In `db.test.ts` `matchStore leaderboard functions` describe, add (needs `setExcludedLeaderboardUsers` from `mod`):

```ts
  test('excluded users are hidden from the board and its total', () => {
    const before = getPlayerLeaderboard()
    expect(before.items.some((r) => r.userId === uA)).toBe(true)
    setExcludedLeaderboardUsers([uA])
    const after = getPlayerLeaderboard()
    expect(after.items.some((r) => r.userId === uA)).toBe(false)
    expect(after.total).toBe(before.total - 1)
    setExcludedLeaderboardUsers([])
  })
```

Run, expect failure (`setExcludedLeaderboardUsers` is not exported).

- [ ] **Step 9: Implement**

`matchStore.ts`, above `getPlayerLeaderboard`:

```ts
// The owner's own accounts, kept off the public boards (stats still accrue).
let excludedUsers: string[] = []
export function setExcludedLeaderboardUsers(ids: string[]): void {
  excludedUsers = ids.map((s) => s.trim()).filter((s) => s.length > 0)
}
function userAllowed() {
  if (excludedUsers.length === 0) return sql`1 = 1`
  return sql`${schema.userStats.userId} NOT IN (${sql.join(excludedUsers.map((id) => sql`${id}`), sql.raw(', '))})`
}
```

Both leaderboard functions: `.where(sql`${schema.userStats.gamesPlayed} > 0 AND ${userAllowed()}`)` on the page query and the same on the `total` query (watchers: `watcherScore > 0 AND ...`).

`index.ts:59`, next to `setExcludedDevices`:

```ts
setExcludedLeaderboardUsers((process.env.LEADERBOARD_EXCLUDE_USERS ?? '').split(','))
```

`deploy/.env.example`, under `STATS_EXCLUDE_DEVICES`:

```
# Own accounts hidden from the public leaderboards (users.id, comma-separated). Stats still accrue.
LEADERBOARD_EXCLUDE_USERS=
```

Run: `cd packages/server && bun test && bunx tsc --noEmit -p .` — PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/server deploy/.env.example
git commit -m "Let the owner's accounts sit out the public leaderboard

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Full verification

- [ ] `cd packages/server && bun test && bunx tsc --noEmit -p .`
- [ ] `cd packages/client && bun test && bun run build`
- [ ] `bun run dev:server` + `bun run dev:client`, then with the Playwright recipe (memory `prod-playtest-recipe`, pointed at `http://localhost:5173`): one solo queue with a second tab parked hidden → bot in ≈ 8 s; a game-over screenshot at 1280×800 and 390×844; lobby at 390×844; **Ещё раз** then screenshot: no particles.
- [ ] Update `game/UX_REVIEW.md` items 6 (game over) and 7 (recent list) with a ✅ line naming this branch, the way items 1–3 were annotated.
- [ ] Commit the doc note.
