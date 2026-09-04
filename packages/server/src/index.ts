import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { CHARACTERS } from '@wheee/shared'
import { countryToCrop } from './regionCrop.js'
import { RoomManager } from './RoomManager.js'
import { countIdleHumans } from './presence.js'
import { Matchmaking, capsHaveLightning } from './matchmaking.js'
import { ReplayStore } from './ReplayStore.js'
import { parseAnalyticsIdentity, parseClientMessage, send } from './protocol.js'
import type { WsData } from './protocol.js'
import { ConnectionLimiter } from './ratelimit.js'
import { runMigrations } from './db/migrate.js'
import { authRoutes } from './auth/oauth.js'
import { verifyJwt, parseCookieToken, extractToken } from './auth/jwt.js'
import { saveMatch, listReplays, getReplay, getUserMatches, updatePlayerStats, updateWatcherStats, getPlayerLeaderboard, getWatcherLeaderboard, setExcludedLeaderboardUsers } from './db/matchStore.js'
import { insertEvents, getDailySummary, getEventCounts, getPlatformSummary, getPropsAudit, setExcludedDevices } from './db/eventStore.js'
import { replyForUpdate, type TgUpdate } from './tgBot.js'
import { createQueueAlert } from './queueAlert.js'
import { runNudgePass } from './nudge.js'
import { adoptDeviceStreak, seedDeviceStreak, growDeviceStreak, wipeDeviceStreak } from './db/streakStore.js'
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
// Our own browsers, kept out of every aggregate — see setExcludedDevices.
setExcludedDevices((process.env.STATS_EXCLUDE_DEVICES ?? '').split(','))
// Same idea for the public boards — the owner's own accounts sit them out.
setExcludedLeaderboardUsers((process.env.LEADERBOARD_EXCLUDE_USERS ?? '').split(','))

