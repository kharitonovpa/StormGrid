import type { ServerWebSocket } from 'bun'
import type { CharacterType } from '@stormgrid/shared'
import type { WsData } from './protocol.js'
import { send } from './protocol.js'
import { RoomManager } from './RoomManager.js'

type QueueEntry = { ws: ServerWebSocket<WsData>; character: CharacterType }

export class Matchmaking {
  private queue: QueueEntry[] = []
  private queueSet = new Set<ServerWebSocket<WsData>>()
  private roomManager: RoomManager

  constructor(roomManager: RoomManager) {
    this.roomManager = roomManager
  }

  enqueue(ws: ServerWebSocket<WsData>, character: CharacterType): void {
    if (this.queueSet.has(ws)) return

    this.queue.push({ ws, character })
    this.queueSet.add(ws)
    send(ws, { type: 'queue:waiting' })

    this.tryMatch()
  }

  dequeue(ws: ServerWebSocket<WsData>): void {
    if (!this.queueSet.delete(ws)) return
    const idx = this.queue.findIndex(e => e.ws === ws)
    if (idx !== -1) this.queue.splice(idx, 1)
  }

  get queueSize(): number {
    return this.queue.length
  }

  private tryMatch(): void {
    while (this.queue.length >= 2) {
      const entryA = this.queue.shift()!
      const entryB = this.queue.shift()!
      this.queueSet.delete(entryA.ws)
      this.queueSet.delete(entryB.ws)

      const room = this.roomManager.createRoom()
      room.join(entryA.ws, entryA.character)
      room.join(entryB.ws, entryB.character)
    }
  }
}
