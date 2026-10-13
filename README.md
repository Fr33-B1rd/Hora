# Daylight

A personal assistant that works for you between conversations, and shows you what it knows.

Daylight is built on [Hermes Agent](https://github.com/NousResearch/hermes-agent) with NVIDIA Nemotron models served by Nebius Token Factory. You talk to it in Telegram or in its own web page; both reach the same agent, with the same memory and the same skills.

What it does today:

- **Job seeker.** Upload your CV and say what you are looking for. Every few hours it reads new postings from Sweden's public job listings and from remote-job boards, rules out what your preferences exclude, and checks the rest against your CV requirement by requirement. You hear only when one fits, with the CV lines that show each requirement and the requirements you do not meet. Ask how to adapt your CV for one and it will tell you what to bring forward and what is missing; it will not suggest adding anything your CV does not contain.
- **Research tracker.** Tell it a topic once. Every morning it reads the new arXiv listings, keeps only the papers that are relevant to what you said you care about, and sends a short digest.
- **Grocery offers.** Every morning it reads the week's offers at Lidl Sverige and sends the ones you would want. Say once that you avoid pork and it stops showing pork.
- **Day planner.** Ask for a day out in Stockholm and it returns a plan checked against real opening hours and real public-transport times, shown on a map. It can add the plan to your Google Calendar, but only after you have seen the exact changes and confirmed them.
- **Calendar.** Ask what you have on, or ask it to add an event. It tells you exactly what it would add, names anything it overlaps, and writes only after you answer yes in a separate message. When you plan a day, it tells you what is already there first.
- **To-do lists and reminders.** “Add renew passport to my list”, “tick that off”, “remind me on Friday at 9”. In a Telegram group it keeps one shared list for everyone and can summarise what was discussed since it joined.
- **Voice.** Speak to it on the web page. Your speech is turned into text on your own server. What it says back is not the written answer read aloud: a short acknowledgement, then one brief line made for the ear, while the detail stays on screen.
- **What I know.** A page listing everything it has remembered about you, your CV and job search, the topics and foods it tracks, and the jobs it runs for you. Anything can be removed or paused there.

## How it is put together

```
Telegram ─┐
          ├─► Hermes Agent ──► Nebius Token Factory (NVIDIA Nemotron)
Web page ─┘     │  memory, skills, scheduler
   ▲            ├─ tools (MCP)       mcp/                  job matches, CV advice, calendar, offers, food preferences, research topics, planner
   │            ├─ job scripts       hermes/scripts/       job-board, arXiv and Lidl readers, screening by a small model
   │            └─ skills            hermes/skills/        how to write the scheduled digests
   │
   └─ web server  lib/http.mjs   serves the page, relays chat, shows memory, owns calendar writes
```

- The agent's main model is `nvidia/nemotron-3-super-120b-a12b`. The scheduled jobs screen papers and offers with the smaller `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, and a job script can decide there is nothing new and not wake the agent at all.
- The job seeker reads each posting twice with different models. The small model lists what the posting requires, without the CV in view, so that hard requirements are not quietly dropped. The larger model then checks each requirement against the CV and must quote the CV words that show it; code accepts a requirement as met only if those words are really in the CV, and the fit shown is simply how many requirements were met.
- Everything the user can ask for in conversation is a tool the model calls directly, and each tool result says how to answer from it. This replaced instructions the model had to remember to open first: on the evaluation set below, that change and the fixes that followed took the assistant from 9 of 20 conversations right to 40 of 40 over two runs, with one tool call where there had been three or four.
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

Neither suite uses the network or real credentials.

The evaluation set is different: 34 real conversations with the running assistant (job search, calendar, to-do lists, groceries, research, planning, memory, manner), each judged on what it did and on what its reply may and may not say.

```bash
node --env-file=.env scripts/eval-assistant.mjs --label mychange --repeat 2
```

It uses the real model, takes a few minutes, and starts each conversation from a stated world. Your own memory, preferences, topics and schedule are copied aside first and put back afterwards. The cases are in `evals/cases.mjs`.

[VALIDATION.md](VALIDATION.md) records what was checked against the live services and what was not, including how far the evaluation numbers can be trusted.

## Limits

- One user, one machine. The web server listens on `127.0.0.1` only and has no accounts.
- The planner knows Stockholm: times are Europe/Stockholm, costs are in SEK, events come from Visit Stockholm and news from SVT.
- Opening hours do not guarantee a table or a ticket, and costs are estimates. Nothing is booked or paid for.
- Grocery offers cover Lidl Sverige only.
- Job postings come from Arbetsförmedlingen's JobSearch API (Sweden) and from Himalayas and Jobicy (remote roles), each credited and linked. There is no source for on-site jobs in other countries: the large job sites do not permit automated reading. Postings written in Swedish are ruled out unless Swedish is one of your working languages.
- A job match means the posting's main requirements were found in your CV; it is not a prediction that you will get the job. Reading a PDF CV needs `pdftotext` (poppler-utils) on the server; Word and text files need nothing extra.
- What leaves your machine, and what is stored on it, is described on the page's “Data and services” link ([public/privacy.html](public/privacy.html)).
