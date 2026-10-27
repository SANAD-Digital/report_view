"""Whitelisted API of report_view (docs/architecture.md §2).

Every function calls ``guard_report`` on its first line (``_guard``: once per request).
"""

import re
from typing import Any

import frappe
from frappe import _
from frappe.desk import query_report

from report_view.core import normalize, printing, runner
from report_view.core.errors import RVEnrichNotAllowed, RVInvalidInput, RVLimitExceeded
from report_view.core.export import jobs as export_jobs
from report_view.core.export import model as export_model_mod
from report_view.core.guard import (
	can_export,
	can_print,
	guard_export,
	guard_print,
	guard_report,
	guard_report_quiet,
)
from report_view.core.inputs import parse_json_arg
from report_view.core.limits import rate_limit as _rate_limit
from report_view.core.settings import get_print_max_pages, get_row_limit, load_settings, print_defaults

MAX_ENRICH_NAMES = 5000
# rows a server-rendered report print format may hold per printed page (print_max_pages)
PRINT_ROWS_PER_PAGE = 40
_FIELD_RE = re.compile(r"^[A-Za-z0-9_]+$")


def _guard(report_name: str):
	"""``guard_report``, memoised for the request (``frappe.local.cache``, which Frappe
	empties on every request and on ``set_user``): a call that renders one print part and
	reads another checks the report once. A refusal is not kept: it raises every time."""
	cache = frappe.local.cache.setdefault("report_view:guard", {})
	key = (frappe.session.user, report_name)
	if key not in cache:
		cache[key] = guard_report(report_name)
	return cache[key]


@frappe.whitelist(methods=["POST"])
@_rate_limit(30)
def run(
	report_name: str,
	filters: dict | str,
	js_filters: list | str | None = None,
	prepared_report_name: str | None = None,
) -> dict:
	"""Run a report through ``frappe.desk.query_report.run`` (§2.1)."""
	report = _guard(report_name)
	return runner.run(report, report_name, filters, js_filters, prepared_report_name)


@frappe.whitelist(methods=["GET"])
def get_meta(report_name: str) -> dict:
	"""Report metadata, script, permissions and server settings (§2.2).

	Settings come from ``report_view/defaults/<scrub(report)>.json`` only (``core/settings``);
	``defaults`` is empty until the saved views exist (§2.7).
	"""
	report = _guard(report_name)
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
		# the saved views (ADR-010, planned) fill these; until then there is no default view
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
@_rate_limit(60)
def enrich(
	report_name: str,
	doctype: str,
	names: list | str,
	fields: list | str,
	source_column: str,
) -> dict:
	"""Fields of linked documents, restricted to the server allowlist (§2.3, ADR-011)."""
	report = _guard(report_name)
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
@_rate_limit(10)
def export_xlsx(report_name: str, export_model: dict | str) -> Any:
	"""Re-run the report on the server and build an Excel file from the view state (§2.4).

	Up to ``export_jobs.ASYNC_ROWS`` report rows the file is the response (a download).
	Above, the export is a background job and the response is ``{"status": "queued", "job",
	"row_count"}``: the browser polls ``export_xlsx_status`` and downloads with
	``export_xlsx_download``. The browser's ``expected.row_count`` queues it without a run
	in the request; the server's count decides otherwise."""
	report = _guard(report_name)
	guard_export(report)
	model = export_model_mod.parse(export_model, "xlsx")
	hint = (model.get("expected") or {}).get("row_count")
	if isinstance(hint, int) and hint > export_jobs.ASYNC_ROWS:
		return export_jobs.enqueue(report, report_name, export_model, hint)
	response = export_jobs.run_report(report, report_name, model)
	if response["row_count"] > export_jobs.ASYNC_ROWS:
		row_count = response["row_count"]
		del response
		return export_jobs.enqueue(report, report_name, export_model, row_count)

	content = export_jobs.workbook(report, model, response)
	frappe.response["filename"] = export_jobs.filename(report)
	frappe.response["filecontent"] = content
	frappe.response["type"] = "binary"
	return None


@frappe.whitelist(methods=["GET"])
def export_xlsx_status(job: str) -> dict:
	"""``{state: queued|running|done|failed, row_count, error, error_code, cancellable}`` of
	the user's own export job; the job's report and ``can_export`` are checked again
	(``export_jobs._job``). A job whose worker is gone reads as failed."""
	return export_jobs.status(job)


@frappe.whitelist(methods=["POST"])
def export_xlsx_cancel(job: str) -> dict:
	"""Cancel the user's own export job (``export_jobs.cancel``); answers as the status."""
	return export_jobs.cancel(job)


@frappe.whitelist(methods=["GET"])
def export_xlsx_download(job: str) -> None:
	"""The Excel file of the user's finished export job, as a download; the job is removed."""
	content, name = export_jobs.download(job)
	frappe.response["filename"] = name
	frappe.response["filecontent"] = content
	frappe.response["type"] = "binary"


