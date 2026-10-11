#!/usr/bin/env bash
# Connect the VM's assistant to your Telegram bot and send the morning digests there.
# Run on the VM after deploy/setup-vm.sh:
#
#   bash deploy/telegram-on.sh
#
# You type the bot token here, on the VM; it is stored in ~/.hermes/.env (readable
# by you only) and never printed. A token can serve one running assistant at a
# time, so stop any other gateway that uses this bot first.
set -euo pipefail

project="$(cd "$(dirname "$0")/.." && pwd)"
hermes="$project/scripts/hermes.sh"
secrets="$HOME/.hermes/.env"
[ -f "$secrets" ] || { echo "Run deploy/setup-vm.sh first." >&2; exit 1; }

if grep -q '^TELEGRAM_BOT_TOKEN=.' "$secrets" && [ "${1:-}" != "--replace" ]; then
  echo "A bot token is already stored. Keeping it (run with --replace to enter a new one)."
else
  echo "Paste the three values from your old setup. Nothing you type for the token is shown."
  read -r -s -p "Bot token (from BotFather): " token; echo
  read -r -p "Your Telegram user ID (TELEGRAM_ALLOWED_USERS): " allowed
  read -r -p "Chat ID for digests (TELEGRAM_HOME_CHANNEL; Enter to use your user ID): " home
  home="${home:-$allowed}"
  case "$token" in *:*) ;; *) echo "That does not look like a bot token (expected digits, a colon, then letters)." >&2; exit 1 ;; esac
  case "$allowed" in ''|*[!0-9,-]*) echo "The user ID should be a number." >&2; exit 1 ;; esac
  TOKEN="$token" ALLOWED="$allowed" HOMECHAT="$home" python3 - "$secrets" <<'PY'
import os, sys
path = sys.argv[1]
keep = [l for l in open(path, encoding="utf-8").read().splitlines()
        if not l.startswith(("TELEGRAM_BOT_TOKEN=", "TELEGRAM_ALLOWED_USERS=", "TELEGRAM_HOME_CHANNEL="))]
keep += ["TELEGRAM_BOT_TOKEN=" + os.environ["TOKEN"], "TELEGRAM_ALLOWED_USERS=" + os.environ["ALLOWED"], "TELEGRAM_HOME_CHANNEL=" + os.environ["HOMECHAT"]]
open(path, "w", encoding="utf-8").write("\n".join(keep) + "\n")
PY
  unset token; chmod 600 "$secrets"
  echo "Stored."
fi

echo "Sending the morning digests to Telegram:"
python3 - "$HOME/.hermes/cron/jobs.json" <<'PY' | while read -r id name; do
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
for job in (data if isinstance(data, list) else data.get("jobs", [])):
    if str(job.get("name", "")).startswith("daylight-"):
        print(job["id"], job["name"])
PY
  bash "$hermes" cron edit "$id" --deliver telegram >/dev/null && echo "  $name"
done

sudo systemctl restart daylight-agent
for _ in $(seq 1 30); do curl -fsS -m 3 -o /dev/null http://127.0.0.1:8642/health && break; sleep 2; done
sleep 8
if sudo journalctl -u daylight-agent --since "-90s" --no-pager | grep -qiE 'telegram.*(conflict|unauthorized|invalid token|401|409)'; then
  echo; echo "Telegram reported a problem:"
  sudo journalctl -u daylight-agent --since "-90s" --no-pager | grep -iE 'telegram' | tail -5 | sed -E 's/[0-9]{6,}:[A-Za-z0-9_-]{20,}/<token>/g'
  echo "“Conflict” means another assistant is still using this bot: stop it, then run this again."
  exit 1
fi
echo
echo "The assistant is running with Telegram. Send your bot a message to check."
echo "Digest times follow this machine's clock ($(timedatectl show -p Timezone --value)): groceries 07:30, research 08:00."
echo "To use your own time zone:  sudo timedatectl set-timezone Europe/Stockholm && sudo systemctl restart daylight-agent"
