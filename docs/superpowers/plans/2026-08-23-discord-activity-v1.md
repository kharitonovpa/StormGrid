# Discord Activity v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship wheee as a Discord Activity: the game runs inside Discord's iframe behind the `{clientId}.discordsays.com` proxy, players log in with Discord OAuth2, and two participants of the same activity instance are auto-matched into a 1v1.

**Architecture:** A fifth platform adapter (`discord.ts`, mirroring `telegram.ts`) talks to `@discord/embedded-app-sdk`; an SDK-free bridge module exposes instance/share handles to App.vue without pulling the SDK into other builds. The server gains `POST /api/auth/discord` (OAuth2 code exchange, mirroring `/telegram`) and create-or-join semantics for client-supplied friend codes (`dc-<instanceId>`). The discord static build is baked into the existing nginx docker image and served as `discord.wheee.io`.

**Tech Stack:** Vue 3 + Vite (client), Bun + Hono + bun:test (server), `@discord/embedded-app-sdk`, docker compose + nginx on the PL VPS.

**Spec:** `docs/superpowers/specs/2026-08-23-discord-activity-v1-design.md`. One deviation from the spec's §6, discovered from the Dockerfile: PL static is built inside the docker image (Dockerfile stage `nginx`), not rsync'd — so there is no `deploy-discord.sh`; the discord build is a second `vite build` in the Dockerfile and a new nginx server block.

## Global Constraints

- Client-supplied friend codes are accepted ONLY with the `dc-` prefix (normalized `DC-`), regex `^DC-[A-Z0-9-]{6,64}$`; anything else falls back to a server-generated code.
- Discord scopes: exactly `['identify', 'applications.commands']`.
- Server env names: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, optional `DISCORD_API_BASE` (default `https://discord.com/api`, overridable for tests). Client env: `VITE_DISCORD_CLIENT_ID`.
- Discord adapter: `canLinkOut() = false`, all ad methods `false`/no-op, storage = `createLocalStorage()`, sound = `createLocalSound()`.
- Avatar URL template: `https://cdn.discordapp.com/avatars/{id}/{avatar}.png?size=256`.
- Server tests: run per-file with `bun test src/__tests__/<file>.test.ts` from `packages/server` — the files touched here (friend-invite, discord-auth) need NO live server and NO delay env vars.
- Client verification: `cd packages/client && bunx vue-tsc -b && bunx vite build` (plus `VITE_PLATFORM=discord VITE_DISCORD_CLIENT_ID=x bunx vite build --outDir dist-discord --emptyOutDir` for the discord variant).
- Commit messages: imperative, matter-of-fact, end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Server — create-or-join friend codes

**Files:**
- Modify: `packages/shared/src/protocol.ts` (FriendCreateMsg, ~line 28)
- Modify: `packages/server/src/matchmaking.ts` (`createInvite`, ~line 114)
- Modify: `packages/server/src/index.ts` (`case 'friend:create'`, ~line 395)
- Test: `packages/server/src/__tests__/friend-invite.test.ts`

**Interfaces:**
- Consumes: existing `Matchmaking.createInvite/joinInvite`, `friend:waiting`/`friend:join_fail` messages.
- Produces: `FriendCreateMsg = { type: 'friend:create'; character: CharacterType; streak?: number; caps?: string[]; code?: string }`; `Matchmaking.createInvite(ws, character, streak = 0, caps: string[] = [], requestedCode?: string): string`. Task 5's client sends `code: 'DC-<INSTANCEID>'`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/src/__tests__/friend-invite.test.ts` (reuse the file's existing `makeFakeWs`/`lastOfType` helpers):

```ts
describe('Matchmaking — discord create-or-join codes', () => {
  it('parks the first caller under a valid client code', () => {
    const mm = new Matchmaking(new RoomManager())
    const a = makeFakeWs()

    const code = mm.createInvite(a as any, 'wheat', 0, [], 'dc-abc123-def')

    expect(code).toBe('DC-ABC123-DEF')
    const waiting = lastOfType(a, 'friend:waiting')
    expect((waiting as { code: string }).code).toBe('DC-ABC123-DEF')
  })

  it('second create with the same code joins instead of parking', () => {
    const mm = new Matchmaking(new RoomManager())
    const a = makeFakeWs()
    const b = makeFakeWs()

    mm.createInvite(a as any, 'wheat', 0, [], 'dc-abc123-def')
    mm.createInvite(b as any, 'corn', 0, [], 'DC-abc123-def')

    // Both sockets are in a room now — the match started.
    expect(a.data.roomId).not.toBeNull()
    expect(b.data.roomId).not.toBeNull()
    expect(a.data.roomId).toBe(b.data.roomId)
  })

  it('third create after the match parks a fresh invite (pairwise matching)', () => {
    const mm = new Matchmaking(new RoomManager())
    const a = makeFakeWs()
    const b = makeFakeWs()
    const c = makeFakeWs()

    mm.createInvite(a as any, 'wheat', 0, [], 'dc-abc123-def')
    mm.createInvite(b as any, 'corn', 0, [], 'dc-abc123-def')
    mm.createInvite(c as any, 'wheat', 0, [], 'dc-abc123-def')

    expect(c.data.roomId).toBeNull()
    const waiting = lastOfType(c, 'friend:waiting')
    expect((waiting as { code: string }).code).toBe('DC-ABC123-DEF')
  })

  it('re-create by the same socket replaces its invite instead of self-joining', () => {
    const mm = new Matchmaking(new RoomManager())
    const a = makeFakeWs()

    mm.createInvite(a as any, 'wheat', 0, [], 'dc-abc123-def')
    mm.createInvite(a as any, 'corn', 0, [], 'dc-abc123-def')

    expect(a.data.roomId).toBeNull()
    expect(a.messages.filter(m => m.type === 'friend:waiting').length).toBe(2)
  })

  it('rejects codes without the dc- prefix and falls back to a server code', () => {
    const mm = new Matchmaking(new RoomManager())
    const a = makeFakeWs()

    const code = mm.createInvite(a as any, 'wheat', 0, [], 'HACK42')

    expect(code).toMatch(/^[A-Z2-9]{6}$/)
  })

  it('rejects malformed dc- codes (too short, bad chars)', () => {
    const mm = new Matchmaking(new RoomManager())
    const a = makeFakeWs()

    expect(mm.createInvite(a as any, 'wheat', 0, [], 'dc-ab')).toMatch(/^[A-Z2-9]{6}$/)
    expect(mm.createInvite(a as any, 'wheat', 0, [], 'dc-абв_гд')).toMatch(/^[A-Z2-9]{6}$/)
  })
})
```

