"""The Letter Head builder (ADR-018): the layout (JSON, ``v: 1``) checked and normalised,
and the HTML of the letter head generated from it.

The browser sends a layout, never HTML nor Jinja. ``validate_layout`` returns a clean copy
(unknown types, tokens and keys refused, numbers clamped to their ranges). ``generate``
writes the header and the footer as Jinja templates that every print path of Frappe
renders with ``{doc}`` (print view, wkhtmltopdf, Chrome, report printing, the Pages of
Report View): only core globals (``frappe.db.get_value``, ``frappe.db.get_single_value``;
no function of Report View, so the letter head keeps printing without the app), every
value ``|e``, every text escaped with its Jinja delimiters neutralised, inline styles
only (and one ``<style>`` per band: the ``@font-face`` rules of its font, core/fonts.py),
and no script, grid, flex, CSS variable or transform (QtWebKit of wkhtmltopdf).
"""

import hashlib
import io
import json
import math
import re
from html import escape

import frappe
from frappe import _

from report_view.core import fonts as font_lib
from report_view.core.errors import RVInvalidInput

LAYOUT_VERSION = 1
MAX_LAYOUT_BYTES = 64 * 1024
MAX_ELEMENTS = 60
MAX_TEXT = 500
MAX_LABEL = 60
MAX_QR_TEXT = 300
# x and w are millimetres on this width (A4 portrait less 15mm margins) and print as
# percentages of the band, so a design fits any paper width
REF_WIDTH = 180

# the font library (core/fonts.py, report_view/fonts.json)
FONTS = font_lib.families()
DEFAULT_FONT = font_lib.DEFAULT_FONT
# the @font-face urls of the letter head: absolute, so every print path finds the files
# (print view, wkhtmltopdf, Chrome, the Pages and their PDF engine)
FONT_BASE = "{{ frappe.utils.get_url('" + font_lib.ASSET_BASE + "')|e }}"
DEFAULT_COLORS = {"primary": "#1E5C45", "text": "#17211C", "muted": "#5B6660"}
SLOTS = ("right", "center", "left")
# band: (min, max, default) of h and pad_top, and the default slot widths (%)
BANDS = {
	"header": {"h": (10, 80, 35), "pad_top": (0, 20, 6), "slots": {"right": 34, "center": 26, "left": 34}},
	"footer": {"h": (0, 50, 15), "pad_top": (0, 20, 3), "slots": {"right": 40, "center": 20, "left": 40}},
}
TOKENS = (
	"company_name", "company_name_ar", "abbr", "tax_id", "phone_no", "fax", "email", "website",
	"registration_details", "country", "address", "address_line1", "city",
)
# values printed left-to-right inside a right-to-left slot
LTR_TOKENS = {"tax_id", "phone_no", "fax", "email", "website"}
MULTILINE_TOKENS = {"address", "registration_details"}
COMPANY_FIELDS = (
	"company_name", "abbr", "tax_id", "phone_no", "fax", "email", "website",
	"registration_details", "country", "company_logo",
)
ADDRESS_FIELDS = ("address_line1", "address_line2", "city", "state", "pincode", "country")
# default (w, h) in mm of an element that does not give them
DEFAULT_SIZE = {
	"text": (60, 0), "field": (60, 0), "logo": (40, 18), "image": (40, 20),
	"line": (0, 0), "band": (180, 6), "qr": (18, 18), "page": (60, 0),
}
WEIGHTS = (400, 500, 600, 700)
ALIGNS = ("start", "center", "end")
COLOR_TOKENS = ("primary", "text", "muted")
PAGE_FORMATS = ("ar", "en", "both")

_ID = re.compile(r"^[a-z0-9]{1,12}$")
_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
# a public file or an asset; no quote, bracket, backslash or control character (it prints
# in an attribute and in a CSS url()), no parent segment
_SRC = re.compile(r"^/(files|assets)/[^\"'()<>\\{}\x00-\x1f\x7f]{1,400}$")
ELEMENT_KEYS = {"id", "type", "slot", "x", "y", "w", "h", "style", "props"}
STYLE_KEYS = {"size", "weight", "color", "align", "gap"}


