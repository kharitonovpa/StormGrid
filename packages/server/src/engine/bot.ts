import type { Action, GameState, PlayerId, MoveDir, WindDir } from '@wheee/shared'
import { BOARD_SIZE, MOVE_DIRS, WIND_DIRS } from '@wheee/shared'
import { cloneState, inBounds } from './board.js'
import { applyTick } from './tick.js'
import { resolveWind } from './wind.js'
import { resolveRain } from './rain.js'

/**
 * The bot judges a move the way the round will judge it: it plays the move out
 * and runs the real cataclysm on the result, once for every weather the forecast
 * still leaves open. Nothing in here knows how wind or rain work — that lives in
 * wind.ts and rain.ts, and a rule change reaches the bot for free.
 *
 * Receives canonical (un-transformed) state and the bot's player id.
 * Room handles raise/lower inversion for player B.
 */

const ALL_MOVE_DIRS: MoveDir[] = ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']
const CENTER = Math.floor(BOARD_SIZE / 2)

export type BotStrength = {
  /** Chance of letting the tick pass. */
  skip: number
  /** Chance of a random legal action instead of a considered one. */
  blunder: number
  /** Whether it goes after the opponent once its own footing is safe. */
  hunt: boolean
}

/** Plays to win, but leaves the door open often enough to be beatable. */
export const BOT_MATCH: BotStrength = { skip: 0.04, blunder: 0.12, hunt: true }

/** First queue match: looks after itself, never attacks, stumbles a lot. */
export const BOT_GENTLE: BotStrength = { skip: 0.08, blunder: 0.30, hunt: false }

/** Second match: starts hunting, still generous with mistakes. */
export const BOT_MEDIUM: BotStrength = { skip: 0.05, blunder: 0.20, hunt: true }

/**
 * The queue's difficulty ramp. Streak is the client-kept win streak, so it
 * resets on every loss — a beaten player deliberately gets a softer bot next.
 */
export function botStrengthForStreak(streak: number): BotStrength {
  if (streak <= 0) return BOT_GENTLE
  if (streak === 1) return BOT_MEDIUM
  return BOT_MATCH
}

/**
 * The tutorial opponent: it looks after itself and never sets a trap, so the
 * newcomer loses only to the weather, which is the thing being taught.
 */
export const BOT_PRACTICE: BotStrength = { skip: 0.08, blunder: 0.35, hunt: false }

type Weather = { dir: WindDir | null; rain: boolean }

/**
 * What the bot is still allowed to believe. A watcher who broke the vane or the
 * barometer blinds the bot as much as a human: it falls back to defending against
 * everything the sky could do. An intact vane showing nothing means a still
 * round — the architect can call rain without wind.
 */
function possibleWeather(state: GameState, pid: PlayerId): Weather[] {
  const { windCandidates, rainProbability, instrumentsBroken } = state.forecast
  const broken = instrumentsBroken[pid]

  const dirs: readonly (WindDir | null)[] = broken.vane
    ? WIND_DIRS
    : windCandidates.length > 0 ? windCandidates : [null]
  // The barometer only ever reads 0/0.25 for a dry round and 0.75/1 for a wet one.
  const rains = broken.barometer ? [false, true] : [rainProbability >= 0.5]

  const out: Weather[] = []
  for (const dir of dirs) {
    for (const rain of rains) out.push({ dir, rain })
  }
  return out
}

/** Everything the bot could submit this tick, including standing still. */
function candidates(state: GameState, pid: PlayerId): (Action | null)[] {
  const me = state.players[pid]
  const acts: (Action | null)[] = [null]

  for (const dir of ALL_MOVE_DIRS) {
    const d = MOVE_DIRS[dir]
    if (inBounds(me.x + d.dx, me.y + d.dy)) acts.push({ kind: 'move', dir })
  }
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const h = state.board[y][x].height
      if (h < 1) acts.push({ kind: 'raise', x, y })
      if (h > -1) acts.push({ kind: 'lower', x, y })
    }
  }
  return acts
}

type Verdict = {
  /** Share of possible weathers the bot walks away from. */
  survive: number
  /** Share of them that take the opponent. */
  kill: number
  /** Distance from the middle, to settle ties in favour of open ground. */
  pull: number
}

function judge(
  state: GameState,
  pid: PlayerId,
  action: Action | null,
  weather: Weather[],
  hunt: boolean,
): Verdict {
  const opp: PlayerId = pid === 'A' ? 'B' : 'A'
  const after = applyTick(state, action ? { [pid]: action } : {}).state

  let survive = 0
  let kill = 0
  for (const w of weather) {
    const s = cloneState(after)
    const blown = w.dir ? resolveWind(s, w.dir).deaths.length > 0 : false
    // Same order the round uses: a wind death breaks the storm off before the rain.
    if (w.rain && !blown) resolveRain(s)
    if (s.players[pid].alive) survive++
    if (!s.players[opp].alive) kill++
  }

  const me = after.players[pid]
  return {
    survive: survive / weather.length,
    kill: hunt ? kill / weather.length : 0,
    pull: Math.abs(CENTER - me.x) + Math.abs(CENTER - me.y),
  }
}

/** Staying alive first, the opponent's grave second: a dead winner wins nothing. */
function beats(a: Verdict, b: Verdict): boolean {
  if (a.survive !== b.survive) return a.survive > b.survive
  if (a.kill !== b.kill) return a.kill > b.kill
  return a.pull < b.pull
}

function ties(a: Verdict, b: Verdict): boolean {
  return a.survive === b.survive && a.kill === b.kill && a.pull === b.pull
}

export function chooseBotAction(
  state: GameState,
  pid: PlayerId,
  strength: BotStrength = BOT_MATCH,
): Action | null {
  const me = state.players[pid]
  if (!me.alive) return null

  if (Math.random() < strength.skip) return null
  if (Math.random() < strength.blunder) return randomAction(me)

  const weather = possibleWeather(state, pid)

  let best: Verdict | null = null
  let bestActions: (Action | null)[] = []
  for (const action of candidates(state, pid)) {
    const verdict = judge(state, pid, action, weather, strength.hunt)
    if (!best || beats(verdict, best)) {
      best = verdict
      bestActions = [action]
    } else if (ties(verdict, best)) {
      bestActions.push(action)
    }
  }

  return bestActions[Math.floor(Math.random() * bestActions.length)] ?? null
}

function randomAction(me: { x: number; y: number }): Action {
  const r = Math.random()
  if (r < 0.5) {
    const valid = ALL_MOVE_DIRS.filter(md => {
      const m = MOVE_DIRS[md]
      return inBounds(me.x + m.dx, me.y + m.dy)
    })
    if (valid.length > 0) {
      return { kind: 'move', dir: valid[Math.floor(Math.random() * valid.length)] }
    }
  }

  const rx = me.x + Math.floor(Math.random() * 3) - 1
  const ry = me.y + Math.floor(Math.random() * 3) - 1
  if (inBounds(rx, ry)) {
    return r < 0.75
      ? { kind: 'raise', x: rx, y: ry }
      : { kind: 'lower', x: rx, y: ry }
  }

  return { kind: 'raise', x: me.x, y: me.y }
}