Before writing, check how `RoomManager`'s `room.join` marks the socket: `grep -n "roomId" packages/server/src/RoomManager.ts | head`. If it does not set `ws.data.roomId`, assert the match started via the messages instead (`lastOfType(a, 'match:start')` or whatever the room's first message type is — check `grep -n "send(" packages/server/src/RoomManager.ts | head`), and adjust the three roomId assertions accordingly.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd packages/server && bun test src/__tests__/friend-invite.test.ts`
Expected: the six new tests FAIL (createInvite ignores the 5th argument today — the first test fails on the `DC-…` code expectation); the pre-existing tests still pass.

- [ ] **Step 3: Extend the protocol**

In `packages/shared/src/protocol.ts`, change (keep the surrounding comment style):

```ts
export type FriendCreateMsg = { type: 'friend:create'; character: CharacterType; streak?: number; caps?: string[]; code?: string }
```

Also update the comment above the friend-message block to mention the discord case, e.g. append to it: `Discord instances pass a deterministic `dc-<instanceId>` code — the server treats a taken code as a join (create-or-join), so both sides can send the same message.`

- [ ] **Step 4: Implement create-or-join in Matchmaking**

In `packages/server/src/matchmaking.ts`, add near the top (module scope, by the other constants):

```ts
/** Client-supplied codes (discord instances) — anything else gets a server code. */
const CLIENT_CODE_RE = /^DC-[A-Z0-9-]{6,64}$/
```

Replace `createInvite` with:

```ts
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
```

In `packages/server/src/index.ts`, `case 'friend:create'`, pass the code through and broadcast when the create turned into a match (mirror how `friend:join` broadcasts):

```ts
case 'friend:create': {
  if (ws.data.roomId) {
    send(ws, { type: 'error', message: 'Already in a game' })
    return
  }
  matchmaking.createInvite(ws, msg.character, msg.streak, msg.caps, msg.code)
  if (ws.data.roomId) broadcastLobbyStatus()
  break
}
```

(If Step 1's investigation showed `room.join` doesn't set `ws.data.roomId`, use the same signal you used in the tests.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/server && bun test src/__tests__/friend-invite.test.ts`
Expected: ALL tests pass, including the pre-existing ones (regression check on the server-generated path).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/protocol.ts packages/server/src/matchmaking.ts packages/server/src/index.ts packages/server/src/__tests__/friend-invite.test.ts
git commit -m "Accept client dc- friend codes with create-or-join semantics

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Server — POST /api/auth/discord

**Files:**
- Modify: `packages/server/src/auth/oauth.ts` (add after the GamePush section)
- Test: create `packages/server/src/__tests__/discord-auth.test.ts`

**Interfaces:**
- Consumes: existing `upsertUser(provider, providerId, name, avatar)` (oauth.ts:356), `signJwt` from `../auth/jwt`, `isPlatformOriginAllowed`, `platformAuthRateLimit` (oauth.ts:224/234), exported Hono router `authRoutes`.
- Produces: `POST /api/auth/discord` accepting `{ code: string }`, returning `{ token, user: { id, name, avatar }, access_token }`. Task 4's client calls it.

- [ ] **Step 1: Check test-side DB isolation**

Read the top of `packages/server/src/__tests__/db.test.ts` and note how it isolates `DB_PATH` (env var / temp file). The new test file must do the same BEFORE importing oauth.ts, because importing it pulls in the db module. Also check how `authRoutes` is mounted (`grep -n "authRoutes" packages/server/src/index.ts`) to confirm the route prefix — the tests below call the router directly, so the path is `/discord`.

- [ ] **Step 2: Write the failing tests**

Create `packages/server/src/__tests__/discord-auth.test.ts`. The mock Discord API is a local `Bun.serve`; env is set before the dynamic import so the module-level constants pick it up:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'bun:test'

// DB isolation: same pattern as db.test.ts — set DB_PATH before any import that touches the db.
// (Copy the exact mechanism from db.test.ts here.)

let server: ReturnType<typeof Bun.serve>
let authRoutes: typeof import('../auth/oauth.js')['authRoutes']

