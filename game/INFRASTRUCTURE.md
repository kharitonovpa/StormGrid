# wheee Infrastructure & Deploy

## Overview

wheee runs on a two-server setup designed to serve both international and Russian
users from a single game server while bypassing Russian DPI (ТСПУ) filtering.
The client also targets **Telegram Mini App**, **Yandex Games**, and **GamePush
(Pikabu Games)** as additional platforms — all from the same codebase via a
platform adapter layer.

```
                         ┌──────────────────────────────────┐
                         │  Cloudflare (DNS + CDN proxy)    │
                         │  wheee.io → pages.dev            │
                         └────────────┬─────────────────────┘
                                      │
            ┌─────────────────────────┼─────────────────────────┐
            │                         │                         │
    ┌───────▼────────┐    ┌───────────▼──────────┐    ┌────────▼─────────┐
    │ International  │    │   Russian VPS        │    │  Polish Server   │
    │ users          │    │   185.39.206.229     │    │  64.176.71.39    │
    │                │    │   Timeweb, Moscow    │    │  Vultr, Warsaw   │
    │ wheee.io       │    │   ru.wheee.io        │    │  api.wheee.io    │
    │ (CF Pages)     │    │   nginx + static     │    │  Docker: app +   │
    └────────────────┘    │                      │    │  nginx + certbot │
                          │  /api/* ─────────────┼───►│  :443/api/*      │
                          │  /ws    ─────────────┼───►│  :443/ws         │
                          └──────────────────────┘    └──────────────────┘
```

All players share a single game server (Poland). The Russian VPS is a transparent
reverse proxy — it serves static files locally and forwards API/WebSocket traffic
to Poland over datacenter-to-datacenter links that are not filtered by ТСПУ.


## Servers

### Polish Server (64.176.71.39)

**Provider**: Vultr, Warsaw
**Role**: Game server + API + WebSocket + DB
**OS**: Ubuntu (Docker)

Runs three Docker containers via `deploy/docker-compose.yml`:

| Container | Image | Role | Port |
|-----------|-------|------|------|
| `app` | `deploy-app` (Bun runtime) | Game engine, HTTP API, WebSocket | 3001 (internal) |
| `nginx` | `deploy-nginx` (nginx:alpine) | TLS termination, static files, reverse proxy | 80, 443 |
| `certbot` | certbot/certbot | SSL certificate renewal | — |

**DNS records** (Cloudflare):
- `api.wheee.io` → `64.176.71.39` (DNS only, gray cloud)
- `wheee.io` → `wheee-5ou.pages.dev` (CNAME, proxied, orange cloud)

**Volumes**:
- `certbot-etc` — Let's Encrypt certificates (shared between nginx and certbot)
- `app-data` — SQLite database (`wheee.db`)

### Russian VPS (185.39.206.229)

**Provider**: Timeweb Cloud, Moscow (MSK-1)
**Role**: Reverse proxy for Russian users
**OS**: Ubuntu 24.04
**Cost**: ~730 RUB/month (VPS + IPv4)

Runs nginx natively (no Docker). Serves pre-built client static files from
`/var/www/wheee/` and proxies `/api/*` and `/ws` to the Polish server.

**DNS record** (Cloudflare):
- `ru.wheee.io` → `185.39.206.229` (DNS only, gray cloud — must NOT be proxied
  through Cloudflare since CF IPs are blocked by ТСПУ in Russia)

**SSL**: Let's Encrypt via certbot with auto-renewal timer.


## Domain Routing

| Domain | Audience | Hosted on | Notes |
|--------|----------|-----------|-------|
| `wheee.io` | International | Cloudflare Pages | CF CDN + proxy (orange cloud) |
| `ru.wheee.io` | Russia | Russian VPS → Polish server | DNS only (gray cloud), bypasses ТСПУ |
| `api.wheee.io` | Both (server-to-server) | Polish server | DNS only, used by Polish nginx and as proxy target |


## Configuration Files

