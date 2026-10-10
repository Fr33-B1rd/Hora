#!/usr/bin/env bash
# Set up Daylight on a fresh Ubuntu 24.04 VM: Hermes Agent, the web server, and an
# HTTPS proxy with a password in front. Run as your normal user (it uses sudo):
#
#   bash deploy/setup-vm.sh 34-51-186-249.sslip.io
#
# Safe to re-run. The first run stops after creating .env so you can paste your
# keys into it on the VM; run it again afterwards. Nothing listens publicly
# except the proxy on ports 80 and 443.
set -euo pipefail

host="${1:-}"
[ -n "$host" ] || { echo "usage: bash deploy/setup-vm.sh <public-hostname>   e.g. 34-51-186-249.sslip.io" >&2; exit 2; }
project="$(cd "$(dirname "$0")/.." && pwd)"
me="$(id -un)"
hermes_home="$HOME/.hermes"
say() { printf '\n== %s\n' "$*"; }

say "1/7 System packages"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl git python3 caddy >/dev/null
echo "curl, git, python3 $(python3 -c 'import sys;print(".".join(map(str,sys.version_info[:3])))'), caddy $(caddy version | cut -d' ' -f1)"

say "2/7 Hermes Agent"
if [ -x "$HOME/.local/bin/hermes" ]; then
  echo "already installed: $("$HOME/.local/bin/hermes" --version 2>/dev/null | head -1)"
else
  mkdir -p "$HOME/hermes-installer"
  curl -fsSL https://hermes-agent.nousresearch.com/install.sh -o "$HOME/hermes-installer/install.sh"
  bash "$HOME/hermes-installer/install.sh" --non-interactive --skip-browser --skip-computer-use
fi
node="$(ls -d "$hermes_home"/tools/node-*/bin/node 2>/dev/null | sort -V | tail -1 || true)"
[ -n "$node" ] || { echo "Hermes's bundled Node was not found under $hermes_home/tools; cannot continue." >&2; exit 1; }
echo "node: $("$node" --version) (Hermes's own, used for the web server too)"

say "3/7 Keys"
env_file="$project/.env"
if [ ! -f "$env_file" ]; then
  key="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
  cat > "$env_file" <<EOF
# Paste your keys after the = signs. This file stays on this machine.
NEBIUS_API_KEY=
NEBIUS_BASE_URL=https://api.tokenfactory.us-central1.nebius.com/v1
NEBIUS_MODEL=nvidia/nemotron-3-super-120b-a12b

# Day planner: server key (Places API (New) + Routes API) and a separate browser key (Maps JavaScript API)
GOOGLE_MAPS_API_KEY=
GOOGLE_MAPS_BROWSER_KEY=

# Calendar (optional): leave empty to run without it
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Set by the setup script; no need to change
PORT=4318
DAYLIGHT_PUBLIC_ORIGIN=https://$host
GOOGLE_REDIRECT_URI=https://$host/api/google/callback
HERMES_API_URL=http://127.0.0.1:8642
HERMES_API_KEY=$key
EOF
  chmod 600 "$env_file"
  cat <<EOF
Created $env_file

Now paste your keys into it, here on the VM:

    nano $env_file

NEBIUS_API_KEY is required. The Google keys are needed for the day planner and
its map. Save with Ctrl+O, Enter, then exit with Ctrl+X, and run this script again.
EOF
  exit 0
