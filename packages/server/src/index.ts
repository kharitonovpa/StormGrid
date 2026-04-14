import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { RoomManager } from './RoomManager.js'
import { Matchmaking } from './matchmaking.js'
import { ReplayStore } from './ReplayStore.js'
import { parseClientMessage, send } from './protocol.js'
import type { WsData } from './protocol.js'
import { ConnectionLimiter } from './ratelimit.js'
import { runMigrations } from './db/migrate.js'
import { authRoutes } from './auth/oauth.js'
import { verifyJwt, parseCookieToken, extractToken } from './auth/jwt.js'
import { saveMatch, listReplays, getReplay, getUserMatches, updatePlayerStats, updateWatcherStats, getPlayerLeaderboard, getWatcherLeaderboard } from './db/matchStore.js'

runMigrations()

/* ── HTTP rate limiter (token bucket per IP) ── */

function createHttpLimiter(opts: { windowMs: number; max: number }) {
  const buckets = new Map<string, { tokens: number; last: number }>()
  const refillRate = opts.max / opts.windowMs

  // Evict stale entries every 60s
  setInterval(() => {
    const cutoff = Date.now() - opts.windowMs * 2
    for (const [ip, b] of buckets) {
      if (b.last < cutoff) buckets.delete(ip)
    }
  }, 60_000).unref()

  return (ip: string): boolean => {
    const now = Date.now()
    let bucket = buckets.get(ip)
    if (!bucket) {
      bucket = { tokens: opts.max, last: now }
      buckets.set(ip, bucket)
    }
    bucket.tokens = Math.min(opts.max, bucket.tokens + (now - bucket.last) * refillRate)
    bucket.last = now
    if (bucket.tokens < 1) return false
    bucket.tokens--
    return true
  }
}

const apiLimiter = createHttpLimiter({ windowMs: 60_000, max: 60 })

const app = new Hono()
const _rawGrace = process.env.RECONNECT_GRACE_MS ? Number(process.env.RECONNECT_GRACE_MS) : undefined
const gracePeriodMs = _rawGrace !== undefined && Number.isFinite(_rawGrace) && _rawGrace > 0 ? _rawGrace : undefined
const replayStore = new ReplayStore()
const roomManager = new RoomManager({
  gracePeriodMs,
  replayStore,
  onMatchEnd(data, replay) {
    try {
      saveMatch({
        roomId: data.roomId,
        playerAId: data.playerAUserId,
        playerBId: data.playerBUserId,
        characterA: data.characterA,
        characterB: data.characterB,
        winner: data.winner,
        rounds: data.rounds,
        durationMs: data.durationMs,
      }, replay)
    } catch (e) { console.error('[db] saveMatch failed:', e) }

    try {
      updatePlayerStats(data.playerAUserId, data.playerBUserId, data.winner)
    } catch (e) { console.error('[db] updatePlayerStats failed:', e) }

    try {
      updateWatcherStats(data.watcherScores)
    } catch (e) { console.error('[db] updateWatcherStats failed:', e) }
  },
})
const matchmaking = new Matchmaking(roomManager)

const allClients = new Set<ServerWebSocket<WsData>>()

let lobbyStatusTimer: ReturnType<typeof setTimeout> | null = null

function broadcastLobbyStatus() {
  if (lobbyStatusTimer) return
  lobbyStatusTimer = setTimeout(() => {
    lobbyStatusTimer = null
    const msg = JSON.stringify({ type: 'lobby:status', online: allClients.size, inQueue: matchmaking.queueSize })
    for (const ws of allClients) {
      try { ws.send(msg) } catch { /* closed */ }
    }
  }, 500)
}

const ALLOWED_ORIGINS = new Set(
  process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : ['http://localhost:5173'],
)

const YANDEX_ORIGIN_RE = /^https:\/\/([a-z0-9-]+\.)?yandex\.(ru|com|net)$/
const GAMEPUSH_ORIGIN_RE = /^https:\/\/([a-z0-9-]+\.)?(gamepush\.com|pikabu\.ru|eponesh\.com)$/

app.use('/api/*', cors({
  origin: (origin) => {
    if (ALLOWED_ORIGINS.has(origin)) return origin
    if (YANDEX_ORIGIN_RE.test(origin)) return origin
    if (GAMEPUSH_ORIGIN_RE.test(origin)) return origin
    return null as unknown as string
  },
  credentials: true,
}))

app.use('/api/*', async (c, next) => {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || c.req.header('x-real-ip')
    || 'unknown'
  if (!apiLimiter(ip)) {
    return c.json({ error: 'Too many requests' }, 429)
  }
  await next()
})

app.route('/api/auth', authRoutes)

app.get('/api/replays', (c) => {
  const memList = replayStore.list()
  const dbList = listReplays()
  const seen = new Set(memList.map((r) => r.id))
  const merged = [...memList, ...dbList.filter((r) => !seen.has(r.id))]
  return c.json(merged.slice(0, 20))
})

