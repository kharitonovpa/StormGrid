#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Load local overrides if present ──────────────────────────
if [[ -f "$SCRIPT_DIR/.deploy.env" ]]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/.deploy.env"
fi

PL_VPS_HOST="${PL_VPS_HOST:-64.176.71.39}"
PL_VPS_USER="${PL_VPS_USER:-root}"
PL_REMOTE="$PL_VPS_USER@$PL_VPS_HOST"
PL_PROJECT_DIR="/opt/wheee"

echo "==> Deploying server on Polish VPS ($PL_REMOTE)..."
echo "    git pull + docker compose up --build"

ssh "$PL_REMOTE" bash -s <<REMOTE_SCRIPT
  set -euo pipefail
  cd "$PL_PROJECT_DIR"
  echo "--- git pull ---"
  git pull --ff-only
  echo "--- docker compose build + restart ---"
  cd deploy
  docker compose up -d --build
  echo "--- services ---"
  docker compose ps
REMOTE_SCRIPT

echo "==> Server deployed on Polish VPS."
