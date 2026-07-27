import type { PlayerId } from '@wheee/shared'
import { Room } from './Room.js'
import type { MatchEndData, RoomOpts } from './Room.js'
import type { ReplayStore } from './ReplayStore.js'
import type { ReplayData } from '@wheee/shared'

let nextId = 1

export type RoomManagerOpts = {
  gracePeriodMs?: number
  replayStore?: ReplayStore
  onMatchEnd?: (data: MatchEndData, replay: ReplayData) => void
  /** Rooms opened or closed — the lobby shows whether anything is watchable. */
  onRoomsChanged?: () => void
}

export class RoomManager {
  private rooms = new Map<string, Room>()
  private tokenMap = new Map<string, { roomId: string; playerId: PlayerId }>()

  private gracePeriodMs?: number
  replayStore?: ReplayStore
  private onMatchEnd?: (data: MatchEndData, replay: ReplayData) => void
  private onRoomsChanged?: () => void

  constructor(opts?: RoomManagerOpts) {
    this.gracePeriodMs = opts?.gracePeriodMs
    this.replayStore = opts?.replayStore
    this.onMatchEnd = opts?.onMatchEnd
    this.onRoomsChanged = opts?.onRoomsChanged
  }

  createRoom(opts?: RoomOpts): Room {
    const id = `room-${nextId++}`
    const room = new Room(id, {
      onDispose: (rid) => this.removeRoom(rid),
      findNextRoom: (excludeId) => this.getActiveRoomId(excludeId),
      registerToken: (token, pid) => this.registerToken(token, id, pid),
      unregisterToken: (token) => this.unregisterToken(token),
      gracePeriodMs: this.gracePeriodMs,
      replayStore: this.replayStore,
      onMatchEnd: this.onMatchEnd,
    }, opts)
    this.rooms.set(id, room)
    this.onRoomsChanged?.()
    return room
  }

  getRoom(id: string): Room | undefined {
    return this.rooms.get(id)
  }

  removeRoom(id: string): void {
    for (const [token, entry] of this.tokenMap) {
      if (entry.roomId === id) this.tokenMap.delete(token)
    }
    this.rooms.delete(id)
    this.onRoomsChanged?.()
  }

  registerToken(token: string, roomId: string, playerId: PlayerId): void {
    this.tokenMap.set(token, { roomId, playerId })
  }

  unregisterToken(token: string): void {
    this.tokenMap.delete(token)
  }

  findByToken(token: string): { room: Room; playerId: PlayerId } | null {
    const entry = this.tokenMap.get(token)
    if (!entry) return null
    const room = this.rooms.get(entry.roomId)
    if (!room) {
      this.tokenMap.delete(token)
      return null
    }
    return { room, playerId: entry.playerId }
  }

  getActiveRoomId(excludeId?: string): string | null {
    for (const [id, room] of this.rooms) {
      if (room.practice) continue // tutorials are private — no watchers/architects
      if (id !== excludeId && room.isActive) return id
    }
    return null
  }

  get roomCount(): number {
    return this.rooms.size
  }

  /** Rooms a watcher or architect could join right now. */
  get liveMatchCount(): number {
    let n = 0
    for (const room of this.rooms.values()) {
      if (!room.practice && room.isActive) n++
    }
    return n
  }
}
