"""The content of a report's row details (ADR-023): its HTML template or its Custom print
format, rendered on the server with one row of the report.

The row, its columns and the filters come from the browser: they are untrusted data,
printed escaped, and never a reason to read anything. The template runs in the sandbox of
an inline Custom template (``custom_print.inline_env``: Jinja's immutable sandbox, no loader,
no globals) and reads only ``row``, ``columns``, ``report``, ``filters``, ``_`` and
``format_value``. A print format is checked as every Custom print is
(``guard_custom_format``: the user's ``select`` on Print Format) and reads ``data`` = the row.
"""

import json

import frappe
from frappe import _

from report_view.core import custom_print, printing
from report_view.core.errors import RVInvalidInput
from report_view.core.settings import REPORT_SETTINGS

MAX_ROW_BYTES = 64 * 1024
MAX_COLUMNS = 500


def _parsed(value, name: str, kind: type, limit: int):
	if value is None or value == "":
		return kind()
	if isinstance(value, str):
		if len(value.encode("utf-8")) > limit:
			frappe.throw(_("{0} is too large").format(name), RVInvalidInput)
		try:
			value = json.loads(value)
		except ValueError:
			frappe.throw(_("{0} is not valid JSON").format(name), RVInvalidInput)
	else:
		try:
			size = len(json.dumps(value, default=str).encode("utf-8"))
		except TypeError, ValueError:
			frappe.throw(_("{0} is not valid JSON").format(name), RVInvalidInput)
		if size > limit:
			frappe.throw(_("{0} is too large").format(name), RVInvalidInput)
		value = json.loads(json.dumps(value, default=str))
	if not isinstance(value, kind):
		frappe.throw(_("{0} is not valid").format(name), RVInvalidInput)
	return value


def _columns(value) -> list[dict]:
	"""{fieldname, label, fieldtype, options} of each column, as plain text."""
	out = []
	for c in _parsed(value, "columns", list, MAX_ROW_BYTES)[:MAX_COLUMNS]:
		if isinstance(c, dict):
			out.append(
				{k: str(c[k]) for k in ("fieldname", "label", "fieldtype", "options") if c.get(k) is not None}
			)
	return out


def check_template(html: str) -> None:
	"""A template that compiles in the sandbox, or a translated message (save time)."""
	custom_print.compile_inline(html or "")


def template_of(report_name: str) -> str:
	"""The record's template: read here only, never sent to the browser."""
	return frappe.db.get_value(REPORT_SETTINGS, report_name, "row_details_html") or ""


def render_template(html: str, report_name: str, row, columns, filters) -> str:
	ctx = {
		"row": printing.escaped(row),
		"columns": printing.escaped(columns),
		"report": printing.Text(report_name),
		"filters": printing.escaped(filters),
		"_": custom_print.inline_translate,
		"format_value": custom_print.inline_format_value,
	}
	compiled = custom_print.compile_inline(html)
	try:
		return compiled.render(ctx)
	except frappe.ValidationError, frappe.PermissionError, frappe.DoesNotExistError:
		raise
	except Exception as e:
		custom_print._broken(e, _("Row details"))


def render(report, settings: dict, row, columns=None, filters=None) -> dict:
	"""``{"html", "css"}`` of the row's details as the report's settings say."""
	conf = settings["row_details"]
	row = _parsed(row, "row", dict, MAX_ROW_BYTES)
	filters = _parsed(filters, "filters", dict, MAX_ROW_BYTES)
	columns = _columns(columns)
	if not conf["enabled"] or conf["content"] == "fields":
		frappe.throw(_("This report's row details have no template to render"), RVInvalidInput)
	if conf["content"] == "html":
		html = render_template(template_of(report.name), report.name, row, columns, filters)
		return {"html": html, "css": ""}
	pf = custom_print.guard_custom_format(conf["print_format"])
	out = custom_print.render_format(pf, row)
	return {"html": out["html"], "css": out["css"]}
