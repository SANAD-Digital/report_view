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
from report_view.core.contract import CONTRACT
from report_view.core.errors import RVInvalidInput

# the layout contract (letterhead_contract.json, core/contract.py): model.js reads the same
C = CONTRACT
LIMITS = C["limits"]
LAYOUT_VERSION = C["version"]
MAX_LAYOUT_BYTES = LIMITS["layout_bytes"]
MAX_ELEMENTS = LIMITS["elements"]
MAX_TEXT = LIMITS["text"]
MAX_LABEL = LIMITS["label"]
MAX_QR_TEXT = LIMITS["qr_text"]
# x and w are millimetres on this width (A4 portrait less 15mm margins) and print as
# percentages of the band, so a design fits any paper width
REF_WIDTH = C["ref_width"]

# the font library (core/fonts.py, report_view/fonts.json)
FONTS = font_lib.families()
DEFAULT_FONT = font_lib.DEFAULT_FONT
# the @font-face urls of the letter head: absolute, so every print path finds the files
# (print view, wkhtmltopdf, Chrome, the Pages and their PDF engine)
FONT_BASE = "{{ frappe.utils.get_url('" + font_lib.ASSET_BASE + "')|e }}"
DEFAULT_COLORS = dict(C["default_colors"])
SLOTS = tuple(C["slots"])
# band: (min, max, default) of h and pad_top, and the default slot widths (%)
BANDS = {
	band: {
		"h": (*spec["h"], spec["default"]["h"]),
		"pad_top": (*spec["pad_top"], spec["default"]["pad_top"]),
		"slots": dict(spec["default"]["slots"]),
	}
	for band, spec in C["bands"].items()
}
TOKENS = tuple(C["tokens"])
# values printed left-to-right inside a right-to-left slot
LTR_TOKENS = frozenset(C["ltr_tokens"])
MULTILINE_TOKENS = frozenset(C["multiline_tokens"])
COMPANY_FIELDS = (
	"company_name",
	"abbr",
	"tax_id",
	"phone_no",
	"fax",
	"email",
	"website",
	"registration_details",
	"country",
	"company_logo",
)
ADDRESS_FIELDS = ("address_line1", "address_line2", "city", "state", "pincode", "country")
TYPES = tuple(C["types"])
# drawn as a box of w x h; the textual ones carry a text style
BOXED = frozenset(C["boxed"])
TEXTUAL = frozenset(C["textual"])
# what a new element of a type starts with, and what a missing value of it becomes
ELEMENT_DEFAULTS = C["element_defaults"]
WEIGHTS = tuple(C["weights"])
ALIGNS = tuple(C["aligns"])
COLOR_TOKENS = tuple(C["color_names"])
CHOICES = {k: tuple(v) for k, v in C["choices"].items()}
PAGE_FORMATS = CHOICES["page.format"]
CORNERS = tuple(C["corners"])

