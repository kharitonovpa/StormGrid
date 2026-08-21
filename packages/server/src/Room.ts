import type { ServerWebSocket } from 'bun'
import type { Action, BonusType, CharacterType, DeathCause, PlayerId, PlayerInfo, WeatherType, WindDir, WatcherState, WatcherPrediction, WatcherScoreEntry, ReplayFrame, ReplayData } from '@wheee/shared'
import { TICK_DURATION_MS, RECONNECT_GRACE_MS, WAR_AND_PEACE_SURNAMES, BOARD_SIZE } from '@wheee/shared'
import { GameEngine } from './engine/GameEngine.js'
import { stateForPlayer, resultForPlayer, cloneState } from './engine/board.js'
import { chooseBotAction, BOT_PRACTICE, BOT_MATCH, type BotStrength } from './engine/bot.js'
import type { ServerMessage, WsData } from './protocol.js'
import { send } from './protocol.js'
import type { ReplayStore } from './ReplayStore.js'

function countryToFlag(code: string): string {
  return String.fromCodePoint(
    ...code.toUpperCase().split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65),
  )
}

function randomSurname(): string {
  return WAR_AND_PEACE_SURNAMES[Math.floor(Math.random() * WAR_AND_PEACE_SURNAMES.length)]
}

const RANDOM_FLAGS = [
  'RU', 'UA', 'DE', 'FR', 'JP', 'KR', 'BR', 'ES', 'IT', 'PL',
  'SE', 'NO', 'FI', 'CZ', 'TR', 'GR', 'NL', 'PT', 'GB', 'US',
  'CA', 'AU', 'IN', 'MX', 'AR', 'CL', 'CO', 'PE', 'EG', 'ZA',
  'KE', 'NG', 'GH', 'MA', 'TH', 'VN', 'ID', 'PH', 'MY', 'GE',
]

function randomFlag(): string {
  return countryToFlag(RANDOM_FLAGS[Math.floor(Math.random() * RANDOM_FLAGS.length)])
}

type PlayerSlot = {
  ws: ServerWebSocket<WsData> | null
  reconnectToken: string
  character: CharacterType
  action: Action | null
  disconnectedAt: number | null
  isBot: boolean
}

type WatcherSlot = {
  ws: ServerWebSocket<WsData>
  state: WatcherState
  pendingWinner: PlayerId | null
  pendingMoves: Partial<Record<PlayerId, Action>>
}

type PausedTimer = {
  remaining: number
  callback: () => void
}

const FORECAST_DISPLAY_MS = 3_000
const ARCHITECT_DECISION_MS = 8_000
const WEATHER_DISPLAY_MS = 4_000
const CLEANUP_DELAY_MS = 10_000

/* Practice (tutorial) mode: longer forecast to read hints, untimed ticks, dumber bot */
const PRACTICE_FORECAST_MS = 6_000
const PRACTICE_BOT_SKIP_CHANCE = 0.3
/**
 * An untimed tick still needs a floor. The newcomer's action is what normally
 * moves the game on, so if that action never arrives — a dropped frame, a socket
 * that died quietly — the room would otherwise sit here forever.
 */
const PRACTICE_TICK_TIMEOUT_MS = 90_000

const POINTS_WINNER = 10
const POINTS_MOVE = 5

/** Crate flavours. Which one it is has no effect — see placeStreakCrate(). */
const CRATE_TYPES: BonusType[] = ['time_extend', 'intel', 'clear_sky']

export type MatchEndData = {
  roomId: string
  playerAUserId: string | null
  playerBUserId: string | null
  characterA: string
  characterB: string
  winner: PlayerId | 'draw'
  rounds: number
  durationMs: number
  /** True when one of the players was a bot (queue fallback; the bot is always slot B). */
  vsBot: boolean
  watcherScores: WatcherScoreEntry[]
}

export type RoomCallbacks = {
  onDispose: (id: string) => void
  findNextRoom?: (excludeId: string) => string | null
  registerToken?: (token: string, pid: PlayerId) => void
  unregisterToken?: (token: string) => void
  gracePeriodMs?: number
  replayStore?: ReplayStore
  onMatchEnd?: (data: MatchEndData, replay: ReplayData) => void
}

export type RoomOpts = {
  /** Tutorial match vs bot: ticks wait for the player's action, no replays/stats, no spectators. */
  practice?: boolean
  /** Override the untimed-tick backstop. Tests use a short one; production takes the default. */
  practiceTickTimeoutMs?: number
  /**
   * Backward-compat capability handshake: whether every human in this room
   * declared `caps: ['lightning']` at matchmaking time. Required, not
   * optional — the field used to default to `true` when omitted, which put
   * the fail-closed invariant ("an old client never gets lightning") in the
   * memory of every call site instead of the type system. A room-creation
   * site that forgets it now fails to compile rather than silently shipping
   * lightning to an old client. (Room itself still keeps a fail-closed
   * runtime fallback for the rare direct construction that skips `opts`
   * entirely — see the constructor.)
   */
  lightningEnabled: boolean
}

