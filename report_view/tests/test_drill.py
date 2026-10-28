"""Configured drill (phase 5d): the rules of Report View Settings «Drill» validated on save, the
shipped Trial Balance -> General Ledger rule, the target run through the same ``api.run`` with
the filters the rule maps (as ``state/drill.js`` maps them), and the restricted user refused
another company's account. The rule grants nothing: the permission is the user's own."""

import json

import frappe

from report_view import api
from report_view.core.drill import parse_drill_rules
from report_view.core.settings import MERGED_CACHE_KEY, REPORT_SETTINGS, load_settings
from report_view.tests.utils import COMPANY, OTHER_COMPANY, TB_FILTERS, TB_JS_FILTERS, RVTestCase

TB = "Trial Balance"
GL = "General Ledger"
GL_JS_FILTERS = [
	{"fieldname": "company", "fieldtype": "Link", "options": "Company"},
	{"fieldname": "account", "fieldtype": "MultiSelectList", "options": "Account"},
]


def map_filters(rule: dict, row: dict, filters: dict) -> dict:
	"""What the browser sends (state/drill.js map_filters), for the tests: row:, filter:, literals."""

	def one(spec):
		if isinstance(spec, str) and spec.startswith("row:"):
			return row.get(spec[4:])
		if isinstance(spec, str) and spec.startswith("filter:"):
			return filters.get(spec[7:])
		return spec

	out = {}
	for name, spec in rule["filters"].items():
		value = [one(s) for s in spec if one(s) not in (None, "")] if isinstance(spec, list) else one(spec)
		if value not in (None, "", []):
			out[name] = value
	return out


