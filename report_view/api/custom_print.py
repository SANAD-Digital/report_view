"""The "Custom" print source (ADR-019): a Custom print format rendered with the caller's data
in the pages of Report View (the print page ``rv-print``, custom mode).

Every function first checks that the user may print with the format
(``custom_print.guard_custom_format``); a staged print is its user's only. Lists are read
with ``frappe.get_list``.
"""

import frappe
from frappe import _

from report_view.api import _rate_limit
from report_view.core import custom_print as cp
from report_view.core import printing
from report_view.core.errors import RVInvalidInput
from report_view.core.inputs import parse_json_arg
from report_view.core.settings import get_print_max_pages, print_defaults

MAX_TRANSLATION_MESSAGES = 2000


@frappe.whitelist(methods=["GET"])
def formats() -> list[str]:
	"""The enabled Custom print formats the user may print with."""
	return cp.list_custom_formats()


@frappe.whitelist(methods=["POST"])
@_rate_limit(30)
def stage(
	print_format: str,
	data: dict | list | str,
	title: str | None = None,
	letter_head: str | None = None,
	lang: str | None = None,
	heading: str | None = None,
	signature: str | None = None,
) -> dict:
	"""Keeps ``data`` for an hour for this user; ``{token, route}`` of the print page."""
	cp.guard_custom_format(print_format)
	token = cp.stage(
		print_format, data, title, letter_head=letter_head, lang=lang, heading=heading, signature=signature
	)
	return {"token": token, "route": cp.route(token)}


@frappe.whitelist(methods=["GET"])
def staged(token: str) -> dict:
	"""The staged print of this user: ``{print_format, data, title, options}``."""
	payload = cp.staged(token)
	pf = cp.guard_custom_format(payload["print_format"])
	return {"print_format": pf.name, "data": payload["data"], "title": payload.get("title"), "options": payload.get("options") or {}}


@frappe.whitelist(methods=["GET"])
def get_options(print_format: str, company: str | None = None) -> dict:
	"""What the print page offers around a Custom format: the Custom formats, letter heads
	(the company's default first), print headings, signatures (type Document, for all),
	languages, the site's standard print settings and limits."""
	pf = cp.guard_custom_format(print_format)
	company = company if isinstance(company, str) and company else cp.default_company(None)
	defaults = print_defaults()
	letter_heads = []
	default_letter_head = None
	if frappe.has_permission("Letter Head"):
		letter_heads = frappe.get_list(
			"Letter Head", filters={"disabled": 0}, fields=["name", "is_default"], order_by="name asc", limit=0
		)
		names = {lh.name for lh in letter_heads}
		if company and frappe.has_permission("Company", doc=company):
			rows = frappe.get_list("Company", filters={"name": company}, fields=["default_letter_head"], limit=1)
			default_letter_head = rows[0].default_letter_head if rows else None
		if defaults.get("letter_head") in names:
			default_letter_head = defaults["letter_head"]
		if not default_letter_head:
			default_letter_head = next((lh.name for lh in letter_heads if lh.is_default), None)
		if default_letter_head not in names:
			default_letter_head = None
	defaults.pop("letter_head", None)
	headings = []
	if frappe.has_permission("Print Heading"):
		headings = frappe.get_list("Print Heading", fields=["name"], order_by="name asc", limit=0)
	if defaults.get("heading") not in {h.name for h in headings}:
		defaults["heading"] = ""
	defaults["signature"] = ""
	languages = frappe.get_list(
		"Language", filters={"enabled": 1}, fields=["name", "language_name"], order_by="language_name asc", limit=0
	)
	names = cp.list_custom_formats()
	return {
		"print_format": pf.name,
		"default_print_format": pf.name,
		"print_formats": names,
		"print_format_types": {n: "Jinja" for n in names},
		"letter_heads": [{"name": lh.name, "is_default": bool(lh.is_default)} for lh in letter_heads],
		"default_letter_head": default_letter_head,
		"print_headings": [h.name for h in headings],
		"print_signatures": cp.list_signatures(),
		"languages": [{"name": lg.name, "label": lg.language_name or lg.name} for lg in languages],
		"lang": frappe.local.lang,
		"defaults": defaults,
		"limits": {"print_max_pages": get_print_max_pages()},
		"company": company,
	}


@frappe.whitelist(methods=["POST"])
@_rate_limit(60)
def render(
	print_format: str,
	data: dict | list | str | None = None,
	token: str | None = None,
	title: str | None = None,
	lang: str | None = None,
) -> dict:
	"""The format's template rendered with the data (``data``, or the staged print's
	``token``): ``{name, type, html, css, title}``, in ``lang`` (or the session's)."""
	pf = cp.guard_custom_format(print_format)
	content = cp.data_of(data, token)
	with cp.in_lang(lang):
		return cp.render_format(pf, content, title)


@frappe.whitelist(methods=["GET"])
def render_letterhead(print_format: str, letterhead: str, company: str | None = None) -> dict:
	"""A letter head rendered with ``doc`` = ``{company}``."""
	cp.guard_custom_format(print_format)
	return cp.render_letterhead(letterhead, company if isinstance(company, str) and company else cp.default_company(None))


@frappe.whitelist(methods=["POST"])
@_rate_limit(60)
def render_heading(
	print_format: str,
	heading: str,
	data: dict | list | str | None = None,
	token: str | None = None,
	title: str | None = None,
	lang: str | None = None,
) -> dict:
	"""A ``Print Heading`` rendered with the print's context (``data``, ``doc``, ``title``…)."""
	pf = cp.guard_custom_format(print_format)
	content = cp.data_of(data, token)
	with cp.in_lang(lang):
		return printing.render_heading(heading, cp.context(pf, content, title))


@frappe.whitelist(methods=["POST"])
@_rate_limit(60)
def render_signature(
	print_format: str,
	signature: str,
	data: dict | list | str | None = None,
	token: str | None = None,
	title: str | None = None,
	lang: str | None = None,
) -> dict:
	"""A ``Print Signature`` of type Document for all document types, with the print's context."""
	pf = cp.guard_custom_format(print_format)
	content = cp.data_of(data, token)
	with cp.in_lang(lang):
		return cp.render_signature(signature, cp.context(pf, content, title))


@frappe.whitelist(methods=["POST"])
def get_translations(print_format: str, lang: str, messages: list | str) -> dict:
	"""Translations of the page's own words in ``lang`` (an enabled language)."""
	cp.guard_custom_format(print_format)
	messages = parse_json_arg(messages, "messages", list)
	if not isinstance(lang, str) or lang not in (frappe.translate.get_all_languages() or []):
		frappe.throw(_("Language {0} is not enabled on this site").format(lang), RVInvalidInput)
	if len(messages) > MAX_TRANSLATION_MESSAGES or not all(isinstance(m, str) for m in messages):
		frappe.throw(_("Invalid translation request"), RVInvalidInput)
	translations = frappe.translate.get_all_translations(lang)
	return {m: translations[m] for m in dict.fromkeys(messages) if m in translations}
