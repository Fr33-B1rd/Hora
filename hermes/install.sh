#!/usr/bin/env bash
# Install Daylight's skills and job scripts into Hermes Agent (run inside WSL/Linux).
#   bash hermes/install.sh [--deliver telegram|local] [--at "0 8 * * *"]
# Safe to re-run: files are replaced, the scheduled job is created only if missing.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
home="${HERMES_HOME:-$HOME/.hermes}"
hermes="${HERMES_BIN:-$HOME/.local/bin/hermes}"
deliver=local; at="0 8 * * *"
while [ $# -gt 0 ]; do case "$1" in --deliver) deliver="$2"; shift 2 ;; --at) at="$2"; shift 2 ;; *) echo "unknown option: $1" >&2; exit 2 ;; esac; done

mkdir -p "$home/scripts" "$home/skills/daylight"
install -m 0644 "$here"/scripts/*.py "$home/scripts/"
for skill in "$here"/skills/*/; do
  name="$(basename "$skill")"
  rm -rf "$home/skills/daylight/$name"
  cp -r "$skill" "$home/skills/daylight/$name"
  echo "skill: $name"
done

# Standing instructions: which skill answers what, and how to write for a chat
# app. Kept as a marked block appended to Hermes's own SOUL.md, replaced on re-install.
soul="$home/SOUL.md"; touch "$soul"
[ -f "$soul.before-daylight" ] || cp "$soul" "$soul.before-daylight"   # Hermes's own text, kept once
python3 - "$soul" "$here/SOUL.daylight.md" <<'PY'
import re, sys
soul, block = open(sys.argv[1], encoding="utf-8").read(), open(sys.argv[2], encoding="utf-8").read().strip()
soul = re.sub(r"\n*<!-- daylight:start -->.*?<!-- daylight:end -->\n*", "\n", soul, flags=re.S).strip()
# Hermes's default persona opens by naming the agent; as the first identity the model reads,
# it outweighs the Daylight block below. Only that sentence is changed; its style advice stays.
soul = re.sub(r"^You are (?:Hermes Agent|Hora)[^.]*\.\s*", "You are Hora, a personal assistant built on Hermes Agent by Nous Research. ", soul, count=1)
# The Daylight block goes first, so that her name and abilities are the first thing read.
open(sys.argv[1], "w", encoding="utf-8").write("<!-- daylight:start -->\n" + block + "\n<!-- daylight:end -->\n\n" + soul + "\n")
PY
echo "instructions: Daylight block written to SOUL.md"

# The outing planner runs as a tool server on Hermes's own Node, reading the
# project .env itself so no key is written into Hermes's config.
project="$(cd "$here/.." && pwd)"

# The job scripts use a small model too. Run by the scheduler they inherit the
# key from the gateway; run from the agent's terminal they do not, so they are
# told where the project's .env is. Only the path is written, never the key.
mkdir -p "$home/daylight"
python3 - "$home/daylight/config.json" "$project/.env" <<'PY'
import json, sys
json.dump({"envFile": sys.argv[2]}, open(sys.argv[1], "w", encoding="utf-8"))
PY
echo "scripts: small-model settings are read from $project/.env"
node="$(ls -d "$home"/tools/node-*/bin/node 2>/dev/null | sort -V | tail -1 || true)"
servers="$("$hermes" mcp list 2>/dev/null || true)"
if grep -qw 'daylight' <<<"$servers"; then
  echo "tools: daylight planner already registered"
elif [ -n "$node" ]; then
  "$hermes" mcp add daylight --connect-timeout 30 --command "$node" --args "--env-file=$project/.env" "$project/mcp/planner-server.mjs" <<<"y" | tail -n 3  # answers “Enable all tools?”
else
  echo "tools: no Node found under $home/tools; planner not registered" >&2
fi

# One profile only. In multi-profile mode the gateway reads secrets solely from
# ~/.hermes/.env and ignores the Nebius key that scripts/hermes.sh passes in.
"$hermes" config set gateway.multiplex_profiles false | tail -n 1
"$hermes" config set gateway.auto_multiplex_migration false | tail -n 1

# Keep the three planner tools directly callable. With on-demand tool loading
# the model has to search for and load them first, which costs extra model
# calls and fails outright when it calls them by name.
"$hermes" config set tools.tool_search.enabled off | tail -n 1

# Read the list fully before matching: with pipefail, `grep -q` closing the
# pipe early makes the test fail and a duplicate job is created.
jobs="$("$hermes" cron list 2>/dev/null || true)"
ensure_job() {  # name, schedule, skill, script, prompt
  if grep -q "$1" <<<"$jobs"; then
    echo "job: $1 already exists"
  else
    "$hermes" cron create "$2" "$5" --name "$1" --skill "$3" --script "$4" --deliver "$deliver" | tail -n 4
  fi
}
ensure_job daylight-research-feed "$at" research-tracker daylight_research.py \
  "Write today's research digest from the new papers in the script output, following the research-tracker skill."
ensure_job daylight-grocery-deals "30 7 * * *" discount-tracker daylight_deals.py \
  "Write today's grocery offers message from the new offers in the script output, following the discount-tracker skill."
# The job watch runs through the day; its script wakes the agent only when a new posting fits.
ensure_job daylight-job-matches "15 */3 * * *" job-seeker daylight_jobs.py \
  "Write the job matches message from the new matches in the script output, following the job-seeker skill."