class RVLetterHeadEdited(frappe.ValidationError):
	"""The letter head's HTML was changed by hand after the builder wrote it."""

	http_status_code = 409


def _invalid(message: str):
	frappe.throw(message, RVInvalidInput)


def _band_label(band: str) -> str:
	return _("Header") if band == "header" else _("Footer")


def _only_keys(value: dict, allowed: set, where: str):
	unknown = sorted(set(value) - allowed)
	if unknown:
		_invalid(_("Unknown key {0} in {1}").format(unknown[0], where))


def _num(value, lo: float, hi: float, where: str, default: float) -> float:
	"""A number clamped to ``[lo, hi]`` (``default`` when missing), rounded to 0.01."""
	if value is None:
		return default
	if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
		_invalid(_("{0} must be a number").format(where))
	value = min(max(float(value), lo), hi)
	return int(value) if value == int(value) else round(value, 2)


def _choice(value, choices: tuple, where: str, default):
	if value is None:
		return default
	if value not in choices:
		_invalid(_("Invalid value {0} for {1}").format(frappe.as_unicode(value)[:40], where))
	return value


def _string(value, limit: int, where: str, default: str = "") -> str:
	if value is None:
		return default
	if not isinstance(value, str):
		_invalid(_("{0} must be a text").format(where))
	if len(value) > limit:
		_invalid(_("{0} is longer than {1} characters").format(where, limit))
	return value


def _hex(value, where: str, default: str | None = None) -> str:
	if value is None and default is not None:
		return default
	if not isinstance(value, str) or not _HEX.match(value):
		_invalid(_("Invalid colour {0} for {1}").format(frappe.as_unicode(value)[:20], where))
	return value.upper()


def _color(value, where: str, default: str) -> str:
	"""A colour of the layout (``primary``, ``text``, ``muted``) or ``#RRGGBB``."""
	if value is None:
		return default
	if value in COLOR_TOKENS:
		return value
	return _hex(value, where)


def _props(etype: str, props, where: str) -> dict:
	if props is None:
		props = {}
	if not isinstance(props, dict):
		_invalid(_("Invalid properties of {0}").format(where))
	if etype == "text":
		_only_keys(props, {"text", "dir"}, where)
		return {
			"text": _string(props.get("text"), MAX_TEXT, where),
			"dir": _choice(props.get("dir"), ("auto", "rtl", "ltr"), where, "auto"),
		}
	if etype == "field":
		_only_keys(props, {"token", "label", "hide_empty"}, where)
		token = props.get("token")
		if token not in TOKENS:
			_invalid(_("Unknown field {0} in {1}").format(frappe.as_unicode(token)[:40], where))
		hide = props.get("hide_empty", True)
		if not isinstance(hide, bool | int):
			_invalid(_("Invalid value {0} for {1}").format(frappe.as_unicode(hide)[:20], where))
		return {"token": token, "label": _string(props.get("label"), MAX_LABEL, where), "hide_empty": bool(hide)}
	if etype == "logo":
		_only_keys(props, set(), where)
		return {}
	if etype == "image":
		_only_keys(props, {"src", "fit"}, where)
		src = props.get("src")
		if not isinstance(src, str) or not _SRC.match(src) or "/../" in src or ".__" in src:
			_invalid(_("The image of {0} must be a public file (/files/…) or an asset (/assets/…)").format(where))
		return {"src": src, "fit": _choice(props.get("fit"), ("contain", "cover"), where, "contain")}
	if etype == "line":
		_only_keys(props, {"thick", "style"}, where)
		return {
			"thick": _num(props.get("thick"), 0.2, 3, where, 0.4),
			"style": _choice(props.get("style"), ("solid", "dashed", "double"), where, "solid"),
		}
	if etype == "band":
		_only_keys(props, {"fill", "radius"}, where)
		return {"fill": _color(props.get("fill"), where, "primary"), "radius": _num(props.get("radius"), 0, 10, where, 0)}
	if etype == "qr":
		_only_keys(props, {"source", "text"}, where)
		return {
			"source": _choice(props.get("source"), ("website", "text"), where, "website"),
			"text": _string(props.get("text"), MAX_QR_TEXT, where),
		}
	# page
	_only_keys(props, {"format"}, where)
	return {"format": _choice(props.get("format"), PAGE_FORMATS, where, "both")}


