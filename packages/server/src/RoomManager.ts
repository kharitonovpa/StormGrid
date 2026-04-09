import type { PlayerId } from '@stormgrid/shared'
import { Room } from './Room.js'

let nextId = 1

export class RoomManager {
  private rooms = new Map<string, Room>()
  private tokenMap = new Map<string, { roomId: string; playerId: PlayerId }>()

  private gracePeriodMs?: number

  constructor(opts?: { gracePeriodMs?: number }) {
    this.gracePeriodMs = opts?.gracePeriodMs
  }

  createRoom(): Room {
    const id = `room-${nextId++}`
    const room = new Room(id, {
      onDispose: (rid) => this.removeRoom(rid),
      findNextRoom: (excludeId) => this.getActiveRoomId(excludeId),
      registerToken: (token, pid) => this.registerToken(token, id, pid),
      unregisterToken: (token) => this.unregisterToken(token),
      gracePeriodMs: this.gracePeriodMs,
    })
    this.rooms.set(id, room)
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
      if (id !== excludeId && room.isActive) return id
    }
    return null
  }

  get roomCount(): number {
    return this.rooms.size
  }
}
