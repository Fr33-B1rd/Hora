#!/usr/bin/env bash
# Let the assistant take part in one Telegram group: every member may address it,
# it answers only when mentioned, and it keeps the messages it was not mentioned in
# as shared context, so that it can summarise the discussion when asked.
#
#   bash deploy/group-on.sh -1001234567890          # the group's chat ID
#   bash deploy/group-on.sh --off                   # back to private use only
#
# Before running: in @BotFather, /setprivacy -> Disable for this bot, then remove the
# bot from the group and add it again. Otherwise Telegram never shows it the messages.
set -euo pipefail

project="$(cd "$(dirname "$0")/.." && pwd)"
hermes="$project/scripts/hermes.sh"
chat="${1:-}"
[ -n "$chat" ] || { echo "usage: bash deploy/group-on.sh <group chat ID>   (a negative number)   or   --off" >&2; exit 2; }
set_value() { bash "$hermes" config set "$1" "$2" | tail -n 1; }

if [ "$chat" = "--off" ]; then
  set_value TELEGRAM_GROUP_ALLOWED_CHATS ""
  set_value TELEGRAM_OBSERVE_UNMENTIONED_GROUP_MESSAGES false
  echo "Group use is off: the assistant answers only its owner again."
else
  case "$chat" in -[0-9]*) ;; *) echo "A group chat ID is a negative number, for example -1001234567890." >&2; exit 2 ;; esac
  set_value TELEGRAM_GROUP_ALLOWED_CHATS "$chat"                    # every member of this group may address it
  set_value TELEGRAM_REQUIRE_MENTION true                           # …and it answers only when mentioned or replied to
  set_value TELEGRAM_OBSERVE_UNMENTIONED_GROUP_MESSAGES true        # the rest is kept as context, not answered
  cat <<EOF

Group $chat is on.
  - Anyone in the group can now ask the assistant things by mentioning it. Each answer is a model call on your account.
  - It keeps what is said in the group, from now on, so that it can summarise it. It cannot see anything said before this.
  - The group shares one conversation with it, and one to-do list.
EOF
fi
sudo systemctl restart daylight-agent
for _ in $(seq 1 30); do curl -fsS -m 3 -o /dev/null http://127.0.0.1:8642/health && break; sleep 2; done
curl -fsS -m 3 -o /dev/null http://127.0.0.1:8642/health && echo "The assistant has restarted." || { echo "The assistant did not come back: sudo journalctl -u daylight-agent -n 40" >&2; exit 1; }
