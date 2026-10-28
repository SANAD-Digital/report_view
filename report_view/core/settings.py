"""Server-side report settings (docs/architecture.md §5.2-§5.4, ADR-023).

Per report, the merged result of three layers, key by key (weakest first):
``empty_settings`` < the shipped ``report_view/defaults/<scrub(report)>.json`` < the
``Report View Settings`` record of the report (site data, System Manager). The shipped
``filter_defs`` are a security boundary (ADR-021): a record adds definitions, it never
removes or retypes a shipped one. The merged result is cached per report (Redis) and
cleared when the record changes. The site's limits and its standard print settings come
from the ``Report View Global Settings`` single (ADR-015).
"""

import copy
import json
import os
import re

import frappe
from frappe import _

DEFAULT_MAX_ROWS = 100000
HARD_MAX_ROWS = 200000
DEFAULT_PRINT_MAX_PAGES = 600
HARD_PRINT_MAX_PAGES = 2000
GLOBAL_SETTINGS = "Report View Global Settings"
REPORT_SETTINGS = "Report View Settings"
# who may change the Report View Settings of a report (DocPerm of the DocType) and its default
# saved view (ADR-010): the role shipped with the app, besides System Manager
MANAGER_ROLES = ("System Manager", "Report View Manager")
_DEFAULTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "defaults")
_FIELDNAME_RE = re.compile(r"^[A-Za-z0-9_]+$")
_SCRUBBED_RE = re.compile(r"^[a-z0-9_]+$")
# load_settings: {path: (mtime, shipped settings)}; the shipped files change on deploy only
_SETTINGS_CACHE: dict[str, tuple[float, dict]] = {}
# the merged settings of a report: Redis hash {report: {"mtime": shipped mtime, "settings": ...}}
MERGED_CACHE_KEY = "report_view:report_settings"

# What a report shows (ADR-023): every flag on by default, so a report without a record looks
# as before. The browser reads one ``features`` object (state/features.js).
FEATURES = (
	"grouping",
	"subtotals",
	"quick_search",
	"column_filters",
	"set_filters",
	"filters_panel",
	"quick_filters",
	"period_picker",
	"side_panel",
	"columns_panel",
	"pinning",
	"column_groups",
	"pivot",
	"charts",
	"pages",
	"excel",
	"density",
)
# The card types of the charts view (state/dashboard_state.js CARD_TYPES, same order).
CHART_TYPES = ("bar", "stacked", "hbar", "hstacked", "line", "area", "donut", "kpi")
# The Select labels of default_mode and the view state's modes.
DEFAULT_MODES = {"Table": "grid", "Pivot analysis": "pivot", "Charts": "charts", "Pages": "pages"}
_MODES = frozenset(DEFAULT_MODES.values())
# Row details (the button in the first column that opens the whole row): Select labels -> keys.
ROW_CONTAINERS = {"Drawer": "drawer", "Dialog": "dialog"}
ROW_WIDTHS = {"Narrow": "narrow", "Medium": "medium", "Wide": "wide"}
ROW_CONTENTS = {"Fields": "fields", "HTML template": "html", "Print format": "print_format"}
# The JSON fields of the record, parsed with the loader's own functions.
JSON_PARTS = ("report_settings", "enrich_rules", "balance_pairs", "filter_defs")


def default_features() -> dict:
	out = dict.fromkeys(FEATURES, True)
	out["chart_types"] = list(CHART_TYPES)
	return out


def default_row_details() -> dict:
	"""The row details config the browser reads (never the template itself: the server
	renders it, ``core/row_details``)."""
	return {
		"enabled": True,
		"container": "drawer",
		"width": "medium",
		"content": "fields",
		"print_format": None,
		"document": False,
		"doc_fields": None,
	}


def empty_settings(report_name: str) -> dict:
	"""Settings of a report without any configuration (§5.4)."""
	return {
		"report": report_name,
		"source": None,
		"enabled": True,
		"default_mode": None,
		"report_settings": {},
		"column_rules": [],
		"enrich_rules": [],
		"drilldowns": [],
		"balance_pairs": [],
		"signatures": [],
		"filter_defs": [],
		"features": default_features(),
		"default_view": {"group_by": [], "hidden": [], "pinned": []},
		"row_details": default_row_details(),
	}


def _split_fields(value: object) -> list[str]:
	if isinstance(value, list):
		items = value
	else:
		items = str(value or "").splitlines()
	return [str(f).strip() for f in items if str(f).strip()]


