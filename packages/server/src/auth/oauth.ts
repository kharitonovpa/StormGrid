import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { signJwt, verifyJwt, parseCookieToken } from './jwt.js'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || ''
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || ''
const CALLBACK_URL = process.env.AUTH_CALLBACK_URL || 'http://localhost:3001/api/auth/callback'
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173'

export const authRoutes = new Hono()

/* ── Google OAuth ─────────────────────────────────── */

authRoutes.get('/google', (c) => {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${CALLBACK_URL}/google`,
    response_type: 'code',
    scope: 'openid profile',
    prompt: 'select_account',
  })
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
})

authRoutes.get('/callback/google', async (c) => {
  const code = c.req.query('code')
  if (!code) return c.text('Missing code', 400)

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
  return finishLogin(c, 'google', profile.id, profile.name, profile.picture ?? null)
})

/* ── GitHub OAuth ─────────────────────────────────── */

authRoutes.get('/github', (c) => {
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: `${CALLBACK_URL}/github`,
    scope: 'read:user',
  })
  return c.redirect(`https://github.com/login/oauth/authorize?${params}`)
})

authRoutes.get('/callback/github', async (c) => {
  const code = c.req.query('code')
  if (!code) return c.text('Missing code', 400)

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
  return finishLogin(c, 'github', String(profile.id), profile.login, profile.avatar_url ?? null)
})

/* ── /me and /logout ──────────────────────────────── */

authRoutes.get('/me', async (c) => {
  const token = parseCookieToken(c.req.header('cookie') ?? null)
  if (!token) return c.json({ user: null })
  const payload = await verifyJwt(token)
  if (!payload) return c.json({ user: null })
  return c.json({ user: { id: payload.sub, name: payload.name, avatar: payload.avatar } })
})

authRoutes.post('/logout', (c) => {
  const isSecure = CALLBACK_URL.startsWith('https')
  c.header('Set-Cookie', `token=; HttpOnly; ${isSecure ? 'Secure; ' : ''}SameSite=Lax; Path=/; Max-Age=0`)
  return c.json({ ok: true })
})

/* ── Shared login finisher ────────────────────────── */

async function finishLogin(
  c: Parameters<Parameters<typeof authRoutes.get>[1]>[0],
  provider: string,
  providerId: string,
  name: string,
  avatar: string | null,
) {
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

  const jwt = await signJwt(userId, name, avatar)
  const isSecure = CALLBACK_URL.startsWith('https')
  const maxAge = 30 * 24 * 60 * 60
  c.header('Set-Cookie', `token=${jwt}; HttpOnly; ${isSecure ? 'Secure; ' : ''}SameSite=Lax; Path=/; Max-Age=${maxAge}`)

  const safeJson = JSON.stringify({ id: userId, name, avatar }).replace(/</g, '\\u003c')
  const safeOrigin = JSON.stringify(CLIENT_ORIGIN)
  return c.html(`<!DOCTYPE html><html><body><script>
    window.opener.postMessage({ type: 'auth:done', user: ${safeJson} }, ${safeOrigin});
    window.close();
  </script></body></html>`)
}
