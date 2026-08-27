#!/usr/bin/env bash
#
# Set the app's cover image — the picture on the invite card that shareLink()
# drops into a channel. The portal calls it Rich Presence → "Иллюстрация для
# приглашения" → Обложка; the API calls it the application's cover_image.
#
# ⚠️ This needs a BOT token, unlike scripts/discord-entry-point.sh. Tried on
# 2026-08-27 with a client-credentials bearer — the one that is enough to patch
# application commands — and the API answers 401 Unauthorized. Editing the
# application object is bot-token-only. So either press "Reset Token" in the
# portal and pass it as DISCORD_BOT_TOKEN, or just drag the file into the
# portal by hand, which is a minute of work and touches nothing else.
#
# Credentials are otherwise read the same way discord-entry-point.sh reads them.
#
# Usage: bash scripts/discord-app-cover.sh [path-to-1024x576-image]
set -euo pipefail

IMG="${1:-marketing/discord-directory/assets/cover-1024x576.png}"
VPS="${PL_VPS_USER:-root}@${PL_VPS_HOST:-64.176.74.237}"
API=https://discord.com/api/v10

[[ -f "$IMG" ]] || { echo "!! no such file: $IMG" >&2; exit 1; }
echo "==> Image: $IMG ($(wc -c < "$IMG") bytes)"

if [[ -z "${DISCORD_CLIENT_ID:-}" || -z "${DISCORD_CLIENT_SECRET:-}" ]]; then
  creds="$(ssh -o ConnectTimeout=20 "$VPS" "grep -E '^DISCORD_CLIENT_(ID|SECRET)=' /opt/wheee/deploy/.env")"
  DISCORD_CLIENT_ID="$(printf '%s\n' "$creds" | sed -n 's/^DISCORD_CLIENT_ID=//p' | tr -d "\"'\r")"
  DISCORD_CLIENT_SECRET="$(printf '%s\n' "$creds" | sed -n 's/^DISCORD_CLIENT_SECRET=//p' | tr -d "\"'\r")"
  unset creds
fi

if [[ -n "${DISCORD_BOT_TOKEN:-}" ]]; then
  AUTH="Bot $DISCORD_BOT_TOKEN"
else
  echo "    (no DISCORD_BOT_TOKEN — trying a client-credentials bearer, which is expected to 401)"
  TOKEN="$(curl -sS -u "$DISCORD_CLIENT_ID:$DISCORD_CLIENT_SECRET" \
    -d grant_type=client_credentials -d scope=applications.commands.update \
    -X POST "$API/oauth2/token" \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("access_token") or sys.exit(str(d)))')"
  AUTH="Bearer $TOKEN"
fi

BODY="$(IMG="$IMG" python3 -c '
import base64, json, os, mimetypes
p = os.environ["IMG"]
mime = mimetypes.guess_type(p)[0] or "image/png"
with open(p, "rb") as fh:
    data = base64.b64encode(fh.read()).decode()
print(json.dumps({"cover_image": f"data:{mime};base64,{data}"}))')"

echo "==> PATCH /applications/@me (cover_image)"
printf '%s' "$BODY" | curl -sS -X PATCH \
  -H "Authorization: $AUTH" -H "Content-Type: application/json" \
  --data-binary @- "$API/applications/@me" \
  | python3 -c '
import sys, json
d = json.load(sys.stdin)
if "cover_image" in d:
    print("    OK — cover_image now:", d["cover_image"])
else:
    print("    REFUSED:", json.dumps(d, ensure_ascii=False)[:400])
    print("    → upload it by hand instead: Developer Portal → Rich Presence → Art Assets → Обложка")
    sys.exit(2)'
