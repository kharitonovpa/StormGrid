import type { ServerWebSocket } from 'bun'
import type { CharacterType } from '@wheee/shared'
import { CHARACTERS } from '@wheee/shared'
import type { WsData } from './protocol.js'
import { send } from './protocol.js'
import { RoomManager } from './RoomManager.js'

const _rawBotDelay = process.env.BOT_MATCH_DELAY_MS ? Number(process.env.BOT_MATCH_DELAY_MS) : undefined
const BOT_MATCH_DELAY_MS = _rawBotDelay !== undefined && Number.isFinite(_rawBotDelay) && _rawBotDelay > 0
  ? _rawBotDelay
  : 8_000

type QueueEntry = { ws: ServerWebSocket<WsData>; character: CharacterType; streak: number }

/** A parked friend invite: the creator waits for one specific person, no bot fallback. */
type InviteEntry = QueueEntry & { createdAt: number }

const INVITE_TTL_MS = 10 * 60_000
/** No 0/O/1/I — the code may end up read aloud or retyped from a screenshot. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6

function generateCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(bytes)
  let code = ''
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length]
  return code
}

export class Matchmaking {
  private queue: QueueEntry[] = []
  private queueSet = new Set<ServerWebSocket<WsData>>()
  private invites = new Map<string, InviteEntry>()
  private inviteBySocket = new Map<ServerWebSocket<WsData>, string>()
  private roomManager: RoomManager
  private botTimer: ReturnType<typeof setTimeout> | null = null

  constructor(roomManager: RoomManager) {
    this.roomManager = roomManager
  }

  enqueue(ws: ServerWebSocket<WsData>, character: CharacterType, streak = 0): void {
    if (this.queueSet.has(ws)) return
    // The public queue supersedes a parked invite — nobody waits in two lines.
    this.cancelInvite(ws)

    this.queue.push({ ws, character, streak })
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

  /* ── Friend invites ── */

  createInvite(ws: ServerWebSocket<WsData>, character: CharacterType, streak = 0): string {
    // One live invite per socket; re-creating replaces the old code.
    this.cancelInvite(ws)
    this.dequeue(ws)
    this.sweepInvites()

    let code = generateCode()
    while (this.invites.has(code)) code = generateCode()

    this.invites.set(code, { ws, character, streak, createdAt: Date.now() })
    this.inviteBySocket.set(ws, code)
    send(ws, { type: 'friend:waiting', code })
    return code
  }

  cancelInvite(ws: ServerWebSocket<WsData>): void {
    const code = this.inviteBySocket.get(ws)
    if (!code) return
    this.inviteBySocket.delete(ws)
    this.invites.delete(code)
  }

  joinInvite(ws: ServerWebSocket<WsData>, code: string, character: CharacterType, streak = 0): boolean {
    this.sweepInvites()
    const entry = this.invites.get(code.toUpperCase())
    // A creator whose socket died is as gone as an expired code. (1 = OPEN)
    if (!entry || entry.ws.readyState !== 1 || entry.ws === ws) {
      send(ws, { type: 'friend:join_fail' })
      return false
    }
    this.invites.delete(code.toUpperCase())
    this.inviteBySocket.delete(entry.ws)
    this.dequeue(ws)

    const room = this.roomManager.createRoom()
    room.join(entry.ws, entry.character, entry.streak)
    room.join(ws, character, streak)
    return true
  }

  private sweepInvites(): void {
    const cutoff = Date.now() - INVITE_TTL_MS
    for (const [code, entry] of this.invites) {
      if (entry.createdAt < cutoff || entry.ws.readyState !== 1) {
        this.invites.delete(code)
        this.inviteBySocket.delete(entry.ws)
      }
    }
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
      room.join(entryA.ws, entryA.character, entryA.streak)
      room.join(entryB.ws, entryB.character, entryB.streak)
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
    room.join(entry.ws, entry.character, entry.streak)
    room.joinBot(botCharacter)
  }
}