_ID = re.compile(r"^[a-z0-9]{1,12}$")
_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
# a public file or an asset; no quote, bracket, backslash or control character (it prints
# in an attribute and in a CSS url()), no parent segment
_SRC = re.compile(C["image_src"])
# the first strong character decides the direction of a text (render.js is_rtl_text)
_STRONG = re.compile(f"[{C['rtl_chars']}]|[{C['ltr_chars']}]")
_RTL = re.compile(f"[{C['rtl_chars']}]")
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
	d = ELEMENT_DEFAULTS[etype]["props"]
	if etype == "text":
		_only_keys(props, {"text", "dir"}, where)
		return {
			"text": _string(props.get("text"), MAX_TEXT, where),
			"dir": _choice(props.get("dir"), CHOICES["text.dir"], where, d["dir"]),
		}
	if etype == "field":
		_only_keys(props, {"token", "label", "hide_empty"}, where)
		token = props.get("token")
		if token not in TOKENS:
			_invalid(_("Unknown field {0} in {1}").format(frappe.as_unicode(token)[:40], where))
		hide = props.get("hide_empty", d["hide_empty"])
		if not isinstance(hide, bool | int):
			_invalid(_("Invalid value {0} for {1}").format(frappe.as_unicode(hide)[:20], where))
		return {
			"token": token,
			"label": _string(props.get("label"), MAX_LABEL, where),
			"hide_empty": bool(hide),
		}
	if etype == "logo":
		_only_keys(props, set(), where)
		return {}
	if etype == "image":
		_only_keys(props, {"src", "fit"}, where)
		src = props.get("src")
		if not isinstance(src, str) or not _SRC.match(src) or "/../" in src or ".__" in src:
			_invalid(
				_("The image of {0} must be a public file (/files/…) or an asset (/assets/…)").format(where)
			)
		return {"src": src, "fit": _choice(props.get("fit"), CHOICES["image.fit"], where, d["fit"])}
	if etype == "line":
		_only_keys(props, {"thick", "style"}, where)
		return {
			"thick": _num(props.get("thick"), *LIMITS["thick"], where, d["thick"]),
			"style": _choice(props.get("style"), CHOICES["line.style"], where, d["style"]),
		}
	if etype == "band":
		_only_keys(props, {"fill", "radius", "corners"}, where)
		return {
			"fill": _color(props.get("fill"), where, d["fill"]),
			"radius": _num(props.get("radius"), *LIMITS["radius"], where, d["radius"]),
			"corners": _corners(props.get("corners"), where),
		}
	if etype == "qr":
		_only_keys(props, {"source", "text"}, where)
		return {
			"source": _choice(props.get("source"), CHOICES["qr.source"], where, d["source"]),
			"text": _string(props.get("text"), MAX_QR_TEXT, where),
		}
	# page
	_only_keys(props, {"format"}, where)
	return {"format": _choice(props.get("format"), PAGE_FORMATS, where, d["format"])}