# ------------------------------------------------- the Pages view (ADR-014)


@frappe.whitelist(methods=["GET"])
def get_print_options(report_name: str, company: str | None = None) -> dict:
	"""What the Pages view offers to a user who may print the report (§2.8, ADR-014): the
	letter heads, the report's own print formats (JS, as the query-report dialog lists
	them), the print headings and signatures (ADR-015), the languages the site enables, the
	default letter head (the site's standard one, else ``company``'s), and the site's
	standard print settings and limits (``Report View Global Settings``).

	Every list is read with ``frappe.get_list``: a user who may not read letter heads gets
	none, as on the query-report page.
	"""
	report = _guard(report_name)
	guard_print(report)
	defaults = print_defaults()
	letter_heads, default_letter_head = printing.letter_heads(company, defaults.pop("letter_head", None))
	headings = []
	if frappe.has_permission("Print Heading"):
		headings = frappe.get_list("Print Heading", fields=["name"], order_by="name asc", limit=0)
	signatures = printing.list_signatures(list(dict.fromkeys([report_name, report.name])))
	if defaults.get("heading") not in {h.name for h in headings}:
		defaults["heading"] = ""
	if defaults.get("signature") not in {sg["name"] for sg in signatures}:
		defaults["signature"] = ""
	print_formats = frappe.get_list(
		"Print Format",
		filters=_report_print_format_filters(report_name, report.name),
		fields=["name", "print_format_type"],
		order_by="name asc",
		limit=0,
	)
	languages = frappe.get_list(
		"Language",
		filters={"enabled": 1},
		fields=["name", "language_name"],
		order_by="language_name asc",
		limit=0,
	)
	return {
		"letter_heads": [{"name": lh.name, "is_default": bool(lh.is_default)} for lh in letter_heads],
		"default_letter_head": default_letter_head,
		"print_formats": [pf.name for pf in print_formats],
		"print_format_types": {pf.name: pf.print_format_type for pf in print_formats},
		"reports": list(dict.fromkeys([report_name, report.name])),
		"print_headings": [h.name for h in headings],
		"print_signatures": signatures,
		"languages": [{"name": lg.name, "label": lg.language_name or lg.name} for lg in languages],
		"lang": frappe.local.lang,
		"defaults": defaults,
		"limits": {"print_max_pages": get_print_max_pages()},
	}


def _report_print_format_filters(report_name: str, resolved_name: str) -> dict:
	"""Report print formats offered by the Pages view: enabled, for this report (a Custom
	Report resolves to its reference report), JS (rendered in the browser with
	query-report's context, as the query-report dialog does) or Jinja (rendered on the
	server by ``render_print_format``)."""
	names = list(dict.fromkeys([report_name, resolved_name]))
	return {
		"print_format_for": "Report",
		"report": ["in", names],
		"print_format_type": ["in", ["JS", "Jinja"]],
		"disabled": 0,
	}


@frappe.whitelist(methods=["GET"])
def get_print_format(report_name: str, name: str) -> dict:
	"""The template of one report print format (§2.8). ``html`` and ``css`` are read for
	a user who may print the report, as ``frappe.www.printview`` reads a document's print
	format for a user who may print the document (ADR-014); the Print Format itself needs
	no ``read`` of its own.
	"""
	report = _guard(report_name)
	guard_print(report)
	doc = _print_format_doc(report, report_name, name)
	return {"name": doc.name, "type": doc.print_format_type, "html": doc.html or "", "css": doc.css or ""}


def _print_format_doc(report, report_name: str, name: str):
	"""A report print format offered for the report (``_report_print_format_filters``). The caller
	has checked the report and the print permission."""
	if not isinstance(name, str) or not name.strip():
		frappe.throw(_("Print format name is required"), RVInvalidInput)
	found = frappe.get_list(
		"Print Format",
		filters={"name": name, **_report_print_format_filters(report_name, report.name)},
		fields=["name"],
		limit=1,
	)
	if not found:
		frappe.throw(
			_("Print Format {0} is not available for report {1}").format(name, _(report.name)),
			frappe.DoesNotExistError,
		)
	return frappe.get_doc("Print Format", found[0].name)


