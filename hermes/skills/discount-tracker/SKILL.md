---
name: discount-tracker
description: "Grocery discounts, supermarket deals and food offers: check what is on offer now at Lidl Sverige, daily digest, remembers food likes and dislikes."
version: 0.1.0
author: Daylight
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Groceries, Discounts, Monitoring, Digest, Preferences, Daylight]
    category: daylight
---

# Discount tracker

Tells the user about new food offers at Lidl Sverige and leaves out what they do not want. A script reads Lidl's public weekly offer pages once a day, remembers which offers were already sent, and removes disliked products; you write the message and keep the user's preferences up to date.

## In conversation: use the tools, not this skill

Two tools cover everything the user can ask in a chat, and each result says how to answer from it:

- `mcp__daylight__grocery_offers`: what is on offer now (optionally one product). Likes, dislikes and what you remember about the user are already applied.
- `mcp__daylight__food_preference`: record a food the user likes or avoids, or withdraw one. Call it every time the user states one, however briefly, and save the fact to memory as well. A preference said once must hold from then on.

Do not run the script below from a terminal during a conversation, and do not answer a groceries question from a web search. Lidl Sverige is the only shop covered; if the user names another shop, say so, and search the web only if they ask you to, marking those results as unchecked.

## When you are run by the schedule

The job's script has already fetched, removed what the user avoids, and dropped offers sent before. Its output is in your prompt as `context`: `newOffers` (each with title, price, and where known `was`, `percentOff`, `unitPrice`, `pack`, `needsLidlPlus`, `from`, `until`, `youLike`), and `leftOut` (how many offers were removed, why, and up to three examples).

Write a short message from that data only, in plain text that reads well in a chat app:

```
Lidl offers · 2026-10-10

For you: Laxfilé 79 kr (was 99, −20%), until 18 Oct.

Best of the rest:
• Purjolök 4,90 kr (was 9,90, −50%), 15–18 Oct
• Röda druvor 19,90 kr/kg (−50%), 15–18 Oct
• …

Left out 3 pork offers, as you asked.
```

Rules:

- Start with offers marked `youLike`, if any. Then at most eight others, largest `percentOff` first; skip the “best of the rest” heading if there are none.
- Keep the Swedish product names as given. Prices in kr with a decimal comma. Add “with Lidl Plus” when `needsLidlPlus` is true. Give the dates once per line, compactly.
- If you know something else about the user that makes an offer unsuitable, leave it out and say so in the last line.
- Mention `leftOut` in one closing line with an example or two, so the user can see the preference is being applied and can object if something was removed wrongly. If nothing was left out, say nothing about it.
- Use only the offers given. No recipes, no opinions on quality, no prices or dates that are not in the data.
- If `newOffers` is empty, reply with exactly `[SILENT]`.

## Pitfalls

- Offers are national and for physical stores; stock varies by store. Say “offer”, not “in stock”.
- `feed` marks offers as sent. Use `feed --dry-run` to look without consuming them.
- The script fetches at most once a day. Do not loop over it or fetch Lidl pages yourself.
