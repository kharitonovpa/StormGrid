const SECRET = process.env.JWT_SECRET || 'dev-secret-do-not-use-in-production'
const EXPIRES_IN = 30 * 24 * 60 * 60 // 30 days in seconds

const encoder = new TextEncoder()

async function hmacSign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  const bytes = new Uint8Array(sig)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

async function hmacVerify(payload: string, signature: string): Promise<boolean> {
  const expected = await hmacSign(payload)
  return timingSafeEqual(expected, signature)
}

function base64url(obj: unknown): string {
  const bytes = encoder.encode(JSON.stringify(obj))
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (s.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export type JwtPayload = { sub: string; name: string; avatar: string | null; iat: number; exp: number }

export async function signJwt(userId: string, name: string, avatar: string | null): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const payload: JwtPayload = { sub: userId, name, avatar, iat: now, exp: now + EXPIRES_IN }
  const header = base64url({ alg: 'HS256', typ: 'JWT' })
  const body = base64url(payload)
  const sig = await hmacSign(`${header}.${body}`)
  return `${header}.${body}.${sig}`
}

export async function verifyJwt(token: string): Promise<JwtPayload | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, body, sig] = parts
  if (!await hmacVerify(`${header}.${body}`, sig)) return null
  try {
    const payload: JwtPayload = JSON.parse(fromBase64url(body))
    if (typeof payload.sub !== 'string') return null
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

export function parseCookieToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  const match = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/)
  return match ? match[1] : null
}

/** Extract JWT from cookie, Authorization header, or query param (in that order). */
export function extractToken(
  cookieHeader: string | null,
  authHeader?: string | null,
  queryToken?: string | null,
): string | null {
  return parseCookieToken(cookieHeader)
    || (authHeader?.replace(/^Bearer\s+/i, '') ?? null)
    || queryToken
    || null
}
