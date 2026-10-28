"""Variables of a print format (ADR-024): choices the person makes on the print page.

A ``Print Format`` keeps its variables in the hidden custom field ``rv_variables``
(``fixtures/custom_field.json``): a JSON list of definitions, each ``{label, fieldname,
fieldtype, options, default, description}``. The print page shows one control per variable;
the values chosen come back with every render and the template reads them as
``{{ variables.<fieldname> }}`` (the defaults filled in for those not sent).

The values come from the browser: each is checked against its definition here (an unknown
one dropped, a number coerced and bounded, a Select one of its options, a Link a record the
user may read), and every string of them prints HTML-escaped (``printing.Text``).
"""

import json
import math
import re
from contextlib import contextmanager

import frappe
from frappe import _

from report_view.core.errors import RVInvalidInput
from report_view.core.printing import Text

FIELD = "rv_variables"
MAX_VARIABLES = 30
FIELDTYPES = ("Select", "Check", "Link", "Float", "Int")
FIELDNAME = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
# names a template's context already has (document, report and Custom formats)
RESERVED = frozenset(
	{"doc", "data", "rows", "filters", "columns", "title", "company", "lang", "frappe", "_", "variables"}
)
MAX_LABEL = 140
MAX_DESCRIPTION = 500
MAX_OPTIONS = 100
MAX_OPTION = 140
MAX_DEFINITIONS_BYTES = 64 * 1024
MAX_VALUES_BYTES = 16 * 1024
# a number a variable may hold (either sign)
MAX_NUMBER = 1e12
_TRUE = (True, 1, "1", "true", "True", "yes", "on")


def _bad(message: str):
	frappe.throw(message, RVInvalidInput)


# ---------------------------------------------------------------- the definitions


def _options(fieldtype: str, raw, label: str) -> str | None:
	if fieldtype == "Select":
		if not isinstance(raw, str):
			_bad(_("Variable {0}: write its options, one per line").format(label))
		opts = [o.strip() for o in raw.split("\n")]
		opts = [o for o in opts if o]
		if not opts:
			_bad(_("Variable {0}: write its options, one per line").format(label))
		if len(opts) > MAX_OPTIONS or any(len(o) > MAX_OPTION for o in opts):
			_bad(_("Variable {0}: too many or too long options").format(label))
		if len(set(opts)) != len(opts):
			_bad(_("Variable {0}: an option is written twice").format(label))
		return "\n".join(opts)
	if fieldtype == "Link":
		doctype = raw.strip() if isinstance(raw, str) else ""
		if not doctype or not frappe.db.exists("DocType", doctype):
			_bad(_("Variable {0}: its options must name a DocType").format(label))
		if frappe.get_meta(doctype).istable:
			_bad(_("Variable {0}: {1} is a child table").format(label, doctype))
		return doctype
	return None


def _number(fieldtype: str, raw, label: str):
	if isinstance(raw, bool):
		raw = int(raw)
	if isinstance(raw, str):
		raw = raw.strip()
	try:
		n = float(raw)
	except TypeError, ValueError:
		_bad(_("Variable {0}: {1} is not a number").format(label, frappe.utils.escape_html(str(raw)[:40])))
	if not math.isfinite(n) or abs(n) > MAX_NUMBER:
		_bad(_("Variable {0}: the number is out of range").format(label))
	if fieldtype == "Int":
		if n != int(n):
			_bad(
				_("Variable {0}: {1} is not a whole number").format(
					label, frappe.utils.escape_html(str(raw)[:40])
				)
			)
		return int(n)
	return n


def _default(d: dict, raw):
	"""The default of a definition, of its type (empty: the type's own empty value)."""
	t, label = d["fieldtype"], d["label"]
	if t == "Check":
		return 1 if raw in _TRUE else 0
	if raw is None or raw == "":
		return 0 if t in ("Int", "Float") else ""
	if t in ("Int", "Float"):
		return _number(t, raw, label)
	if not isinstance(raw, str | int | float) or isinstance(raw, bool):
		_bad(_("Variable {0}: invalid default value").format(label))
	raw = str(raw).strip()
	if t == "Select" and raw not in d["options"].split("\n"):
		_bad(_("Variable {0}: the default must be one of its options").format(label))
	if len(raw) > MAX_OPTION:
		_bad(_("Variable {0}: the default value is too long").format(label))
	return raw


def parse_definitions(raw) -> list[dict]:
	"""The definitions of ``raw`` (JSON text or a list), checked and normalised; a mistake
	throws a translated message naming the variable."""
	if raw is None or raw == "" or raw == []:
		return []
	if isinstance(raw, str):
		if len(raw.encode("utf-8")) > MAX_DEFINITIONS_BYTES:
			_bad(_("The variables are too large"))
		try:
			raw = json.loads(raw)
		except ValueError:
			_bad(_("The variables are not valid JSON"))
	if not isinstance(raw, list):
		_bad(_("The variables must be a list"))
	if len(raw) > MAX_VARIABLES:
		_bad(_("A print format has at most {0} variables").format(MAX_VARIABLES))
	out, seen = [], set()
	for i, item in enumerate(raw, 1):
		if not isinstance(item, dict):
			_bad(_("Variable {0} is not an object").format(i))
		label = item.get("label")
		label = label.strip() if isinstance(label, str) else ""
		if not label or len(label) > MAX_LABEL:
			_bad(_("Variable {0}: write its label (at most {1} characters)").format(i, MAX_LABEL))
		esc_label = frappe.utils.escape_html(label)
		fieldname = item.get("fieldname")
		if not isinstance(fieldname, str) or not FIELDNAME.match(fieldname):
			_bad(
				_(
					"Variable {0}: its name starts with a small letter and has small letters, digits and _ only (at most 40)"
				).format(esc_label)
			)
		if fieldname in RESERVED:
			_bad(
				_("Variable {0}: the name {1} is taken by the template's context").format(
					esc_label, fieldname
				)
			)
		if fieldname in seen:
			_bad(_("The variable name {0} is used twice").format(fieldname))
		seen.add(fieldname)
		fieldtype = item.get("fieldtype")
		if fieldtype not in FIELDTYPES:
			_bad(_("Variable {0}: the type must be Select, Check, Link, Float or Int").format(esc_label))
		d = {
			"label": label,
			"fieldname": fieldname,
			"fieldtype": fieldtype,
			"options": _options(fieldtype, item.get("options"), esc_label),
		}
		d["default"] = _default({**d, "label": esc_label}, item.get("default"))
		description = item.get("description")
		if isinstance(description, str) and description.strip():
			d["description"] = description.strip()[:MAX_DESCRIPTION]
		out.append(d)
	return out


