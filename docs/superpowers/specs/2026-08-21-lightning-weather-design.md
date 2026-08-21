# Lightning: the third weather

**Date:** 2026-08-21
**Status:** approved

## Problem

The positional table has a hole. Wind punishes open flats, rain punishes basins —
nothing punishes hills. Standing on +1 is close to free: wind drops you off the hill
onto the next cell and stops (a fall blocks the push), rain never reaches you.
Combined with "raise a wall and stand behind it", turtling dominates: a 1-ply search
using exactly this plan beat a live opponent in two rounds. Rounds also feel samey —
two weather types, forecast solved by one hill.

Lightning closes the hole and completes rock-paper-scissors: wind takes the exposed,
rain takes the low, lightning takes the high.

## The rule

Characters have a crown height of **+0.5** (half a cell above the ground they stand
on). Lightning is resolved per side, like wind and rain (player B sees negated
heights):

> **A player is the bolt's target when no cell on their side is strictly higher than
> their crown (cell height + 0.5). Any strictly higher cell anywhere on the side is a
> lightning rod: the bolt goes there instead and the player lives.**

Everything else derives from this one sentence:

- **A hill is a gallows.** Standing on +1 puts the crown at 1.5; no cell can exceed
  1.0. Under a storm forecast, standing on a hill is death that no rod can prevent.
- **A pit is grounded.** At -1 the crown is -0.5; any 0-cell on the side out-tops it.
  Pits are lightning-safe — they stay rain's prey.
