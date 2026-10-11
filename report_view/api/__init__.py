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
	guard_print,
	guard_report,
	guard_report_quiet,
)
from report_view.core.inputs import parse_json_arg
from report_view.core.settings import get_row_limit, load_settings

MAX_ENRICH_NAMES = 5000
MAX_TRANSLATION_MESSAGES = 2000
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


# ------------------------------------------------- the Pages view (ADR-014)


@frappe.whitelist(methods=["GET"])
def get_print_options(report_name: str, company: str | None = None) -> dict:
	"""What the Pages view offers to a user who may print the report (§2.8, ADR-014): the
	letter heads, the report's own print formats (JS, as the query-report dialog lists
	them), the languages the site enables, and the default letter head of ``company``.

	Every list is read with ``frappe.get_list``: a user who may not read letter heads gets
	none, as on the query-report page.
	"""
	report = guard_report(report_name)
	guard_print(report)
	letter_heads: list[dict] = []
	default_letter_head = None
	if frappe.has_permission("Letter Head"):
		letter_heads = frappe.get_list(
			"Letter Head",
			filters={"disabled": 0},
			fields=["name", "is_default"],
			order_by="name asc",
			limit=0,
		)
		if isinstance(company, str) and company and frappe.has_permission("Company", doc=company):
			rows = frappe.get_list(
				"Company", filters={"name": company}, fields=["default_letter_head"], limit=1
			)
			default_letter_head = rows[0].default_letter_head if rows else None
		if not default_letter_head:
			default_letter_head = next((lh.name for lh in letter_heads if lh.is_default), None)
		if default_letter_head not in {lh.name for lh in letter_heads}:
			default_letter_head = None
	print_formats = frappe.get_list(
		"Print Format",
		filters=_print_format_filters(report_name, report.name),
		fields=["name"],
		order_by="name asc",
		limit=0,
	)
	languages = frappe.get_list(
		"Language", filters={"enabled": 1}, fields=["name", "language_name"], order_by="language_name asc", limit=0
	)
	return {
		"letter_heads": [{"name": lh.name, "is_default": bool(lh.is_default)} for lh in letter_heads],
		"default_letter_head": default_letter_head,
		"print_formats": [pf.name for pf in print_formats],
		"languages": [{"name": lg.name, "label": lg.language_name or lg.name} for lg in languages],
		"lang": frappe.local.lang,
	}


def _print_format_filters(report_name: str, resolved_name: str) -> dict:
	"""Report print formats of the query-report dialog (print_utils.js): JS, enabled, for
	this report (a Custom Report resolves to its reference report)."""
	names = list(dict.fromkeys([report_name, resolved_name]))
	return {
		"print_format_for": "Report",
		"report": ["in", names],
		"print_format_type": "JS",
		"disabled": 0,
	}


@frappe.whitelist(methods=["GET"])
def get_print_format(report_name: str, name: str) -> dict:
	"""The template of one report print format (§2.8). ``html`` and ``css`` are read for
	a user who may print the report, as ``frappe.www.printview`` reads a document's print
	format for a user who may print the document (ADR-014); the Print Format itself needs
	no ``read`` of its own.
	"""
	report = guard_report(report_name)
	guard_print(report)
	if not isinstance(name, str) or not name.strip():
		frappe.throw(_("Print format name is required"), RVInvalidInput)
	found = frappe.get_list(
		"Print Format",
		filters={"name": name, **_print_format_filters(report_name, report.name)},
		fields=["name"],
		limit=1,
	)
	if not found:
		frappe.throw(
			_("Print Format {0} is not available for report {1}").format(name, _(report.name)),
			frappe.DoesNotExistError,
		)
	doc = frappe.get_doc("Print Format", name)
	return {"name": doc.name, "html": doc.html or "", "css": doc.css or ""}


@frappe.whitelist(methods=["POST"])
def get_translations(report_name: str, lang: str, messages: list | str) -> dict:
	"""Translations of ``messages`` in ``lang`` (§2.9, ADR-014): the Pages view prints a
	report in a language other than the session's. ``lang`` must be a language the site
	enables; keys with a context come as Frappe keys them (``"<msgid>:<context>"``).
	"""
	guard_report(report_name)
	messages = parse_json_arg(messages, "messages", list)
	if not isinstance(lang, str) or lang not in (frappe.translate.get_all_languages() or []):
		frappe.throw(_("Language {0} is not enabled on this site").format(lang), RVInvalidInput)
	if len(messages) > MAX_TRANSLATION_MESSAGES or not all(isinstance(m, str) for m in messages):
		frappe.throw(_("Invalid translation request"), RVInvalidInput)
	translations = frappe.translate.get_all_translations(lang)
	return {m: translations[m] for m in dict.fromkeys(messages) if m in translations}
