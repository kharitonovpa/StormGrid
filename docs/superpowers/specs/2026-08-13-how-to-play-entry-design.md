# Always-available tutorial entry point («Как играть»)

Date: 2026-08-13
Status: approved, ready for implementation plan

## Why

Pikabu moderation returned the game with «Внесите исправления» and the note
«не хватает туториала хоть какого-то» (GamePush moderator chat, 2026-08-11).

The tutorial exists, but it is reachable exactly once and only implicitly. Pressing
Play with no `wheee:tutorial_done` flag starts a practice match against a bot with
step-by-step hints; with the flag set, Play goes straight to the real queue
(`App.vue:290-293`). On GamePush hosts — Pikabu among them — that flag does not live
in `localStorage`: storage is routed through the portal player profile `gp.player`,
because GamePush moderation requires progress to go through it (`lib/storage.ts:4-7`).
A moderator testing under a portal account where anyone had played before therefore
cannot see the tutorial at all. The legacy key `wheee:stories_skipped` suppresses it too
(`App.vue:783-787`).

So the moderator's report is accurate, and the root cause is ours: first-run
onboarding must not depend on a cloud flag stored in an account we do not control.
This will recur on CrazyGames, VK Games and the other five portals currently in
moderation, whose testers also reuse accounts.

The first analytics read agrees with the moderator. Over Aug 7–12, of 30 devices only
18 reached `queue_join`, and of 19 that started a match only 8 produced a `match_end`
(`GET /api/events/summary`). People do not understand what to do.

## What

A «Как играть» / «How to play» chip in the lobby's secondary action row, always
visible, which starts the existing practice match against a bot with `TutorialHud`
hints — the same match a newcomer gets on their first Play. No new screens, no new
rules copy.

Rejected alternatives:

- **A static rules panel only.** Would likely satisfy moderation but not the funnel:
  text does not teach the game, and replaying the tutorial would still be impossible.
- **A rules card plus a «Пройти обучение» CTA.** Better for a moderator (instructions
  visible without playing) but needs new EN/RU copy and a new component for a problem
  the playable tutorial already solves.
- **A prominent full-width button under Play.** Safest against a second rejection, but
  it competes with the primary action and taxes queue conversion.

## Design

### Behaviour

- The chip sits in `actions-secondary` next to «Смотреть», styled as the existing
  `btn-role`, labelled with a word rather than a bare «?» so it cannot be missed.
- Clicking it starts a practice match: bot opponent, untimed ticks, `TutorialHud`
  hints, no replay and no stats (`Room.ts:770`).
- Three things already hold and need no new code:
  - `actions-secondary` renders only outside the searching branch (it is inside the
    `v-else` at `LobbyOverlay.vue:220`), so the button cannot be pressed during
    matchmaking and needs no queue-state handling.
  - Completing the tutorial through the chip sets `tutorial_done` via the existing
    `match_end` handler (`App.vue:194`), so Play afterwards goes to the real queue.
  - The server needs no change: `practice:start` is ungated (`index.ts:405-416`).
- Deliberate non-decision: when the player arrived through a challenge link
  (`hasIncomingInvite`), the chip stays visible and `incomingInvite` is left
  untouched. The waiting friend may time out, but no special case is added for it —
  such a player's primary CTA already reads «Играть с другом».

### Changes

| File | Change |
|---|---|
| `packages/client/src/lib/i18n.ts` | key `lobby.howToPlay`: «How to play» / «Как играть» |
| `packages/client/src/components/LobbyOverlay.vue` | `btn-role` button with a «?» icon in `actions-secondary`; new emit `howToPlay: [character: CharacterType]`; drop the row's `v-if` since the chip is unconditional |
| `packages/client/src/App.vue` | `onHowToPlay(character)`: play `ui-click`, `stopLobbyDemo()`, `ensureConnected(() => socket.startPractice(character, streak.value))`, set `queueJoinPending`, `track('tutorial_open', { replay: hasDoneTutorial() })` |

Server: unchanged.

The `tutorial_open` event with a `replay` flag also answers a question the funnel
could not: how many players go looking for the rules at all.

### Verification

The repository has no client tests — `bun test` runs the server suite only
(`package.json:12`). Verification is therefore manual, by the established recipe:
vite dev plus a server with `BOT_MATCH_DELAY_MS=800`, driven with playwright, and
`localStorage wheee:tutorial_done=1` set — which reproduces the Pikabu tester's exact
state. Expected: the chip is visible, and clicking it opens a match showing the
«Обучение» badge.

Separately, the portal build is checked by unzipping the GamePush archive, serving it
and loading it with a stubbed GamePush SDK (route `**/game-score.js*`, poll for
`window.onGPInit`): the chip must be present there too, and no `a[href^=http]` may
render — the external-link rule that got the GamePix build flagged still applies.

### Follow-up, outside this scope

Reply in the GamePush moderator chat with a lobby screenshot and the `gp.player`
explanation, so Pikabu gets both the reason and a visible fix.
