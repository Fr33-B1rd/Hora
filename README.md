# Daylight

A personal assistant that works for you between conversations, and shows you what it knows.

Daylight is built on [Hermes Agent](https://github.com/NousResearch/hermes-agent) with NVIDIA Nemotron models served by Nebius Token Factory. You talk to it in Telegram or in its own web page; both reach the same agent, with the same memory and the same skills.

What it does today:

- **Research tracker.** Tell it a topic once. Every morning it reads the new arXiv listings, keeps only the papers that are relevant to what you said you care about, and sends a short digest.
- **Grocery offers.** Every morning it reads the week's offers at Lidl Sverige and sends the ones you would want. Say once that you avoid pork and it stops showing pork.
- **Day planner.** Ask for a day out in Stockholm and it returns a plan checked against real opening hours and real public-transport times, shown on a map. It can add the plan to your Google Calendar, but only after you have seen the exact changes and confirmed them.
- **What I know.** A page listing everything it has remembered about you, the topics and foods it tracks, and the jobs it runs for you. Anything can be removed or paused there.

## How it is put together

```
Telegram ─┐
          ├─► Hermes Agent ──► Nebius Token Factory (NVIDIA Nemotron)
Web page ─┘     │  memory, skills, scheduler
   ▲            ├─ skills            hermes/skills/        when and how to do each task
   │            ├─ job scripts       hermes/scripts/       arXiv and Lidl readers, small-model screening
   │            └─ planner tools     mcp/planner-server.mjs places, routes, events, news (MCP)
   │
   └─ web server  lib/http.mjs   serves the page, relays chat, shows memory, owns calendar writes
```

- The agent's main model is `nvidia/nemotron-3-super-120b-a12b`. The scheduled jobs screen papers and offers with the smaller `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, and a job script can decide there is nothing new and not wake the agent at all.
- The planner is ordinary code, not the model: the model chooses what to plan, the code works out what actually fits. A time, order or budget is treated as a requirement only if you stated it.
- The assistant has no tool that writes to your calendar. Writing is done by the web server, after a preview, on your click.

## Requirements

- Linux, macOS or Windows with WSL, for Hermes Agent
- Node.js 24 or newer
- A Nebius Token Factory API key
- For the day planner: Google Maps keys and, optionally, Google Calendar access. See [GOOGLE_SETUP.md](GOOGLE_SETUP.md)
- For pushed digests: a Telegram bot token

## Setup

1. Install Hermes Agent by following its own instructions.
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

3. In `~/.hermes/.env`, enable Hermes's local API and, if you want Telegram, add the bot settings Hermes asks for during `hermes gateway setup`:

   ```dotenv
   API_SERVER_ENABLED=true
   API_SERVER_KEY=...               # same value as HERMES_API_KEY
   ```

4. Install Daylight's skills, job scripts, planner tools and scheduled jobs into Hermes:

   ```bash
   HERMES_BIN=$PWD/scripts/hermes.sh bash hermes/install.sh --deliver telegram
   ```

   `scripts/hermes.sh` starts Hermes with the Nebius settings from this folder's `.env`, so the key lives in one place. Use `--deliver local` if you have not set up Telegram.

## Running

Start the agent (this also runs the scheduler and the Telegram connection):

```bash
bash scripts/hermes.sh gateway
```

Start the web page:

```bash
node --env-file-if-exists=.env server.mjs
```

Then open <http://127.0.0.1:4318>. On Windows, `start-demo.bat` and `stop-demo.bat` start and stop the web server in the background.

If Hermes runs inside WSL and the web server on Windows, set `DAYLIGHT_HERMES_HOME` in `.env` to the Hermes home as Windows sees it, for example `//wsl.localhost/Ubuntu-24.04/home/<you>/.hermes`.

## Tests

```bash
node --test tests/*.test.mjs
python3 -m unittest discover -s hermes/tests
```

Neither suite uses the network or real credentials. [VALIDATION.md](VALIDATION.md) records what was checked against the live services and what was not.

## Limits

- One user, one machine. The web server listens on `127.0.0.1` only and has no accounts.
- The planner knows Stockholm: times are Europe/Stockholm, costs are in SEK, events come from Visit Stockholm and news from SVT.
- Opening hours do not guarantee a table or a ticket, and costs are estimates. Nothing is booked or paid for.
- Grocery offers cover Lidl Sverige only.
- What leaves your machine, and what is stored on it, is described on the page's “Data and services” link ([public/privacy.html](public/privacy.html)).
