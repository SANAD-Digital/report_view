import inspect
from unittest.mock import patch

import frappe
from frappe.desk import query_report

from report_view import api
from report_view.core import engine, normalize, runner
from report_view.core.errors import RVInvalidInput, RVReportError
from report_view.core.settings import load_settings
from report_view.tests.utils import (
	COMPANY,
	COMPANY_ABBR,
	OTHER_COMPANY,
	TB_FILTERS,
	TB_JS_FILTERS,
	TB_MEASURES,
	TOTAL_ROW_REPORTS,
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
		"""N2.1: the total row Frappe appends (a list after dict rows) is not a row."""
		response = None
		with self.as_user("accountant"):
			for report, filters in TOTAL_ROW_REPORTS:
				candidate = api.run(report, filters)
				# A prepared report answers without rows (ADR-009): not what this test is about.
				if candidate["status"] == "ok" and candidate["raw"].get("result"):
					response = candidate
					break
		if response is None:
			self.skipTest("no report with add_total_row answers with rows on this site")
		raw = response["raw"]
		self.assertTrue(raw["add_total_row"])
		self.assertIsInstance(raw["result"][-1], list)
		self.assertIsInstance(raw["result"][0], dict)
		self.assertEqual(response["row_count"], len(raw["result"]) - 1)

	def test_count_rows_rule(self):
		"""The rule itself, independent of the site's data (runner.count_rows, N2.1)."""
		rows = [{"a": 1}, {"a": 2}, [3, None]]
		self.assertEqual(runner.count_rows({"result": rows, "add_total_row": 1}), 2)
		self.assertEqual(runner.count_rows({"result": rows, "add_total_row": 1, "skip_total_row": 1}), 3)
		self.assertEqual(runner.count_rows({"result": rows, "add_total_row": 0}), 3)
		self.assertEqual(runner.count_rows({"result": [{"a": 1}], "add_total_row": 1}), 1)
		self.assertEqual(runner.count_rows({"result": [], "add_total_row": 1}), 0)
		self.assertEqual(runner.count_rows({}), 0)

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
		with self.as_user("restricted"):
			response = api.run("Trial Balance", dict(TB_FILTERS, company=OTHER_COMPANY), TB_JS_FILTERS)
		self.assertEqual(response["status"], "ok")
		accounts = [r.get("account") for r in response["raw"]["result"]]
		self.assertFalse(
			[a for a in accounts if a and a.endswith(f" - {COMPANY_ABBR}")], f"rows of {COMPANY} leaked"
		)

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


class TestRunHardening(RVTestCase):
	"""The report's own error is logged and not shown; the per-user limits; the report
	checked once per request; the shipped settings read once."""

	def test_a_report_error_is_logged_not_shown(self):
		with (
			self.as_user("accountant"),
			patch("report_view.core.runner.query_report.run", side_effect=KeyError("tabSecret.column")),
			patch("report_view.core.runner.frappe.log_error") as log_error,
			patch.dict(frappe.local.conf, {"developer_mode": 0}),
			self.assertRaises(RVReportError) as caught,
		):
			api.run("Trial Balance", TB_FILTERS, TB_JS_FILTERS)
		self.assertNotIn("tabSecret", str(caught.exception))
		self.assertEqual(str(caught.exception), "The report could not run. The error was logged.")
		log_error.assert_called_once()
		# Frappe's own refusals still reach the user unchanged
		with (
			self.as_user("accountant"),
			patch("report_view.core.runner.query_report.run", side_effect=frappe.ValidationError("Bad date")),
			self.assertRaises(frappe.ValidationError) as caught,
		):
			api.run("Trial Balance", TB_FILTERS, TB_JS_FILTERS)
		self.assertEqual(str(caught.exception), "Bad date")

	def test_the_rate_limit_counts_per_user(self):
		from report_view.api import _rate_limit

		calls = []

		def counted():
			calls.append(1)

		limited = _rate_limit(2, seconds=5)(counted)
		# the counter is per function (module and qualified name) and per user
		name = f"{counted.__module__}.{counted.__qualname__}"
		keys = [
			frappe.cache.make_key(f"report_view:rl:{name}:{self.users[k]}:{5}")
			for k in ("accountant", "admin")
		]
		try:
			with patch.object(frappe.local, "request", True, create=True):
				with self.as_user("accountant"):
					limited()
					limited()
					with self.assertRaises(frappe.RateLimitExceededError):
						limited()
				# another user has a count of their own
				with self.as_user("admin"):
					limited()
			self.assertEqual(len(calls), 3)
		finally:
			for key in keys:
				frappe.cache.delete(key)
		# outside a web request (a job, a test, the console) nothing is counted
		with self.as_user("accountant"):
			for _i in range(3):
				limited()
		self.assertEqual(len(calls), 6)

	def test_two_functions_of_one_name_count_apart(self):
		"""``save`` of api.letterhead and of api.print_presets are two counters."""
		from report_view.api import _rate_limit

		def save():
			return 1

		def other_save():
			return 2

		other_save.__name__ = "save"
		other_save.__qualname__ = save.__qualname__
		other_save.__module__ = "report_view.api.print_presets"
		first, second = _rate_limit(1, seconds=5)(save), _rate_limit(1, seconds=5)(other_save)
		user = self.users["accountant"]
		keys = [
			frappe.cache.make_key(f"report_view:rl:{m}.{save.__qualname__}:{user}:5")
			for m in (save.__module__, "report_view.api.print_presets")
		]
		try:
			with patch.object(frappe.local, "request", True, create=True), self.as_user("accountant"):
				self.assertEqual((first(), second()), (1, 2))
				with self.assertRaises(frappe.RateLimitExceededError):
					first()
		finally:
			for key in keys:
				frappe.cache.delete(key)

	def test_the_report_is_checked_once_per_request(self):
		from report_view.api import _guard

		with (
			self.as_user("accountant"),
			patch("report_view.api.guard_report", wraps=api.guard_report) as guard,
		):
			self.assertIs(_guard("Trial Balance"), _guard("Trial Balance"))
			self.assertEqual(guard.call_count, 1)
		# per user: another user (set_user starts afresh) is checked again, and refused
		with self.as_user("none"), self.assertRaises(frappe.PermissionError):
			_guard("Trial Balance")

	def test_settings_are_read_once_and_copied(self):
		first = load_settings("Trial Balance")
		first["filter_defs"].append({"fieldname": "x"})
		with patch("report_view.core.settings.open") as opened:
			second = load_settings("Trial Balance")
			opened.assert_not_called()
		self.assertNotIn({"fieldname": "x"}, second["filter_defs"])
		self.assertEqual(second["source"], "defaults")
		# a name is never a path out of the defaults folder
		for name in ("../hooks", "a/b", "..", ""):
			self.assertIsNone(load_settings(name)["source"])