def _element(el, band: str, seen: set) -> dict:
	if not isinstance(el, dict):
		_invalid(_("Invalid element in the {0}").format(_band_label(band)))
	eid = el.get("id")
	if not isinstance(eid, str) or not _ID.match(eid):
		_invalid(_("Invalid element id {0}").format(frappe.as_unicode(eid)[:20]))
	if eid in seen:
		_invalid(_("Duplicate element id {0}").format(eid))
	seen.add(eid)
	where = _("element {0}").format(eid)
	_only_keys(el, ELEMENT_KEYS, where)
	etype = el.get("type")
	if etype not in DEFAULT_SIZE:
		_invalid(_("Unknown element type {0}").format(frappe.as_unicode(etype)[:20]))
	slot = el.get("slot")
	if slot is not None and slot not in SLOTS:
		_invalid(_("Invalid slot {0} of {1}").format(frappe.as_unicode(slot)[:20], where))
	style = el.get("style") or {}
	if not isinstance(style, dict):
		_invalid(_("Invalid style of {0}").format(where))
	_only_keys(style, STYLE_KEYS, where)
	dw, dh = DEFAULT_SIZE[etype]
	x = _num(el.get("x"), 0, REF_WIDTH, where, 0)
	w = _num(el.get("w"), 0, REF_WIDTH, where, dw)
	if slot is None and w == 0:
		# a free element without a width takes the rest of the band
		w = max(REF_WIDTH - x, 1)
	return {
		"id": eid,
		"type": etype,
		"slot": slot,
		"x": x,
		"y": _num(el.get("y"), 0, 80, where, 0),
		"w": w,
		"h": _num(el.get("h"), 0, 80, where, dh),
		"style": {
			"size": _num(style.get("size"), 6, 40, where, 9),
			"weight": _choice(style.get("weight"), WEIGHTS, where, 400),
			"color": _color(style.get("color"), where, "text"),
			"align": _choice(style.get("align"), ALIGNS, where, "start"),
			"gap": _num(style.get("gap"), 0, 10, where, 1),
		},
		"props": _props(etype, el.get("props"), where),
	}


def _band(value, band: str, seen: set) -> dict:
	spec = BANDS[band]
	label = _band_label(band)
	if value is None:
		value = {}
	if not isinstance(value, dict):
		_invalid(_("Invalid {0} in the layout").format(label))
	_only_keys(value, {"h", "pad_top", "slots", "elements"}, label)
	slots = value.get("slots")
	if slots is None:
		slots = dict(spec["slots"])
	if not isinstance(slots, dict):
		_invalid(_("Invalid slots of the {0}").format(label))
	_only_keys(slots, set(SLOTS), label)
	clean_slots = {s: _num(slots.get(s), 0, 70, label, 0 if slots else spec["slots"][s]) for s in SLOTS}
	if sum(clean_slots.values()) > 100:
		_invalid(_("The slots of the {0} are wider than 100%").format(label))
	elements = value.get("elements") or []
	if not isinstance(elements, list):
		_invalid(_("Invalid elements of the {0}").format(label))
	if len(elements) > MAX_ELEMENTS:
		_invalid(_("The {0} has more than {1} elements").format(label, MAX_ELEMENTS))
	lo, hi, default = spec["h"]
	plo, phi, pdefault = spec["pad_top"]
	return {
		"h": _num(value.get("h"), lo, hi, label, default),
		"pad_top": _num(value.get("pad_top"), plo, phi, label, pdefault),
		"slots": clean_slots,
		"elements": [_element(el, band, seen) for el in elements],
	}