@frappe.whitelist(methods=["POST"])
@_rate_limit(10)
def render_print_format(
	report_name: str,
	name: str,
	filters: dict | str,
	js_filters: list | str | None = None,
	filter_meta: list | str | None = None,
	prepared_report_name: str | None = None,
	view_columns: list | str | None = None,
) -> dict:
	"""A Jinja report print format rendered on the server (§2.8, ADR-014).

	The report runs again through ``runner.run`` (``frappe.desk.query_report.run``: every
	permission check of the report); the template gets the context the site's report
	formats read: ``title``, ``filters`` (``{fieldname: {label, fieldtype, value}}``),
	``columns`` (``[{fieldname, label, fieldtype, options, width, hidden}]``) and ``data``
	(the report's rows as dicts, Frappe's total row included). The language is the
	request's (``_lang``). ``view_columns`` (the columns as the view shows them, sent by the
	Pages view) orders ``columns`` and hides those the view hides; ``visible_columns`` are
	the ones shown, in that order.

	Every string of the filters, the view and the rows prints HTML-escaped
	(``printing.Text``). At most ``print_max_pages`` times ``PRINT_ROWS_PER_PAGE`` rows print.
	"""
	report = _guard(report_name)
	guard_print(report)
	doc = _print_format_doc(report, report_name, name)
	if doc.print_format_type != "Jinja":
		frappe.throw(_("Print Format {0} is not a Jinja template").format(doc.name), RVInvalidInput)
	filter_objs, values = printing.filter_objects(filters, filter_meta)
	view = printing.parse_view_columns(view_columns)
	response = runner.run(report, report_name, filters, js_filters, prepared_report_name)
	if response["status"] != "ok":
		frappe.throw(_("The report did not return rows to print"), RVInvalidInput)
	max_rows = get_print_max_pages() * PRINT_ROWS_PER_PAGE
	if response["row_count"] > max_rows:
		frappe.throw(
			_("The report has {0} rows; at most {1} rows can be printed with a print format").format(
				response["row_count"], max_rows
			),
			RVLimitExceeded,
		)
	raw = response["raw"]
	columns = []
	for col in raw.get("columns") or []:
		c = normalize.parse_column(col)
		columns.append(
			frappe._dict(
				fieldname=c.get("fieldname"),
				label=printing.escaped(_(c.get("label") or c.get("fieldname") or "")),
				fieldtype=c.get("fieldtype") or "Data",
				options=c.get("options"),
				width=c.get("width"),
				hidden=1 if c.get("hidden") and str(c.get("hidden")) not in ("0", "False", "false") else 0,
			)
		)
	columns_as_returned = list(columns)
	columns = printing.apply_view_columns(columns, view)
	data = []
	for row in raw.get("result") or []:
		if isinstance(row, dict):
			data.append(printing.escaped(row))
		elif isinstance(row, list | tuple):
			data.append(
				printing.escaped(
					{c.fieldname: row[i] if i < len(row) else None for i, c in enumerate(columns_as_returned)}
				)
			)
	html = frappe.render_template(
		doc.html or "",
		{
			"title": report.name,
			"report_name": report.name,
			"filters": filter_objs,
			"columns": columns,
			"visible_columns": [c for c in columns if not c.hidden],
			"data": data,
			"doc": frappe._dict(values),
		},
	)
	return {"name": doc.name, "type": "Jinja", "html": html, "css": doc.css or ""}


@frappe.whitelist(methods=["POST"])
def render_print_heading(
	report_name: str,
	name: str,
	filters: dict | str,
	filter_meta: list | str | None = None,
	view_columns: list | str | None = None,
) -> dict:
	"""A ``Print Heading`` of the Pages view (ADR-015): its title and description rendered
	as Jinja with the report's name and the filters on screen (``printing.report_context``),
	in the request's language (``_lang``). The report does not run again."""
	report = _guard(report_name)
	guard_print(report)
	if not isinstance(name, str) or not name.strip():
		frappe.throw(_("Print heading name is required"), RVInvalidInput)
	return printing.render_heading(name, printing.report_context(report, filters, filter_meta, view_columns))


@frappe.whitelist(methods=["POST"])
def render_print_signature(
	report_name: str,
	name: str,
	filters: dict | str,
	filter_meta: list | str | None = None,
	view_columns: list | str | None = None,
) -> dict:
	"""A ``Print Signature`` of type Report (ADR-015), for this report or for all: its
	table of signatories or its HTML/Jinja, with the report's context; its CSS nested in
	``.rv-signature``."""
	report = _guard(report_name)
	guard_print(report)
	if not isinstance(name, str) or not name.strip():
		frappe.throw(_("Print signature name is required"), RVInvalidInput)
	names = list(dict.fromkeys([report_name, report.name]))
	return printing.report_signature(
		name, names, printing.report_context(report, filters, filter_meta, view_columns)
	)


@frappe.whitelist(methods=["POST"])
def get_translations(report_name: str, lang: str, messages: list | str) -> dict:
	"""Translations of ``messages`` in ``lang`` (§2.9, ADR-014): the Pages view prints a
	report in a language other than the session's. ``lang`` must be a language the site
	enables; keys with a context come as Frappe keys them (``"<msgid>:<context>"``).
	"""
	_guard(report_name)
	return printing.translations(lang, messages)
