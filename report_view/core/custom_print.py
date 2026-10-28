"""The "Custom" print source (ADR-019): a print format whose data comes from the caller.

A ``Print Format`` with ``print_format_for`` = ``Custom`` (an option added by the Property
Setter in ``fixtures/property_setter.json``) is a Jinja template bound to no doctype and no
report. Its data is sent by whoever prints: a Desk page, a server method, any app. Two ways:

- **inline data**: the data is staged in the cache for an hour, under a token of the user
  who staged it (``stage``); the print page ``/desk/rv-print/Custom/<token>`` reads it back
  (only that user may);
- **a method**: the print page ``/desk/rv-print/Custom/<format>?method=…&args=…`` calls the
  whitelisted method from the browser (with ``GET``), so the method's own whitelist and
  permission checks apply; Report View never calls it for the user.

The data is rendered here with the format's template (``render_format``): every string in
it is a ``printing.Text`` (printed HTML-escaped). The pages around it (paper, letter head,
heading, signature, numbering…) are the Pages view's, as for a document (ADR-017).

A print may also bring its own template (**inline**: ``html`` and ``css`` staged with the
data, ``stage(html=…)``). It comes from the browser, so it is rendered in a sandbox of its
own (``render_inline``): the data and a few helpers, no ``frappe``, no database, no
includes. Any Desk user may print one; its token is its user's only.

Who may print with a format: a user who may select it (``select`` on Print Format, which
Frappe gives to every Desk User, as the document print formats are offered to them), read
with ``frappe.get_list`` so a disabled or a non-Custom format does not exist for them.
"""

import json
import re
import sys
from contextlib import contextmanager
from urllib.parse import quote

import frappe
from frappe import _
from frappe.utils import get_fullname, now_datetime

from report_view.core import print_variables, printing
from report_view.core.errors import RVInvalidInput

CUSTOM = "Custom"
# the data of one print, as JSON
MAX_DATA_BYTES = 5 * 1024 * 1024
STAGE_SECONDS = 3600
TOKEN_LENGTH = 24
_TOKEN = re.compile(r"^[a-f0-9]{24}$")
# a dotted path of a whitelisted method (the browser calls it, Frappe checks it)
_METHOD = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$")
_OPTION_KEYS = ("letter_head", "lang", "heading", "signature")
MAX_TITLE = 140
# an inline template (ADR-019, «قالب مرسل»), as UTF-8
MAX_INLINE_HTML = 200 * 1024
MAX_INLINE_CSS = 100 * 1024
# items all the range() calls of one inline render may give, together
INLINE_RANGE_BUDGET = 100_000


# ---------------------------------------------------------------- the Print Format


def before_validate_print_format(doc, method=None) -> None:
	"""``doc_events`` of Print Format: a Custom format is a custom Jinja template of no
	doctype and no report (Frappe's own ``validate`` then requires its HTML)."""
	if doc.get("print_format_for") != CUSTOM:
		return
	doc.custom_format = 1
	doc.standard = "No"
	doc.print_format_type = "Jinja"
	doc.raw_printing = 0
	doc.doc_type = None
	doc.report = None
	if not doc.get("module"):
		doc.module = "Report View"


def guard_custom_format(name: str):
	"""The Custom print format ``name``, if the user may print with it; else
	PermissionError (no select on Print Format) or DoesNotExistError (not found, disabled,
	or not a Custom format)."""
	if not isinstance(name, str) or not name.strip():
		frappe.throw(_("A print format is required"), RVInvalidInput)
	if not frappe.has_permission("Print Format", "select"):
		frappe.throw(_("Not permitted to print with {0}").format(name), frappe.PermissionError)
	found = frappe.get_list(
		"Print Format",
		filters={"name": name, "disabled": 0, "print_format_for": CUSTOM},
		fields=["name"],
		limit=1,
	)
	if not found:
		frappe.throw(_("Custom print format {0} not found").format(name), frappe.DoesNotExistError)
	return frappe.get_cached_doc("Print Format", found[0].name)


def list_custom_formats() -> list[str]:
	"""The enabled Custom formats the user may select."""
	if not frappe.has_permission("Print Format", "select"):
		return []
	rows = frappe.get_list(
		"Print Format",
		filters={"disabled": 0, "print_format_for": CUSTOM},
		fields=["name"],
		order_by="name asc",
		limit=0,
	)
	return [r.name for r in rows]


# ---------------------------------------------------------------- the data


