import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { CHARACTERS } from '@wheee/shared'
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
import { insertEvents, getDailySummary, getEventCounts, getPlatformSummary } from './db/eventStore.js'
import type { EventRow } from './db/eventStore.js'

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
  onRoomsChanged() { broadcastLobbyStatus() },
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
        vsBot: data.vsBot,
      }, replay)
    } catch (e) { console.error('[db] saveMatch failed:', e) }

    try {
      updatePlayerStats(data.playerAUserId, data.playerBUserId, data.winner)
    } catch (e) { console.error('[db] updatePlayerStats failed:', e) }

    try {
      updateWatcherStats(data.watcherScores)
    } catch (e) { console.error('[db] updateWatcherStats failed:', e) }

    // The room lingers on the result screen, but there is nothing left to watch.
    broadcastLobbyStatus()
  },
})
const allClients = new Set<ServerWebSocket<WsData>>()

const matchmaking = new Matchmaking(roomManager, {
  // Idle = connected and in the lobby (no room). Watchers, architects and
  // playing players all carry a roomId and don't count as potential opponents.
  countIdleHumans(exclude) {
    let n = 0
    for (const ws of allClients) {
      if (ws !== exclude && ws.readyState === 1 && ws.data.roomId === null) n++
    }
    return n
  },
})

let lobbyStatusTimer: ReturnType<typeof setTimeout> | null = null

function broadcastLobbyStatus() {
  if (lobbyStatusTimer) return
  lobbyStatusTimer = setTimeout(() => {
    lobbyStatusTimer = null
    const msg = JSON.stringify({
      type: 'lobby:status',
      online: allClients.size,
      inQueue: matchmaking.queueSize,
      liveMatches: roomManager.liveMatchCount,
    })
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

const YANDEX_ORIGIN_RE = /^https:\/\/([a-z0-9-]+\.)*yandex\.(ru|com|net)$/
const GAMEPUSH_ORIGIN_RE = /^https:\/\/([a-z0-9-]+\.)*(gamepush\.com|pikabu\.ru|eponesh\.com)$/

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

/* ── First-party analytics ── */

const EVENT_NAME_RE = /^[a-z0-9_:]{1,40}$/
const ID_RE = /^[a-zA-Z0-9_-]{8,64}$/
const MAX_BATCH = 25
const MAX_PROPS_LEN = 500

app.post('/api/events', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'Bad JSON' }, 400) }
  const b = body as { deviceId?: unknown; sessionId?: unknown; platform?: unknown; host?: unknown; lang?: unknown; events?: unknown }

  if (typeof b.deviceId !== 'string' || !ID_RE.test(b.deviceId)) return c.json({ error: 'Bad deviceId' }, 400)
  if (typeof b.sessionId !== 'string' || !ID_RE.test(b.sessionId)) return c.json({ error: 'Bad sessionId' }, 400)
  if (typeof b.platform !== 'string' || b.platform.length > 20) return c.json({ error: 'Bad platform' }, 400)
  if (!Array.isArray(b.events) || b.events.length === 0 || b.events.length > MAX_BATCH) {
    return c.json({ error: 'Bad events' }, 400)
  }

  let userId: string | null = null
  const token = extractToken(c.req.header('cookie') ?? null, c.req.header('authorization'))
  if (token) {
    const payload = await verifyJwt(token)
    if (payload) userId = payload.sub
  }
  const country = detectCountry(c.req.raw.headers)
  const host = typeof b.host === 'string' && b.host.length <= 40 ? b.host : null
  const lang = typeof b.lang === 'string' && b.lang.length <= 10 ? b.lang : null

  const rows: EventRow[] = []
  for (const e of b.events as unknown[]) {
    const ev = e as { name?: unknown; props?: unknown }
    if (typeof ev.name !== 'string' || !EVENT_NAME_RE.test(ev.name)) continue
    let props: string | null = null
    if (ev.props && typeof ev.props === 'object') {
      const s = JSON.stringify(ev.props)
      if (s.length <= MAX_PROPS_LEN) props = s
    }
    rows.push({
      deviceId: b.deviceId, sessionId: b.sessionId, userId,
      platform: b.platform, host, name: ev.name, props, country, lang,
    })
  }

  try { insertEvents(rows) } catch (e) { console.error('[db] insertEvents failed:', e) }
  return c.json({ ok: true, accepted: rows.length })
})

/**
 * Aggregates for the developer, guarded by STATS_TOKEN. With the variable unset
 * the endpoint stays closed rather than open.
 */
app.get('/api/events/summary', (c) => {
  const expected = process.env.STATS_TOKEN
  if (!expected || c.req.query('token') !== expected) return c.json({ error: 'Forbidden' }, 403)
  const days = Math.min(Math.max(parseInt(c.req.query('days') ?? '14') || 14, 1), 90)
  return c.json({ daily: getDailySummary(days), counts: getEventCounts(days), platforms: getPlatformSummary(days) })
})

