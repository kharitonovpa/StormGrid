#!/usr/bin/env bash
#
# Set the description of the Activity's Entry Point command ("Launch").
#
# Discord creates that command for you the moment Activities are enabled, with
# a generic description, and it is the line a player reads in the App Launcher
# before deciding whether to open the game. The portal has no field for it —
# it is only reachable over the API.
#
# No bot token is involved. Application commands can be updated with a Bearer
# token from the client-credentials grant, which needs nothing but the app's
# own client id and secret — the pair already sitting in deploy/.env. That
# avoids resetting the bot token, which would be the more invasive way in.
#
# Texts live in marketing/discord-directory/COPY.md; keep the two in step.
#
# Usage:
#   bash scripts/discord-entry-point.sh            # read creds from the VPS
#   bash scripts/discord-entry-point.sh --dry-run  # show what would change
#
#   DISCORD_CLIENT_ID=… DISCORD_CLIENT_SECRET=… bash scripts/discord-entry-point.sh
#     — skips the VPS entirely and uses what you pass in.
set -euo pipefail

VPS="${PL_VPS_USER:-root}@${PL_VPS_HOST:-64.176.74.237}"
ENV_PATH=/opt/wheee/deploy/.env
API=https://discord.com/api/v10

DESC_EN="Start a 1–3 minute storm duel — auto-matched with whoever's in your voice channel."
DESC_RU="Штормовая дуэль на 1–3 минуты — соперник найдётся прямо в вашем голосовом канале."

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

# ── Credentials ─────────────────────────────────────────────
# Never echoed. If they are not in the environment already, they are read
# straight off the server the same way deploy/sync-env.sh reads that file.
if [[ -z "${DISCORD_CLIENT_ID:-}" || -z "${DISCORD_CLIENT_SECRET:-}" ]]; then
  echo "==> Reading client id/secret from $VPS:$ENV_PATH"
  creds="$(ssh -o ConnectTimeout=20 "$VPS" "grep -E '^DISCORD_CLIENT_(ID|SECRET)=' $ENV_PATH")"
  DISCORD_CLIENT_ID="$(printf '%s\n' "$creds" | sed -n 's/^DISCORD_CLIENT_ID=//p' | tr -d "\"'\r")"
  DISCORD_CLIENT_SECRET="$(printf '%s\n' "$creds" | sed -n 's/^DISCORD_CLIENT_SECRET=//p' | tr -d "\"'\r")"
  unset creds
fi

if [[ -z "$DISCORD_CLIENT_ID" || -z "$DISCORD_CLIENT_SECRET" ]]; then
  echo "!! Missing DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET." >&2
  exit 1
fi
echo "    app id: $DISCORD_CLIENT_ID"

# ── Bearer token ────────────────────────────────────────────
echo "==> Requesting a client-credentials token (scope applications.commands.update)"
TOKEN="$(curl -sS -u "$DISCORD_CLIENT_ID:$DISCORD_CLIENT_SECRET" \
  -d grant_type=client_credentials -d scope=applications.commands.update \
  -X POST "$API/oauth2/token" \
  | python3 -c 'import sys,json
d=json.load(sys.stdin)
if "access_token" not in d:
    sys.exit("token request failed: %s" % d)
print(d["access_token"])')"
echo "    got a bearer token"

# ── Find the Entry Point command ────────────────────────────
# Type 4 is PRIMARY_ENTRY_POINT. There is at most one per application.
echo "==> Looking up the Entry Point command"
CMD_JSON="$(curl -sS -H "Authorization: Bearer $TOKEN" "$API/applications/$DISCORD_CLIENT_ID/commands")"

CMD_ID="$(printf '%s' "$CMD_JSON" | python3 -c 'import sys,json
cmds=json.load(sys.stdin)
if isinstance(cmds,dict): sys.exit("API error: %s" % cmds)
ep=[c for c in cmds if c.get("type")==4]
if not ep: sys.exit("no PRIMARY_ENTRY_POINT command found — is Activities enabled?")
print(ep[0]["id"])')"

printf '%s' "$CMD_JSON" | python3 -c 'import sys,json
for c in json.load(sys.stdin):
    if c.get("type")==4:
        print("    name        :", c.get("name"))
        print("    id          :", c["id"])
        print("    handler     :", c.get("handler"))
        print("    description : %r" % c.get("description"))
        print("    ru          : %r" % (c.get("description_localizations") or {}).get("ru"))'

if $DRY_RUN; then
  echo ""
  echo "-- dry run, would PATCH command $CMD_ID with --"
  echo "   en: $DESC_EN"
  echo "   ru: $DESC_RU"
  exit 0
fi

# ── Patch ───────────────────────────────────────────────────
echo "==> Patching description (en + ru)"
BODY="$(DESC_EN="$DESC_EN" DESC_RU="$DESC_RU" python3 -c 'import json,os
print(json.dumps({
  "description": os.environ["DESC_EN"],
  "description_localizations": {"ru": os.environ["DESC_RU"]},
}, ensure_ascii=False))')"

RESULT="$(curl -sS -X PATCH \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "$BODY" "$API/applications/$DISCORD_CLIENT_ID/commands/$CMD_ID")"

printf '%s' "$RESULT" | python3 -c 'import sys,json
d=json.load(sys.stdin)
if "id" not in d: sys.exit("PATCH failed: %s" % d)
print("    description :", d.get("description"))
print("    ru          :", (d.get("description_localizations") or {}).get("ru"))
print("")
print("Done. The App Launcher card can take a few minutes to pick this up.")'