def _r(value: float) -> float:
	"""A computed millimetre value as the layout keeps it: 0.01, no float noise."""
	value = round(value, 2)
	return int(value) if value == int(value) else value


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
	if etype not in TYPES:
		_invalid(_("Unknown element type {0}").format(frappe.as_unicode(etype)[:20]))
	slot = el.get("slot")
	if slot is not None and slot not in SLOTS:
		_invalid(_("Invalid slot {0} of {1}").format(frappe.as_unicode(slot)[:20], where))
	style = el.get("style") or {}
	if not isinstance(style, dict):
		_invalid(_("Invalid style of {0}").format(where))
	_only_keys(style, STYLE_KEYS, where)
	d = ELEMENT_DEFAULTS[etype]
	ds = d["style"]
	x = _num(el.get("x"), *LIMITS["x"], where, 0)
	y = _num(el.get("y"), *LIMITS["y"], where, 0)
	w = _num(el.get("w"), *LIMITS["w"], where, d["w"])
	h = _num(el.get("h"), *LIMITS["h"], where, d["h"])
	# the same rules as model.js clamp_element: a box always has a size
	if etype in BOXED:
		w, h = w or d["w"], h or d["h"]
	if slot is None:
		# a free element can always be grabbed and stays within the band's width
		w = max(w or d["w"] or LIMITS["free_w"], LIMITS["min_w"])
		x = _r(min(x, REF_WIDTH - w))
		if h:
			h = max(h, LIMITS["min_h"])
	else:
		x = y = 0
	return {
		"id": eid,
		"type": etype,
		"slot": slot,
		"x": x,
		"y": y,
		"w": w,
		"h": h,
		"style": {
			"size": _num(style.get("size"), *LIMITS["size"], where, ds["size"]),
			"weight": _choice(style.get("weight"), WEIGHTS, where, ds["weight"]),
			"color": _color(style.get("color"), where, ds["color"]),
			"align": _choice(style.get("align"), ALIGNS, where, ds["align"]),
			"gap": _num(style.get("gap"), *LIMITS["gap"], where, ds["gap"]),
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
		slots = {}
	if not isinstance(slots, dict):
		_invalid(_("Invalid slots of the {0}").format(label))
	_only_keys(slots, set(SLOTS), label)
	# a slot left out keeps its default width (model.js clamp_slots)
	clean_slots = {s: _num(slots.get(s), *LIMITS["slot"], label, spec["slots"][s]) for s in SLOTS}
	if sum(clean_slots.values()) > LIMITS["slots_sum"]:
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


def _corners(value, where: str) -> str:
	"""The rounded corners of a colour band: "all", or some of tl, tr, br, bl (physical,
	the band is placed by left/right) in that order, comma separated."""
	if value in (None, "", "all"):
		return "all"
	parts = value.split(",") if isinstance(value, str) else None
	if not parts or any(p not in CORNERS for p in parts):
		_invalid(_("Invalid corners in {0}").format(where))
	picked = [c for c in CORNERS if c in parts]
	return "all" if len(picked) == 4 else ",".join(picked)


def _band_radius(props: dict) -> str:
	r = f"{_n(props['radius'])}mm"
	if props["corners"] == "all":
		return r
	on = props["corners"].split(",")
	return " ".join(r if c in on else "0" for c in CORNERS)


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
			'[_rva.address_line1, _rva.address_line2, [_rva.city, _rva.state, _rva.pincode]|select|join(", "), '
			'_rva.country]|select|join("\\n")'
		)
	if token in ("address_line1", "city"):
		return f"_rva.{token}"
	return f"_rvo.{token}"


def is_rtl_text(value: str | None) -> bool:
	"""The first strong character is right-to-left (render.js ``is_rtl_text``)."""
	m = _STRONG.search(value or "")
	return bool(m and _RTL.match(m.group()))


def _ranges(spec: str) -> list[tuple[str, str]]:
	"""The ``a-b`` ranges of a character class of the contract (``rtl_chars``, ``ltr_chars``)."""
	chars = spec.encode("ascii").decode("unicode_escape")
	return [(chars[i], chars[i + 2]) for i in range(0, len(chars), 3)]


def _jinja_ranges(spec: str) -> str:
	return " or ".join(f'"\\u{ord(a):04x}" <= _c <= "\\u{ord(b):04x}"' for a, b in _ranges(spec))


# The direction of a value known only when it prints (a company field without a label): the
# same test as is_rtl_text, in core Jinja (a loop over its characters; the first strong one
# wins). Sets ``_rd`` to "rtl" or "ltr".
_JINJA_DIR = (
	'{%- set _rdn = namespace(d="") -%}{%- for _c in _v -%}{%- if not _rdn.d -%}'
	f'{{%- if {_jinja_ranges(C["rtl_chars"])} -%}}{{%- set _rdn.d = "rtl" -%}}'
	f'{{%- elif {_jinja_ranges(C["ltr_chars"])} -%}}{{%- set _rdn.d = "ltr" -%}}'
	"{%- endif -%}{%- endif -%}{%- endfor -%}"
	'{%- set _rd = "rtl" if _rdn.d == "rtl" else "ltr" -%}'
)


def _content_dir(el: dict) -> str | None:
	"""The direction of an element's own content, for the alignment of a free element
	(render.js ``content_dir``): ``None`` when it depends on the printed value."""
	etype, props = el["type"], el["props"]
	if etype == "text":
		if props["dir"] != "auto":
			return props["dir"]
		return "rtl" if is_rtl_text(props["text"]) else "ltr"
	if etype == "field":
		if props["token"] in LTR_TOKENS or props["label"]:
			return "rtl" if is_rtl_text(props["label"]) else "ltr"
		return None
	if etype == "page":
		return "ltr" if props["format"] == "en" else "rtl"
	return "ltr"


def _physical_align(align: str, rtl: bool) -> str:
	"""``start``/``end`` as right/left for a right-to-left content, else left/right."""
	if align == "center":
		return "center"
	return "right" if (align == "start") == rtl else "left"


def _page_dir(el: dict) -> str:
	return "rtl" if el["props"]["format"] == "ar" else "ltr"


def _text_style(el: dict, colors: dict) -> list[str]:
	st = el["style"]
	return [
		f"font-size:{_n(st['size'])}pt",
		f"font-weight:{st['weight']}",
		f"color:{_rgb(st['color'], colors)}",
	]


def _line_thick(props: dict) -> float:
	"""A double rule needs some thickness to show its two lines (the editor draws the same)."""
	return max(props["thick"], LIMITS["double_line_min"]) if props["style"] == "double" else props["thick"]


def _band_fill(props: dict, colors: dict) -> str:
	fill = f"background-color:{_rgb(props['fill'], colors)}"
	return fill + (f";border-radius:{_band_radius(props)}" if props["radius"] else "")


def _box(el: dict, colors: dict, free: bool, align: str | None) -> list[str]:
	"""The inline style of an element's wrapper (render.js ``slotted``/``free``): in a slot it
	flows under the one before it; free, it is placed and sized in mm (x and w in % of the
	band). ``align``: the physical text-align of a free textual element (a Jinja expression
	when it depends on the printed value)."""
	etype = el["type"]
	if not free:
		gap = f"margin:0 0 {_n(el['style']['gap'])}mm"
		return [*_text_style(el, colors), gap] if etype in TEXTUAL else [gap, "line-height:0"]
	css = ["position:absolute", f"left:{_pct(el['x'])}", f"top:{_n(el['y'])}mm", f"width:{_pct(el['w'])}"]
	if etype == "band":
		css += [f"height:{_n(el['h'])}mm", _band_fill(el["props"], colors)]
	elif etype in BOXED:
		css += [f"height:{_n(el['h'])}mm", "line-height:0"]
	elif etype == "line":
		css.append("line-height:0")
	else:
		if el["h"]:
			css += [f"height:{_n(el['h'])}mm", "overflow:hidden"]
		css += [*_text_style(el, colors), f"text-align:{align}"]
	return css


def qr_svg(text: str, color: str = "#000000", size_mm: float | None = None) -> str:
	"""A QR code as an inline SVG (``pyqrcode``, a dependency of Frappe); sized in mm."""
	import pyqrcode

	code = pyqrcode.create(text, error="M", encoding="utf-8")
	buf = io.BytesIO()
	code.svg(
		buf,
		scale=1,
		omithw=True,
		xmldecl=False,
		quiet_zone=0,
		svgclass=None,
		lineclass=None,
		module_color=color,
	)
	svg = buf.getvalue().decode("utf-8")
	style = (
		f' style="display:inline-block;vertical-align:top;width:{_n(size_mm)}mm;height:{_n(size_mm)}mm"'
		if size_mm
		else ""
	)
	return svg.replace("<svg ", f'<svg shape-rendering="crispEdges"{style} ', 1)


def _img(src_expr: str, w: float, h: float, free: bool, fit: str = "contain") -> str:
	"""An image that keeps its proportions inside ``w`` by ``h`` mm (``max-width``/
	``max-height``: QtWebKit has no ``object-fit``); ``cover`` fills the box as a
	background."""
	width = "100%" if free else f"{_n(w)}mm"
	if fit == "cover":
		return (
			f'<div style="display:inline-block;vertical-align:top;width:{width};height:{_n(h)}mm;'
			f"background-image:url('{src_expr}');background-position:center;background-repeat:no-repeat;"
			'-webkit-background-size:cover;background-size:cover"></div>'
		)
	return (
		f'<img src="{src_expr}" alt="" style="display:inline-block;vertical-align:top;width:auto;height:auto;'
		f'max-width:{width};max-height:{_n(h)}mm">'
	)


def _qr_text(el: dict, website: str | None) -> str:
	if el["props"]["source"] == "text":
		return el["props"]["text"].strip()
	return (website or "").strip()


def qr_size(el: dict) -> float:
	"""A QR code is square: the smaller side of its box."""
	return min(el["w"], el["h"]) if el["w"] and el["h"] else el["h"] or el["w"]


def _element_html(el: dict, colors: dict, free: bool, qr_website: str | None) -> str:
	etype, props = el["type"], el["props"]
	attrs = f'data-el="{el["id"]}"'
	if etype == "text":
		if not props["text"]:
			return ""
		direction = _content_dir(el) if free else props["dir"]
		css = _box(el, colors, free, _physical_align(el["style"]["align"], direction == "rtl"))
		lines = "<br>".join(_text(line) for line in props["text"].split("\n"))
		return f'<div {attrs} dir="{direction}" style="{";".join(css)}">{lines}</div>'
	if etype == "field":
		token = props["token"]
		label = _text(props["label"]).strip()
		bdi = '<bdi dir="ltr">' if token in LTR_TOKENS else "<bdi>"
		if token in MULTILINE_TOKENS:
			value = (
				'{% for _l in _v.split("\\n") %}{{ _l|e }}{% if not loop.last %}<br>{% endif %}{% endfor %}'
			)
		else:
			value = "{{ _v|e }}"
		head = f'{{%- set _v = ({_token_expr(token)} or "")|string|trim -%}}'
		dir_attr = ""
		align = None
		if free:
			direction = _content_dir(el)
			if direction is None:
				# known when it prints: from the value itself
				head += _JINJA_DIR
				a = el["style"]["align"]
				align = "center" if a == "center" else "{{ _ra|e }}"
				if a != "center":
					right_if = "rtl" if a == "start" else "ltr"
					head += f'{{%- set _ra = "right" if _rd == "{right_if}" else "left" -%}}'
				dir_attr = ' dir="{{ _rd|e }}"'
			else:
				align = _physical_align(el["style"]["align"], direction == "rtl")
				dir_attr = f' dir="{direction}"'
		css = _box(el, colors, free, align)
		body = f'<div {attrs}{dir_attr} style="{";".join(css)}">{label + " " if label else ""}{bdi}{value}</bdi></div>'
		if props["hide_empty"]:
			return f"{head}{{% if _v %}}{body}{{% endif %}}"
		return head + body
	css = _box(el, colors, free, None)
	if etype == "logo":
		img = _img("{{ _rvo.company_logo|e }}", el["w"], el["h"], free)
		cond = '_rvo.company_logo and (_rvo.company_logo.startswith("/files/") or _rvo.company_logo.startswith("/assets/"))'
		return f'{{% if {cond} %}}<div {attrs} style="{";".join(css)}">{img}</div>{{% endif %}}'
	if etype == "image":
		img = _img(_text(props["src"]), el["w"], el["h"], free, props["fit"])
		return f'<div {attrs} style="{";".join(css)}">{img}</div>'
	color = _rgb(el["style"]["color"], colors)
	if etype == "line":
		width = "100%" if free or not el["w"] else f"{_n(el['w'])}mm"
		rule = f"display:inline-block;vertical-align:top;width:{width};height:0;border-top:{_n(_line_thick(props))}mm {props['style']} {color}"
		return f'<div {attrs} style="{";".join(css)}"><div style="{rule}"></div></div>'
	if etype == "band":
		if free:
			return f'<div {attrs} style="{";".join(css)}"></div>'
		width = f"{_n(el['w'])}mm" if el["w"] else "100%"
		box = f"display:inline-block;vertical-align:top;width:{width};height:{_n(el['h'])}mm;{_band_fill(props, colors)}"
		return f'<div {attrs} style="{";".join(css)}"><div style="{box}"></div></div>'
	if etype == "qr":
		text = _qr_text(el, qr_website)
		if not text:
			return ""
		return f'<div {attrs} style="{";".join(css)}">{qr_svg(text, color, qr_size(el))}</div>'
	# page number: Frappe's convention, filled by wkhtmltopdf, Chrome and the Pages
	if free:
		css = _box(el, colors, True, _physical_align(el["style"]["align"], _content_dir(el) == "rtl"))
	en = 'Page <span class="page"></span> of <span class="topage"></span>'
	ar = 'صفحة <span class="page"></span> من <span class="topage"></span>'
	body = {
		"en": f'<span dir="ltr">{en}</span>',
		"ar": f'<span dir="rtl">{ar}</span>',
		"both": f'<span dir="ltr">{en}</span> | <span dir="rtl">{ar}</span>',
	}[props["format"]]
	return f'<div {attrs} dir="{_page_dir(el)}" style="{";".join(css)}">{body}</div>'


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
	out = [
		f"<!-- rv-lh v{LAYOUT_VERSION} {band} h={h} -->",
		font_style(layout),
		_company_block(_band_uses(spec), company) + root,
	]
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
	their band (below it, or running past its bottom edge), a private or missing logo, a QR
	code without a website. ``company`` is the previewed company's record
	(``company_logo``, ``website``)."""
	company = company or {}
	out = []
	for band in ("header", "footer"):
		spec = layout[band]
		for el in spec["elements"]:
			if el["slot"] and not spec["slots"][el["slot"]]:
				out.append(_("Element {0} is in a closed slot and is not printed").format(el["id"]))
			elif el["slot"] is None and el["y"] >= spec["h"]:
				out.append(_("Element {0} is outside the {1}").format(el["id"], _band_label(band)))
			elif el["slot"] is None and (
				el["y"] + el["h"] > spec["h"] + 0.01 or el["x"] + el["w"] > REF_WIDTH + 0.01
			):
				out.append(
					_("Element {0} runs past the edge of the {1}: it is cut off in print").format(
						el["id"], _band_label(band)
					)
				)
			if el["type"] == "logo":
				logo = company.get("company_logo") or ""
				if not logo:
					out.append(_("The company has no logo"))
				elif not logo.startswith(("/files/", "/assets/")):
					out.append(
						_("The company logo is a private file: it is not printed. Make the file public.")
					)
			if el["type"] == "qr" and el["props"]["source"] == "website" and not company.get("website"):
				out.append(_("The company has no website: the QR code is not printed"))
			if el["type"] == "qr" and el["props"]["source"] == "text" and not el["props"]["text"].strip():
				out.append(_("Element {0}: the QR code has no text").format(el["id"]))
	return list(dict.fromkeys(out))


def page_margins(header_h: float, footer_h: float) -> dict:
	"""The page margins wkhtmltopdf needs with "Repeat Header and Footer" around a builder
	letter head: it does not measure the letter head, it puts it in the page margin. Measured
	on Frappe 16 (ADR-018, server notes): Frappe's header page adds 15mm to the header (its
	padding), and the footer page adds Frappe's own page number line, so 10mm."""
	extra = C["margins"]
	return {
		"top": _r(header_h + extra["header_extra"]),
		"bottom": _r(footer_h + extra["footer_extra"]) if footer_h else None,
	}


