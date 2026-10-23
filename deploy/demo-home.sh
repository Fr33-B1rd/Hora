#!/usr/bin/env bash
# Build or update the judges' demo assistant: a second Hermes home next to the owner's,
# with Hora's persona and tools, the fictional Maria Lind profile, a stand-in calendar
# and no Telegram. Nothing of the owner's (memory, CV, calendar, chats) is copied.
# Needs no sudo; deploy/demo-on.sh runs it and then adds the services and the site.
#
#   bash deploy/demo-home.sh https://demo.34-51-186-249.sslip.io
set -euo pipefail

origin="${1:?usage: bash deploy/demo-home.sh <demo site origin, e.g. https://demo.example.sslip.io>}"
project="$(cd "$(dirname "$0")/.." && pwd)"
owner_home="$HOME/.hermes"
demo_home="${DEMO_HERMES_HOME:-$HOME/.hermes-demo}"
data="${DEMO_DATA_DIR:-$HOME/daylight-demo-data}"
agent_port="${DEMO_AGENT_PORT:-8643}" web_port="${DEMO_WEB_PORT:-4319}"
hermes="$project/scripts/hermes.sh"
[ -f "$project/.env" ] || { echo "Run deploy/setup-vm.sh first: $project/.env is missing." >&2; exit 1; }
node="$(ls -d "$owner_home"/tools/node-*/bin/node 2>/dev/null | sort -V | tail -1 || true)"
[ -n "$node" ] || { echo "Hermes's bundled Node was not found under $owner_home/tools." >&2; exit 1; }

mkdir -p "$demo_home" "$data"; chmod 700 "$demo_home" "$data"
[ -e "$demo_home/tools" ] || ln -s "$owner_home/tools" "$demo_home/tools"   # Hermes's bundled Node and Python, shared
# The model and tool settings, not the owner's data: config.yaml holds no memory, chats or keys,
# but its `platforms:` block names the owner's Telegram chat, so that block is removed every time.
[ -f "$demo_home/config.yaml" ] || cp "$owner_home/config.yaml" "$demo_home/config.yaml"
python3 - "$demo_home/config.yaml" <<'PY'
import re, sys
path = sys.argv[1]
text = open(path, encoding="utf-8").read()
text = re.sub(r"^platforms:\n(?:[ \t].*\n|\n)*", "", text, flags=re.M)   # up to the next top-level key
open(path, "w", encoding="utf-8").write(text)
PY
! grep -qE "^platforms:" "$demo_home/config.yaml" || { echo "Could not remove the Telegram settings from the demo's config.yaml." >&2; exit 1; }

# The demo's own settings. The project's .env is read first for the model and Maps keys;
# these lines come after it and win. A real environment variable would beat both.
key_file="$demo_home/demo.env"
key="$(grep -E '^HERMES_API_KEY=' "$key_file" 2>/dev/null | cut -d= -f2- || true)"
[ -n "$key" ] || key="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
cat > "$key_file" <<EOF
# The judges' demo instance. Written by deploy/demo-home.sh; re-running it rewrites this file.
HERMES_HOME=$demo_home
DAYLIGHT_HERMES_HOME=$demo_home
DAYLIGHT_DATA_DIR=$data
DAYLIGHT_PUBLIC_ORIGIN=$origin
PORT=$web_port
HERMES_API_URL=http://127.0.0.1:$agent_port
HERMES_API_KEY=$key
# A stand-in Google Calendar kept in $data/provider.json; every other request goes out as usual.
DAYLIGHT_TEST_PROVIDERS=1
DAYLIGHT_TEST_PASSTHROUGH=1
GOOGLE_CLIENT_ID=demo-stand-in
GOOGLE_CLIENT_SECRET=demo-stand-in
TELEGRAM_ALLOWED_USERS=
EOF
chmod 600 "$key_file"

# Hermes's own settings for this home: its local API on another port, and no Telegram.
touch "$demo_home/.env"; chmod 600 "$demo_home/.env"
python3 - "$demo_home/.env" "$key" "$agent_port" <<'PY'
import sys
path, key, port = sys.argv[1:4]
keep = [l for l in open(path, encoding="utf-8").read().splitlines()
        if not l.startswith(("API_SERVER_ENABLED=", "API_SERVER_KEY=", "API_SERVER_PORT=", "TELEGRAM_"))]
open(path, "w", encoding="utf-8").write("\n".join(keep + ["API_SERVER_ENABLED=true", "API_SERVER_KEY=" + key, "API_SERVER_PORT=" + port]) + "\n")
PY

export HERMES_HOME="$demo_home"
bash "$hermes" config set HERMES_TIMEZONE Europe/Stockholm | tail -n 1
bash "$hermes" config set model.provider nebius | tail -n 1
bash "$hermes" config set model.default "$(grep -E '^NEBIUS_MODEL=' "$project/.env" | cut -d= -f2- | tr -d '\r"')" | tail -n 1
# Hora's tools, reading the demo's settings and calendar instead of the owner's.
bash "$hermes" mcp remove daylight >/dev/null 2>&1 <<<"y" || true
bash "$hermes" mcp add daylight --connect-timeout 30 --command "$node" \
  --args "--env-file=$project/.env" "--env-file=$key_file" --import "file://$project/tests/calendar-provider.mjs" "$project/mcp/planner-server.mjs" <<<"y" | tail -n 2
HERMES_BIN="$hermes" bash "$project/hermes/install.sh" --deliver local
"$node" "$project/deploy/demo/seed.mjs" "$demo_home" "$data"
echo "Demo home ready: $demo_home (assistant on 127.0.0.1:$agent_port, page on 127.0.0.1:$web_port)"
