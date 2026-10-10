#!/usr/bin/env python3
"""Daylight discount tracker: this week's food offers at Lidl Sverige, minus what the user dislikes.

Reads Lidl's public weekly offer pages (allowed by its robots.txt): at most one
fetch of each page per day, a few seconds apart, with a user agent that says
what this is. Standard library only. State: $HERMES_HOME/daylight/deals.json.

  daylight_deals.py                      scheduled-job mode (same as `feed`)
  daylight_deals.py feed [--dry-run] [--no-screen] [--refresh]
                                         offers not sent before, as one JSON line;
                                         {"wakeAgent": false} when there are none
  daylight_deals.py current [--find WORD] [--limit N]
                                         this week's offers right now, preferences applied;
                                         marks nothing as sent (for when the user asks)
  daylight_deals.py dislike LABEL --terms fläsk,kotlett,bacon
  daylight_deals.py like LABEL --terms lax,salmon
  daylight_deals.py forget LABEL
  daylight_deals.py prefs
"""
import argparse
import datetime as dt
import html as htmllib
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

SITE = "https://www.lidl.se"
USER_AGENT = "daylight-discount-tracker/0.1 (personal assistant; one request per page per day)"
FOOD, NOT_FOOD = "Mat och nära mat", ("Blommor",)
MAX_PAGES, PAUSE_SECONDS, MAX_DEALS, KEEP_SEEN_DAYS, SCREEN_BATCH = 8, 3.0, 40, 60, 35
FAST_MODEL = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"
TOKEN_FACTORY = "https://api.tokenfactory.us-central1.nebius.com/v1"


def home():
    return Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")


def state_path():
    return home() / "daylight" / "deals.json"


def load():
    path = state_path()
    state = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    for key, empty in (("seen", {}), ("likes", []), ("dislikes", []), ("cache", None)):
        state.setdefault(key, empty)
    return state


def save(state):
    path = state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)


try:
    from zoneinfo import ZoneInfo
    STOCKHOLM = ZoneInfo("Europe/Stockholm")
except Exception:  # no time zone data on this machine: summer time is close enough for a date
    STOCKHOLM = dt.timezone(dt.timedelta(hours=2))


def today():
    return dt.datetime.now(STOCKHOLM).date()


def local_date(timestamp):
    return dt.datetime.fromtimestamp(timestamp, STOCKHOLM).date()


def http_get(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=40) as response:
        return response.read().decode("utf-8", errors="replace")


def text_of(fragment):
    return " ".join(htmllib.unescape(re.sub(r"<[^>]+>", " ", fragment or "")).split())


def weekly_pages(home_html, day):
    """Offer pages linked from the home page whose dates include `day` (or start within two days)."""
    pages, seen = [], set()
    for href, inner in re.findall(r'<a[^>]+href="(/c/[^"#?]+/a\d+)"[^>]*>(.*?)</a>', home_html, re.S):
        label = text_of(inner)
        span = re.match(r"(?:Från\s+)?(\d{1,2})/(\d{1,2})(?:\s*-\s*(\d{1,2})/(\d{1,2}))?\s*(.*)", label)
        if href in seen or not span:
            continue
        seen.add(href)
        d1, m1, d2, m2, title = span.groups()
        try:
            start = dt.date(day.year, int(m1), int(d1))
            end = dt.date(day.year, int(m2), int(d2)) if d2 else start + dt.timedelta(days=13)
        except ValueError:
            continue
        if start - dt.timedelta(days=2) <= day <= end:
            pages.append({"path": href, "title": title.strip() or href.split("/")[2], "from": start.isoformat(), "until": end.isoformat()})
    return pages[:MAX_PAGES]


