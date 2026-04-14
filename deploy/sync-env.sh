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
PL_ENV_PATH="/opt/wheee/deploy/.env"

EXAMPLE="$SCRIPT_DIR/.env.example"
TMPDIR_SYNC="$(mktemp -d)"
REMOTE_ENV="$TMPDIR_SYNC/remote.env"
PATCHED_ENV="$TMPDIR_SYNC/patched.env"

trap 'rm -rf "$TMPDIR_SYNC"' EXIT

if [[ ! -f "$EXAMPLE" ]]; then
  echo "ERROR: $EXAMPLE not found" >&2
  exit 1
fi

# ── Download current .env from PL VPS ────────────────────────
echo "==> Downloading .env from $PL_REMOTE:$PL_ENV_PATH ..."
if ! scp -q "$PL_REMOTE:$PL_ENV_PATH" "$REMOTE_ENV" 2>/dev/null; then
  echo "    Remote .env not found — will create from scratch"
  touch "$REMOTE_ENV"
fi

# ── Find missing keys ────────────────────────────────────────
missing=()
while IFS= read -r line; do
  [[ -z "$line" || "$line" =~ ^# ]] && continue
  key="${line%%=*}"
  if ! grep -q "^${key}=" "$REMOTE_ENV" 2>/dev/null; then
    missing+=("$key")
  fi
done < "$EXAMPLE"

if [[ ${#missing[@]} -eq 0 ]]; then
  echo "==> All keys from .env.example are present on the server. Nothing to sync."
  exit 0
fi

# ── Build patched .env ───────────────────────────────────────
cp "$REMOTE_ENV" "$PATCHED_ENV"

echo "" >> "$PATCHED_ENV"
echo "# --- Added by sync-env $(date +%Y-%m-%d) ---" >> "$PATCHED_ENV"

for key in "${missing[@]}"; do
  # Grab comment line above the key in .env.example for context
  comment=$(grep -B1 "^${key}=" "$EXAMPLE" | head -1)
  if [[ "$comment" =~ ^# ]]; then
    echo "$comment" >> "$PATCHED_ENV"
  fi
  echo "${key}=" >> "$PATCHED_ENV"
done

# ── Show diff ────────────────────────────────────────────────
echo ""
echo "==> Missing keys that will be added (with empty values):"
echo ""
for key in "${missing[@]}"; do
  echo "    + $key"
done
echo ""

if [[ "${AUTO_CONFIRM:-}" != "1" ]]; then
  if [[ -t 0 ]]; then
    read -rp "Upload patched .env to $PL_REMOTE? [y/N] " answer
    if [[ "$answer" != "y" && "$answer" != "Y" ]]; then
      echo "Aborted."
      exit 0
    fi
  else
    echo "    (non-interactive mode — skipping upload, run sync-env.sh manually)"
    exit 0
  fi
fi

# ── Upload ───────────────────────────────────────────────────
echo "==> Uploading patched .env to $PL_REMOTE:$PL_ENV_PATH ..."
scp -q "$PATCHED_ENV" "$PL_REMOTE:$PL_ENV_PATH"

echo "==> Done! Don't forget to fill in the empty values on the server:"
echo "    ssh $PL_REMOTE \"nano $PL_ENV_PATH\""