```
deploy/
├── docker-compose.yml   # Polish server: app + nginx + certbot containers
├── nginx.conf           # Polish server nginx: api.wheee.io proxy + static
├── nginx-ru.conf        # Russian VPS nginx: static + /api/ + /ws proxy to Poland
├── deploy-all.sh        # One-command deploy: env sync → server → RU → archives
├── deploy.sh            # Polish server deploy via SSH (git pull + docker compose)
├── deploy-ru.sh         # Russian VPS deploy: vite build + rsync dist/
├── deploy-yandex.sh     # Yandex Games build: vite build + zip archive
├── deploy-gamepush.sh   # GamePush build: vite build + zip archive
├── sync-env.sh          # Sync .env.example keys to remote .env on Polish VPS
├── setup-ru-vps.sh      # One-time Russian VPS provisioning (nginx, certbot, SSL)
├── .env.example         # Environment variables template
└── .deploy.env          # (git-ignored) Local VPS host/user overrides
```


## Deploy Procedures

### One-command deploy

The recommended way to deploy everything:

```bash
bun run deploy          # all: env sync → server PL → static RU → archives
bun run deploy:server   # env sync + Polish VPS only
bun run deploy:ru       # Russian VPS static only
bun run deploy:archives # Yandex + GamePush zips only
bun run deploy:env      # only sync .env keys to Polish VPS
```

Or directly:

```bash
bash deploy/deploy-all.sh [--server] [--ru] [--archives] [--env-only]
```

Without flags, `deploy-all.sh` runs all steps in order. It performs pre-flight
checks before starting:

1. **Uncommitted changes** — warns and asks to continue (aborts in non-interactive)
2. **Unpushed commits** — offers to `git push` before server deploy (auto-pushes in
   non-interactive)
3. **Env sync** — downloads `.env` from Polish VPS, compares with `.env.example`,
   appends missing keys with empty values, uploads back
4. **Server deploy** — SSH to Polish VPS: `git pull --ff-only` + `docker compose up -d --build`
5. **Russian static** — local `vite build` + `rsync` to Russian VPS
6. **Archives** — Yandex zip + GamePush zip

### Polish Server (main game server)

`deploy/deploy.sh` connects via SSH remotely (no need to be on the VPS):

```bash
bash deploy/deploy.sh
```

This SSHs into `root@64.176.71.39` and runs `git pull --ff-only` + `docker compose
up -d --build`, which:
1. Builds the server (`packages/server`) with Bun
2. Builds the client (`packages/client`) with Vite (`VITE_API_URL=https://api.wheee.io`)
3. Copies client dist into nginx container
4. Restarts both `app` and `nginx` containers

VPS host/user can be overridden via `deploy/.deploy.env` or env vars:

```bash
PL_VPS_HOST=64.176.71.39 PL_VPS_USER=root bash deploy/deploy.sh
```

### Russian VPS (reverse proxy)

```bash
bash deploy/deploy-ru.sh
```

This:
1. Builds client with `VITE_API_URL=""` — the client uses `location.hostname`
   (same-origin), so API calls go to `ru.wheee.io/api/*` and WebSocket connects
   to `wss://ru.wheee.io/ws`
2. Rsyncs `dist/` to `root@185.39.206.229:/var/www/wheee/` (excludes `.DS_Store`)

**Important**: The Russian VPS client build is separate from the Polish one because
it must use same-origin API routing (not `api.wheee.io`, which is blocked in Russia).

### Yandex Games

```bash
bash deploy/deploy-yandex.sh
```

This:
1. Sets `VITE_PLATFORM=yandex` and `VITE_API_URL=https://api.wheee.io`
2. Runs `vite build` with `base: './'` (relative asset paths), which triggers
   the `platformHtmlPlugin`:
   - Injects `<script src="/sdk.js"></script>` (Yandex Games SDK, absolute from CDN root)
   - Strips Google Fonts, hreflang links, Telegram SDK inline script
