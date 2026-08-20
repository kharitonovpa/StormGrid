# Cut the forced first-play tutorial

**Date:** 2026-08-20
**Status:** approved

## Problem

Analytics (Aug 7–20) show the forced tutorial is the funnel's biggest leak: 343 of 497
queue joins were first-play tutorial entries, 308 tutorial matches started, only 89
finished (29%). Real PvP matches complete at 90%. Portal players expect instant action;
they die inside the tutorial before ever reaching a real match.

## Decision

Remove the tutorial as the forced first screen. The lobby's permanent «Как играть» /
«How to play» chip (added for Pikabu moderation) remains the tutorial's only entrance.

## Changes

1. **Client** (`packages/client/src/App.vue`, `onPlay`): drop the `hasDoneTutorial()`
   branch — Play always calls `socket.joinQueue`. The `practice` prop on `queue_join`
   goes away (queue joins can no longer be practice; the chip's `tutorial_open` event
   already covers tutorial usage). `wheee:tutorial_done` storage stays untouched — still
   written after a practice match and still feeds the chip's `replay` prop.
2. **Server** (`packages/server/src/matchmaking.ts`): default `BOT_MATCH_DELAY_MS`
   30 000 → 8 000 so a lone newcomer meets a (human-looking) bot in seconds instead of
   staring at an empty queue for half a minute. Env override unchanged; client countdown
   adapts automatically via `queue:waiting.maxWaitMs`.

## Non-goals

- No first-match hints (measure the bare cut first; `tutorialHint` infra stays for the chip).
- No new analytics props — the per-platform summary (newDevices, D1, PvP starts/ends)
  already measures the effect before/after.

## Accepted risk

With more concurrency, two humans arriving >8 s apart will each get a bot instead of
each other. Negligible at ~5 PvP matches/day; tunable via env without rebuild.

## Verification & rollout

- Server suite must stay green (ws tests pin `BOT_MATCH_DELAY_MS=800` explicitly).
- Live check with fresh storage: Play → searching state (queue), not an instant practice match.
- Deploy: PL server + web + RU VPS + rebuild GamePush/Yandex archives; uploading the
  zips to the portal consoles is a manual user step.
