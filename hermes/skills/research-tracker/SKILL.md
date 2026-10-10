---
name: research-tracker
description: "Track research topics on arXiv and send a digest only when new papers appear."
version: 0.1.0
author: Daylight
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Research, Arxiv, Monitoring, Digest, Daylight]
    category: daylight
    related_skills: [arxiv]
---

# Research tracker

Keeps a list of research topics for the user, checks arXiv for papers not seen before, and writes a short digest when there is something new. A script does the fetching and remembers what was already sent; you do the judging and the writing.

All commands use one script: `python3 ~/.hermes/scripts/daylight_research.py`.

## When the user manages topics

- Track a topic: `daylight_research.py add "retrieval-augmented generation evaluation"`. Use the user's wording as the name. Add `--category cs.CL` (repeatable) only if the user names a field. Pass `--query` with arXiv syntax (`ti:`, `abs:`, `au:`, `AND`, `OR`) only when the plain words would clearly miss or over-match, and tell the user the query you used.
- List topics: `daylight_research.py list`.
- Stop tracking: `daylight_research.py remove TOPIC_ID` (ids come from `list`).
- After adding, say what is tracked and that the first digest covers the past week. Do not promise a delivery time you have not checked with `hermes cron list`.

## When the user gives feedback on a digest

Feedback such as “more like the second one”, “less theory” or “skip surveys” belongs to that topic: `daylight_research.py note TOPIC_ID "prefers empirical papers; skip surveys"`. Write the note as a standing preference, not as a quote, then confirm to the user in one sentence what will change. `[SILENT]` is only for scheduled runs; in a conversation always answer. Facts about the user that matter beyond research (their field, their employer, what they are building) go to memory instead.

## When you are run by the schedule

The job's script has already fetched and deduplicated. Its output is in your prompt as `context.newPapersByTopic`: for each topic, its `notes` and a list of `papers` with title, authors, date, abstract and link. These papers have not been sent before and will not be offered again, so this is the only chance to mention them.

Write the digest from that data only:

1. For each topic, decide which papers are actually about it. A keyword match is not relevance. The test: would the paper's own title or first abstract sentence name this topic as its subject? If the topic is only a setting, a tool or a passing mention, drop the paper. Apply the topic's notes and what you know about the user.
2. Keep at most four papers per topic, most useful first. Fewer is normal: one or two strong papers make a better digest than four loose ones.
3. If no paper in a topic survives, leave the topic out. If nothing survives at all, reply with exactly `[SILENT]`.

Format, in plain text that reads well in a chat app (no tables, no headings syntax):

```
Research feed · 2026-10-10

Topic name — one sentence on what moved: the shared direction or the notable result.
1. Title — First Author et al. (2026-10-08)
   Why it matters for this topic, in one sentence drawn from the abstract.
   https://arxiv.org/abs/XXXX.XXXXX
2. …

Reply with what you want more or less of and I will adjust.
```

Rules:

- Every claim about a paper comes from its abstract. Do not add results, comparisons or venues that are not there, and do not guess at quality from the title.
- Use the link given; never construct one.
- Say “new on arXiv”, not “published”: these are preprints.
- If `context.errors` is non-empty, add one closing line naming the topics that could not be checked.
- Do not search for more papers, open PDFs, or schedule anything during a scheduled run.

## Pitfalls

- A topic with a very broad name (“machine learning”) returns the newest papers of an entire field. Ask the user to narrow it before adding.
- arXiv allows about one request every three seconds; the script already paces itself. Do not loop over it.
- `feed` marks papers as seen. Use `feed --dry-run` to look without consuming them.
