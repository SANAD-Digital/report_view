"""Server-side report settings (docs/architecture.md §5.3).

Per report, only the shipped ``report_view/defaults/<scrub(report)>.json`` is read so far
(the ``Report View Settings`` DocType of §5.2 is not built yet). The site's limits and its
standard print settings come from the ``Report View Global Settings`` single (ADR-015).
"""

import copy
import json
import os
import re

import frappe

DEFAULT_MAX_ROWS = 50000
HARD_MAX_ROWS = 200000
DEFAULT_PRINT_MAX_PAGES = 600
HARD_PRINT_MAX_PAGES = 2000
GLOBAL_SETTINGS = "Report View Global Settings"
_DEFAULTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "defaults")
_FIELDNAME_RE = re.compile(r"^[A-Za-z0-9_]+$")
_SCRUBBED_RE = re.compile(r"^[a-z0-9_]+$")
# load_settings: {path: (mtime, settings)}; the shipped files change on deploy only
_SETTINGS_CACHE: dict[str, tuple[float, dict]] = {}


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
	}


def _split_fields(value: object) -> list[str]:
	if isinstance(value, list):
		items = value
	else:
		items = str(value or "").splitlines()
	return [str(f).strip() for f in items if str(f).strip()]


def load_settings(report_name: str) -> dict:
	"""Merged server settings for ``report_name`` (shipped defaults only, see the module docstring).

	A file is read once per process (again when it changes); the caller gets its own copy."""
	scrubbed = frappe.scrub(report_name or "")
	if not _SCRUBBED_RE.match(scrubbed):
		# never a path outside the defaults folder (a name with "/" or "..")
		return empty_settings(report_name)
	path = os.path.join(_DEFAULTS_DIR, scrubbed + ".json")
	try:
		mtime = os.path.getmtime(path)
	except OSError:
		return empty_settings(report_name)
	cached = _SETTINGS_CACHE.get(path)
	if cached is None or cached[0] != mtime or cached[1]["report"] != report_name:
		cached = (mtime, _read_settings(report_name, path))
		_SETTINGS_CACHE[path] = cached
	return copy.deepcopy(cached[1])


def _read_settings(report_name: str, path: str) -> dict:
	settings = empty_settings(report_name)
	with open(path, encoding="utf-8") as f:
		data = json.load(f)
	if data.get("report") != report_name:
		return settings
	settings["source"] = "defaults"
	settings["enabled"] = bool(data.get("enabled", 1))
	settings["default_mode"] = data.get("default_mode")
	settings["report_settings"] = dict(data.get("report_settings") or {})
	settings["column_rules"] = list(data.get("column_rules") or [])
	settings["enrich_rules"] = [
		{
			"source_column": r.get("source_column"),
			"link_doctype": r.get("link_doctype"),
			"fields": _split_fields(r.get("fields")),
		}
		for r in data.get("enrich_rules") or []
	]
	settings["drilldowns"] = list(data.get("drilldowns") or [])
	settings["balance_pairs"] = [
		{
			"label": p.get("label"),
			"debit_column": p.get("debit_column"),
			"credit_column": p.get("credit_column"),
		}
		for p in data.get("balance_pairs") or []
	]
	settings["signatures"] = list(data.get("signatures") or [])
	# filter_defs are Link only: validate_filters_permissions checks nothing else (Q:1149).
	settings["filter_defs"] = [
		{"fieldname": d["fieldname"], "fieldtype": "Link", "options": d["options"]}
		for d in data.get("filter_defs") or []
		if d.get("fieldtype") == "Link"
		and _FIELDNAME_RE.match(str(d.get("fieldname") or ""))
		and d.get("options")
	]
	return settings


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
	"""ADR-009: min(Global Settings.max_rows (default 50,000, at most 200,000),
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
	bootinfo.report_view = {"custom_print_open_in": "tab" if gs and gs.get("custom_print_open_in") == "New tab" else "same"}


# The labels of the single's Select fields, as the Pages view keys them.
_PAGES = {"Every page": "all", "First page": "first", "All but the first": "rest", "Last page": "last"}
_STYLES = {"Classic": "classic", "Modern": "modern", "Accounting grid": "ledger", "Compact": "compact", "Ink saving": "minimal"}
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
