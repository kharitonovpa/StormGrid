import type { ServerWebSocket } from 'bun'
import type { CharacterType } from '@wheee/shared'
import { CHARACTERS } from '@wheee/shared'
import type { WsData } from './protocol.js'
import { send } from './protocol.js'
import { RoomManager } from './RoomManager.js'
import { botStrengthForStreak } from './engine/bot.js'

const _rawBotDelay = process.env.BOT_MATCH_DELAY_MS ? Number(process.env.BOT_MATCH_DELAY_MS) : undefined
const BOT_MATCH_DELAY_MS = _rawBotDelay !== undefined && Number.isFinite(_rawBotDelay) && _rawBotDelay > 0
  ? _rawBotDelay
  : 8_000

/** The patient window: applies while another idle human is online who might still press Play. */
const _rawBotDelayLong = process.env.BOT_MATCH_DELAY_LONG_MS ? Number(process.env.BOT_MATCH_DELAY_LONG_MS) : undefined
const BOT_MATCH_DELAY_LONG_MS = _rawBotDelayLong !== undefined && Number.isFinite(_rawBotDelayLong) && _rawBotDelayLong > 0
  ? _rawBotDelayLong
  : 30_000

/**
 * A finished PvP pairing, kept alive briefly so the two players can go again.
 * Human opponents are the scarce resource here — the queue hands out a bot
 * after 8 seconds, so "Play again" after a PvP match usually lands the player
 * back against a bot. Keyed by the finished room's id but joinable only by the
 * two sockets named in the entry: room ids reach watchers and replay links, so
 * anything joinable by id alone would be hijackable.
 */
type RematchEntry = {
  a: ServerWebSocket<WsData>
  b: ServerWebSocket<WsData>
  /** Whoever has asked so far, and what they asked with. */
  wants: Map<ServerWebSocket<WsData>, { character: CharacterType; streak: number }>
  /** Inherited from the finished room, not re-read from caps — same two players. */
  lightningEnabled: boolean
  createdAt: number
}

/** Long enough to read the game-over screen, short enough that nobody is
 *  yanked into a match they have forgotten asking for. */
const REMATCH_TTL_MS = 30_000

export type MatchmakingOpts = {
  /** Connected humans sitting in the lobby, excluding the given socket. */
  countIdleHumans?: (exclude: ServerWebSocket<WsData>) => number
  /** Fires when an enqueue leaves someone waiting alone — their bot countdown just started. */
  onLoneWaiter?: (info: { name: string; waitMs: number }) => void
  /** Shorten the rematch window; tests use a few milliseconds. */
  rematchTtlMs?: number
}

type QueueEntry = { ws: ServerWebSocket<WsData>; character: CharacterType; streak: number; caps: string[] }

/** A parked friend invite: the creator waits for one specific person, no bot fallback. */
type InviteEntry = QueueEntry & { createdAt: number }

/**
 * Backward-compat capability handshake (owner ruling): a room enables
 * lightning only if every human in it declared support. Absence of `caps`
 * means an old client — never assume support that wasn't declared.
 */
const LIGHTNING_CAP = 'lightning'
export function capsHaveLightning(caps: string[]): boolean {
  return caps.includes(LIGHTNING_CAP)
}