export class Room {
  readonly id: string
  readonly practice: boolean
  /**
   * The one flag the engine gates lightning on: `!practice && caller's
   * lightningEnabled opt`. Practice always disables it regardless of what
   * was passed in — the tutorial must never see lightning (owner ruling).
   */
  readonly lightningEnabled: boolean
  private readonly practiceTickTimeoutMs: number
  private engine: GameEngine
  private players: Partial<Record<PlayerId, PlayerSlot>> = {}
  private watchers = new Map<string, WatcherSlot>()
  private architect: { ws: ServerWebSocket<WsData> } | null = null
  private architectDecisionReceived = false
  private architectBonusPlaced = false
  private architectTimer: ReturnType<typeof setTimeout> | null = null
  private tickTimer: ReturnType<typeof setTimeout> | null = null
  private botActionTimers = new Map<PlayerId, ReturnType<typeof setTimeout>>()
  /** Set once joinBot fills a slot; doubles as the "this match had a bot" flag. */
  botStrength: BotStrength | null = null
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null
  private callbacks: RoomCallbacks
  private ended = false
  private disposed = false
  private resolving = false

  /**
   * When the badge crate turns up, chosen once per match so its arrival cannot
   * be timed by habit. Round 1–4 of the match, after tick 1–4 of that round —
   * never at a round boundary, where it would just be part of the furniture.
   */
  private readonly crateRound = 1 + Math.floor(Math.random() * 4)
  private readonly crateTick = 1 + Math.floor(Math.random() * 4)
  private crateDropped = false

  private tickTimerStartedAt = 0
  private tickTimerDurationMs = 0
  private tickTimerCallback: (() => void) | null = null
  private architectTimerStartedAt = 0
  private architectTimerDurationMs = 0
  private architectTimerCallback: (() => void) | null = null

  private pausedTick: PausedTimer | null = null
  private pausedArchitect: PausedTimer | null = null
  private disconnectTimers: Partial<Record<PlayerId, ReturnType<typeof setTimeout>>> = {}

  private replayFrames: ReplayFrame[] = []
  private matchStartedAt = 0
  private playerUserIds: Record<PlayerId, string | null> = { A: null, B: null }
  private playerInfoCache: Record<PlayerId, PlayerInfo> = {
    A: { displayName: '', flag: '', streak: 0 },
    B: { displayName: '', flag: '', streak: 0 },
  }

  constructor(id: string, callbacks: RoomCallbacks, opts?: RoomOpts) {
    this.id = id
    this.practice = opts?.practice ?? false
    this.practiceTickTimeoutMs = opts?.practiceTickTimeoutMs ?? PRACTICE_TICK_TIMEOUT_MS
    // Belt-and-suspenders, in two layers: `!this.practice` guards the
    // tutorial no matter what opts says, and `?? false` is what a caller
    // gets if it skips `opts` entirely — fail-closed, not fail-open, so a
    // forgotten wire-up degrades to "no lightning" rather than "lightning
    // for a client that never declared support for it".
    this.lightningEnabled = !this.practice && (opts?.lightningEnabled ?? false)
    this.engine = new GameEngine(undefined, this.lightningEnabled)
    this.callbacks = callbacks
  }

  get playerCount(): number {
    return Object.keys(this.players).length
  }

  get isFull(): boolean {
    return this.playerCount === 2
  }

  get isActive(): boolean {
    const phase = this.engine.getState().phase
    if (!this.isFull || phase === 'finished' || phase === 'waiting') return false
    for (const pid of ['A', 'B'] as PlayerId[]) {
      const slot = this.players[pid]
      if (slot?.ws) return true
    }
    return false
  }

  private get isAnyPlayerDisconnected(): boolean {
    for (const pid of ['A', 'B'] as PlayerId[]) {
      const slot = this.players[pid]
      if (slot && !slot.isBot && slot.disconnectedAt !== null) return true
    }
    return false
  }

  /* ── Player management ── */

  join(ws: ServerWebSocket<WsData>, character: CharacterType = 'wheat', streak = 0): PlayerId | null {
    let pid: PlayerId
    if (!this.players.A) pid = 'A'
    else if (!this.players.B) pid = 'B'
    else return null

    const reconnectToken = crypto.randomUUID()
    this.players[pid] = { ws, reconnectToken, character, action: null, disconnectedAt: null, isBot: false }
    this.playerUserIds[pid] = ws.data.userId ?? null
    this.playerInfoCache[pid] = {
      displayName: ws.data.userName ?? randomSurname(),
      flag: ws.data.countryCode ? countryToFlag(ws.data.countryCode) : randomFlag(),
      // Self-reported and purely cosmetic — see PlayerInfo.streak.
      streak: Number.isFinite(streak) && streak > 0 ? Math.floor(streak) : 0,
    }
    ws.data.roomId = this.id
    ws.data.playerId = pid
    ws.data.role = 'player'

    this.callbacks.registerToken?.(reconnectToken, pid)

    if (this.isFull) {
      this.matchStartedAt = Date.now()
      this.startGame()
    }

    return pid
  }