- **A bare plain kills.** All cells at one level (all 0 *or* all -1 — the rule is
  relative, global digging can't game it) leaves the player as the tallest thing in
  the steppe. Exposed.
- **Rods are buildable defense**, symmetric to wind walls: raise a cell you do NOT
  stand on. The opponent can raze your only rod in one action (their raise) — rod
  redundancy costs ticks, which is the economy.
- **The tick-5 undercut is the signature checkmate.** Opponent lowers the cell under
  you (their frame) → on your side it bulges to +1 → your crown out-tops every rod.
  Done on ticks 1–4 it's a duel (step off or dig back down); done on tick 5 there is
  no answer. The same last-tick undercut already exists for rain (shove into a pit),
  so this sharpens an existing play rather than inventing a pathology.
- **Cross-side texture:** every rod I raise is a pit on the opponent's side — my
  lightning defense digs their rain traps. No new rule needed.

**Both exposed:** one bolt, and it picks the player who **sticks out further above
their own world**: margin = crown − (highest experienced height among all OTHER cells
on their side). The larger margin takes the bolt; on an exact tie both die — a draw,
consistent with equal run-up (wind) and equal volume (rain). The margin is relative,
like exposure itself: uniformly lowering your whole side changes nothing (comparing
absolute experienced crowns was rejected — it made global digging win every mutual
tie-break, the exact exploit the relativity rule exists to kill). The spared player's
`boltCell` is null — the single bolt went to the other side, and no rod absorbed
anything on theirs. No mixed-cause double deaths: like the other elements, the storm
stops at the first death.

## Order of elements

**Lightning → wind → rain.** Rationale:

1. **Predictability.** Lightning judges positions exactly as they stood at the end of
   tick 5 — every death is explainable from one frame. Critical: lightning has the
   least obvious death cases.
2. **Wind never lifts.** A push only drops players into pits or pins them at walls, so
   wind-before-lightning could only *ground* targets — the bolt would almost never
   fire. Dead element.
3. **Storm dramaturgy:** flash, then gale, then downpour. A lightning kill ends the
   cataclysm before wind and rain, same first-death cutoff as today (§12 of
   GAME_DESIGN).

## Escalation schedule

Lightning is round-gated, not mixed into a flat random. This gives matches an arc,
kills late-game turtling (the role a shrinking board would have played), and keeps the
first rounds identical to today so newcomers learn nothing new up front:

| Rounds | Weather mix |
|---|---|
| 1–2 | unchanged: wind 55% / wind+rain 45% |
| 3–4 | wind 40% / wind+rain 35% / wind+lightning 15% / lightning 10% |
| 5–6 | wind 25% / wind+rain 25% / wind+lightning 25% / wind+rain+lightning 15% / lightning 10% |
| 7+ | wind+rain+lightning 40% / wind+lightning 30% / wind+rain 20% / lightning 10% |

Numbers are a playtest draft; they live as a table constant in `@wheee/shared` so
tuning is one edit. Pure lightning gives random generation its first still cataclysm —
a round with no gale, only the dial crackling.

## Forecast: one dial, no new instrument

The compass/barometer dial stays the game's only forecast surface — no third widget.

- `ForecastData` gains `lightningProbability`, quantized like rain: 0 / 0.25 / 0.75 / 1.
- **Center icon** extends its ladder with the weather emoji the matrix was born for:
  rain only → 🌧 (today's ladder), lightning only → 🌩, both → ⛈, neither → ☀️/🌤/⛅.
- **Electrified rim**: lightning probability rendered as static arcs crawling the
  dial's outer ring — one stray spark at 0.25, steady crackle at 0.75, the rim visibly
  arcing with a faint violet-blue glow at 1.0. Icon answers "what can happen", rim
  answers "how bad does it feel".
- **Watcher break:** still two instruments. Breaking the barometer now blinds the whole
  sky — rain *and* lightning read as chaos (random rim sparking, icon flicker). The
  vane stays wind-only. The watcher's single break gets fatter for free.
- **Needle stays clean** — it already encodes wind candidates; no second signal on it.

## Weather type representation

Extend the enum instead of restructuring: `WeatherType` becomes
`'wind' | 'rain' | 'wind_rain' | 'lightning' | 'wind_lightning' | 'rain_lightning' | 'wind_rain_lightning'`,
with predicates `hasWind(t)` / `hasRain(t)` / `hasLightning(t)` in `@wheee/shared`.

A `{windDir, rain, lightning}` flags struct was considered and rejected: stored
replays and the wire protocol carry `weather: {type, dir}`, and the enum extension
keeps every old replay and client switch valid with zero migration. Call sites that
match on type move to the predicates as they're touched.

`DeathCause` gains `{ type: 'lightning' }`. `WeatherResult` gains
`boltCell: Record<PlayerId, {x,y} | null>` — where the bolt landed on each side (the
player's cell on a kill, the absorbing rod otherwise), for rendering — and
`lightningSpared: PlayerId | null`, mirroring `windSpared`/`rainSpared`: the player
the bolt passed over because the other crown stood taller. Rod pick when several
cells tie as highest: nearest to the player, then lowest (y, x) — deterministic for
replays.

## Engine & bot

- `packages/server/src/engine/lightning.ts`: `resolveLightning(state)` — ~40 lines,
  simpler than wind (no scans, no paths). Per side: compute crown, exposure, target;
  cross-side tie-break by crown height; deaths + boltCell out.
- `GameEngine` weather resolution order becomes lightning → wind → rain, first death
  still ends the storm.
- `randomWeatherDecision(round)` takes the round number and reads the schedule table.
- Architect: `architect:set_weather` accepts the new types (weather picker gains a
  lightning toggle); architect-ordered `rain_lightning` is legal like today's pure rain.
- **The bot learns for free**: `possibleWeather` in `engine/bot.ts` gains the
  lightning dimension (broken barometer → defend against both rain outcomes × both
  lightning outcomes). Worst case grows ~107 actions × 16 weathers — still sub-ms. No
  new strategy code: replaying real `resolveLightning` teaches it rods and undercuts.

## Visuals

Procedural, zero new art assets, house style (BufferGeometry + additive materials,
as `wind.ts`):

- **Bolt**: midpoint-displacement polyline from sky (y≈9 over the target) to the
  impact point, 5–6 subdivisions, 2–3 fork branches at ×0.4 brightness, rendered as
  camera-facing ribbon quads (core white, blue fringe) — `THREE.Line` is 1px, ribbons
  are not.
- **Re-strike flicker**: bolt visible 80–120 ms, dark 60 ms, regenerate the zigzag
  (buffer refill) and flash twice more, weaker.
- **Local light only — no full-screen flash, ever.** A `PointLight` burst at the
  impact (peak → decay ~150 ms) plus an emissive pulse on the jade plate (`glass.ts`
  already glows). Photosensitivity by construction: at most 3 local flashes in ~1.2 s,
  small screen area — inside WCAG 2.3.1 without a settings toggle.
- **No scorch, no charring.** The board stays clean; nothing is painted black. A
  lightning death is bright, not burnt: a short white emissive surge on the monolith
  (flare — fade), the butterfly swarm scatters (existing behavior), then the standard
  game-over screen names the cause. "The sky took them", not "they fried".
- **The absorb strike always renders**: storm happened, player lived → the bolt
  visibly dives into the rod hill with a spark burst and no trace. This is the
  feature's whole tutorial — the player *sees* what saved them.
- **Impact sparks**: 30–50 additive points fountaining up (dust-particle pattern).
- **Choreography** inside `WEATHER_DISPLAY_MS` (4 s): 0.0 sky darkens, wind streams
  freeze, audio drops (the hush) → 0.4 two dim cloud glows → 0.8 STRIKE (bolt + light
  + thunder + vibration) → 1.2 re-strikes → wind/rain proceed if the storm didn't end.
- Decisive strikes on the far side read through the glass plate (§15.1) — no changes
  needed there.
- During ticks under a lightning-possible forecast: occasional distant sheet-glow on
  the horizon (brief ambient blips), paired with the rim sparks.

## Audio

Three new assets in `public/sounds`, produced through the same pipeline as the
existing 26 (match their loudness and character; confirm the exact source library at
implementation time with the asset owner):

| Asset | Role |
|---|---|
| `thunder-crack.mp3` | the strike: whip-crack attack + ~2.5 s rumble tail |
| `thunder-distant.mp3` | soft far rumble, randomly every 10–20 s during lightning-possible ticks, under the music |
| `static-crackle.mp3` (loop) | the dial rim at probability ≥ 0.75, barely audible itch |

Zero-asset tricks that carry the punch:

1. **Silence before the strike**: fade `wind-loop` + music to near zero during the
   0.0–0.8 s hush — sudden quiet is the telegraph, the crack lands on full contrast.
2. **Ducking**: dip the music bus 300 ms at the strike so the crack cuts through.
3. `navigator.vibrate(40)` on the strike — free haptics on Telegram/mobile portals.

## Docs & i18n

- GAME_DESIGN.md: new §"Lightning" (rule, order, schedule), §12 order note, forecast
  §11 (icon ladder + rim), DeathCause list.
- Tutorial: unchanged (rounds 1–2 have no lightning; the practice bot keeps
  `BOT_PRACTICE`). The «How to play» copy gains one line: «Гроза бьёт в самую высокую
  точку — не будь ею.»
- **Game-over screen** (`GameOverOverlay.vue` `subtitle` + i18n EN/RU): the cause
  system is per-perspective — every branch that handles wind/rain gets a lightning
  sibling, none may fall through to the generic text:
  - loser: `gameover.youStruck` — "Lightning found you — the tallest point around" /
    «Молния нашла тебя — самую высокую точку в округе»
  - winner: `gameover.opponentStruck` — "Lightning found the opponent" / «Молния нашла
    соперника»
  - spectator: `gameover.struck` — "{0} struck by lightning" / «{0} поражён молнией»
  - draw (equal crowns): `gameover.bothStruck` — "One bolt, two equal crowns" /
    «Один разряд — две равные макушки»
  - tie-break via `lightningSpared` (both exposed, taller crown died), mirroring the
    flewFirst/drownedFirst trio: `gameover.youStoodTaller`, `gameover.opponentStoodTaller`,
    `gameover.stoodTaller` — "Both stood exposed — {the taller one} took the bolt".
  - Wire `lightningSpared` through `useGameState.ts` → `App.vue` → the overlay props,
    exactly as `windSpared`/`rainSpared` travel today.

## Non-goals / deferred

- **Electric flood** (bolt after rain electrifies all standing water — everyone in any
  wet basin dies): deferred card for a late-round special or architect order. Not in v1;
  the base order (lightning first) means water doesn't exist at strike time.
- No scorch decals, no full-screen flash, no charred-character state (explicitly
  rejected: photosensitivity + friendliness + laconic style).
- No new bonus types, no leaderboard/analytics changes (daily summary is unaffected;
  counting lightning deaths per platform can ride a later eventStore pass).
- No lightning in the tutorial.

## Verification

- Engine suite mirror of wind/rain tests (`engine/__tests__/lightning.test.ts`):
  flat-0 board kills; flat-(-1) board kills (relativity); pit is grounded; rod
  anywhere saves a 0-level player; +1 stander dies through any rod; tick-5 undercut
  kills; both exposed → higher crown dies, storm stops; equal crowns → draw;
  lightning kill skips wind and rain; per-side resolution for player B (negated
  heights); deterministic rod pick; `lightningSpared` set on the taller-crown
  tie-break and null otherwise; `deathCauses` carry `{type:'lightning'}`.
- Bot sanity: under a lightning-certain forecast the full-strength bot never ends a
  tick standing on +1 and builds/keeps a rod when at 0.
- ws suite: new weather types over the wire, architect set_weather with lightning,
  replays containing boltCell round-trip.
- Server env for the full suite as today: live :3001 + `RECONNECT_GRACE_MS=2000
  BOT_MATCH_DELAY_MS=800 BOT_MATCH_DELAY_LONG_MS=800`.
- Live check: practice/queue match reaching round 3+ shows the extended forecast dial;
  a staged lightning round renders the bolt with no full-screen flash.

---

# Approved backlog (from the 2026-08-21 brainstorm)

Priority order agreed against the current fire (portal D1 ≈ 1%):

1. **Storm-as-entity + tick escalation** — the horizon darkens from the wind's
   direction across the 5 ticks and breaks over the board at the cataclysm; wind
   streams/audio layers intensify; scene-level only (terrain is noise, characters are
   monoliths — no rigging). First-impression and thumbnail lever.
2. **Daily storm** — one seeded forecast sequence per day vs the bot for everyone,
   score = rounds survived, daily board. The list's only direct "reason to return
   tomorrow"; cheap (seed + existing bot).
3. **Survival mode** — solo endless escalating cataclysms. Portals rank playtime;
   doubles as the PvP trainer.
4. **Auto-GIF of the decisive cataclysm** — share a replay moment as a link/GIF
   (replay infra exists). Viral loop; people share ridiculous deaths.
5. **Guest identity** — let guests pick their War-and-Peace surname and flag.
   Identity investment for anonymous players, localStorage only.
6. **Biomes** — meadow/desert/snow/autumn palettes + props, random per match; same
   rules, kills board monotony and freshens portal screenshots.
7. **Ground tremors** — when the opponent alters a cell, that cell shudders for a
   beat on your side: you learn *where*, never *what*. Makes the duel visible without
   breaking the two-sided map.
8. **Lobby backdrop** — live spectated match (watch infra exists) or the storm sky
   behind the demo board.

Killcam (3-second replay of the decisive moment from the loser's angle) rides with
whichever of 1/4 lands first — same replay-frame data.
