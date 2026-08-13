# «Как играть» Tutorial Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an always-visible «Как играть» / «How to play» chip to the wheee lobby that starts the existing practice match against a bot, so the tutorial is reachable regardless of the `tutorial_done` flag stored in the portal player profile.

**Architecture:** Client-only change. The lobby component gains one `btn-role` button that emits `howToPlay` with the selected character; `App.vue` handles it by sending the existing `practice:start` message over the game socket. The server, the practice room, and `TutorialHud` are untouched — `practice:start` is already ungated (`packages/server/src/index.ts:405-416`), and completing a practice match already sets the done-flag (`packages/client/src/App.vue:194`).

**Tech Stack:** Vue 3 (`<script setup>`, composition API), TypeScript, Bun workspaces, Vite dev server, hand-rolled i18n table (`packages/client/src/lib/i18n.ts`), first-party analytics (`packages/client/src/lib/analytics.ts`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-13-how-to-play-entry-design.md`. Read it before starting.
- **No test-first cycle in this plan, and this is deliberate.** The repository has no client test harness — `bun test` runs the server suite only (`package.json:12`). The approved spec sets manual verification by the established playwright recipe instead. Do NOT add vitest, vue-test-utils, or any client test infrastructure: that is out of scope and was not approved.
- Server code must not change. If a step seems to need a server change, stop and report.
- No new rules copy and no new screens. The button starts the existing practice match; the teaching text already exists in `i18n.ts:121-131`.
- Every user-facing string needs both an EN and a RU entry in `i18n.ts`.
- The chip's label is a word («Как играть»), never a bare «?» icon — a moderator missing it a second time is the failure this work exists to prevent.
- Portal rule, non-negotiable: no `a[href^=http]` may render in a portal build. The chip introduces no links, but Task 2 re-verifies this because a GamePix rejection already happened over it.
- The chip is unconditional: it must render on every platform, including hosts where `canInvite` and `canWatch` are both false.
- Do not touch `incomingInvite` state. A player who followed a challenge link keeps their invite; no special case for it.

---

### Task 1: The lobby chip and its handler

**Files:**
- Modify: `packages/client/src/lib/i18n.ts:18` (EN block) and `packages/client/src/lib/i18n.ts:166` (RU block)
- Modify: `packages/client/src/components/LobbyOverlay.vue:36-44` (emits), `:264-277` (secondary row)
- Modify: `packages/client/src/App.vue` (new `onHowToPlay` near `onPlay` at `:275`, and the `<LobbyOverlay>` binding at `:1891-1897`)
- Test: none — manual verification in Steps 5-7 (see Global Constraints)

**Interfaces:**
- Consumes: `socket.startPractice(character: CharacterType, streak?: number): boolean`, `hasDoneTutorial(): boolean`, `stopLobbyDemo(): void`, `ensureConnected(then: () => void): void`, `track(name: string, props?: Record<string, string | number | boolean>): void` — all already defined in `App.vue` / its imports.
- Produces: emit `howToPlay: [character: CharacterType]` on `LobbyOverlay`; analytics event `tutorial_open` with prop `replay: boolean`.

- [ ] **Step 1: Add the i18n keys**

In the EN table, immediately after `'lobby.watch': 'Watch',` (`i18n.ts:18`):

```ts
    'lobby.howToPlay': 'How to play',
```

In the RU table, immediately after `'lobby.watch': 'Смотреть',` (`i18n.ts:166`):

```ts
    'lobby.howToPlay': 'Как играть',
```

- [ ] **Step 2: Declare the emit in LobbyOverlay.vue**

In the `defineEmits` block (`LobbyOverlay.vue:36-44`), add the line after `play`:

```ts
const emit = defineEmits<{
  play: [character: CharacterType]
  howToPlay: [character: CharacterType]
  watch: []
  architect: []
  watchReplay: [roomId: string]
  cancelSearch: []
  invite: [character: CharacterType]
  shareInvite: []
}>()
```

- [ ] **Step 3: Add the chip to the secondary row**

Replace the opening tag of the secondary row (`LobbyOverlay.vue:264`) — the `v-if` goes away, because the chip inside is unconditional:

```html
            <div class="actions-secondary">
```

Then insert the chip as the FIRST child of that row, before the invite button. It leads the row so it holds the leftmost, most-scanned position — and on GamePush hosts, where `canInvite` and `canWatch` are false, it is the only thing in the row:

```html
              <button class="btn-role" @click="audio?.play('ui-click'); emit('howToPlay', selected)">
                <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="10" cy="10" r="7.4" />
                  <path d="M7.9 7.7a2.2 2.2 0 1 1 4.1.9c-.25.7-.9 1.05-1.45 1.45-.4.3-.55.7-.55 1.15" />
                  <circle cx="10" cy="14.2" r="0.85" fill="currentColor" stroke="none" />
                </svg>
                {{ t('lobby.howToPlay') }}
              </button>
```

- [ ] **Step 4: Add the handler in App.vue and bind it**

Add `onHowToPlay` directly after `onPlay` ends (`App.vue:299`). It mirrors `onPlay`'s preamble, then forces the practice branch instead of the queue:

```ts
/**
 * The tutorial's own entrance. First Play alone is not enough: `tutorial_done` lives
 * in the portal player profile on GamePush hosts (see lib/storage.ts), and portal
 * testers reuse accounts — so anyone whose account has played before never sees the
 * tutorial. Pikabu moderation rejected the build over exactly this.
 */
function onHowToPlay(character: CharacterType) {
  game.selectedCharacter.value = character
  game.inviteFailed.value = false
  audio.play('queue-enter')
  stopLobbyDemo()
  const replay = hasDoneTutorial()
  ensureConnected(() => {
    if (socket.startPractice(character, streak.value)) {
      game.queueJoinPending.value = true
      track('tutorial_open', { replay })
    }
  })
}
```

Then add the binding to the `<LobbyOverlay>` tag, after `@play="onPlay"` (`App.vue:1891`):

```html
    @how-to-play="onHowToPlay"
```

- [ ] **Step 5: Start the dev environment**

Two terminals from the repo root. The bot delay is shortened so the practice opponent appears at once:

```bash
BOT_MATCH_DELAY_MS=800 bun run dev:server
```

```bash
bun run dev:client
```

Expected: the client prints a local URL (Vite, port 5173 unless taken); the server logs a listening line with no errors.

- [ ] **Step 6: Verify in the Pikabu tester's exact state**

Open the client URL in a browser, then in the devtools console set the done-flag and reload — this reproduces a portal account that has already played:

```js
localStorage.setItem('wheee:tutorial_done', '1'); location.reload()
```

Expected, all four:
1. The «Как играть» chip is visible in the lobby under the Play button (RU locale; «How to play» in EN).
2. Clicking it starts a match that shows the «Обучение» / «Tutorial» badge with the first hint card.
3. The Network tab shows a `POST /api/events` batch containing `tutorial_open` with `"replay": true`.
4. Play (not the chip) still goes to the normal queue — the chip did not hijack the primary action.

Then clear the flag and reload (`localStorage.clear(); location.reload()`) and confirm the chip is still there for a first-time player, alongside the tutorial that first Play already gives them.

- [ ] **Step 7: Check the layout on a narrow viewport**

In devtools, switch to a 390×844 (mobile) viewport. Expected: the secondary row does not wrap into a broken second line or overflow the lobby panel; the chip and «Смотреть» sit side by side. If it overflows, add `flex-wrap: wrap` to `.actions-secondary` (`LobbyOverlay.vue:673-677`) and re-check — do not shrink the label to an icon.

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/lib/i18n.ts packages/client/src/components/LobbyOverlay.vue packages/client/src/App.vue
git commit -m "$(cat <<'EOF'
Leave the tutorial a door that is always open

The tutorial ran once, on first Play, gated on a flag that lives in the
portal player profile on GamePush hosts. Portal testers reuse accounts, so
Pikabu's moderator opened a game that had already been played and found no
tutorial at all. The lobby now carries a "How to play" chip that starts the
same practice match, whatever the flag says.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Prove it reaches the portal build

**Files:**
- Modify: none. This task builds and inspects artifacts.

**Interfaces:**
- Consumes: the committed chip from Task 1.
- Produces: a verified GamePush archive, and a lobby screenshot for the moderator reply in Task 3.

- [ ] **Step 1: Build the portal archives**

```bash
bun run build
bash deploy/strip-store-assets.sh
```

Expected: the build completes and `wheee-gamepush.zip` is refreshed at the repo root. If the script's name or output path has drifted, read `deploy/strip-store-assets.sh` and `deploy/deploy-all.sh --archives` and follow what they actually do rather than guessing.

- [ ] **Step 2: Serve the unpacked archive**

```bash
rm -rf /tmp/gp-check && mkdir -p /tmp/gp-check && unzip -q wheee-gamepush.zip -d /tmp/gp-check && bunx serve -l 4173 /tmp/gp-check
```

Expected: a static server on port 4173 serving the portal build.

- [ ] **Step 3: Load it with a stubbed GamePush SDK**

The build waits for the portal SDK, so the page needs `window.onGPInit` fired. Use playwright with the cached chromium: route `**/game-score.js*` to a stub that calls the callback the game registers, then poll until the lobby renders. Assert, in this order:

1. The «Как играть» chip is present in the lobby.
2. `document.querySelectorAll('a[href^=http]').length === 0` — the external-link rule that got the GamePix build flagged.

If the chip is missing here but present in dev, the cause is a platform capability gating the row — re-read `LobbyOverlay.vue:264` and confirm the `v-if` was actually removed in Task 1 Step 3.

- [ ] **Step 4: Screenshot the lobby**

Capture the lobby with the chip visible, RU locale, at a phone viewport (390×844), and save it to `screens/upload/how-to-play-chip.png`. This is the evidence for the moderator reply.

- [ ] **Step 5: Report, do not deploy**

Do NOT run `bun run deploy`. Report to the user that the archive is verified and ready, and let them decide when to ship and re-submit to moderation.

---

### Task 3: Draft the moderator reply

**Files:**
- Create: `marketing/telegram-listings/PIKABU_TUTORIAL_REPLY.md` (draft text only — the user posts it in the GamePush console themselves)

**Interfaces:**
- Consumes: the screenshot from Task 2 Step 4.
- Produces: RU text ready to paste into the moderator chat.

- [ ] **Step 1: Write the draft**

Keep it short, lead with the fix rather than the excuse, and do not blame the tester. Content, in RU:

- The tutorial existed but ran only on the very first launch, and the completion flag is stored in the GamePush player profile (`gp.player`), as GamePush moderation requires for progress. A tester on an account where the game had already been launched therefore saw no tutorial — our design flaw, not their mistake.
- What changed: a permanent «Как играть» button in the lobby, available at any time, which starts a training match against a bot with step-by-step hints. Screenshot attached.
- Ask them to re-check, mentioning the button is visible immediately in the lobby without needing a fresh account.

- [ ] **Step 2: Hand it over**

Show the user the draft text and the screenshot path in chat, and state plainly that posting it in the GamePush moderator chat and re-submitting is their action, not ours.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Chip in `actions-secondary`, always visible, word label | 1.3 |
| Starts the existing practice match with `TutorialHud` hints | 1.4, verified 1.6 |
| Row's `v-if` dropped | 1.3, re-checked 2.3 |
| `lobby.howToPlay` EN + RU | 1.1 |
| `howToPlay` emit | 1.2 |
| `track('tutorial_open', { replay })` | 1.4, verified 1.6 |
| Server unchanged | Global Constraints; no server file in any task |
| `incomingInvite` untouched | Global Constraints; absent from 1.4 |
| Manual verification via playwright recipe with `tutorial_done=1` | 1.5-1.7 |
| Portal build carries the chip, no external links | 2.1-2.3 |
| Moderator reply with screenshot and `gp.player` explanation | 2.4, 3 |

**Placeholders:** none — every code step carries the literal code to insert; the two "if it drifted" fallbacks in Task 2 name the files to read.

**Type consistency:** `howToPlay: [character: CharacterType]` in the emit (1.2) matches `emit('howToPlay', selected)` in the template (1.3), Vue's kebab-case binding `@how-to-play` (1.4), and `onHowToPlay(character: CharacterType)` (1.4). `startPractice(character, streak.value)` returns `boolean`, matching the `if` around it — same call shape as `App.vue:293`.