/** What the mock returns; tests flip these to simulate failures. */
const mock = {
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
        mock.lastTokenBody = await req.text()
        if (mock.tokenStatus !== 200) return new Response('{}', { status: mock.tokenStatus })
        return Response.json({ access_token: 'mock-access-token', token_type: 'Bearer', expires_in: 604800 })
      }
      if (url.pathname === '/users/@me') {
        if (mock.meStatus !== 200) return new Response('{}', { status: mock.meStatus })
        return Response.json(mock.me)
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
    mock.tokenStatus = 200; mock.meStatus = 200
    const res = await post({ code: 'oauth-code-1' })
    expect(res.status).toBe(200)
    const data = await res.json() as { token: string; user: { id: string; name: string; avatar: string | null }; access_token: string }
    expect(data.token.length).toBeGreaterThan(10)
    expect(data.user.name).toBe('Storm Fan')
    expect(data.user.avatar).toBe('https://cdn.discordapp.com/avatars/190283098/abc123.png?size=256')
    expect(data.access_token).toBe('mock-access-token')
    // The exchange body carried our credentials and grant type.
    expect(mock.lastTokenBody).toContain('grant_type=authorization_code')
    expect(mock.lastTokenBody).toContain('client_id=test-client-id')
    expect(mock.lastTokenBody).toContain('code=oauth-code-1')
  })

  it('falls back to username when global_name is missing, avatar null when unset', async () => {
    mock.me = { id: '77', username: 'plainuser', global_name: null, avatar: null }
    const res = await post({ code: 'oauth-code-2' })
    const data = await res.json() as { user: { name: string; avatar: string | null } }
    expect(data.user.name).toBe('plainuser')
    expect(data.user.avatar).toBeNull()
    mock.me = { id: '190283098', username: 'stormfan', global_name: 'Storm Fan', avatar: 'abc123' }
  })

  it('401s when discord rejects the code', async () => {
    mock.tokenStatus = 400
    expect((await post({ code: 'bad' })).status).toBe(401)
    mock.tokenStatus = 200
  })

  it('401s when the user lookup fails', async () => {
    mock.meStatus = 500
    expect((await post({ code: 'oauth-code-3' })).status).toBe(401)
    mock.meStatus = 200
  })

  it('400s without a code', async () => {
    expect((await post({})).status).toBe(400)
  })

  it('403s from a foreign origin', async () => {
    const res = await post({ code: 'x' }, { origin: 'https://evil.example.com', 'content-type': 'application/json' })
    expect(res.status).toBe(403)
  })
})
```

Note: the same-user upsert runs twice across tests (same discord id) — that's the normal upsert path and needs no special handling.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/server && bun test src/__tests__/discord-auth.test.ts`
Expected: FAIL — `/discord` route doesn't exist, so `authRoutes.request('/discord', …)` returns 404.

- [ ] **Step 4: Implement the endpoint**

In `packages/server/src/auth/oauth.ts`, after the GamePush section (mirror the section-comment style):

```ts
/* ── Discord Activities ──────────────────────────── */

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || ''
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || ''
const DISCORD_API_BASE = process.env.DISCORD_API_BASE || 'https://discord.com/api'

const DISCORD_ORIGIN_RE = /^https:\/\/[a-z0-9-]+\.discordsays\.com$/

authRoutes.post('/discord', async (c) => {
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) return c.json({ error: 'Discord auth not configured' }, 500)

  const origin = c.req.header('origin')
  if (!isPlatformOriginAllowed(origin, DISCORD_ORIGIN_RE)) {
    return c.json({ error: 'Forbidden origin' }, 403)
  }

  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!platformAuthRateLimit(`discord:${ip}`)) {
    return c.json({ error: 'Too many requests' }, 429)
  }

  const body = await c.req.json<{ code?: string }>().catch(() => null)
  if (!body?.code) return c.json({ error: 'Missing code' }, 400)

  // The successful exchange IS the proof of authenticity — only Discord can
  // issue a code our client_secret redeems.
  const tokenRes = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: body.code,
    }),
  }).catch(() => null)
  if (!tokenRes?.ok) return c.json({ error: 'Invalid code' }, 401)
  const tokenData = await tokenRes.json().catch(() => null) as { access_token?: string } | null
  if (!tokenData?.access_token) return c.json({ error: 'Invalid code' }, 401)

  const meRes = await fetch(`${DISCORD_API_BASE}/users/@me`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  }).catch(() => null)
  if (!meRes?.ok) return c.json({ error: 'Discord user lookup failed' }, 401)
  const me = await meRes.json().catch(() => null) as { id?: string; username?: string; global_name?: string | null; avatar?: string | null } | null
  if (!me?.id || !me.username) return c.json({ error: 'Discord user lookup failed' }, 401)

  const name = me.global_name || me.username
  const avatar = me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=256` : null

  const { userId, finalName, finalAvatar } = upsertUser('discord', me.id, name, avatar)
  const jwt = await signJwt(userId, finalName, finalAvatar)

  return c.json({ token: jwt, user: { id: userId, name: finalName, avatar: finalAvatar }, access_token: tokenData.access_token })
})
```

Note the deliberate omission of `redirect_uri` in the exchange: the Embedded App SDK flow (official embedded-app-sdk README example) exchanges without it. If a REAL portal test later returns `invalid_grant` mentioning redirect_uri, add `redirect_uri: 'https://127.0.0.1'` (the placeholder registered in the portal) to the URLSearchParams — do not add it preemptively.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/server && bun test src/__tests__/discord-auth.test.ts`
Expected: PASS (all 6). Also run `bun test src/__tests__/auth.test.ts` — must still pass.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/auth/oauth.ts packages/server/src/__tests__/discord-auth.test.ts
git commit -m "Add POST /api/auth/discord OAuth2 code exchange

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Client — platform type, detection, API base, HTML strip

**Files:**
- Modify: `packages/client/src/lib/platform/types.ts:3` (PlatformType)
- Modify: `packages/client/src/lib/platform/detect.ts`
- Modify: `packages/client/src/lib/platform/index.ts:16-22` (dynamic import switch)
- Modify: `packages/client/src/lib/config.ts`
- Modify: `packages/client/vite.config.ts`

**Interfaces:**
- Produces: `PlatformType` includes `'discord'`; `detectPlatform()` returns `'discord'` for `VITE_PLATFORM=discord` builds or a `*.discordsays.com` hostname; `API_BASE` = `location.origin + '/gameapi'` on discord (so the untouched `WS_URL` formula yields `wss://…discordsays.com/gameapi/ws`). Task 4 creates `./discord`, which the index switch imports.

- [ ] **Step 1: Extend PlatformType and detection**

`types.ts:3`:

```ts
export type PlatformType = 'web' | 'telegram' | 'yandex' | 'gamepush' | 'discord'
```

`detect.ts` — insert the discord branch first (env pin wins; the hostname check is the runtime safety net for a misrouted build):

