import inspect
from unittest.mock import patch

import frappe
from frappe.desk import query_report

from report_view import api
from report_view.core import engine, normalize
from report_view.core.errors import RVInvalidInput
from report_view.core.settings import load_settings
from report_view.tests.utils import (
	AR_FILTERS,
	COMPANY,
	OTHER_COMPANY,
	TB_FILTERS,
	TB_JS_FILTERS,
	TB_MEASURES,
	RVTestCase,
)


class TestApiRun(RVTestCase):
	def test_contract_of_query_report_run(self):
		"""ADR-002: detect signature changes of frappe.desk.query_report.run."""
		params = inspect.signature(inspect.unwrap(query_report.run)).parameters
		for name in ("report_name", "filters", "js_filters", "are_default_filters", "ignore_prepared_report"):
			self.assertIn(name, params)

	def test_allowed_user_runs_trial_balance(self):
		with self.as_user("accountant"):
			response = api.run("Trial Balance", TB_FILTERS, TB_JS_FILTERS)
		self.assertEqual(response["status"], "ok")
		self.assertEqual(response["limit"], 50000)
		self.assertEqual(response["row_count"], len(response["raw"]["result"]))
		self.assertIsInstance(response["execution_time"], float)

	def test_trial_balance_totals_match_internal_total(self):
		with self.as_user("accountant"):
			response = api.run("Trial Balance", TB_FILTERS, TB_JS_FILTERS)
		settings = load_settings("Trial Balance")
		nr = normalize.normalize(response["raw"], TB_FILTERS, settings["report_settings"])
		totals = engine.apply(nr, {"v": 1})["totals"]
		reference = nr["report_totals"]["internal"][-1]
		for key in TB_MEASURES:
			self.assertAlmostEqual(totals[key], reference[key], places=2, msg=key)

	def test_row_count_excludes_frappe_total(self):
		with self.as_user("accountant"):
			response = api.run("Accounts Receivable", AR_FILTERS)
		raw = response["raw"]
		self.assertTrue(raw["add_total_row"])
		self.assertIsInstance(raw["result"][-1], list)
		self.assertEqual(response["row_count"], len(raw["result"]) - 1)

	def test_denied_user_without_roles(self):
		with self.as_user("none"), self.assertRaises(frappe.PermissionError):
			api.run("Trial Balance", TB_FILTERS, TB_JS_FILTERS)

	def test_restricted_user_cannot_use_other_company(self):
		with self.as_user("restricted"), self.assertRaises(frappe.ValidationError):
			api.run("Trial Balance", TB_FILTERS, TB_JS_FILTERS)

	def test_server_filter_defs_cannot_be_dropped_by_browser(self):
		forged = [{"fieldname": "company", "fieldtype": "Data", "options": None}]
		with self.as_user("restricted"):
			for js_filters in (None, forged):
				with self.subTest(js_filters=js_filters), self.assertRaises(frappe.ValidationError):
					api.run("Trial Balance", TB_FILTERS, js_filters)

	def test_restricted_user_own_company(self):
		if not frappe.db.exists("Company", OTHER_COMPANY):
			self.skipTest(f"{OTHER_COMPANY} missing")
		with self.as_user("restricted"):
			response = api.run("Trial Balance", dict(TB_FILTERS, company=OTHER_COMPANY), TB_JS_FILTERS)
		self.assertEqual(response["status"], "ok")
		accounts = [r.get("account") for r in response["raw"]["result"]]
		self.assertFalse([a for a in accounts if a and a.endswith(" - SA")], "rows of SND Accounting leaked")

	def test_invalid_filters(self):
		with self.as_user("accountant"):
			for bad in ("{not json", '["a"]', {"company": {"x": 1}}):
				with self.subTest(bad=bad), self.assertRaises(RVInvalidInput):
					api.run("Trial Balance", bad)

	def test_prepared_report_name_of_other_owner_rejected(self):
		with self.as_user("accountant"), self.assertRaises(RVInvalidInput):
			api.run("Stock Balance", {"company": COMPANY}, None, "not-a-prepared-report")

	def test_prepared_report_without_result(self):
		# Stock Balance roles (Stock User/Manager) are not held by System Manager alone.
		with self.set_user("Administrator"):
			response = api.run("Stock Balance", {"company": COMPANY, "warehouse": "rv-none-xyz"})
		self.assertIn(response["status"], ("prepared_missing", "prepared_pending"))
		self.assertNotIn("raw", response)

	def test_too_large(self):
		with self.as_user("accountant"), patch("report_view.core.runner.get_row_limit", return_value=5):
			response = api.run("Trial Balance", TB_FILTERS, TB_JS_FILTERS)
		self.assertEqual(response["status"], "too_large")
		self.assertEqual(response["limit"], 5)
		self.assertNotIn("raw", response)
