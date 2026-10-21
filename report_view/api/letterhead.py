"""The Letter Head builder API (ADR-018).

The browser sends a layout (JSON), never HTML: the server validates it, generates the
letter head's HTML (``core.letterhead``) and writes it into a standard ``Letter Head``
(``content`` and ``footer``, source ``HTML``); the layout is kept in ``Letter Head Layout``.
Every function checks the permission first: reading needs Letter Head and Company read,
saving needs Letter Head write (and Company write to make it the company's default).
Records are read with ``frappe.get_list`` and written with a normal ``save``.
"""

import json

import frappe
from frappe import _

from report_view.api import _rate_limit
from report_view.core import letterhead as lh_core
from report_view.core.errors import RVInvalidInput
from report_view.core.letterhead import RVLetterHeadEdited

MAX_NAME = 140


def _guard_read():
	if not frappe.has_permission("Letter Head", "read") or not frappe.has_permission("Company", "read"):
		frappe.throw(_("Not permitted to design letter heads"), frappe.PermissionError)


def _guard_save(letter_head: str | None, make_default, company: str | None):
	"""Letter Head write (create for a new one) and the layout's; Company write for
	``make_default``."""
	if letter_head:
		allowed = frappe.has_permission("Letter Head", "write", doc=letter_head) and frappe.has_permission(
			"Letter Head Layout", "write"
		)
	else:
		allowed = frappe.has_permission("Letter Head", "create") and frappe.has_permission("Letter Head Layout", "create")
	if not allowed:
		frappe.throw(_("Not permitted to save letter heads"), frappe.PermissionError)
	if frappe.utils.cint(make_default) and not frappe.has_permission("Company", "write", doc=company):
		frappe.throw(_("Not permitted to change the default letter head of the company"), frappe.PermissionError)


def _company(name: str | None) -> frappe._dict | None:
	"""A company the user may read, with the fields the builder prints."""
	if not name:
		return None
	if not isinstance(name, str):
		frappe.throw(_("Invalid company"), RVInvalidInput)
	rows = frappe.get_list(
		"Company", filters={"name": name}, fields=["name", *lh_core.COMPANY_FIELDS], limit=1
	)
	if not rows:
		frappe.throw(_("Company {0} not found").format(name), frappe.DoesNotExistError)
	return rows[0]


def _address(company: str) -> dict:
	"""The company's address (``is_your_company_address`` first, then the primary one),
	as the letter head prints it; nothing for a user who may not read addresses."""
	if not frappe.has_permission("Address", "read"):
		return {}
	rows = frappe.get_list(
		"Address",
		filters=[["Dynamic Link", "link_doctype", "=", "Company"], ["Dynamic Link", "link_name", "=", company]],
		fields=list(lh_core.ADDRESS_FIELDS),
		order_by="is_your_company_address desc, is_primary_address desc",
		limit=1,
	)
	return rows[0] if rows else {}


def _values(company: frappe._dict, address: dict) -> dict:
	"""``{token: value}`` of a company: what each field of the layout prints."""
	name = company.company_name or company.name
	name_ar = frappe.translate.get_user_translations("ar").get(name) or name
	city_line = ", ".join(v for v in (address.get("city"), address.get("state"), address.get("pincode")) if v)
	full = "\n".join(
		v for v in (address.get("address_line1"), address.get("address_line2"), city_line, address.get("country")) if v
	)
	values = {t: company.get(t) or "" for t in lh_core.TOKENS if t in lh_core.COMPANY_FIELDS}
	values.update(
		company_name=name,
		company_name_ar=name_ar,
		address=full,
		address_line1=address.get("address_line1") or "",
		city=address.get("city") or "",
	)
	return values


def _default_company(readable: list[str]) -> str | None:
	for name in (
		frappe.defaults.get_user_default("Company"),
		frappe.db.get_single_value("Global Defaults", "default_company"),
	):
		if name in readable:
			return name
	return readable[0] if readable else None


def _letter_head(name: str) -> frappe._dict:
	rows = frappe.get_list(
		"Letter Head",
		filters={"name": name},
		fields=["name", "is_default", "disabled", "content", "footer"],
		limit=1,
	)
	if not rows:
		frappe.throw(_("Letter Head {0} not found").format(name), frappe.DoesNotExistError)
	return rows[0]


def _layout_record(letter_head: str) -> frappe._dict | None:
	rows = frappe.get_list(
		"Letter Head Layout",
		filters={"letter_head": letter_head},
		fields=["name", "company", "template", "layout", "generated_hash"],
		limit=1,
	)
	return rows[0] if rows else None


