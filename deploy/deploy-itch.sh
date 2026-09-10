#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLIENT_DIR="$PROJECT_ROOT/packages/client"

# The plain web adapter, marked as itch so analytics can tell the traffic apart,
# talking to the PL API across origins (CORS allows *.itch.zone).
echo "==> Building client for itch.io..."
cd "$CLIENT_DIR"
VITE_PLATFORM=itch \
  VITE_API_URL="https://api.wheee.io" \
  bunx vite build

echo "==> Stripping store artwork..."
bash "$SCRIPT_DIR/strip-store-assets.sh" "$CLIENT_DIR/dist"

echo "==> Creating archive..."
cd "$CLIENT_DIR/dist"
rm -f "$PROJECT_ROOT/wheee-itch.zip"
zip -r "$PROJECT_ROOT/wheee-itch.zip" . -x '*.DS_Store'

echo ""
echo "==> Done! Archive ready at: wheee-itch.zip"
echo "    Upload it on itch.io → Edit game → Uploads, tick \"This file will be played in the browser\""
