#!/usr/bin/env bash
# Why can't the assistant see what the group said? Prints the group settings, whether
# Telegram delivered unaddressed group messages, and where Hermes stored them.
# No message text is printed.
#
#   bash deploy/check-group.sh
set -uo pipefail
home="${HERMES_HOME:-$HOME/.hermes}"

echo "== Settings"
grep -hE '^(TELEGRAM_GROUP_ALLOWED_CHATS|TELEGRAM_ALLOWED_CHATS|TELEGRAM_REQUIRE_MENTION|TELEGRAM_OBSERVE_UNMENTIONED_GROUP_MESSAGES|TELEGRAM_FREE_RESPONSE_CHATS)=' "$home/.env" 2>/dev/null || echo "(none in .env)"
grep -nE 'observe_unmentioned|group_allowed_chats|require_mention|group_sessions_per_user|free_response' "$home/config.yaml" 2>/dev/null || true

echo; echo "== Gateway log, last 3 days"
since="-3days"
echo "observed (not addressed): $(sudo journalctl -u daylight-agent --since "$since" --no-pager 2>/dev/null | grep -c 'group message observed')"
echo "failed to observe:        $(sudo journalctl -u daylight-agent --since "$since" --no-pager 2>/dev/null | grep -c 'Failed to observe')"
sudo journalctl -u daylight-agent --since "$since" --no-pager 2>/dev/null | grep -iE 'observ|group' | grep -viE 'observed \(no bot trigger\)' | tail -5 | sed -E 's/[0-9]{6,}:[A-Za-z0-9_-]{20,}/<token>/g'

echo; echo "== Stored conversations (Telegram, not private)"
python3 - "$home/state.db" <<'PY'
import sqlite3, sys, datetime as dt
c = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
t = lambda x: dt.datetime.fromtimestamp(x).strftime("%m-%d %H:%M") if x else "-"
rows = c.execute("""select s.id, s.chat_type, s.session_key, s.user_id is not null,
  sum(m.observed=1), sum(m.observed=0 and m.role='user'), max(m.timestamp)
  from sessions s left join messages m on m.session_id=s.id
  where s.source='telegram' and s.chat_type!='dm' group by s.id order by max(m.timestamp) desc limit 8""").fetchall()
if not rows: print("none")
for sid, kind, key, has_user, obs, asked, last in rows:
    print(f"{sid}  type={kind}  key={key}  per-user={bool(has_user)}  observed={obs or 0}  addressed={asked or 0}  last={t(last)}")
print("all observed rows anywhere:", c.execute("select count(*) from messages where observed=1").fetchone()[0])
call = c.execute("""select s.session_key, s.chat_type, m.timestamp from messages m join sessions s on s.id=m.session_id
  where m.role='assistant' and instr(m.tool_calls,'__group_conversation"')>0 order by m.id desc limit 1""").fetchone()
print("last summary call:", call and f"key={call[0]} type={call[1]} at={t(call[2])}")
PY
