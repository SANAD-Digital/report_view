from frappe.tests import UnitTestCase

from report_view.core.normalize import normalize, scrub
from report_view.tests.utils import as_json, load_fixtures


class TestNormalize(UnitTestCase):
	def test_shared_fixtures(self):
		cases = load_fixtures()
		self.assertGreaterEqual(len(cases), 10)
		for case in cases:
			with self.subTest(case=case["name"]):
				i = case["input"]
				got = as_json(normalize(i["raw"], i["filters"], i["report_settings"], i["register"]))
				self.assertEqual(got, case["expected"])

	def test_rids_start_at_zero_after_frappe_total(self):
		case = next(c for c in load_fixtures() if c["name"] == "accounts_receivable_frappe_total")
		expected = case["expected"]
		self.assertEqual([r["__rid"] for r in expected["rows"]], list(range(len(expected["rows"]))))
		self.assertIsNotNone(expected["report_totals"]["frappe_total"])
		self.assertEqual(len(expected["rows"]), len(case["input"]["raw"]["result"]) - 1)

	def test_scrub_matches_frappe(self):
		import frappe

		for text in ("Sales Order", "Date of Birth", "a-b c", "مبلغ الفاتورة"):
			self.assertEqual(scrub(text), frappe.scrub(text))

	def test_quoted_captions_in_the_session_language(self):
		"""A report that quotes _("Opening") in Arabic: its openings and closings are read as
		such, as the browser reads them (adapter/classify.js), not as totals."""
		import copy
		import json

		words = {
			"Opening": "الافتتاحي",
			"Closing (Opening + Total)": "الرصيد (الافتتاحي + الإجمالي)",
			"Total": "الإجمالي",
		}
		case = next(c for c in load_fixtures() if c["name"] == "general_ledger_by_account")
		i = case["input"]
		raw = copy.deepcopy(i["raw"])
		text = json.dumps(raw, ensure_ascii=False)
		for en, ar in words.items():
			text = text.replace(f"\"'{en}'\"", json.dumps(f"'{ar}'", ensure_ascii=False))
		raw = json.loads(text)
		self.assertIn("'الافتتاحي'", text)
		got = normalize(
			raw, i["filters"], i["report_settings"], i["register"], translate=lambda s: words.get(s, s)
		)
		kinds = [r["__kind"] for r in got["rows"]]
		want = [r["__kind"] for r in case["expected"]["rows"]]
		self.assertEqual(kinds, want)
		self.assertIn("opening", kinds)
		self.assertIn("closing", kinds)
