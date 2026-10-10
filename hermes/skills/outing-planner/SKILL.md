---
name: outing-planner
description: "Plan a checked day out in Stockholm: real places, opening hours, travel, calendar."
version: 0.1.0
author: Daylight
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Planning, Stockholm, Maps, Calendar, Events, Daylight]
    category: daylight
---

# Outing planner

Use the `daylight` tools (their names start with `mcp__daylight__`, with double underscores) for anything about going out in Stockholm. They check a day against real places, opening hours, travel times and the user's calendar, which you cannot do from memory.

- `mcp__daylight__plan_day`: plan a day. Needs a date, a departure point and the activities.
- `mcp__daylight__find_events`: curated events with a session on a date.
- `mcp__daylight__local_news`: recent Stockholm headlines.

## Planning

1. You need three things: the date, where the user starts, and what they want to do. If the departure point is missing, ask for it in one short question and stop. Ask nothing else.
2. Leave time, return time and budget are optional. Pass them only if the user stated them. Never ask for them and never invent them.
3. Pass each activity in the user's words. Set `place` only for a venue the user named. Set `earliest`/`latest` only for times the user gave. Set `meetingPoint` for meeting someone somewhere or for an outdoor walk. Set `keepOrder` when the user's words give an order (“first”, “then”, “after”, “before”), and list the activities in that order; leave it off when they only listed things.
4. Apply what you remember about the user when choosing search terms (for example a food they avoid), and say that you did.
5. Call `plan_day` once, then answer from its result. Do not describe a plan you have not received from the tool.

## Answering

- `planned`: give the first option in two to four plain sentences: the order with the key times, when they are back, the estimated cost, and the one trade-off worth knowing (a long wait, a tight connection). Mention that other options exist if there are any. No lists, no tables.
- `draft_needs_verification`: say it is a draft and what still has to be confirmed.
- `nothing_fits`: say what blocks it, using `why` and `blockers`, and offer the `ways_forward`. Do not soften a requirement the user gave without asking.
- `not_planned`: say what was missing or could not be found.
- Times and costs are estimates; opening hours do not guarantee a table or a ticket. Say so once, briefly.
- You cannot book, pay or add anything to the calendar. If asked, say that confirming is done by the user.

## Events and news

For “what's on”, call `find_events` with the date the user means (today, tomorrow or a named day resolved to a date). Mention at most three events, one sentence each, with the session time from the result; if an event has no published session, say so. Do not present an event from one day as happening on another. If the user then wants one in a plan, pass its venue as `place` and its session as `earliest`/`latest`.
