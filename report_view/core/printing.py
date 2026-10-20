"""Print headings and print signatures of the Pages view (ADR-015).

A heading (Frappe's ``Print Heading``) and a signature (``Print Signature``, HTML or a
table of signatories) are rendered on the server as Jinja templates with the report's
context: its name, the filters on screen, the company and who prints. The rendering is
Frappe's sandboxed ``render_template``; the callers check the report and the print
permission first (``report_view.api``), and every record is read with
``frappe.get_list`` so a user who may not read headings or signatures gets none.
"""

import re
from html import unescape

import frappe
from frappe import _
from frappe.utils import escape_html, get_fullname, now_datetime, strip_html_tags

from report_view.core.errors import RVInvalidInput
from report_view.core.inputs import parse_json_arg

MAX_FILTER_META = 200
SIGNATURE_TEMPLATE = "report_view/templates/includes/print_signature.html"
_HTML_TAG = re.compile(r"<[A-Za-z/!]")
# a CSS block may not close the <style> it is printed in
_STYLE_END = re.compile(r"</\s*style", re.IGNORECASE)


class Text(str):
	"""A string from the browser or from the report's rows in a template's context.

	Frappe's Jinja does not autoescape, so ``{{ value }}`` would print a filter such as
	``<img src=x onerror=...>`` as HTML. A ``Text`` prints HTML-escaped (``str``, ``format``,
	``|e``, ``|join``, ``~``) but compares, translates and looks up records as itself, so the
	site's formats keep working (``row.account == "'Total'"``, ``_(row.account)``,
	``frappe.db.get_value("Customer", doc.customer)``). The string methods a template uses
	return a ``Text`` again, except ``replace`` and ``translate``: the query builder quotes a
	value with them before it formats it, so a lookup gets the value as it is (the
	``|replace`` filter of Jinja prints escaped all the same)."""

	__slots__ = ()

	def __str__(self) -> str:
		return escape_html(str.__str__(self))

	def __html__(self) -> str:
		return str(self)

	def __format__(self, spec: str) -> str:
		return format(str(self), spec)

	def __add__(self, other):
		return Text(str.__add__(self, other)) if isinstance(other, str) else NotImplemented

	def __radd__(self, other):
		return Text(str.__add__(other, self)) if isinstance(other, str) else NotImplemented

	def __getitem__(self, key):
		return Text(str.__getitem__(self, key))

	def __mul__(self, n):
		return Text(str.__mul__(self, n))

	def __mod__(self, args):
		return Text(str.__mod__(self, args))


def _keep_text(name: str):
	method = getattr(str, name)

	def wrapper(self, *args, **kwargs):
		out = method(self, *args, **kwargs)
		if isinstance(out, str):
			return Text(out)
		if isinstance(out, list | tuple):
			return type(out)(Text(v) for v in out)
		return out

	wrapper.__name__ = name
	return wrapper


for _name in (
	"capitalize", "casefold", "center", "expandtabs", "ljust", "lower", "lstrip", "partition",
	"removeprefix", "removesuffix", "rjust", "rpartition", "rsplit", "rstrip", "split",
	"splitlines", "strip", "swapcase", "title", "upper", "zfill",
):
	setattr(Text, _name, _keep_text(_name))


def escaped(value):
	"""``value`` with every string in it a ``Text`` (lists and dicts walked)."""
	if isinstance(value, Text):
		return value
	if isinstance(value, str):
		return Text(value)
	if isinstance(value, list | tuple):
		return [escaped(v) for v in value]
	if isinstance(value, dict):
		return frappe._dict({k: escaped(v) for k, v in value.items()})
	return value


def filter_objects(filters: dict | str, filter_meta: list | str | None) -> tuple[dict, dict]:
	"""The filters as the site's report formats read them: ``{fieldname: {label,
	fieldtype, value}}`` (labels from the report's filter definitions), and the values. Both
	come from the browser: every string in them is a ``Text`` (printed escaped)."""
	values = parse_json_arg(filters, "filters", dict)
	meta = parse_json_arg(filter_meta or [], "filter_meta", list)
	if len(meta) > MAX_FILTER_META or not all(isinstance(m, dict) for m in meta):
		frappe.throw(_("Invalid filter definitions"), RVInvalidInput)
	by_name = {m.get("fieldname"): m for m in meta if isinstance(m.get("fieldname"), str)}
	objs = {}
	for key, value in values.items():
		m = by_name.get(key, {})
		objs[key] = frappe._dict(
			label=Text(m.get("label") or frappe.unscrub(key)),
			fieldtype=Text(m.get("fieldtype") or "Data"),
			value=escaped(value),
		)
	return objs, escaped(values)


