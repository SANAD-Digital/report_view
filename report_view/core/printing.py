"""Print headings and print signatures of the Pages view (ADR-015).

A heading (Frappe's ``Print Heading``) and a signature (``Print Signature``, HTML or a
table of signatories) are rendered on the server as Jinja templates with the report's
context: its name, the filters on screen, the company and who prints. The rendering is
Frappe's sandboxed ``render_template``; the callers check the report and the print
permission first (``report_view.api``), and every record is read with
``frappe.get_list`` so a user who may not read headings or signatures gets none.
"""

import re

import frappe
from frappe import _
from frappe.utils import escape_html, get_fullname, now_datetime

from report_view.core.errors import RVInvalidInput
from report_view.core.inputs import parse_json_arg

MAX_FILTER_META = 200
SIGNATURE_TEMPLATE = "report_view/templates/includes/print_signature.html"
_HTML_TAG = re.compile(r"<[A-Za-z/!]")
# a CSS block may not close the <style> it is printed in
_STYLE_END = re.compile(r"</\s*style", re.IGNORECASE)


def filter_objects(filters: dict | str, filter_meta: list | str | None) -> tuple[dict, dict]:
	"""The filters as the site's report formats read them: ``{fieldname: {label,
	fieldtype, value}}`` (labels from the report's filter definitions), and the raw values."""
	values = parse_json_arg(filters, "filters", dict)
	meta = parse_json_arg(filter_meta or [], "filter_meta", list)
	if len(meta) > MAX_FILTER_META or not all(isinstance(m, dict) for m in meta):
		frappe.throw(_("Invalid filter definitions"), RVInvalidInput)
	by_name = {m.get("fieldname"): m for m in meta if isinstance(m.get("fieldname"), str)}
	objs = {}
	for key, value in values.items():
		m = by_name.get(key, {})
		objs[key] = frappe._dict(
			label=str(m.get("label") or frappe.unscrub(key)), fieldtype=str(m.get("fieldtype") or "Data"), value=value
		)
	return objs, values


def report_context(report, filters: dict | str, filter_meta: list | str | None) -> dict:
	"""What a heading or a signature of a report may read (the help of Print Signature lists
	it): ``title``, ``report_name``, ``filters``, ``doc`` (the filter values as a document),
	``company``, ``printed_by``, ``printed_on`` and ``lang``."""
	objs, values = filter_objects(filters, filter_meta)
	return {
		"title": _(report.name),
		"report_name": report.name,
		"filters": frappe._dict(objs),
		"doc": frappe._dict(values),
		"company": values.get("company"),
		"printed_by": get_fullname(),
		"printed_on": now_datetime(),
		"lang": frappe.local.lang,
	}


def _as_html(text: str) -> str:
	"""A template's output as HTML: a plain text keeps its lines."""
	text = (text or "").strip()
	if text and not _HTML_TAG.search(text):
		return escape_html(text).replace("\n", "<br>")
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
	title = frappe.render_template(_(doc.print_heading or ""), context).strip()
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
	all). Read with ``frappe.get_list``: who may not read it prints nothing.
	"""
	try:
		out = document_signature(name, doc, standalone=True)
	except frappe.DoesNotExistError:
		frappe.clear_last_message()
		return ""
	style = f"<style>{out['css']}</style>" if out["css"] else ""
	return f'{style}<div class="rv-signature">{out["html"]}</div>'
