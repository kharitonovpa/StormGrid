#!/usr/bin/env bash
set -euo pipefail

# ── Configuration ─────────────────────────────────────────────
# Override via env: RU_VPS_HOST=1.2.3.4 bash deploy/deploy-ru.sh
RU_VPS_HOST="${RU_VPS_HOST:-185.39.206.229}"
RU_VPS_USER="${RU_VPS_USER:-root}"
REMOTE="$RU_VPS_USER@$RU_VPS_HOST"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLIENT_DIR="$PROJECT_ROOT/packages/client"

# ── Build client (same-origin API — no VITE_API_URL) ─────────
echo "==> Building client for ru.wheee.io (same-origin)..."
cd "$CLIENT_DIR"
VITE_API_URL="" bunx vite build

# ── Upload dist/ to Russian VPS ──────────────────────────────
echo "==> Uploading dist/ to $REMOTE:/var/www/wheee/ ..."
rsync -avz --delete --exclude='.DS_Store' "$CLIENT_DIR/dist/" "$REMOTE:/var/www/wheee/"

echo "==> Done! Static files deployed to Russian VPS."
