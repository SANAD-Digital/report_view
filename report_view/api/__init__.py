"""Whitelisted API of report_view (docs/architecture.md §2).

Every function calls ``guard_report`` on its first line.
"""

import re
from typing import Any

import frappe
from frappe import _
from frappe.desk import query_report

from report_view.core import engine, normalize, runner
from report_view.core.errors import RVEnrichNotAllowed, RVInvalidInput, RVLimitExceeded
from report_view.core.export import model as export_model_mod
from report_view.core.export import xlsx
from report_view.core.guard import (
	can_export,
	can_print,
	guard_export,
	guard_report,
	guard_report_quiet,
)
from report_view.core.inputs import parse_json_arg
from report_view.core.settings import get_row_limit, load_settings

MAX_ENRICH_NAMES = 5000
_FIELD_RE = re.compile(r"^[A-Za-z0-9_]+$")


@frappe.whitelist(methods=["POST"])
def run(
	report_name: str,
	filters: dict | str,
	js_filters: list | str | None = None,
	prepared_report_name: str | None = None,
) -> dict:
	"""Run a report through ``frappe.desk.query_report.run`` (§2.1)."""
	report = guard_report(report_name)
	return runner.run(report, report_name, filters, js_filters, prepared_report_name)


@frappe.whitelist(methods=["GET"])
def get_meta(report_name: str) -> dict:
	"""Report metadata, script, permissions and server settings (§2.2).

	Settings come from ``report_view/defaults/<scrub(report)>.json`` only (``core/settings``);
	``defaults`` is empty until the saved views exist (§2.7).
	"""
	report = guard_report(report_name)
	settings = load_settings(report.name)
	return {
		"report": {
			"name": report.name,
			"report_type": report.report_type,
			"ref_doctype": report.ref_doctype,
			"module": report.module,
			"is_standard": report.is_standard,
			"prepared_report": bool(report.prepared_report),
			"add_total_row": bool(report.add_total_row),
			"reference_report": report.reference_report,
		},
		"script": query_report.get_script(report_name),
		"perms": {"can_export": can_export(report), "can_print": can_print(report)},
		"settings": settings,
		"include_js": list(frappe.get_hooks("report_view_include_js") or []),
		"limits": {"max_rows": get_row_limit()},
		"defaults": {"saved_view": None, "source": None},
	}


@frappe.whitelist(methods=["GET"])
def get_entry_state(report_name: str) -> dict:
	"""Whether the query-report page shows the entry button to Report View (§2.6, ADR-007).

	Reveals nothing beyond the original page: any failure is ``{"show": False}`` with
	no rejection message left in ``_server_messages``.
	"""
	report = guard_report_quiet(report_name)
	if not report:
		return {"show": False}
	return {"show": True, "route": ["report-view", report_name]}


@frappe.whitelist(methods=["POST"])
def enrich(
	report_name: str,
	doctype: str,
	names: list | str,
	fields: list | str,
	source_column: str,
) -> dict:
	"""Fields of linked documents, restricted to the server allowlist (§2.3, ADR-011)."""
	report = guard_report(report_name)
	names = parse_json_arg(names, "names", list)
	fields = parse_json_arg(fields, "fields", list)
	if not isinstance(doctype, str) or not isinstance(source_column, str) or not fields:
		frappe.throw(_("Invalid enrichment request"), RVInvalidInput)
	if not all(isinstance(f, str) and _FIELD_RE.match(f) for f in fields):
		frappe.throw(_("Invalid field name"), RVEnrichNotAllowed)
	allowed = set()
	for rule in load_settings(report.name)["enrich_rules"]:
		if rule["source_column"] == source_column and rule["link_doctype"] == doctype:
			allowed.update(rule["fields"])
	if not set(fields) <= allowed:
		frappe.throw(
			_("This enrichment is not allowed for report {0}").format(_(report.name)), RVEnrichNotAllowed
		)
	if not all(isinstance(n, str) for n in names):
		frappe.throw(_("Invalid document names"), RVInvalidInput)
	if len(names) > MAX_ENRICH_NAMES:
		frappe.throw(
			_("At most {0} names can be enriched per request").format(MAX_ENRICH_NAMES), RVLimitExceeded
		)

	permitted_all = set(frappe.get_meta(doctype).get_permitted_fieldnames(user=frappe.session.user))
	permitted = [f for f in dict.fromkeys(fields) if f in permitted_all]
	dropped = [f for f in dict.fromkeys(fields) if f not in permitted_all]
	unique = list(dict.fromkeys(names))
	rows: dict[str, dict] = {}
	if unique:
		for doc in frappe.get_list(
			doctype,
			filters={"name": ["in", unique]},
			fields=["name", *permitted],
			limit=0,
		):
			rows[doc["name"]] = {f: doc.get(f) for f in permitted}
	meta = frappe.get_meta(doctype)
	field_meta = {}
	for f in permitted:
		df = meta.get_field(f)
		field_meta[f] = {
			"fieldtype": df.fieldtype if df else "Data",
			"options": df.options if df and df.fieldtype in ("Select", "Link") else None,
			"label": _(df.label) if df and df.label else f,
		}
	return {
		"doctype": doctype,
		"rows": rows,
		"fields": field_meta,
		"dropped_fields": dropped,
		"missing": len(unique) - len(rows),
	}


@frappe.whitelist(methods=["POST"])
def export_xlsx(report_name: str, export_model: dict | str) -> Any:
	"""Re-run the report on the server and build an Excel file from the view state (§2.4)."""
	report = guard_report(report_name)
	guard_export(report)
	model = export_model_mod.parse(export_model, "xlsx")
	response = runner.run(
		report, report_name, model["filters"], model["js_filters"], model["prepared_report_name"]
	)
	if response["status"] == "too_large":
		frappe.throw(
			_("The report has {0} rows, more than the limit of {1}").format(
				response["row_count"], response["limit"]
			),
			RVLimitExceeded,
		)
	if response["status"] != "ok":
		frappe.throw(_("The prepared report result is not available"), RVInvalidInput)

	settings = load_settings(report.name)
	nr = normalize.normalize(response["raw"], model["filters"], settings["report_settings"], {}, translate=_)
	export_model_mod.check_against_report(model, nr)
	result = engine.apply(
		nr,
		model["view_state"],
		model["selection"],
		model["layout"]["columns"],
		lang=frappe.local.lang,
		quick_filters=model["quick_filters"],
	)
	export_model_mod.compare_expected(model, result, nr, report.name)

	content = xlsx.build(report.name, nr, result, model, settings)
	frappe.response["filename"] = f"{frappe.scrub(report.name)}.xlsx"
	frappe.response["filecontent"] = content
	frappe.response["type"] = "binary"
	return None
