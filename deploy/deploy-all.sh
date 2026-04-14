#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Load local overrides if present ──────────────────────────
if [[ -f "$SCRIPT_DIR/.deploy.env" ]]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/.deploy.env"
fi

export PL_VPS_HOST="${PL_VPS_HOST:-64.176.71.39}"
export PL_VPS_USER="${PL_VPS_USER:-root}"
export RU_VPS_HOST="${RU_VPS_HOST:-185.39.206.229}"
export RU_VPS_USER="${RU_VPS_USER:-root}"

# ── Parse flags ──────────────────────────────────────────────
DO_ENV=false
DO_SERVER=false
DO_RU=false
DO_ARCHIVES=false
ALL=true

for arg in "$@"; do
  case "$arg" in
    --env-only)  DO_ENV=true;     ALL=false ;;
    --server)    DO_SERVER=true;   ALL=false ;;
    --ru)        DO_RU=true;       ALL=false ;;
    --archives)  DO_ARCHIVES=true; ALL=false ;;
    --help|-h)
      echo "Usage: deploy-all.sh [--server] [--ru] [--archives] [--env-only]"
      echo ""
      echo "  --env-only   Only sync .env to Polish VPS"
      echo "  --server     Deploy server on Polish VPS (env sync + git pull + docker compose)"
      echo "  --ru         Deploy static files to Russian VPS"
      echo "  --archives   Build Yandex + GamePush archives"
      echo ""
      echo "  No flags = do everything in order"
      exit 0
      ;;
    *)
      echo "Unknown flag: $arg (use --help)" >&2
      exit 1
      ;;
  esac
done

if $ALL; then
  DO_ENV=true
  DO_SERVER=true
  DO_RU=true
  DO_ARCHIVES=true
fi

FAILED=0
STEPS=()
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Helpers ──────────────────────────────────────────────────
is_interactive() { [[ -t 0 ]]; }

prompt_yn() {
  local msg="$1" default="$2"
  if ! is_interactive; then
    [[ "$default" == "y" ]] && return 0 || return 1
  fi
  read -rp "$msg " answer
  if [[ "$default" == "y" ]]; then
    [[ "$answer" == "n" || "$answer" == "N" ]] && return 1 || return 0
  else
    [[ "$answer" == "y" || "$answer" == "Y" ]] && return 0 || return 1
  fi
}

# ── Pre-flight: git checks ──────────────────────────────────
if $DO_SERVER || $DO_RU || $DO_ARCHIVES || $ALL; then
  cd "$PROJECT_ROOT"

  if [[ -n "$(git status --porcelain)" ]]; then
    echo ""
    echo "WARNING: You have uncommitted changes:"
    git status --short
    echo ""
    if ! prompt_yn "Continue anyway? [y/N]" "n"; then
      echo "Aborted. Commit or stash your changes first."
      exit 1
    fi
  fi

  if $DO_SERVER; then
    LOCAL_HEAD="$(git rev-parse HEAD)"
    REMOTE_HEAD="$(git rev-parse '@{upstream}' 2>/dev/null || echo "")"
    if [[ -n "$REMOTE_HEAD" && "$LOCAL_HEAD" != "$REMOTE_HEAD" ]]; then
      AHEAD="$(git rev-list '@{upstream}..HEAD' --count 2>/dev/null || echo "?")"
      echo ""
      echo "WARNING: Local branch is $AHEAD commit(s) ahead of remote."
      echo "         The server will git pull — it won't see unpushed commits."
      echo ""
      if prompt_yn "Push now before deploying? [Y/n]" "y"; then
        echo "==> Pushing..."
        git push
        echo ""
      fi
    fi
  fi
fi

# ── 1. Sync .env ────────────────────────────────────────────
if $DO_ENV || $DO_SERVER; then
  echo ""
  echo "═══════════════════════════════════════════════════"
  echo "  Step 1: Sync .env to Polish VPS"
  echo "═══════════════════════════════════════════════════"
  if AUTO_CONFIRM=1 bash "$SCRIPT_DIR/sync-env.sh"; then
    STEPS+=("env-sync: OK")
  else
    STEPS+=("env-sync: FAILED")
    FAILED=1
  fi
fi

if $DO_ENV && ! $DO_SERVER && ! $DO_RU && ! $DO_ARCHIVES; then
  # --env-only: stop here
  printf '\n'; printf '%s\n' "${STEPS[@]}"; exit $FAILED
fi

# ── 2. Deploy server (Polish VPS) ───────────────────────────
if $DO_SERVER; then
  echo ""
  echo "═══════════════════════════════════════════════════"
  echo "  Step 2: Deploy server on Polish VPS"
  echo "═══════════════════════════════════════════════════"
  if bash "$SCRIPT_DIR/deploy.sh"; then
    STEPS+=("server-pl: OK")
  else
    STEPS+=("server-pl: FAILED")
    FAILED=1
  fi
fi

# ── 3. Deploy static (Russian VPS) ──────────────────────────
if $DO_RU; then
  echo ""
  echo "═══════════════════════════════════════════════════"
  echo "  Step 3: Deploy static to Russian VPS"
  echo "═══════════════════════════════════════════════════"
  if bash "$SCRIPT_DIR/deploy-ru.sh"; then
    STEPS+=("static-ru: OK")
  else
    STEPS+=("static-ru: FAILED")
    FAILED=1
  fi
fi

# ── 4. Build archives ───────────────────────────────────────
if $DO_ARCHIVES; then
  echo ""
  echo "═══════════════════════════════════════════════════"
  echo "  Step 4a: Build Yandex Games archive"
  echo "═══════════════════════════════════════════════════"
  if bash "$SCRIPT_DIR/deploy-yandex.sh"; then
    STEPS+=("yandex-zip: OK")
  else
    STEPS+=("yandex-zip: FAILED")
    FAILED=1
  fi

  echo ""
  echo "═══════════════════════════════════════════════════"
  echo "  Step 4b: Build GamePush archive"
  echo "═══════════════════════════════════════════════════"
  if bash "$SCRIPT_DIR/deploy-gamepush.sh"; then
    STEPS+=("gamepush-zip: OK")
  else
    STEPS+=("gamepush-zip: FAILED")
    FAILED=1
  fi
fi

# ── Summary ──────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo "  Deploy summary"
echo "═══════════════════════════════════════════════════"
for s in "${STEPS[@]}"; do
  echo "  $s"
done
echo ""

if [[ $FAILED -eq 0 ]]; then
  echo "All steps completed successfully."
else
  echo "Some steps failed — check output above." >&2
fi

exit $FAILED
