---
name: job-seeker
description: "Watches job postings against the user's CV and preferences and reports only real matches, with what fits, what is missing, and honest advice on adapting the CV."
version: 0.1.0
author: Daylight
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Jobs, Career, CV, Monitoring, Digest, Daylight]
    category: daylight
---

# Job seeker

Keeps watch on job postings for the user. A script reads Sweden's public job listings (Arbetsförmedlingen's Platsbanken) and two remote-job boards (Himalayas, Jobicy), rules out what the user's stated preferences exclude, and checks the rest against their CV requirement by requirement. A requirement counts as met only when the supporting words are found in the CV. You write the message; you do not decide what fits.

## In conversation: use the tools, not this skill

- `mcp__daylight__job_search_profile`: show or change what is being looked for, or store a CV the user pasted.
- `mcp__daylight__job_matches`: what has been found, look again now, or dismiss a match with a reason.
- `mcp__daylight__job_application_advice`: the posting, the CV and the rules for advising on one application.

Each result says how to answer. Do not run the script from a terminal during a conversation.

## When you are run by the schedule

The script has already searched and judged. Its output is in your prompt as `context.newMatches`: each with `title`, `employer`, `place`, `fit`, `met` and `of` (how many of the posting's main requirements the CV shows), `meets` (each requirement with the CV words that show it), `gaps` (requirements the CV does not show), `url`, `source`, and where known `deadline`. These have not been sent before and will not be offered again.

Write a short message, in plain text that reads well in a chat app:

```
Job matches · 2026-10-12

Data Scientist – Commercial, Embark Studios (Stockholm)
Meets 5 of 5 main requirements: SQL, Python, data pipelines, dashboards, explaining results.
Nothing missing that the posting lists.
Apply by 9 Nov · via Arbetsförmedlingen Platsbanken
https://arbetsformedlingen.se/platsbanken/annonser/31576617

Machine Learning Engineer, RaySearch Laboratories (Stockholm)
Meets 4 of 6: Python, PyTorch, 4+ years, English.
Missing: medical image segmentation; an MSc in computer science or ML.
https://…

Ask me how to adapt your CV for any of these, or tell me why one is wrong and I will stop sending that kind.
```

Rules:

- Best fit first, at most five. One block per job: title, employer and place; what it meets, as a count and a few words each; what is missing; the deadline if given and the source; the link on its own line.
- Take what it meets and what is missing only from `meets` and `gaps`. Shorten them; never add a reason of your own, and never turn a gap into a strength.
- Say “meets 4 of 6 main requirements”, not a percentage, and never predict whether they will get the job.
- Keep titles and employer names as given. Always include the link and the source name: the posting belongs to its source.
- If `newMatches` is empty, reply with exactly `[SILENT]`.

## Advice on a CV

Only when the user asks, and only through `job_application_advice`. The rule that matters most: never suggest adding a skill, tool, title, number or qualification that is not in the CV, and never suggest wording that implies one. Reordering, tightening, and using the posting's own term for something the CV already describes are fine. A gap is reported as a gap; ask whether they have that experience rather than assuming it.

## Pitfalls

- `feed` marks matches as sent. `feed --dry-run` looks without consuming them.
- Changing the CV or a preference clears earlier matches, because every verdict depended on them.
- The remote-job boards refresh once a day and are read at most once a day; Sweden's listings are read on every run.
- Postings open only to applicants in another country are ruled out before any model sees them, using the user's stated country.
