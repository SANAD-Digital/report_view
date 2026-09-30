"""Server-side report settings (docs/architecture.md §5.3).

Phase 3 reads only the shipped ``report_view/defaults/<scrub(report)>.json``.
The ``Report View Settings`` / ``Report View Global Settings`` DocTypes arrive
in phase 4; until then the global defaults below apply.
"""

import json
import os
import re

import frappe

DEFAULT_MAX_ROWS = 50000
DEFAULT_WORKER_THRESHOLD = 10000
_DEFAULTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "defaults")
_FIELDNAME_RE = re.compile(r"^[A-Za-z0-9_]+$")


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
	"""Merged server settings for ``report_name`` (shipped defaults only in phase 3)."""
	settings = empty_settings(report_name)
	path = os.path.join(_DEFAULTS_DIR, frappe.scrub(report_name) + ".json")
	if not os.path.isfile(path):
		return settings
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
		{"label": p.get("label"), "debit_column": p.get("debit_column"), "credit_column": p.get("credit_column")}
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


def get_row_limit() -> int:
	"""ADR-009: min(Global Settings.max_rows (default 50,000), System Settings.max_report_rows)."""
	limit = DEFAULT_MAX_ROWS
	system_max = frappe.utils.cint(frappe.db.get_single_value("System Settings", "max_report_rows"))
	if system_max > 0:
		limit = min(limit, system_max)
	return limit
