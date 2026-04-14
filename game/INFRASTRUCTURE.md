# wheee Infrastructure & Deploy

## Overview

wheee runs on a two-server setup designed to serve both international and Russian
users from a single game server while bypassing Russian DPI (ТСПУ) filtering.

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
├── nginx.conf           # Polish server nginx: ru.wheee.io static + api.wheee.io proxy
├── nginx-ru.conf        # Russian VPS nginx: static + /api/ + /ws proxy to Poland
├── deploy.sh            # Polish server deploy: docker compose up --build
├── deploy-ru.sh         # Russian VPS deploy: vite build + rsync dist/
├── setup-ru-vps.sh      # One-time Russian VPS provisioning (nginx, certbot, SSL)
└── .env.example         # Environment variables template
```


## Deploy Procedures

### Polish Server (main game server)

SSH into `root@64.176.71.39`, then:

```bash
cd /opt/wheee
git pull
cd deploy
bash deploy.sh
```

This runs `docker compose up -d --build` which:
1. Builds the server (`packages/server`) with Bun
2. Builds the client (`packages/client`) with Vite (`VITE_API_URL=https://api.wheee.io`)
3. Copies client dist into nginx container
4. Restarts both `app` and `nginx` containers

The client build on the Polish server points to `api.wheee.io` for API/WS — this is
used by `wheee.io` (international users via Cloudflare Pages).

### Russian VPS (reverse proxy)

From your local machine (requires SSH key on VPS):

```bash
cd deploy
bash deploy-ru.sh
```

Or with explicit host:

```bash
RU_VPS_HOST=185.39.206.229 bash deploy/deploy-ru.sh
```

This:
1. Builds client with `VITE_API_URL=""` — the client uses `location.hostname`
   (same-origin), so API calls go to `ru.wheee.io/api/*` and WebSocket connects
   to `wss://ru.wheee.io/ws`
2. Rsyncs `dist/` to `root@185.39.206.229:/var/www/wheee/`

**Important**: The Russian VPS client build is separate from the Polish one because
it must use same-origin API routing (not `api.wheee.io`, which is blocked in Russia).

### When to deploy where

| Change | Polish server | Russian VPS |
|--------|:------------:|:-----------:|
| Server code (engine, API, WS) | Yes | No |
| Client code (Vue, Three.js) | Yes | Yes |
| Shared types | Yes | Yes |
| nginx config (Polish) | Yes | No |
| nginx config (Russian) | No | scp + reload |

After client changes, always deploy to **both** servers:

```bash
# Polish
ssh root@64.176.71.39 "cd /opt/wheee && git pull && cd deploy && bash deploy.sh"

# Russian
bash deploy/deploy-ru.sh
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


## Client Build Variants

The client uses `VITE_API_URL` to determine where to send API/WS requests:

```typescript
// packages/client/src/lib/config.ts
export const API_BASE = dev
  ? `${location.protocol}//${location.hostname}:3001`
  : (import.meta.env.VITE_API_URL || `${location.protocol}//${location.hostname}`)

export const WS_URL = API_BASE.replace(/^http/, 'ws') + '/ws'
```

| Build target | VITE_API_URL | API_BASE resolves to | WS_URL resolves to |
|-------------|--------------|---------------------|--------------------|
| Polish (docker-compose) | `https://api.wheee.io` | `https://api.wheee.io` | `wss://api.wheee.io/ws` |
| Russian VPS (deploy-ru.sh) | `""` (empty) | `https://ru.wheee.io` | `wss://ru.wheee.io/ws` |
| Local dev | — (DEV=true) | `http://localhost:3001` | `ws://localhost:3001/ws` |


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


## Environment Variables

See `deploy/.env.example` for the full list. Key variables:

| Variable | Where | Purpose |
|----------|-------|---------|
| `PORT` | Server | HTTP/WS listen port (default: 3001) |
| `ALLOWED_ORIGINS` | Server | CORS origins (include both `wheee.io` and `ru.wheee.io`) |
| `VITE_API_URL` | Client build | API base URL (empty for same-origin) |
| `JWT_SECRET` | Server | Authentication token signing |
| `DB_PATH` | Server | SQLite database file path |
| `TG_BOT_TOKEN` | Server | Telegram Mini App authentication |
| `GOOGLE_CLIENT_ID/SECRET` | Server | Google OAuth |
| `GITHUB_CLIENT_ID/SECRET` | Server | GitHub OAuth |
| `AUTH_CALLBACK_URL` | Server | OAuth callback URL |
| `CLIENT_ORIGIN` | Server | Redirect target after OAuth |


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

**SSL certificate expired on Russian VPS**  
```bash
ssh root@185.39.206.229 "certbot renew && systemctl reload nginx"
```

**Need to force-rebuild Polish server (Docker cache issues)**  
```bash
ssh root@64.176.71.39 "cd /opt/wheee/deploy && docker compose build --no-cache && docker compose up -d"
```