def deals_in(page_html, page):
    """Food offers embedded in a weekly page as structured product data."""
    deals = []
    for raw in re.findall(r'data-grid-data="([^"]{50,})"', page_html):
        try:
            item = json.loads(htmllib.unescape(raw))
        except ValueError:
            continue
        category = (item.get("keyfacts") or {}).get("wonCategoryPrimary") or ""
        if FOOD not in category or any(word in category for word in NOT_FOOD):
            continue
        price, plus, percent = item.get("price") or {}, False, None
        if price.get("price") is None and item.get("lidlPlus"):
            offer = item["lidlPlus"][0]
            price, plus = offer.get("price") or {}, True
            match = re.search(r"(\d+)\s*%", offer.get("highlightText") or "")
            percent = int(match.group(1)) if match else None
        if price.get("price") is None:
            continue
        discount = price.get("discount") or {}
        percent = percent or discount.get("percentageDiscount") or None
        start, end = page["from"], page["until"]
        for window in (item.get("stockAvailability") or {}).get("badgeInfoV2") or []:
            if window.get("validFrom") and window.get("validUntil"):
                a, b = local_date(window["validFrom"]), local_date(window["validUntil"])
                if a.isoformat() <= page["until"] and b.isoformat() >= page["from"]:
                    start, end = a.isoformat(), b.isoformat()
                    break
        title = text_of(item.get("fullTitle") or item.get("title") or "")
        if not title:
            continue
        deals.append({
            "id": f"{item.get('productId') or title}@{start}",
            "title": title,
            "price": price["price"],
            **({"was": price["oldPrice"]} if price.get("oldPrice") else {}),
            **({"percentOff": percent} if percent else {}),
            **({"unitPrice": price["basePrice"]["text"]} if (price.get("basePrice") or {}).get("text") else {}),
            **({"pack": price["packaging"]["text"]} if (price.get("packaging") or {}).get("text") else {}),
            **({"needsLidlPlus": True} if plus else {}),
            "from": start, "until": end,
            "category": " / ".join(category.split("/")[-2:]),
            "section": page["title"],
            **({"link": SITE + item["canonicalUrl"]} if item.get("canonicalUrl") else {}),
        })
    return deals


def current_deals(state, day, fetch=None, pause=None, refresh=False):
    """Today's offers, fetched at most once a day."""
    fetch, pause = fetch or http_get, PAUSE_SECONDS if pause is None else pause
    cache = state.get("cache")
    if cache and cache.get("date") == day.isoformat() and not refresh:
        return cache["deals"], cache.get("pages", []), []
    pages, deals, errors, seen = weekly_pages(fetch(SITE + "/"), day), [], [], set()
    for page in pages:
        if pause:
            time.sleep(pause)
        try:
            found = deals_in(fetch(SITE + page["path"]), page)
        except Exception as error:  # one failing page must not hide the others
            errors.append({"page": page["title"], "error": str(error)[:160]})
            continue
        for deal in found:
            if deal["id"] not in seen:
                seen.add(deal["id"])
                deals.append(deal)
    if deals:
        state["cache"] = {"date": day.isoformat(), "deals": deals, "pages": [p["title"] for p in pages]}
    return deals, [p["title"] for p in pages], errors


def matches(deal, terms):
    haystack = f"{deal['title']} {deal['category']}".lower()
    return any(term and term.lower() in haystack for term in terms)