```ts
import type { PlatformType } from './types'

export function detectPlatform(): PlatformType {
  if (import.meta.env.VITE_PLATFORM === 'discord') return 'discord'
  if (typeof location !== 'undefined' && location.hostname.endsWith('.discordsays.com')) return 'discord'
  if (import.meta.env.VITE_PLATFORM === 'yandex') return 'yandex'
  if (import.meta.env.VITE_PLATFORM === 'gamepush') return 'gamepush'
  if (typeof window !== 'undefined'
    && !!window.Telegram?.WebApp?.initData?.length) return 'telegram'
  return 'web'
}
```

`platform/index.ts` — extend the import chain (keep the existing style):

```ts
    const mod = type === 'yandex'
      ? await import('./yandex')
      : type === 'gamepush'
        ? await import('./gamepush')
        : type === 'discord'
          ? await import('./discord')
          : type === 'telegram'
            ? await import('./telegram')
            : await import('./web')
```

This will not typecheck until Task 4 creates `./discord`. To keep this task independently verifiable, create a placeholder `packages/client/src/lib/platform/discord.ts` now:

```ts
import type { PlatformAdapter } from './types'
import { createLocalStorage, createLocalSound, noSticky } from './defaults'

/** Placeholder — replaced by the real adapter in the next task. */
export default class DiscordAdapter implements PlatformAdapter {
  readonly type = 'discord' as const
  readonly hostId = null
  readonly storage = createLocalStorage()
  readonly sound = createLocalSound()

  canAuth(): boolean { return true }
  canShowLeaderboard(): boolean { return true }
  canLinkOut(): boolean { return false }

  showSticky = noSticky.showSticky
  closeSticky = noSticky.closeSticky
  onStickyChange = noSticky.onStickyChange

  async init(): Promise<void> {}
  ready(): void {}
  gameplayStart(): void {}
  gameplayStop(): void {}
  async getUser() { return null }
  async login() { return null }
  async logout(): Promise<void> {}
  getAuthToken(): string | null { return null }
  isRewardedAvailable(): boolean { return false }
  async showPreloader(): Promise<boolean> { return false }
  async showInterstitial(): Promise<boolean> { return false }
  async showRewarded(): Promise<boolean> { return false }
  onPause(_cb: () => void): () => void { return () => {} }
  onResume(_cb: () => void): () => void { return () => {} }
  getLanguage(): string { return 'en' }
}
```

- [ ] **Step 2: Route API through the proxy prefix**

`config.ts` — full new content:

```ts
const dev = import.meta.env.DEV

/**
 * Inside a Discord Activity every request must stay on the activity's own
 * origin ({clientId}.discordsays.com) — the portal's URL Mapping /gameapi →
 * api.wheee.io forwards both https and wss. The hostname check covers a build
 * that reaches Discord without the env pin.
 */
const isDiscord = import.meta.env.VITE_PLATFORM === 'discord'
  || (typeof location !== 'undefined' && location.hostname.endsWith('.discordsays.com'))

export const API_BASE = isDiscord
  ? `${location.origin}/gameapi`
  : dev
    ? `${location.protocol}//${location.hostname}:3001`
    : (import.meta.env.VITE_API_URL || `${location.protocol}//${location.hostname}`)

export const WS_URL = API_BASE.replace(/^http(s?)/, 'ws$1') + '/ws'
```

Note: `isDiscord` wins over `dev` on purpose — local discord dev runs behind a cloudflared tunnel where only mapped paths work.

- [ ] **Step 3: Strip external tags from discord HTML**

`vite.config.ts` — the discord build must carry no external `<script>`/font links (the activity CSP blocks them; Google Fonts specifically are NOT in Discord's CSP exceptions). Change the two platform conditions:

```ts
      if (platform === 'yandex' || platform === 'gamepush' || platform === 'discord') {
        html = stripExternalMeta(html)
        html = stripTelegramSdk(html)
      }
```

and leave `useRelativeBase` as is (discord is served from its own origin root through the proxy, so absolute `/` base is correct).

- [ ] **Step 4: Verify both builds**

```bash
cd packages/client && bunx vue-tsc -b && bunx vite build
VITE_PLATFORM=discord VITE_DISCORD_CLIENT_ID=placeholder bunx vite build --outDir dist-discord --emptyOutDir
grep -c "telegram\|fonts.googleapis" dist-discord/index.html || echo CLEAN
```

Expected: both builds succeed; the grep prints `CLEAN` (no external tags survive). Also `git status` must show no accidental `dist-discord` tracking — add `dist-discord` to `packages/client/.gitignore` (check the existing ignore for `dist` first and mirror it).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/lib/platform/types.ts packages/client/src/lib/platform/detect.ts packages/client/src/lib/platform/index.ts packages/client/src/lib/platform/discord.ts packages/client/src/lib/config.ts packages/client/vite.config.ts packages/client/.gitignore
git commit -m "Add discord platform type, detection, and proxied API base

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Client — Discord adapter + SDK-free bridge

**Files:**
- Create: `packages/client/src/lib/platform/discordBridge.ts`
- Rewrite: `packages/client/src/lib/platform/discord.ts` (replaces Task 3's placeholder)
- Modify: `packages/client/package.json` (dependency)

**Interfaces:**
- Consumes: `API_BASE` (config), `createLocalStorage/createLocalSound/noSticky` (defaults), `setSafeAreaInset` (safeArea), `PlatformAdapter` (types), Task 2's `POST /api/auth/discord`.
- Produces (bridge — what Task 5 imports; the bridge itself never imports the SDK, so App.vue/analytics can import it statically in every build):
  - `getDiscordInstanceCode(): string | null` — `'DC-' + instanceId` uppercased, or null outside discord
  - `getDiscordCustomId(): string | null`, `getDiscordReferrerId(): string | null`
  - `shareDiscordLink(code: string, message: string): Promise<boolean>`
  - `onDiscordParticipantCount(cb: (count: number) => void): () => void` — fires immediately with the current count, then on every change

- [ ] **Step 1: Install the SDK**

```bash
cd packages/client && bun add @discord/embedded-app-sdk
```

- [ ] **Step 2: Write the bridge**

Create `packages/client/src/lib/platform/discordBridge.ts`:

```ts
/**
 * SDK-free window into the Discord adapter. The adapter (a lazily imported
 * chunk that owns @discord/embedded-app-sdk) registers its live handles here
 * during init(); on every other platform the getters return inert defaults —
 * so App.vue and analytics can import this file statically without dragging
 * the SDK into non-discord builds.
 */
