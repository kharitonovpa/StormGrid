#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Building and starting services..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d --build

echo "==> Done. Services:"
docker compose -f "$SCRIPT_DIR/docker-compose.yml" ps
