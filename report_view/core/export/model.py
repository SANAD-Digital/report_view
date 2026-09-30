"""Export model validation (docs/architecture.md §4.1-4.2)."""

import math
from typing import Any

import frappe
from frappe import _
from frappe.utils import cint
from frappe.utils.number_format import NUMBER_FORMAT_MAP

from report_view.core import view_state as vs
from report_view.core.errors import RVExportMismatch, RVInvalidInput, RVInvalidViewState
from report_view.core.inputs import parse_json_arg, validate_js_filters, validate_report_filters

MODEL_KEYS = frozenset(
	(
		"version",
		"format",
		"filters",
		"js_filters",
		"prepared_report_name",
		"view_state",
		"scope",
		"selection",
		"expected",
		"layout",
		"locale",
	)
)
LAYOUT_KEYS = frozenset(
	(
		"title",
		"orientation",
		"page_size",
		"include_filters",
		"include_subtotals",
		"include_signatures",
		"columns",
	)
)
MAX_TITLE = 140


def _bad(message: str) -> None:
	frappe.throw(message, RVInvalidInput)


def _is_number(value: Any) -> bool:
	return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


def parse(export_model: Any, fmt: str) -> dict:
	"""Parse and validate the export model shape (§4.2 steps 1-2, 4-6 before the run)."""
	model = parse_json_arg(export_model, "export_model", dict)
	extra = set(model) - MODEL_KEYS
	if extra:
		_bad(_("Unknown keys in export model: {0}").format(", ".join(sorted(map(str, extra)))))
	if model.get("version") != 1:
		_bad(_("Unsupported export model version"))
	if model.get("format") != fmt:
		_bad(_("Export format does not match"))

	filters = validate_report_filters(parse_json_arg(model.get("filters") or {}, "filters", dict))
	js_filters = validate_js_filters(model.get("js_filters") or [])
	prepared = model.get("prepared_report_name")
	if prepared is not None and not isinstance(prepared, str):
		_bad(_("Invalid prepared report name"))

	state = vs.validate(model.get("view_state") or {"v": 1})
	if state.get("mode", "grid") != "grid":
		frappe.throw(_("Only the grid view can be exported in this version"), RVInvalidViewState)

	scope = model.get("scope") or "all"
	if scope not in ("all", "selection"):
		_bad(_("Invalid export scope"))
	selection = None
	if scope == "selection":
		selection = model.get("selection")
		if not isinstance(selection, dict) or set(selection) - {"row_rids", "column_keys"}:
			_bad(_("Invalid selection"))
		rids = selection.get("row_rids")
		keys = selection.get("column_keys")
		if rids is not None and (
			not isinstance(rids, list) or not all(isinstance(r, int) and not isinstance(r, bool) for r in rids)
		):
			_bad(_("Invalid selection"))
		if keys is not None and (not isinstance(keys, list) or not all(isinstance(k, str) for k in keys)):
			_bad(_("Invalid selection"))

	expected = model.get("expected")
	if expected is not None:
		if not isinstance(expected, dict) or set(expected) - {"row_count", "totals"}:
			_bad(_("Invalid expected totals"))
		if "row_count" in expected and not (
			isinstance(expected["row_count"], int) and not isinstance(expected["row_count"], bool)
		):
			_bad(_("Invalid expected totals"))
		totals = expected.get("totals") or {}
		if not isinstance(totals, dict):
			_bad(_("Invalid expected totals"))
		for value in totals.values():
			if value is not None and not _is_number(value) and value != {"mixed": True}:
				_bad(_("Invalid expected totals"))

	layout = model.get("layout") or {}
	if not isinstance(layout, dict) or set(layout) - LAYOUT_KEYS:
		_bad(_("Invalid layout"))
	title = layout.get("title")
	if title is not None and (not isinstance(title, str) or len(title) > MAX_TITLE):
		_bad(_("Invalid title"))
	layout_columns = layout.get("columns") or []
	if not isinstance(layout_columns, list):
		_bad(_("Invalid layout"))
	for col in layout_columns:
		if not isinstance(col, dict) or not isinstance(col.get("key"), str) or set(col) - {"key", "width"}:
			_bad(_("Invalid layout"))
		if col.get("width") is not None and not _is_number(col["width"]):
			_bad(_("Invalid layout"))

	return {
		"filters": filters,
		"js_filters": js_filters,
		"prepared_report_name": prepared or None,
		"view_state": state,
		"scope": scope,
		"selection": selection,
		"expected": expected,
		"layout": {
			"title": title,
			"include_filters": layout.get("include_filters", True) is not False,
			"include_subtotals": layout.get("include_subtotals", True) is not False,
			"columns": layout_columns,
		},
	}


