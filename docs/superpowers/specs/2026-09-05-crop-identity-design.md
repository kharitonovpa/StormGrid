# Crop identity in play — player colours, points on the nameplate, music variants — design

Date: 2026-09-05

## Problem

The crop pick (`wheat`/`rice`/`corn`) now themes the arena the *viewer* sees (sky,
terrain accent, result-screen strip — see `2026-09-01-crop-theming-design.md` and the
dusk look in `2026-09-05-dusk-look-design.md`), but in play the two players differ
only by their 3D model. Everything that says "who is who" is fixed: the local player
has a gold ring, arrow and cell highlight (`player.ts:52,124,195`), the opponent is
marked by butterflies with one jewel palette (`insects.ts`), the nameplate shows a
name and a country flag (`nameplate.ts`), victory confetti is always gold
(`celebrate.ts:140`), and the two music loops are the same for every crop even
though `audio.ts` already resolves per-crop track ids through an empty `MUSIC_TRACKS`
map. Separately, players cannot see each other's standing: the nameplate has no
points although the server knows every player's total (`pointsStore.getPoints`).

## Goal

1. Each player's identity markers carry their crop's colour: my ring, arrow and
   highlight in *my* crop's colour; the opponent's butterflies in *theirs*; victory
   confetti in the winner's. "Mine vs theirs" keeps reading by shape (ring vs
   butterflies), so two players on the same crop still tell apart.
2. Each human player's nameplate shows their total points next to the flag.
3. Rice and corn get their own versions of the lobby and match music — the same
   two loops with a sparse ornamental layer mixed in — built by a committed,
   reproducible generator; wheat keeps the base loops.

## Non-goals

- No gameplay or balance effect; no engine file changes; the server change is one
  optional cosmetic field.
- No change to wind/rain/lightning visuals, to the terrain/sky theming already
  shipped, or to the character models.
- No runtime audio layering or synthesis; no new client dependencies. The music
  generator is a build-time tool (Node/TypeScript run with bun, ffmpeg in PATH).
- No live points ticking during a match; the nameplate shows the value at join.
- No extra "same crop" disambiguation beyond shape (human ruling).

## Design

### Identity colours (client)

`cropTheme.ts` gains `identity: number` (sRGB hex) per crop, taken from the jewel
palette the opponent's butterflies already use (`insects.ts` `GEMS[*].mid`): wheat
topaz `0xf0940f`, rice aquamarine `0x16a8d2`, corn amethyst `0xb23bd6`. These are
spread around the hue circle and were chosen to read over grass; the lobby cards'
"natural" colours (gold / jade / amber) are not — jade vanishes on the green field and
gold sits 20° from amber. Human ruling: the jewel palette becomes the one identity
everywhere. `LobbyOverlay.vue` reads the card accent/glow from `CROP_THEME` (the cards
change colour accordingly), and `insects.ts` derives each gem's `mid` from
`CROP_THEME[crop].identity`, keeping its hand-tuned `deep`/`bright`/`edge`, so the
butterflies cannot drift from the markers.

- **My markers** (`player.ts`): the ring's rest/hover colour, the arrow and the cell
  highlight take `identity` of the local player's crop; the move-mode ring is the same
  colour lightened 40 % toward white (today: cyan rest, gold move/arrow/highlight).
  The player system gains `setIdentity(hex: number)`; `App.vue` calls it whenever the
  local player's crop is known (match start, reconnect, rematch), and resets nothing
  for watchers/replays, where the ring is hidden already.
- **Opponent's butterflies** (`insects.ts`): the jewel palette (`mid`/`edge`/`bright`)
  derives from the marked player's `identity` — `mid = identity`, `edge` darkened,
  `bright` lightened (HSL lightness ±) — through `setPalette(crop)`, which redraws the
  sprite canvas texture; default palette until the crop is known.
- **Confetti** (`celebrate.ts`): `celebrate()` gains an optional hue; the victory burst
  in `GameOverOverlay.vue` passes the winner's identity hue (HSL of `identity`), the
  points bursts keep today's gold range.
- Same crop on both sides: no extra cue — ring vs butterflies already separate them.
- Watchers and replays: no ring (unchanged); butterflies coloured by the player they
  mark.

### Points on the nameplate (shared / server / client)

- `PlayerInfo` (`shared/src/types.ts`) gains `points?: number` — the player's total
  match points, the same number the leaderboard orders by. Cosmetic; absent for bots.
- Server: `Room.join` fills it through a new callback `pointsFor(ws): number | undefined`
  on the room callbacks; `index.ts` supplies `getPoints(ws.data.analytics?.deviceId ??
  null, ws.data.userId)`. Bots (`Room.ts:360`) get no `points`. The value is fixed for the
  match (the existing `points:total` message keeps updating the local player's own HUD
  as before). Reconnect keeps the cached info.