def ask_fast_model(prompt, timeout=90):
    body = json.dumps({
        # The model reasons before it answers; a low cap ends the reply before any answer appears.
        "model": os.environ.get("DAYLIGHT_FAST_MODEL", FAST_MODEL), "temperature": 0, "max_tokens": 8000,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()
    request = urllib.request.Request(
        (os.environ.get("NEBIUS_BASE_URL") or TOKEN_FACTORY).rstrip("/") + "/chat/completions", data=body,
        headers={"Authorization": "Bearer " + os.environ["NEBIUS_API_KEY"], "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)["choices"][0]["message"].get("content") or ""


def profile():
    """What Hermes remembers about the user in general; a dislike stated in any conversation counts here."""
    path = home() / "memories" / "USER.md"
    return path.read_text(encoding="utf-8")[:1500] if path.exists() else ""


def screen(deals, dislikes, about_user, ask=ask_fast_model):
    """Offers the user would not want, judged by a small model: catches what keyword terms miss
    (Swedish product names, cuts of meat). Any failure hides nothing."""
    if not deals or not (dislikes or about_user.strip()):
        return [], False
    # A long list makes the model run out of tokens while still reasoning, so it
    # is judged in batches, each with one retry. A batch that still fails hides nothing.
    verdicts, complete = [], True
    for offset in range(0, len(deals), SCREEN_BATCH):
        batch = deals[offset:offset + SCREEN_BATCH]
        for _attempt in (1, 2):
            found = _screen_batch(batch, dislikes, about_user, ask)
            if found is not None:
                verdicts += [(offset + n, why) for n, why in found]
                break
        else:
            complete = False
    return verdicts, complete


def _screen_batch(deals, dislikes, about_user, ask):
    listing = "\n".join(f"{i}: {d['title']} ({d['category']})" for i, d in enumerate(deals))
    prompt = (
        "You filter Swedish supermarket offers for one shopper.\n"
        f"WHAT WE KNOW ABOUT THE SHOPPER:\n{about_user.strip() or '(nothing)'}\n"
        f"THINGS THEY SAID THEY DO NOT WANT: {', '.join(d['label'] for d in dislikes) or '(none listed)'}\n\n"
        "Offers (number: Swedish product name (category)):\n"
        f"{listing}\n\n"
        "List the numbers of offers this shopper would not want because of a stated dislike, allergy or diet. "
        "Judge the product itself: for example a dislike of pork covers fläsk, kotlett, karré, bacon, skinka and pork sausages. "
        "Do not hide anything for any other reason.\n"
        'Reply with JSON only, for example {"hide": [{"n": 3, "why": "pork"}]}. An empty list is a valid answer.'
    )
    try:
        match = re.search(r"\{.*\}", ask(prompt), re.S)
        hide = json.loads(match.group(0))["hide"]
        return [(int(h["n"]), str(h.get("why") or "preference")[:40]) for h in hide if 0 <= int(h["n"]) < len(deals)]
    except Exception:
        return None


def select(state, deals, about_user="", screen_with=None):
    """New offers, with disliked ones removed (reason -> titles) and liked ones marked and put first."""
    fresh = [d for d in deals if d["id"] not in state["seen"]]
    hidden, kept = {}, []
    for deal in fresh:
        label = next((p["label"] for p in state["dislikes"] if matches(deal, p["terms"])), None)
        if label:
            hidden.setdefault(label, []).append(deal["title"])
        else:
            kept.append(deal)
    screened = False
    if screen_with and kept:
        verdicts, screened = screen_with(kept, state["dislikes"], about_user)
        drop = dict(verdicts)
        for index in drop:
            hidden.setdefault(drop[index], []).append(kept[index]["title"])
        kept = [d for i, d in enumerate(kept) if i not in drop]
    for deal in kept:
        liked = next((p["label"] for p in state["likes"] if matches(deal, p["terms"])), None)
        if liked:
            deal["youLike"] = liked
    kept.sort(key=lambda d: (0 if d.get("youLike") else 1, -(d.get("percentOff") or 0), d["title"]))
    return fresh, kept[:MAX_DEALS], hidden, screened


def feed(args):
    state, day = load(), today()
    try:
        deals, pages, errors = current_deals(state, day, refresh=args.refresh)
    except Exception as error:
        print(json.dumps({"wakeAgent": False, "error": str(error)[:200]}))
        return
    use_model = bool(os.environ.get("NEBIUS_API_KEY")) and not args.no_screen
    fresh, kept, hidden, screened = select(state, deals, profile(), screen if use_model else None)
    if args.dry_run and state.get("cache"):
        # A dry run consumes nothing, but still records today's pages so they are not fetched twice.
        kept_state = load()
        kept_state["cache"] = state["cache"]
        save(kept_state)
    if not args.dry_run:
        for deal in fresh:  # hidden offers count as seen too: they are not offered again tomorrow
            state["seen"][deal["id"]] = day.isoformat()
        cutoff = (day - dt.timedelta(days=KEEP_SEEN_DAYS)).isoformat()
        state["seen"] = {k: v for k, v in state["seen"].items() if v >= cutoff}
        save(state)
    if not kept:
        print(json.dumps({"wakeAgent": False}))
        return
    print(json.dumps({"wakeAgent": True, "context": {
        "date": day.isoformat(), "store": "Lidl Sverige (national weekly offers)", "newOffers": kept,
        "leftOut": [{"reason": k, "count": len(v), "examples": v[:3]} for k, v in hidden.items()], "screenedByModel": screened,
        "likes": [p["label"] for p in state["likes"]], "dislikes": [p["label"] for p in state["dislikes"]],
        "sections": pages, "errors": errors,
    }}, ensure_ascii=False))


def current(args):
    """What is on offer right now, for a question in conversation. Nothing is marked as sent."""
    state, day = load(), today()
    try:
        deals, pages, errors = current_deals(state, day)
    except Exception as error:
        print(json.dumps({"error": "Could not read Lidl's offer pages: " + str(error)[:160]}))
        return
    if state.get("cache"):
        kept_state = load()
        kept_state["cache"] = state["cache"]
        save(kept_state)
    live = [d for d in deals if d["until"] >= day.isoformat()]
    if args.find:
        live = [d for d in live if matches(d, [args.find])]
    view = dict(state, seen={})  # everything current counts, sent before or not
    use_model = bool(os.environ.get("NEBIUS_API_KEY")) and not args.no_screen
    _fresh, kept, hidden, screened = select(view, live, profile(), screen if use_model else None)
    print(json.dumps({
        "date": day.isoformat(), "store": "Lidl Sverige (national weekly offers)", "totalOffers": len(live),
        "offers": kept[:args.limit], "moreNotShown": max(0, len(kept) - args.limit),
        "leftOut": [{"reason": k, "count": len(v), "examples": v[:3]} for k, v in hidden.items()], "screenedByModel": screened,
        "likes": [p["label"] for p in state["likes"]], "dislikes": [p["label"] for p in state["dislikes"]], "errors": errors,
    }, ensure_ascii=False))


def remember(kind):
    def run(args):
        state = load()
        terms = sorted({t.strip().lower() for t in (args.terms or "").split(",") if t.strip()} | {args.label.strip().lower()})
        for other in ("likes", "dislikes"):
            state[other] = [p for p in state[other] if p["label"].lower() != args.label.strip().lower()]
        state[kind].append({"label": args.label.strip(), "terms": terms, "since": today().isoformat()})
        save(state)
        print(json.dumps({kind: state[kind]}, ensure_ascii=False))
    return run


def forget(args):
    state = load()
    before = len(state["likes"]) + len(state["dislikes"])
    for kind in ("likes", "dislikes"):
        state[kind] = [p for p in state[kind] if p["label"].lower() != args.label.strip().lower()]
    save(state)
    print(json.dumps({"forgot": args.label, "found": before != len(state["likes"]) + len(state["dislikes"])}))


def prefs(_args):
    state = load()
    print(json.dumps({"likes": state["likes"], "dislikes": state["dislikes"], "generalMemory": profile(),
                      "lastFetched": (state.get("cache") or {}).get("date")}, ensure_ascii=False, indent=1))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command")
    p = commands.add_parser("feed")
    for flag in ("--dry-run", "--no-screen", "--refresh"):
        p.add_argument(flag, action="store_true")
    p.set_defaults(run=feed)
    for name in ("like", "dislike"):
        p = commands.add_parser(name); p.add_argument("label"); p.add_argument("--terms"); p.set_defaults(run=remember(name + "s"))
    p = commands.add_parser("current"); p.add_argument("--find"); p.add_argument("--limit", type=int, default=12); p.add_argument("--no-screen", action="store_true"); p.set_defaults(run=current)
    p = commands.add_parser("forget"); p.add_argument("label"); p.set_defaults(run=forget)
    p = commands.add_parser("prefs"); p.set_defaults(run=prefs)
    args = parser.parse_args(argv)
    if not args.command:  # how the scheduler calls it
        args = parser.parse_args(["feed"])
    args.run(args)


if __name__ == "__main__":
    main()