3. Creates `wheee-yandex.zip` from `dist/`
4. Upload the zip to [Yandex Games Console](https://games.yandex.ru/console)

### GamePush (Pikabu Games)

```bash
bash deploy/deploy-gamepush.sh
```

This:
1. Sets `VITE_PLATFORM=gamepush`, `VITE_API_URL=https://api.wheee.io`,
   `VITE_GP_PROJECT_ID`, `VITE_GP_PUBLIC_TOKEN`
2. Runs `vite build` with `base: './'`, which:
   - Injects `<script async src="https://gamepush.com/sdk/game-score.js?..."></script>`
   - Strips Google Fonts, hreflang links, Telegram SDK inline script
3. Creates `wheee-gamepush.zip` from `dist/`
4. Upload the zip to GamePush panel → Settings → Source code

GP credentials default to hardcoded values but can be overridden in
`deploy/.deploy.env`:

```bash
GP_PROJECT_ID=27646
GP_PUBLIC_TOKEN=j27miVT4RNJTTRXRGJj6AQxQfsl16rsA
```

### Env sync

When adding new env variables (e.g. `YANDEX_SECRET_KEY`):

1. Add the key to `deploy/.env.example`
2. Run `bash deploy/sync-env.sh` (or `bun run deploy:env`)
3. The script downloads the remote `.env`, finds missing keys, appends them with
   empty values, shows a diff, and uploads back
4. SSH into the VPS to fill in the actual values

### When to deploy where

| Change | Polish server | Russian VPS | Yandex | GamePush |
|--------|:------------:|:-----------:|:------:|:--------:|
| Server code (engine, API, WS) | Yes | No | No | No |
| Client code (Vue, Three.js) | Yes | Yes | Yes | Yes |
| Shared types | Yes | Yes | Yes | Yes |
| nginx config (Polish) | Yes | No | No | No |
| nginx config (Russian) | No | scp + reload | No | No |
| i18n translations | Yes | Yes | Yes | Yes |
| Platform adapter logic | Yes | Yes | Yes | Yes |

After client changes, deploy everything in one command:

```bash
bun run deploy
```


## Multi-Platform Architecture

The client uses a **Platform Adapter** pattern to run on multiple targets from
a single codebase. Each platform has its own adapter implementing a shared interface.

### Platform detection

```
VITE_PLATFORM=yandex    →  YandexAdapter    (build-time flag)
VITE_PLATFORM=gamepush  →  GamePushAdapter  (build-time flag)
window.Telegram         →  TelegramAdapter  (runtime detection)
otherwise               →  WebAdapter       (default)
```

Detection runs once at app startup in `main.ts` via `initPlatform()`.
The `usePlatform()` function returns the singleton adapter synchronously after init.

### File structure

```
packages/client/src/lib/platform/
├── types.ts      # PlatformAdapter interface, PlatformType union
├── detect.ts     # detectPlatform() — returns 'yandex' | 'gamepush' | 'telegram' | 'web'
├── index.ts      # initPlatform() factory + usePlatform() singleton
├── web.ts        # WebAdapter — OAuth popups, cookie auth, visibility
├── telegram.ts   # TelegramAdapter — initData auth, TG WebApp SDK
├── yandex.ts     # YandexAdapter — YaGames SDK, ads, gameplay lifecycle
└── gamepush.ts   # GamePushAdapter — GamePush SDK, ads, platform auth

packages/client/src/
├── yandex-games.d.ts   # TypeScript types for Yandex Games SDK
└── gamepush.d.ts       # TypeScript types for GamePush SDK
```

### PlatformAdapter interface

```typescript
interface PlatformAdapter {
  readonly type: 'web' | 'telegram' | 'yandex' | 'gamepush'

  init(): Promise<void>       // SDK initialization, initial auth
  ready(): void               // signal SDK that loading is complete
  gameplayStart(): void       // signal active gameplay (Yandex GameplayAPI)
  gameplayStop(): void        // signal gameplay paused

  getUser(): Promise<UserInfo | null>
  login(provider?: string): Promise<UserInfo | null>
  logout(): Promise<void>
  getAuthToken(): string | null   // JWT token for WebSocket auth

  showInterstitial(): Promise<boolean>   // fullscreen ad
  showRewarded(): Promise<boolean>       // rewarded video ad

  onPause(cb: () => void): () => void    // tab hidden / ad playing / SDK pause
  onResume(cb: () => void): () => void   // tab visible / ad closed / SDK resume

  getLanguage(): string                  // 2-letter code (en, ru, etc.)
}
```

### Platform-specific behaviors

| Feature | Web | Telegram | Yandex | GamePush |
|---------|-----|----------|--------|----------|
| Auth | Google/GitHub OAuth popup | `initData` → `/api/auth/telegram` | `getPlayer({signed:true})` → `/api/auth/yandex` | `gp.player.login()` → `/api/auth/gamepush` |
| Token | Cookie (`HttpOnly`) | JWT in memory | JWT in memory | JWT in memory |
| Language | `navigator.language` | `initDataUnsafe.user.language_code` | `ysdk.environment.i18n.lang` | `gp.language` |
| Ads | No-op | No-op | `showFullscreenAdv` / `showRewardedVideo` | `gp.ads.showFullscreen()` / `showRewardedVideo()` |
| Pause | `visibilitychange` | `visibilitychange` | `game_api_pause` + `visibilitychange` | `gp.ads.on('start'/'close')` + `visibilitychange` |
| SDK injection | None | Conditional `document.write` | `<script src="/sdk.js">` via Vite | `<script async src="gamepush.com/sdk/...">` via Vite |
| SDK init | — | `WebApp.ready()` | `YaGames.init()` | `window.onGPInit` callback (10s timeout) |

### Startup flow

```
main.ts
  └─ initPlatform()           ← detects platform, dynamic import, init()
       └─ setLanguage()       ← from adapter.getLanguage()
            └─ createApp()    ← mount Vue
                 └─ App.vue onMounted()
                      └─ platform.ready()
                      └─ platform.onPause() / onResume()
                      └─ socket.connect()
```

If `initPlatform()` fails (SDK missing, network error), a fallback error overlay
with a Reload button is shown instead of a white screen.


## Internationalization (i18n)

### System

Minimal i18n framework in `packages/client/src/lib/i18n.ts`:

- `setLanguage(lang)` — sets active language (called once at startup from platform)
- `t(key, ...args)` — returns translated string; `{0}`, `{1}` for substitution
- `TAGLINES` — reactive `computed` array of translated taglines
- `lang` — reactive `computed` returning current language code

All UI strings are in the `messages` map (en + ru). Adding a new language: add a
new key in `messages` and translate all strings.

### Where i18n is used

Every Vue component uses `t()` for user-facing text:
- `LobbyOverlay.vue` — character names, buttons, queue status, recent matches
- `GameHud.vue` — round labels, countdown, forecast, cataclysm
- `GameOverOverlay.vue` — win/lose/draw messages, death causes, buttons
- `WatcherHud.vue` — watcher scores, predictions
- `ArchitectHud.vue` — weather controls
- `LeaderboardPanel.vue` — tab labels, empty states
- `VolumeControl.vue` — tooltips
- `StoriesOverlay.vue` — tutorial slides
- `ReplayOverlay.vue` — replay controls
- `App.vue` — reconnect banners, action menu (Move/Raise/Lower)

### Reactivity

- `characters` and `charLabel` in `LobbyOverlay.vue` are `computed` so they react
  to language changes.
- `TAGLINES` in `i18n.ts` is `computed`.
- `t()` inside Vue templates is reactive because templates re-evaluate on dependency changes.
- `t()` in non-reactive contexts (e.g. plain variables) evaluates once — wrap in `computed` if needed.


## Authentication

### Multi-domain auth (Web platform)

OAuth cookies use a shared domain so login persists across `wheee.io` and `ru.wheee.io`:

```
Set-Cookie: token=<JWT>; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.wheee.io
```

**`COOKIE_DOMAIN=.wheee.io`** in `.env` enables this. Both subdomains read the
same cookie. Without it, cookies are scoped to the exact domain.

### OAuth flow

1. Client opens popup → `api.wheee.io/api/auth/google` (or `/github`)
2. Server generates CSRF nonce, stores client `Referer` origin, redirects to Google/GitHub
3. OAuth callback → server exchanges code for tokens, upserts user in DB
4. Server issues JWT cookie (`Domain=.wheee.io`) and sends `postMessage` with user data
   to the stored origin
5. Client receives `postMessage('auth:done')` or polls `/api/auth/me` as fallback

**CSRF protection**: The `state` parameter contains a random nonce stored in
`pendingStates` map. Nonces expire after 10 minutes and are cleaned up periodically
(every 60 seconds via `setInterval`).

**Error handling**: If user cancels OAuth (Google/GitHub returns `?error=access_denied`),
the popup auto-closes via `window.close()`.

### Telegram auth

Telegram `initData` is sent to `/api/auth/telegram`. The server verifies the HMAC
signature using `TG_BOT_TOKEN`. On success, a JWT is returned in the response body
(not via cookie — Telegram WebView doesn't support shared cookies).

The `TelegramAdapter` retries auth up to 3 times with increasing delays (1s, 2s, 3s).
If all attempts fail, the user plays as anonymous and a warning is logged.

### Yandex Games auth

On init, the `YandexAdapter` calls `getPlayer({ signed: true })` to get the player's
data with a cryptographic signature. It sends `uniqueId`, `name`, `avatar`, and
`signature` to `POST /api/auth/yandex`. The server:

1. Validates the `Origin` header against Yandex domain patterns
2. Applies per-IP rate-limit (10 req/min)
3. If `YANDEX_SECRET_KEY` is configured, verifies the signature via HMAC-SHA256
4. Upserts user (provider: `yandex`) and returns a JWT

The JWT is stored in memory and sent as a query param on WebSocket connections.

### GamePush auth

On init, the `GamePushAdapter` waits for `window.onGPInit` callback (10s timeout),
then `await gp.player.ready`. If the player is logged in (`gp.player.isLoggedIn`),
it sends `playerId`, `name`, `avatar` to `POST /api/auth/gamepush`. The server:

1. Validates the `Origin` header against GamePush/Pikabu/Eponesh domain patterns
2. Applies per-IP rate-limit (10 req/min)
3. Upserts user (provider: `gamepush`) and returns a JWT

Login/logout promises have a 30s timeout to prevent hanging if the SDK doesn't
fire its callback.

### JWT

- Signed with HMAC-SHA256 using `JWT_SECRET`
- 30-day expiration
- Contains: `sub` (user ID), `name`, `avatar`, `iat`, `exp`
- If `JWT_SECRET` is not set, a dev fallback is used with a console warning
- For platform auth (Telegram, Yandex, GamePush): returned in response body,
  stored in memory, sent as `?token=` query param on WebSocket URL


## Client Build Variants

The client uses `VITE_API_URL` and `VITE_PLATFORM` to determine behavior:

```typescript
// packages/client/src/lib/config.ts
export const API_BASE = dev
  ? `${location.protocol}//${location.hostname}:3001`
  : (import.meta.env.VITE_API_URL || `${location.protocol}//${location.hostname}`)

export const WS_URL = API_BASE.replace(/^http(s?)/, 'ws$1') + '/ws'
```

| Build target | VITE_API_URL | VITE_PLATFORM | base | API_BASE |
|-------------|--------------|---------------|------|----------|
| Polish (docker-compose) | `https://api.wheee.io` | — | `/` | `https://api.wheee.io` |
| Russian VPS (deploy-ru.sh) | `""` (empty) | — | `/` | `https://ru.wheee.io` |
| Yandex Games | `https://api.wheee.io` | `yandex` | `./` | `https://api.wheee.io` |
| GamePush | `https://api.wheee.io` | `gamepush` | `./` | `https://api.wheee.io` |
| Local dev | — (DEV=true) | — | `/` | `http://localhost:3001` |

Yandex and GamePush builds use `base: './'` (relative asset paths) because these
platforms serve the game from subdirectories on their CDNs.

### Vite `platformHtmlPlugin`

When `VITE_PLATFORM` is `yandex` or `gamepush`, the Vite build transforms `index.html`:
- Strips Google Fonts preconnect and stylesheet links
- Strips `hreflang` alternate links and `<!-- i18n alternate -->` comment
- Strips the Telegram Mini App SDK inline `<script>` block

Additionally:
- **Yandex**: injects `<script src="/sdk.js"></script>` (absolute from Yandex CDN root)
- **GamePush**: injects `<script async src="https://gamepush.com/sdk/game-score.js?projectId=...&publicToken=...&callback=onGPInit"></script>`

If `VITE_PLATFORM=gamepush` but `VITE_GP_PROJECT_ID` or `VITE_GP_PUBLIC_TOKEN` are
not set, the build fails with a clear error message.


## SEO

### robots.txt

Located at `packages/client/public/robots.txt`:
- Allows `/`, disallows `/api/` and `/ws`
- References sitemaps for both `wheee.io` and `ru.wheee.io`

### sitemap.xml

Located at `packages/client/public/sitemap.xml`:
- Lists `https://wheee.io/` with `hreflang` alternates (en, ru, x-default)

### hreflang tags

In `index.html` `<head>`:
```html
<link rel="alternate" hreflang="en" href="https://wheee.io/" />
<link rel="alternate" hreflang="ru" href="https://ru.wheee.io/" />
<link rel="alternate" hreflang="x-default" href="https://wheee.io/" />
```

These are stripped in Yandex and GamePush builds by the Vite plugin.

### Search engine registration

- **Google Search Console**: Verified via Cloudflare DNS (automatic)
- **Yandex Webmaster**: Verified via HTML file (`public/yandex_e436b61ee7350243.html`)


## SSL Certificates

### Polish Server

Managed by certbot Docker container. Certificates stored in `certbot-etc` volume,
mounted read-only by nginx.

Renewal: run the certbot profile manually or set up a cron/systemd timer on the host.

### Russian VPS

Managed by certbot installed via apt. Auto-renewal configured by certbot's systemd
timer (`certbot.timer`).

Certificate path: `/etc/letsencrypt/live/ru.wheee.io/`

Verify renewal works:
```bash
ssh root@185.39.206.229 "certbot renew --dry-run"
```


## nginx Configuration Details

### Polish Server (`deploy/nginx.conf`)

Three server blocks:
1. **HTTP redirect** (port 80) → HTTPS for both `ru.wheee.io` and `api.wheee.io`
2. **`ru.wheee.io`** (port 443) — serves client static files from `/var/www/wheee`
   with SPA fallback to `index.html`
3. **`api.wheee.io`** (port 443) — reverse proxy to `app:3001` with WebSocket
   upgrade support on `/ws`

### Russian VPS (`deploy/nginx-ru.conf`)

Two server blocks:
1. **HTTP redirect** (port 80) → HTTPS
2. **`ru.wheee.io`** (port 443):
   - Static files from `/var/www/wheee` with SPA fallback
   - `/api/*` → proxied to `https://64.176.71.39:443/api/` with `Host: api.wheee.io`
   - `/ws` → proxied to `https://64.176.71.39:443/ws` with WebSocket upgrade headers

The proxy uses HTTPS to the Polish server (port 443, not 3001 directly) because
port 3001 is only exposed within the Docker network. Traffic flows:

```
Russian user → ru.wheee.io (RU VPS :443)
    → https://64.176.71.39:443 (Polish nginx, Host: api.wheee.io)
        → http://app:3001 (game server inside Docker)
```

### Updating Russian VPS nginx config

```bash
scp deploy/nginx-ru.conf root@185.39.206.229:/etc/nginx/sites-available/ru.wheee.io
ssh root@185.39.206.229 "nginx -t && systemctl reload nginx"
```


## Environment Variables

See `deploy/.env.example` for the full list. Key variables:

| Variable | Where | Purpose |
|----------|-------|---------|
| `PORT` | Server | HTTP/WS listen port (default: 3001) |
| `ALLOWED_ORIGINS` | Server | CORS origins (include both `wheee.io` and `ru.wheee.io`) |
| `VITE_API_URL` | Client build | API base URL (empty for same-origin) |
| `VITE_PLATFORM` | Client build | Target platform: `yandex`, `gamepush`, or empty |
| `VITE_GP_PROJECT_ID` | Client build | GamePush project ID (required for gamepush builds) |
| `VITE_GP_PUBLIC_TOKEN` | Client build | GamePush public token (required for gamepush builds) |
| `JWT_SECRET` | Server | Authentication token signing |
| `DB_PATH` | Server | SQLite database file path |
| `TG_BOT_TOKEN` | Server | Telegram Mini App authentication |
| `YANDEX_SECRET_KEY` | Server | Yandex Games player signature verification (optional) |
| `GOOGLE_CLIENT_ID/SECRET` | Server | Google OAuth |
| `GITHUB_CLIENT_ID/SECRET` | Server | GitHub OAuth |
| `AUTH_CALLBACK_URL` | Server | OAuth callback URL |
| `CLIENT_ORIGIN` | Server | Redirect target after OAuth |
| `COOKIE_DOMAIN` | Server | Shared cookie domain (`.wheee.io` for multi-subdomain auth) |

CORS for Yandex (`*.yandex.ru/com/net`) and GamePush (`*.gamepush.com`, `*.pikabu.ru`,
`*.eponesh.com`) origins are accepted dynamically via regex — no need to list them in
`ALLOWED_ORIGINS`.

### Deploy-local overrides (`deploy/.deploy.env`)

Git-ignored file for local VPS connection settings:

```bash
PL_VPS_HOST=64.176.71.39
PL_VPS_USER=root
RU_VPS_HOST=185.39.206.229
RU_VPS_USER=root
GP_PROJECT_ID=27646
GP_PUBLIC_TOKEN=j27miVT4RNJTTRXRGJj6AQxQfsl16rsA
```


## First-Time Russian VPS Setup

If setting up a new Russian VPS from scratch:

1. Buy VPS on [Timeweb Cloud](https://timeweb.cloud/vds-vps) — Ubuntu 24.04, Moscow
2. Update DNS: `ru.wheee.io` A record → VPS IP (DNS only in Cloudflare)
3. Wait for DNS propagation: `dig ru.wheee.io` should show VPS IP
4. Copy SSH key: `ssh-copy-id root@<VPS_IP>`
5. Run setup script:
   ```bash
   scp deploy/setup-ru-vps.sh root@<VPS_IP>:/tmp/
   ssh root@<VPS_IP> "bash /tmp/setup-ru-vps.sh"
   ```
6. Copy production nginx config:
   ```bash
   scp deploy/nginx-ru.conf root@<VPS_IP>:/etc/nginx/sites-available/ru.wheee.io
   ssh root@<VPS_IP> "nginx -t && systemctl reload nginx"
   ```
7. Deploy client: `bash deploy/deploy-ru.sh`


## Yandex Games Submission

### Build

```bash
bash deploy/deploy-yandex.sh
```

Produces `wheee-yandex.zip` at the project root (git-ignored).

### Requirements met

- Yandex Games SDK loaded via `<script src="/sdk.js">`
- `YaGames.init()` called; `LoadingAPI.ready()` signals load completion
- `GameplayAPI.start()` / `stop()` called at gameplay boundaries
- Authentication via `ysdk.auth.openAuthDialog()` + `getPlayer({ signed: true })`
- Server-side auth: signed player data sent to `/api/auth/yandex` for JWT issuance
- Fullscreen and rewarded ads supported (with 15s timeout safety)
- `game_api_pause` / `game_api_resume` events handled
- Audio muted on pause, unmuted on resume
- Language from `ysdk.environment.i18n.lang` (Russian/English UI)
- No external resources (Google Fonts stripped, Telegram SDK stripped)
- `user-select: none` globally, context menu disabled

### Console

Upload the zip at: https://games.yandex.ru/console

Add `api.wheee.io` to **External resources → Allowed domains** in the Yandex Games
Console for API/WebSocket access.


## GamePush (Pikabu Games) Submission

### Build

```bash
bash deploy/deploy-gamepush.sh
```

Produces `wheee-gamepush.zip` at the project root (git-ignored).

### SDK integration

- GamePush SDK loaded via `<script async>` with project ID and public token
- SDK initializes via `window.onGPInit` callback (10s timeout)
- `gp.player.ready` awaited before gameplay
- Authentication via `gp.player.login()` with server-side JWT issuance
- Fullscreen ads via `gp.ads.showFullscreen()` (15s timeout)
- Rewarded video via `gp.ads.showRewardedVideo()` (15s timeout)
- Pause/resume via `gp.ads.on('start'/'close')` + `visibilitychange`
- Language from `gp.language`

### Console

- GamePush panel: https://gamepush.com/panel
- Project ID: 27646
- Add `api.wheee.io` to **Allowed origins** in GamePush settings


## Troubleshooting

**Site not loading in Russia without VPN**
Check that `ru.wheee.io` DNS record is gray cloud (DNS only) in Cloudflare.
Cloudflare-proxied domains are blocked by ТСПУ.

**WebSocket not connecting from ru.wheee.io**
Verify the proxy chain works:
```bash
echo '{}' | websocat -1 wss://ru.wheee.io/ws
```
Should receive a JSON response from the game server.

**API returns 502 on ru.wheee.io**
The Polish server might be down. Check:
```bash
curl -s https://api.wheee.io/api/leaderboard/players?limit=1
```

**Google/GitHub OAuth not working on ru.wheee.io**
Ensure `COOKIE_DOMAIN=.wheee.io` is set in `.env`. Without it, cookies set during
OAuth on `api.wheee.io` won't be readable by `ru.wheee.io`. Also verify
`ALLOWED_ORIGINS` includes `https://ru.wheee.io`.

**SSL certificate expired on Russian VPS**
```bash
ssh root@185.39.206.229 "certbot renew && systemctl reload nginx"
```

**Need to force-rebuild Polish server (Docker cache issues)**
```bash
ssh root@64.176.71.39 "cd /opt/wheee/deploy && docker compose build --no-cache && docker compose up -d"
```

**Yandex/GamePush build includes Google Fonts / hreflang / Telegram SDK**
Make sure `VITE_PLATFORM` is not set in your shell environment from a previous run.
The env var persists across commands. Use a clean shell or explicitly unset it:
```bash
unset VITE_PLATFORM
```

**GamePush build fails with "must be set" error**
Ensure `VITE_GP_PROJECT_ID` and `VITE_GP_PUBLIC_TOKEN` are set. The `deploy-gamepush.sh`
script sets them automatically, but manual `vite build` with `VITE_PLATFORM=gamepush`
requires them explicitly.

**White screen on startup**
If `initPlatform()` fails (e.g. Yandex SDK not available, GamePush timeout), a
fallback error overlay with a Reload button is shown. Check the browser console for
`[init] Platform initialization failed:` errors.

**WebSocket reconnection stops after 20 attempts**
The client caps reconnection at 20 attempts with exponential backoff (500ms → 8s).
If the server is unreachable after 20 tries, the client stops reconnecting.
Refresh the page to retry.

**CORS errors on GamePush (s3.eponesh.com)**
The server dynamically allows origins matching `*.gamepush.com`, `*.pikabu.ru`, and
`*.eponesh.com`. If a new CDN domain appears, add it to `GAMEPUSH_ORIGIN_RE` in
`packages/server/src/index.ts` and `packages/server/src/auth/oauth.ts`.

**Platform auth returns 403 "Forbidden origin"**
The `/api/auth/yandex` and `/api/auth/gamepush` endpoints validate the `Origin`
header. Requests from unexpected origins are rejected. This is intentional — these
endpoints are only meant to be called from within platform iframes.

**`bun run deploy` hangs on prompt**
The deploy scripts detect non-interactive mode (`[[ -t 0 ]]`). When run via
`bun run`, stdin is piped, so interactive prompts are skipped with safe defaults:
uncommitted changes abort the deploy, unpushed commits trigger auto-push.