def parse_layout(value) -> dict:
	"""A layout from the browser (JSON text or a dict, at most 64KB), validated."""
	if isinstance(value, str):
		if len(value.encode("utf-8")) > MAX_LAYOUT_BYTES:
			_invalid(_("The layout is larger than {0} KB").format(MAX_LAYOUT_BYTES // 1024))
		try:
			value = json.loads(value)
		except ValueError:
			_invalid(_("The layout is not valid JSON"))
	elif isinstance(value, dict):
		try:
			size = len(json.dumps(value).encode("utf-8"))
		except TypeError, ValueError:
			_invalid(_("The layout is not valid JSON"))
		if size > MAX_LAYOUT_BYTES:
			_invalid(_("The layout is larger than {0} KB").format(MAX_LAYOUT_BYTES // 1024))
	return validate_layout(value)


def validate_layout(layout) -> dict:
	"""A clean copy of ``layout`` (ADR-018, v1): defaults filled, numbers clamped to their
	ranges; an unknown key, type, token, slot or font, a bad id or colour, an image that is
	not a public file or an asset, or a text over its limit is refused (``RVInvalidInput``)."""
	if not isinstance(layout, dict):
		_invalid(_("Invalid letter head layout"))
	_only_keys(layout, {"v", "font", "colors", "header", "footer"}, _("the layout"))
	version = layout.get("v", LAYOUT_VERSION)
	if version != LAYOUT_VERSION or isinstance(version, bool):
		_invalid(_("Unsupported layout version {0}").format(frappe.as_unicode(version)[:10]))
	font = layout.get("font") or DEFAULT_FONT
	if not font_lib.get_font(font):
		_invalid(_("Font {0} is not available").format(frappe.as_unicode(font)[:60]))
	colors = layout.get("colors") or {}
	if not isinstance(colors, dict):
		_invalid(_("Invalid colours of the layout"))
	_only_keys(colors, set(COLOR_TOKENS), _("the colours"))
	seen = set()
	return {
		"v": LAYOUT_VERSION,
		"font": font,
		"colors": {k: _hex(colors.get(k), k, DEFAULT_COLORS[k]) for k in COLOR_TOKENS},
		"header": _band(layout.get("header"), "header", seen),
		"footer": _band(layout.get("footer"), "footer", seen),
	}


# ---------------------------------------------------------------------------- generation


def _n(value: float) -> str:
	"""A number for CSS: no trailing zeros."""
	return f"{value:.4f}".rstrip("0").rstrip(".") or "0"


def _pct(mm: float) -> str:
	return _n(mm / REF_WIDTH * 100) + "%"


def _text(value: str) -> str:
	"""Text from the layout as HTML that Jinja prints as it is: escaped, and its Jinja
	delimiters and the ``.__`` that ``render_template`` refuses turned into entities."""
	value = escape(value, quote=True).replace("{", "&#123;").replace("}", "&#125;")
	return value.replace(".__", "&#46;__")


def _jstr(value: str) -> str:
	"""A Jinja string literal of ``value``: anything but letters, digits and spaces as a
	``\\u`` escape, so no quote, delimiter or ``.__`` reaches the template."""
	out = []
	for ch in value:
		if ch.isalnum() or ch == " ":
			out.append(ch)
		elif ord(ch) > 0xFFFF:
			out.append(f"\\U{ord(ch):08x}")
		else:
			out.append(f"\\u{ord(ch):04x}")
	return '"' + "".join(out) + '"'


def _rgb(color: str, colors: dict) -> str:
	return colors.get(color, color)


def _band_uses(band: dict) -> set:
	"""What the band's template reads: ``company``, ``address``, ``name_ar``."""
	uses = set()
	for el in band["elements"]:
		if el["type"] == "logo":
			uses.add("company")
		elif el["type"] == "field":
			uses.add("company")
			token = el["props"]["token"]
			if token in ("address", "address_line1", "city"):
				uses.add("address")
			elif token == "company_name_ar":
				uses.add("name_ar")
	return uses


def _company_block(uses: set, company: str | None) -> str:
	"""The ``{% set %}`` lines that resolve the company (fixed, else ``doc.company``, else the
	default company) and read what the band prints."""
	if not uses:
		return ""
	if company:
		lines = [f"{{%- set _rvc = {_jstr(company)} -%}}"]
	else:
		lines = [
			"{%- set _rvc = (doc.company if doc is defined and doc else None) or "
			'frappe.db.get_single_value("Global Defaults", "default_company") -%}'
		]
	fields = ", ".join(f'"{f}"' for f in COMPANY_FIELDS)
	lines.append(
		f'{{%- set _rvo = (frappe.db.get_value("Company", _rvc, [{fields}], as_dict=True) if _rvc else None) or {{}} -%}}'
	)
	if "address" in uses:
		afields = ", ".join(f'"{f}"' for f in ADDRESS_FIELDS)
		lines.append(
			'{%- set _rva = (frappe.db.get_value("Address", [["Dynamic Link", "link_doctype", "=", "Company"], '
			f'["Dynamic Link", "link_name", "=", _rvc]], [{afields}], as_dict=True, '
			'order_by="is_your_company_address desc, is_primary_address desc") if _rvc else None) or {} -%}'
		)
	if "name_ar" in uses:
		lines.append(
			'{%- set _rvn = (frappe.db.get_value("Translation", {"source_text": _rvo.company_name, "language": "ar"}, '
			'"translated_text") if _rvo.company_name else None) or _rvo.company_name -%}'
		)
	return "\n".join(lines) + "\n"


def _token_expr(token: str) -> str:
	if token == "company_name_ar":
		return "_rvn"
	if token == "address":
		return (
			"[_rva.address_line1, _rva.address_line2, [_rva.city, _rva.state, _rva.pincode]|select|join(\", \"), "
			'_rva.country]|select|join("\\n")'
		)
	if token in ("address_line1", "city"):
		return f"_rva.{token}"
	return f"_rvo.{token}"


def _box(el: dict, colors: dict, free: bool) -> list[str]:
	"""The inline style of an element: its text style, and its place when free."""
	st = el["style"]
	css = [f"font-size:{_n(st['size'])}pt", f"font-weight:{st['weight']}", f"color:{_rgb(st['color'], colors)}"]
	if free:
		css += ["position:absolute", f"left:{_pct(el['x'])}", f"top:{_n(el['y'])}mm", f"width:{_pct(el['w'])}"]
		if el["h"] and el["type"] in ("text", "field", "page", "logo", "image"):
			css += [f"height:{_n(el['h'])}mm", "overflow:hidden"]
		css.append(f"text-align:{_free_align(el)}")
	else:
		css.append(f"margin:0 0 {_n(st['gap'])}mm")
	return css


def _el_dir(el: dict) -> str:
	if el["type"] == "text":
		return el["props"]["dir"]
	if el["type"] == "page" and el["props"]["format"] == "ar":
		return "rtl"
	return "ltr" if el["type"] == "page" else "auto"


def _free_align(el: dict) -> str:
	"""``start``/``end`` of a free element: right/left for a right-to-left text, else
	left/right."""
	align = el["style"]["align"]
	if align == "center":
		return "center"
	rtl = _el_dir(el) == "rtl"
	return ("right" if rtl else "left") if align == "start" else ("left" if rtl else "right")


def qr_svg(text: str, color: str = "#000000", size_mm: float | None = None) -> str:
	"""A QR code as an inline SVG (``pyqrcode``, a dependency of Frappe); sized in mm."""
	import pyqrcode

	code = pyqrcode.create(text, error="M", encoding="utf-8")
	buf = io.BytesIO()
	code.svg(buf, scale=1, omithw=True, xmldecl=False, quiet_zone=0, svgclass=None, lineclass=None, module_color=color)
	svg = buf.getvalue().decode("utf-8")
	style = f' style="display:inline-block;vertical-align:top;width:{_n(size_mm)}mm;height:{_n(size_mm)}mm"' if size_mm else ""
	return svg.replace("<svg ", f'<svg shape-rendering="crispEdges"{style} ', 1)


def _img(src_expr: str, w: float, h: float, free: bool, fit: str = "contain") -> str:
	"""An image that keeps its proportions inside ``w``×``h`` mm (``max-width``/
	``max-height``: QtWebKit has no ``object-fit``); ``cover`` fills the box as a
	background."""
	if fit == "cover":
		width = "100%" if free else f"{_n(w)}mm"
		return (
			f'<div style="display:inline-block;vertical-align:top;width:{width};height:{_n(h)}mm;'
			f"background-image:url('{src_expr}');background-position:center;background-repeat:no-repeat;"
			'-webkit-background-size:cover;background-size:cover"></div>'
		)
	max_w = "100%" if free else f"{_n(w)}mm"
	return (
		f'<img src="{src_expr}" alt="" style="display:inline-block;vertical-align:top;width:auto;height:auto;'
		f'max-width:{max_w};max-height:{_n(h)}mm">'
	)


def _qr_text(el: dict, website: str | None) -> str:
	if el["props"]["source"] == "text":
		return el["props"]["text"].strip()
	return (website or "").strip()


def _element_html(el: dict, colors: dict, free: bool, qr_website: str | None) -> str:
	etype, props = el["type"], el["props"]
	attrs = f'data-el="{el["id"]}"'
	css = _box(el, colors, free)
	if etype in ("logo", "image", "line", "band", "qr"):
		css.append("line-height:0")
		if not free:
			css.append("font-size:0")
	if etype == "text":
		lines = "<br>".join(_text(line) for line in props["text"].split("\n"))
		return f'<div {attrs} dir="{props["dir"]}" style="{";".join(css)}">{lines}</div>'
	if etype == "field":
		token = props["token"]
		label = _text(props["label"]).strip()
		bdi = '<bdi dir="ltr">' if token in LTR_TOKENS else "<bdi>"
		if token in MULTILINE_TOKENS:
			value = '{% for _l in _v.split("\\n") %}{{ _l|e }}{% if not loop.last %}<br>{% endif %}{% endfor %}'
		else:
			value = "{{ _v|e }}"
		body = f'<div {attrs} style="{";".join(css)}">{label + " " if label else ""}{bdi}{value}</bdi></div>'
		head = f'{{%- set _v = ({_token_expr(token)} or "")|string -%}}'
		if props["hide_empty"]:
			return f"{head}{{% if _v %}}{body}{{% endif %}}"
		return head + body
	if etype == "logo":
		img = _img("{{ _rvo.company_logo|e }}", el["w"], el["h"], free)
		cond = '_rvo.company_logo and (_rvo.company_logo.startswith("/files/") or _rvo.company_logo.startswith("/assets/"))'
		return f'{{% if {cond} %}}<div {attrs} style="{";".join(css)}">{img}</div>{{% endif %}}'
	if etype == "image":
		img = _img(_text(props["src"]), el["w"], el["h"], free, props["fit"])
		return f'<div {attrs} style="{";".join(css)}">{img}</div>'
	color = _rgb(el["style"]["color"], colors)
	if etype == "line":
		border = f"border-top:{_n(props['thick'])}mm {props['style']} {color}"
		if free:
			return f'<div {attrs} style="{";".join(css)};height:0;{border}"></div>'
		width = f"{_n(el['w'])}mm" if el["w"] else "100%"
		return f'<div {attrs} style="{";".join(css)}"><div style="display:inline-block;vertical-align:top;width:{width};height:0;{border}"></div></div>'
	if etype == "band":
		fill = f"background-color:{_rgb(props['fill'], colors)}"
		radius = f";border-radius:{_n(props['radius'])}mm" if props["radius"] else ""
		if free:
			return f'<div {attrs} style="{";".join(css)};height:{_n(el["h"])}mm;{fill}{radius}"></div>'
		width = f"{_n(el['w'])}mm" if el["w"] else "100%"
		return (
			f'<div {attrs} style="{";".join(css)}"><div style="display:inline-block;vertical-align:top;'
			f'width:{width};height:{_n(el["h"])}mm;{fill}{radius}"></div></div>'
		)
	if etype == "qr":
		text = _qr_text(el, qr_website)
		if not text:
			return ""
		size = el["h"] or el["w"]
		return f'<div {attrs} style="{";".join(css)}">{qr_svg(text, color, size)}</div>'
	# page number: Frappe's convention, filled by wkhtmltopdf, Chrome and the Pages
	en = 'Page <span class="page"></span> of <span class="topage"></span>'
	ar = "صفحة <span class=\"page\"></span> من <span class=\"topage\"></span>"
	body = {
		"en": f'<span dir="ltr">{en}</span>',
		"ar": f'<span dir="rtl">{ar}</span>',
		"both": f'<span dir="ltr">{en}</span> | <span dir="rtl">{ar}</span>',
	}[props["format"]]
	return f'<div {attrs} dir="{_el_dir(el)}" style="{";".join(css)}">{body}</div>'


# A site's Print Style may set a font on ``.letter-head *`` (every element of the letter
# head): the elements of the band inherit the band's font instead, as the builder draws them.
FONT_INHERIT = ".rvlh[data-rv-lh] *{font-family:inherit}"


def font_style(layout: dict) -> str:
	"""The ``<style>`` of a band: the ``@font-face`` rules of the layout's font only, for the
	weights its elements use (core/fonts.py ``print_weights``), with absolute urls (Jinja, the
	site's own address when it prints; none for a font of the server), and the rule that keeps
	that font on every element of the band."""
	used = {400} | {el["style"]["weight"] for b in ("header", "footer") for el in layout[b]["elements"]}
	weights = font_lib.print_weights(layout["font"], used)
	return f"<style>{font_lib.font_face_css(layout['font'], FONT_BASE, weights)}{FONT_INHERIT}</style>"


SLOT_PLACE = {
	"right": ("rtl", "right:0", "right"),
	"left": ("ltr", "left:0", "left"),
	"center": ("auto", None, "center"),
}


def _band_html(layout: dict, band: str, company: str | None, qr_website: str | None) -> str:
	spec = layout[band]
	if band == "footer" and not spec["h"]:
		return ""
	colors = layout["colors"]
	h = _n(spec["h"])
	root = (
		f'<div class="rvlh" data-rv-lh="{band}" data-h="{h}" dir="ltr" style="position:relative;width:100%;'
		f"height:{h}mm;overflow:hidden;box-sizing:border-box;font-family:{font_lib.font_stack(layout['font'])};"
		f'color:{colors["text"]};line-height:1.35;-webkit-print-color-adjust:exact;print-color-adjust:exact">'
	)
	out = [f"<!-- rv-lh v{LAYOUT_VERSION} {band} h={h} -->", font_style(layout), _company_block(_band_uses(spec), company) + root]
	for slot in SLOTS:
		width = spec["slots"][slot]
		items = [el for el in spec["elements"] if el["slot"] == slot]
		if not width or not items:
			continue
		direction, place, align = SLOT_PLACE[slot]
		if place is None:
			place = f"left:50%;margin-left:-{_n(width / 2)}%"
		out.append(
			f'<div data-slot="{slot}" dir="{direction}" style="position:absolute;top:{_n(spec["pad_top"])}mm;'
			# 1mm inside its edges: a glyph past the slot (Arabic letters) is not cut by the band
			f'{place};width:{_n(width)}%;padding:0 1mm;box-sizing:border-box;text-align:{align}">'
		)
		out += [_element_html(el, colors, False, qr_website) for el in items]
		out.append("</div>")
	out += [_element_html(el, colors, True, qr_website) for el in spec["elements"] if el["slot"] is None]
	out.append("</div>")
	return "\n".join(part for part in out if part)


def company_website(company: str | None) -> str | None:
	company = company or frappe.db.get_single_value("Global Defaults", "default_company")
	return frappe.db.get_value("Company", company, "website") if company else None


def generate(layout: dict, company: str | None = None, qr_company: str | None = None) -> dict:
	"""``{"header", "footer"}``: the Jinja templates of a validated layout (ADR-018's HTML
	contract). ``company`` is the fixed company of the letter head (empty: the document's,
	else the default company, resolved when it prints). A QR code is drawn now, not at
	print time: its website is that of ``company``, else of ``qr_company`` (the company the
	builder previews), else of the default company."""
	website = None
	if any(el["type"] == "qr" for b in ("header", "footer") for el in layout[b]["elements"]):
		website = company_website(company or qr_company)
	return {
		"header": _band_html(layout, "header", company, website),
		"footer": _band_html(layout, "footer", company, website),
	}


def content_hash(header: str | None, footer: str | None) -> str:
	"""What ``generated_hash`` stores: the letter head's HTML as the builder wrote it."""
	return hashlib.sha256(f"{header or ''}\x00{footer or ''}".encode()).hexdigest()


def layout_warnings(layout: dict, company: dict | None) -> list[str]:
	"""What prints otherwise than the builder draws: elements in a closed slot or outside
	their band, a private or missing logo, a QR code without a website. ``company`` is the
	previewed company's record (``company_logo``, ``website``)."""
	company = company or {}
	out = []
	for band in ("header", "footer"):
		spec = layout[band]
		for el in spec["elements"]:
			if el["slot"] and not spec["slots"][el["slot"]]:
				out.append(_("Element {0} is in a closed slot and is not printed").format(el["id"]))
			elif el["slot"] is None and el["y"] >= spec["h"]:
				out.append(_("Element {0} is outside the {1}").format(el["id"], _band_label(band)))
			if el["type"] == "logo":
				logo = company.get("company_logo") or ""
				if not logo:
					out.append(_("The company has no logo"))
				elif not logo.startswith(("/files/", "/assets/")):
					out.append(_("The company logo is a private file: it is not printed. Make the file public."))
			if el["type"] == "qr" and el["props"]["source"] == "website" and not company.get("website"):
				out.append(_("The company has no website: the QR code is not printed"))
			if el["type"] == "qr" and el["props"]["source"] == "text" and not el["props"]["text"].strip():
				out.append(_("Element {0}: the QR code has no text").format(el["id"]))
	return list(dict.fromkeys(out))


def print_format_css(layout: dict) -> str:
	"""The rule a print format needs with wkhtmltopdf and "Repeat Header and Footer": it
	does not measure the letter head, it puts it in the page margin. Measured on Frappe 16
	(ADR-018, server notes): Frappe's header page adds 15mm to the header (its padding), and
	the footer page adds Frappe's own page number line, so 10mm."""
	css = f".print-format {{ margin-top: {_n(layout['header']['h'] + 15)}mm;"
	if layout["footer"]["h"]:
		css += f" margin-bottom: {_n(layout['footer']['h'] + 10)}mm;"
	return css + " }"


BAND_HEIGHT = re.compile(r'data-rv-lh="(header|footer)" data-h="([0-9.]+)"')
FORMAT_MARGIN = re.compile(r"\.print-format\s*\{[^}]*margin-(top|bottom)", re.I)


def pdf_body_html(jenv, template, print_format, args):
	"""Hook `pdf_body_html` (ADR-018): the print page as Frappe renders it, plus, for a PDF
	made by wkhtmltopdf with "Repeat Header and Footer", the page margins a builder letter
	head needs. wkhtmltopdf does not measure the header; it reads the margins from a
	`.print-format` rule of the page (frappe/utils/pdf.py, read_options_from_html). A format
	that sets its own margin keeps it; a letter head not made by the builder is left alone."""
	hooks = frappe.get_hooks("pdf_body_html")
	mine = "report_view.core.letterhead.pdf_body_html"
	previous = [h for h in hooks if h != mine][-1]
	html = frappe.get_attr(previous)(jenv=jenv, template=template, print_format=print_format, args=args)
	if frappe.local.form_dict.get("pdf_generator") != "wkhtmltopdf" or args.get("no_letterhead"):
		return html
	settings = args.get("print_settings") or {}
	if not settings.get("repeat_header_footer"):
		return html
	heights = dict(BAND_HEIGHT.findall((args.get("letter_head") or "") + (args.get("footer") or "")))
	if not heights:
		return html
	taken = {side.lower() for side in FORMAT_MARGIN.findall(html)}
	rules = []
	if "header" in heights and "top" not in taken:
		rules.append(f"margin-top: {_n(float(heights['header']) + 15)}mm")
	if float(heights.get("footer") or 0) and "bottom" not in taken:
		rules.append(f"margin-bottom: {_n(float(heights['footer']) + 10)}mm")
	return html + (f"<style>.print-format {{ {'; '.join(rules)}; }}</style>" if rules else "")
