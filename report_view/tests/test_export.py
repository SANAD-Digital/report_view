import json
from io import BytesIO
from unittest.mock import patch

import frappe
from openpyxl import load_workbook

from report_view import api
from report_view.core.errors import RVExportMismatch, RVInvalidInput, RVInvalidViewState, RVNoExport
from report_view.tests.utils import AR_FILTERS, TB_FILTERS, TB_JS_FILTERS, RVTestCase


def tb_model(**overrides) -> dict:
	model = {
		"version": 1,
		"format": "xlsx",
		"filters": TB_FILTERS,
		"js_filters": TB_JS_FILTERS,
		"prepared_report_name": None,
		"view_state": {"v": 1, "mode": "grid", "tree": {"depth": 3}},
		"scope": "all",
		"selection": None,
		"layout": {"title": "Trial Balance", "include_filters": True},
		"locale": {"lang": "ar", "rtl": True},
	}
	model.update(overrides)
	return model


class TestExportXlsx(RVTestCase):
	def setUp(self):
		super().setUp()
		frappe.response.pop("filecontent", None)

	def _export(self, report: str, model: dict):
		api.export_xlsx(report, json.dumps(model))
		self.assertEqual(frappe.response["type"], "binary")
		return load_workbook(BytesIO(frappe.response["filecontent"]))

	def _reference_totals(self) -> dict:
		with self.as_user("accountant"):
			raw = api.run("Trial Balance", TB_FILTERS, TB_JS_FILTERS)["raw"]
		total = next(r for r in raw["result"] if r.get("account") == "'Total'")
		return {k: total[k] for k in ("debit", "credit", "closing_debit", "closing_credit")}

	def test_allowed_user_rtl_workbook(self):
		expected = {"totals": self._reference_totals()}
		old_lang = frappe.local.lang
		try:
			with self.as_user("accountant"):
				frappe.local.lang = "ar"
				wb = self._export("Trial Balance", tb_model(expected=expected))
		finally:
			frappe.local.lang = old_lang
		ws = wb.active
		self.assertTrue(ws.sheet_view.rightToLeft)
		self.assertEqual(ws["A1"].value, TB_FILTERS["company"])
		self.assertIsNotNone(ws.freeze_panes)
		# Band row (Opening / Movement / Closing) above the column headers.
		merged = {str(r) for r in ws.merged_cells.ranges}
		self.assertTrue(any(r.startswith("E") and ":F" in r for r in merged))
		# Outline levels for the tree and a bold grand total row with numbers.
		self.assertTrue(any((ws.row_dimensions[r].outline_level or 0) > 0 for r in range(1, ws.max_row + 1)))
		last = [c.value for c in ws[ws.max_row]]
		self.assertIn(expected["totals"]["debit"], last)
		self.assertTrue(ws.cell(row=ws.max_row, column=7).font.bold)
		number_cells = [c for c in ws[ws.max_row] if isinstance(c.value, int | float)]
		self.assertTrue(all(c.number_format.startswith("#,##0") for c in number_cells))

	def test_ltr_workbook_in_english(self):
		old_lang = frappe.local.lang
		try:
			with self.as_user("accountant"):
				frappe.local.lang = "en"
				wb = self._export("Trial Balance", tb_model())
		finally:
			frappe.local.lang = old_lang
		self.assertFalse(wb.active.sheet_view.rightToLeft)

	def test_mismatch_rejected(self):
		totals = self._reference_totals()
		totals["debit"] += 1
		# log_error may be deferred (redis) and would outlive the test rollback.
		with (
			patch("report_view.core.export.model.frappe.log_error") as log_error,
			self.as_user("accountant"),
			self.assertRaises(RVExportMismatch),
		):
			self._export("Trial Balance", tb_model(expected={"totals": totals}))
		log_error.assert_called_once()

	def test_invalid_view_state(self):
		with self.as_user("accountant"):
			for state in (
				{"v": 1, "sort": [{"key": "no_such_column", "dir": "asc"}]},
				{"v": 1, "unknown": 1},
				{"v": 1, "filters": [{"key": "debit", "type": "regex", "value": "x"}]},
				{"v": 2},
				{"v": 1, "mode": "pivot"},
			):
				with self.subTest(state=state), self.assertRaises(RVInvalidViewState):
					self._export("Trial Balance", tb_model(view_state=state))

	def test_invalid_model(self):
		with self.as_user("accountant"):
			for model in (tb_model(version=2), tb_model(format="pdf"), dict(tb_model(), extra=1)):
				with self.subTest(model=model), self.assertRaises(RVInvalidInput):
					self._export("Trial Balance", model)
			with self.assertRaises(RVInvalidInput):
				api.export_xlsx("Trial Balance", "x" * (257 * 1024))

	def test_group_export(self):
		model = tb_model(view_state={"v": 1, "group": {"by": ["currency"], "subtotals": True}})
		with self.as_user("accountant"):
			wb = self._export("Trial Balance", model)
		self.assertGreater(wb.active.max_row, 5)

	def test_user_without_export_rejected(self):
		model = tb_model(filters=AR_FILTERS, js_filters=[], view_state={"v": 1})
		with self.as_user("accountant"):
			if frappe.permissions.can_export("Sales Invoice"):
				self.skipTest("Accounts User can export Sales Invoice on this site")
			with self.assertRaises(RVNoExport):
				self._export("Accounts Receivable", model)

	def test_denied_user(self):
		with self.as_user("none"), self.assertRaises(frappe.PermissionError):
			self._export("Trial Balance", tb_model())