def parse_data(data, allow_none: bool = True):
	"""The data of a print: JSON (an object or a list), at most ``MAX_DATA_BYTES``."""
	if data is None or data == "":
		if allow_none:
			return {}
		frappe.throw(_("The data to print is required"), RVInvalidInput)
	if isinstance(data, str):
		if len(data.encode("utf-8")) > MAX_DATA_BYTES:
			_too_large()
		try:
			data = json.loads(data)
		except ValueError:
			frappe.throw(_("The data to print is not valid JSON"), RVInvalidInput)
	else:
		try:
			size = len(json.dumps(data, default=str).encode("utf-8"))
		except TypeError, ValueError:
			frappe.throw(_("The data to print is not valid JSON"), RVInvalidInput)
		if size > MAX_DATA_BYTES:
			_too_large()
		# what the cache and the template get is plain JSON (dates as text)
		data = json.loads(json.dumps(data, default=str))
	if not isinstance(data, dict | list):
		frappe.throw(_("The data to print must be an object or a list"), RVInvalidInput)
	return data


def _too_large():
	frappe.throw(
		_("The data to print is larger than {0} MB").format(MAX_DATA_BYTES // (1024 * 1024)), RVInvalidInput
	)


def _title(title) -> str | None:
	if title is None or title == "":
		return None
	if not isinstance(title, str):
		frappe.throw(_("Invalid title"), RVInvalidInput)
	return title.strip()[:MAX_TITLE] or None


def _options(values: dict) -> dict:
	"""The choices of the pages the caller may make (letter head, language, heading,
	signature): names only, each checked again when the pages render it."""
	out = {}
	for key in _OPTION_KEYS:
		value = values.get(key)
		if value is None or value == "":
			continue
		if not isinstance(value, str) or len(value) > MAX_TITLE:
			frappe.throw(_("Invalid value for {0}").format(key), RVInvalidInput)
		out[key] = value
	return out


def _key(token: str) -> str:
	return f"report_view:custom_print:{token}"


def guard_inline() -> None:
	"""An inline template may be printed by any Desk user (a System User signed in)."""
	user = frappe.session.user
	if user == "Guest" or frappe.get_cached_value("User", user, "user_type") != "System User":
		frappe.throw(_("Not permitted to print"), frappe.PermissionError)


def _one_source(print_format, html) -> None:
	given = [x for x in (print_format, html) if x not in (None, "")]
	if len(given) != 1:
		frappe.throw(_("Give either a print format or an HTML template, not both"), RVInvalidInput)


def _inline_text(value, name: str, limit: int, required: bool) -> str:
	if value is None or value == "":
		if required:
			frappe.throw(_("The HTML template is required"), RVInvalidInput)
		return ""
	if not isinstance(value, str):
		frappe.throw(_("{0} has an invalid type").format(name), RVInvalidInput)
	if len(value.encode("utf-8")) > limit:
		frappe.throw(
			_("The {0} of the template is larger than {1} KB").format(name, limit // 1024), RVInvalidInput
		)
	return value


def stage(
	print_format: str | None = None,
	data=None,
	title: str | None = None,
	html: str | None = None,
	css: str | None = None,
	**options,
) -> str:
	"""Keeps the data of a print for an hour, for this user; the token of the print page.
	The template is a saved Custom format (``print_format``) or sent with the data
	(``html`` and ``css``): one of the two."""
	_one_source(print_format, html)
	if print_format:
		pf = guard_custom_format(print_format)
		source = {"print_format": pf.name}
	else:
		guard_inline()
		html = _inline_text(html, "HTML", MAX_INLINE_HTML, True)
		css = _inline_text(css, "CSS", MAX_INLINE_CSS, False)
		# a broken template is told now, not on the print page
		compile_inline(html)
		source = {"print_format": None, "html": html, "css": css}
	payload = {
		"owner": frappe.session.user,
		**source,
		"data": parse_data(data, allow_none=False),
		"title": _title(title),
		"options": _options(options),
	}
	token = frappe.generate_hash(length=TOKEN_LENGTH)
	frappe.cache.set_value(_key(token), payload, expires_in_sec=STAGE_SECONDS)
	return token


def staged(token: str) -> dict:
	"""The staged print of this user (another user's does not exist for them)."""
	if not isinstance(token, str) or not _TOKEN.match(token):
		frappe.throw(_("Invalid print link"), RVInvalidInput)
	payload = frappe.cache.get_value(_key(token), use_local_cache=False)
	if not payload or payload.get("owner") != frappe.session.user:
		frappe.throw(
			_("This print has expired. Print it again from where it came from."), frappe.DoesNotExistError
		)
	return payload


def resolve(print_format: str | None = None, token: str | None = None):
	"""What a call prints with: ``(format, payload)``. A saved Custom format named by the
	call (``guard_custom_format``), else the staged print's own (its saved format, or its
	inline template: ``format`` None, ``guard_inline``). ``payload`` is the staged print
	(its user's only), or None without a token."""
	payload = staged(token) if token else None
	if print_format:
		return guard_custom_format(print_format), payload
	if not payload:
		frappe.throw(_("A print format is required"), RVInvalidInput)
	if payload.get("html"):
		guard_inline()
		return None, payload
	return guard_custom_format(payload["print_format"]), payload


def is_inline(payload) -> bool:
	return bool(payload and payload.get("html"))


def route(token_or_format: str) -> str:
	return f"/desk/rv-print/{CUSTOM}/{quote(token_or_format, safe='')}"


def print_url(
	print_format: str | None = None,
	data=None,
	title: str | None = None,
	method: str | None = None,
	args: dict | None = None,
	absolute: bool = False,
	html: str | None = None,
	css: str | None = None,
	**options,
) -> str:
	"""The address of the print page for a server method to return to the browser.

	The template: a saved Custom format (``print_format``) or ``html`` and ``css`` (one of
	the two). With ``data``: the data (and an inline template) is staged for this user (an
	hour) and the address carries its token. With ``method`` (and its ``args``): the address
	names the format and the method, which the print page calls from the browser
	(bookmarkable, live data); an inline template cannot travel in an address."""
	_one_source(print_format, html)
	if html and data is None:
		frappe.throw(
			_("An HTML template is sent with its data: an address with a method cannot carry it"),
			RVInvalidInput,
		)
	if data is None and not method:
		frappe.throw(_("Give the data to print or the method that returns it"), RVInvalidInput)
	if data is not None:
		path = route(stage(print_format, data, title, html=html, css=css, **options))
	else:
		pf = guard_custom_format(print_format)
		check_method(method)
		query = {"method": method}
		if args:
			query["args"] = json.dumps(args, default=str, separators=(",", ":"))
		if title:
			query["title"] = _title(title)
		query.update(_options(options))
		path = route(pf.name) + "?" + "&".join(f"{k}={quote(str(v), safe='')}" for k, v in query.items())
	return frappe.utils.get_url(path) if absolute else path


def check_method(method) -> str:
	if not isinstance(method, str) or not _METHOD.match(method) or len(method) > 300:
		frappe.throw(_("Invalid data method"), RVInvalidInput)
	return method


# ---------------------------------------------------------------- rendering


def default_company(data) -> str | None:
	company = data.get("company") if isinstance(data, dict) else None
	if isinstance(company, str) and company:
		return company
	return frappe.defaults.get_user_default("Company") or frappe.defaults.get_global_default("company")


def context(pf, data, title: str | None = None) -> dict:
	# ``pf``: the saved format, or None for an inline template
	"""What a Custom format reads: ``data`` (as sent; its strings print escaped), ``doc``
	(the data when it is an object: ``doc.total``), ``rows`` (the data when it is a list, or
	its ``rows``), ``title``, ``company``, ``printed_by``, ``printed_on``, ``lang``,
	``print_format``. Headings and signatures read the same (and ``filters``, empty)."""
	safe = printing.escaped(data)
	rows = safe if isinstance(safe, list) else (safe.get("rows") if isinstance(safe, dict) else None)
	return {
		"data": safe,
		"doc": safe if isinstance(safe, dict) else frappe._dict(),
		"rows": rows if isinstance(rows, list) else [],
		"title": printing.Text(_title(title) or (_(pf.name) if pf else _("Sent template"))),
		"print_format": pf.name if pf else "",
		"company": printing.escaped(default_company(data)),
		"printed_by": printing.Text(get_fullname()),
		"printed_on": now_datetime(),
		"lang": frappe.local.lang,
		"report_name": "",
		"filters": frappe._dict(),
	}


@contextmanager
def in_lang(lang: str | None):
	"""The template rendered in ``lang`` (an enabled language), the session's after."""
	if not lang or lang == frappe.local.lang:
		yield
		return
	if not isinstance(lang, str) or lang not in (frappe.translate.get_all_languages() or []):
		frappe.throw(_("Language {0} is not enabled on this site").format(lang), RVInvalidInput)
	before = frappe.local.lang
	frappe.local.lang = lang
	try:
		yield
	finally:
		frappe.local.lang = before


def render_jinja(template: str, ctx: dict, what: str) -> str:
	"""``template`` in Frappe's sandboxed Jinja. A broken template is the format's
	author's problem: the user reads a translated message, the Error Log keeps the details,
	and the template's line is told in developer mode only."""
	from frappe.utils.jinja import get_jenv, safe_render_flags

	if not template:
		return ""
	if ".__" in template:
		frappe.throw(_("Illegal template"), RVInvalidInput)
	try:
		compiled = get_jenv().from_string(template)
		with safe_render_flags():
			return compiled.render(ctx)
	except frappe.ValidationError, frappe.PermissionError, frappe.DoesNotExistError:
		raise
	except Exception as e:
		_broken(e, what)


def _broken(e, what: str) -> None:
	from jinja2 import TemplateSyntaxError

	line = e.lineno if isinstance(e, TemplateSyntaxError) else _template_line(sys.exc_info()[2])
	frappe.log_error(title=f"Report View custom print: {what}")
	message = _(
		"The print format {0} could not be rendered. Ask the person who wrote it to check it."
	).format(what)
	if frappe.conf.get("developer_mode"):
		detail = f"{type(e).__name__}: {e}"
		if line:
			detail = _("Line {0}").format(line) + f" · {detail}"
		message += f"<br><code>{frappe.utils.escape_html(detail)}</code>"
	frappe.throw(message, RVInvalidInput)


# ---------------------------------------------------------------- an inline template

_INLINE_FORMATTED = {
	"Int",
	"Float",
	"Currency",
	"Percent",
	"Date",
	"Datetime",
	"Time",
	"Check",
	"Duration",
	"Rating",
}
_CURRENCY = re.compile(r"^[A-Z]{3}$")
_inline_env = None


def inline_env():
	"""The environment of an inline template: Jinja's immutable sandbox with no loader (no
	include, import or extends) and no globals at all; the context gives the few helpers."""
	global _inline_env
	if _inline_env is None:
		from jinja2.sandbox import ImmutableSandboxedEnvironment

		# None prints nothing (a field the data does not have)
		env = ImmutableSandboxedEnvironment(
			loader=None, autoescape=False, finalize=lambda v: "" if v is None else v
		)
		env.globals.clear()
		_inline_env = env
	return _inline_env


def compile_inline(html: str):
	"""The inline template compiled (a syntax error is a translated message)."""
	if ".__" in html:
		frappe.throw(_("Illegal template"), RVInvalidInput)
	try:
		return inline_env().from_string(html)
	except Exception as e:
		_broken(e, _("Sent template"))


def _raw(value):
	return str.__str__(value) if isinstance(value, printing.Text) else value


def inline_translate(msg, context=None):
	"""``_()`` of an inline template: a text of the data stays escaped when printed."""
	out = frappe._(str(_raw(msg)), context=_raw(context) if isinstance(context, str) else None)
	return printing.Text(out) if isinstance(msg, printing.Text) else out


def inline_format_value(value, fieldtype="Data", options=None):
	"""``format_value(value, fieldtype, options)`` of an inline template: Frappe's number,
	date and money formats on a plain field (no document, no link lookups). Text prints
	escaped."""
	fieldtype = _raw(fieldtype) if isinstance(fieldtype, str) else "Data"
	if value is None:
		return ""
	if fieldtype not in _INLINE_FORMATTED:
		return value
	raw = _raw(value)
	if fieldtype == "Currency":
		currency = _raw(options) if isinstance(options, str) and _CURRENCY.match(_raw(options)) else None
		out = frappe.utils.fmt_money(frappe.utils.flt(raw), currency=currency)
	else:
		out = frappe.format_value(raw, frappe._dict(fieldtype=fieldtype))
	return printing.Text(out) if isinstance(out, str) else out


def _budget_range():
	left = [INLINE_RANGE_BUDGET]

	def inline_range(*args):
		from jinja2.exceptions import SecurityError

		r = range(*args)
		if len(r) > left[0]:
			raise SecurityError("range() is limited in a sent template")
		left[0] -= len(r)
		return r

	return inline_range


def render_inline(payload: dict, data, title: str | None = None) -> dict:
	"""The staged inline template (``html``, ``css``) rendered with the data in its sandbox:
	``{name: "", type, html, css (scoped), title, inline: True}``. What it reads: ``data``,
	``doc``, ``rows``, ``title``, ``company`` (a name), ``printed_by``, ``printed_on``,
	``lang``, ``_()``, ``format_value()``, ``range()`` and Jinja's filters."""
	ctx = context(None, data, title)
	safe = {
		k: ctx[k] for k in ("data", "doc", "rows", "title", "company", "printed_by", "printed_on", "lang")
	}
	safe.update({"_": inline_translate, "format_value": inline_format_value, "range": _budget_range()})
	compiled = compile_inline(payload.get("html") or "")
	try:
		html = compiled.render(safe)
	except frappe.ValidationError, frappe.PermissionError, frappe.DoesNotExistError:
		raise
	except Exception as e:
		_broken(e, _("Sent template"))
	return {
		"name": "",
		"type": "Jinja",
		"html": html,
		"css": scoped_css(payload.get("css")),
		"title": str.__str__(ctx["title"]),
		"inline": True,
	}


def _template_line(tb) -> int | None:
	line = None
	while tb:
		if tb.tb_frame.f_code.co_filename == "<template>":
			line = tb.tb_lineno
		tb = tb.tb_next
	return line


# a CSS block may not close the <style> it is printed in
_STYLE_END = re.compile(r"</\s*style", re.IGNORECASE)
# rules that cannot be nested: kept at the top of the scoped CSS
_TOP_RULES = re.compile(
	r"@(?:import|charset)[^;]*;|@font-face\s*\{[^}]*\}|@page\s*[^{]*\{[^}]*\}", re.IGNORECASE
)
FLOW_SCOPE = ".rv-page-flow"


def scoped_css(css: str | None) -> str:
	"""A Custom format's CSS nested in the content of the pages (CSS nesting): its rules
	reach what the format rendered, never the letter head, the footer or the rest of the
	page. ``@font-face`` and ``@import`` stay at the top; ``@page`` is dropped (the pages are
	the paper)."""
	css = _STYLE_END.sub("", css or "").strip()
	if not css:
		return ""
	top = [r for r in _TOP_RULES.findall(css) if not r.lower().startswith("@page")]
	rest = _TOP_RULES.sub("", css).strip()
	return "".join(top) + (f"{FLOW_SCOPE}{{{rest}}}" if rest else "")


def render_format(pf, data, title: str | None = None, variables: dict | None = None) -> dict:
	"""The format's HTML (Jinja) and its CSS, scoped to the rendered content, for the data:
	``{name, type, html, css, title}``. The pages print that CSS with the sheets, so the
	server's PDF gets it as well. ``variables``: the format's, checked
	(``print_variables.resolve``; its defaults when not given)."""
	ctx = context(pf, data, title)
	ctx["variables"] = variables if variables is not None else print_variables.resolve(pf)
	html = render_jinja(pf.html or "", ctx, pf.name)
	return {
		"name": pf.name,
		"type": "Jinja",
		"html": html,
		"css": scoped_css(pf.css),
		"title": str.__str__(ctx["title"]),
	}


def render_letterhead(name: str, company: str | None) -> dict:
	"""A letter head with ``doc`` = ``{company}`` (nothing for who may not read them). A
	company the user may not read prints as their default company: a builder letter head
	reads the company's record (tax ID, address, logo) when it prints."""
	if not frappe.has_permission("Letter Head", "read"):
		return {}
	if (
		company
		and frappe.db.exists("Company", company)
		and not frappe.has_permission("Company", "read", doc=company)
	):
		company = default_company(None)
		if (
			company
			and frappe.db.exists("Company", company)
			and not frappe.has_permission("Company", "read", doc=company)
		):
			company = None
	found = frappe.get_list("Letter Head", filters={"name": name, "disabled": 0}, fields=["name"], limit=1)
	if not found:
		frappe.throw(_("Letter Head {0} not found").format(name), frappe.DoesNotExistError)
	lh = frappe.get_doc("Letter Head", found[0].name)
	ctx = {"doc": printing.escaped({"company": company}), "company": printing.escaped(company)}
	return {
		"header": frappe.render_template(lh.content or "", ctx),
		"footer": frappe.render_template(lh.footer or "", ctx),
	}


def signature_filters() -> tuple[dict, list]:
	"""Signatures of a Custom print: those of type Document for all document types."""
	return printing.signature_filters("Document", None, "reference_doctype")


def list_signatures() -> list[dict]:
	filters, or_filters = signature_filters()
	rows = frappe.get_list(
		"Print Signature",
		filters=filters,
		or_filters=or_filters,
		fields=["name", "content_type"],
		order_by="name asc",
		limit=0,
	)
	return [{"name": r.name, "content_type": r.content_type} for r in rows]


def render_signature(name: str, ctx: dict) -> dict:
	filters, or_filters = signature_filters()
	found = frappe.get_list(
		"Print Signature", filters={"name": name, **filters}, or_filters=or_filters, fields=["name"], limit=1
	)
	if not found:
		frappe.throw(
			_("Print Signature {0} is not available for this print").format(name), frappe.DoesNotExistError
		)
	return printing.render_signature(
		frappe.get_doc("Print Signature", found[0].name), {**ctx, "standalone": False}
	)