def _key_list(value: object) -> list[str]:
	"""Column keys of a default-view field: a JSON list or one key per line."""
	if isinstance(value, str) and value.strip().startswith("["):
		try:
			value = json.loads(value)
		except ValueError:
			return []
	return [k for k in _split_fields(value) if _FIELDNAME_RE.match(k)]


def _shipped_path(report_name: str) -> str | None:
	scrubbed = frappe.scrub(report_name or "")
	# never a path outside the defaults folder (a name with "/" or "..")
	return os.path.join(_DEFAULTS_DIR, scrubbed + ".json") if _SCRUBBED_RE.match(scrubbed) else None


def _mtime(path: str | None) -> float | None:
	try:
		return os.path.getmtime(path) if path else None
	except OSError:
		return None


def shipped_settings(report_name: str) -> dict:
	"""The shipped layer only (``empty_settings`` when the report ships none).

	A file is read once per process (again when it changes); the caller gets its own copy."""
	path = _shipped_path(report_name)
	mtime = _mtime(path)
	if mtime is None:
		return empty_settings(report_name)
	cached = _SETTINGS_CACHE.get(path)
	if cached is None or cached[0] != mtime or cached[1]["report"] != report_name:
		cached = (mtime, _read_settings(report_name, path))
		_SETTINGS_CACHE[path] = cached
	return copy.deepcopy(cached[1])


def shipped_data(report_name: str) -> dict | None:
	"""The shipped file of a report as it is (the settings form loads it), or None."""
	path = _shipped_path(report_name)
	if _mtime(path) is None:
		return None
	with open(path, encoding="utf-8") as f:
		data = json.load(f)
	return data if data.get("report") == report_name else None


def load_settings(report_name: str) -> dict:
	"""Merged server settings for ``report_name`` (see the module docstring); the caller gets
	its own copy. Read as configuration (as Frappe reads System Settings): no user data."""
	path = _shipped_path(report_name)
	if not path:
		return empty_settings(report_name)
	mtime = _mtime(path)
	cached = frappe.cache.hget(MERGED_CACHE_KEY, report_name)
	# the shipped file changed (a deploy): merged again
	if not cached or cached.get("mtime") != mtime:
		cached = {
			"mtime": mtime,
			"settings": merge_settings(shipped_settings(report_name), read_record(report_name)),
		}
		frappe.cache.hset(MERGED_CACHE_KEY, report_name, cached)
	return copy.deepcopy(cached["settings"])


def clear_settings_cache(report_name: str | None = None) -> None:
	"""Forget the merged settings of a report (or of every report)."""
	if report_name:
		frappe.cache.hdel(MERGED_CACHE_KEY, report_name)
	else:
		frappe.cache.delete_value(MERGED_CACHE_KEY)


def read_record(report_name: str) -> dict | None:
	"""The ``Report View Settings`` record of the report as a layer of settings, or None."""
	try:
		if not frappe.db.exists(REPORT_SETTINGS, report_name):
			return None
	except frappe.db.TableMissingError:
		# a site where the DocType is not installed yet
		return None
	return record_layer(frappe.get_doc(REPORT_SETTINGS, report_name))


def _json_value(value: object, fieldname: str, kind: type, strict: bool):
	"""A JSON field of the record: its parsed value, None when empty. ``strict`` (validate)
	throws on what the loader would drop."""
	if value is None or (isinstance(value, str) and not value.strip()):
		return None
	if isinstance(value, str):
		try:
			value = json.loads(value)
		except ValueError as e:
			if strict:
				frappe.throw(_("{0} is not valid JSON: {1}").format(_(frappe.unscrub(fieldname)), e))
			return None
	if not isinstance(value, kind):
		if strict:
			what = _("an object") if kind is dict else _("a list")
			frappe.throw(_("{0} must be {1}").format(_(frappe.unscrub(fieldname)), what))
		return None
	return value


def record_layer(doc, strict: bool = False) -> dict:
	"""A ``Report View Settings`` document as a layer of settings: the JSON parts it sets
	(None = not set, the shipped value stays), its features and default view."""
	layer = {"source": "settings", "enabled": bool(doc.get("enabled"))}
	for part in JSON_PARTS:
		value = _json_value(doc.get(part), part, dict if part == "report_settings" else list, strict)
		if value is None:
			layer[part] = None
		elif part == "report_settings":
			layer[part] = dict(value)
		else:
			layer[part] = PARSERS[part](value, strict)
	features = {k: bool(doc.get(k)) for k in FEATURES}
	features["chart_types"] = [t for t in CHART_TYPES if doc.get("chart_" + t)]
	layer["features"] = features
	layer["row_details"] = row_details_layer(doc, strict)
	layer["default_mode"] = DEFAULT_MODES.get(doc.get("default_mode") or "")
	layer["default_view"] = {
		"group_by": _key_list(doc.get("default_group_by")),
		"hidden": _key_list(doc.get("default_hidden")),
		"pinned": _key_list(doc.get("default_pinned")),
	}
	return layer


