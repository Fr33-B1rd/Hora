# Setting up Hora

## Requirements

- Linux, macOS or Windows with WSL, for Hermes Agent
- Node.js 24 or newer
- A Nebius Token Factory API key
- For the day planner: Google Maps keys and, optionally, Google Calendar access. See [GOOGLE_SETUP.md](GOOGLE_SETUP.md)
- For digests and group chats: a Telegram bot token

## Install

1. Install [Hermes Agent](https://github.com/NousResearch/hermes-agent) by following its own instructions.
2. Create `.env` in this folder:

   ```dotenv
   NEBIUS_API_KEY=...
   NEBIUS_BASE_URL=https://api.tokenfactory.us-central1.nebius.com/v1
   NEBIUS_MODEL=nvidia/nemotron-3-super-120b-a12b
   GOOGLE_MAPS_API_KEY=...          # server key: Places API (New) + Routes API
   GOOGLE_MAPS_BROWSER_KEY=...      # separate browser key: Maps JavaScript API
   GOOGLE_CLIENT_ID=...             # optional, for the calendar
   GOOGLE_CLIENT_SECRET=...
   HERMES_API_URL=http://127.0.0.1:8642
   HERMES_API_KEY=...               # any long random string; must match API_SERVER_KEY below
   ```

3. In `~/.hermes/.env`, enable Hermes's local API:

   ```dotenv
   API_SERVER_ENABLED=true
   API_SERVER_KEY=...               # same value as HERMES_API_KEY
   ```

4. Install Hora's persona, tools, job scripts and scheduled jobs into Hermes:

   ```bash
   HERMES_BIN=$PWD/scripts/hermes.sh bash hermes/install.sh --deliver telegram
   ```

   `scripts/hermes.sh` starts Hermes with the Nebius settings from this folder's `.env`, so the key lives in one place. Use `--deliver local` without Telegram.

## Run

```bash
bash scripts/hermes.sh gateway                  # the agent, scheduler and Telegram
node --env-file-if-exists=.env server.mjs       # the web page, at http://127.0.0.1:4318
```

On Windows, `start-demo.bat` and `stop-demo.bat` run the web server in the background. If Hermes runs inside WSL and the web server on Windows, set `DAYLIGHT_HERMES_HOME` in `.env` to the Hermes home as Windows sees it, for example `//wsl.localhost/Ubuntu-24.04/home/<you>/.hermes`.

## On a server

`deploy/` sets Hora up on an Ubuntu VM behind HTTPS: `setup-vm.sh` first, then `telegram-on.sh` for the bot, `group-on.sh <group chat ID>` to let it join one Telegram group, and `voice-on.sh` for speech recognition on the server. `check-group.sh` explains why a group's messages are not being seen.

`demo-on.sh <host>` adds a separate demo for visitors at `https://demo.<host>` (user name `judge`): a second assistant with a fictional user, Maria Lind, a stand-in calendar and no Telegram, which never sees the owner's data and is reset every night (`demo-reset.sh`).

## Tests

```bash
node --test tests/*.test.mjs
python3 -m unittest discover -s hermes/tests
node --env-file=.env scripts/eval-assistant.mjs --label mychange --repeat 2
```

The first two use no network or credentials. The third is the evaluation set: 34 real conversations with the running assistant, each judged on what it did and what its reply may and may not say. It copies your own memory and settings aside first and restores them afterwards; the cases are in `evals/cases.mjs`.

## Data sources and limits

- Times are Europe/Stockholm and costs SEK; events come from Visit Stockholm, news from SVT, grocery offers from Lidl Sverige.
- Jobs come from Arbetsförmedlingen's JobSearch API (Sweden), Himalayas and Jobicy (remote), each credited and linked. The large job sites do not permit automated reading. Reading a PDF CV needs `pdftotext` (poppler-utils).
- Nothing is booked or paid for; opening hours do not guarantee a table or a ticket.
- What leaves your machine and what is stored on it: [public/privacy.html](public/privacy.html).