def print_format_css(layout: dict) -> str:
	"""The ``.print-format`` margins of a layout as CSS: what ``pdf_body_html`` adds by
	itself; a print format that sets its own ``.print-format`` margin needs this line."""
	m = page_margins(layout["header"]["h"], layout["footer"]["h"])
	css = f".print-format {{ margin-top: {_n(m['top'])}mm;"
	if m["bottom"]:
		css += f" margin-bottom: {_n(m['bottom'])}mm;"
	return css + " }"


BAND_HEIGHT = re.compile(r'data-rv-lh="(header|footer)" data-h="([0-9.]+)"')
FORMAT_MARGIN = re.compile(r"\.print-format\s*\{[^}]*margin-(top|bottom)", re.I)
HOOK = "report_view.core.letterhead.pdf_body_html"
FRAPPE_HOOK = "frappe.utils.pdf.pdf_body_html"


def previous_pdf_body_html() -> str:
	"""The ``pdf_body_html`` hook this one wraps: the one of the app installed before Report
	View (Frappe's own, unless another app sets it too)."""
	hooks = frappe.get_hooks("pdf_body_html") or []
	before = hooks[: hooks.index(HOOK)] if HOOK in hooks else [h for h in hooks if h != HOOK]
	return before[-1] if before else FRAPPE_HOOK


