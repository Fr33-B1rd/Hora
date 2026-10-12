#!/usr/bin/env python3
"""Daylight job seeker: watches job postings for ones that fit the user's CV and preferences.

Sources, all public APIs used as their owners allow, each credited with a link to the
original posting: Arbetsförmedlingen's JobSearch (Sweden), Himalayas and Jobicy (remote
roles, read at most once a day). Standard library only. State: $HERMES_HOME/daylight/jobs.json.

  daylight_jobs.py                       scheduled-job mode (same as `feed`)
  daylight_jobs.py feed [--dry-run]      look for new postings, judge them, and print the new
                                         matches as one JSON line; {"wakeAgent": false} if none
  daylight_jobs.py current [--refresh] [--limit N]
                                         matches found so far (with --refresh, look now first);
                                         marks nothing as sent
  daylight_jobs.py show ID               one match with the posting text, and the CV, for advice
  daylight_jobs.py dismiss ID [--why TEXT]   drop a match; the reason becomes a standing note
  daylight_jobs.py cv --file PATH [--name NAME]   store the CV text (or --stdin)
  daylight_jobs.py forget-cv
  daylight_jobs.py prefs [--roles a,b] [--places a,b] [--remote yes|no|only] [--languages a,b]
                         [--avoid a,b] [--seniority TEXT] [--country NAME] [--note TEXT] [--clear FIELD]
                                         show preferences, changing the ones given
"""
import argparse
import datetime as dt
import html as htmllib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

USER_AGENT = "daylight-job-seeker/0.1 (personal assistant; a few requests per run)"
JOBTECH = "https://jobsearch.api.jobtechdev.se/search"
HIMALAYAS = "https://himalayas.app/jobs/api/search"
JOBICY = "https://jobicy.com/api/v2/remote-jobs"
FAST_MODEL = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"   # lists what a posting requires
JUDGE_MODEL = "nvidia/nemotron-3-super-120b-a12b"     # checks those requirements against the CV: the small model is erratic at this
TOKEN_FACTORY = "https://api.tokenfactory.us-central1.nebius.com/v1"
MAX_ROLES, PER_QUERY, MAX_JUDGED, BATCH, GOOD_FIT, MAX_SENT = 6, 30, 30, 3, 67, 5
MIN_NEEDS, MAX_NEEDS, REMOTE_MAX_AGE_DAYS = 3, 6, 30
FIRST_LOOK_DAYS, KEEP_DAYS, CV_CHARS, AD_CHARS, KEEP_AD_CHARS = 7, 45, 6000, 3500, 6000
PREF_LISTS = ("roles", "places", "languages", "avoid")
ANYWHERE = ("worldwide", "anywhere", "global", "international", "europe", "eu", "emea", "european union")


def home():
    return Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")


def state_path():
    return home() / "daylight" / "jobs.json"


def load():
    path = state_path()
    state = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    for key, empty in (("cv", None), ("prefs", {}), ("seen", {}), ("matches", []), ("sent", {}), ("remote", None), ("lastRun", None), ("errors", [])):
        state.setdefault(key, empty)
    prefs = state["prefs"]
    for key in PREF_LISTS + ("notes",):
        prefs.setdefault(key, [])
    prefs.setdefault("remote", "yes")
    prefs.setdefault("country", "Sweden")
    prefs.setdefault("seniority", None)
    return state


def save(state):
    path = state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)


def now():
    return dt.datetime.now(dt.timezone.utc)


def http_json(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=40) as response:
        return json.load(response)


def text_of(fragment):
    return " ".join(htmllib.unescape(re.sub(r"<[^>]+>", " ", fragment or "")).split())


def iso_date(value):
    """A date as YYYY-MM-DD from an ISO string or a Unix timestamp; None if unreadable."""
    try:
        if isinstance(value, (int, float)):
            return dt.datetime.fromtimestamp(value, dt.timezone.utc).date().isoformat()
        return dt.date.fromisoformat(str(value)[:10]).isoformat()
    except (ValueError, OSError, OverflowError):
        return None


