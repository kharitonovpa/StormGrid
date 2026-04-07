import { Room } from './Room.js'

let nextId = 1

export class RoomManager {
  private rooms = new Map<string, Room>()

  createRoom(): Room {
    const id = `room-${nextId++}`
    const room = new Room(id, {
      onDispose: (rid) => this.removeRoom(rid),
      findNextRoom: (excludeId) => this.getActiveRoomId(excludeId),
    })
    this.rooms.set(id, room)
    return room
  }

  getRoom(id: string): Room | undefined {
    return this.rooms.get(id)
  }

  removeRoom(id: string): void {
    this.rooms.delete(id)
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