MAX_VIEW_COLUMNS = 500


def parse_view_columns(view_columns: list | str | None) -> list[frappe._dict]:
	"""The report's columns as the view shows them (the Pages view sends them): in its order,
	``{fieldname, label, hidden}`` each. Labels are text (tags dropped); both are ``Text``."""
	view = parse_json_arg(view_columns, "view_columns", list, allow_none=True) or []
	if len(view) > MAX_VIEW_COLUMNS:
		frappe.throw(_("Too many columns"), RVInvalidInput)
	out = []
	for v in view:
		if not isinstance(v, dict) or not isinstance(v.get("fieldname"), str) or not v["fieldname"]:
			frappe.throw(_("Invalid columns of the view"), RVInvalidInput)
		label = v.get("label")
		out.append(
			frappe._dict(
				fieldname=Text(v["fieldname"][:140]),
				label=Text(strip_html_tags(label)[:140] if isinstance(label, str) else v["fieldname"][:140]),
				hidden=1 if v.get("hidden") else 0,
			)
		)
	return out


def apply_view_columns(columns: list, view: list) -> list:
	"""The report's ``columns`` in the order of the view, hidden where the view hides them (a
	column the report hides stays hidden); those the view does not name keep their order after."""
	if not view:
		return columns
	by = {c.fieldname: c for c in columns}
	out = []
	for v in view:
		c = by.pop(v.fieldname, None)
		if c is not None:
			c.hidden = 1 if (v.hidden or c.hidden) else 0
			out.append(c)
	return out + list(by.values())


def report_context(report, filters: dict | str, filter_meta: list | str | None, view_columns: list | str | None = None) -> dict:
	"""What a heading or a signature of a report may read (the help of Print Signature lists
	it): ``title``, ``report_name``, ``filters``, ``doc`` (the filter values as a document),
	``company``, ``printed_by``, ``printed_on``, ``lang``, and the columns as the view shows
	them: ``columns`` (``{fieldname, label, hidden}``, in the view's order) and
	``visible_columns`` (those shown)."""
	objs, values = filter_objects(filters, filter_meta)
	cols = parse_view_columns(view_columns)
	return {
		"columns": cols,
		"visible_columns": [c for c in cols if not c.hidden],
		"title": _(report.name),
		"report_name": report.name,
		"filters": frappe._dict(objs),
		"doc": frappe._dict(values),
		"company": values.get("company"),
		"printed_by": Text(get_fullname()),
		"printed_on": now_datetime(),
		"lang": frappe.local.lang,
	}


def _as_html(text: str) -> str:
	"""A template's output as HTML: a plain text keeps its lines. Its values were printed
	escaped already (``Text``): unescaped first, so they are not escaped twice."""
	text = (text or "").strip()
	if text and not _HTML_TAG.search(text):
		return escape_html(unescape(text)).replace("\n", "<br>")
	return text


def scoped_css(css: str | None) -> str:
	"""A record's CSS nested in ``.rv-signature`` (CSS nesting): its rules reach the
	signature only, never the rest of the page."""
	css = _STYLE_END.sub("", css or "").strip()
	return f".rv-signature{{{css}}}" if css else ""


def render_heading(name: str, context: dict) -> dict:
	"""A ``Print Heading``: its title and its description, both Jinja templates."""
	found = frappe.get_list("Print Heading", filters={"name": name}, fields=["name"], limit=1)
	if not found:
		frappe.throw(_("Print Heading {0} not found").format(name), frappe.DoesNotExistError)
	doc = frappe.get_doc("Print Heading", found[0].name)
	context = {**context, "heading": _(doc.print_heading or "")}
	# the title is text (the browser escapes it): its escaped values are unescaped
	title = unescape(frappe.render_template(_(doc.print_heading or ""), context)).strip()
	html = _as_html(frappe.render_template(doc.description or "", context))
	return {"name": doc.name, "title": title, "html": html}