# ---- sources: each returns postings in one shape ----

def posting(source, key, title, employer, place, remote, url, published, deadline, text, open_to=None, credit=None):
    return {"id": f"{source}:{key}", "source": source, "title": text_of(title), "employer": text_of(employer), "place": place or "",
            "remote": bool(remote), "url": url, "published": iso_date(published), "deadline": iso_date(deadline),
            "text": text_of(text)[:KEEP_AD_CHARS], "openTo": open_to or [], "credit": credit or source}


def from_jobtech(hit):
    address = hit.get("workplace_address") or {}
    place = ", ".join(dict.fromkeys(p for p in (address.get("municipality") or address.get("city"), address.get("region")) if p))
    text = (hit.get("description") or {}).get("text") or ""
    remote = bool(re.search(r"\b(remote|distans|på distans|hybrid)\b", (hit.get("headline") or "") + " " + text[:1500], re.I)) and "hybrid" not in text[:1500].lower()
    return posting("jobtech", hit["id"], hit.get("headline"), (hit.get("employer") or {}).get("name"), place, remote,
                   hit.get("webpage_url"), hit.get("publication_date"), hit.get("application_deadline"), text,
                   credit="Arbetsförmedlingen Platsbanken")


def from_himalayas(job):
    return posting("himalayas", job.get("guid") or job.get("applicationLink"), job.get("title"), job.get("companyName"),
                   "Remote", True, job.get("applicationLink") or job.get("guid"), job.get("pubDate"), job.get("expiryDate"),
                   job.get("description") or job.get("excerpt"), open_to=job.get("locationRestrictions") or [], credit="Himalayas")


def from_jobicy(job):
    geo = [g.strip() for g in str(job.get("jobGeo") or "").split(",") if g.strip()]
    return posting("jobicy", job.get("id"), job.get("jobTitle"), job.get("companyName"), "Remote", True, job.get("url"),
                   job.get("pubDate"), None, job.get("jobDescription") or job.get("jobExcerpt"), open_to=geo, credit="Jobicy")


def search_sweden(roles, since_minutes, fetch=None, pause=1.0):
    fetch, found, errors = fetch or http_json, {}, []
    for index, role in enumerate(roles[:MAX_ROLES]):
        if index and pause:
            time.sleep(pause)
        query = urllib.parse.urlencode({"q": role, "limit": PER_QUERY, "sort": "pubdate-desc", "published-after": int(since_minutes)})
        try:
            for hit in fetch(f"{JOBTECH}?{query}").get("hits") or []:
                if not hit.get("removed"):
                    job = from_jobtech(hit)
                    found.setdefault(job["id"], job)
        except Exception as error:  # one failing query must not hide the others
            errors.append({"source": "Arbetsförmedlingen", "query": role, "error": str(error)[:160]})
    return list(found.values()), errors


def search_remote(roles, fetch=None, pause=1.0):
    fetch, found, errors = fetch or http_json, {}, []
    for index, role in enumerate(roles[:MAX_ROLES]):
        for name, url, key, convert in (
            ("Himalayas", f"{HIMALAYAS}?{urllib.parse.urlencode({'q': role, 'limit': 20})}", "jobs", from_himalayas),
            ("Jobicy", f"{JOBICY}?{urllib.parse.urlencode({'count': 30, 'tag': role})}", "jobs", from_jobicy),
        ):
            if (index or name == "Jobicy") and pause:
                time.sleep(pause)
            try:
                for raw in fetch(url).get(key) or []:
                    job = convert(raw)
                    found.setdefault(job["id"], job)
            except Exception as error:
                errors.append({"source": name, "query": role, "error": str(error)[:160]})
    return list(found.values()), errors


# ---- what code can decide without a model ----

SWEDISH = {"och", "att", "för", "med", "som", "är", "vi", "du", "på", "av", "till", "den", "det", "har", "inom", "vår", "våra", "söker", "dig"}


def looks_swedish(text):
    words = re.findall(r"[a-zåäöé]+", text.lower())[:300]
    return len(words) >= 40 and sum(w in SWEDISH for w in words) / len(words) > 0.12


