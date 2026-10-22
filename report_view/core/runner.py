"""Wrapper around ``frappe.desk.query_report.run`` (ADR-002, docs/architecture.md §2.1).

The caller has already run ``guard_report``. Every Frappe permission layer
(``validate_filters_permissions``, ``get_report_doc``, ``get_filtered_data``)
runs again inside ``query_report.run``; nothing is re-implemented here.
"""

import time
from typing import Any

import frappe
from frappe import _
from frappe.core.doctype.report.report import Report
from frappe.desk import query_report
from frappe.model.document import Document

from report_view.core.errors import RVInvalidInput, RVReportError
from report_view.core.inputs import parse_json_arg, validate_js_filters, validate_report_filters
from report_view.core.settings import get_row_limit, load_settings

# Exceptions raised by Frappe/report code that must reach the browser unchanged.
_PASS_THROUGH = (frappe.PermissionError, frappe.DoesNotExistError, frappe.ValidationError)


# report names without shipped filter_defs, logged once per process (ADR-021)
_LOGGED_WITHOUT_DEFS: set[str] = set()


def merge_js_filters(browser_defs: list[dict], server_defs: list[dict]) -> list[dict]:
	"""Union of browser and server filter definitions; server wins on the same fieldname
	(ADR-021: a browser that omits or retypes a shipped filter cannot skip Frappe's check)."""
	server_names = {d["fieldname"] for d in server_defs}
	merged = [d for d in browser_defs if d["fieldname"] not in server_names]
	merged.extend(dict(d) for d in server_defs)
	return merged


def resolve_dynamic_links(defs: list[dict], filters: dict) -> list[dict]:
	"""A server Dynamic Link whose DocType filter holds an existing DocType is handed to
	Frappe as a Link of that DocType, so ``validate_filters_permissions`` checks its value
	(it checks Link only, Q:1149). Otherwise it stays as it is, which Frappe skips."""
	out = []
	for d in defs:
		doctype = filters.get(d.get("options") or "") if d.get("fieldtype") == "Dynamic Link" else None
		if isinstance(doctype, str) and doctype and frappe.db.exists("DocType", doctype):
			d = {"fieldname": d["fieldname"], "fieldtype": "Link", "options": doctype}
		out.append(d)
	return out


def server_filter_defs(report_name: str, settings: dict) -> list[dict]:
	"""The shipped filter_defs; a report without them keeps Frappe's behaviour (the
	browser's definitions only), logged once per process at debug level."""
	defs = settings["filter_defs"]
	if not defs and report_name not in _LOGGED_WITHOUT_DEFS:
		_LOGGED_WITHOUT_DEFS.add(report_name)
		frappe.logger("report_view").debug(
			f"Report View: {report_name!r} has no shipped filter_defs; Link filters are checked "
			"from the browser's definitions only (ADR-021)"
		)
	return defs


def report_name_for_prepared(report: Report) -> str:
	return report.get("custom_report") or report.name


def check_prepared_report_name(report: Report, prepared_report_name: str) -> None:
	"""ADR-009: accept only a Prepared Report of this report owned by the session user."""
	try:
		found = frappe.get_list(
			"Prepared Report",
			filters={
				"name": prepared_report_name,
				"report_name": report_name_for_prepared(report),
				"owner": frappe.session.user,
			},
			pluck="name",
			limit=1,
		)
	except frappe.PermissionError:
		found = []
	if not found:
		frappe.throw(_("Prepared report {0} is not available").format(prepared_report_name), RVInvalidInput)


def count_rows(raw: dict) -> int:
	"""Rows of ``result`` without Frappe's total row (N2.1)."""
	result = raw.get("result") or []
	n = len(result)
	if (
		n
		and isinstance(result[-1], list | tuple)
		and raw.get("add_total_row")
		and not raw.get("skip_total_row")
	):
		n -= 1
	return n


def _pending_prepared_report(report: Report) -> str | None:
	try:
		pending = frappe.get_list(
			"Prepared Report",
			filters={
				"report_name": report_name_for_prepared(report),
				"owner": frappe.session.user,
				"status": ["in", ["Queued", "Started"]],
			},
			pluck="name",
			order_by="creation desc",
			limit=1,
		)
	except frappe.PermissionError:
		pending = []
	return pending[0] if pending else None


def run(
	report: Report,
	report_name: str,
	filters: Any,
	js_filters: Any = None,
	prepared_report_name: str | None = None,
) -> dict:
	"""Run the report through ``query_report.run`` and apply the row limit (§2.1)."""
	filters = validate_report_filters(parse_json_arg(filters, "filters", dict))
	browser_defs = validate_js_filters(parse_json_arg(js_filters, "js_filters", list, allow_none=True) or [])
	settings = load_settings(report.name)
	filters = dict(filters)
	merged_defs = resolve_dynamic_links(
		merge_js_filters(browser_defs, server_filter_defs(report.name, settings)), filters
	)

	filters.pop("prepared_report_name", None)
	if prepared_report_name:
		if not isinstance(prepared_report_name, str):
			frappe.throw(_("Invalid prepared report name"), RVInvalidInput)
		check_prepared_report_name(report, prepared_report_name)
		if report.prepared_report:
			filters["prepared_report_name"] = prepared_report_name

	started = time.monotonic()
	try:
		raw = query_report.run(
			report_name,
			filters=filters,
			js_filters=merged_defs,
			are_default_filters=False,
		)
	except _PASS_THROUGH:
		raise
	except Exception as e:
		# The report's own error (SQL, a key, a path) is logged, never shown: the user reads a
		# translated message, a developer site adds the error's text.
		frappe.log_error(
			title="Report View: report execution failed",
			reference_doctype="Report",
			reference_name=report.name,
		)
		message = _("The report could not run. The error was logged.")
		if frappe.conf.developer_mode and str(e):
			message = f"{message} ({e})"
		frappe.throw(message, RVReportError)
	execution_time = round(time.monotonic() - started, 3)

	limit = get_row_limit()
	if raw.get("prepared_report") and "result" not in raw:
		pending = _pending_prepared_report(report)
		return {
			"status": "prepared_pending" if pending else "prepared_missing",
			"prepared_report_name": pending,
			"doc": None,
		}

	if isinstance(raw.get("doc"), Document):
		raw["doc"] = raw["doc"].as_dict(no_default_fields=False)

	row_count = count_rows(raw)
	if row_count > limit:
		return {"status": "too_large", "row_count": row_count, "limit": limit}
	return {
		"status": "ok",
		"raw": raw,
		"row_count": row_count,
		"limit": limit,
		"execution_time": execution_time,
	}