def validate_print_format(doc, method=None) -> None:
	"""``before_validate`` of Print Format (doc_events): its variables parse and match the
	schema, a Link names a DocType; stored normalised (or empty)."""
	if not doc.meta.has_field(FIELD):
		return
	defs = parse_definitions(doc.get(FIELD))
	doc.set(FIELD, json.dumps(defs, ensure_ascii=False, indent=1) if defs else None)


def definitions(pf) -> list[dict]:
	"""The stored definitions of a print format (a doc, or None); a value that no longer
	parses (a DocType deleted since) gives none, so the format still prints."""
	raw = pf.get(FIELD) if pf is not None else None
	if not raw:
		return []
	try:
		return parse_definitions(raw)
	except frappe.ValidationError:
		frappe.clear_last_message()
		return []


def definitions_of(names) -> dict:
	"""``{format: definitions}`` of the formats the caller listed for the user (those with
	variables only), for the options of a print page."""
	out = {}
	for name in dict.fromkeys(names or []):
		if not frappe.db.exists("Print Format", name):
			continue
		defs = definitions(frappe.get_cached_doc("Print Format", name))
		if defs:
			out[name] = defs
	return out


# ---------------------------------------------------------------- the values


def _value(d: dict, raw):
	t = d["fieldtype"]
	label = frappe.utils.escape_html(d["label"])
	if t == "Check":
		return 1 if raw in _TRUE else 0
	if t in ("Int", "Float"):
		if raw is None or raw == "":
			return d["default"]
		return _number(t, raw, label)
	if raw is None:
		return d["default"]
	if not isinstance(raw, str | int | float) or isinstance(raw, bool):
		_bad(_("Variable {0}: invalid value").format(label))
	raw = str(raw).strip()
	if t == "Select":
		if raw not in d["options"].split("\n"):
			_bad(
				_("Variable {0}: {1} is not one of its options").format(
					label, frappe.utils.escape_html(raw[:40])
				)
			)
		return Text(raw)
	# Link: a record the user may read, or nothing
	if not raw:
		return Text("")
	if not frappe.db.exists(d["options"], raw) or not frappe.has_permission(d["options"], "read", doc=raw):
		frappe.throw(
			_("Variable {0}: you may not read {1} {2}").format(
				label, _(d["options"]), frappe.utils.escape_html(raw[:140])
			),
			frappe.PermissionError,
		)
	return Text(raw)


def _default_value(d: dict):
	"""The default as the template reads it; a Link default the user may not read is empty."""
	v = d["default"]
	if d["fieldtype"] == "Link":
		if v and not (
			frappe.db.exists(d["options"], v) and frappe.has_permission(d["options"], "read", doc=v)
		):
			return Text("")
		return Text(v or "")
	if d["fieldtype"] == "Select":
		return Text(v or "")
	return v


def resolve(pf, values=None) -> frappe._dict:
	"""``variables`` of the template: every variable of ``pf``, the value sent (checked
	against its definition) or its default. Values for no variable are dropped."""
	defs = definitions(pf)
	if values in (None, "", {}):
		values = {}
	elif isinstance(values, str):
		if len(values.encode("utf-8")) > MAX_VALUES_BYTES:
			_bad(_("The variables are too large"))
		try:
			values = json.loads(values)
		except ValueError:
			_bad(_("The variables are not valid JSON"))
	if not isinstance(values, dict):
		_bad(_("The variables must be an object"))
	out = frappe._dict()
	for d in defs:
		key = d["fieldname"]
		out[key] = _value(d, values[key]) if key in values else _default_value(d)
	return out


# The values of one render of a document's format, for the hook pdf_body_html (Frappe
# renders the document's template itself: the hook is where its context is made).
_LOCAL_KEY = "rv_print_variables"


@contextmanager
def for_render(pf, values):
	"""``values`` checked against ``pf`` and kept for the hook while Frappe renders."""
	resolved = resolve(pf, values) if pf is not None else frappe._dict()
	before = getattr(frappe.local, _LOCAL_KEY, None)
	setattr(frappe.local, _LOCAL_KEY, {"name": pf.name if pf is not None else None, "values": resolved})
	try:
		yield resolved
	finally:
		setattr(frappe.local, _LOCAL_KEY, before)


def for_print(print_format) -> frappe._dict:
	"""``variables`` of a document's template (hook ``pdf_body_html``): those of the render
	under way (``for_render``), else the format's defaults (Frappe's own print page and
	PDF), else nothing."""
	if print_format is None:
		return frappe._dict()
	name = print_format.get("name")
	current = getattr(frappe.local, _LOCAL_KEY, None)
	if current and current.get("name") == name:
		return current["values"]
	return resolve(print_format)