export type DiscordHandles = {
  instanceCode: string | null
  customId: string | null
  referrerId: string | null
  shareLink: (code: string, message: string) => Promise<boolean>
  onParticipantCount: (cb: (count: number) => void) => () => void
}

let handles: DiscordHandles | null = null

export function registerDiscordHandles(h: DiscordHandles): void {
  handles = h
}

export function getDiscordInstanceCode(): string | null {
  return handles?.instanceCode ?? null
}

export function getDiscordCustomId(): string | null {
  return handles?.customId ?? null
}

export function getDiscordReferrerId(): string | null {
  return handles?.referrerId ?? null
}

export function shareDiscordLink(code: string, message: string): Promise<boolean> {
  return handles ? handles.shareLink(code, message) : Promise.resolve(false)
}

export function onDiscordParticipantCount(cb: (count: number) => void): () => void {
  return handles ? handles.onParticipantCount(cb) : () => {}
}
```

- [ ] **Step 3: Write the real adapter**

Replace `packages/client/src/lib/platform/discord.ts` entirely:

```ts
import { DiscordSDK, patchUrlMappings } from '@discord/embedded-app-sdk'
import type { UserInfo } from '@wheee/shared'
import type { PlatformAdapter } from './types'
import { createLocalStorage, createLocalSound, noSticky } from './defaults'
import { API_BASE } from '../config'
import { setSafeAreaInset } from './safeArea'
import { registerDiscordHandles } from './discordBridge'

/** Layout modes from the SDK: 0 = focused, 1 = picture-in-picture, 2 = grid. */
const LAYOUT_FOCUSED = 0

function readSafeAreaVar(name: string): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name)
  const px = parseFloat(raw)
  return Number.isFinite(px) ? px : 0
}

function applyDiscordSafeArea(): void {
  setSafeAreaInset({
    top: readSafeAreaVar('--discord-safe-area-inset-top'),
    bottom: readSafeAreaVar('--discord-safe-area-inset-bottom'),
    left: readSafeAreaVar('--discord-safe-area-inset-left'),
    right: readSafeAreaVar('--discord-safe-area-inset-right'),
  })
}

export default class DiscordAdapter implements PlatformAdapter {
  readonly type = 'discord' as const
  readonly hostId = null
  readonly storage = createLocalStorage()
  readonly sound = createLocalSound()

  private sdk: DiscordSDK | null = null
  private user: UserInfo | null = null
  private token: string | null = null
  private locale = 'en'
  private participantCount = 0
  private participantCbs = new Set<(count: number) => void>()
  private pauseCbs = new Set<() => void>()
  private resumeCbs = new Set<() => void>()

  canAuth(): boolean { return true }
  canShowLeaderboard(): boolean { return true }
  /** External links are hidden inside the activity sandbox (openExternalLink is a later feature). */
  canLinkOut(): boolean { return false }

  showSticky = noSticky.showSticky
  closeSticky = noSticky.closeSticky
  onStickyChange = noSticky.onStickyChange

  async init(): Promise<void> {
    const clientId: string = import.meta.env.VITE_DISCORD_CLIENT_ID || ''
    if (!clientId) {
      console.warn('[discord] VITE_DISCORD_CLIENT_ID missing — running as anonymous web-like client')
      return
    }

    const sdk = new DiscordSDK(clientId)
    this.sdk = sdk
    await sdk.ready()

    // Desktop-only dialog; switching relaunches the Discord client, so ask
    // before anything heavy starts. Failures are non-fatal everywhere.
    await sdk.commands.encourageHardwareAcceleration().catch(() => {})

    try {
      const { locale } = await sdk.commands.userSettingsGetLocale()
      this.locale = locale.split('-')[0] || 'en'
    } catch { /* locale stays 'en' */ }

    applyDiscordSafeArea()

    // PIP/grid ≈ backgrounded: pause the heavy render like a hidden tab.
    sdk.subscribeToLayoutModeUpdatesCompat(({ layout_mode }) => {
      const cbs = layout_mode === LAYOUT_FOCUSED ? this.resumeCbs : this.pauseCbs
      for (const cb of cbs) cb()
    }).catch(() => {})

    sdk.subscribe('ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE', ({ participants }) => {
      this.participantCount = participants.length
      for (const cb of this.participantCbs) cb(this.participantCount)
    }).catch(() => {})
    try {
      const { participants } = await sdk.commands.getInstanceConnectedParticipants()
      this.participantCount = participants.length
    } catch { /* count stays 0 — automatch simply won't trigger */ }

    await this.loginWithRetry()

    registerDiscordHandles({
      instanceCode: `dc-${sdk.instanceId}`.toUpperCase(),
      customId: sdk.customId ?? null,
      referrerId: sdk.referrerId ?? null,
      shareLink: async (code, message) => {
        try {
          const { success } = await sdk.commands.shareLink({ message, custom_id: code })
          return success
        } catch { return false }
      },
      onParticipantCount: (cb) => {
        this.participantCbs.add(cb)
        cb(this.participantCount)
        return () => this.participantCbs.delete(cb)
      },
    })
  }

  ready(): void { /* sdk.ready() already awaited in init */ }
  gameplayStart(): void { /* noop */ }
  gameplayStop(): void { /* noop */ }

  async getUser(): Promise<UserInfo | null> { return this.user }

  async login(): Promise<UserInfo | null> {
    if (!this.user) await this.loginWithRetry(1)
    return this.user
  }

