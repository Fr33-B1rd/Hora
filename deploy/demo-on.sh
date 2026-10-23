#!/usr/bin/env bash
# Give the hackathon judges their own Hora, next to yours on this VM:
#   https://demo.<host>, user name "judge", a password you choose here.
#
#   bash deploy/demo-on.sh 34-51-186-249.sslip.io
#
# The demo is a second assistant with its own memory and data: a fictional user,
# Maria Lind, with her CV, job search, research topics, food preferences and a stand-in
# calendar. It has no Telegram and never sees your memory, CV, calendar or chats. It
# uses the same model and Maps keys as yours, so judges' questions are billed to you.
# Every night at 04:00 it is reset to its starting state. Safe to re-run.
set -euo pipefail
host="${1:?usage: bash deploy/demo-on.sh <public-hostname>   e.g. 34-51-186-249.sslip.io}"
project="$(cd "$(dirname "$0")/.." && pwd)"
me="$(id -un)"
demo_host="demo.$host" demo_home="$HOME/.hermes-demo" data="$HOME/daylight-demo-data"
node="$(ls -d "$HOME"/.hermes/tools/node-*/bin/node 2>/dev/null | sort -V | tail -1)"
[ -s "$HOME/.daylight-proxy-hash" ] || { echo "Run deploy/setup-vm.sh first." >&2; exit 1; }
say() { printf '\n== %s\n' "$*"; }
chmod +x "$project/scripts/hermes.sh"

say "1/4 The demo assistant and Maria Lind's profile"
bash "$project/deploy/demo-home.sh" "https://$demo_host"

say "2/4 Services, and a reset every night"
unit() {  # name, description, user, environment, command, extra [Service] lines
  sudo tee "/etc/systemd/system/$1.service" >/dev/null <<EOF
[Unit]
Description=$2
After=network-online.target
Wants=network-online.target

[Service]
User=$3
WorkingDirectory=$project
Environment=HOME=$HOME $4
ExecStart=$5
$6

[Install]
WantedBy=multi-user.target
EOF
}
unit daylight-demo-agent "Daylight demo: Hermes Agent gateway for judges" "$me" "HERMES_HOME=$demo_home" \
  "/usr/bin/env bash $project/scripts/hermes.sh gateway" "Restart=always
RestartSec=5"
unit daylight-demo-web "Daylight demo: web server for judges (loopback only)" "$me" "" \
  "$node --env-file=$project/.env --env-file=$demo_home/demo.env --import file://$project/tests/calendar-provider.mjs $project/server.mjs" "Restart=always
RestartSec=5"
unit daylight-demo-reset "Daylight demo: back to the starting state" root "" \
  "/usr/bin/runuser -u $me -- /usr/bin/env HOME=$HOME bash $project/deploy/demo-reset.sh" "Type=oneshot
ExecStartPre=/bin/systemctl stop daylight-demo-agent daylight-demo-web
ExecStartPost=/bin/systemctl start daylight-demo-agent daylight-demo-web"
sudo tee /etc/systemd/system/daylight-demo-reset.timer >/dev/null <<EOF
[Unit]
Description=Reset the Daylight demo every night

[Timer]
OnCalendar=*-*-* 04:00:00 Europe/Stockholm
Persistent=true

[Install]
WantedBy=timers.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable -q daylight-demo-agent daylight-demo-web daylight-demo-reset.timer
sudo systemctl restart daylight-demo-agent daylight-demo-web
sudo systemctl start daylight-demo-reset.timer

say "3/4 The judges' site"
hash_file="$HOME/.daylight-demo-hash"
if [ ! -s "$hash_file" ]; then
  echo "Choose the password judges will use (user name: judge). Not one of your own: it goes in the submission form."
  while :; do
    read -r -s -p "Password: " first; echo; read -r -s -p "Again:    " second; echo
    [ -n "$first" ] && [ "$first" = "$second" ] && [ "${#first}" -ge 10 ] && break
    echo "They must match and be at least 10 characters."
  done
  caddy hash-password --plaintext "$first" > "$hash_file"; chmod 600 "$hash_file"; unset first second
fi
bash "$project/deploy/caddyfile.sh" "$host" | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo systemctl reload caddy 2>/dev/null || sudo systemctl restart caddy

say "4/4 Checks, and the first digests"
ok=1
wait_for() { for _ in $(seq 1 45); do curl -fsS -m 3 -o /dev/null "$1" && return 0; sleep 2; done; return 1; }
wait_for http://127.0.0.1:8643/health && echo "demo assistant: running" || { echo "demo assistant: NOT answering  (sudo journalctl -u daylight-demo-agent -n 40)"; ok=0; }
wait_for http://127.0.0.1:4319/api/status && echo "demo web server: running" || { echo "demo web server: NOT answering  (sudo journalctl -u daylight-demo-web -n 40)"; ok=0; }
case "$(curl -fsS -m 5 http://127.0.0.1:4319/api/assistant/status || true)" in *'"reachable":true'*) echo "demo page -> demo assistant: connected" ;; *) echo "demo page -> demo assistant: NOT connected"; ok=0 ;; esac
curl -fsS -m 3 -o /dev/null http://127.0.0.1:8642/health && echo "your own assistant: still running" || echo "your own assistant: not answering; check sudo systemctl status daylight-agent"
code=000
for _ in $(seq 1 12); do code="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "https://$demo_host/" || true)"; [ "$code" = 401 ] && break; sleep 5; done
[ "$code" = 401 ] && echo "https://$demo_host: certificate issued, password required" || { echo "https://$demo_host: got '$code' (a first certificate can take a minute: sudo journalctl -u caddy -n 40)"; ok=0; }
# Run each scheduled job once now, so that judges find a research digest, offers and job matches.
python3 - "$demo_home/cron/jobs.json" <<'PY' | while read -r id; do HERMES_HOME="$demo_home" bash "$project/scripts/hermes.sh" cron run "$id" >/dev/null && echo "queued a first run: $id"; done
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
for job in (data if isinstance(data, list) else data.get("jobs", [])):
    if str(job.get("name", "")).startswith("daylight-"):
        print(job["id"])
PY
free -m | awk '/^Mem:/ {print "memory in use: " $3 " of " $2 " MB"}'

cat <<EOF

$([ "$ok" = 1 ] && echo "The judges' demo is up." || echo "Some checks failed; see above.")

  Address    https://$demo_host
  User name  judge
  Password   the one you chose

Judges meet Maria Lind, a fictional data scientist: they can ask for jobs, papers, offers,
her calendar (a stand-in: confirming an event writes only there), plans and lists.
The first job matches take a few minutes to appear. Reset now: sudo systemctl start daylight-demo-reset

Still to do in Google Cloud Console, for the map to show on the demo page:
  - Maps browser key -> Website restrictions: add  https://$demo_host/*
EOF
