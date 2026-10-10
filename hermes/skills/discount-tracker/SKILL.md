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

All commands use one script: `python3 ~/.hermes/scripts/daylight_deals.py`.

## When the user asks about grocery discounts, deals or offers

Any question such as “any grocery discounts?”, “check the deals”, “is chicken on offer?” is answered from this skill's data, not from a web search.

- Run `daylight_deals.py current` (add `--find kyckling` to look for one product; use the Swedish word, and try the English one if nothing matches).
- Answer from its output in plain text: offers marked `youLike` first, then the biggest discounts, at most eight lines, each with name, price, previous price or percentage, and the last day. Say how many more there are (`moreNotShown`).
- Say once that this is Lidl Sverige's national weekly offers. That is the only shop this skill covers. Do not search the web for other shops' promotions or delivery-app vouchers unless the user names that shop or asks you to look elsewhere; if they do, say that those results are unchecked.
- Apply what you remember about the user yourself. When `screenedByModel` is false the list has only been filtered by the stored match words, so leave out anything the user avoids (a dislike of pork covers fläsk, kotlett, karré, bacon, skinka, ribs, salami, prosciutto), and put what they like first.
- If your memory holds a food the user avoids or likes that is missing from `dislikes`/`likes` in the output, register it now with the `dislike`/`like` command so the daily message applies it too.
- Mention what was left out in one line, counting both `leftOut` and anything you removed yourself. Never write that the user has no dislikes when your memory says otherwise.
- This does not mark anything as sent, so tomorrow's digest is unaffected.

## When the user tells you what they like or avoid

This is the most important part: a preference said once must hold from then on.

- Avoids something (“I hate pork”, “no shellfish”, “I'm vegetarian”): run `daylight_deals.py dislike "pork" --terms fläsk,kotlett,karré,bacon,skinka,sidfläsk,revben,pulled pork`. The label is the user's word. The terms are the Swedish and English product words that identify it on a price tag: give the common ones, lowercase, comma-separated.
- Likes something (“I love salmon”): `daylight_deals.py like "salmon" --terms lax,salmon`.
- Changes their mind: `daylight_deals.py forget "pork"`.
- Also save the fact with the memory tool, because it matters outside groceries too (restaurant choices, recipes).
- Then confirm in one sentence what will change. `[SILENT]` is only for scheduled runs; in a conversation always answer.
- To show what is stored: `daylight_deals.py prefs`.

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
