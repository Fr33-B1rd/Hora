#!/usr/bin/env python3
"""Daylight research tracker: topics, and a feed of arXiv papers not seen before.

Standard library only. State lives in $HERMES_HOME/daylight/research.json.

  daylight_research.py                     scheduled-job mode (same as `feed`)
  daylight_research.py feed [--dry-run] [--no-screen]
                                           new papers per topic as one JSON line, screened for
                                           relevance by a small model when NEBIUS_API_KEY is set;
                                           {"wakeAgent": false} when there are none
  daylight_research.py add NAME [--query ARXIV_QUERY] [--category cs.CL ...]
  daylight_research.py list
  daylight_research.py remove TOPIC_ID
  daylight_research.py note TOPIC_ID TEXT  remember what the user wants more or less of
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

API = "https://export.arxiv.org/api/query"
ATOM = {"a": "http://www.w3.org/2005/Atom"}
STOPWORDS = {
    "a", "an", "and", "the", "of", "for", "in", "on", "to", "with", "about", "using", "via", "that", "which", "who",
    "is", "are", "be", "by", "from", "how", "their", "its", "new", "recent", "latest", "research", "papers", "paper",
    "work", "use", "uses", "used", "based", "towards", "toward", "into", "or", "as", "at",
}
FIRST_RUN_DAYS, PER_TOPIC, ABSTRACT_CHARS, KEEP_SEEN_DAYS = 7, 8, 900, 120
FAST_MODEL = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"  # screening many abstracts is a small-model job
TOKEN_FACTORY = "https://api.tokenfactory.us-central1.nebius.com/v1"


def state_path():
    home = Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")
    return home / "daylight" / "research.json"


def load():
    path = state_path()
    if not path.exists():
        return {"topics": [], "seen": {}, "lastBatch": None}
    return json.loads(path.read_text(encoding="utf-8"))


def save(state):
    path = state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)


def today():
    return dt.datetime.now(dt.timezone.utc).date()


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "topic"


def default_query(name):
    """Every meaningful word must appear in the title or the abstract."""
    words = [w for w in re.findall(r"[A-Za-z0-9][A-Za-z0-9-]*", name) if w.lower() not in STOPWORDS]
    return " AND ".join(f"(ti:{w} OR abs:{w})" for w in words) or f'all:"{name}"'


def search(topic, limit=25, fetch=None):
    query = topic["query"]
    if topic.get("categories"):
        query = f"({query}) AND (" + " OR ".join(f"cat:{c}" for c in topic["categories"]) + ")"
    url = API + "?" + urllib.parse.urlencode(
        {"search_query": query, "sortBy": "submittedDate", "sortOrder": "descending", "max_results": limit}
    )
    if fetch is None:
        request = urllib.request.Request(url, headers={"User-Agent": "daylight-research-tracker/1.0"})
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read()
    else:
        body = fetch(url)
    papers = []
    for entry in ET.fromstring(body).findall("a:entry", ATOM):
        text = lambda tag: " ".join((entry.findtext(f"a:{tag}", "", ATOM) or "").split())
        link = text("id")
        if "/abs/" not in link:
            continue
        authors = [a.findtext("a:name", "", ATOM) for a in entry.findall("a:author", ATOM)]
        paper_id = re.sub(r"v\d+$", "", link.split("/abs/")[-1])
        papers.append({
            "id": paper_id,
            "title": text("title"),
            "authors": authors[:3] + (["et al."] if len(authors) > 3 else []),
            "published": text("published")[:10],
            "abstract": text("summary")[:ABSTRACT_CHARS],
            "link": "https://arxiv.org/abs/" + paper_id,
            "categories": [c.get("term") for c in entry.findall("a:category", ATOM)][:4],
        })
    return papers


def ask_fast_model(prompt, timeout=60):
    """One call to the small Nemotron on Nebius Token Factory; returns the reply text."""
    body = json.dumps({
        # The model reasons before it answers; a low cap ends the reply before any answer appears.
        "model": os.environ.get("DAYLIGHT_FAST_MODEL", FAST_MODEL), "temperature": 0, "max_tokens": 6000,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()
    request = urllib.request.Request(
        (os.environ.get("NEBIUS_BASE_URL") or TOKEN_FACTORY).rstrip("/") + "/chat/completions", data=body,
        headers={"Authorization": "Bearer " + os.environ["NEBIUS_API_KEY"], "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)["choices"][0]["message"].get("content") or ""


def screen(topic, papers, ask=ask_fast_model):
    """Keep the papers whose main subject is the topic. Any failure keeps them all."""
    listing = "\n\n".join(f"[{p['id']}] {p['title']}\n{p['abstract'][:600]}" for p in papers)
    notes = "; ".join(topic.get("notes", [])) or "none"
    prompt = (
        "You screen new arXiv papers for a reader who follows one research topic.\n"
        f"TOPIC: {topic['name']}\nREADER PREFERENCES: {notes}\n\n"
        "Keep a paper only if the topic is its main subject: its own title or first abstract sentence would name it. "
        "Drop papers where the topic is just a setting, a tool, or a passing mention, and papers the preferences exclude.\n\n"
        f"{listing}\n\n"
        'Reply with JSON only, for example {"keep": ["2610.00001"]}. An empty list is a valid answer.'
    )
    try:
        match = re.search(r"\{.*\}", ask(prompt), re.S)
        keep = set(json.loads(match.group(0))["keep"])
        return [p for p in papers if p["id"] in keep], True
    except Exception:
        return papers, False


def collect(state, fetch=None, pause=3.0, screen_with=None):
    """Unseen papers per topic. A new topic starts from the last week, not from all time."""
    now, batch, errors = today(), [], []
    for index, topic in enumerate(state["topics"]):
        if index and pause:
            time.sleep(pause)  # arXiv asks for at most one request every three seconds
        try:
            found = search(topic, fetch=fetch)
        except Exception as error:  # one failing topic must not hide the others
            errors.append({"topic": topic["name"], "error": str(error)[:200]})
            continue
        since = topic.get("lastChecked") or (now - dt.timedelta(days=FIRST_RUN_DAYS)).isoformat()
        floor = (dt.date.fromisoformat(since) - dt.timedelta(days=2)).isoformat()  # listings lag submission
        unseen = [p for p in found if p["id"] not in state["seen"] and p["published"] >= floor]
        fresh = unseen[:PER_TOPIC]
        topic["lastChecked"] = now.isoformat()
        # Everything in this listing counts as seen, including what did not fit:
        # the next run should report new submissions, not drain a backlog.
        for paper in unseen:
            state["seen"][paper["id"]] = now.isoformat()
        screened = False
        if fresh and screen_with:
            offered = len(fresh)
            fresh, screened = screen_with(topic, fresh)
        if fresh:
            batch.append({"topic": topic["name"], "topicId": topic["id"], "notes": topic.get("notes", []), "papers": fresh,
                          **({"screenedOut": offered - len(fresh)} if screened else {})})
    cutoff = (now - dt.timedelta(days=KEEP_SEEN_DAYS)).isoformat()
    state["seen"] = {k: v for k, v in state["seen"].items() if v >= cutoff}
    return batch, errors


def feed(args):
    state = load()
    if not state["topics"]:
        print(json.dumps({"wakeAgent": False}))
        return
    batch, errors = collect(state, screen_with=screen if os.environ.get("NEBIUS_API_KEY") and not args.no_screen else None)
    if not args.dry_run:
        if batch:
            state["lastBatch"] = {"date": today().isoformat(), "topics": batch}
        state["lastErrors"] = errors
        save(state)
    if not batch:
        print(json.dumps({"wakeAgent": False}))
        return
    print(json.dumps({"wakeAgent": True, "context": {"date": today().isoformat(), "newPapersByTopic": batch, "errors": errors}}, ensure_ascii=False))


def add(args):
    state = load()
    topic_id, base, n = slug(args.name), slug(args.name), 2
    while any(t["id"] == topic_id for t in state["topics"]):
        topic_id, n = f"{base}-{n}", n + 1
    topic = {"id": topic_id, "name": args.name, "query": args.query or default_query(args.name),
             "categories": args.category or [], "notes": [], "added": today().isoformat()}
    state["topics"].append(topic)
    save(state)
    print(json.dumps({"added": topic}, ensure_ascii=False))


def list_topics(_args):
    state = load()
    print(json.dumps({"topics": state["topics"], "lastBatchDate": (state.get("lastBatch") or {}).get("date"),
                      "lastErrors": state.get("lastErrors", [])}, ensure_ascii=False, indent=1))


def find(state, topic_id):
    for topic in state["topics"]:
        if topic["id"] == topic_id:
            return topic
    sys.exit(f"No topic with id {topic_id!r}. Known: {', '.join(t['id'] for t in state['topics']) or 'none'}")


def remove(args):
    state = load()
    topic = find(state, args.topic_id)
    state["topics"].remove(topic)
    save(state)
    print(json.dumps({"removed": topic["name"]}, ensure_ascii=False))


def note(args):
    state = load()
    topic = find(state, args.topic_id)
    topic.setdefault("notes", []).append(args.text.strip()[:240])
    topic["notes"] = topic["notes"][-8:]
    save(state)
    print(json.dumps({"topic": topic["name"], "notes": topic["notes"]}, ensure_ascii=False))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command")
    p = commands.add_parser("feed"); p.add_argument("--dry-run", action="store_true"); p.add_argument("--no-screen", action="store_true"); p.set_defaults(run=feed)
    p = commands.add_parser("add"); p.add_argument("name"); p.add_argument("--query"); p.add_argument("--category", action="append"); p.set_defaults(run=add)
    p = commands.add_parser("list"); p.set_defaults(run=list_topics)
    p = commands.add_parser("remove"); p.add_argument("topic_id"); p.set_defaults(run=remove)
    p = commands.add_parser("note"); p.add_argument("topic_id"); p.add_argument("text"); p.set_defaults(run=note)
    args = parser.parse_args(argv)
    if not args.command:  # how the scheduler calls it
        args = parser.parse_args(["feed"])
    args.run(args)


if __name__ == "__main__":
    main()
