import type { ServerWebSocket } from 'bun'
import type { Action, BonusType, CharacterType, PlayerId, WeatherType, WindDir, WatcherState, WatcherPrediction, ReplayFrame, ReplayData } from '@wheee/shared'
import { TICK_DURATION_MS, RECONNECT_GRACE_MS } from '@wheee/shared'
import { GameEngine } from './engine/GameEngine.js'
import { stateForPlayer, resultForPlayer, cloneState } from './engine/board.js'
import type { ServerMessage, WsData } from './protocol.js'
import { send } from './protocol.js'
import type { ReplayStore } from './ReplayStore.js'

type PlayerSlot = {
  ws: ServerWebSocket<WsData> | null
  reconnectToken: string
  character: CharacterType
  action: Action | null
  disconnectedAt: number | null
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

const POINTS_WINNER = 10
const POINTS_MOVE = 5

export type RoomCallbacks = {
  onDispose: (id: string) => void
  findNextRoom?: (excludeId: string) => string | null
  registerToken?: (token: string, pid: PlayerId) => void
  unregisterToken?: (token: string) => void
  gracePeriodMs?: number
  replayStore?: ReplayStore
}

export class Room {
  readonly id: string
  private engine: GameEngine
  private players: Partial<Record<PlayerId, PlayerSlot>> = {}
  private watchers = new Map<string, WatcherSlot>()
  private architect: { ws: ServerWebSocket<WsData> } | null = null
  private architectDecisionReceived = false
  private architectBonusPlaced = false
  private architectTimer: ReturnType<typeof setTimeout> | null = null
  private tickTimer: ReturnType<typeof setTimeout> | null = null
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null
  private callbacks: RoomCallbacks
  private ended = false
  private disposed = false

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

  constructor(id: string, callbacks: RoomCallbacks) {
    this.id = id
    this.engine = new GameEngine()
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
      if (slot && slot.disconnectedAt !== null) return true
    }
    return false
  }

  /* ── Player management ── */

  join(ws: ServerWebSocket<WsData>, character: CharacterType = 'wheat'): PlayerId | null {
    let pid: PlayerId
    if (!this.players.A) pid = 'A'
    else if (!this.players.B) pid = 'B'
    else return null

    const reconnectToken = crypto.randomUUID()
    this.players[pid] = { ws, reconnectToken, character, action: null, disconnectedAt: null }
    ws.data.roomId = this.id
    ws.data.playerId = pid
    ws.data.role = 'player'

    this.callbacks.registerToken?.(reconnectToken, pid)

    if (this.isFull) {
      this.startGame()
    }

    return pid
  }

  submitAction(pid: PlayerId, action: Action): void {
    if (this.ended) return
    const slot = this.players[pid]
    if (!slot || !slot.ws) return

    const state = this.engine.getState()
    if (state.phase !== 'ticking') return
    if (slot.action !== null) return

    slot.action = pid === 'B' && (action.kind === 'raise' || action.kind === 'lower')
      ? { ...action, kind: action.kind === 'raise' ? 'lower' : 'raise' }
      : action

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
      this.callbacks.unregisterToken?.(slot.reconnectToken)
      delete this.players[pid]
    }
  }

  handleDisconnect(pid: PlayerId): void {
    const slot = this.players[pid]
    if (!slot || this.ended) return

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

    send(ws, {
      type: 'reconnect:ok',
      playerId: pid,
      state: stateForPlayer(state, pid),
      tick: state.tick,
      deadline,
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
    if (slot) {
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
    const oppSlot = this.players[opponent]
    if (oppSlot?.ws) {
      send(oppSlot.ws, { type: 'game:end', winner: opponent })
      oppSlot.ws.data.roomId = null
      oppSlot.ws.data.playerId = null
      oppSlot.ws.data.role = null
    }
    if (oppSlot) {
      this.callbacks.unregisterToken?.(oppSlot.reconnectToken)
    }
    this.broadcastSpectators({ type: 'game:end', winner: opponent })
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

    send(ws, { type: 'architect:assigned', roomId: this.id, state: this.engine.getState() })

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
    this.sendEach((pid) => ({ type: 'round:start', state: stateForPlayer(updated, pid) }))
    this.broadcastWatchers({ type: 'round:start', state: updated })

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
    this.clearPausedTimers()
    if (this.cleanupTimer) { clearTimeout(this.cleanupTimer); this.cleanupTimer = null }
    this.clearArchitectTimer()
    this.clearDisconnectTimers()

    for (const pid of ['A', 'B'] as PlayerId[]) {
      const slot = this.players[pid]
      if (slot) this.callbacks.unregisterToken?.(slot.reconnectToken)
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
    const slotA = this.players.A!
    const slotB = this.players.B!
    send(slotA.ws!, {
      type: 'game:start',
      playerId: 'A',
      state: stateForPlayer(state, 'A'),
      reconnectToken: slotA.reconnectToken,
      roomId: this.id,
    })
    send(slotB.ws!, {
      type: 'game:start',
      playerId: 'B',
      state: stateForPlayer(state, 'B'),
      reconnectToken: slotB.reconnectToken,
      roomId: this.id,
    })

    this.beginRound()
  }

  private beginRound(): void {
    this.architectDecisionReceived = false
    this.architectBonusPlaced = false
    const state = this.engine.startRound()
    this.sendEach((pid) => ({ type: 'round:start', state: stateForPlayer(state, pid) }))
    this.broadcastWatchers({ type: 'round:start', state })
    this.broadcastArchitect({ type: 'round:start', state })

    if (this.architect) {
      this.sendArchitectPrompt()
      this.setArchitectTimerTracked(ARCHITECT_DECISION_MS, () => {
        this.architectTimer = null
        this.proceedToTicking()
      })
    } else {
      this.setTickTimer(FORECAST_DISPLAY_MS, () => this.proceedToTicking())
    }
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
    const deadline = Date.now() + TICK_DURATION_MS

    const msg: ServerMessage = { type: 'tick:start', tick: state.tick, deadline }
    this.broadcast(msg)
    this.broadcastSpectators(msg)

    this.setTickTimer(TICK_DURATION_MS, () => {
      this.resolveTick()
    })
  }

  private resolveTick(): void {
    this.clearTimer()

    const actions: Partial<Record<PlayerId, Action>> = {}
    if (this.players.A?.action) actions.A = this.players.A.action
    if (this.players.B?.action) actions.B = this.players.B.action

    const result = this.engine.submitTick(actions)
    this.replayFrames.push({ state: cloneState(result.state) })
    this.sendEach((pid) => ({ type: 'tick:resolve', state: stateForPlayer(result.state, pid) }))
    this.broadcastSpectators({ type: 'tick:resolve', state: result.state })

    this.resolveMovePredictions(actions)

    if (result.state.phase === 'weather') {
      this.setTickTimer(500, () => this.executeWeather())
    } else {
      this.setTickTimer(300, () => this.beginTick())
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
      },
    })
    this.sendEach((pid) => ({ type: 'weather:result', result: resultForPlayer(result, pid) }))
    this.broadcastSpectators({ type: 'weather:result', result })

    this.resolveWinnerPredictions()

    if (result.state.winner !== null) {
      this.saveReplay(result.state.winner)
      const endMsg: ServerMessage = { type: 'game:end', winner: result.state.winner }
      this.broadcast(endMsg)
      this.broadcastSpectators(endMsg)
      this.releasePlayerSlots()
      this.scheduleCleanup()
    } else {
      this.setTickTimer(WEATHER_DISPLAY_MS, () => this.beginRound())
    }
  }

  private saveReplay(winner: PlayerId | 'draw'): void {
    const store = this.callbacks.replayStore
    if (!store) return
    const charA = this.players.A?.character ?? this.engine.getState().players.A.character
    const charB = this.players.B?.character ?? this.engine.getState().players.B.character
    store.save({
      id: this.id,
      charA,
      charB,
      winner,
      frameCount: this.replayFrames.length,
      frames: this.replayFrames,
    })
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
        this.callbacks.unregisterToken?.(slot.reconnectToken)
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

function actionsMatch(a: Action, b: Action): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'move' && b.kind === 'move') return a.dir === b.dir
  if ((a.kind === 'raise' || a.kind === 'lower') && (b.kind === 'raise' || b.kind === 'lower')) {
    return a.x === b.x && a.y === b.y
  }
  return false
}