  async logout(): Promise<void> { /* noop inside Discord */ }

  getAuthToken(): string | null { return this.token }

  isRewardedAvailable(): boolean { return false }
  async showPreloader(): Promise<boolean> { return false }
  async showInterstitial(): Promise<boolean> { return false }
  async showRewarded(): Promise<boolean> { return false }

  onPause(cb: () => void): () => void {
    this.pauseCbs.add(cb)
    const handler = () => { if (document.hidden) cb() }
    document.addEventListener('visibilitychange', handler)
    return () => {
      this.pauseCbs.delete(cb)
      document.removeEventListener('visibilitychange', handler)
    }
  }

  onResume(cb: () => void): () => void {
    this.resumeCbs.add(cb)
    const handler = () => { if (!document.hidden) cb() }
    document.addEventListener('visibilitychange', handler)
    return () => {
      this.resumeCbs.delete(cb)
      document.removeEventListener('visibilitychange', handler)
    }
  }

  getLanguage(): string { return this.locale }

  private async loginWithRetry(maxAttempts = 3): Promise<boolean> {
    const sdk = this.sdk
    if (!sdk) return false
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
      try {
        const { code } = await sdk.commands.authorize({
          client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
          response_type: 'code',
          state: '',
          prompt: 'none',
          scope: ['identify', 'applications.commands'],
        })
        const res = await fetch(`${API_BASE}/api/auth/discord`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        })
        if (!res.ok) continue
        const data = await res.json() as { token: string; user: UserInfo; access_token: string }
        this.token = data.token
        this.user = data.user
        await sdk.commands.authenticate({ access_token: data.access_token })
        return true
      } catch { /* retry */ }
    }
    console.warn('[discord] Auth failed after', maxAttempts, 'attempts — running as anonymous')
    return false
  }
}
```

Adjust to the SDK's actual API where it disagrees (check `node_modules/@discord/embedded-app-sdk/output/index.d.ts` or the package README): the `authorize` args (whether `state` is required), the exact subscribe event name/typing, `shareLink`'s return shape, and `subscribeToLayoutModeUpdatesCompat`'s signature. `patchUrlMappings` is imported nowhere else and must NOT be called — remove the import if unused (it is; drop it).

- [ ] **Step 4: Typecheck and build**

```bash
cd packages/client && bunx vue-tsc -b && VITE_PLATFORM=discord VITE_DISCORD_CLIENT_ID=placeholder bunx vite build --outDir dist-discord --emptyOutDir
bunx vite build
grep -rl "discordsays\|embedded-app-sdk" dist/assets/*.js | head -3
```

Expected: both builds pass. The final grep over the WEB build's chunks: the SDK must only appear in the lazily loaded discord chunk, not in the entry chunk (`index-*.js`). If it leaks into the entry, a static import crept in somewhere — only `discordBridge` may be imported statically.

- [ ] **Step 5: Commit**

```bash
git add packages/client/package.json bun.lock packages/client/src/lib/platform/discord.ts packages/client/src/lib/platform/discordBridge.ts
git commit -m "Add Discord Activity adapter and SDK-free bridge

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Client — instance automatch, shareLink invites, referrer analytics

**Files:**
- Modify: `packages/client/src/composables/useGameSocket.ts:148-150` (createFriendInvite)
- Modify: `packages/client/src/lib/invite.ts` (incoming code source, share)
- Modify: `packages/client/src/App.vue` (automatch watcher, share branch, waiting copy)
- Modify: `packages/client/src/lib/i18n.ts` (two keys × EN/RU)
- Modify: `packages/client/src/lib/analytics.ts` (referrer prop on app_open)
- Possibly modify: `packages/client/src/components/LobbyOverlay.vue` (friend_wait screen without a URL)

**Interfaces:**
- Consumes: Task 1's `FriendCreateMsg.code`, Task 4's bridge (`getDiscordInstanceCode`, `getDiscordCustomId`, `getDiscordReferrerId`, `shareDiscordLink`, `onDiscordParticipantCount`).
- Produces: `createFriendInvite(character?: CharacterType, streak?: number, code?: string): boolean`.

- [ ] **Step 1: Thread the code through the socket API**

`useGameSocket.ts`:

```ts
  /** Park under a short code and wait for the invited friend. A discord
   * instance passes its deterministic dc- code (create-or-join on the server). */
  function createFriendInvite(character: CharacterType = 'wheat', streak = 0, code?: string) {
    return send(code
      ? { type: 'friend:create', character, streak, caps: CLIENT_CAPS, code }
      : { type: 'friend:create', character, streak, caps: CLIENT_CAPS })
  }
```

- [ ] **Step 2: Incoming invite code from discord's customId**

`invite.ts` — `getIncomingInviteCode()` gains a discord source (shareLink's `custom_id` round-trips as `discordSdk.customId`; it's a server-generated 6-char code, which already matches `CODE_RE`):

```ts
import { getDiscordCustomId } from './platform/discordBridge'
```

```ts
export function getIncomingInviteCode(): string | null {
  const fromQuery = new URLSearchParams(location.search).get('join')
    ?? new URLSearchParams(location.search).get('tgWebAppStartParam')
  const fromTelegram = window.Telegram?.WebApp?.initDataUnsafe?.start_param
  const fromDiscord = getDiscordCustomId()
  const raw = fromDiscord || fromTelegram || fromQuery
  if (!raw || !CODE_RE.test(raw)) return null
  return raw.toUpperCase()
}
```

CAUTION — ordering: App.vue reads `getIncomingInviteCode()` at setup (`App.vue:134` `const incomingInvite = ref(getIncomingInviteCode())`), which may run before the adapter registers its handles. Check where `initPlatform()` completes relative to App.vue setup (`grep -n "initPlatform" packages/client/src/main.ts packages/client/src/App.vue`). If the platform initializes before the app mounts (the repo pattern — `hydrateStorage` in `platform/index.ts` runs pre-mount), the bridge is populated in time and nothing more is needed. If not, re-read `getIncomingInviteCode()` after platform init inside App.vue.

- [ ] **Step 3: Automatch + share in App.vue**

In `App.vue` (script setup), after platform init is available:

```ts
import { getDiscordInstanceCode, onDiscordParticipantCount, shareDiscordLink } from './lib/platform/discordBridge'
```

```ts
/* ── Discord instance automatch: two people in the voice channel = a match.
   Both sides send the same dc- code; the server's create-or-join pairs them. ── */
