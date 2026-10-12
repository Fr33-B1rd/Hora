import contextlib
import datetime as dt
import io
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import daylight_jobs as jobs  # noqa: E402

NOW = dt.datetime(2026, 10, 12, 9, 0, tzinfo=dt.timezone.utc)
CV = ("Maria Lind. Data scientist with six years of experience. Python, SQL, scikit-learn, PyTorch. "
      "Built demand forecasting models at a retail company; led a team of three. MSc in statistics, Uppsala. "
      "Fluent in English, basic Swedish. ") * 2
SWEDISH_AD = ("Vi söker dig som vill arbeta med dataanalys och maskininlärning inom vår organisation. Du har erfarenhet av "
              "Python och är van att arbeta med stora datamängder. Vi erbjuder en arbetsplats med goda möjligheter till "
              "utveckling och du blir en del av vårt team som arbetar med att förbättra våra tjänster för kunder i hela landet.")
ENGLISH_AD = ("We are looking for a data scientist to build forecasting models in Python. You have several years of experience "
              "with machine learning, SQL and communicating results to the business. The team works in English. " * 2)


def hit(n, headline, text, municipality="Stockholm", employer="Acme AB", deadline="2026-11-09T23:59:59"):
    return {"id": str(n), "headline": headline, "webpage_url": f"https://arbetsformedlingen.se/platsbanken/annonser/{n}",
            "description": {"text": text}, "employer": {"name": employer}, "application_deadline": deadline,
            "publication_date": "2026-10-11T08:00:00", "removed": False,
            "workplace_address": {"municipality": municipality, "region": municipality + "s län"}}


SWEDEN = {"hits": [hit(1, "Data Scientist", ENGLISH_AD), hit(2, "Dataanalytiker", SWEDISH_AD), hit(3, "Data Scientist", ENGLISH_AD, "Malmö"),
                   hit(4, "Data Scientist at a consultancy", ENGLISH_AD, employer="Konsult AB"), hit(5, "Data Scientist", ENGLISH_AD, deadline="2026-10-01T00:00:00")]}
HIMALAYAS = {"jobs": [{"guid": "https://himalayas.app/j/a", "title": "Senior Data Scientist", "companyName": "Remote Co", "description": "<p>" + ENGLISH_AD + "</p>",
                       "applicationLink": "https://himalayas.app/j/a", "pubDate": 1791789602, "locationRestrictions": ["United States"]},
                      {"guid": "https://himalayas.app/j/b", "title": "Data Scientist", "companyName": "Open Co", "description": ENGLISH_AD,
                       "applicationLink": "https://himalayas.app/j/b", "pubDate": 1791789602, "locationRestrictions": []}]}
JOBICY = {"jobs": [{"id": 7, "url": "https://jobicy.com/jobs/7", "jobTitle": "Data Scientist, Pricing", "companyName": "Euro Co", "jobGeo": "Europe",
                    "jobDescription": ENGLISH_AD, "pubDate": "2026-10-11T06:00:00+00:00"},
                   {"id": 8, "url": "https://jobicy.com/jobs/8", "jobTitle": "Account Executive", "companyName": "Sales Co", "jobGeo": "Anywhere",
                    "jobDescription": ENGLISH_AD, "pubDate": "2026-10-11T06:00:00+00:00"}]}