  joinBot(character: CharacterType = 'wheat', strength: BotStrength = BOT_MATCH): PlayerId | null {
    let pid: PlayerId
    if (!this.players.A) pid = 'A'
    else if (!this.players.B) pid = 'B'
    else return null

    this.players[pid] = {
      ws: null, reconnectToken: '', character, action: null,
      disconnectedAt: null, isBot: true,
    }
    this.botStrength = strength
    const other: PlayerId = pid === 'A' ? 'B' : 'A'
    let name = randomSurname()
    let attempts = 0
    while (name === this.playerInfoCache[other].displayName && attempts++ < 5) name = randomSurname()
    // The bot never carries a badge — the crate is always addressed to the human.
    this.playerInfoCache[pid] = { displayName: name, flag: randomFlag(), streak: 0 }

    if (this.isFull) {
      this.matchStartedAt = Date.now()
      this.startGame()
    }

    return pid
  }

  submitAction(pid: PlayerId, action: Action): void {
    if (this.ended) return
    const slot = this.players[pid]
    if (!slot || (!slot.ws && !slot.isBot)) return

    const state = this.engine.getState()
    if (state.phase !== 'ticking') return
    if (slot.action !== null) return

    slot.action = invertForB(pid, action)

    if (this.practice && !slot.isBot) {
      // Untimed tick: the human's action drives the game — pick the bot's
      // reply now (occasionally skipping, to go easy on the newcomer) and resolve.
      const botPid: PlayerId = pid === 'A' ? 'B' : 'A'
      const botSlot = this.players[botPid]
      if (botSlot?.isBot && botSlot.action === null && Math.random() >= PRACTICE_BOT_SKIP_CHANCE) {
        const botAction = chooseBotAction(this.engine.getState(), botPid, BOT_PRACTICE)
        if (botAction) botSlot.action = invertForB(botPid, botAction)
      }
      this.resolveTick()
      return
    }

    // Presence, not information: the opponent learns a move was locked in,
    // never which one. Sent before the both-acted check so the indicator still
    // flashes on the tick it completes.
    const otherPid: PlayerId = pid === 'A' ? 'B' : 'A'
    const otherSlot = this.players[otherPid]
    if (otherSlot?.ws) {
      send(otherSlot.ws, { type: 'opponent:acted', tick: state.tick })
    }

    if (this.players.A && this.players.B
      && this.players.A.action !== null && this.players.B.action !== null) {
      this.resolveTick()
    }
  }

  removePlayer(pid: PlayerId): void {
    const slot = this.players[pid]
    if (!slot) return

    const gameStarted = this.engine.getState().phase !== 'waiting'

    if (gameStarted && !this.ended) {
      this.handleDisconnect(pid)
    } else {
      if (slot.reconnectToken) this.callbacks.unregisterToken?.(slot.reconnectToken)
      delete this.players[pid]
    }
  }

  handleDisconnect(pid: PlayerId): void {
    const slot = this.players[pid]
    if (!slot || this.ended) return

    if (this.practice) {
      // Tutorial has no reconnect: the player left, tear the room down.
      this.dispose()
      return
    }

    slot.ws = null
    slot.disconnectedAt = Date.now()

    this.pauseTickTimer()
    this.pauseArchitectTimer()

    const opponent: PlayerId = pid === 'A' ? 'B' : 'A'
    const oppSlot = this.players[opponent]
    if (oppSlot?.ws) {
      send(oppSlot.ws, { type: 'opponent:disconnected' })
    }

    const graceMs = this.callbacks.gracePeriodMs ?? RECONNECT_GRACE_MS
    this.disconnectTimers[pid] = setTimeout(() => {
      delete this.disconnectTimers[pid]
      this.forfeitPlayer(pid)
    }, graceMs)
  }

  reconnectPlayer(pid: PlayerId, ws: ServerWebSocket<WsData>): boolean {
    const slot = this.players[pid]
    if (!slot || this.ended || this.disposed || slot.disconnectedAt === null) return false

    slot.ws = ws
    slot.disconnectedAt = null
    ws.data.roomId = this.id
    ws.data.playerId = pid
    ws.data.role = 'player'

    const timer = this.disconnectTimers[pid]
    if (timer) { clearTimeout(timer); delete this.disconnectTimers[pid] }

    const remaining = this.pausedTick?.remaining ?? 0
    const deadline = Date.now() + remaining
    const state = this.engine.getState()

    let forecastDeadline = 0
    if (state.phase === 'forecast') {
      const archRemaining = this.pausedArchitect?.remaining ?? 0
      forecastDeadline = Date.now() + Math.max(remaining, archRemaining)
    }

    send(ws, {
      type: 'reconnect:ok',
      playerId: pid,
      state: stateForPlayer(state, pid),
      tick: state.tick,
      deadline,
      forecastDeadline,
      playerInfo: this.playerInfoCache,
    })

    const opponent: PlayerId = pid === 'A' ? 'B' : 'A'
    const oppSlot = this.players[opponent]
    if (oppSlot?.ws) {
      send(oppSlot.ws, { type: 'opponent:reconnected' })
      if (state.phase === 'ticking') {
        send(oppSlot.ws, { type: 'tick:start', tick: state.tick, deadline })
      }
    }

    if (!this.isAnyPlayerDisconnected) {
      this.resumeTimers()
    }

    return true
  }

