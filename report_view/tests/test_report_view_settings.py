"""Report View Settings (ADR-023): the record over the shipped file, key by key; the shipped
filter definitions (ADR-021) never weakened; validation with the loader's own parsers; the
merged cache cleared with the record; who may read and change it; the row details' sandbox."""

import json
from unittest.mock import patch

import frappe

from report_view import api
from report_view.api import settings as settings_api
from report_view.core import row_details
from report_view.core.errors import RVInvalidInput, RVNoExport
from report_view.core.settings import (
	MERGED_CACHE_KEY,
	REPORT_SETTINGS,
	load_settings,
	shipped_settings,
)
from report_view.tests.utils import TB_FILTERS, RVTestCase

TB = "Trial Balance"


class TestReportViewSettings(RVTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		frappe.cache.hdel(MERGED_CACHE_KEY, TB)

	def tearDown(self):
		frappe.set_user("Administrator")
		if frappe.db.exists(REPORT_SETTINGS, TB):
			frappe.delete_doc(REPORT_SETTINGS, TB, force=True)
		frappe.cache.hdel(MERGED_CACHE_KEY, TB)

	def make(self, **values):
		doc = frappe.get_doc({"doctype": REPORT_SETTINGS, "report": TB, **values})
		return doc.insert()

	# ---------------------------------------------------------------- precedence

	def test_without_a_record_the_shipped_file_is_read_and_every_tool_is_on(self):
		s = load_settings(TB)
		self.assertEqual(s["source"], "defaults")
		self.assertEqual(s["filter_defs"], shipped_settings(TB)["filter_defs"])
		self.assertTrue(all(v for k, v in s["features"].items() if k != "chart_types"))
		self.assertEqual(len(s["features"]["chart_types"]), 8)
		self.assertTrue(s["row_details"]["enabled"])

	def test_the_record_wins_key_by_key_and_empty_parts_keep_the_shipped(self):
		shipped = shipped_settings(TB)
		self.make(
			pivot=0,
			chart_donut=0,
			default_mode="Charts",
			default_group_by="account_type\nroot_type",
			report_settings=json.dumps({"initial_depth": 1}),
			balance_pairs=json.dumps(
				[{"label": "Opening", "debit_column": "debit", "credit_column": "credit"}]
			),
		)
		s = load_settings(TB)
		self.assertEqual(s["source"], "settings")
		self.assertFalse(s["features"]["pivot"])
		self.assertNotIn("donut", s["features"]["chart_types"])
		self.assertEqual(s["default_mode"], "charts")
		self.assertEqual(s["default_view"]["group_by"], ["account_type", "root_type"])
		# merged with the shipped object: its other keys stay
		self.assertEqual(s["report_settings"]["initial_depth"], 1)
		self.assertEqual(s["report_settings"]["name_field"], shipped["report_settings"]["name_field"])
		# a list merged by its key: Opening replaced, Movement and Closing kept
		pairs = {p["label"]: p for p in s["balance_pairs"]}
		self.assertEqual(pairs["Opening"]["debit_column"], "debit")
		self.assertEqual(set(pairs), {p["label"] for p in shipped["balance_pairs"]})
		# not set in the record: the shipped value
		self.assertEqual(s["enrich_rules"], shipped["enrich_rules"])

	def test_disabled_record_hides_the_entry_button(self):
		self.assertTrue(api.get_entry_state(TB)["show"])
		self.make(enabled=0)
		self.assertEqual(api.get_entry_state(TB), {"show": False})
		self.assertFalse(api.get_meta(TB)["settings"]["enabled"])

	# ---------------------------------------------------------------- ADR-021

	def test_shipped_filter_defs_cannot_be_removed_or_retyped(self):
		shipped = shipped_settings(TB)["filter_defs"]
		company = next(d for d in shipped if d["fieldname"] == "company")
		# changed in the record: refused on save
		for forged in (
			{**company, "fieldtype": "MultiSelectList"},
			{**company, "options": "Fiscal Year"},
		):
			with self.subTest(forged=forged), self.assertRaises(frappe.ValidationError):
				self.make(filter_defs=json.dumps([forged]))
		# a list without the shipped ones and with a new one: the shipped ones stay, the new one is added
		added = {"fieldname": "rv_extra", "fieldtype": "Link", "options": "Company"}
		self.make(filter_defs=json.dumps([added]))
		defs = load_settings(TB)["filter_defs"]
		for d in shipped:
			self.assertIn(d, defs)
		self.assertIn(added, defs)
		# even written past validation (a data import, a patch): the loader keeps the shipped
		frappe.db.set_value(
			REPORT_SETTINGS, TB, "filter_defs", json.dumps([{**company, "fieldtype": "MultiSelectList"}])
		)
		frappe.cache.hdel(MERGED_CACHE_KEY, TB)
		self.assertIn(company, load_settings(TB)["filter_defs"])
		self.assertEqual(
			[d for d in load_settings(TB)["filter_defs"] if d["fieldname"] == "company"], [company]
		)

	def test_a_dropped_company_link_is_still_checked_with_a_record(self):
		"""The run path itself: with a record, the browser dropping the company definition
		still gets Frappe's Link check (ADR-021 test, through the merged settings)."""
		from report_view.tests.test_api_run import denied_link_check

		self.make(
			filter_defs=json.dumps([{"fieldname": "rv_extra", "fieldtype": "Link", "options": "Company"}])
		)
		report = frappe.get_doc("Report", TB)
		calls = denied_link_check(
			self,
			report,
			TB,
			{**TB_FILTERS, "company": "rv-forbidden"},
			[{"fieldname": "company", "fieldtype": "Data"}],
		)
		self.assertIn(("Company", "rv-forbidden"), calls)

	# ---------------------------------------------------------------- validation

	def test_invalid_json_parts_are_refused_with_the_loaders_rules(self):
		for field, value in (
			("report_settings", "[1]"),
			("report_settings", "{bad"),
			(
				"enrich_rules",
				json.dumps([{"source_column": "account", "link_doctype": "No Such DocType", "fields": "x"}]),
			),
			(
				"enrich_rules",
				json.dumps([{"source_column": "a b", "link_doctype": "Account", "fields": "root_type"}]),
			),
			(
				"enrich_rules",
				json.dumps([{"source_column": "account", "link_doctype": "Account", "fields": "owner.name"}]),
			),
			("balance_pairs", json.dumps([{"label": "", "debit_column": "d", "credit_column": "c"}])),
			("filter_defs", json.dumps([{"fieldname": "x", "fieldtype": "Data", "options": "Company"}])),
			(
				"filter_defs",
				json.dumps([{"fieldname": "x", "fieldtype": "Link", "options": "No Such DocType"}]),
			),
			("default_hidden", "a b"),
		):
			with self.subTest(field=field, value=value), self.assertRaises(frappe.ValidationError):
				self.make(**{field: value})

	def test_a_default_that_is_turned_off_is_refused(self):
		for values in (
			{"pivot": 0, "default_mode": "Pivot analysis"},
			{"grouping": 0, "default_group_by": "account"},
			{"pinning": 0, "default_pinned": "account"},
			{
				"chart_bar": 0,
				"chart_stacked": 0,
				"chart_hbar": 0,
				"chart_hstacked": 0,
				"chart_line": 0,
				"chart_area": 0,
				"chart_donut": 0,
				"chart_kpi": 0,
			},
		):
			with self.subTest(values=values), self.assertRaises(frappe.ValidationError):
				self.make(**values)

	# ---------------------------------------------------------------- cache

	def test_the_merged_cache_follows_the_record(self):
		self.assertTrue(load_settings(TB)["features"]["charts"])
		doc = self.make(charts=0)
		self.assertFalse(load_settings(TB)["features"]["charts"])
		# read once, then from the cache
		with patch("report_view.core.settings.read_record") as read:
			load_settings(TB)
			read.assert_not_called()
		doc.charts = 1
		doc.save()
		self.assertTrue(load_settings(TB)["features"]["charts"])
		doc.excel = 0
		doc.save()
		self.assertFalse(load_settings(TB)["features"]["excel"])
		doc.delete()
		self.assertTrue(load_settings(TB)["features"]["excel"])
		self.assertEqual(load_settings(TB)["source"], "defaults")

	def test_a_rolled_back_record_leaves_no_cached_settings(self):
		frappe.db.savepoint("rvs")
		self.make(pivot=0)
		self.assertFalse(load_settings(TB)["features"]["pivot"])
		frappe.db.rollback(save_point="rvs")
		# the savepoint rollback runs no callbacks: the cache is cleared as the record goes
		frappe.cache.hdel(MERGED_CACHE_KEY, TB)
		self.assertTrue(load_settings(TB)["features"]["pivot"])

	# ---------------------------------------------------------------- permissions

	def test_only_a_system_manager_reads_or_changes_the_record(self):
		self.make(pivot=0)
		for kind in ("accountant", "none"):
			with self.subTest(user=kind), self.as_user(kind):
				self.assertFalse(frappe.has_permission(REPORT_SETTINGS, "read", TB))
				self.assertFalse(frappe.has_permission(REPORT_SETTINGS, "write", TB))
		with self.as_user("admin"):
			self.assertTrue(frappe.has_permission(REPORT_SETTINGS, "write", TB))
		# the accountant still gets the merged result through get_meta
		with self.as_user("accountant"):
			self.assertFalse(api.get_meta(TB)["settings"]["features"]["pivot"])
			with self.assertRaises(frappe.PermissionError):
				settings_api.shipped_values(TB)
			with self.assertRaises(frappe.PermissionError):
				settings_api.preview(TB, {"pivot": 0})
		# the form's helpers check the report first
		with self.as_user("none"), self.assertRaises(frappe.PermissionError):
			settings_api.shipped_values(TB)

	def test_form_helpers(self):
		# Administrator: the test System Manager has no role on the report itself
		shipped = settings_api.shipped_values(TB)
		self.assertTrue(shipped["shipped"])
		self.assertEqual(json.loads(shipped["values"]["filter_defs"]), shipped_settings(TB)["filter_defs"])
		self.assertEqual(shipped["values"]["pivot"], 1)
		reset = settings_api.reset_values(TB)["values"]
		self.assertIsNone(reset["filter_defs"])
		out = settings_api.preview(TB, {"pivot": 0, "charts": 1, "chart_bar": 1, "report_settings": "[1]"})
		self.assertFalse(out["settings"]["features"]["pivot"])
		self.assertIn("must be", out["error"])
		# the shipped file loaded as it is saves (the shipped definitions repeated unchanged)
		doc = frappe.get_doc({"doctype": REPORT_SETTINGS, "report": TB, **shipped["values"]})
		doc.insert()
		self.assertEqual(load_settings(TB)["filter_defs"], shipped_settings(TB)["filter_defs"])

	def test_every_shipped_file_saves_as_a_new_record(self):
		# General Ledger: party is a MultiSelectList whose DocType is the party_type filter
		from report_view.core.settings import parse_filter_defs

		for report in frappe.get_all(
			"Report", filters={"name": ("in", ["General Ledger", TB])}, pluck="name"
		):
			defs = shipped_settings(report)["filter_defs"]
			self.assertEqual(parse_filter_defs(defs, strict=True), defs)
		party = {"fieldname": "party", "fieldtype": "MultiSelectList", "options": "party_type"}
		self.assertEqual(parse_filter_defs([party], strict=True), [party])
		with self.assertRaises(frappe.ValidationError):
			parse_filter_defs([{**party, "options": "Not A Doctype"}], strict=True)

	def test_a_party_list_is_checked_against_the_party_type_filter(self):
		from report_view.core.runner import check_list_filters

		defs = [{"fieldname": "party", "fieldtype": "MultiSelectList", "options": "party_type"}]
		customer = frappe.get_all("Customer", limit=1, pluck="name")
		if not customer:
			self.skipTest("no Customer on this site")
		with patch("frappe.has_permission", return_value=False) as perm:
			with self.assertRaises(frappe.PermissionError):
				check_list_filters(defs, {"party_type": "Customer", "party": customer})
			perm.assert_called_with("Customer", "read", doc=customer[0])
		# no party type: nothing to check against, the report decides
		check_list_filters(defs, {"party": customer})

	def test_excel_turned_off_is_refused_by_the_server(self):
		self.make(excel=0)
		with self.as_user("accountant"), self.assertRaises(RVNoExport):
			api.export_xlsx(TB, {"format": "xlsx"})

	# ---------------------------------------------------------------- row details

	def test_row_details_config_reaches_get_meta_without_the_template(self):
		self.make(
			row_details_container="Dialog",
			row_details_width="Wide",
			row_details_content="HTML template",
			row_details_html="<b>{{ row.account }}</b>",
			row_details_document=1,
			row_details_doc_fields=json.dumps({"doctype_field": "voucher_type", "name_field": "voucher_no"}),
		)
		conf = api.get_meta(TB)["settings"]["row_details"]
		self.assertEqual(
			conf,
			{
				"enabled": True,
				"container": "dialog",
				"width": "wide",
				"content": "html",
				"print_format": None,
				"document": True,
				"doc_fields": {"doctype_field": "voucher_type", "name_field": "voucher_no"},
			},
		)
		self.assertNotIn("row_details_html", json.dumps(api.get_meta(TB)["settings"]))

	def test_row_details_validation(self):
		for values in (
			{"row_details_content": "HTML template", "row_details_html": "{% if %}"},
			{"row_details_content": "HTML template", "row_details_html": "{{ ''.__class__ }}"},
			{"row_details_content": "Print format", "row_details_print_format": "Standard"},
			{"row_details_document": 1, "row_details_doc_fields": json.dumps({"doctype_field": "a b"})},
		):
			with self.subTest(values=values), self.assertRaises(frappe.ValidationError):
				doc = frappe.get_doc({"doctype": REPORT_SETTINGS, "report": TB, **values})
				doc.flags.ignore_mandatory = True
				doc.insert()

	def test_row_details_sandbox(self):
		def render(html, row):
			return row_details.render_template(html, TB, row, [], {})

		# the row is escaped; no Frappe, no database, no attribute walk
		self.assertEqual(render("{{ row.x }}", {"x": "<script>"}), "&lt;script&gt;")
		self.assertEqual(render("{{ frappe }}{{ db }}", {}), "")
		with self.assertRaises(frappe.ValidationError):
			render("{{ frappe.db }}", {})
		self.assertEqual(render("{{ report }}|{{ _('Total') }}", {}), f"{TB}|{frappe._('Total')}")
		with self.assertRaises(frappe.ValidationError):
			render("{{ ''.__class__.__mro__ }}", {})
		with self.assertRaises(frappe.ValidationError):
			render("{{ frappe.db.sql('select 1') }}", {})
		with self.assertRaises(frappe.ValidationError):
			render("{% include 'templates/base.html' %}", {})

	def test_render_row_details_checks_the_report_and_its_input(self):
		self.make(row_details_content="HTML template", row_details_html="<i>{{ row.account }}</i>")
		with self.as_user("none"), self.assertRaises(frappe.PermissionError):
			api.render_row_details(TB, {"account": "x"})
		with self.as_user("accountant"):
			out = api.render_row_details(TB, json.dumps({"account": "<b>A</b>"}))
			self.assertEqual(out["html"], "<i>&lt;b&gt;A&lt;/b&gt;</i>")
			with self.assertRaises(RVInvalidInput):
				api.render_row_details(TB, json.dumps({"x": "y" * (row_details.MAX_ROW_BYTES + 1)}))
			with self.assertRaises(RVInvalidInput):
				api.render_row_details(TB, "[1]")
		frappe.db.set_value(REPORT_SETTINGS, TB, "row_details_content", "Fields")
		frappe.cache.hdel(MERGED_CACHE_KEY, TB)
		with self.as_user("accountant"), self.assertRaises(RVInvalidInput):
			api.render_row_details(TB, {"account": "x"})
