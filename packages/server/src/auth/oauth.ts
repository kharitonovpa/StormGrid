import { Hono, type Context } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { signJwt, verifyJwt, extractToken, timingSafeEqual } from './jwt.js'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || ''
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || ''
const CALLBACK_URL = process.env.AUTH_CALLBACK_URL || 'http://localhost:3001/api/auth/callback'
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173'
const ALLOWED_CLIENT_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',').map(s => s.trim()),
)
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || ''
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || ''
const TG_INIT_DATA_MAX_AGE = 300 // 5 minutes

const pendingStates = new Map<string, { origin: string; expires: number }>()

setInterval(() => {
  const now = Date.now()
  for (const [k, v] of pendingStates) {
    if (v.expires < now) pendingStates.delete(k)
  }
}, 60_000)

export const authRoutes = new Hono()

/* ── Cookie helper ──────────────────────────────────── */

function setTokenCookie(c: Context, jwt: string, maxAge: number) {
  const isSecure = CALLBACK_URL.startsWith('https')
  const domain = COOKIE_DOMAIN ? `; Domain=${COOKIE_DOMAIN}` : ''
  c.header('Set-Cookie', `token=${jwt}; HttpOnly; ${isSecure ? 'Secure; ' : ''}SameSite=Lax; Path=/${domain}; Max-Age=${maxAge}`)
}

function clearTokenCookie(c: Context) {
  const isSecure = CALLBACK_URL.startsWith('https')
  const domain = COOKIE_DOMAIN ? `; Domain=${COOKIE_DOMAIN}` : ''
  c.header('Set-Cookie', `token=; HttpOnly; ${isSecure ? 'Secure; ' : ''}SameSite=Lax; Path=/${domain}; Max-Age=0`)
}

/* ── CSRF state helpers ─────────────────────────────── */

function createOAuthState(clientOrigin: string): string {
  const nonce = crypto.randomUUID()
  pendingStates.set(nonce, { origin: clientOrigin, expires: Date.now() + 10 * 60_000 })
  // Evict expired entries (keep map bounded)
  if (pendingStates.size > 1000) {
    const now = Date.now()
    for (const [k, v] of pendingStates) {
      if (v.expires < now) pendingStates.delete(k)
    }
  }
  return nonce
}

function consumeOAuthState(nonce: string | null): string | null {
  if (!nonce) return null
  const entry = pendingStates.get(nonce)
  if (!entry) return null
  pendingStates.delete(nonce)
  if (entry.expires < Date.now()) return null
  return entry.origin
}

/* ── Google OAuth ─────────────────────────────────── */

authRoutes.get('/google', (c) => {
  const clientOrigin = resolveClientOrigin(c)
  const state = createOAuthState(clientOrigin)
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${CALLBACK_URL}/google`,
    response_type: 'code',
    scope: 'openid profile',
    prompt: 'select_account',
    state,
  })
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
})

authRoutes.get('/callback/google', async (c) => {
  if (c.req.query('error')) return c.html('<!DOCTYPE html><html><body><script>window.close()</script></body></html>')
  const code = c.req.query('code')
  const stateNonce = c.req.query('state') || null
  if (!code) return c.text('Missing code', 400)

  const clientOrigin = consumeOAuthState(stateNonce)
  if (!clientOrigin) return c.text('Invalid or expired state', 403)

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: `${CALLBACK_URL}/google`,
      grant_type: 'authorization_code',
    }),
  })
  if (!tokenRes.ok) return c.text('Token exchange failed', 502)

  const tokenData = await tokenRes.json() as { access_token: string }
  const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  })
  if (!profileRes.ok) return c.text('Profile fetch failed', 502)

  const profile = await profileRes.json() as { id: string; name: string; picture?: string }
  return finishLogin(c, 'google', profile.id, profile.name, profile.picture ?? null, clientOrigin)
})

/* ── GitHub OAuth ─────────────────────────────────── */

authRoutes.get('/github', (c) => {
  const clientOrigin = resolveClientOrigin(c)
  const state = createOAuthState(clientOrigin)
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: `${CALLBACK_URL}/github`,
    scope: 'read:user',
    state,
  })
  return c.redirect(`https://github.com/login/oauth/authorize?${params}`)
})