fi
chmod 600 "$env_file"
value() { grep -E "^$1=" "$env_file" | tail -1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//"; }
[ -n "$(value NEBIUS_API_KEY)" ] || { echo "NEBIUS_API_KEY is still empty in $env_file. Fill it in and run this again." >&2; exit 1; }
for name in GOOGLE_MAPS_API_KEY GOOGLE_MAPS_BROWSER_KEY GOOGLE_CLIENT_ID; do [ -n "$(value "$name")" ] || echo "note: $name is empty"; done
# Keep the public address in step with the hostname given now.
sed -i -e "s|^DAYLIGHT_PUBLIC_ORIGIN=.*|DAYLIGHT_PUBLIC_ORIGIN=https://$host|" -e "s|^GOOGLE_REDIRECT_URI=.*|GOOGLE_REDIRECT_URI=https://$host/api/google/callback|" "$env_file"
api_key="$(value HERMES_API_KEY)"
[ -n "$api_key" ] || { echo "HERMES_API_KEY is missing from $env_file; delete the file and run this again to regenerate it." >&2; exit 1; }
echo "keys present; .env is readable by $me only"

say "4/7 Hermes configuration"
hermes="$project/scripts/hermes.sh"
chmod +x "$hermes"  # an archive made on Windows does not carry the executable flag
mkdir -p "$hermes_home"; touch "$hermes_home/.env"; chmod 600 "$hermes_home/.env"
# The local API the web server talks to: loopback only, same key on both sides.
python3 - "$hermes_home/.env" "$api_key" <<'PY'
import sys
path, key = sys.argv[1], sys.argv[2]
lines = [l for l in open(path, encoding="utf-8").read().splitlines() if not l.startswith(("API_SERVER_ENABLED=", "API_SERVER_KEY="))]
lines += ["API_SERVER_ENABLED=true", "API_SERVER_KEY=" + key]
open(path, "w", encoding="utf-8").write("\n".join(lines) + "\n")
PY
bash "$hermes" config set model.provider nebius | tail -n 1
bash "$hermes" config set model.default "$(value NEBIUS_MODEL)" | tail -n 1
HERMES_BIN="$hermes" bash "$project/hermes/install.sh" --deliver local

say "5/7 Services (start on boot, restart on failure)"
unit() {  # name, description, command
  sudo tee "/etc/systemd/system/$1.service" >/dev/null <<EOF
[Unit]
Description=$2
After=network-online.target
Wants=network-online.target

[Service]
User=$me
WorkingDirectory=$project
Environment=HOME=$HOME
ExecStart=$3
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
}
unit daylight-agent "Daylight: Hermes Agent gateway (assistant, scheduler, local API)" "/usr/bin/env bash $hermes gateway"
unit daylight-web "Daylight: web server (loopback only)" "$node --env-file=$env_file $project/server.mjs"
sudo systemctl daemon-reload
sudo systemctl enable -q daylight-agent daylight-web
sudo systemctl restart daylight-agent daylight-web

say "6/7 HTTPS proxy with a password"
hash_file="$HOME/.daylight-proxy-hash"
if [ ! -s "$hash_file" ]; then
  echo "Choose the password visitors must enter to open the page (user name: daylight)."
  echo "You will give this to the hackathon judges, so do not reuse one of your own."
  while :; do
    read -r -s -p "Password: " first; echo; read -r -s -p "Again:    " second; echo
    [ -n "$first" ] && [ "$first" = "$second" ] && [ "${#first}" -ge 10 ] && break
    echo "They must match and be at least 10 characters."
  done
  caddy hash-password --plaintext "$first" > "$hash_file"; chmod 600 "$hash_file"; unset first second
fi
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
$host {
	encode gzip
	basicauth {
		daylight $(cat "$hash_file")
	}
	reverse_proxy 127.0.0.1:4318 {
		flush_interval -1
	}
}
EOF
sudo systemctl enable -q caddy
sudo systemctl reload caddy 2>/dev/null || sudo systemctl restart caddy

say "7/7 Checks"
ok=1
wait_for() { for _ in $(seq 1 30); do curl -fsS -m 3 -o /dev/null "$1" && return 0; sleep 2; done; return 1; }
wait_for http://127.0.0.1:8642/health && echo "assistant: running" || { echo "assistant: NOT answering  (sudo journalctl -u daylight-agent -n 40)"; ok=0; }
wait_for http://127.0.0.1:4318/api/status && echo "web server: running" || { echo "web server: NOT answering  (sudo journalctl -u daylight-web -n 40)"; ok=0; }
reach="$(curl -fsS -m 5 http://127.0.0.1:4318/api/assistant/status || true)"
case "$reach" in *'"reachable":true'*) echo "web server -> assistant: connected" ;; *) echo "web server -> assistant: NOT connected"; ok=0 ;; esac
code=000
for _ in $(seq 1 12); do  # a first certificate takes up to a minute to be issued
  code="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "https://$host/" || true)"
  [ "$code" = 401 ] && break
  sleep 5
done
[ "$code" = 401 ] && echo "https://$host: certificate issued, password required" || { echo "https://$host: got '$code' (the certificate can take a minute; check with: sudo journalctl -u caddy -n 40)"; ok=0; }
for port in 4318 8642; do ss -ltn | grep -q "127.0.0.1:$port " || echo "warning: port $port is not bound to loopback only; check before going further"; done

cat <<EOF

$([ "$ok" = 1 ] && echo "Daylight is up." || echo "Some checks failed; see above.")

  Address    https://$host
  User name  daylight
  Password   the one you just chose

Still to do in Google Cloud Console, for the map and the calendar to work at this address:
  - Maps browser key -> Website restrictions: add  https://$host/*
  - OAuth client     -> Authorised redirect URIs: add  https://$host/api/google/callback

To update later: upload a new archive, unpack it over $project, and run this script again.
EOF
