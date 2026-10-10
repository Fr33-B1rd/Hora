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

## In conversation: use the tool, not this skill

`mcp__daylight__research_topics` lists the topics, adds one, stops one, and saves a standing preference about one (“skip surveys”, “more benchmarks”). Its result says how to answer.

- “Track …” and “stop tracking …” change the topic list with this tool. They never change the schedule: the one morning job covers every topic.
- Feedback on a digest is a preference on that topic: save it with `action: note`, written as a standing instruction rather than a quote.
- Do not fetch papers during a conversation. The script's `feed` command belongs to the schedule: running it by hand uses up papers that the next digest should have delivered.
- Facts about the user that matter beyond research (their field, what they are building) go to memory.

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