if (platform.type === 'discord') {
  const tryInstanceMatch = () => {
    const code = getDiscordInstanceCode()
    if (!code) return
    if (game.phase.value !== 'idle') return
    if (incomingInvite.value) return
    if (socket.createFriendInvite(character, streak.value, code)) {
      track('instance_automatch')
    }
  }
  onDiscordParticipantCount(count => { if (count >= 2) tryInstanceMatch() })
}
```

Adapt the guards to App.vue's reality (the executor MUST read the file first): the actual idle-phase value (`grep -n "phase.value === " packages/client/src/App.vue | head` — reuse whatever the Play button checks), the actual selected-character variable (see the existing `socket.createFriendInvite(character, streak.value)` call at App.vue:147 and reuse its arguments), and place the block where other platform-conditional setup lives. Do NOT auto-rematch after a finished match (the `phase === idle` guard on fresh participant events is acceptable; both players returning to the lobby will re-pair only when a new participant event fires — that's fine for v1, note it in the commit message if the behavior feels surprising during manual testing).

Share branch — in the existing share handler (App.vue:155-159):

```ts
  const url = inviteUrl.value
  track('invite_share')
  if (platform.type === 'discord') {
    if (game.inviteCode.value) void shareDiscordLink(game.inviteCode.value, t('invite.shareText'))
    return
  }
  if (!shareInvite(url, t('invite.shareText'))) copyInvite(url)
```

(Adjust to the handler's actual shape — the guard on `url` may sit above; on discord the URL is irrelevant, so short-circuit before it.)

`inviteUrl` computed (App.vue:137): return `null` on discord so the friend_wait screen never renders a raw URL:

```ts
const inviteUrl = computed(() =>
  game.inviteCode.value && platform.type !== 'discord'
    ? buildInviteUrl(game.inviteCode.value, platform.type)
    : null,
)
```

- [ ] **Step 4: Waiting-copy and share button on the friend_wait screen**

Read `packages/client/src/components/LobbyOverlay.vue` around the `friend_wait` template (line ~204). Requirements:
- When `inviteUrl` is null (discord), the screen must still make sense: show the waiting text and keep a working share affordance if one exists on that screen; if the share button is gated on `inviteUrl`, gate it on a new optional prop `canShare: boolean` (default `!!inviteUrl` behavior preserved: pass `:can-share="!!inviteUrl || isDiscord"` from App.vue) that emits the existing share event.
- When the wait was started by instance automatch (the code starts with `DC-`), swap the heading for the instance-specific copy.

i18n keys in `packages/client/src/lib/i18n.ts` (both blocks; match neighboring key style):

```ts
    'lobby.instanceWait': 'Waiting for your channel-mate to load in…',
```

```ts
    'lobby.instanceWait': 'Ждём соперника из канала…',
```

Keep this step minimal — reuse the existing friend_wait layout, do not redesign it.

- [ ] **Step 5: Referrer prop on app_open**

`analytics.ts` (~line 52) — the spec wants `referrerId` recorded on the open event:

```ts
import { getDiscordReferrerId } from './platform/discordBridge'
```

```ts
  const referrer = getDiscordReferrerId()
  track('app_open', { returning: !!firstOpen, daysSinceFirst, ...(referrer ? { referrer } : {}) })
```

(`initAnalytics(platform)` runs after `initPlatform()` resolves, so the bridge is registered by then — verify with `grep -n "initAnalytics" packages/client/src/App.vue packages/client/src/main.ts`.)

- [ ] **Step 6: Typecheck, build, run the server suite once more**

```bash
cd packages/client && bunx vue-tsc -b && bunx vite build
cd ../server && bun test src/__tests__/friend-invite.test.ts src/__tests__/protocol.test.ts
```

Expected: all pass.

- [ ] **Step 7: Manual smoke via stubbed flow (no Discord needed)**

Playwright/local: run the dev server + client (`BOT_MATCH_DELAY_MS=800` per repo recipe, localStorage `wheee:tutorial_done=1`), open two tabs, and in each tab's console verify the plumbing end-to-end by sending the same code manually — e.g. temporarily expose or simulate: tab A and tab B both trigger `friend:create` with `code: 'DC-LOCALTEST-01'` (easiest: `new WebSocket` scratch client in the console, or a tiny temporary `?dcode=` hook you revert). Confirm: A gets `friend:waiting`, B's create starts the match in both tabs. This validates Task 1 + Task 5 wiring together; the Discord-real path is covered by the launch checklist (Task 7).

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/composables/useGameSocket.ts packages/client/src/lib/invite.ts packages/client/src/App.vue packages/client/src/lib/i18n.ts packages/client/src/lib/analytics.ts packages/client/src/components/LobbyOverlay.vue
git commit -m "Auto-match discord instance participants and share invites via shareLink

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Infra — discord build in the docker image, nginx host

**Files:**
- Modify: `Dockerfile` (build + nginx stages)
- Modify: `deploy/nginx.conf`
- Modify: `deploy/docker-compose.yml` (nginx build args)

**Interfaces:**
- Consumes: Task 3's `VITE_PLATFORM=discord` build.
- Produces: `discord.wheee.io` serving the discord bundle from the nginx container; build arg `VITE_DISCORD_CLIENT_ID` flowing compose → Dockerfile → Vite.

- [ ] **Step 1: Dockerfile — second client build**

After the existing client build (line 18-19):

```dockerfile
ARG VITE_API_URL
RUN cd packages/client && bunx vite build

