#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "==> Building Docker images..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" build

echo "==> Extracting client static files..."
CONTAINER_ID=$(docker create "$(docker compose -f "$SCRIPT_DIR/docker-compose.yml" images -q app 2>/dev/null || echo deploy-app)")
# Use multi-stage client target to extract the SPA build
docker build -t wheee-client --target client "$ROOT_DIR" \
  --build-arg VITE_API_URL="${VITE_API_URL:-https://api.wheee.io}"
EXTRACT_ID=$(docker create wheee-client)
rm -rf "$SCRIPT_DIR/client-dist"
docker cp "$EXTRACT_ID:/dist" "$SCRIPT_DIR/client-dist"
docker rm "$EXTRACT_ID" > /dev/null

echo "==> Starting services..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d

echo "==> Done. Services:"
docker compose -f "$SCRIPT_DIR/docker-compose.yml" ps