def parse_doc_fields(value: object, strict: bool = False) -> dict | None:
	"""{"doctype_field", "name_field"}: the row's columns holding a document's DocType and name."""
	value = _json_value(value, "row_details_doc_fields", dict, strict)
	if value is None:
		return None
	out = {k: value.get(k) for k in ("doctype_field", "name_field")}
	if not all(isinstance(v, str) and _FIELDNAME_RE.match(v) for v in out.values()):
		_bad(strict, _("Document fields needs a doctype_field and a name_field, both column fieldnames"))
		return None
	return out


def row_details_layer(doc, strict: bool = False) -> dict:
	content = ROW_CONTENTS.get(doc.get("row_details_content") or "Fields", "fields")
	document = bool(doc.get("row_details_document"))
	return {
		"enabled": bool(doc.get("row_details_enabled")),
		"container": ROW_CONTAINERS.get(doc.get("row_details_container") or "", "drawer"),
		"width": ROW_WIDTHS.get(doc.get("row_details_width") or "", "medium"),
		"content": content,
		"print_format": (doc.get("row_details_print_format") or None) if content == "print_format" else None,
		"document": document,
		"doc_fields": parse_doc_fields(doc.get("row_details_doc_fields"), strict and document)
		if document
		else None,
	}


def parse_row_details(value: object, base: dict) -> dict:
	"""Row details of a shipped file: known keys and values only (no template: a shipped file
	offers fields or a print format)."""
	out = dict(base)
	if not isinstance(value, dict):
		return out
	for key, choices in (
		("container", ROW_CONTAINERS.values()),
		("width", ROW_WIDTHS.values()),
		("content", ("fields", "print_format")),
	):
		if value.get(key) in choices:
			out[key] = value[key]
	for key in ("enabled", "document"):
		if isinstance(value.get(key), bool | int):
			out[key] = bool(value[key])
	if isinstance(value.get("print_format"), str):
		out["print_format"] = value["print_format"]
	if isinstance(value.get("doc_fields"), dict):
		out["doc_fields"] = parse_doc_fields(value["doc_fields"])
	return out


def _merge_by(base: list[dict], over: list[dict], key) -> list[dict]:
	"""Lists merged by identity: an entry of ``over`` replaces the one of ``base`` with its key."""
	out = {key(d): d for d in base}
	for d in over:
		out[key(d)] = d
	return list(out.values())


def merge_settings(shipped: dict, record: dict | None) -> dict:
	"""The record over the shipped settings, key by key (ADR-023). The shipped filter_defs
	always win for their fieldnames (ADR-021); a record only adds definitions."""
	if not record:
		return shipped
	out = copy.deepcopy(shipped)
	out["source"] = record["source"]
	out["enabled"] = record["enabled"]
	if record.get("report_settings") is not None:
		out["report_settings"] = {**shipped["report_settings"], **record["report_settings"]}
	if record.get("enrich_rules") is not None:
		out["enrich_rules"] = _merge_by(
			shipped["enrich_rules"], record["enrich_rules"], lambda r: (r["source_column"], r["link_doctype"])
		)
	if record.get("balance_pairs") is not None:
		out["balance_pairs"] = _merge_by(
			shipped["balance_pairs"], record["balance_pairs"], lambda p: p["label"]
		)
	if record.get("filter_defs") is not None:
		own = {d["fieldname"] for d in shipped["filter_defs"]}
		out["filter_defs"] = shipped["filter_defs"] + [
			d for d in record["filter_defs"] if d["fieldname"] not in own
		]
	out["features"] = {**shipped["features"], **record["features"]}
	if record.get("default_mode"):
		out["default_mode"] = record["default_mode"]
	out["default_view"] = record["default_view"]
	out["row_details"] = record["row_details"]
	return out


def _read_settings(report_name: str, path: str) -> dict:
	settings = empty_settings(report_name)
	with open(path, encoding="utf-8") as f:
		data = json.load(f)
	if data.get("report") != report_name:
		return settings
	settings["source"] = "defaults"
	settings["enabled"] = bool(data.get("enabled", 1))
	settings["default_mode"] = data.get("default_mode") if data.get("default_mode") in _MODES else None
	settings["report_settings"] = dict(data.get("report_settings") or {})
	settings["column_rules"] = list(data.get("column_rules") or [])
	settings["enrich_rules"] = parse_enrich_rules(data.get("enrich_rules") or [])
	settings["drilldowns"] = list(data.get("drilldowns") or [])
	settings["balance_pairs"] = parse_balance_pairs(data.get("balance_pairs") or [])
	settings["signatures"] = list(data.get("signatures") or [])
	settings["filter_defs"] = parse_filter_defs(data.get("filter_defs") or [])
	settings["features"] = parse_features(data.get("features"), settings["features"])
	settings["row_details"] = parse_row_details(data.get("row_details"), settings["row_details"])
	return settings


