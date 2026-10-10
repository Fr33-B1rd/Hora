#!/usr/bin/env bash
# Run Hermes Agent (inside WSL) with the Nebius key taken from Daylight's .env
# at launch, so the key is not copied into a second file.
#   wsl bash scripts/hermes.sh chat --provider nebius --model "$NEBIUS_MODEL" -q "hello"
set -euo pipefail
env_file="$(cd "$(dirname "$0")/.." && pwd)/.env"
value() { grep -E "^$1=" "$env_file" | head -1 | cut -d= -f2- | tr -d '\r' | sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/'; }
export NEBIUS_API_KEY="$(value NEBIUS_API_KEY)"
export NEBIUS_MODEL="$(value NEBIUS_MODEL)"
export NEBIUS_BASE_URL="$(value NEBIUS_BASE_URL)"
[ -n "$NEBIUS_API_KEY" ] || { echo "NEBIUS_API_KEY is empty in $env_file" >&2; exit 1; }
exec "$HOME/.local/bin/hermes" "$@"