const roomManager = new RoomManager({
  gracePeriodMs,
  replayStore,
  onRoomsChanged() { broadcastLobbyStatus() },
  /** A finished PvP pair, offered another match while both are still here. */
  onRematchReady(roomId, a, b, lightningEnabled) {
    matchmaking.openRematch(roomId, a, b, lightningEnabled)
  },
  /**
   * The server's own copy of the badge streak. The client keeps drawing its
   * own and keeps self-reporting it, so nothing on the wire changed and a
   * portal build several versions behind is untouched — this copy exists to be
   * readable while the player is away, which is when a reminder needs it.
   */
  onStreakChange(analytics, change) {
    try {
      if (change.kind === 'adopt') adoptDeviceStreak(analytics.deviceId, change.reported)
      else seedDeviceStreak(analytics.deviceId)
    } catch (e) { console.error('[db] streak update failed:', e) }
  },
  /**
   * The leaver's own client cannot report this — it is gone, and the `game:end`
   * that ends the match goes to whoever stayed. Written here so `match_start`
   * finally has a closing event on both sides of a quit.
   */
  onAbandon(data) {
    if (!data.analytics) return
    const { deviceId, sessionId, platform, host } = data.analytics
    try {
      insertEvents([{
        deviceId, sessionId, userId: null, platform, host,
        name: 'match_abandon',
        props: JSON.stringify({
          practice: data.practice,
          vsBot: data.vsBot,
          round: data.round,
          tick: data.tick,
          phase: data.phase,
          reason: data.reason,
        }),
        country: null, lang: null,
      }])
    } catch (e) { console.error('[db] match_abandon insert failed:', e) }
  },
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

    /**
     * The authoritative per-player outcome, with what killed them. Two things
     * the client-side `match_end` cannot give us: it rides a pagehide beacon so
     * it undercounts, and it never carried the cause at all. The cause is the
     * whole point — the queue's first-match bot never hunts, so a newcomer who
     * loses was almost certainly killed by the weather, and knowing that is
     * what decides whether difficulty work belongs in the bot or in the sky.
     */
    try {
      const rows: EventRow[] = []
      for (const pid of ['A', 'B'] as const) {
        const who = data.analytics[pid]
        if (!who) continue // a bot slot
        const cause = data.deathCauses[pid]
        const dir = cause && cause.type === 'wind' ? cause.dir : undefined
        rows.push({
          deviceId: who.deviceId, sessionId: who.sessionId, userId: null,
          platform: who.platform, host: who.host,
          name: 'match_result',
          props: JSON.stringify({
            result: data.winner === 'draw' ? 'draw' : data.winner === pid ? 'win' : 'loss',
            cause: cause ? cause.type : 'survived',
            ...(dir ? { dir } : {}),
            rounds: data.rounds,
            vsBot: data.vsBot,
          }),
          country: null, lang: null,
        })
      }
      insertEvents(rows)
    } catch (e) { console.error('[db] match_result insert failed:', e) }

    /**
     * Settled from the same facts the client uses: a win grows the badge, any
     * other loss wipes it, a draw is neutral, and losing to a dropped
     * connection is the network's fault rather than the player's.
     */
    try {
      for (const pid of ['A', 'B'] as const) {
        const who = data.analytics[pid]
        if (!who || data.winner === 'draw') continue
        if (data.winner === pid) { growDeviceStreak(who.deviceId); continue }
        if (data.deathCauses[pid]?.type === 'disconnect') continue
        wipeDeviceStreak(who.deviceId)
      }
    } catch (e) { console.error('[db] streak settle failed:', e) }

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

const _rawAlertCooldown = process.env.QUEUE_ALERT_COOLDOWN_MS ? Number(process.env.QUEUE_ALERT_COOLDOWN_MS) : undefined
const queueAlert = createQueueAlert({
  chatId: process.env.QUEUE_ALERT_CHAT_ID || '',
  cooldownMs: _rawAlertCooldown !== undefined && Number.isFinite(_rawAlertCooldown) && _rawAlertCooldown >= 0
    ? _rawAlertCooldown
    : 60_000,
  send: (chatId, text) => tgSendMessage(chatId, text),
  now: Date.now,
})

const matchmaking = new Matchmaking(roomManager, {
  // Idle = connected, in the lobby (no room), and recently active — see presence.ts.
  countIdleHumans(exclude) { return countIdleHumans(allClients, exclude, Date.now()) },
  onLoneWaiter: queueAlert,
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

app.get('/api/character-suggestion', (c) => {
  const country = detectCountry(c.req.raw.headers)
  return c.json({ character: countryToCrop(country) })
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
  return c.json({
    daily: getDailySummary(days),
    counts: getEventCounts(days),
    platforms: getPlatformSummary(days),
    // Every "practice excluded" number above leans on one SQL expression, so a
    // misplaced flag makes them all wrong together and consistent with each
    // other while doing it. This is the row that shows it — see getPropsAudit.
    propsAudit: getPropsAudit(days),
  })
})

/* ── Telegram bot webhook ── */

/**
 * The bot's conversational duties live in tgBot.ts (catalog moderation at
 * tapps.center requires an English reply to /start); this route is only the
 * transport. Without both secrets it does not exist, rather than existing open.
 */
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || ''
const TG_WEBHOOK_SECRET = process.env.TG_WEBHOOK_SECRET || ''

function tgSendMessage(chatId: number | string, text: string, replyMarkup?: unknown): void {
  if (!TG_BOT_TOKEN) return
  fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
  }).catch((e) => console.error('[tg] sendMessage failed:', e))
}

/**
 * The awaiting variant, for the return reminder: it has to know whether the
 * message actually landed. A 403 means no private chat exists — the player
 * opened the Mini App from a link and never pressed Start in the bot, or has
 * blocked it. No retry will ever change that, so it is recorded and dropped.
 */
async function tgSendMessageResult(
  chatId: string,
  text: string,
  replyMarkup: unknown,
): Promise<{ ok: boolean; forbidden: boolean }> {
  if (!TG_BOT_TOKEN) return { ok: false, forbidden: false }
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
    })
    if (res.ok) return { ok: true, forbidden: false }
    return { ok: false, forbidden: res.status === 403 }
  } catch (e) {
    console.error('[tg] nudge send failed:', e)
    return { ok: false, forbidden: false }
  }
}

const NUDGE_ENABLED = process.env.TG_NUDGE_ENABLED === '1'
const _rawNudgeCooldown = Number(process.env.TG_NUDGE_COOLDOWN_DAYS)
const NUDGE_COOLDOWN_DAYS = Number.isFinite(_rawNudgeCooldown) && _rawNudgeCooldown > 0 ? _rawNudgeCooldown : 7
const _rawNudgeHour = Number(process.env.TG_NUDGE_HOUR_UTC)
const NUDGE_HOUR_UTC = Number.isInteger(_rawNudgeHour) && _rawNudgeHour >= 0 && _rawNudgeHour <= 23
  ? _rawNudgeHour
  : 15

/**
 * Inspect exactly who would be written to and what they would read, against
 * live data and without sending anything. This is the gate: the scheduled pass
 * below stays inert until TG_NUDGE_ENABLED=1, so no message can reach a real
 * player until someone has looked at this and decided to turn it on.
 */
