"""python3 -m unittest discover -s hermes/tests  (standard library only, no network)"""
import datetime as dt
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

spec = importlib.util.spec_from_file_location("daylight_research", Path(__file__).parents[1] / "scripts" / "daylight_research.py")
research = importlib.util.module_from_spec(spec)
spec.loader.exec_module(research)

TODAY = research.today()
day = lambda back: (TODAY - dt.timedelta(days=back)).isoformat()


def atom(*papers):
    entries = "".join(
        f"<entry><id>http://arxiv.org/abs/{pid}v2</id><title> {title}\n  </title><published>{date}T10:00:00Z</published>"
        f"<summary>Abstract of {title}.</summary>" + "".join(f"<author><name>Author {i}</name></author>" for i in range(authors))
        + '<category term="cs.CL"/></entry>'
        for pid, title, date, authors in papers
    )
    return f'<feed xmlns="http://www.w3.org/2005/Atom">{entries}</feed>'.encode()


class ResearchTracker(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.TemporaryDirectory()
        os.environ["HERMES_HOME"] = self.home.name

    def tearDown(self):
        self.home.cleanup()

    def run_cli(self, *argv):
        out = io.StringIO()
        with redirect_stdout(out):
            research.main(list(argv))
        return json.loads(out.getvalue().strip().splitlines()[-1]) if out.getvalue().strip() else None

    def test_topics_are_added_listed_noted_and_removed(self):
        added = self.run_cli("add", "Agent evaluation for tool use", "--category", "cs.CL")["added"]
        self.assertEqual(added["id"], "agent-evaluation-for-tool-use")
        self.assertEqual(added["query"], "(ti:Agent OR abs:Agent) AND (ti:evaluation OR abs:evaluation) AND (ti:tool OR abs:tool)")  # filler words dropped
        self.assertEqual(research.default_query("LLM agents that use tools"), "(ti:LLM OR abs:LLM) AND (ti:agents OR abs:agents) AND (ti:tools OR abs:tools)")
        self.assertEqual(self.run_cli("add", "Agent evaluation for tool use")["added"]["id"], "agent-evaluation-for-tool-use-2")
        self.run_cli("note", added["id"], "skip surveys")
        state = research.load()
        self.assertEqual(state["topics"][0]["notes"], ["skip surveys"])
        self.run_cli("remove", "agent-evaluation-for-tool-use-2")
        self.assertEqual(len(research.load()["topics"]), 1)

    def test_only_unseen_recent_papers_are_offered_and_only_once(self):
        self.run_cli("add", "tool use")
        state = research.load()
        listing = atom(("2610.00001", "Fresh one", day(1), 5), ("2610.00002", "Fresh two", day(3), 1), ("2501.00003", "Old paper", day(200), 1))
        urls = []
        batch, errors = research.collect(state, fetch=lambda url: urls.append(url) or listing, pause=0)
        self.assertEqual(errors, [])
        self.assertIn("sortBy=submittedDate", urls[0])
        papers = batch[0]["papers"]
        self.assertEqual([p["id"] for p in papers], ["2610.00001", "2610.00002"])  # version suffix dropped, old paper excluded
        self.assertEqual(papers[0]["title"], "Fresh one")
        self.assertEqual(papers[0]["authors"], ["Author 0", "Author 1", "Author 2", "et al."])
        self.assertEqual(papers[0]["link"], "https://arxiv.org/abs/2610.00001")
        again, _ = research.collect(state, fetch=lambda url: listing, pause=0)
        self.assertEqual(again, [])  # nothing new, so the scheduled job stays silent
        later = atom(("2610.00009", "Newer", day(0), 2), ("2610.00001", "Fresh one", day(1), 5))
        third, _ = research.collect(state, fetch=lambda url: later, pause=0)
        self.assertEqual([p["id"] for p in third[0]["papers"]], ["2610.00009"])

    def test_a_backlog_is_not_drained_over_later_runs(self):
        self.run_cli("add", "tool use")
        state = research.load()
        many = atom(*[(f"2610.{n:05d}", f"Paper {n}", day(1), 1) for n in range(20)])
        first, _ = research.collect(state, fetch=lambda url: many, pause=0)
        self.assertEqual(len(first[0]["papers"]), research.PER_TOPIC)
        second, _ = research.collect(state, fetch=lambda url: many, pause=0)
        self.assertEqual(second, [])

    def test_a_small_model_screens_out_papers_that_only_mention_the_topic(self):
        self.run_cli("add", "tool use")
        self.run_cli("note", "tool-use", "skip surveys")
        state = research.load()
        listing = atom(("2610.00001", "Benchmarking tool use", day(1), 1), ("2610.00002", "Chip design with an agent", day(1), 1))
        prompts = []

        def ask(prompt):
            prompts.append(prompt)
            return 'Sure. {"keep": ["2610.00001"]}'

        batch, _ = research.collect(state, fetch=lambda url: listing, pause=0, screen_with=lambda t, p: research.screen(t, p, ask))
        self.assertEqual([p["id"] for p in batch[0]["papers"]], ["2610.00001"])
        self.assertEqual(batch[0]["screenedOut"], 1)
        self.assertIn("skip surveys", prompts[0])
        self.assertIn("2610.00002", state["seen"])  # a screened-out paper is not offered again

    def test_screening_failure_keeps_every_paper_and_all_out_means_no_digest(self):
        self.run_cli("add", "tool use")
        papers = [{"id": "1", "title": "t", "abstract": "a"}]

        def broken(prompt):
            raise OSError("model unreachable")

        self.assertEqual(research.screen({"name": "tool use"}, papers, broken), (papers, False))
        state = research.load()
        listing = atom(("2610.00001", "Unrelated", day(1), 1))
        batch, _ = research.collect(state, fetch=lambda url: listing, pause=0, screen_with=lambda t, p: research.screen(t, p, lambda prompt: '{"keep": []}'))
        self.assertEqual(batch, [])

    def test_one_failing_topic_does_not_hide_the_others(self):
        self.run_cli("add", "broken")
        self.run_cli("add", "working")
        state = research.load()

        def fetch(url):
            if "broken" in url:
                raise OSError("arXiv unreachable")
            return atom(("2610.00042", "Works", day(1), 1))

        batch, errors = research.collect(state, fetch=fetch, pause=0)
        self.assertEqual([b["topic"] for b in batch], ["working"])
        self.assertEqual(errors[0]["topic"], "broken")

    def test_feed_without_topics_does_not_wake_the_agent(self):
        self.assertEqual(self.run_cli("feed"), {"wakeAgent": False})

    def test_the_model_key_is_found_without_the_environment_as_the_scheduler_runs_it(self):
        # This path crashed on the server (a missing helper) and stopped the morning digest.
        for name in ("NEBIUS_API_KEY", "NEBIUS_BASE_URL"):
            os.environ.pop(name, None)
        self.assertEqual(research.model_settings(), (None, research.TOKEN_FACTORY))
        env_file = os.path.join(self.home.name, "project.env")
        with open(env_file, "w", encoding="utf-8") as handle:
            handle.write('NEBIUS_API_KEY="from-file"\n')
        os.makedirs(os.path.join(self.home.name, "daylight"), exist_ok=True)
        with open(os.path.join(self.home.name, "daylight", "config.json"), "w", encoding="utf-8") as handle:
            json.dump({"envFile": env_file}, handle)
        self.assertEqual(research.model_settings()[0], "from-file")


if __name__ == "__main__":
    unittest.main()