app.get('/api/replay/:id', (c) => {
  const id = c.req.param('id')
  const data = replayStore.get(id) ?? getReplay(id)
  if (!data) return c.json({ error: 'Not found' }, 404)
  return c.json(data)
})

app.get('/api/me/matches', async (c) => {
  const token = extractToken(c.req.header('cookie') ?? null, c.req.header('authorization'))
  if (!token) return c.json({ error: 'Unauthorized' }, 401)
  const payload = await verifyJwt(token)
  if (!payload) return c.json({ error: 'Unauthorized' }, 401)
  return c.json(getUserMatches(payload.sub))
})

app.get('/api/leaderboard/players', (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '20') || 20, 1), 50)
  const offset = Math.max(parseInt(c.req.query('offset') ?? '0') || 0, 0)
  return c.json(getPlayerLeaderboard(limit, offset))
})
app.get('/api/leaderboard/watchers', (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '20') || 20, 1), 50)
  const offset = Math.max(parseInt(c.req.query('offset') ?? '0') || 0, 0)
  return c.json(getWatcherLeaderboard(limit, offset))
})

app.get('/health', (c) => c.json({ ok: true }))

app.get('/', (c) =>
  c.json({
    name: 'wheee',
    rooms: roomManager.roomCount,
    queue: matchmaking.queueSize,
  }),
)

const PORT = Number(process.env.PORT) || 3001

const server = Bun.serve<WsData>({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url)

    if (url.pathname === '/ws') {
      const sessionId = crypto.randomUUID()
      let userId: string | null = null
      let userName: string | null = null
      const token = parseCookieToken(req.headers.get('cookie'))
        || url.searchParams.get('token')
      if (token) {
        const payload = await verifyJwt(token)
        if (payload) {
          userId = payload.sub
          userName = payload.name
        }
      }
      const countryCode = detectCountry(req.headers)
      const ok = server.upgrade(req, {
        data: { sessionId, userId, userName, countryCode, roomId: null, playerId: null, role: null, limiter: new ConnectionLimiter() },
      })
      if (ok) return undefined
      return new Response('WebSocket upgrade failed', { status: 400 })
    }

    return app.fetch(req)
  },

  websocket: {
    open(ws) {
      console.log(`[ws] connect ${ws.data.sessionId}`)
      allClients.add(ws)
      broadcastLobbyStatus()
    },

    message(ws, raw) {
      const str = String(raw)
      const { limiter } = ws.data

      if (!limiter.checkSize(str)) {
        send(ws, { type: 'error', message: 'Message too large' })
        return
      }

      if (!limiter.consume()) {
        send(ws, { type: 'error', message: 'Rate limited' })
        return
      }

      const msg = parseClientMessage(str)
      if (!msg) {
        if (limiter.trackInvalid()) {
          ws.close(4400, 'Too many invalid messages')
          return
        }
        send(ws, { type: 'error', message: 'Invalid message' })
        return
      }
      limiter.resetInvalid()

      switch (msg.type) {
        case 'queue:join': {
          if (ws.data.roomId) {
            send(ws, { type: 'error', message: 'Already in a game' })
            return
          }
          matchmaking.enqueue(ws, msg.character)
          broadcastLobbyStatus()
          break
        }

        case 'queue:leave': {
          matchmaking.dequeue(ws)
          broadcastLobbyStatus()
          break
        }

        case 'action:submit': {
          const { roomId, playerId } = ws.data
          if (!roomId || !playerId) {
            send(ws, { type: 'error', message: 'Not in a game' })
            return
          }
          const room = roomManager.getRoom(roomId)
          if (!room) {
            send(ws, { type: 'error', message: 'Room not found' })
            return
          }
          room.submitAction(playerId, msg.action)
          break
        }

        /* ── Watcher messages ── */

        case 'watch:join': {
          if (ws.data.roomId) {
            send(ws, { type: 'error', message: 'Already in a room' })
            return
          }
          const activeId = roomManager.getActiveRoomId()
          if (!activeId) {
            send(ws, { type: 'watch:no_match' })
            return
          }
          const activeRoom = roomManager.getRoom(activeId)
          if (!activeRoom) {
            send(ws, { type: 'watch:no_match' })
            return
          }
          activeRoom.addWatcher(ws)
          break
        }

        case 'watch:leave': {
          const { roomId } = ws.data
          if (!roomId || ws.data.role !== 'watcher') break
          const room = roomManager.getRoom(roomId)
          if (room) room.removeWatcher(ws)
          break
        }

        case 'watcher:predict_winner': {
          const room = getWatcherRoom(ws)
          if (room) room.watcherPredictWinner(ws, msg.playerId)
          break
        }

        case 'watcher:predict_move': {
          const room = getWatcherRoom(ws)
          if (room) room.watcherPredictMove(ws, msg.target, msg.action)
          break
        }

        case 'watcher:break_instrument': {
          const room = getWatcherRoom(ws)
          if (room) room.watcherBreakInstrument(ws, msg.instrument)
          break
        }

        /* ── Architect messages ── */

        case 'architect:join': {
          if (ws.data.roomId) {
            send(ws, { type: 'error', message: 'Already in a room' })
            return
          }
          const activeId = roomManager.getActiveRoomId()
          if (!activeId) {
            send(ws, { type: 'architect:no_match' })
            return
          }
          const activeRoom = roomManager.getRoom(activeId)
          if (!activeRoom) {
            send(ws, { type: 'architect:no_match' })
            return
          }
          const ok = activeRoom.addArchitect(ws)
          if (!ok) {
            send(ws, { type: 'architect:no_match' })
          }
          break
        }

        case 'architect:leave': {
          const { roomId } = ws.data
          if (!roomId || ws.data.role !== 'architect') break
          const room = roomManager.getRoom(roomId)
          if (room) room.removeArchitect(ws)
          break
        }

        case 'architect:set_weather': {
          const room = getArchitectRoom(ws)
          if (room) room.architectSetWeather(ws, msg.weatherType, msg.dir)
          break
        }

        case 'architect:place_bonus': {
          const room = getArchitectRoom(ws)
          if (room) room.architectPlaceBonus(ws, msg.x, msg.y, msg.bonusType)
          break
        }

        /* ── Reconnect ── */

        case 'reconnect': {
          const result = roomManager.findByToken(msg.token)
          if (!result) {
            send(ws, { type: 'reconnect:fail' })
            return
          }
          const ok = result.room.reconnectPlayer(result.playerId, ws)
          if (!ok) {
            send(ws, { type: 'reconnect:fail' })
          }
          break
        }
      }
    },

    close(ws) {
      console.log(`[ws] disconnect ${ws.data.sessionId}`)
      allClients.delete(ws)
      matchmaking.dequeue(ws)
      broadcastLobbyStatus()

      const { roomId, role } = ws.data
      if (roomId) {
        const room = roomManager.getRoom(roomId)
        if (room) {
          if (role === 'watcher') {
            room.removeWatcher(ws)
          } else if (role === 'architect') {
            room.removeArchitect(ws)
          } else if (ws.data.playerId) {
            room.removePlayer(ws.data.playerId)
          }
        }
      }
    },
  },
})