/* ── Telegram bot webhook ── */

/**
 * The bot's only conversational duty: answer /start with a Play button. Catalog
 * moderation (tapps.center) requires an English reply to /start; everything else
 * about the bot is the Mini App itself.
 */
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || ''
const TG_WEBHOOK_SECRET = process.env.TG_WEBHOOK_SECRET || ''
const TG_APP_LINK = 'https://t.me/wheee_game_bot/play'

const TG_START_REPLY = {
  en: '🌪 wheee — a 1v1 storm duel.\n\nShape the terrain, read the forecast, and let the wind blow your rival off the map. A match takes 1–3 minutes.',
  ru: '🌪 wheee — штормовая дуэль 1 на 1.\n\nМеняй рельеф, читай прогноз — и пусть ветер сдует соперника с карты. Матч занимает 1–3 минуты.',
}

app.post('/api/tg/webhook', async (c) => {
  // Without both secrets the route does not exist, rather than existing open.
  if (!TG_BOT_TOKEN || !TG_WEBHOOK_SECRET) return c.json({ error: 'Not found' }, 404)
  if (c.req.header('x-telegram-bot-api-secret-token') !== TG_WEBHOOK_SECRET) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  let update: { message?: { text?: string; chat?: { id?: number }; from?: { language_code?: string } } }
  try { update = await c.req.json() } catch { return c.json({ ok: true }) }

  const msg = update.message
  if (typeof msg?.text === 'string' && msg.text.startsWith('/start') && msg.chat?.id) {
    const ru = msg.from?.language_code === 'ru'
    // Telegram only needs a 200 — the reply itself can go out after we answer.
    fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: msg.chat.id,
        text: ru ? TG_START_REPLY.ru : TG_START_REPLY.en,
        reply_markup: { inline_keyboard: [[{ text: ru ? '▶️ Играть' : '▶️ Play', url: TG_APP_LINK }]] },
      }),
    }).catch((e) => console.error('[tg] sendMessage failed:', e))
  }

  return c.json({ ok: true })
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
    /**
     * A quiet lobby socket sends nothing for minutes at a time, so the keepalive
     * below has to fit comfortably inside this window.
     */
    idleTimeout: 120,

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
        // Keepalive. Rate-limited like everything else: at one every 25 s against
        // a 15/sec refill it never competes with real traffic, and treating it as
        // special would hand anyone an unmetered way to make the server work.
        case 'ping': {
          send(ws, { type: 'pong' })
          break
        }

        case 'queue:join': {
          if (ws.data.roomId) {
            send(ws, { type: 'error', message: 'Already in a game' })
            return
          }
          matchmaking.enqueue(ws, msg.character, msg.streak)
          broadcastLobbyStatus()
          break
        }

        case 'queue:leave': {
          matchmaking.dequeue(ws)
          broadcastLobbyStatus()
          break
        }

        /* ── Friend match by link ── */

        case 'friend:create': {
          if (ws.data.roomId) {
            send(ws, { type: 'error', message: 'Already in a game' })
            return
          }
          matchmaking.createInvite(ws, msg.character, msg.streak)
          break
        }

        case 'friend:cancel': {
          matchmaking.cancelInvite(ws)
          break
        }

        case 'friend:join': {
          if (ws.data.roomId) {
            send(ws, { type: 'error', message: 'Already in a game' })
            return
          }
          if (matchmaking.joinInvite(ws, msg.code, msg.character, msg.streak)) {
            broadcastLobbyStatus()
          }
          break
        }

        case 'practice:start': {
          if (ws.data.roomId) {
            send(ws, { type: 'error', message: 'Already in a game' })
            return
          }
          matchmaking.dequeue(ws)
          const botCharacter = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)]
          const room = roomManager.createRoom({ practice: true })
          room.join(ws, msg.character, msg.streak)
          room.joinBot(botCharacter)
          break
        }

        // What a rewarded ad buys: the same bot match the queue would hand over
        // after BOT_MATCH_DELAY_MS, only without the wait. A real match in every
        // other respect — it records, and it can grow a badge.
        case 'instant:start': {
          if (ws.data.roomId) {
            send(ws, { type: 'error', message: 'Already in a game' })
            return
          }
          matchmaking.dequeue(ws)
          const botCharacter = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)]
          const room = roomManager.createRoom()
          room.join(ws, msg.character, msg.streak)
          room.joinBot(botCharacter)
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

    close(ws, code, reason) {
      // The code is the only clue to why a player dropped, so it goes in the log.
      console.log(`[ws] disconnect ${ws.data.sessionId} code=${code}${reason ? ` reason=${reason}` : ''}`)
      allClients.delete(ws)
      matchmaking.dequeue(ws)
      matchmaking.cancelInvite(ws)
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
