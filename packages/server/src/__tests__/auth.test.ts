import { describe, test, expect } from 'bun:test'
import { signJwt, verifyJwt, parseCookieToken } from '../auth/jwt'

describe('JWT', () => {
  test('sign and verify round-trip', async () => {
    const token = await signJwt('user-123', 'Alice', 'https://img.example/a.png')
    const payload = await verifyJwt(token)
    expect(payload).not.toBeNull()
    expect(payload!.sub).toBe('user-123')
    expect(payload!.name).toBe('Alice')
    expect(payload!.avatar).toBe('https://img.example/a.png')
    expect(payload!.exp).toBeGreaterThan(payload!.iat)
  })

  test('rejects tampered token', async () => {
    const token = await signJwt('user-1', 'Bob', null)
    const tampered = token.slice(0, -5) + 'XXXXX'
    expect(await verifyJwt(tampered)).toBeNull()
  })

  test('rejects garbage', async () => {
    expect(await verifyJwt('not.a.jwt')).toBeNull()
    expect(await verifyJwt('')).toBeNull()
    expect(await verifyJwt('abc')).toBeNull()
  })

  test('null avatar is preserved', async () => {
    const token = await signJwt('user-2', 'Charlie', null)
    const payload = await verifyJwt(token)
    expect(payload!.avatar).toBeNull()
  })
})

describe('parseCookieToken', () => {
  test('extracts token from cookie header', () => {
    expect(parseCookieToken('token=abc123; other=val')).toBe('abc123')
    expect(parseCookieToken('other=val; token=xyz')).toBe('xyz')
    expect(parseCookieToken('token=single')).toBe('single')
  })

  test('returns null when no token cookie', () => {
    expect(parseCookieToken('other=val')).toBeNull()
    expect(parseCookieToken('')).toBeNull()
    expect(parseCookieToken(null)).toBeNull()
  })
})
