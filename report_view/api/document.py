"""The document print page (ADR-017): a document printed with the pages of Report View.

The document's own print format is rendered by Frappe (``frappe.www.printview
.get_html_and_style``: the same HTML as Frappe's print page, with its permission checks);
the pages around it (paper, letter head, print heading, footer, numbering, signature,
border, watermark) are the Pages view's. Every function first checks that the user may
print the document (``guard_doc_print``), as the report functions check the report first.
"""

import frappe
from frappe import _
from frappe.www.printview import get_html_and_style

from report_view.core import printing
from report_view.core.errors import RVInvalidInput
from report_view.core.guard import guard_doc_print
from report_view.core.settings import get_print_max_pages, print_defaults


def _doc_print_format_filters(doctype: str) -> dict:
	return {"doc_type": doctype, "disabled": 0, "print_format_type": "Jinja"}


@frappe.whitelist(methods=["GET"])
def get_doc_print_options(doctype: str, name: str) -> dict:
	"""What the document print page offers: the doctype's print formats (and its default),
	letter heads (the document's company default first), print headings, Document
	signatures, languages, the site's standard print settings and limits."""
	doc = guard_doc_print(doctype, name)
	meta = frappe.get_meta(doctype)
	defaults = print_defaults()
	formats = frappe.get_list(
		"Print Format",
		filters=_doc_print_format_filters(doctype),
		fields=["name"],
		order_by="name asc",
		limit=0,
	)
	letter_heads, default_letter_head = printing.letter_heads(
		doc.get("company"), defaults.pop("letter_head", None), own=doc.get("letter_head")
	)
	headings = []
	if frappe.has_permission("Print Heading"):
		headings = frappe.get_list("Print Heading", fields=["name"], order_by="name asc", limit=0)
	signatures = printing.list_document_signatures(doctype)
	if defaults.get("heading") not in {h.name for h in headings}:
		defaults["heading"] = ""
	defaults["signature"] = ""
	# the document's own heading (Sales Invoice: select_print_heading) comes first
	own_heading = doc.get("select_print_heading")
	if own_heading in {h.name for h in headings}:
		defaults["heading"] = own_heading
	languages = frappe.get_list(
		"Language",
		filters={"enabled": 1},
		fields=["name", "language_name"],
		order_by="language_name asc",
		limit=0,
	)
	return {
		"doctype": doctype,
		"name": doc.name,
		"title": doc.get_title() or doc.name,
		"default_print_format": meta.default_print_format or "",
		"letter_heads": [{"name": lh.name, "is_default": bool(lh.is_default)} for lh in letter_heads],
		"default_letter_head": default_letter_head,
		"print_formats": [f.name for f in formats],
		"print_format_types": {f.name: "Jinja" for f in formats},
		"print_headings": [h.name for h in headings],
		"print_signatures": signatures,
		"languages": [{"name": lg.name, "label": lg.language_name or lg.name} for lg in languages],
		"lang": frappe.local.lang,
		"defaults": defaults,
		"limits": {"print_max_pages": get_print_max_pages()},
		"company": doc.get("company"),
		"docstatus": doc.docstatus,
	}


@frappe.whitelist(methods=["GET"])
def render_doc_print(doctype: str, name: str, print_format: str | None = None) -> dict:
	"""The document's print format as Frappe renders it (without Frappe's letter head: the
	pages carry their own), in the request's language (``_lang``)."""
	guard_doc_print(doctype, name)
	if print_format:
		found = frappe.get_list(
			"Print Format",
			filters={"name": print_format, **_doc_print_format_filters(doctype)},
			fields=["name"],
			limit=1,
		)
		if not found:
			frappe.throw(
				_("Print Format {0} is not available for {1}").format(print_format, _(doctype)),
				frappe.DoesNotExistError,
			)
	out = get_html_and_style(
		doctype, name, print_format=print_format or None, no_letterhead=1, trigger_print=False
	)
	if out.get("html") is None:
		frappe.throw(_("The print format could not be rendered"), RVInvalidInput)
	return {"name": print_format or "", "type": "Jinja", "html": out["html"], "css": out.get("style") or ""}


@frappe.whitelist(methods=["POST"])
def render_doc_heading(doctype: str, name: str, heading: str) -> dict:
	"""A ``Print Heading`` rendered with the document (``doc``), as a report's with its filters."""
	doc = guard_doc_print(doctype, name)
	return printing.render_heading(heading, printing.document_context(doc))


@frappe.whitelist(methods=["POST"])
def render_doc_signature(doctype: str, name: str, signature: str) -> dict:
	"""A ``Print Signature`` of type Document, for this doctype or for all."""
	doc = guard_doc_print(doctype, name)
	return printing.document_signature(signature, doc)


@frappe.whitelist(methods=["POST"])
def get_doc_translations(doctype: str, name: str, lang: str, messages: list | str) -> dict:
	"""Translations of the page's own words in ``lang`` (an enabled language)."""
	guard_doc_print(doctype, name)
	return printing.translations(lang, messages)


@frappe.whitelist(methods=["GET"])
def render_doc_letterhead(doctype: str, name: str, letterhead: str) -> dict:
	"""A letter head rendered with the document as ``doc`` (as Frappe's print page renders
	it); nothing for a user who may not read letter heads."""
	doc = guard_doc_print(doctype, name)
	if not frappe.has_permission("Letter Head", "read"):
		return {}
	found = frappe.get_list(
		"Letter Head", filters={"name": letterhead, "disabled": 0}, fields=["name"], limit=1
	)
	if not found:
		frappe.throw(_("Letter Head {0} not found").format(letterhead), frappe.DoesNotExistError)
	lh = frappe.get_doc("Letter Head", found[0].name)
	# the document's strings print HTML-escaped (Frappe's Jinja does not autoescape)
	context = {"doc": printing.escaped(doc.as_dict())}
	return {
		"header": frappe.render_template(lh.content or "", context),
		"footer": frappe.render_template(lh.footer or "", context),
	}