app.get('/api/nudge/preview', async (c) => {
  const expected = process.env.STATS_TOKEN
  if (!expected || c.req.query('token') !== expected) return c.json({ error: 'Forbidden' }, 403)
  const result = await runNudgePass({
    send: tgSendMessageResult,
    cooldownDays: NUDGE_COOLDOWN_DAYS,
    dryRun: true,
  })
  return c.json({ enabled: NUDGE_ENABLED, cooldownDays: NUDGE_COOLDOWN_DAYS, hourUtc: NUDGE_HOUR_UTC, ...result })
})

/**
 * Once a day, at one hour, and only when explicitly enabled. `lastNudgeDay` is
 * in memory only: a restart may repeat the check, which costs nothing because
 * the cooldown in tg_nudges is what actually prevents a second message.
 */
let lastNudgeDay = ''
setInterval(() => {
  if (!NUDGE_ENABLED || !TG_BOT_TOKEN) return
  const now = new Date()
  if (now.getUTCHours() !== NUDGE_HOUR_UTC) return
  const day = now.toISOString().slice(0, 10)
  if (day === lastNudgeDay) return
  lastNudgeDay = day

  runNudgePass({ send: tgSendMessageResult, cooldownDays: NUDGE_COOLDOWN_DAYS, dryRun: false })
    .then((r) => console.log(`[nudge] ${day}: considered ${r.considered}, sent ${r.sent}, unreachable ${r.unreachable}, failed ${r.failed}`))
    .catch((e) => console.error('[nudge] pass failed:', e))
}, 10 * 60_000).unref()

app.post('/api/tg/webhook', async (c) => {
  if (!TG_BOT_TOKEN || !TG_WEBHOOK_SECRET) return c.json({ error: 'Not found' }, 404)
  if (c.req.header('x-telegram-bot-api-secret-token') !== TG_WEBHOOK_SECRET) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  let update: TgUpdate
  try { update = await c.req.json() } catch { return c.json({ ok: true }) }

  // Telegram only needs a 200 — the reply itself can go out after we answer.
  const reply = replyForUpdate(update)
  if (reply) tgSendMessage(reply.chatId, reply.text, reply.replyMarkup)

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
      // Who this socket is to analytics, so the server can file an event for a
      // player who has already gone. Null for an old client that omits it.
      const analytics = parseAnalyticsIdentity(url.searchParams)
      const ok = server.upgrade(req, {
        data: { sessionId, userId, userName, countryCode, roomId: null, playerId: null, role: null, limiter: new ConnectionLimiter(), analytics, lastActiveAt: Date.now() },
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
          // Absent flag = old client: keep counting it as a live human.
          if (msg.active !== false) ws.data.lastActiveAt = Date.now()
          send(ws, { type: 'pong' })
          break
        }

        case 'queue:join': {
          if (ws.data.roomId) {
            send(ws, { type: 'error', message: 'Already in a game' })
            return
          }
          matchmaking.enqueue(ws, msg.character, msg.streak, msg.caps)
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
          matchmaking.createInvite(ws, msg.character, msg.streak, msg.caps, msg.code)
          if (ws.data.roomId) broadcastLobbyStatus()
          break
        }

        case 'friend:cancel': {
          matchmaking.cancelInvite(ws)
          break
        }

        /**
         * Symmetric by design: the first of the pair to send this is offering,
         * the second is accepting. A socket with no open pairing is ignored
         * rather than answered — see Matchmaking.wantRematch.
         */
        case 'rematch:want': {
          if (ws.data.roomId) {
            send(ws, { type: 'error', message: 'Already in a game' })
            return
          }
          matchmaking.wantRematch(ws, msg.character, msg.streak ?? 0, msg.caps ?? [])
          break
        }

        case 'rematch:cancel': {
          matchmaking.cancelRematch(ws)
          break
        }

        case 'friend:join': {
          if (ws.data.roomId) {
            send(ws, { type: 'error', message: 'Already in a game' })
            return
          }
          if (matchmaking.joinInvite(ws, msg.code, msg.character, msg.streak, msg.caps)) {
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
          // Room forces lightning off for practice regardless, but the field is
          // required now — spell out the intent rather than leaning on that.
          const room = roomManager.createRoom({ practice: true, lightningEnabled: false })
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
          // No Matchmaking pairing here — it's always vs a bot, which has no
          // client of its own, so the lone human's caps are the whole decision.
          const room = roomManager.createRoom({ lightningEnabled: capsHaveLightning(msg.caps ?? []) })
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
      // Tells whoever was still weighing a rematch that the offer died with them.
      matchmaking.cancelRematch(ws)
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