  private forfeitPlayer(pid: PlayerId): void {
    const slot = this.players[pid]
    if (slot?.reconnectToken) {
      this.callbacks.unregisterToken?.(slot.reconnectToken)
    }

    delete this.players[pid]
    this.ended = true
    this.clearTimer()
    this.clearArchitectTimer()
    this.clearPausedTimers()
    this.clearDisconnectTimers()

    const opponent: PlayerId = pid === 'A' ? 'B' : 'A'
    this.saveReplay(opponent)
    const dcCauses: Partial<Record<PlayerId, DeathCause>> = { [pid]: { type: 'disconnect' as const } }
    const oppSlot = this.players[opponent]
    if (oppSlot?.ws) {
      send(oppSlot.ws, { type: 'game:end', winner: opponent, deathCauses: dcCauses })
      oppSlot.ws.data.roomId = null
      oppSlot.ws.data.playerId = null
      oppSlot.ws.data.role = null
    }
    if (oppSlot?.reconnectToken) {
      this.callbacks.unregisterToken?.(oppSlot.reconnectToken)
    }
    this.broadcastSpectators({ type: 'game:end', winner: opponent, deathCauses: dcCauses })
    this.scheduleCleanup()
  }

  /* ── Watcher management ── */

  addWatcher(ws: ServerWebSocket<WsData>): void {
    const sid = ws.data.sessionId
    const watcherState: WatcherState = { score: 0, predictions: [], breakUsed: false }
    this.watchers.set(sid, {
      ws,
      state: watcherState,
      pendingWinner: null,
      pendingMoves: {},
    })
    ws.data.roomId = this.id
    ws.data.role = 'watcher'

    send(ws, {
      type: 'watch:assigned',
      roomId: this.id,
      state: this.engine.getState(),
      watcherState,
      playerInfo: this.playerInfoCache,
    })
  }

  removeWatcher(ws: ServerWebSocket<WsData>): void {
    this.watchers.delete(ws.data.sessionId)
    ws.data.roomId = null
    ws.data.role = null
  }

  /* ── Watcher actions ── */

  watcherPredictWinner(ws: ServerWebSocket<WsData>, playerId: PlayerId): void {
    const slot = this.watchers.get(ws.data.sessionId)
    if (!slot) return
    const state = this.engine.getState()
    if (state.phase !== 'forecast') return
    if (slot.pendingWinner !== null) return
    slot.pendingWinner = playerId
  }

  watcherPredictMove(ws: ServerWebSocket<WsData>, target: PlayerId, action: Action): void {
    const slot = this.watchers.get(ws.data.sessionId)
    if (!slot) return
    const state = this.engine.getState()
    if (state.phase !== 'ticking') return
    if (slot.pendingMoves[target]) return
    slot.pendingMoves[target] = action
  }

  watcherBreakInstrument(ws: ServerWebSocket<WsData>, instrument: 'vane' | 'barometer'): void {
    const slot = this.watchers.get(ws.data.sessionId)
    if (!slot) return
    if (slot.state.breakUsed) return

    const state = this.engine.getState()
    if (state.phase === 'finished' || state.phase === 'waiting') return

    slot.state.breakUsed = true
    this.engine.breakInstrument('A', instrument)
    this.engine.breakInstrument('B', instrument)

    const updatedState = this.engine.getState()
    this.sendEach((pid) => ({ type: 'forecast:update', state: stateForPlayer(updatedState, pid) }))
    this.broadcastWatchers({ type: 'forecast:update', state: updatedState })
  }

  /* ── Architect management ── */

  addArchitect(ws: ServerWebSocket<WsData>): boolean {
    if (this.architect) return false
    this.architect = { ws }
    ws.data.roomId = this.id
    ws.data.role = 'architect'

    send(ws, { type: 'architect:assigned', roomId: this.id, state: this.engine.getState(), playerInfo: this.playerInfoCache })

    const state = this.engine.getState()
    if (state.phase === 'forecast' && !this.architectDecisionReceived) {
      this.clearTimer()
      this.sendArchitectPrompt()
      this.setArchitectTimerTracked(ARCHITECT_DECISION_MS, () => {
        this.architectTimer = null
        this.proceedToTicking()
      })
    }
    return true
  }

  removeArchitect(ws: ServerWebSocket<WsData>): void {
    if (!this.architect || this.architect.ws !== ws) return
    this.architect = null
    ws.data.roomId = null
    ws.data.role = null

    const hadTimer = this.architectTimer !== null || this.pausedArchitect !== null
    this.clearArchitectTimer()

    if (hadTimer && !this.ended && !this.architectDecisionReceived) {
      const state = this.engine.getState()
      if (state.phase === 'forecast') {
        this.setTickTimer(FORECAST_DISPLAY_MS, () => this.proceedToTicking())
      }
    }
  }

