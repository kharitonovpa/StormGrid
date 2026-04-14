#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLIENT_DIR="$PROJECT_ROOT/packages/client"

if [[ -f "$SCRIPT_DIR/.deploy.env" ]]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/.deploy.env"
fi

GP_PROJECT_ID="${GP_PROJECT_ID:-27646}"
GP_PUBLIC_TOKEN="${GP_PUBLIC_TOKEN:-j27miVT4RNJTTRXRGJj6AQxQfsl16rsA}"

echo "==> Building client for GamePush (Pikabu Games)..."
cd "$CLIENT_DIR"
VITE_PLATFORM=gamepush \
  VITE_API_URL="https://api.wheee.io" \
  VITE_GP_PROJECT_ID="$GP_PROJECT_ID" \
  VITE_GP_PUBLIC_TOKEN="$GP_PUBLIC_TOKEN" \
  bunx vite build

echo "==> Creating archive..."
cd "$CLIENT_DIR/dist"
rm -f "$PROJECT_ROOT/wheee-gamepush.zip"
zip -r "$PROJECT_ROOT/wheee-gamepush.zip" . -x '*.DS_Store'

echo ""
echo "==> Done! Archive ready at: wheee-gamepush.zip"
echo "    Upload it to GamePush panel → Settings → Source code"