def _hand_edited(lh: frappe._dict, record: frappe._dict | None) -> bool:
	"""The letter head's HTML differs from what the builder last wrote; a letter head the
	builder never wrote counts as edited by hand when it has HTML."""
	if record:
		return lh_core.content_hash(lh.content, lh.footer) != record.generated_hash
	return bool((lh.content or "").strip() or (lh.footer or "").strip())


def _token_labels() -> dict:
	"""The fields a layout may print, in the order of ``TOKENS``, with their labels."""
	return {
		"company_name": _("Company Name"),
		"company_name_ar": _("Company Name (Arabic)"),
		"abbr": _("Abbreviation"),
		"tax_id": _("Tax ID"),
		"phone_no": _("Phone No"),
		"fax": _("Fax"),
		"email": _("Email"),
		"website": _("Website"),
		"registration_details": _("Registration Details"),
		"country": _("Country"),
		"address": _("Address"),
		"address_line1": _("Address Line 1"),
		"city": _("City"),
	}


def _heights(layout: dict) -> dict:
	return {"header_height": layout["header"]["h"], "footer_height": layout["footer"]["h"]}


@frappe.whitelist(methods=["GET"])
def builder_context(company: str | None = None, letter_head: str | None = None) -> dict:
	"""What the builder draws with: the companies the user reads, the chosen company's
	values per field, the fonts, fields, limits and defaults of the layout, whether the user
	may save, and the letter head's layout when it has one."""
	_guard_read()
	companies = frappe.get_list("Company", fields=["name", "company_name", "abbr"], order_by="name asc", limit=0)
	readable = [c.name for c in companies]
	lh_info = None
	if letter_head:
		lh = _letter_head(letter_head)
		record = _layout_record(lh.name)
		lh_info = {
			"name": lh.name,
			"is_default": lh.is_default,
			"disabled": lh.disabled,
			"has_layout": bool(record),
			"layout": json.loads(record.layout) if record and record.layout else None,
			"company": record.company if record else None,
			"template": record.template if record else None,
			"hand_edited": _hand_edited(lh, record),
		}
		company = company or (record.company if record else None)
	company = company or _default_company(readable)
	data = None
	if company:
		row = _company(company)
		address = _address(row.name)
		logo = row.company_logo or ""
		data = {
			"name": row.name,
			"values": _values(row, address),
			"address": address,
			"logo": logo,
			"logo_public": logo.startswith(("/files/", "/assets/")),
		}
	return {
		"companies": companies,
		"company": data["name"] if data else None,
		"company_data": data,
		"letter_head": lh_info,
		"fonts": list(lh_core.FONTS),
		"tokens": [{"token": t, "label": label} for t, label in _token_labels().items()],
		"ref_width": lh_core.REF_WIDTH,
		"defaults": {
			"colors": dict(lh_core.DEFAULT_COLORS),
			"header": {"h": 35, "pad_top": 6, "slots": dict(lh_core.BANDS["header"]["slots"])},
			"footer": {"h": 15, "pad_top": 3, "slots": dict(lh_core.BANDS["footer"]["slots"])},
		},
		"limits": {
			"layout_bytes": lh_core.MAX_LAYOUT_BYTES,
			"elements": lh_core.MAX_ELEMENTS,
			"text": lh_core.MAX_TEXT,
			"label": lh_core.MAX_LABEL,
			"qr_text": lh_core.MAX_QR_TEXT,
			"header_h": list(lh_core.BANDS["header"]["h"][:2]),
			"footer_h": list(lh_core.BANDS["footer"]["h"][:2]),
			"pad_top": list(lh_core.BANDS["header"]["pad_top"][:2]),
			"slot": [0, 70],
			"size": [6, 40],
			"gap": [0, 10],
		},
		"can_write": bool(
			frappe.has_permission("Letter Head", "write", doc=lh_info["name"]) if lh_info else frappe.has_permission("Letter Head", "create")
		),
		"can_set_default": bool(company and frappe.has_permission("Company", "write", doc=company)),
	}


@frappe.whitelist(methods=["POST"])
@_rate_limit(120)
def preview(layout: dict | str, company: str | None = None) -> dict:
	"""The letter head of ``layout`` as it prints for ``company``: generated, then rendered
	by Frappe's Jinja with ``{doc: {company}}``, as the print view renders it."""
	_guard_read()
	clean = lh_core.parse_layout(layout)
	row = _company(company) if company else None
	html = lh_core.generate(clean, qr_company=row.name if row else None)
	context = {"doc": frappe._dict(company=row.name if row else None)}
	return {
		"header": frappe.render_template(html["header"], context),
		"footer": frappe.render_template(html["footer"], context),
		"warnings": lh_core.layout_warnings(clean, row),
		"print_format_css": lh_core.print_format_css(clean),
		**_heights(clean),
	}


