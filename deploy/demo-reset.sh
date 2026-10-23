#!/usr/bin/env bash
# Put the judges' demo back to its starting state: visitors' conversations are cleared,
# Maria Lind's memory, preferences, to-do list and calendar are written again, and any
# scheduled job a visitor paused or removed is back. What the jobs already found is kept.
# Runs every night from the daylight-demo-reset timer, with the demo assistant stopped.
# To reset now:  sudo systemctl start daylight-demo-reset
set -euo pipefail
project="$(cd "$(dirname "$0")/.." && pwd)"
demo_home="${DEMO_HERMES_HOME:-$HOME/.hermes-demo}"
data="${DEMO_DATA_DIR:-$HOME/daylight-demo-data}"
[ -f "$demo_home/demo.env" ] || { echo "No demo at $demo_home; run deploy/demo-on.sh first." >&2; exit 1; }
node="$(ls -d "$HOME"/.hermes/tools/node-*/bin/node 2>/dev/null | sort -V | tail -1)"

rm -f "$demo_home"/state.db "$demo_home"/state.db-* "$demo_home"/response_store.db "$demo_home"/response_store.db-*
rm -rf "$demo_home/sessions" "$data/plans"
HERMES_HOME="$demo_home" HERMES_BIN="$project/scripts/hermes.sh" bash "$project/hermes/install.sh" --deliver local >/dev/null
python3 - "$demo_home/cron/jobs.json" <<'PY'
import json, sys
path = sys.argv[1]
data = json.load(open(path, encoding="utf-8"))
for job in (data if isinstance(data, list) else data.get("jobs", [])):
    if str(job.get("name", "")).startswith("daylight-"):
        job["enabled"] = True
json.dump(data, open(path, "w", encoding="utf-8"), indent=2)
PY
"$node" "$project/deploy/demo/seed.mjs" "$demo_home" "$data"
