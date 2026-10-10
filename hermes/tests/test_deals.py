"""python3 -m unittest discover -s hermes/tests  (standard library only, no network)"""
import datetime as dt
import html
import importlib.util
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

spec = importlib.util.spec_from_file_location("daylight_deals", Path(__file__).parents[1] / "scripts" / "daylight_deals.py")
deals = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deals)

DAY = dt.date(2026, 10, 10)
FOOD = "Världar i nöd/Mat och nära mat/"
stamp = lambda y, m, d, h=0: int(dt.datetime(y, m, d, h, tzinfo=deals.STOCKHOLM).timestamp())


def product(pid, title, category, price=None, was=None, pct=None, plus=None, window=(stamp(2026, 10, 5), stamp(2026, 10, 11, 23))):
    p = {}
    if price is not None:
        p = {"price": price, "basePrice": {"text": "/kg"}, "packaging": {"text": "500 g/förp."}}
        if was:
            p.update(oldPrice=was, discount={"percentageDiscount": pct})
    item = {"productId": pid, "fullTitle": title, "price": p, "keyfacts": {"wonCategoryPrimary": FOOD + category},
            "canonicalUrl": f"/p/x/p{pid}", "stockAvailability": {"badgeInfoV2": [{"validFrom": window[0], "validUntil": window[1]}]},
            "lidlPlus": [{"price": {"price": plus[0]}, "highlightText": plus[1]}] if plus else []}
    return f'<div data-grid-data="{html.escape(json.dumps(item), quote=True)}"></div>'


HOME = """
<a href="/c/mandag-soendag/a10103950"><span>5/10-11/10</span> <b>Måndag-söndag</b></a>
<a href="/c/lidl-plus-erbjudanden/a10103954">5/10-11/10 Lidl Plus-erbjudanden</a>
<a href="/c/mandag-soendag/a10104396">19/10-25/10 Måndag-söndag</a>
<a href="/c/koek-hushall/a10103840">Från 5/10 Kök &amp; hushåll</a>
<a href="/c/mat-dryck/s10068374">Mat & dryck</a>
"""
WEEK = (product(1, "Fläskkarré", "Kött/Fläsk", 59.9, 89.9, 33) + product(2, "Laxfilé", "Fisk/Lax", 79, 99, 20)
        + product(3, "Purjolök", "Frukt & grönsaker/Grönsaker", 4.9, 9.9, 50) + product(4, "Ros", "Blommor & växter/Blommor & växter", 34.9)
        + product(5, "Bacon", "Chark/Bacon", 15, 20, 25))
PLUS = product(6, "FINDUS Fish nuggets", "Fryst/Fisk", plus=(70, "-40%")) + product(3, "Purjolök", "Frukt & grönsaker/Grönsaker", 4.9, 9.9, 50)
HOUSE = '<div data-grid-data="%s"></div>' % html.escape(json.dumps({"productId": 9, "fullTitle": "Stekpanna", "price": {"price": 149}, "keyfacts": {"wonCategoryPrimary": "Världar i nöd/Hem/Kök"}}), quote=True)
PAGES = {deals.SITE + "/": HOME, deals.SITE + "/c/mandag-soendag/a10103950": WEEK, deals.SITE + "/c/lidl-plus-erbjudanden/a10103954": PLUS, deals.SITE + "/c/koek-hushall/a10103840": HOUSE}


