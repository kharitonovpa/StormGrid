import type { ServerWebSocket } from 'bun'
import type { Action, BonusType, PlayerId, GameState, WeatherType, WindDir, WatcherState, WatcherPrediction } from '@stormgrid/shared'
import { TICK_DURATION_MS } from '@stormgrid/shared'
import { GameEngine } from './engine/GameEngine.js'
import { stateForPlayer, resultForPlayer } from './engine/board.js'
import type { ServerMessage, WsData } from './protocol.js'
import { send } from './protocol.js'

type PlayerSlot = {
  ws: ServerWebSocket<WsData>
  action: Action | null
}

type WatcherSlot = {
  ws: ServerWebSocket<WsData>
  state: WatcherState
  pendingWinner: PlayerId | null
  pendingMoves: Partial<Record<PlayerId, Action>>
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
    return this.isFull && phase !== 'finished' && phase !== 'waiting'
  }

  /* ── Player management ── */

  join(ws: ServerWebSocket<WsData>): PlayerId | null {
    let pid: PlayerId
    if (!this.players.A) pid = 'A'
    else if (!this.players.B) pid = 'B'
    else return null

    this.players[pid] = { ws, action: null }
    ws.data.roomId = this.id
    ws.data.playerId = pid
    ws.data.role = 'player'

    if (this.isFull) {
      this.startGame()
    }

    return pid
  }

  submitAction(pid: PlayerId, action: Action): void {
    if (this.ended) return
    const slot = this.players[pid]
    if (!slot) return

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
    delete this.players[pid]
    this.ended = true
    this.clearTimer()

    const opponent: PlayerId = pid === 'A' ? 'B' : 'A'
    const oppSlot = this.players[opponent]
    if (oppSlot) {
      send(oppSlot.ws, { type: 'game:end', winner: opponent })
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
    for (const pid of ['A', 'B'] as const) {
      const playerSlot = this.players[pid]
      if (playerSlot) {
        send(playerSlot.ws, { type: 'round:start', state: stateForPlayer(updatedState, pid) })
      }
    }
  }

  /* ── Architect management ── */

  addArchitect(ws: ServerWebSocket<WsData>): boolean {
    if (this.architect) return false
    this.architect = { ws }
    ws.data.roomId = this.id
    ws.data.role = 'architect'

    send(ws, { type: 'architect:assigned', roomId: this.id, state: this.engine.getState() })

    const state = this.engine.getState()
    if (state.phase === 'forecast') {
      this.sendArchitectPrompt()
    }
    return true
  }

  removeArchitect(ws: ServerWebSocket<WsData>): void {
    if (!this.architect || this.architect.ws !== ws) return
    this.architect = null
    ws.data.roomId = null
    ws.data.role = null
    if (this.architectTimer) {
      clearTimeout(this.architectTimer)
      this.architectTimer = null
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

    if (this.architectTimer) {
      clearTimeout(this.architectTimer)
      this.architectTimer = null
    }
    this.tickTimer = setTimeout(() => this.proceedToTicking(), FORECAST_DISPLAY_MS)
  }

  architectPlaceBonus(ws: ServerWebSocket<WsData>, x: number, y: number, bonusType: BonusType): void {
    if (!this.architect || this.architect.ws !== ws) return
    if (this.architectBonusPlaced) return
    const state = this.engine.getState()
    if (state.phase !== 'forecast') return

    if (this.engine.placeBonus(x, y, bonusType)) {
      this.architectBonusPlaced = true
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.ended = true
    this.clearTimer()
    if (this.cleanupTimer) { clearTimeout(this.cleanupTimer); this.cleanupTimer = null }
    if (this.architectTimer) { clearTimeout(this.architectTimer); this.architectTimer = null }
    this.redirectWatchers()
    this.players = {}
    this.watchers.clear()
    this.architect = null
    this.callbacks.onDispose(this.id)
  }

  /* ── Private: game flow ── */

  private startGame(): void {
    const state = this.engine.getState()
    send(this.players.A!.ws, { type: 'game:start', playerId: 'A', state: stateForPlayer(state, 'A') })
    send(this.players.B!.ws, { type: 'game:start', playerId: 'B', state: stateForPlayer(state, 'B') })

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
      this.architectTimer = setTimeout(() => {
        this.architectTimer = null
        this.proceedToTicking()
      }, ARCHITECT_DECISION_MS)
    } else {
      this.tickTimer = setTimeout(() => this.proceedToTicking(), FORECAST_DISPLAY_MS)
    }
  }

  private sendArchitectPrompt(): void {
    if (!this.architect) return
    const deadline = Date.now() + ARCHITECT_DECISION_MS
    send(this.architect.ws, { type: 'architect:prompt', deadline })
  }

  private proceedToTicking(): void {
    if (this.architectTimer) {
      clearTimeout(this.architectTimer)
      this.architectTimer = null
    }
    this.engine.beginTicking()
    this.beginTick()
  }

  private beginTick(): void {
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

    this.tickTimer = setTimeout(() => {
      this.resolveTick()
    }, TICK_DURATION_MS)
  }

  private resolveTick(): void {
    this.clearTimer()

    const actions: Partial<Record<PlayerId, Action>> = {}
    if (this.players.A?.action) actions.A = this.players.A.action
    if (this.players.B?.action) actions.B = this.players.B.action

    const result = this.engine.submitTick(actions)
    this.sendEach((pid) => ({ type: 'tick:resolve', state: stateForPlayer(result.state, pid) }))
    this.broadcastSpectators({ type: 'tick:resolve', state: result.state })

    this.resolveMovePredictions(actions)

    if (result.state.phase === 'weather') {
      this.tickTimer = setTimeout(() => this.executeWeather(), 500)
    } else {
      this.beginTick()
    }
  }

  private executeWeather(): void {
    const result = this.engine.executeWeather()
    this.sendEach((pid) => ({ type: 'weather:result', result: resultForPlayer(result, pid) }))
    this.broadcastSpectators({ type: 'weather:result', result })

    this.resolveWinnerPredictions()

    if (result.state.winner !== null) {
      const endMsg: ServerMessage = { type: 'game:end', winner: result.state.winner }
      this.broadcast(endMsg)
      this.broadcastSpectators(endMsg)
      this.scheduleCleanup()
    } else {
      this.tickTimer = setTimeout(() => this.beginRound(), WEATHER_DISPLAY_MS)
    }
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

  private scheduleCleanup(): void {
    this.clearTimer()
    if (this.cleanupTimer) { clearTimeout(this.cleanupTimer); this.cleanupTimer = null }
    this.cleanupTimer = setTimeout(() => this.dispose(), CLEANUP_DELAY_MS)
  }

  /* ── Helpers ── */

  private broadcast(msg: ServerMessage): void {
    for (const pid of ['A', 'B'] as PlayerId[]) {
      const slot = this.players[pid]
      if (slot) send(slot.ws, msg)
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
      if (slot) send(slot.ws, msgFn(pid))
    }
  }

  private clearTimer(): void {
    if (this.tickTimer !== null) {
      clearTimeout(this.tickTimer)
      this.tickTimer = null
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