def speaks(prefs, language):
    return any(language in l.lower() for l in prefs["languages"])


def role_words(prefs):
    stop = {"and", "the", "for", "senior", "junior", "lead", "principal", "staff", "manager", "engineer", "developer", "specialist"}
    words = {w for role in prefs["roles"] for w in re.findall(r"[a-zåäö+#]{3,}", role.lower())}
    return (words - stop) or words


def ruled_out(job, prefs, today):
    """Why this posting cannot fit, from stated preferences alone, as (kind, detail); None if it may."""
    blob = f"{job['title']} {job['employer']} {job['text']}".lower()
    for term in prefs["avoid"]:
        if term and term.lower() in blob:
            return "contains something you avoid", f"contains “{term}”"
    if job["deadline"] and job["deadline"] < today:
        return "application deadline has passed", job["deadline"]
    if job["source"] == "jobtech":
        if prefs["remote"] == "only" and not job["remote"]:
            return "not a remote role", job["place"]
        places = [p.lower() for p in prefs["places"]]
        if places and not job["remote"] and not any(p in job["place"].lower() for p in places):
            return "outside your places", job["place"] or "place not stated"
        if prefs["languages"] and not (speaks(prefs, "swedish") or speaks(prefs, "svenska")) and looks_swedish(job["text"]):
            return "written in Swedish, not one of your working languages", ""
    else:
        if prefs["remote"] == "no":
            return "remote role, and you want on-site only", ""
        allowed = [a.lower() for a in job["openTo"]]
        country = (prefs.get("country") or "").lower()
        if allowed and country and not any(a == country or a in ANYWHERE for a in allowed):
            return "remote, but not open to applicants where you live", ", ".join(job["openTo"][:3])
        words = role_words(prefs)
        if words and not any(w in job["title"].lower() for w in words):
            return "title does not match your roles", job["title"]
        if job["published"] and job["published"] < (dt.date.fromisoformat(today) - dt.timedelta(days=REMOTE_MAX_AGE_DAYS)).isoformat():
            return "posted more than a month ago", job["published"]
    return None


# ---- the judgment a model makes ----

def model_settings():
    """Key and endpoint for the small model. A scheduled job inherits them from the
    gateway; a command the agent runs in its terminal does not, so they are then
    read from the env file the installer pointed to. The key is never stored here."""
    found = {name: os.environ.get(name) for name in ("NEBIUS_API_KEY", "NEBIUS_BASE_URL")}
    if not found["NEBIUS_API_KEY"]:
        try:
            env_file = json.loads((home() / "daylight" / "config.json").read_text(encoding="utf-8"))["envFile"]
            for line in Path(env_file).read_text(encoding="utf-8").splitlines():
                name, _, value = line.partition("=")
                if name.strip() in found and not found[name.strip()]:
                    found[name.strip()] = value.strip().strip("'\"")
        except (OSError, ValueError, KeyError):
            pass
    return found["NEBIUS_API_KEY"], (found["NEBIUS_BASE_URL"] or TOKEN_FACTORY).rstrip("/")


