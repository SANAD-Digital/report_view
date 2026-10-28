"""The "Custom" print source (ADR-019): a Custom print format rendered with the caller's data
in the pages of Report View (the print page ``rv-print``, custom mode).

Every function first checks what the call prints with (``custom_print.resolve``): a saved
Custom format the user may print with (``guard_custom_format``), or a staged print of this
user with its inline template (``guard_inline``: any Desk user). Lists are read with
``frappe.get_list``.
"""

import frappe
from frappe import _

from report_view.api import _rate_limit
from report_view.core import custom_print as cp
from report_view.core import print_variables, printing
from report_view.core.settings import get_print_max_pages, print_defaults


@frappe.whitelist(methods=["GET"])
def formats() -> list[str]:
	"""The enabled Custom print formats the user may print with."""
	return cp.list_custom_formats()


@frappe.whitelist(methods=["POST"])
@_rate_limit(30)
def stage(
	print_format: str | None = None,
	data: dict | list | str | None = None,
	title: str | None = None,
	letter_head: str | None = None,
	lang: str | None = None,
	heading: str | None = None,
	signature: str | None = None,
	html: str | None = None,
	css: str | None = None,
) -> dict:
	"""Keeps ``data`` (and an inline template: ``html``, ``css``) for an hour for this
	user; ``{token, route}`` of the print page. ``print_format`` or ``html``: one of them."""
	if print_format:
		cp.guard_custom_format(print_format)
	else:
		cp.guard_inline()
	token = cp.stage(
		print_format,
		data,
		title,
		html=html,
		css=css,
		letter_head=letter_head,
		lang=lang,
		heading=heading,
		signature=signature,
	)
	return {"token": token, "route": cp.route(token)}


@frappe.whitelist(methods=["GET"])
def staged(token: str) -> dict:
	"""The staged print of this user: ``{print_format, inline, data, title, options}``
	(``print_format`` None for an inline template, which stays on the server)."""
	pf, payload = cp.resolve(None, token)
	return {
		"print_format": pf.name if pf else None,
		"inline": cp.is_inline(payload),
		"data": payload["data"],
		"title": payload.get("title"),
		"options": payload.get("options") or {},
	}


def _content(payload, data):
	"""The data to render: the staged print's, else as sent."""
	return payload["data"] if payload else cp.parse_data(data)


@frappe.whitelist(methods=["GET"])
def get_options(
	print_format: str | None = None, company: str | None = None, token: str | None = None
) -> dict:
	"""What the print page offers around a Custom format (or the inline template of the
	staged ``token``): the Custom formats, letter heads (the company's default first), print
	headings, signatures (type Document, for all), languages, the site's standard print
	settings and limits."""
	pf, payload = cp.resolve(print_format, token)
	company = company if isinstance(company, str) and company else cp.default_company(None)
	defaults = print_defaults()
	letter_heads, default_letter_head = printing.letter_heads(company, defaults.pop("letter_head", None))
	headings = []
	if frappe.has_permission("Print Heading"):
		headings = frappe.get_list("Print Heading", fields=["name"], order_by="name asc", limit=0)
	if defaults.get("heading") not in {h.name for h in headings}:
		defaults["heading"] = ""
	defaults["signature"] = ""
	languages = frappe.get_list(
		"Language",
		filters={"enabled": 1},
		fields=["name", "language_name"],
		order_by="language_name asc",
		limit=0,
	)
	names = cp.list_custom_formats()
	return {
		"print_format": pf.name if pf else None,
		# the inline template is the choice "" of the format picker
		"default_print_format": pf.name if pf else _("Sent template"),
		"inline": bool(not pf and cp.is_inline(payload)),
		"print_formats": names,
		"print_format_types": {n: "Jinja" for n in names},
		# the variables of each format that has some (ADR-024)
		"print_format_variables": print_variables.definitions_of(names),
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
	print_format: str | None = None,
	data: dict | list | str | None = None,
	token: str | None = None,
	title: str | None = None,
	lang: str | None = None,
	variables: dict | str | None = None,
) -> dict:
	"""The template rendered with the data (``data``, or the staged print's ``token``):
	``{name, type, html, css, title}``, in ``lang`` (or the session's). The template is
	``print_format`` (a saved Custom format, Frappe's Jinja), else the staged print's: its
	saved format, or its inline template (in the sandbox of ``render_inline``). A saved
	format reads ``variables`` (ADR-024): the values sent, checked against its own, with its
	defaults; an inline template has none."""
	pf, payload = cp.resolve(print_format, token)
	content = _content(payload, data)
	title = title or (payload or {}).get("title")
	with cp.in_lang(lang):
		if pf is None:
			return cp.render_inline(payload, content, title)
		return cp.render_format(pf, content, title, print_variables.resolve(pf, variables))


@frappe.whitelist(methods=["GET"])
@_rate_limit(60)
def render_letterhead(
	print_format: str | None = None,
	letterhead: str | None = None,
	company: str | None = None,
	token: str | None = None,
) -> dict:
	"""A letter head rendered with ``doc`` = ``{company}`` (a company the user may read, else
	their default company)."""
	cp.resolve(print_format, token)
	return cp.render_letterhead(
		letterhead, company if isinstance(company, str) and company else cp.default_company(None)
	)


@frappe.whitelist(methods=["POST"])
@_rate_limit(60)
def render_heading(
	print_format: str | None = None,
	heading: str | None = None,
	data: dict | list | str | None = None,
	token: str | None = None,
	title: str | None = None,
	lang: str | None = None,
) -> dict:
	"""A ``Print Heading`` rendered with the print's context (``data``, ``doc``, ``title``…)."""
	pf, payload = cp.resolve(print_format, token)
	content = _content(payload, data)
	title = title or (payload or {}).get("title")
	with cp.in_lang(lang):
		return printing.render_heading(heading, cp.context(pf, content, title))


@frappe.whitelist(methods=["POST"])
@_rate_limit(60)
def render_signature(
	print_format: str | None = None,
	signature: str | None = None,
	data: dict | list | str | None = None,
	token: str | None = None,
	title: str | None = None,
	lang: str | None = None,
) -> dict:
	"""A ``Print Signature`` of type Document for all document types, with the print's context."""
	pf, payload = cp.resolve(print_format, token)
	content = _content(payload, data)
	title = title or (payload or {}).get("title")
	with cp.in_lang(lang):
		return cp.render_signature(signature, cp.context(pf, content, title))


@frappe.whitelist(methods=["POST"])
@_rate_limit(60)
def get_translations(
	print_format: str | None = None,
	lang: str | None = None,
	messages: list | str | None = None,
	token: str | None = None,
) -> dict:
	"""Translations of the page's own words in ``lang`` (an enabled language)."""
	cp.resolve(print_format, token)
	return printing.translations(lang, messages)
