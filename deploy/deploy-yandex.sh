#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLIENT_DIR="$PROJECT_ROOT/packages/client"

echo "==> Building client for Yandex Games..."
cd "$CLIENT_DIR"
VITE_PLATFORM=yandex VITE_API_URL="https://api.wheee.io" bunx vite build

echo "==> Creating archive..."
cd "$CLIENT_DIR/dist"
rm -f "$PROJECT_ROOT/wheee-yandex.zip"
zip -r "$PROJECT_ROOT/wheee-yandex.zip" . -x '*.DS_Store'

echo ""
echo "==> Done! Archive ready at: wheee-yandex.zip"
echo "    Upload it to Yandex Games Console: https://games.yandex.ru/console"