def parse_features(value: object, base: dict) -> dict:
	"""Feature flags of a shipped file: known keys only, booleans; chart_types a known list."""
	out = dict(base)
	if not isinstance(value, dict):
		return out
	for k in FEATURES:
		if isinstance(value.get(k), bool | int):
			out[k] = bool(value[k])
	if isinstance(value.get("chart_types"), list):
		out["chart_types"] = [t for t in CHART_TYPES if t in value["chart_types"]]
	return out


def _bad(strict: bool, message: str) -> bool:
	if strict:
		frappe.throw(message)
	return False


def parse_enrich_rules(items: list, strict: bool = False) -> list[dict]:
	"""ADR-011: {source_column, link_doctype, fields} (fields a list, or one per line)."""
	out = []
	for i, r in enumerate(items, 1):
		if not isinstance(r, dict):
			_bad(strict, _("Enrich rule {0} must be an object").format(i))
			continue
		rule = {
			"source_column": r.get("source_column"),
			"link_doctype": r.get("link_doctype"),
			"fields": _split_fields(r.get("fields")),
		}
		if strict:
			if not _FIELDNAME_RE.match(str(rule["source_column"] or "")):
				_bad(strict, _("Enrich rule {0}: the source column must be a column fieldname").format(i))
			if not rule["link_doctype"] or not frappe.db.exists("DocType", rule["link_doctype"]):
				_bad(strict, _("Enrich rule {0}: {1} is not a DocType").format(i, rule["link_doctype"]))
			if not rule["fields"] or not all(_FIELDNAME_RE.match(f) for f in rule["fields"]):
				_bad(strict, _("Enrich rule {0}: the fields must be fieldnames of the DocType").format(i))
		out.append(rule)
	return out


def parse_balance_pairs(items: list, strict: bool = False) -> list[dict]:
	"""{label, debit_column, credit_column}."""
	out = []
	for i, p in enumerate(items, 1):
		if not isinstance(p, dict):
			_bad(strict, _("Balance pair {0} must be an object").format(i))
			continue
		pair = {
			"label": p.get("label"),
			"debit_column": p.get("debit_column"),
			"credit_column": p.get("credit_column"),
		}
		if strict and (
			not isinstance(pair["label"], str)
			or not pair["label"].strip()
			or not _FIELDNAME_RE.match(str(pair["debit_column"] or ""))
			or not _FIELDNAME_RE.match(str(pair["credit_column"] or ""))
		):
			_bad(strict, _("Balance pair {0} needs a label, a debit column and a credit column").format(i))
		out.append(pair)
	return out


def parse_filter_defs(items: list, strict: bool = False) -> list[dict]:
	"""ADR-021: the valid definitions only (strict: an invalid one throws)."""
	out = []
	for i, d in enumerate(items, 1):
		if not _valid_filter_def(d):
			_bad(
				strict,
				_(
					"Filter definition {0} must have a fieldname, a fieldtype of Link, Dynamic Link or MultiSelectList, and its options"
				).format(i),
			)
			continue
		if strict and d["fieldtype"] != "Dynamic Link" and not frappe.db.exists("DocType", d["options"]):
			_bad(strict, _("Filter definition {0}: {1} is not a DocType").format(i, d["options"]))
		out.append({"fieldname": d["fieldname"], "fieldtype": d["fieldtype"], "options": d["options"]})
	return out


PARSERS = {
	"enrich_rules": parse_enrich_rules,
	"balance_pairs": parse_balance_pairs,
	"filter_defs": parse_filter_defs,
}


def _valid_filter_def(d: dict) -> bool:
	"""ADR-021: a Link names its DocType; a Dynamic Link names the filter holding the DocType;
	a MultiSelectList (which Frappe does not check, Q:1149) is kept so the browser cannot
	retype it."""
	if not isinstance(d, dict) or not _FIELDNAME_RE.match(str(d.get("fieldname") or "")):
		return False
	options = d.get("options")
	if not isinstance(options, str) or not options:
		return False
	if d.get("fieldtype") == "Dynamic Link":
		return bool(_FIELDNAME_RE.match(options))
	return d.get("fieldtype") in ("Link", "MultiSelectList")