class TestDrill(RVTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		frappe.cache.hdel(MERGED_CACHE_KEY, TB)

	def tearDown(self):
		frappe.set_user("Administrator")
		if frappe.db.exists(REPORT_SETTINGS, TB):
			frappe.delete_doc(REPORT_SETTINGS, TB, force=True)
		frappe.cache.hdel(MERGED_CACHE_KEY, TB)

	def shipped_rule(self) -> dict:
		rules = load_settings(TB)["drilldowns"]
		return next(r for r in rules if r["report"] == GL)

	# ---------------------------------------------------------------- the rules

	def test_shipped_trial_balance_drills_to_the_general_ledger(self):
		rule = self.shipped_rule()
		self.assertEqual(rule["source_column"], "account")
		self.assertEqual(rule["filters"]["account"], ["row:account"])
		self.assertEqual(rule["filters"]["company"], "filter:company")
		self.assertEqual(rule["filters"]["from_date"], "filter:from_date")
		self.assertEqual(rule["filters"]["to_date"], "filter:to_date")
		features = load_settings(TB)["features"]
		self.assertTrue(features["drill"] and features["range_selection"])
		self.assertEqual(load_settings(TB)["link_open"], "new_tab")

	def test_invalid_rules_are_refused_on_save(self):
		good = {
			"label": "Ledger",
			"source_column": "account",
			"report": GL,
			"filters": {"account": ["row:account"]},
		}
		bad = [
			[{**good, "label": " "}],
			[{**good, "source_column": "acc ount"}],
			[{**good, "filters": {"account": "row:acc-ount"}}],
			[{**good, "filters": {"account": []}}],
			[{**good, "filters": {"account": {"x": 1}}}],
			[{**good, "filters": "account"}],
			[good, good],
			["nope"],
			{"label": "not a list"},
		]
		for rules in bad:
			with self.subTest(rules=rules), self.assertRaises(frappe.ValidationError):
				frappe.get_doc(
					{"doctype": REPORT_SETTINGS, "report": TB, "drilldowns": json.dumps(rules)}
				).insert()
		# the loader keeps the valid ones only (never throws)
		self.assertEqual(parse_drill_rules([good, {"label": ""}]), [good])

	def test_a_rule_to_a_report_that_does_not_exist_is_refused(self):
		rules = [
			{"label": "Nowhere", "source_column": "account", "report": "rv-no-such-report", "filters": {}}
		]
		with self.assertRaises(frappe.DoesNotExistError):
			frappe.get_doc(
				{"doctype": REPORT_SETTINGS, "report": TB, "drilldowns": json.dumps(rules)}
			).insert()

	def test_a_rule_of_the_record_adds_to_the_shipped_and_reaches_get_meta(self):
		extra = {
			"label": "Ledger by party",
			"source_column": "account",
			"report": GL,
			"filters": {"account": ["row:account"], "categorize_by": "Categorize by Party"},
		}
		frappe.get_doc(
			{
				"doctype": REPORT_SETTINGS,
				"report": TB,
				"drilldowns": json.dumps([extra]),
				"link_open": "Drawer",
			}
		).insert()
		settings = api.get_meta(TB)["settings"]
		labels = [r["label"] for r in settings["drilldowns"]]
		self.assertIn("General Ledger", labels)
		self.assertIn("Ledger by party", labels)
		self.assertEqual(settings["link_open"], "drawer")

	def test_drill_and_range_selection_can_be_turned_off(self):
		frappe.get_doc({"doctype": REPORT_SETTINGS, "report": TB, "drill": 0, "range_selection": 0}).insert()
		features = api.get_meta(TB)["settings"]["features"]
		self.assertFalse(features["drill"])
		self.assertFalse(features["range_selection"])

	# ---------------------------------------------------------------- the run

	def tb_account_row(self, user: str, company: str) -> tuple[dict, dict]:
		filters = dict(TB_FILTERS, company=company)
		with self.as_user(user):
			response = api.run(TB, filters, TB_JS_FILTERS)
		self.assertEqual(response["status"], "ok")
		rows = [
			r
			for r in response["raw"]["result"]
			if isinstance(r, dict)
			and r.get("account")
			and frappe.db.get_value("Account", r["account"], "is_group") == 0
		]
		moved = [r for r in rows if (r.get("debit") or 0) or (r.get("credit") or 0)]
		if not moved:
			self.skipTest(f"no account of {company} moved in the period")
		return moved[0], filters

	def test_the_target_runs_with_the_mapped_filters_and_the_users_permissions(self):
		row, filters = self.tb_account_row("accountant", COMPANY)
		gl_filters = map_filters(self.shipped_rule(), row, filters)
		self.assertEqual(gl_filters["account"], [row["account"]])
		self.assertEqual(gl_filters["company"], COMPANY)
		with self.as_user("accountant"):
			response = api.run(GL, gl_filters, GL_JS_FILTERS)
		self.assertEqual(response["status"], "ok")
		entries = [r for r in response["raw"]["result"] if isinstance(r, dict) and r.get("voucher_no")]
		self.assertTrue(entries, "the General Ledger of the account has its entries")
		self.assertEqual({r.get("account") for r in entries}, {row["account"]})
		# the movement of the period matches the Trial Balance's
		debit = sum(r.get("debit") or 0 for r in entries)
		credit = sum(r.get("credit") or 0 for r in entries)
		self.assertAlmostEqual(debit, row.get("debit") or 0, places=2)
		self.assertAlmostEqual(credit, row.get("credit") or 0, places=2)

	def test_the_restricted_user_cannot_drill_into_another_companys_account(self):
		row, filters = self.tb_account_row("accountant", COMPANY)
		gl_filters = map_filters(self.shipped_rule(), row, filters)
		with self.as_user("restricted"), self.assertRaises((frappe.ValidationError, frappe.PermissionError)):
			api.run(GL, gl_filters, GL_JS_FILTERS)
		# its own company with the other company's account (a forged rule or row): every value of
		# the shipped MultiSelectList filter is checked as Frappe checks a Link (ADR-021)
		with self.as_user("restricted"), self.assertRaises(frappe.PermissionError) as cm:
			api.run(GL, dict(gl_filters, company=OTHER_COMPANY), GL_JS_FILTERS)
		self.assertIn(row["account"], str(cm.exception))
		# its own company and its own account: runs
		own = frappe.db.get_value("Account", {"company": OTHER_COMPANY, "is_group": 0}, "name")
		if own:
			with self.as_user("restricted"):
				response = api.run(GL, dict(gl_filters, company=OTHER_COMPANY, account=[own]), GL_JS_FILTERS)
			self.assertEqual(response["status"], "ok")
		# the accountant may read both companies' accounts: the check refuses nothing it may see
		with self.as_user("accountant"):
			self.assertEqual(api.run(GL, gl_filters, GL_JS_FILTERS)["status"], "ok")
