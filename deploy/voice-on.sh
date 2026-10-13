#!/usr/bin/env bash
# Turn on voice for the web page on this VM.
#   Hearing: faster-whisper on this machine (model base.en: about 1.5 s per sentence here, 365 MB).
#   Speaking: Google Cloud Text-to-Speech, Chirp 3 HD. Only the assistant's short spoken lines are sent there.
#
#   bash deploy/voice-on.sh                      hearing only; the browser's own voice does the speaking
#   bash deploy/voice-on.sh ~/tts-key.json       hearing, and speaking with a Chirp voice
#   bash deploy/voice-on.sh ~/tts-key.json en-GB-Chirp3-HD-Charon     …with a voice of your choice
#
# The key file is a Google Cloud service-account key (JSON) for an account allowed to use
# Text-to-Speech. Upload it to the VM yourself; this script moves it next to the voice files,
# readable by you only, and never prints it.
set -euo pipefail

project="$(cd "$(dirname "$0")/.." && pwd)"
env_file="$project/.env"
home_dir="$HOME/daylight-voice"
key_source="${1:-}"
voice_name="${2:-en-GB-Chirp3-HD-Aoede}"
[ -f "$env_file" ] || { echo "Run deploy/setup-vm.sh first." >&2; exit 1; }
set_env() {  # name, value: replace the line or add it
  if grep -q "^$1=" "$env_file"; then sed -i "s|^$1=.*|$1=$2|" "$env_file"; else printf '%s=%s\n' "$1" "$2" >> "$env_file"; fi
}

echo "== Hearing"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3-venv >/dev/null
mkdir -p "$home_dir"
[ -d "$home_dir/venv" ] || python3 -m venv "$home_dir/venv"
"$home_dir/venv/bin/pip" install -q --upgrade pip
"$home_dir/venv/bin/pip" install -q faster-whisper
"$home_dir/venv/bin/python" -c 'from faster_whisper import WhisperModel; WhisperModel("base.en", device="cpu", compute_type="int8"); print("speech model base.en is ready")'
set_env VOICE_PYTHON "$home_dir/venv/bin/python"
set_env VOICE_MODEL base.en

echo "== Speaking"
if [ -n "$key_source" ]; then
  [ -f "$key_source" ] || { echo "No such file: $key_source" >&2; exit 1; }
  python3 - "$key_source" <<'PY' || { echo "That file is not a service-account key (it needs client_email and private_key)." >&2; exit 1; }
import json, sys
key = json.load(open(sys.argv[1], encoding="utf-8"))
assert key.get("client_email") and key.get("private_key")
print("service account:", key["client_email"])
PY
  install -m 600 "$key_source" "$home_dir/tts-key.json"
  [ "$(readlink -f "$key_source")" = "$(readlink -f "$home_dir/tts-key.json")" ] || rm -f "$key_source"   # one copy only
  set_env GOOGLE_TTS_CREDENTIALS "$home_dir/tts-key.json"
  set_env VOICE_NAME "$voice_name"
  echo "voice: $voice_name"
elif grep -q '^GOOGLE_TTS_CREDENTIALS=.' "$env_file"; then
  echo "keeping the voice already set up"
else
  echo "no key given: the page will use the browser's own voice"
fi
chmod 600 "$env_file"

sudo systemctl restart daylight-web
for _ in $(seq 1 20); do curl -fsS -m 3 -o /dev/null http://127.0.0.1:4318/api/status && break; sleep 1; done

echo "== Checks"
status="$(curl -fsS -m 10 http://127.0.0.1:4318/api/voice/status || true)"
case "$status" in *'"hear":{"configured":true'*) echo "hearing: set up" ;; *) echo "hearing: NOT set up  (sudo journalctl -u daylight-web -n 30)" ;; esac
case "$status" in *'"speak":{"configured":true'*)
  spoken="$(curl -s -m 30 -X POST -H 'Content-Type: application/json' -d '{"text":"On it."}' http://127.0.0.1:4318/api/voice/say || true)"
  case "$spoken" in
    *'"audio":"'*) echo "speaking: the Chirp voice answered" ;;
    *) echo "speaking: the speech service refused: $(printf '%s' "$spoken" | sed -n 's/.*"problem":"\([^"]*\)".*/\1/p')"
       echo "  Check that the Cloud Text-to-Speech API is enabled in the project the key belongs to." ;;
  esac ;;
  *) echo "speaking: browser voice (no Chirp key set)" ;;
esac
echo
echo "Open the page and reload it: a microphone button appears next to the message box."
echo "The first sentence after a restart takes a few seconds longer while the speech model loads."