def signature_filters(signature_for: str, target: list[str] | None, field: str) -> tuple[dict, list]:
	"""Enabled signatures of a type; for ``target`` (report names, or a doctype) or for
	all (the link left empty)."""
	filters = {"disabled": 0, "signature_for": signature_for}
	or_filters = [[field, "is", "not set"]]
	if target:
		or_filters.append([field, "in", target])
	return filters, or_filters


def list_signatures(report_names: list[str]) -> list[dict]:
	filters, or_filters = signature_filters("Report", report_names, "report")
	rows = frappe.get_list(
		"Print Signature",
		filters=filters,
		or_filters=or_filters,
		fields=["name", "content_type"],
		order_by="name asc",
		limit=0,
	)
	return [{"name": r.name, "content_type": r.content_type} for r in rows]


def render_signature(doc, context: dict) -> dict:
	"""A ``Print Signature`` rendered: its HTML template, or its table of signatories as
	boxes (``templates/includes/print_signature.html``)."""
	signatories = [
		frappe._dict(label=r.label, person_name=r.person_name, designation=r.designation, show_date=r.show_date)
		for r in doc.get("signatories") or []
	]
	context = {**context, "signatories": signatories, "signature": doc.name}
	if doc.content_type == "HTML":
		html = _as_html(frappe.render_template(doc.html or "", context))
	else:
		html = frappe.render_template(SIGNATURE_TEMPLATE, context)
	return {"name": doc.name, "type": doc.content_type, "html": html, "css": scoped_css(doc.css)}


def report_signature(name: str, report_names: list[str], context: dict) -> dict:
	"""A signature offered for the report (enabled, of type Report, for it or for all)."""
	filters, or_filters = signature_filters("Report", report_names, "report")
	found = frappe.get_list(
		"Print Signature", filters={"name": name, **filters}, or_filters=or_filters, fields=["name"], limit=1
	)
	if not found:
		frappe.throw(_("Print Signature {0} is not available for this report").format(name), frappe.DoesNotExistError)
	return render_signature(frappe.get_doc("Print Signature", found[0].name), context)


def document_context(doc) -> dict:
	"""What a heading or a signature of a document may read: ``doc`` (the document),
	``title`` (its type, translated), ``company``, ``printed_by``, ``printed_on``, ``lang``."""
	doctype = getattr(doc, "doctype", None)
	return {
		"doc": doc,
		"title": _(doctype) if doctype else "",
		"report_name": "",
		"filters": frappe._dict(),
		"company": getattr(doc, "company", None),
		"printed_by": get_fullname(),
		"printed_on": now_datetime(),
		"lang": frappe.local.lang,
	}


def list_document_signatures(doctype: str | None) -> list[dict]:
	"""Enabled signatures of type Document for ``doctype`` or for all."""
	filters, or_filters = signature_filters("Document", [doctype] if doctype else None, "reference_doctype")
	rows = frappe.get_list(
		"Print Signature", filters=filters, or_filters=or_filters, fields=["name", "content_type"], order_by="name asc", limit=0
	)
	return [{"name": r.name, "content_type": r.content_type} for r in rows]


def document_signature(name: str, doc, standalone: bool = False) -> dict:
	"""A signature of type Document offered for ``doc`` (its doctype, or for all)."""
	doctype = getattr(doc, "doctype", None)
	filters, or_filters = signature_filters("Document", [doctype] if doctype else None, "reference_doctype")
	found = frappe.get_list(
		"Print Signature", filters={"name": name, **filters}, or_filters=or_filters, fields=["name"], limit=1
	)
	if not found:
		frappe.throw(_("Print Signature {0} is not available for this document").format(name), frappe.DoesNotExistError)
	context = {**document_context(doc), "standalone": standalone}
	return render_signature(frappe.get_doc("Print Signature", found[0].name), context)


def report_view_signature(name: str, doc=None) -> str:
	"""Jinja method of a document's print format: ``{{ report_view_signature("Name", doc) }}``.

	The signature must be enabled, of type Document, and for the document's type (or for
	all). Read with ``frappe.get_list``: who may not read it prints nothing, and the
	document prints.
	"""
	try:
		out = document_signature(name, doc, standalone=True)
	except (frappe.DoesNotExistError, frappe.PermissionError):
		# a user who may not read signatures (a portal user) still prints the document
		frappe.clear_last_message()
		return ""
	style = f"<style>{out['css']}</style>" if out["css"] else ""
	return f'{style}<div class="rv-signature">{out["html"]}</div>'