  architectSetWeather(ws: ServerWebSocket<WsData>, type: WeatherType, dir: WindDir): void {
    if (!this.architect || this.architect.ws !== ws) return
    const state = this.engine.getState()
    if (state.phase !== 'forecast') return
    if (this.architectDecisionReceived) return

    this.engine.setWeatherDecision(type, dir)
    this.architectDecisionReceived = true

    const updated = this.engine.getState()
    const forecastDeadline = Date.now() + FORECAST_DISPLAY_MS
    this.sendEach((pid) => ({ type: 'round:start', state: stateForPlayer(updated, pid), forecastDeadline }))
    this.broadcastWatchers({ type: 'round:start', state: updated, forecastDeadline })

    this.clearArchitectTimer()
    this.setTickTimer(FORECAST_DISPLAY_MS, () => this.proceedToTicking())
  }

  architectPlaceBonus(ws: ServerWebSocket<WsData>, x: number, y: number, bonusType: BonusType): void {
    if (!this.architect || this.architect.ws !== ws) return
    if (this.architectBonusPlaced) return
    const state = this.engine.getState()
    if (state.phase !== 'forecast') return

    if (this.engine.placeBonus(x, y, bonusType)) {
      this.architectBonusPlaced = true
      const updated = this.engine.getState()
      this.sendEach((pid) => ({ type: 'forecast:update', state: stateForPlayer(updated, pid) }))
      this.broadcastWatchers({ type: 'forecast:update', state: updated })
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.ended = true
    this.clearTimer()
    this.clearBotTimers()
    this.clearPausedTimers()
    if (this.cleanupTimer) { clearTimeout(this.cleanupTimer); this.cleanupTimer = null }
    this.clearArchitectTimer()
    this.clearDisconnectTimers()

    for (const pid of ['A', 'B'] as PlayerId[]) {
      const slot = this.players[pid]
      if (slot?.reconnectToken) this.callbacks.unregisterToken?.(slot.reconnectToken)
    }

    this.redirectWatchers()
    this.players = {}
    this.watchers.clear()
    this.architect = null
    this.callbacks.onDispose(this.id)
  }

  /* ── Private: game flow ── */

  private startGame(): void {
    this.engine.setCharacters(this.players.A!.character, this.players.B!.character)
    const state = this.engine.getState()

    for (const pid of ['A', 'B'] as PlayerId[]) {
      const slot = this.players[pid]!
      if (slot.ws) {
        send(slot.ws, {
          type: 'game:start',
          playerId: pid,
          state: stateForPlayer(state, pid),
          reconnectToken: slot.reconnectToken,
          roomId: this.id,
          playerInfo: this.playerInfoCache,
          ...(this.practice ? { practice: true } : {}),
        })
      }
    }

    this.beginRound()
  }

  private beginRound(): void {
    this.architectDecisionReceived = false
    this.architectBonusPlaced = false
    const state = this.engine.startRound()
    const waitMs = this.architect ? ARCHITECT_DECISION_MS
      : this.practice ? PRACTICE_FORECAST_MS
      : FORECAST_DISPLAY_MS
    const forecastDeadline = Date.now() + waitMs
    this.sendEach((pid) => ({ type: 'round:start', state: stateForPlayer(state, pid), forecastDeadline }))
    this.broadcastWatchers({ type: 'round:start', state, forecastDeadline })
    this.broadcastArchitect({ type: 'round:start', state, forecastDeadline })

    if (this.architect) {
      this.sendArchitectPrompt()
      this.setArchitectTimerTracked(ARCHITECT_DECISION_MS, () => {
        this.architectTimer = null
        this.proceedToTicking()
      })
    } else {
      this.setTickTimer(waitMs, () => this.proceedToTicking())
    }
  }

  /**
   * Drop the crate that seeds a streak badge.
   *
   * Addressing exists for one reason: to stop a player who already carries a
   * badge from stepping on the crate purely to deny it. So it is only addressed
   * when exactly one side lacks a badge. With neither side carrying one there is
   * no veteran to guard against, and the crate is left open — a race, first there
   * takes it, which the engine already resolves (and burns if both arrive at once).
   *
   * It shows up once per match at a moment picked at the start (see
   * `crateRound` / `crateTick`) rather than on a schedule anyone can learn.
   * Skipped in the tutorial (busy enough already) and when an architect is
   * present, since placing bonuses is their job.
   */
  private placeStreakCrate(): void {
    if (this.practice || this.architect || this.crateDropped) return

    const candidates = (['A', 'B'] as PlayerId[])
      .filter((pid) => this.players[pid] && !this.players[pid]!.isBot
        && this.playerInfoCache[pid].streak === 0)
    if (candidates.length === 0) return

    // Two hopefuls means an open crate; one means it is spoken for.
    const target = candidates.length === 1 ? candidates[0] : undefined
    const state = this.engine.getState()
    const free: { x: number; y: number }[] = []
    for (let y = 0; y < BOARD_SIZE; y++) {
      for (let x = 0; x < BOARD_SIZE; x++) {
        const occupied = (['A', 'B'] as PlayerId[]).some((pid) => {
          const p = state.players[pid]
          return p.alive && p.x === x && p.y === y
        })
        if (!occupied) free.push({ x, y })
      }
    }
    if (free.length === 0) return

    const cell = free[Math.floor(Math.random() * free.length)]
    // The type is decorative: the badge ladder does not depend on which crate it was.
    const type = CRATE_TYPES[Math.floor(Math.random() * CRATE_TYPES.length)]
    if (this.engine.placeBonus(cell.x, cell.y, type, target)) this.crateDropped = true
  }

  private sendArchitectPrompt(): void {
    if (!this.architect) return
    const deadline = Date.now() + ARCHITECT_DECISION_MS
    send(this.architect.ws, { type: 'architect:prompt', deadline })
  }

  private proceedToTicking(): void {
    if (this.ended) return
    this.clearArchitectTimer()
    this.engine.beginTicking()
    this.beginTick()
  }

  private beginTick(): void {
    if (this.ended) return
    if (this.players.A) this.players.A.action = null
    if (this.players.B) this.players.B.action = null

    for (const slot of this.watchers.values()) {
      slot.pendingMoves = {}
    }

    const state = this.engine.getState()

    if (this.practice) {
      // Untimed tick: no deadline, no bot scheduling — the game waits for the player.
      this.broadcast({ type: 'tick:start', tick: state.tick, deadline: 0 })
      // ...but not forever. If the action never lands, the tick resolves anyway.
      this.setTickTimer(this.practiceTickTimeoutMs, () => this.resolveTick())
      return
    }

    const deadline = Date.now() + TICK_DURATION_MS

    const msg: ServerMessage = { type: 'tick:start', tick: state.tick, deadline }
    this.broadcast(msg)
    this.broadcastSpectators(msg)

    this.setTickTimer(TICK_DURATION_MS, () => {
      this.resolveTick()
    })

    this.scheduleBotAction()
  }

  private resolveTick(): void {
    // Two things can ask for the same tick now — the player's action and the
    // practice fallback timer — and they can land in the same instant. Only the
    // first one gets to resolve; the phase check covers the timer arriving late,
    // after the round has already moved on.
    if (this.resolving || this.ended) return
    if (this.engine.getState().phase !== 'ticking') return
    this.resolving = true

    try {
      this.clearTimer()

      const actions: Partial<Record<PlayerId, Action>> = {}
      if (this.players.A?.action) actions.A = this.players.A.action
      if (this.players.B?.action) actions.B = this.players.B.action

      const result = this.engine.submitTick(actions)

      // The crate appears between ticks, so the player watches it arrive rather
      // than finding it already there when the round opens.
      if (result.state.round === this.crateRound && result.state.tick === this.crateTick) {
        this.placeStreakCrate()
        // submitTick handed back a clone, so the fresh crate has to be copied in.
        result.state.activeBonus = this.engine.getState().activeBonus
      }

      this.replayFrames.push({ state: cloneState(result.state) })
      // The pickup rides along so the client can seed the badge streak.
      const picked = result.activatedBonus
        ? { bonus: { player: result.activatedBonus.player, type: result.activatedBonus.bonus } }
        : {}
      this.sendEach((pid) => ({ type: 'tick:resolve', state: stateForPlayer(result.state, pid), ...picked }))
      this.broadcastSpectators({ type: 'tick:resolve', state: result.state, ...picked })

      this.resolveMovePredictions(actions)

      if (result.state.phase === 'weather') {
        this.setTickTimer(500, () => this.executeWeather())
      } else {
        this.setTickTimer(300, () => this.beginTick())
      }
    } finally {
      this.resolving = false
    }
  }

  private executeWeather(): void {
    const result = this.engine.executeWeather()
    this.replayFrames.push({
      state: cloneState(result.state),
      weather: {
        deaths: result.deaths,
        windPath: result.windPath as Record<PlayerId, { x: number; y: number }[]>,
        floodedCells: [...result.floodedCells, ...result.floodedCellsB],
        boltCell: result.boltCell,
      },
    })
    this.sendEach((pid) => ({ type: 'weather:result', result: resultForPlayer(result, pid) }))
    this.broadcastSpectators({ type: 'weather:result', result })

    this.resolveWinnerPredictions()

    if (result.state.winner !== null) {
      this.saveReplay(result.state.winner)
      const endMsg: ServerMessage = { type: 'game:end', winner: result.state.winner, deathCauses: result.deathCauses }
      this.broadcast(endMsg)
      this.broadcastSpectators(endMsg)
      this.releasePlayerSlots()
      this.scheduleCleanup()
    } else {
      this.setTickTimer(WEATHER_DISPLAY_MS, () => this.beginRound())
    }
  }

  private saveReplay(winner: PlayerId | 'draw'): void {
    if (this.practice) return // tutorial matches don't count: no replay, no stats

    const charA = this.players.A?.character ?? this.engine.getState().players.A.character
    const charB = this.players.B?.character ?? this.engine.getState().players.B.character
    const replay: ReplayData = {
      id: this.id,
      charA,
      charB,
      winner,
      frameCount: this.replayFrames.length,
      frames: this.replayFrames,
    }

    this.callbacks.replayStore?.save(replay)

    const bestByUser = new Map<string, number>()
    for (const slot of this.watchers.values()) {
      const uid = slot.ws.data.userId
      if (uid && slot.state.score > 0) {
        const prev = bestByUser.get(uid) ?? 0
        if (slot.state.score > prev) bestByUser.set(uid, slot.state.score)
      }
    }
    const watcherScores: WatcherScoreEntry[] = []
    for (const [userId, score] of bestByUser) {
      watcherScores.push({ userId, score })
    }

    this.callbacks.onMatchEnd?.({
      roomId: this.id,
      playerAUserId: this.playerUserIds.A,
      playerBUserId: this.playerUserIds.B,
      characterA: charA,
      characterB: charB,
      winner,
      rounds: this.engine.getState().round,
      durationMs: this.matchStartedAt > 0 ? Date.now() - this.matchStartedAt : 0,
      vsBot: this.botStrength !== null,
      watcherScores,
    }, replay)
  }

  /* ── Prediction resolution ── */

  private resolveMovePredictions(actualActions: Partial<Record<PlayerId, Action>>): void {
    const state = this.engine.getState()
    for (const slot of this.watchers.values()) {
      for (const target of ['A', 'B'] as PlayerId[]) {
        const predicted = slot.pendingMoves[target]
        if (!predicted) continue

        const actual = actualActions[target]
        const correct = actual !== undefined && actionsMatch(predicted, actual)
        const points = correct ? POINTS_MOVE : 0

        const prediction: WatcherPrediction = {
          type: 'move',
          round: state.round,
          tick: state.tick,
          target,
          predictedAction: predicted,
          correct,
          points,
        }
        slot.state.predictions.push(prediction)
        slot.state.score += points
        send(slot.ws, { type: 'watcher:score', delta: points, total: slot.state.score, prediction })
      }
    }
  }

  private resolveWinnerPredictions(): void {
    const state = this.engine.getState()
    const roundWinner: PlayerId | null =
      !state.players.A.alive && !state.players.B.alive ? null
      : !state.players.A.alive ? 'B'
      : !state.players.B.alive ? 'A'
      : null

    for (const slot of this.watchers.values()) {
      if (slot.pendingWinner === null) continue

      const correct = roundWinner !== null && slot.pendingWinner === roundWinner
      const points = correct ? POINTS_WINNER : 0

      const prediction: WatcherPrediction = {
        type: 'winner',
        round: state.round,
        predictedWinner: slot.pendingWinner,
        correct,
        points,
      }
      slot.state.predictions.push(prediction)
      slot.state.score += points
      send(slot.ws, { type: 'watcher:score', delta: points, total: slot.state.score, prediction })
      slot.pendingWinner = null
    }
  }

  /* ── Watcher redirect ── */

  private redirectWatchers(): void {
    const nextRoomId = this.callbacks.findNextRoom?.(this.id) ?? null
    for (const slot of this.watchers.values()) {
      if (nextRoomId) {
        send(slot.ws, { type: 'watcher:redirect', roomId: nextRoomId })
      } else {
        send(slot.ws, { type: 'watch:no_match' })
      }
      slot.ws.data.roomId = null
      slot.ws.data.role = null
    }
  }

  private releasePlayerSlots(): void {
    this.ended = true
    this.clearDisconnectTimers()
    this.clearPausedTimers()
    for (const pid of ['A', 'B'] as PlayerId[]) {
      const slot = this.players[pid]
      if (slot) {
        if (slot.reconnectToken) this.callbacks.unregisterToken?.(slot.reconnectToken)
        if (slot.ws) {
          slot.ws.data.roomId = null
          slot.ws.data.playerId = null
          slot.ws.data.role = null
        }
      }
    }
  }

  private scheduleCleanup(): void {
    this.clearTimer()
    this.clearPausedTimers()
    if (this.cleanupTimer) { clearTimeout(this.cleanupTimer); this.cleanupTimer = null }
    this.cleanupTimer = setTimeout(() => this.dispose(), CLEANUP_DELAY_MS)
  }

  /* ── Bot action scheduling ── */

  private scheduleBotAction(): void {
    this.clearBotTimers()
    for (const pid of ['A', 'B'] as PlayerId[]) {
      const slot = this.players[pid]
      if (!slot?.isBot) continue

      const delay = 1000 + Math.random() * 3000
      const timer = setTimeout(() => {
        this.botActionTimers.delete(pid)
        if (this.ended) return
        const state = this.engine.getState()
        if (state.phase !== 'ticking') return
        const action = chooseBotAction(state, pid, this.botStrength ?? BOT_MATCH)
        if (action) this.submitAction(pid, action)
      }, delay)
      this.botActionTimers.set(pid, timer)
    }
  }

  private clearBotTimers(): void {
    for (const timer of this.botActionTimers.values()) {
      clearTimeout(timer)
    }
    this.botActionTimers.clear()
  }

  /* ── Timer management ── */

  private setTickTimer(durationMs: number, callback: () => void): void {
    this.clearTimer()
    this.pausedTick = null

    if (this.isAnyPlayerDisconnected) {
      this.pausedTick = { remaining: durationMs, callback }
      return
    }

    this.tickTimerStartedAt = Date.now()
    this.tickTimerDurationMs = durationMs
    this.tickTimerCallback = callback
    this.tickTimer = setTimeout(callback, durationMs)
  }

  private setArchitectTimerTracked(durationMs: number, callback: () => void): void {
    this.clearArchitectTimer()
    this.pausedArchitect = null

    if (this.isAnyPlayerDisconnected) {
      this.pausedArchitect = { remaining: durationMs, callback }
      return
    }

    this.architectTimerStartedAt = Date.now()
    this.architectTimerDurationMs = durationMs
    this.architectTimerCallback = callback
    this.architectTimer = setTimeout(callback, durationMs)
  }

  private pauseTickTimer(): void {
    if (this.tickTimer === null) return
    const elapsed = Date.now() - this.tickTimerStartedAt
    const remaining = Math.max(0, this.tickTimerDurationMs - elapsed)
    this.pausedTick = { remaining, callback: this.tickTimerCallback! }
    clearTimeout(this.tickTimer)
    this.tickTimer = null
    this.tickTimerCallback = null
  }

  private pauseArchitectTimer(): void {
    if (this.architectTimer === null) return
    const elapsed = Date.now() - this.architectTimerStartedAt
    const remaining = Math.max(0, this.architectTimerDurationMs - elapsed)
    this.pausedArchitect = { remaining, callback: this.architectTimerCallback! }
    clearTimeout(this.architectTimer)
    this.architectTimer = null
    this.architectTimerCallback = null
  }

  private resumeTimers(): void {
    if (this.pausedTick) {
      const { remaining, callback } = this.pausedTick
      this.pausedTick = null
      this.setTickTimer(remaining, callback)
      this.scheduleBotAction()
    }
    if (this.pausedArchitect) {
      const { remaining, callback } = this.pausedArchitect
      this.pausedArchitect = null
      this.setArchitectTimerTracked(remaining, callback)
    }
  }

  private clearTimer(): void {
    if (this.tickTimer !== null) {
      clearTimeout(this.tickTimer)
      this.tickTimer = null
    }
    this.tickTimerCallback = null
    this.clearBotTimers()
  }

  private clearArchitectTimer(): void {
    if (this.architectTimer !== null) {
      clearTimeout(this.architectTimer)
      this.architectTimer = null
    }
    this.architectTimerCallback = null
  }

  private clearPausedTimers(): void {
    this.pausedTick = null
    this.pausedArchitect = null
  }

  private clearDisconnectTimers(): void {
    for (const pid of ['A', 'B'] as PlayerId[]) {
      const t = this.disconnectTimers[pid]
      if (t) { clearTimeout(t); delete this.disconnectTimers[pid] }
    }
  }

  /* ── Helpers ── */

  private broadcast(msg: ServerMessage): void {
    for (const pid of ['A', 'B'] as PlayerId[]) {
      const slot = this.players[pid]
      if (slot?.ws) send(slot.ws, msg)
    }
  }

  private broadcastWatchers(msg: ServerMessage): void {
    for (const slot of this.watchers.values()) {
      send(slot.ws, msg)
    }
  }

  private broadcastArchitect(msg: ServerMessage): void {
    if (this.architect) send(this.architect.ws, msg)
  }

  private broadcastSpectators(msg: ServerMessage): void {
    this.broadcastWatchers(msg)
    this.broadcastArchitect(msg)
  }

  private sendEach(msgFn: (pid: PlayerId) => ServerMessage): void {
    for (const pid of ['A', 'B'] as PlayerId[]) {
      const slot = this.players[pid]
      if (slot?.ws) send(slot.ws, msgFn(pid))
    }
  }
}

/** Player B's raise/lower are expressed in B's inverted frame — convert to canonical. */
function invertForB(pid: PlayerId, action: Action): Action {
  return pid === 'B' && (action.kind === 'raise' || action.kind === 'lower')
    ? { ...action, kind: action.kind === 'raise' ? 'lower' : 'raise' }
    : action
}

function actionsMatch(a: Action, b: Action): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'move' && b.kind === 'move') return a.dir === b.dir
  if ((a.kind === 'raise' || a.kind === 'lower') && (b.kind === 'raise' || b.kind === 'lower')) {
    return a.x === b.x && a.y === b.y
  }
  return false
}
