import type { ServerWebSocket } from 'bun'
import type { CharacterType } from '@wheee/shared'
import { CHARACTERS } from '@wheee/shared'
import type { WsData } from './protocol.js'
import { send } from './protocol.js'
import { RoomManager } from './RoomManager.js'

const _rawBotDelay = process.env.BOT_MATCH_DELAY_MS ? Number(process.env.BOT_MATCH_DELAY_MS) : undefined
const BOT_MATCH_DELAY_MS = _rawBotDelay !== undefined && Number.isFinite(_rawBotDelay) && _rawBotDelay > 0
  ? _rawBotDelay
  : 30_000

type QueueEntry = { ws: ServerWebSocket<WsData>; character: CharacterType }

export class Matchmaking {
  private queue: QueueEntry[] = []
  private queueSet = new Set<ServerWebSocket<WsData>>()
  private roomManager: RoomManager
  private botTimer: ReturnType<typeof setTimeout> | null = null

  constructor(roomManager: RoomManager) {
    this.roomManager = roomManager
  }

  enqueue(ws: ServerWebSocket<WsData>, character: CharacterType): void {
    if (this.queueSet.has(ws)) return

    this.queue.push({ ws, character })
    this.queueSet.add(ws)
    send(ws, { type: 'queue:waiting', maxWaitMs: BOT_MATCH_DELAY_MS })

    this.tryMatch()

    if (this.queue.length === 1 && !this.botTimer) {
      this.botTimer = setTimeout(() => {
        this.botTimer = null
        this.matchWithBot()
      }, BOT_MATCH_DELAY_MS)
    }
  }

  dequeue(ws: ServerWebSocket<WsData>): void {
    if (!this.queueSet.delete(ws)) return
    const idx = this.queue.findIndex(e => e.ws === ws)
    if (idx !== -1) this.queue.splice(idx, 1)

    if (this.queue.length === 0 && this.botTimer) {
      clearTimeout(this.botTimer)
      this.botTimer = null
    }
  }

  get queueSize(): number {
    return this.queue.length
  }

  private tryMatch(): void {
    if (this.botTimer) {
      clearTimeout(this.botTimer)
      this.botTimer = null
    }

    while (this.queue.length >= 2) {
      const entryA = this.queue.shift()!
      const entryB = this.queue.shift()!
      this.queueSet.delete(entryA.ws)
      this.queueSet.delete(entryB.ws)

      const room = this.roomManager.createRoom()
      room.join(entryA.ws, entryA.character)
      room.join(entryB.ws, entryB.character)
    }

    if (this.queue.length === 1 && !this.botTimer) {
      this.botTimer = setTimeout(() => {
        this.botTimer = null
        this.matchWithBot()
      }, BOT_MATCH_DELAY_MS)
    }
  }

  private matchWithBot(): void {
    if (this.queue.length < 1) return

    const entry = this.queue.shift()!
    this.queueSet.delete(entry.ws)

    const botCharacter = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)]
    const room = this.roomManager.createRoom()
    room.join(entry.ws, entry.character)
    room.joinBot(botCharacter)
  }
}