const INVITE_TTL_MS = 10 * 60_000
/** No 0/O/1/I — the code may end up read aloud or retyped from a screenshot. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6
/** Client-supplied codes (discord instances) — anything else gets a server code. */
const CLIENT_CODE_RE = /^DC-[A-Z0-9-]{6,64}$/

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
  private rematches = new Map<string, RematchEntry>()
  private rematchBySocket = new Map<ServerWebSocket<WsData>, string>()
  private roomManager: RoomManager
  private botTimer: ReturnType<typeof setTimeout> | null = null

  constructor(roomManager: RoomManager, opts?: MatchmakingOpts) {
    this.roomManager = roomManager
    this.opts = opts
  }

  private opts?: MatchmakingOpts

  /**
   * Alone on the server there is nobody to wait for — take the short window
   * and hand over a bot. With another idle human online, hold the long one:
   * a real opponent might still press Play.
   */
  private pickBotDelayMs(ws: ServerWebSocket<WsData>): number {
    const idle = this.opts?.countIdleHumans?.(ws) ?? 0
    return idle > 0 ? BOT_MATCH_DELAY_LONG_MS : BOT_MATCH_DELAY_MS
  }

  enqueue(ws: ServerWebSocket<WsData>, character: CharacterType, streak = 0, caps: string[] = []): void {
    if (this.queueSet.has(ws)) return
    // The public queue supersedes a parked invite — nobody waits in two lines.
    this.cancelInvite(ws)

    const waitMs = this.pickBotDelayMs(ws)
    this.queue.push({ ws, character, streak, caps })
    this.queueSet.add(ws)
    send(ws, { type: 'queue:waiting', maxWaitMs: waitMs })

    this.tryMatch(waitMs)

    if (this.queue.length === 1) {
      this.opts?.onLoneWaiter?.({ name: ws.data.userName ?? 'guest', waitMs })
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

  /* ── Rematch ── */

  private get rematchTtlMs(): number {
    return this.opts?.rematchTtlMs ?? REMATCH_TTL_MS
  }

  /** How many pairings are currently on the table — for tests and diagnostics. */
  get rematchCount(): number {
    return this.rematches.size
  }

  /**
   * Open the window on a finished match. Called only for a natural PvP ending
   * with both humans still connected: there is nobody to play again with after
   * a forfeit, and a bot rematch is what the instant button already does.
   */
  openRematch(
    roomId: string,
    a: ServerWebSocket<WsData>,
    b: ServerWebSocket<WsData>,
    lightningEnabled: boolean,
  ): void {
    if (a === b || a.readyState !== 1 || b.readyState !== 1) return
    this.sweepRematches()
    // A newer match supersedes whatever either of them was still offered.
    this.cancelRematch(a)
    this.cancelRematch(b)

    this.rematches.set(roomId, { a, b, wants: new Map(), lightningEnabled, createdAt: Date.now() })
    this.rematchBySocket.set(a, roomId)
    this.rematchBySocket.set(b, roomId)
    send(a, { type: 'rematch:available' })
    send(b, { type: 'rematch:available' })
  }

  /**
   * Symmetric: the first caller is making an offer, the second is accepting it.
   * A socket that did not play in the match has no entry and is ignored.
   */
  wantRematch(ws: ServerWebSocket<WsData>, character: CharacterType, streak = 0, caps: string[] = []): void {
    this.sweepRematches()
    const roomId = this.rematchBySocket.get(ws)
    if (!roomId) return
    const entry = this.rematches.get(roomId)
    if (!entry) return
    void caps // the pairing's lightning setting is already decided — see RematchEntry

    entry.wants.set(ws, { character, streak })
    const other = entry.a === ws ? entry.b : entry.a

    if (!entry.wants.has(other)) {
      send(ws, { type: 'rematch:waiting' })
      if (other.readyState === 1) send(other, { type: 'rematch:offered' })
      return
    }

    if (other.readyState !== 1) {
      this.closeRematch(roomId)
      send(ws, { type: 'rematch:off' })
      return
    }

    // Both in. Nobody waits in two lines at once.
    this.closeRematch(roomId)
    for (const sock of [entry.a, entry.b]) {
      this.dequeue(sock)
      this.cancelInvite(sock)
    }
    const room = this.roomManager.createRoom({ lightningEnabled: entry.lightningEnabled })
    const wantA = entry.wants.get(entry.a)!
    const wantB = entry.wants.get(entry.b)!
    room.join(entry.a, wantA.character, wantA.streak)
    room.join(entry.b, wantB.character, wantB.streak)
  }

  /** Declining, leaving, or disconnecting — the other side is told it is off. */
  cancelRematch(ws: ServerWebSocket<WsData>): void {
    const roomId = this.rematchBySocket.get(ws)
    if (!roomId) return
    const entry = this.rematches.get(roomId)
    this.closeRematch(roomId)
    if (!entry) return
    const other = entry.a === ws ? entry.b : entry.a
    if (other.readyState === 1) send(other, { type: 'rematch:off' })
  }

  private closeRematch(roomId: string): void {
    const entry = this.rematches.get(roomId)
    if (!entry) return
    this.rematches.delete(roomId)
    this.rematchBySocket.delete(entry.a)
    this.rematchBySocket.delete(entry.b)
  }

  private sweepRematches(): void {
    const cutoff = Date.now() - this.rematchTtlMs
    for (const [roomId, entry] of [...this.rematches]) {
      if (entry.createdAt >= cutoff) continue
      this.closeRematch(roomId)
      for (const sock of [entry.a, entry.b]) {
        if (sock.readyState === 1) send(sock, { type: 'rematch:off' })
      }
    }
  }

  /* ── Friend invites ── */

  createInvite(ws: ServerWebSocket<WsData>, character: CharacterType, streak = 0, caps: string[] = [], requestedCode?: string): string {
    const custom = requestedCode?.toUpperCase()
    if (custom && CLIENT_CODE_RE.test(custom)) {
      this.sweepInvites()
      const entry = this.invites.get(custom)
      if (entry && entry.ws.readyState === 1 && entry.ws !== ws) {
        // Create-or-join: the code is already parked, so this caller is the second
        // player — behave exactly like friend:join.
        this.joinInvite(ws, custom, character, streak, caps)
        return custom
      }
      this.cancelInvite(ws)
      this.dequeue(ws)
      this.invites.set(custom, { ws, character, streak, caps, createdAt: Date.now() })
      this.inviteBySocket.set(ws, custom)
      send(ws, { type: 'friend:waiting', code: custom })
      return custom
    }

    // One live invite per socket; re-creating replaces the old code.
    this.cancelInvite(ws)
    this.dequeue(ws)
    this.sweepInvites()

    let code = generateCode()
    while (this.invites.has(code)) code = generateCode()

    this.invites.set(code, { ws, character, streak, caps, createdAt: Date.now() })
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

  joinInvite(ws: ServerWebSocket<WsData>, code: string, character: CharacterType, streak = 0, caps: string[] = []): boolean {
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

    const lightningEnabled = capsHaveLightning(entry.caps) && capsHaveLightning(caps)
    const room = this.roomManager.createRoom({ lightningEnabled })
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

  private tryMatch(botDelayMs?: number): void {
    if (this.botTimer) {
      clearTimeout(this.botTimer)
      this.botTimer = null
    }

    while (this.queue.length >= 2) {
      const entryA = this.queue.shift()!
      const entryB = this.queue.shift()!
      this.queueSet.delete(entryA.ws)
      this.queueSet.delete(entryB.ws)

      const lightningEnabled = capsHaveLightning(entryA.caps) && capsHaveLightning(entryB.caps)
      const room = this.roomManager.createRoom({ lightningEnabled })
      room.join(entryA.ws, entryA.character, entryA.streak)
      room.join(entryB.ws, entryB.character, entryB.streak)
    }

    if (this.queue.length === 1 && !this.botTimer) {
      this.botTimer = setTimeout(() => {
        this.botTimer = null
        this.matchWithBot()
      }, botDelayMs ?? this.pickBotDelayMs(this.queue[0].ws))
    }
  }

  private matchWithBot(): void {
    if (this.queue.length < 1) return

    const entry = this.queue.shift()!
    this.queueSet.delete(entry.ws)

    const botCharacter = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)]
    // The bot has no client of its own to declare support — the lone human's
    // caps are the whole decision.
    const room = this.roomManager.createRoom({ lightningEnabled: capsHaveLightning(entry.caps) })
    room.join(entry.ws, entry.character, entry.streak)
    room.joinBot(botCharacter, botStrengthForStreak(entry.streak))
  }
}