@frappe.whitelist(methods=["POST"])
@_rate_limit(20)
def save(
	layout: dict | str,
	letter_head: str | None = None,
	name: str | None = None,
	company: str | None = None,
	make_default: int | str = 0,
	overwrite: int | str = 0,
	template: str | None = None,
	preview_company: str | None = None,
) -> dict:
	"""Write ``layout`` into ``letter_head`` (or a new Letter Head called ``name``) and its
	Letter Head Layout. ``company`` is the fixed company (empty: the document's); a QR code
	of the website takes that of ``company``, else of ``preview_company``. A letter head
	edited by hand since the builder wrote it is refused (``RVLetterHeadEdited``) unless
	``overwrite``. ``make_default`` makes it the default of ``company`` (else of
	``preview_company``)."""
	_guard_save(letter_head, make_default, company or preview_company)
	clean = lh_core.parse_layout(layout)
	fixed = _company(company)
	shown = _company(preview_company)
	if template is not None and (not isinstance(template, str) or len(template) > MAX_NAME):
		frappe.throw(_("Invalid template"), RVInvalidInput)
	html = lh_core.generate(clean, fixed.name if fixed else None, qr_company=shown.name if shown else None)

	if letter_head:
		current = _letter_head(letter_head)
		record = _layout_record(current.name)
		if not frappe.utils.cint(overwrite) and _hand_edited(current, record):
			frappe.throw(
				_("Letter Head {0} was edited by hand. Saving the design replaces its HTML.").format(current.name),
				RVLetterHeadEdited,
			)
		lh = frappe.get_doc("Letter Head", current.name)
	else:
		name = name.strip() if isinstance(name, str) else ""
		if not name or len(name) > MAX_NAME:
			frappe.throw(_("Name the letter head"), RVInvalidInput)
		if frappe.db.exists("Letter Head", name):
			frappe.throw(_("Letter Head {0} already exists").format(name), frappe.DuplicateEntryError)
		record = None
		lh = frappe.new_doc("Letter Head")
		lh.letter_head_name = name
		lh.content, lh.footer, lh.footer_source = html["header"], html["footer"], "HTML"
		# Letter Head.before_insert makes a new one an image letter head (and warns that it
		# has no image); the source is set to HTML right after, so that warning is dropped
		log = frappe.local.message_log
		count = len(log)
		lh.insert()
		del log[count:]

	lh.source = lh.footer_source = "HTML"
	lh.content, lh.footer = html["header"], html["footer"]
	meta = frappe.get_meta("Letter Head")
	for field, value in _heights(clean).items():
		if meta.has_field(field):
			lh.set(field, value)
	lh.save()

	doc = frappe.get_doc("Letter Head Layout", record.name) if record else frappe.new_doc("Letter Head Layout")
	doc.letter_head = lh.name
	doc.company = fixed.name if fixed else None
	if template is not None:
		doc.template = template
	doc.layout = json.dumps(clean, ensure_ascii=False, separators=(",", ":"))
	doc.generated_hash = lh_core.content_hash(lh.content, lh.footer)
	doc.save()

	target = fixed or shown
	if frappe.utils.cint(make_default):
		if not target:
			frappe.throw(_("Choose the company of the letter head"), RVInvalidInput)
		company_doc = frappe.get_doc("Company", target.name)
		if company_doc.default_letter_head != lh.name:
			company_doc.default_letter_head = lh.name
			company_doc.save()

	return {
		"letter_head": lh.name,
		"layout": clean,
		"generated_hash": doc.generated_hash,
		"is_default": lh.is_default,
		"company_default": frappe.utils.cint(make_default) and bool(target),
		"warnings": lh_core.layout_warnings(clean, target),
		"print_format_css": lh_core.print_format_css(clean),
		**_heights(clean),
	}


@frappe.whitelist(methods=["GET"])
@_rate_limit(60)
def qr_svg(text: str) -> dict:
	"""The QR code of ``text`` as SVG (the preview draws what the save embeds)."""
	_guard_read()
	if not isinstance(text, str) or not text.strip() or len(text) > lh_core.MAX_QR_TEXT:
		frappe.throw(_("Invalid QR code text"), RVInvalidInput)
	return {"svg": lh_core.qr_svg(text.strip())}