def check_pdf_body_html_hook() -> bool:
	"""``pdf_body_html`` is a last-app-wins hook (frappe/www/printview.py takes the last one):
	an app installed after Report View that sets it replaces this one, and builder letter
	heads lose their wkhtmltopdf margins. Logs a warning then; True when this one is used."""
	hooks = frappe.get_hooks("pdf_body_html") or []
	if hooks and hooks[-1] != HOOK:
		frappe.logger("report_view").warning(
			"pdf_body_html: %s overrides Report View's hook; builder letter heads get no automatic "
			"wkhtmltopdf margins unless it calls the previous hook (ADR-018)",
			hooks[-1],
		)
		return False
	return True


def pdf_body_html(jenv, template, print_format, args):
	"""Hook `pdf_body_html` (ADR-018): the print page as the previous hook renders it
	(Frappe's), plus, for a PDF made by wkhtmltopdf with "Repeat Header and Footer", the page
	margins a builder letter head needs. wkhtmltopdf does not measure the header; it reads
	the margins from a `.print-format` rule of the page (frappe/utils/pdf.py,
	read_options_from_html). A format that sets its own margin keeps it; a letter head not
	made by the builder is left alone, and every other print is the previous hook's, as it is."""
	html = frappe.get_attr(previous_pdf_body_html())(
		jenv=jenv, template=template, print_format=print_format, args=args
	)
	if frappe.local.form_dict.get("pdf_generator") != "wkhtmltopdf" or args.get("no_letterhead"):
		return html
	settings = args.get("print_settings") or {}
	if not settings.get("repeat_header_footer"):
		return html
	heights = dict(BAND_HEIGHT.findall((args.get("letter_head") or "") + (args.get("footer") or "")))
	if not heights:
		return html
	taken = {side.lower() for side in FORMAT_MARGIN.findall(html)}
	m = page_margins(float(heights.get("header") or 0), float(heights.get("footer") or 0))
	rules = []
	if "header" in heights and "top" not in taken:
		rules.append(f"margin-top: {_n(m['top'])}mm")
	if m["bottom"] and "bottom" not in taken:
		rules.append(f"margin-bottom: {_n(m['bottom'])}mm")
	return html + (f"<style>.print-format {{ {'; '.join(rules)}; }}</style>" if rules else "")