def ask_fast_model(prompt, timeout=120, model=None):
    key, base = model_settings()
    body = json.dumps({
        # The model reasons before it answers; a low cap ends the reply before any answer appears.
        "model": model or os.environ.get("DAYLIGHT_FAST_MODEL", FAST_MODEL), "temperature": 0, "max_tokens": 8000,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()
    request = urllib.request.Request(base + "/chat/completions", data=body,
                                     headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)["choices"][0]["message"].get("content") or ""


def ask_judge_model(prompt, timeout=150):
    return ask_fast_model(prompt, timeout, os.environ.get("DAYLIGHT_JUDGE_MODEL", JUDGE_MODEL))


def excerpt(text):
    """The part of a posting sent to the model: requirements usually sit in the second half, so a long posting keeps its opening and its end."""
    return text if len(text) <= AD_CHARS else text[:AD_CHARS // 4] + " […] " + text[-(AD_CHARS * 3 // 4):]


def describe(prefs):
    lines = [f"Roles wanted: {', '.join(prefs['roles']) or '(not stated)'}",
             f"Places: {', '.join(prefs['places']) or '(anywhere)'}; remote work: {prefs['remote']}; lives in {prefs.get('country') or '(not stated)'}",
             f"Working languages: {', '.join(prefs['languages']) or '(not stated)'}",
             f"Level: {prefs.get('seniority') or '(not stated)'}"]
    if prefs["notes"]:
        lines.append("Standing notes from the candidate: " + "; ".join(prefs["notes"]))
    return "\n".join(lines)


def in_cv(evidence, cv_text):
    """True when a quoted piece of evidence really comes from the CV: most of its words are there.
    This is what stops the model from crediting the candidate with something the CV never says."""
    words = [w for w in re.findall(r"[a-zåäöé0-9+#]{3,}", str(evidence).lower()) if w not in {"the", "and", "for", "with", "experience", "years"}]
    cv = cv_text.lower()
    return bool(words) and sum(w in cv for w in words) / len(words) >= 0.7


def verdict_from(item, cv_text):
    """Turn the model's requirement-by-requirement reading into a verdict the code can stand behind:
    a requirement counts as met only with evidence found in the CV, and fit is the share that are met."""
    needs = [r for r in (item.get("requirements") or []) if isinstance(r, dict) and str(r.get("need") or "").strip()][:MAX_NEEDS]
    meets, gaps = [], []
    for r in needs:
        need, evidence = str(r["need"]).strip()[:120], str(r.get("evidence") or "").strip()[:110]
        if r.get("met") is True and in_cv(evidence, cv_text):
            meets.append(f"{need}: “{evidence}”")
        else:
            gaps.append(need)
    wanted = item.get("wanted") is True
    fit = round(100 * len(meets) / len(needs)) if needs else 0
    return {"fit": fit if wanted and len(needs) >= MIN_NEEDS else min(fit, GOOD_FIT - 1), "meets": meets, "gaps": gaps,
            "met": len(meets), "of": len(needs), "wanted": wanted}


def read_json(reply):
    return json.loads(re.search(r"\{.*\}", reply, re.S).group(0))


def judge_batch(jobs, cv_text, prefs, ask, ask_check):
    """Two readings, so that what a posting asks for is settled before the CV is in view:
    a model shown both at once lists only the requirements the candidate happens to meet."""
    listing = "\n\n".join(f"[{i}] {j['title']} at {j['employer']} ({j['place']})\n{excerpt(j['text'])}" for i, j in enumerate(jobs))
    extract = (
        "List what each job posting requires of an applicant.\n\nPOSTINGS:\n" + listing + "\n\n"
        f"For each posting give its {MIN_NEEDS} to {MAX_NEEDS} most important requirements, in the posting's own order: skills, tools, years or kind of "
        "experience, domain knowledge, education, languages. Each a short phrase in English, specific enough to check against a CV "
        "(“5+ years of Python”, “experience in game analytics”, “fluent Swedish”), not a soft quality (“team player”). "
        "One thing per item, under twelve words: where a posting lists many tools together, name the two or three that matter most as separate items.\n"
        'Reply with JSON only: {"jobs": [{"n": 0, "requirements": ["...", "..."]}]} with one entry per posting.'
    )
    try:
        asked = {}
        for item in read_json(ask(extract))["jobs"]:
            n = int(item["n"])
            if 0 <= n < len(jobs):
                asked[n] = [str(r).strip()[:120] for r in (item.get("requirements") or []) if str(r).strip()][:MAX_NEEDS]
        if not asked:
            return None
        checklist = "\n\n".join(f"[{n}] {jobs[n]['title']} at {jobs[n]['employer']}\n" + "\n".join(f"  {k}. {need}" for k, need in enumerate(needs))
                                for n, needs in sorted(asked.items()))
        check = (
            "Check one candidate's CV against the requirements of some job postings.\n\n"
            f"CANDIDATE'S CV:\n{cv_text[:CV_CHARS]}\n\nWHAT THEY WANT:\n{describe(prefs)}\n\nPOSTINGS AND THEIR REQUIREMENTS:\n{checklist}\n\n"
            "For each posting:\n"
            "- wanted: true only if this is the kind of role they want (their roles, level and standing notes). "
            "An open application, a talent pool, or a role in another profession is false.\n"
            "- checks: one entry per numbered requirement, with its number k. met is true when the CV shows it, also when the CV says it in other "
            "words (a forecasting pipeline run as scheduled jobs shows “experience with data pipelines”). evidence is then a phrase of under ten "
            "words copied word for word from the CV. met is false, with empty evidence, when the CV does not show it: a different tool, fewer "
            "years, another industry or domain, or a language they do not work in does not meet a requirement.\n"
            'Reply with JSON only: {"jobs": [{"n": 0, "wanted": true, "checks": [{"k": 0, "met": true, "evidence": "..."}, {"k": 1, "met": false, "evidence": ""}]}]}'
        )
        out = {}
        for item in read_json(ask_check(check))["jobs"]:
            n = int(item["n"])
            if n not in asked:
                continue
            by_k = {int(c["k"]): c for c in (item.get("checks") or []) if isinstance(c, dict) and str(c.get("k", "")).lstrip("-").isdigit()}
            needs = [{"need": need, "met": (by_k.get(k) or {}).get("met"), "evidence": (by_k.get(k) or {}).get("evidence")} for k, need in enumerate(asked[n])]
            out[n] = verdict_from({"wanted": item.get("wanted"), "requirements": needs}, cv_text)
        return out or None
    except Exception:
        return None


def judge(jobs, cv_text, prefs, ask=None, ask_check=None):
    """Verdicts by position; a posting whose batch failed twice gets none and is looked at again next time."""
    ask_check = ask_check or ask or ask_judge_model
    ask = ask or ask_fast_model

    def run(offset):
        for _attempt in (1, 2):
            found = judge_batch(jobs[offset:offset + BATCH], cv_text, prefs, ask, ask_check)
            if found is not None:
                return {offset + n: verdict for n, verdict in found.items()}
        return {}

    verdicts = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        for part in pool.map(run, range(0, len(jobs), BATCH)):
            verdicts.update(part)
    return verdicts


# ---- one look at the market ----

def look(state, fetch=None, pause=1.0, judge_with=None, clock=None):
    """Fetch postings not seen before, rule out what preferences exclude, judge the rest.
    New matches are added to state["matches"]. Returns (new matches, summary)."""
    clock = clock or now
    moment, prefs = clock(), state["prefs"]
    today = moment.date().isoformat()
    last = dt.datetime.fromisoformat(state["lastRun"]) if state.get("lastRun") else None
    since = FIRST_LOOK_DAYS * 1440 if not last else min(FIRST_LOOK_DAYS * 1440, int((moment - last).total_seconds() // 60) + 90)
    jobs, errors = [], []
    found, failed = search_sweden(prefs["roles"], since, fetch, pause)  # also when only remote is wanted: Swedish postings can be remote
    jobs, errors = jobs + found, errors + failed
    if prefs["remote"] != "no" and (state.get("remote") or {}).get("date") != today:  # these sources refresh daily
        found, failed = search_remote(prefs["roles"], fetch, pause)
        jobs, errors = jobs + found, errors + failed
        if found or not failed:
            state["remote"] = {"date": today}
    fresh = [j for j in jobs if j["id"] not in state["seen"]]
    excluded, candidates = {}, []
    for job in fresh:
        reason = ruled_out(job, prefs, today)
        if reason:
            excluded[reason[0]] = excluded.get(reason[0], 0) + 1
            state["seen"][job["id"]] = today
        else:
            candidates.append(job)
    candidates.sort(key=lambda j: j["published"] or "", reverse=True)
    waiting, candidates = candidates[MAX_JUDGED:], candidates[:MAX_JUDGED]
    verdicts = (judge_with or judge)(candidates, state["cv"]["text"], prefs) if candidates else {}
    new = []
    for index, job in enumerate(candidates):
        verdict = verdicts.get(index)
        if verdict is None:
            continue  # not judged: left unseen so the next look tries again
        state["seen"][job["id"]] = today
        if verdict["fit"] >= GOOD_FIT:
            match = {**job, **verdict, "found": today}
            state["matches"] = [m for m in state["matches"] if m["id"] != job["id"]] + [match]
            new.append(match)
    cutoff = (moment.date() - dt.timedelta(days=KEEP_DAYS)).isoformat()
    state["seen"] = {k: v for k, v in state["seen"].items() if v >= cutoff}
    state["sent"] = {k: v for k, v in state["sent"].items() if v >= cutoff}
    state["matches"] = [m for m in state["matches"] if not (m.get("deadline") and m["deadline"] < today) and m["found"] >= cutoff]
    state["lastRun"], state["errors"] = moment.isoformat(), errors
    new.sort(key=lambda m: -m["fit"])
    return new, {"read": len(jobs), "new": len(fresh), "ruledOut": excluded, "judged": len(verdicts), "notJudgedYet": len(candidates) - len(verdicts) + len(waiting), "errors": errors}


def brief(match, with_text=False):
    out = {k: match[k] for k in ("id", "title", "employer", "place", "remote", "url", "published", "deadline", "fit", "met", "of", "meets", "gaps", "found") if match.get(k) not in (None, "")}
    out["source"] = match.get("credit") or match["source"]
    if with_text:
        out["posting"] = match["text"]
    return out


def ready(state):
    if not state["cv"]:
        return "No CV is stored yet."
    if not state["prefs"]["roles"]:
        return "No roles are stated yet, so there is nothing to search for."
    return None


def feed(args):
    state = load()
    missing = ready(state)
    if missing or not model_settings()[0]:
        print(json.dumps({"wakeAgent": False, "reason": missing or "The small model is not configured."}))
        return
    try:
        _new, summary = look(state)
    except Exception as error:
        print(json.dumps({"wakeAgent": False, "error": str(error)[:200]}))
        return
    unsent = sorted((m for m in state["matches"] if m["id"] not in state["sent"]), key=lambda m: -m["fit"])[:MAX_SENT]
    if not args.dry_run:
        for match in unsent:
            state["sent"][match["id"]] = now().date().isoformat()
        save(state)
    if not unsent:
        print(json.dumps({"wakeAgent": False}))
        return
    print(json.dumps({"wakeAgent": True, "context": {"date": now().date().isoformat(), "newMatches": [brief(m) for m in unsent], "looked": summary,
                                                      "wanted": describe(state["prefs"])}}, ensure_ascii=False))


def current(args):
    state = load()
    missing, summary = ready(state), None
    if args.refresh and not missing and model_settings()[0]:
        try:
            _new, summary = look(state)
            save(state)
        except Exception as error:
            summary = {"errors": [{"error": str(error)[:200]}]}
    matches = sorted(state["matches"], key=lambda m: (-m["fit"], m.get("published") or ""))
    print(json.dumps({"ready": not missing, **({"missing": missing} if missing else {}), "cv": cv_summary(state), "prefs": state["prefs"],
                      "matches": [brief(m) for m in matches[:args.limit]], "moreNotShown": max(0, len(matches) - args.limit),
                      "lastLooked": state.get("lastRun"), **({"looked": summary} if summary else {}), "errors": state.get("errors", [])}, ensure_ascii=False))


def cv_summary(state):
    cv = state["cv"]
    return {"name": cv["name"], "characters": len(cv["text"]), "added": cv["added"]} if cv else None


def show(args):
    state = load()
    match = next((m for m in state["matches"] if m["id"] == args.id), None)
    if not match:
        sys.exit(f"No match with id {args.id!r}.")
    print(json.dumps({"match": brief(match, with_text=True), "cv": (state["cv"] or {}).get("text", "")[:CV_CHARS * 2], "wanted": describe(state["prefs"])}, ensure_ascii=False))


def dismiss(args):
    state = load()
    before = len(state["matches"])
    gone = next((m for m in state["matches"] if m["id"] == args.id), None)
    state["matches"] = [m for m in state["matches"] if m["id"] != args.id]
    if args.why and args.why.strip():
        state["prefs"]["notes"] = (state["prefs"]["notes"] + [args.why.strip()[:200]])[-10:]  # applies to every posting judged from now on
    save(state)
    print(json.dumps({"dismissed": before != len(state["matches"]), "title": (gone or {}).get("title"), "notes": state["prefs"]["notes"]}, ensure_ascii=False))


def set_cv(args):
    text = sys.stdin.read() if args.stdin else Path(args.file).read_text(encoding="utf-8", errors="replace")
    text = re.sub(r"[ \t]+", " ", text).strip()
    if len(text) < 200:
        sys.exit("That is too short to be a CV (under 200 characters).")
    state = load()
    state["cv"] = {"name": args.name or (Path(args.file).name if args.file else "CV"), "text": text[:40000], "added": now().date().isoformat()}
    state["seen"], state["matches"], state["lastRun"] = {}, [], None  # a new CV changes every verdict
    save(state)
    print(json.dumps({"cv": cv_summary(state)}, ensure_ascii=False))


def forget_cv(_args):
    state = load()
    state["cv"], state["matches"], state["seen"], state["lastRun"] = None, [], {}, None
    save(state)
    print(json.dumps({"cv": None}))


def prefs(args):
    state = load()
    p, changed, widened = state["prefs"], False, False
    for key in PREF_LISTS:
        value = getattr(args, key)
        if value is not None:
            p[key], changed = list(dict.fromkeys(v.strip() for v in value.split(",") if v.strip()))[:12], True
            widened = widened or key != "avoid"
    for key in ("remote", "seniority", "country"):
        if getattr(args, key) is not None:
            p[key], changed, widened = getattr(args, key).strip() or None, True, True
    if args.note:
        p["notes"], changed = (p["notes"] + [args.note.strip()[:200]])[-10:], True
    if args.clear:
        p[args.clear] = [] if args.clear in PREF_LISTS + ("notes",) else None
        changed = widened = True
    if changed and widened:
        state["seen"], state["matches"], state["lastRun"] = {}, [], None  # different wishes: look at everything again
    elif changed:  # only something ruled out or noted: earlier matches that survive it stay
        today = now().date().isoformat()
        state["matches"] = [m for m in state["matches"] if not ruled_out(m, p, today)]
    if changed:
        save(state)
    print(json.dumps({"prefs": p, "cv": cv_summary(state), "changed": changed}, ensure_ascii=False))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command")
    p = commands.add_parser("feed"); p.add_argument("--dry-run", action="store_true"); p.set_defaults(run=feed)
    p = commands.add_parser("current"); p.add_argument("--refresh", action="store_true"); p.add_argument("--limit", type=int, default=5); p.set_defaults(run=current)
    p = commands.add_parser("show"); p.add_argument("id"); p.set_defaults(run=show)
    p = commands.add_parser("dismiss"); p.add_argument("id"); p.add_argument("--why"); p.set_defaults(run=dismiss)
    p = commands.add_parser("cv"); p.add_argument("--file"); p.add_argument("--stdin", action="store_true"); p.add_argument("--name"); p.set_defaults(run=set_cv)
    p = commands.add_parser("forget-cv"); p.set_defaults(run=forget_cv)
    p = commands.add_parser("prefs")
    for key in PREF_LISTS + ("seniority", "country", "note"):
        p.add_argument("--" + key)
    p.add_argument("--remote", choices=["yes", "no", "only"]); p.add_argument("--clear", choices=PREF_LISTS + ("notes", "seniority"))
    p.set_defaults(run=prefs)
    args = parser.parse_args(argv)
    if not args.command:  # how the scheduler calls it
        args = parser.parse_args(["feed"])
    args.run(args)


if __name__ == "__main__":
    main()