class DiscountTracker(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.TemporaryDirectory()
        os.environ["HERMES_HOME"] = self.home.name
        self.requests = []

    def tearDown(self):
        self.home.cleanup()

    def fetch(self, url):
        self.requests.append(url)
        return PAGES[url]

    def run_cli(self, *argv):
        out = io.StringIO()
        with redirect_stdout(out):
            deals.main(list(argv))
        return json.loads(out.getvalue())

    def offers(self, state):
        found, pages, errors = deals.current_deals(state, DAY, fetch=self.fetch, pause=0)
        self.assertEqual(errors, [])
        return found

    def test_only_this_weeks_pages_are_read_and_only_food_is_kept(self):
        self.assertEqual([p["path"].split("/")[-1] for p in deals.weekly_pages(HOME, DAY)], ["a10103950", "a10103954", "a10103840"])
        state = deals.load()
        found = self.offers(state)
        self.assertEqual(sorted(d["title"] for d in found), ["Bacon", "FINDUS Fish nuggets", "Fläskkarré", "Laxfilé", "Purjolök"])  # no rose, no frying pan, leek once
        lax = next(d for d in found if d["title"] == "Laxfilé")
        self.assertEqual({k: lax[k] for k in ("price", "was", "percentOff", "from", "until", "unitPrice", "pack")},
                         {"price": 79, "was": 99, "percentOff": 20, "from": "2026-10-05", "until": "2026-10-11", "unitPrice": "/kg", "pack": "500 g/förp."})
        self.assertEqual(lax["link"], "https://www.lidl.se/p/x/p2")
        nuggets = next(d for d in found if "nuggets" in d["title"])
        self.assertEqual((nuggets["price"], nuggets["percentOff"], nuggets["needsLidlPlus"]), (70, 40, True))

    def test_pages_are_fetched_at_most_once_a_day(self):
        state = deals.load()
        self.offers(state)
        first = len(self.requests)
        self.assertEqual(first, 4)  # home page + three weekly pages
        self.offers(state)
        self.assertEqual(len(self.requests), first)
        deals.current_deals(state, DAY + dt.timedelta(days=1), fetch=self.fetch, pause=0)
        self.assertGreater(len(self.requests), first)

    def test_a_dislike_said_once_removes_those_offers_and_a_like_goes_first(self):
        self.run_cli("dislike", "pork", "--terms", "fläsk,bacon")
        self.run_cli("like", "salmon", "--terms", "lax")
        state = deals.load()
        fresh, kept, hidden, screened = deals.select(state, self.offers(state))
        self.assertEqual(len(fresh), 5)
        self.assertEqual([d["title"] for d in kept], ["Laxfilé", "Purjolök", "FINDUS Fish nuggets"])  # liked first, then biggest discount
        self.assertEqual(kept[0]["youLike"], "salmon")
        self.assertEqual(hidden, {"pork": ["Fläskkarré", "Bacon"]})
        self.assertFalse(screened)
        self.assertEqual(self.run_cli("forget", "pork"), {"forgot": "pork", "found": True})
        self.assertEqual(deals.load()["dislikes"], [])

    def test_a_small_model_catches_what_keywords_miss_using_general_memory(self):
        state, prompts = deals.load(), []

        def ask(prompt):
            prompts.append(prompt)
            numbered = dict(line.split(": ", 1) for line in prompt.splitlines() if line.split(": ", 1)[0].isdigit())
            return json.dumps({"hide": [{"n": int(n), "why": "pork"} for n, name in numbered.items() if "karré" in name or "Bacon" in name]})

        fresh, kept, hidden, screened = deals.select(state, self.offers(state), "User hates pork.", lambda d, dis, about: deals.screen(d, dis, about, ask))
        self.assertTrue(screened)
        self.assertEqual(sorted(hidden["pork"]), ["Bacon", "Fläskkarré"])
        self.assertNotIn("Fläskkarré", [d["title"] for d in kept])
        self.assertIn("User hates pork.", prompts[0])

        def broken(prompt):
            raise OSError("model unreachable")

        self.assertEqual(deals.screen(kept, [], "User hates pork.", broken), ([], False))  # failure hides nothing

        # A long list is judged in batches; one batch failing once is retried, and numbering stays global.
        many = [{"title": "Bacon" if i in (3, 50) else f"Vara {i}", "category": "x"} for i in range(60)]
        calls = []

        def flaky(prompt):
            calls.append(prompt)
            if len(calls) == 1:
                return ""  # ran out of tokens while reasoning
            return ask(prompt)

        verdicts, complete = deals.screen(many, [], "User hates pork.", flaky)
        self.assertEqual((sorted(n for n, _ in verdicts), complete, len(calls)), ([3, 50], True, 3))
        self.assertEqual(deals.screen(kept, [], "", ask), ([], False))  # nothing known about the user: no call

    def test_each_offer_is_judged_once_until_what_is_known_about_the_user_changes(self):
        state, asked = deals.load(), []
        offers = [{"id": str(i), "title": name, "category": "x"} for i, name in enumerate(["Bacon", "Gurka", "Lax"])]

        def model(todo, dislikes, about):
            asked.append([d["title"] for d in todo])
            return [(i, "pork") for i, d in enumerate(todo) if d["title"] == "Bacon"], True

        judge = deals.remembered_screen(state, model)
        self.assertEqual(judge(offers, [], "User hates pork."), ([(0, "pork")], True))
        self.assertEqual(judge(offers[1:] + offers[:1], [], "User hates pork."), ([(2, "pork")], True))  # same verdicts, new positions
        more = offers + [{"id": "9", "title": "Ost", "category": "x"}]
        judge(more, [], "User hates pork.")
        self.assertEqual(asked, [["Bacon", "Gurka", "Lax"], ["Ost"]])  # only the new offer went to the model
        judge(more, [{"label": "fish", "terms": ["lax"]}], "User hates pork.")
        self.assertEqual(len(asked[-1]), 4)  # a new dislike: everything is judged again

        # A batch that failed leaves its unhidden offers unjudged, so they are asked about again next time.
        state2, calls = deals.load(), []

        def failing(todo, dislikes, about):
            calls.append(len(todo))
            return ([(0, "pork")], False) if len(calls) == 1 else ([], True)

        judge2 = deals.remembered_screen(state2, failing)
        self.assertEqual(judge2(offers, [], "User hates pork."), ([(0, "pork")], False))
        self.assertEqual(judge2(offers, [], "User hates pork."), ([(0, "pork")], True))
        self.assertEqual(calls, [3, 2])

    def test_offers_are_sent_once_and_hidden_ones_do_not_come_back(self):
        deals.http_get = self.fetch
        deals.PAUSE_SECONDS = 0
        deals.today = lambda: DAY
        os.environ.pop("NEBIUS_API_KEY", None)
        self.run_cli("dislike", "pork", "--terms", "fläsk,bacon")
        first = self.run_cli("feed")
        self.assertTrue(first["wakeAgent"])
        self.assertEqual(len(first["context"]["newOffers"]), 3)
        self.assertEqual(first["context"]["leftOut"], [{"reason": "pork", "count": 2, "examples": ["Fläskkarré", "Bacon"]}])
        self.assertEqual(self.run_cli("feed"), {"wakeAgent": False})
        self.run_cli("forget", "pork")
        self.assertEqual(self.run_cli("feed"), {"wakeAgent": False})  # already-seen pork offers are not resurfaced

    def test_asking_what_is_on_offer_shows_current_deals_without_consuming_them(self):
        deals.http_get = self.fetch
        deals.PAUSE_SECONDS = 0
        deals.today = lambda: DAY
        os.environ.pop("NEBIUS_API_KEY", None)
        self.run_cli("dislike", "pork", "--terms", "fläsk,bacon")
        self.run_cli("feed")  # everything has been sent already
        shown = self.run_cli("current")
        self.assertEqual([o["title"] for o in shown["offers"]], ["Purjolök", "FINDUS Fish nuggets", "Laxfilé"])
        self.assertEqual((shown["totalOffers"], shown["moreNotShown"], shown["leftOut"][0]["count"]), (5, 0, 2))
        self.assertEqual([o["title"] for o in self.run_cli("current", "--find", "lax")["offers"]], ["Laxfilé"])
        self.assertEqual(self.run_cli("current", "--limit", "1")["moreNotShown"], 2)
        self.assertEqual(self.run_cli("feed"), {"wakeAgent": False})  # asking did not change what the digest sends
        deals.today = lambda: DAY + dt.timedelta(days=30)
        self.assertEqual(deals.load()["cache"]["date"], DAY.isoformat())

    def test_the_model_key_comes_from_the_environment_or_the_env_file_the_installer_named(self):
        for name in ("NEBIUS_API_KEY", "NEBIUS_BASE_URL"):
            os.environ.pop(name, None)
        self.assertEqual(deals.model_settings(), (None, deals.TOKEN_FACTORY))  # nothing configured: screening is skipped
        env_file = os.path.join(self.home.name, "project.env")
        with open(env_file, "w", encoding="utf-8") as handle:
            handle.write('# comment\nNEBIUS_API_KEY="from-file"\nNEBIUS_BASE_URL=https://example.test/v1/\nOTHER=x\n')
        os.makedirs(os.path.join(self.home.name, "daylight"), exist_ok=True)
        with open(os.path.join(self.home.name, "daylight", "config.json"), "w", encoding="utf-8") as handle:
            json.dump({"envFile": env_file}, handle)
        self.assertEqual(deals.model_settings(), ("from-file", "https://example.test/v1"))
        os.environ["NEBIUS_API_KEY"] = "from-environment"
        try:
            self.assertEqual(deals.model_settings()[0], "from-environment")
        finally:
            os.environ.pop("NEBIUS_API_KEY", None)


if __name__ == "__main__":
    unittest.main()
