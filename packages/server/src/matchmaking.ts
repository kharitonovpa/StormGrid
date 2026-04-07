import type { ServerWebSocket } from 'bun'
import type { WsData } from './protocol.js'
import { send } from './protocol.js'
import { RoomManager } from './RoomManager.js'

export class Matchmaking {
  private queue: ServerWebSocket<WsData>[] = []
  private queueSet = new Set<ServerWebSocket<WsData>>()
  private roomManager: RoomManager

  constructor(roomManager: RoomManager) {
    this.roomManager = roomManager
  }

  enqueue(ws: ServerWebSocket<WsData>): void {
    if (this.queueSet.has(ws)) return

    this.queue.push(ws)
    this.queueSet.add(ws)
    send(ws, { type: 'queue:waiting' })

    this.tryMatch()
  }

  dequeue(ws: ServerWebSocket<WsData>): void {
    if (!this.queueSet.delete(ws)) return
    const idx = this.queue.indexOf(ws)
    if (idx !== -1) this.queue.splice(idx, 1)
  }

  get queueSize(): number {
    return this.queue.length
  }

  private tryMatch(): void {
    while (this.queue.length >= 2) {
      const wsA = this.queue.shift()!
      const wsB = this.queue.shift()!
      this.queueSet.delete(wsA)
      this.queueSet.delete(wsB)

      const room = this.roomManager.createRoom()
      room.join(wsA)
      room.join(wsB)
    }
  }
}