- Client (`nameplate.ts`): after the flag — or after the streak badge when it has
  replaced the flag — render `★ 1 240` in the plate font at reduced alpha, thousands
  separated by a thin space; hidden when `points` is undefined or 0. Width follows the
  existing measure-and-grow layout. `formatPoints(points?: number): string` is a pure
  function (`''` for undefined/0).

### Music variants (tool + client)

`tools/music/` (TypeScript, run with `bun`, ffmpeg the only external dependency):

- `build-variants.ts` decodes `packages/client/public/sounds/{lobby,match}-music.mp3`
  (25.2 s each) to float PCM via ffmpeg, synthesises the crop layer from a score in
  code, mixes it onto the base, and encodes four files at 128 kbps:
  `lobby-music-rice.mp3`, `match-music-rice.mp3`, `lobby-music-corn.mp3`,
  `match-music-corn.mp3`. Wheat keeps the base files.
- Beat grid from the loop length: lobby 42 beats (≈ 100 BPM, E minor), match 28 beats
  (≈ 66.7 BPM, A minor) — measured from the files (onset autocorrelation, chroma vs
  Krumhansl profiles). Phrases sit on that grid; note tails that run past the loop end
  wrap to its start, so the loop point stays seamless.
- **Rice**: Karplus–Strong plucks voiced like a koto (bright attack, ≈ 1.2 s decay),
  3–5-note motifs in the base's minor pentatonic (E G A B D / A C D E G), one phrase per
  14 beats; one long breathy tone per loop (sine + band-passed noise).
- **Corn**: the same pluck synthesis voiced darker as a nylon guitar, strummed chords
  (30 ms stagger) on sparse beats, plus a two-voice "trumpet" third (band-limited saw,
  5.5 Hz vibrato) once per phrase.
- Mix: layer peak ≈ 12 dB below the base's RMS-normalised level, soft limiter, no
  clipping, output loudness matched to the base within ±1 dB.
- DSP core (`tools/music/synth.ts`: pluck, saw/sine voices, envelope, mix, limiter,
  wrap) is pure functions with unit tests; ffmpeg is touched only by the build script.
- Client (`audio.ts`): the four ids join `LOOP_IDS` with `preload: false` (loaded on first
  play, so the start-up download does not grow by ≈ 1.5 MB); `MUSIC_TRACKS` maps
  `rice`/`corn` for both bases. `resolveMusicId` and the layer-based fade-outs are
  unchanged.

## Testing

- `cropTheme.test.ts`: `identity` present, valid hex, pairwise hue distance ≥ 40°.
- `audio.test.ts`: `resolveMusicId` returns the variant ids for rice/corn and the base
  for wheat and for no character; every variant id is in `LOOP_IDS`.
- `nameplate` formatting: `formatPoints` — `1240 → '★ 1 240'`, `0`/`undefined → ''`.
- Server: a Room test that `join` copies `pointsFor(ws)` into `PlayerInfo.points` and
  that bots have none.
- Generator: `synth.test.ts` — a pluck at 440 Hz peaks within ±2 % of 440 Hz in its
  spectrum, the mix never exceeds 1.0, the wrapped layer has exactly the loop's sample
  count, and loudness matching lands within ±1 dB on a synthetic base.
- Visual acceptance (controller, headless): a bot match per crop — my ring/arrow in my
  crop's colour, butterflies in the opponent's, points on the plates.
- Listening acceptance (human): the four variant files are sent to the chat; notes,
  timbres and levels are tuned by editing the score in the script and rebuilding.

## Files touched

- `packages/shared/src/types.ts` — `PlayerInfo.points?`.
- `packages/server/src/Room.ts`, `packages/server/src/index.ts` — `pointsFor` callback.
- `packages/client/src/lib/cropTheme.ts` — `identity`; `components/LobbyOverlay.vue` — read it.
- `packages/client/src/lib/player.ts` — `setIdentity`; `App.vue` — wiring.
- `packages/client/src/lib/insects.ts` — `setPalette`; `App.vue` — wiring.
- `packages/client/src/lib/celebrate.ts` — hue parameter; `components/GameOverOverlay.vue`.
- `packages/client/src/lib/nameplate.ts` — points text, `formatPoints`.
- `packages/client/src/lib/audio.ts` — four loop ids, `MUSIC_TRACKS`, lazy preload.
- `tools/music/build-variants.ts`, `tools/music/synth.ts` (+ tests) — generator.
- `packages/client/public/sounds/*-music-{rice,corn}.mp3` — generated assets.