def global_settings():
	"""The values of the ``Report View Global Settings`` single, or None on a site without
	it. A field never saved takes the default of its definition. Read as configuration (as
	Frappe reads System Settings): its values are no user data."""
	try:
		doc = frappe.get_cached_doc(GLOBAL_SETTINGS)
	except frappe.DoesNotExistError:
		return None
	# never saved: Frappe fills a new single from the session's defaults (a user's letter
	# head...); the site's settings are the definition's defaults only
	values = frappe._dict(doc.as_dict()) if doc.modified else frappe._dict()
	for df in doc.meta.fields:
		if values.get(df.fieldname) is None and df.default is not None:
			values[df.fieldname] = frappe.utils.cast(df.fieldtype, df.default)
	return values


def get_row_limit() -> int:
	"""ADR-009: min(Global Settings.max_rows (default 100,000, at most 200,000),
	System Settings.max_report_rows)."""
	gs = global_settings()
	limit = min(frappe.utils.cint(gs and gs.max_rows) or DEFAULT_MAX_ROWS, HARD_MAX_ROWS)
	system_max = frappe.utils.cint(frappe.db.get_single_value("System Settings", "max_report_rows"))
	if system_max > 0:
		limit = min(limit, system_max)
	return limit


def get_print_max_pages() -> int:
	gs = global_settings()
	return min(frappe.utils.cint(gs and gs.print_max_pages) or DEFAULT_PRINT_MAX_PAGES, HARD_PRINT_MAX_PAGES)


def boot_session(bootinfo) -> None:
	"""Hook ``extend_bootinfo`` (ADR-019): what a page needs before any request, here where
	report_view.print() opens a Custom print. It must be known at the click: a tab opened
	after a request is blocked by the browser."""
	gs = global_settings()
	bootinfo.report_view = {
		"custom_print_open_in": "tab" if gs and gs.get("custom_print_open_in") == "New tab" else "same"
	}


# The labels of the single's Select fields, as the Pages view keys them.
_PAGES = {"Every page": "all", "First page": "first", "All but the first": "rest", "Last page": "last"}
_STYLES = {
	"Classic": "classic",
	"Modern": "modern",
	"Accounting grid": "ledger",
	"Compact": "compact",
	"Ink saving": "minimal",
}
_NUMBER_POS = {
	"Bottom, at the end": "bottom-end",
	"Bottom, centred": "bottom-center",
	"Bottom, at the start": "bottom-start",
	"Top, at the end": "top-end",
	"Top, centred": "top-center",
	"Top, at the start": "top-start",
}
_NUMBER_FORMAT = {"Page 1 of 3": "full", "1 / 3": "short", "— 1 —": "dash", "1": "number"}


def print_defaults() -> dict:
	"""The standard print settings of the site, keyed as the Pages view's settings
	(views/pages_view.js DEFAULT_SETTINGS); the browser validates them as it validates a
	user's saved settings. Empty on a site without the single."""
	gs = global_settings()
	if not gs:
		return {}
	out = {
		"size": gs.paper_size or "A4",
		"margins": (gs.margins or "Normal").lower(),
		"style": _STYLES.get(gs.print_style, "classic"),
		"letter_head": gs.letter_head or "",
		"heading": gs.print_heading or "",
		"signature": gs.print_signature or "",
		"signatures": bool(gs.show_signatures),
		"lh_pages": _PAGES.get(gs.letter_head_pages, "first"),
		"heading_pages": _PAGES.get(gs.heading_pages, "first"),
		"sig_pages": _PAGES.get(gs.signature_pages, "last"),
		"foot_pages": _PAGES.get(gs.footer_pages, "all"),
		"page_numbers": bool(gs.page_numbers),
		"number_pos": _NUMBER_POS.get(gs.number_position, "bottom-end"),
		"number_format": _NUMBER_FORMAT.get(gs.number_format, "full"),
		"include_filters": bool(gs.include_filters),
		"include_total": bool(gs.include_total),
		"printed_on": bool(gs.printed_on),
	}
	orientation = {"Portrait page": "portrait", "Landscape page": "landscape"}.get(gs.orientation)
	if orientation:
		out["orientation"] = orientation
	if gs.letter_head_height:
		out["lh_height"] = gs.letter_head_height
	if gs.footer_height is not None:
		out["foot_height"] = gs.footer_height
	if out["margins"] == "custom":
		out["page_m"] = {side: gs.get(f"margin_{side}") or 0 for side in ("top", "bottom", "start", "end")}
	return out