def check_against_report(model: dict, nr: dict) -> None:
	"""§4.2 steps 3 and 5: keys exist in the server-built NormalizedReport."""
	vs.check_against_columns(model["view_state"], nr["columns"])
	known = {c["key"] for c in nr["columns"]}
	unknown = [c["key"] for c in model["layout"]["columns"] if c["key"] not in known]
	selection = model["selection"] or {}
	unknown += [k for k in selection.get("column_keys") or [] if k not in known]
	if unknown:
		frappe.throw(
			_("Export refers to unknown columns: {0}").format(", ".join(sorted(set(unknown)))),
			RVInvalidViewState,
		)
	rids = selection.get("row_rids") or []
	if len(rids) > len(nr["rows"]) or any(r < 0 or r >= len(nr["rows"]) for r in rids):
		frappe.throw(_("Invalid row selection"), RVInvalidViewState)


def column_precision(column: dict) -> int:
	"""Precision used for the mismatch tolerance and number formats."""
	precision = (column.get("original") or {}).get("precision")
	if precision not in (None, ""):
		return cint(precision)
	if column["fieldtype"] == "Int":
		return 0
	if column["fieldtype"] == "Currency":
		currency_precision = frappe.db.get_single_value("System Settings", "currency_precision")
		if currency_precision not in (None, ""):
			return cint(currency_precision)
		number_format = frappe.db.get_single_value("System Settings", "number_format") or "#,###.##"
		return NUMBER_FORMAT_MAP.get(number_format, (".", ",", 2))[2]
	return cint(frappe.db.get_single_value("System Settings", "float_precision") or 3)


def compare_expected(model: dict, result: dict, nr: dict, report_name: str) -> None:
	"""ADR-001 / §4.2 step 7: raise RVExportMismatch when server and browser disagree."""
	expected = model.get("expected")
	if not expected:
		return
	by_key = {c["key"]: c for c in nr["columns"]}
	differences = []
	if "row_count" in expected and expected["row_count"] != result["row_count"]:
		differences.append(f"row_count: {expected['row_count']} != {result['row_count']}")
	for key, want in (expected.get("totals") or {}).items():
		col = by_key.get(key)
		if col is None:
			differences.append(f"{key}: unknown column")
			continue
		have = result["totals"].get(key)
		if isinstance(want, dict) or isinstance(have, dict):
			if want != have:
				differences.append(f"{key}: {want} != {have}")
			continue
		if want is None or have is None:
			if (want or 0) != (have or 0):
				differences.append(f"{key}: {want} != {have}")
			continue
		tolerance = 0.5 * 10 ** (-column_precision(col))
		if abs(float(want) - float(have)) > tolerance:
			differences.append(f"{key}: {want} != {have}")
	if differences:
		detail = "; ".join(differences)
		frappe.log_error(
			title=f"Report View export mismatch: {report_name}",
			message=detail,
			reference_doctype="Report",
			reference_name=report_name,
		)
		frappe.throw(
			_("Export totals do not match what is shown on screen: {0}").format(detail),
			RVExportMismatch,
		)
