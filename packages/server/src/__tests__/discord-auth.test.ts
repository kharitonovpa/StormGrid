import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as schema from '../db/schema'

const __dir = dirname(fileURLToPath(import.meta.url))
const migrationsPath = resolve(__dir, '../../drizzle')

// DB isolation: same pattern as db.test.ts — create test db and mock the module
// before importing oauth.ts, because importing it pulls in the db module.
const sqlite = new Database(':memory:')
sqlite.run('PRAGMA foreign_keys = ON')
const db = drizzle(sqlite, { schema })
migrate(db, { migrationsFolder: migrationsPath })

mock.module('../db/index.js', () => ({ db, schema, sqlite }))

let server: ReturnType<typeof Bun.serve>
let authRoutes: typeof import('../auth/oauth.js')['authRoutes']

/** What the mock returns; tests flip these to simulate failures. */
const mock_state = {
  tokenStatus: 200 as number,
  lastTokenBody: '' as string,
  me: { id: '190283098', username: 'stormfan', global_name: 'Storm Fan', avatar: 'abc123' } as Record<string, unknown>,
  meStatus: 200 as number,
}

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === '/oauth2/token') {
        mock_state.lastTokenBody = await req.text()
        if (mock_state.tokenStatus !== 200) return new Response('{}', { status: mock_state.tokenStatus })
        return Response.json({ access_token: 'mock-access-token', token_type: 'Bearer', expires_in: 604800 })
      }
      if (url.pathname === '/users/@me') {
        if (mock_state.meStatus !== 200) return new Response('{}', { status: mock_state.meStatus })
        return Response.json(mock_state.me)
      }
      return new Response('not found', { status: 404 })
    },
  })

  process.env.DISCORD_CLIENT_ID = 'test-client-id'
  process.env.DISCORD_CLIENT_SECRET = 'test-secret'
  process.env.DISCORD_API_BASE = `http://localhost:${server.port}`
  ;({ authRoutes } = await import('../auth/oauth.js'))
})

afterAll(() => { server.stop() })

const ORIGIN = { origin: 'https://12345.discordsays.com', 'content-type': 'application/json' }

function post(body: unknown, headers: Record<string, string> = ORIGIN) {
  return authRoutes.request('/discord', { method: 'POST', headers, body: JSON.stringify(body) })
}

describe('POST /api/auth/discord', () => {
  it('exchanges a code and returns our JWT + the discord access token', async () => {
    mock_state.tokenStatus = 200; mock_state.meStatus = 200
    const res = await post({ code: 'oauth-code-1' })
    expect(res.status).toBe(200)
    const data = await res.json() as { token: string; user: { id: string; name: string; avatar: string | null }; access_token: string }
    expect(data.token.length).toBeGreaterThan(10)
    expect(data.user.name).toBe('Storm Fan')
    expect(data.user.avatar).toBe('https://cdn.discordapp.com/avatars/190283098/abc123.png?size=256')
    expect(data.access_token).toBe('mock-access-token')
    // The exchange body carried our credentials and grant type.
    expect(mock_state.lastTokenBody).toContain('grant_type=authorization_code')
    expect(mock_state.lastTokenBody).toContain('client_id=test-client-id')
    expect(mock_state.lastTokenBody).toContain('code=oauth-code-1')
  })

  it('falls back to username when global_name is missing, avatar null when unset', async () => {
    mock_state.me = { id: '77', username: 'plainuser', global_name: null, avatar: null }
    const res = await post({ code: 'oauth-code-2' })
    const data = await res.json() as { user: { name: string; avatar: string | null } }
    expect(data.user.name).toBe('plainuser')
    expect(data.user.avatar).toBeNull()
    mock_state.me = { id: '190283098', username: 'stormfan', global_name: 'Storm Fan', avatar: 'abc123' }
  })

  it('401s when discord rejects the code', async () => {
    mock_state.tokenStatus = 400
    expect((await post({ code: 'bad' })).status).toBe(401)
    mock_state.tokenStatus = 200
  })

  it('401s when the user lookup fails', async () => {
    mock_state.meStatus = 500
    expect((await post({ code: 'oauth-code-3' })).status).toBe(401)
    mock_state.meStatus = 200
  })

  it('400s without a code', async () => {
    expect((await post({})).status).toBe(400)
  })

  it('403s from a foreign origin', async () => {
    const res = await post({ code: 'x' }, { origin: 'https://evil.example.com', 'content-type': 'application/json' })
    expect(res.status).toBe(403)
  })
})