# ---------------------------------------------------------------------------- the records


def keep_builder_source(doc, method=None):
	"""Letter Head ``before_insert`` (doc_events): Frappe makes every new letter head an image
	one; a letter head the builder inserts (``flags.rv_builder``) stays HTML, so it is
	written once."""
	if doc.flags.rv_builder:
		doc.source = doc.footer_source = "HTML"


def delete_layout(doc, method=None):
	"""Letter Head ``on_trash`` (doc_events): its builder layout goes with it (it links to the
	letter head, which could not be deleted otherwise)."""
	for name in frappe.get_list("Letter Head Layout", filters={"letter_head": doc.name}, pluck="name"):
		frappe.delete_doc("Letter Head Layout", name)


def write_letter_head(lh, layout: dict, company: str | None = None, qr_company: str | None = None) -> str:
	"""Writes the HTML of a validated ``layout`` into the Letter Head document ``lh`` (new or
	existing; saved with the user's permissions) and returns its ``content_hash``."""
	html = generate(layout, company, qr_company=qr_company)
	lh.content, lh.footer = html["header"], html["footer"]
	lh.source = lh.footer_source = "HTML"
	meta = frappe.get_meta("Letter Head")
	for field, value in (("header_height", layout["header"]["h"]), ("footer_height", layout["footer"]["h"])):
		if meta.has_field(field):
			lh.set(field, value)
	if lh.is_new():
		lh.flags.rv_builder = True
		lh.insert()
		if lh.source != "HTML" or lh.footer_source != "HTML":
			# the doc_event keep_builder_source is not active: Letter Head.before_insert made it
			# an image letter head (and said it has no image), so it is set back to HTML
			_drop_message(_("Please attach an image file to set HTML for Letter Head."))
			lh.source = lh.footer_source = "HTML"
			lh.content, lh.footer = html["header"], html["footer"]
			lh.save()
	else:
		lh.save()
	return content_hash(lh.content, lh.footer)


def _drop_message(text: str):
	"""Removes one message (by its text) from the messages of this request."""

	def text_of(m):
		if isinstance(m, str):
			try:
				m = json.loads(m)
			except ValueError:
				return m
		return m.get("message") if isinstance(m, dict) else m

	log = frappe.local.message_log
	log[:] = [m for m in log if text_of(m) != text]