class JobSeeker(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.TemporaryDirectory()
        os.environ["HERMES_HOME"] = self.home.name
        self.requests = []

    def tearDown(self):
        self.home.cleanup()

    def fetch(self, url):
        self.requests.append(url)
        return SWEDEN if "jobtechdev" in url else HIMALAYAS if "himalayas" in url else JOBICY

    def cli(self, *argv, stdin=None):
        out, old = io.StringIO(), sys.stdin
        try:
            if stdin is not None:
                sys.stdin = io.StringIO(stdin)
            with contextlib.redirect_stdout(out):
                jobs.main(list(argv))
        finally:
            sys.stdin = old
        return json.loads(out.getvalue())

    def profile(self, **prefs):
        self.cli("cv", "--stdin", "--name", "maria.pdf", stdin=CV)
        self.cli("prefs", "--roles", "data scientist", "--places", "Stockholm", "--languages", "English", "--avoid", "consultancy", **{})
        state = jobs.load()
        state["prefs"].update(prefs)
        return state

    def test_postings_from_every_source_take_one_shape_and_keep_their_credit_and_link(self):
        a, b, c = jobs.from_jobtech(SWEDEN["hits"][0]), jobs.from_himalayas(HIMALAYAS["jobs"][0]), jobs.from_jobicy(JOBICY["jobs"][0])
        self.assertEqual((a["id"], a["place"], a["remote"], a["deadline"], a["credit"]), ("jobtech:1", "Stockholm, Stockholms län", False, "2026-11-09", "Arbetsförmedlingen Platsbanken"))
        self.assertEqual((b["id"], b["remote"], b["openTo"], b["credit"], b["published"]), ("himalayas:https://himalayas.app/j/a", True, ["United States"], "Himalayas", "2026-10-12"))
        self.assertEqual((c["url"], c["openTo"], c["credit"]), ("https://jobicy.com/jobs/7", ["Europe"], "Jobicy"))
        self.assertNotIn("<p>", b["text"])
        self.assertTrue(set(a) == set(b) == set(c))

    def test_stated_preferences_rule_postings_out_before_any_model_is_asked(self):
        prefs, today = self.profile()["prefs"], "2026-10-12"
        text = lambda found: found and " ".join(found)
        why = lambda raw, convert=jobs.from_jobtech: text(jobs.ruled_out(convert(raw), prefs, today))
        self.assertIsNone(why(SWEDEN["hits"][0]))
        self.assertIn("Swedish", why(SWEDEN["hits"][1]))
        self.assertIn("outside your places", why(SWEDEN["hits"][2]))
        self.assertIn("consultancy", why(SWEDEN["hits"][3]))
        self.assertIn("deadline", why(SWEDEN["hits"][4]))
        self.assertEqual(jobs.ruled_out(jobs.from_himalayas(HIMALAYAS["jobs"][0]), prefs, today), ("remote, but not open to applicants where you live", "United States"))
        self.assertIsNone(why(HIMALAYAS["jobs"][1], jobs.from_himalayas))   # no restriction listed: open to anyone
        self.assertIsNone(why(JOBICY["jobs"][0], jobs.from_jobicy))         # Europe includes Sweden
        self.assertIn("title", why(JOBICY["jobs"][1], jobs.from_jobicy))
        # A Swedish speaker keeps the Swedish posting; someone wanting no remote work loses the remote ones.
        self.assertIsNone(jobs.ruled_out(jobs.from_jobtech(SWEDEN["hits"][1]), {**prefs, "languages": ["English", "Swedish"], "places": []}, today))
        self.assertIn("on-site", text(jobs.ruled_out(jobs.from_jobicy(JOBICY["jobs"][0]), {**prefs, "remote": "no"}, today)))
        self.assertIn("not a remote", text(jobs.ruled_out(jobs.from_jobtech(SWEDEN["hits"][0]), {**prefs, "remote": "only"}, today)))
        old = {**jobs.from_jobicy(JOBICY["jobs"][0]), "published": "2026-08-30"}
        self.assertEqual(jobs.ruled_out(old, prefs, today)[0], "posted more than a month ago")
        self.assertFalse(jobs.looks_swedish(ENGLISH_AD))

    def test_one_look_judges_only_what_survives_and_keeps_only_good_fits(self):
        state, asked = self.profile(), []

        def judge(candidates, cv_text, prefs):
            asked.append([c["id"] for c in candidates])
            self.assertIn("forecasting", cv_text)
            return {i: {"fit": 88 if c["source"] == "jobtech" else 74 if c["source"] == "jobicy" else 40, "meets": ["Python: six years"], "gaps": ["No cloud experience"]}
                    for i, c in enumerate(candidates)}

        new, summary = jobs.look(state, self.fetch, pause=0, judge_with=judge, clock=lambda: NOW)
        self.assertEqual(sorted(asked[0]), ["himalayas:https://himalayas.app/j/b", "jobicy:7", "jobtech:1"])
        self.assertEqual([m["id"] for m in new], ["jobtech:1", "jobicy:7"])                   # best first; the 40 is not a match
        self.assertEqual((summary["read"], summary["new"], summary["judged"]), (9, 9, 3))
        self.assertEqual(summary["ruledOut"], {"written in Swedish, not one of your working languages": 1, "outside your places": 1, "contains something you avoid": 1,
                                               "application deadline has passed": 1, "remote, but not open to applicants where you live": 1, "title does not match your roles": 1})
        self.assertEqual(new[0]["meets"], ["Python: six years"])
        self.assertIn("published-after=10080", self.requests[0])                             # first look: the past week
        # A second look an hour later asks Sweden for the last hours only, skips the daily remote sources, and judges nothing twice.
        self.requests.clear()
        new, summary = jobs.look(state, self.fetch, pause=0, judge_with=judge, clock=lambda: NOW + dt.timedelta(hours=1))
        self.assertEqual((new, summary["new"], len(asked)), ([], 0, 1))
        self.assertEqual(len(self.requests), 1)
        self.assertIn("published-after=150", self.requests[0])

    def test_a_posting_the_model_failed_to_judge_is_tried_again_and_a_failing_source_does_not_hide_the_rest(self):
        state = self.profile()

        def broken(url):
            if "himalayas" in url:
                raise OSError("timed out")
            return self.fetch(url)

        new, summary = jobs.look(state, broken, pause=0, judge_with=lambda c, cv, p: {}, clock=lambda: NOW)
        self.assertEqual((new, summary["judged"], summary["notJudgedYet"]), ([], 0, 2))
        self.assertEqual(summary["errors"][0]["source"], "Himalayas")
        self.assertNotIn("jobtech:1", state["seen"])
        new, _ = jobs.look(state, self.fetch, pause=0, judge_with=lambda c, cv, p: {i: {"fit": 90, "meets": [], "gaps": []} for i in range(len(c))}, clock=lambda: NOW + dt.timedelta(minutes=5))
        self.assertIn("jobtech:1", [m["id"] for m in new])

    def test_a_requirement_counts_only_with_evidence_found_in_the_cv_and_fit_is_the_share_met(self):
        need = lambda name, met, evidence="": {"need": name, "met": met, "evidence": evidence}
        strong = jobs.verdict_from({"wanted": True, "requirements": [
            need("Python", True, "Python, SQL, scikit-learn"), need("Forecasting", True, "Built demand forecasting models"),
            need("Team leadership", True, "led a team of three"), need("Kubernetes", True, "Kubernetes in production"),   # claimed, but not in the CV
            need("Azure", False), need("MSc", True, "MSc in statistics, Uppsala")]}, CV)
        self.assertEqual((strong["fit"], strong["met"], strong["of"], strong["wanted"]), (67, 4, 6, True))
        self.assertEqual(strong["gaps"], ["Kubernetes", "Azure"])
        self.assertEqual(strong["meets"][0], "Python: “Python, SQL, scikit-learn”")
        self.assertTrue(jobs.in_cv("six years of experience", CV))
        self.assertFalse(jobs.in_cv("ten years of Kubernetes", CV))
        self.assertFalse(jobs.in_cv("", CV))
        # A role they did not ask for, or a posting with too few requirements to judge, never reaches the bar.
        unwanted = jobs.verdict_from({"wanted": False, "requirements": [need("Python", True, "Python, SQL"), need("SQL", True, "Python, SQL"), need("Stats", True, "MSc in statistics")]}, CV)
        self.assertEqual((unwanted["met"], unwanted["of"]), (3, 3))
        self.assertLess(unwanted["fit"], jobs.GOOD_FIT)
        self.assertLess(jobs.verdict_from({"wanted": True, "requirements": [need("Python", True, "Python, SQL")]}, CV)["fit"], jobs.GOOD_FIT)
        self.assertEqual(jobs.verdict_from({"wanted": True}, CV)["fit"], 0)

    def test_requirements_are_read_from_the_posting_before_the_cv_is_shown_and_a_bad_reply_is_retried(self):
        prefs = self.profile()["prefs"]
        two = [jobs.from_jobtech(SWEDEN["hits"][0]), jobs.from_jobicy(JOBICY["jobs"][0])]
        needs = {"jobs": [{"n": 0, "requirements": ["Python", "SQL", "Go in production"]}, {"n": 9, "requirements": ["x"]}]}
        checks = {"jobs": [{"n": 0, "wanted": True, "checks": [{"k": 0, "met": True, "evidence": "Python, SQL"}, {"k": 1, "met": True, "evidence": "Python, SQL"}]},
                           {"n": 1, "wanted": True, "checks": []}]}
        replies, prompts = ["thinking…", "Here: " + json.dumps(needs), json.dumps(checks)], []

        def ask(prompt):
            prompts.append(prompt)
            return replies[len(prompts) - 1]

        verdicts = jobs.judge(two, CV, prefs, ask)
        self.assertEqual(len(prompts), 3)                                                      # one failed reading, then both readings
        self.assertNotIn("Maria Lind", prompts[1])                                             # requirements are listed without the CV in view
        self.assertIn("forecasting models in Python", prompts[1])
        self.assertIn("Maria Lind", prompts[2])
        self.assertIn("2. Go in production", prompts[2])
        self.assertNotIn("forecasting models in Python", prompts[2])                           # the check sees the requirements, not the posting
        self.assertIn("Roles wanted: data scientist", prompts[2])
        self.assertEqual(list(verdicts), [0])                                                  # postings the model did not list are left for next time
        self.assertEqual((verdicts[0]["fit"], verdicts[0]["gaps"], verdicts[0]["of"]), (67, ["Go in production"], 3))  # an unchecked requirement is a gap
        self.assertEqual(jobs.judge(two, CV, prefs, lambda p: "no json"), {})

    def test_commands_store_show_and_change_the_profile_and_matches(self):
        self.assertFalse(self.cli("current")["ready"])
        with self.assertRaises(SystemExit):
            self.cli("cv", "--stdin", stdin="too short")
        self.assertEqual(self.cli("cv", "--stdin", "--name", "cv.docx", stdin=CV)["cv"]["name"], "cv.docx")
        self.assertIn("No roles", self.cli("current")["missing"])
        changed = self.cli("prefs", "--roles", "data scientist, ML engineer", "--remote", "only", "--note", "no defence industry")
        self.assertEqual((changed["prefs"]["roles"], changed["prefs"]["remote"], changed["prefs"]["notes"], changed["changed"]), (["data scientist", "ML engineer"], "only", ["no defence industry"], True))
        self.assertFalse(self.cli("prefs")["changed"])
        state = jobs.load()
        state["matches"] = [{**jobs.from_jobtech(SWEDEN["hits"][0]), "fit": 81, "meets": ["Python"], "gaps": ["Azure"], "found": "2026-10-12"},
                            {**jobs.from_jobicy(JOBICY["jobs"][0]), "fit": 90, "meets": [], "gaps": [], "found": "2026-10-12"}]
        jobs.save(state)
        shown = self.cli("current", "--limit", "1")
        self.assertEqual((shown["ready"], shown["matches"][0]["id"], shown["matches"][0]["source"], shown["moreNotShown"]), (True, "jobicy:7", "Jobicy", 1))
        self.assertNotIn("posting", shown["matches"][0])
        one = self.cli("show", "jobtech:1")
        self.assertIn("forecasting models in Python", one["match"]["posting"])
        self.assertIn("Maria Lind", one["cv"])
        gone = self.cli("dismiss", "jobtech:1", "--why", "too junior")
        self.assertEqual((gone["dismissed"], gone["notes"][-1]), (True, "too junior"))
        self.assertEqual(len(self.cli("current")["matches"]), 1)
        kept = self.cli("prefs", "--avoid", "defence", "--note", "prefers product companies")
        self.assertEqual((kept["changed"], len(jobs.load()["matches"])), (True, 1))             # ruling something out keeps the matches it does not touch
        self.cli("prefs", "--avoid", "euro co")
        self.assertEqual(jobs.load()["matches"], [])                                           # …and drops the ones it does
        state = jobs.load()
        state["matches"] = [{**jobs.from_jobtech(SWEDEN["hits"][0]), "fit": 81, "meets": [], "gaps": [], "found": "2026-10-12"}]
        jobs.save(state)
        self.cli("prefs", "--places", "Uppsala")
        self.assertEqual(jobs.load()["matches"], [])                                           # changed wishes: everything is looked at again
        self.assertIsNone(self.cli("forget-cv")["cv"])

    def test_the_scheduled_run_stays_silent_until_there_is_a_profile_and_sends_each_match_once(self):
        self.assertEqual(self.cli("feed")["wakeAgent"], False)
        self.profile()
        os.environ["NEBIUS_API_KEY"] = "test"
        real = (jobs.http_json, jobs.judge, jobs.now, jobs.time.sleep)
        jobs.http_json, jobs.now, jobs.time.sleep = self.fetch, (lambda: NOW), (lambda s: None)
        jobs.judge = lambda c, cv, p, ask=None: {i: {"fit": 85, "meets": ["Python"], "gaps": []} for i in range(len(c))}
        try:
            dry = self.cli("feed", "--dry-run")
            self.assertEqual(len(dry["context"]["newMatches"]), 3)
            first = self.cli("feed")
            self.assertTrue(first["wakeAgent"])
            self.assertEqual({m["source"] for m in first["context"]["newMatches"]}, {"Arbetsförmedlingen Platsbanken", "Himalayas", "Jobicy"})
            self.assertIn("url", first["context"]["newMatches"][0])
            self.assertEqual(self.cli("feed"), {"wakeAgent": False})
            self.assertEqual(len(self.cli("current")["matches"]), 3)                           # still there to ask about
        finally:
            jobs.http_json, jobs.judge, jobs.now, jobs.time.sleep = real
            os.environ.pop("NEBIUS_API_KEY", None)


if __name__ == "__main__":
    unittest.main()