function getRoomForRole(ws: ServerWebSocket<WsData>, expectedRole: string, errorMsg: string) {
  const { roomId, role } = ws.data
  if (!roomId || role !== expectedRole) {
    send(ws, { type: 'error', message: errorMsg })
    return null
  }
  const room = roomManager.getRoom(roomId)
  if (!room) {
    send(ws, { type: 'error', message: 'Room not found' })
    return null
  }
  return room
}

function getWatcherRoom(ws: ServerWebSocket<WsData>) {
  return getRoomForRole(ws, 'watcher', 'Not watching a game')
}

function getArchitectRoom(ws: ServerWebSocket<WsData>) {
  return getRoomForRole(ws, 'architect', 'Not an architect')
}

type ServerWebSocket<T> = import('bun').ServerWebSocket<T>

const LANG_TO_COUNTRY: Record<string, string> = {
  ru: 'RU', uk: 'UA', be: 'BY', kk: 'KZ', de: 'DE', fr: 'FR', ja: 'JP',
  ko: 'KR', zh: 'CN', pt: 'BR', es: 'ES', it: 'IT', pl: 'PL', nl: 'NL',
  sv: 'SE', da: 'DK', fi: 'FI', nb: 'NO', no: 'NO', cs: 'CZ', tr: 'TR',
  he: 'IL', th: 'TH', vi: 'VN', id: 'ID', hi: 'IN', el: 'GR', ro: 'RO',
  hu: 'HU', sk: 'SK', bg: 'BG', hr: 'HR', sr: 'RS', lt: 'LT', lv: 'LV',
  et: 'EE', ka: 'GE', hy: 'AM', az: 'AZ', ms: 'MY', tl: 'PH', bn: 'BD',
}

function detectCountry(headers: Headers): string | null {
  const cfCountry = headers.get('cf-ipcountry')
  if (cfCountry && cfCountry !== 'XX' && cfCountry.length === 2) return cfCountry.toUpperCase()

  const xCountry = headers.get('x-country-code')
  if (xCountry && xCountry.length === 2) return xCountry.toUpperCase()

  const al = headers.get('accept-language')
  if (!al) return null

  const first = al.split(',')[0].trim().split(';')[0]
  const parts = first.split('-')
  if (parts.length >= 2 && parts[1].length === 2) return parts[1].toUpperCase()
  const lang = parts[0].toLowerCase()
  return LANG_TO_COUNTRY[lang] ?? null
}

console.log(`wheee server listening on http://localhost:${server.port}`)