ARG VITE_DISCORD_CLIENT_ID
RUN cd packages/client && VITE_PLATFORM=discord VITE_DISCORD_CLIENT_ID=$VITE_DISCORD_CLIENT_ID bunx vite build --outDir dist-discord --emptyOutDir
```

Nginx stage (after line 24):

```dockerfile
COPY --from=build /app/packages/client/dist-discord /var/www/wheee-discord
```

- [ ] **Step 2: nginx.conf — discord host**

In `deploy/nginx.conf`: add `discord.wheee.io` to the port-80 redirect `server_name` line, and add a server block after the RU frontend block (same shape, different root; the cert lineage is the existing `ru.wheee.io` one — it must be EXPANDED to cover the new name, a manual certbot step in Task 7's checklist):

```nginx
# ── Discord Activity frontend: static SPA (HTTPS) ─────────────
server {
    listen 443 ssl;
    server_name discord.wheee.io;

    ssl_certificate     /etc/letsencrypt/live/ru.wheee.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ru.wheee.io/privkey.pem;

    root /var/www/wheee-discord;

    location / {
        try_files $uri /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?|glb)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

- [ ] **Step 3: docker-compose — thread the client id**

In `deploy/docker-compose.yml`, nginx service build args:

```yaml
      args:
        VITE_API_URL: ${VITE_API_URL:-https://api.wheee.io}
        VITE_DISCORD_CLIENT_ID: ${VITE_DISCORD_CLIENT_ID:-}
```

(The `app` service needs no client id; the server reads `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET` from its `env_file: .env`, which Task 7's checklist fills.)

- [ ] **Step 4: Verify the image builds**

```bash
docker build --target nginx --build-arg VITE_DISCORD_CLIENT_ID=placeholder -t wheee-nginx-test . && docker run --rm wheee-nginx-test ls /var/www/wheee-discord | head -5
```

Expected: build succeeds; the listing shows `index.html` + `assets`. (If docker isn't available locally, fall back to `cd packages/client && VITE_PLATFORM=discord VITE_DISCORD_CLIENT_ID=placeholder bunx vite build --outDir dist-discord --emptyOutDir` and `nginx -t`-style eyeballing of the conf; state clearly in the commit/report that the docker path is untested locally.)

- [ ] **Step 5: Commit**

```bash
git add Dockerfile deploy/nginx.conf deploy/docker-compose.yml
git commit -m "Bake the discord build into the nginx image behind discord.wheee.io

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Launch checklist doc (manual steps)

**Files:**
- Create: `marketing/DISCORD_LAUNCH_CHECKLIST.md`

**Interfaces:** none (documentation). The interactive Developer-Portal wizard is generated by the MAIN session afterwards (mattpocock-skills:wizard) — this doc is the source checklist the wizard will be built from, and the fallback if the wizard isn't used.

- [ ] **Step 1: Write the checklist**

Create `marketing/DISCORD_LAUNCH_CHECKLIST.md` covering, in order, with concrete URLs/commands (in Russian, matching the other marketing docs):

1. **DNS**: A-запись `discord.wheee.io` → PL VPS (64.176.74.237).
2. **Сертификат**: расширить существующий cert на новое имя — на VPS: `cd /opt/wheee/deploy && docker compose run --rm certbot certonly --webroot -w /var/www/certbot --expand -d ru.wheee.io -d api.wheee.io -d discord.wheee.io` — ПЕРЕД записью в чеклист свериться с тем, как issued текущий cert (посмотреть `deploy/setup-ru-vps.sh` / серверную историю: webroot или standalone; вписать фактический рабочий вариант и путь webroot).
3. **Developer Portal** (https://discord.com/developers/applications): создать приложение (прод) + по dev-приложению на разработчика; User+Guild install; redirect URI `https://127.0.0.1`; Activities → Enable Activities; Supported Platforms: Web (мобайл выключить в v1); URL Mappings строго в порядке: `/gameapi` → `api.wheee.io`, затем `/` → `discord.wheee.io`. Записать Client ID/Secret. Отметить: если UI навязывает префикс `/.proxy` — вписать фактический префикс и поменять одну строку в `packages/client/src/lib/config.ts`.
4. **env**: локально в `deploy/.env`-контуре добавить `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `VITE_DISCORD_CLIENT_ID` (= Client ID) → `bash deploy/deploy-all.sh --server` (sync-env + rebuild).
5. **Dev-петля**: `cloudflared tunnel --url http://localhost:5173` + dev-приложение с маппингами `/` → туннель и `/gameapi` → второй туннель на `localhost:3001` (`cloudflared tunnel --url http://localhost:3001`); Vite запускать как `VITE_PLATFORM=discord VITE_DISCORD_CLIENT_ID=<dev app id> bun run dev`; Developer Mode в Discord → войс-канал → Rocket Button → своё Activity. После тестов на чужих доменах — сбросить URL mapping (защита от перехвата).
6. **Первый замер (гейт на дальнейшую полировку)**: RTT WSS через прокси из Activity против прямого `wss://api.wheee.io/ws` с того же компьютера; порог: медиана прокси-RTT < 150ms из ЕС. Плюс проверить, что egress-IP VPS не забанен Cloudflare (activity вообще грузится).
7. **Прод-проверка**: двое в войс-канале (сервер <25 участников) → автоматч; shareLink-инвайт из активности → у получателя матч по коду; аналитика: `platform: 'discord'` появляется в `/api/events/summary`.
8. **Параллельный трек**: team-аккаунт, identity + app verification, метаданные/арты (assets-and-metadata), Discovery opt-in — со ссылками на разделы `marketing/DISCORD_ACTIVITIES_INTEGRATION_RESEARCH.md` §7.

- [ ] **Step 2: Commit**

```bash
git add marketing/DISCORD_LAUNCH_CHECKLIST.md
git commit -m "Add Discord Activity launch checklist

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