authRoutes.get('/callback/github', async (c) => {
  if (c.req.query('error')) return c.html('<!DOCTYPE html><html><body><script>window.close()</script></body></html>')
  const code = c.req.query('code')
  const stateNonce = c.req.query('state') || null
  if (!code) return c.text('Missing code', 400)

  const clientOrigin = consumeOAuthState(stateNonce)
  if (!clientOrigin) return c.text('Invalid or expired state', 403)

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${CALLBACK_URL}/github`,
    }),
  })
  if (!tokenRes.ok) return c.text('Token exchange failed', 502)

  const tokenData = await tokenRes.json() as { access_token: string }
  const profileRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': 'wheee' },
  })
  if (!profileRes.ok) return c.text('Profile fetch failed', 502)

  const profile = await profileRes.json() as { id: number; login: string; avatar_url?: string }
  return finishLogin(c, 'github', String(profile.id), profile.login, profile.avatar_url ?? null, clientOrigin)
})

/* ── Telegram Mini App ────────────────────────────── */

const encoder = new TextEncoder()

type TgUser = { id: number; first_name: string; last_name?: string; username?: string; photo_url?: string }

async function hmacSha256(key: ArrayBuffer | Uint8Array<ArrayBuffer>, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', k, encoder.encode(data))
}

function bufToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

async function validateTelegramInitData(initData: string, botToken: string): Promise<TgUser | null> {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return null
  params.delete('hash')

  const authDate = Number(params.get('auth_date') || 0)
  const age = Math.floor(Date.now() / 1000) - authDate
  if (age > TG_INIT_DATA_MAX_AGE || age < -60) return null

  const sorted = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  const dataCheckString = sorted.map(([k, v]) => `${k}=${v}`).join('\n')

  const secretKey = await hmacSha256(encoder.encode('WebAppData'), botToken)
  const computed = bufToHex(await hmacSha256(secretKey, dataCheckString))
  if (!timingSafeEqual(computed, hash)) return null

  const userStr = params.get('user')
  if (!userStr) return null
  try { return JSON.parse(userStr) as TgUser } catch { return null }
}

authRoutes.post('/telegram', async (c) => {
  if (!TG_BOT_TOKEN) return c.json({ error: 'Telegram auth not configured' }, 500)

  const body = await c.req.json<{ initData?: string }>().catch(() => null)
  if (!body?.initData) return c.json({ error: 'Missing initData' }, 400)

  const tgUser = await validateTelegramInitData(body.initData, TG_BOT_TOKEN)
  if (!tgUser) return c.json({ error: 'Invalid initData' }, 401)

  const name = tgUser.username || [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ')
  const avatar = tgUser.photo_url ?? null
  const providerId = String(tgUser.id)

  const { userId, finalName, finalAvatar } = upsertUser('telegram', providerId, name, avatar)
  const jwt = await signJwt(userId, finalName, finalAvatar)

  return c.json({ token: jwt, user: { id: userId, name: finalName, avatar: finalAvatar } })
})

/* ── /me and /logout ──────────────────────────────── */

authRoutes.get('/me', async (c) => {
  const token = extractToken(c.req.header('cookie') ?? null, c.req.header('authorization'))
  if (!token) return c.json({ user: null })
  const payload = await verifyJwt(token)
  if (!payload) return c.json({ user: null })
  return c.json({ user: { id: payload.sub, name: payload.name, avatar: payload.avatar } })
})

authRoutes.post('/logout', (c) => {
  clearTokenCookie(c)
  return c.json({ ok: true })
})

/* ── Shared helpers ───────────────────────────────── */

function upsertUser(provider: string, providerId: string, name: string, avatar: string | null) {
  const existing = db.select().from(schema.users)
    .where(and(eq(schema.users.provider, provider), eq(schema.users.providerId, providerId)))
    .get()

  let userId: string
  if (existing) {
    userId = existing.id
    db.update(schema.users)
      .set({ name, avatar })
      .where(eq(schema.users.id, userId))
      .run()
  } else {
    userId = crypto.randomUUID()
    db.insert(schema.users)
      .values({ id: userId, provider, providerId, name, avatar, createdAt: new Date() })
      .run()
  }

  return { userId, finalName: name, finalAvatar: avatar }
}

function resolveClientOrigin(c: Context): string {
  const referer = c.req.header('referer')
  if (referer) {
    try {
      const origin = new URL(referer).origin
      if (ALLOWED_CLIENT_ORIGINS.has(origin)) return origin
    } catch { /* ignore malformed */ }
  }
  return CLIENT_ORIGIN
}

async function finishLogin(
  c: Context,
  provider: string,
  providerId: string,
  name: string,
  avatar: string | null,
  clientOrigin: string,
) {
  const { userId, finalName, finalAvatar } = upsertUser(provider, providerId, name, avatar)

  const jwt = await signJwt(userId, finalName, finalAvatar)
  setTokenCookie(c, jwt, 30 * 24 * 60 * 60)

  const safeJson = JSON.stringify({ id: userId, name: finalName, avatar: finalAvatar }).replace(/</g, '\\u003c')
  const safeOrigin = JSON.stringify(clientOrigin)
  return c.html(`<!DOCTYPE html><html><body><script>
    window.opener.postMessage({ type: 'auth:done', user: ${safeJson} }, ${safeOrigin});
    window.close();
  </script></body></html>`)
}
