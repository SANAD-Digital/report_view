"""View state schema v1: validation and migration (docs/architecture.md §7).

Phase 3 implements the keys used by the export: ``v``, ``mode``, ``columns``,
``sort``, ``filters`` (text / set / range / date), ``group`` and ``tree``. The
remaining schema keys are type-checked and ignored by the engine. Unknown keys
are rejected on the server (§7.2).
"""

import math
import re
from typing import Any

import frappe
from frappe import _

from report_view.core.errors import RVInvalidViewState

VERSION = 1
MAX_FILTERS = 200
MAX_SET_VALUES = 5000
MAX_GROUP_BY = 50
MAX_PIVOT_DIMS = 20
MAX_KEYS = 1000

TOP_KEYS = frozenset(
	(
		"v",
		"mode",
		"report_filters",
		"columns",
		"sort",
		"filters",
		"quick_filters",
		"group",
		"tree",
		"values",
		"pivot",
		"chart",
		"ui",
	)
)
MODES = ("grid", "pivot", "charts")
TEXT_OPS = ("contains", "equals", "starts_with", "not_contains")
AGGS = ("sum", "avg", "count", "min", "max", "count_distinct")
DERIVED_SUFFIXES = ("__year", "__quarter", "__month")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_PRIMITIVES = (str, int, float, bool, type(None))


def _fail(message: str) -> None:
	frappe.throw(message, RVInvalidViewState)


def _is_number(value: Any) -> bool:
	return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


def _check_keys(obj: Any, allowed: set[str] | frozenset[str], where: str) -> dict:
	if not isinstance(obj, dict):
		_fail(_("View state: {0} must be an object").format(where))
	extra = set(obj) - set(allowed)
	if extra:
		_fail(_("View state: unknown keys in {0}: {1}").format(where, ", ".join(sorted(map(str, extra)))))
	return obj


def _key_list(value: Any, where: str, limit: int = MAX_KEYS) -> list[str]:
	if not isinstance(value, list) or len(value) > limit or not all(isinstance(k, str) for k in value):
		_fail(_("View state: {0} must be a list of column keys").format(where))
	return value


def migrate(state: dict) -> dict:
	"""v0 (no ``v``) -> v1. A version newer than known is rejected on the server."""
	state = dict(state)
	if "v" not in state:
		state["v"] = VERSION
	if state["v"] != VERSION:
		_fail(_("This view was created with a newer version of Report View"))
	return state


def validate(state: Any) -> dict:
	"""Validate a view state against schema v1 and return it (migrated)."""
	if not isinstance(state, dict):
		_fail(_("View state must be an object"))
	state = migrate(state)
	_check_keys(state, TOP_KEYS, "state")

	if state.get("mode", "grid") not in MODES:
		_fail(_("View state: invalid mode"))

	if state.get("report_filters") is not None and not isinstance(state["report_filters"], dict):
		_fail(_("View state: report_filters must be an object"))

	cols = state.get("columns")
	if cols is not None:
		_check_keys(cols, {"order", "hidden", "widths", "pinned"}, "columns")
		if "order" in cols:
			_key_list(cols["order"], "columns.order")
		if "hidden" in cols:
			_key_list(cols["hidden"], "columns.hidden")
		if "widths" in cols:
			widths = cols["widths"]
			if not isinstance(widths, dict) or not all(
				isinstance(k, str) and _is_number(v) and v >= 0 for k, v in widths.items()
			):
				_fail(_("View state: invalid columns.widths"))
		if "pinned" in cols:
			pinned = _check_keys(cols["pinned"], {"start", "end"}, "columns.pinned")
			for side in ("start", "end"):
				if side in pinned:
					_key_list(pinned[side], f"columns.pinned.{side}")

	sort = state.get("sort")
	if sort is not None:
		if not isinstance(sort, list) or len(sort) > MAX_GROUP_BY:
			_fail(_("View state: invalid sort"))
		for item in sort:
			_check_keys(item, {"key", "dir"}, "sort")
			if not isinstance(item.get("key"), str) or item.get("dir") not in ("asc", "desc"):
				_fail(_("View state: invalid sort"))

	filters = state.get("filters")
	if filters is not None:
		if not isinstance(filters, list) or len(filters) > MAX_FILTERS:
			_fail(_("View state: too many filters"))
		for flt in filters:
			_validate_filter(flt)

	quick = state.get("quick_filters")
	if quick is not None and (not isinstance(quick, list) or not all(isinstance(q, str) for q in quick)):
		_fail(_("View state: invalid quick_filters"))

	group = state.get("group")
	if group is not None:
		_check_keys(group, {"by", "subtotals", "expanded"}, "group")
		_key_list(group.get("by", []), "group.by", MAX_GROUP_BY)
		if "subtotals" in group and not isinstance(group["subtotals"], bool):
			_fail(_("View state: invalid group.subtotals"))
		expanded = group.get("expanded", "all")
		if expanded not in ("all", "none") and not isinstance(expanded, list):
			_fail(_("View state: invalid group.expanded"))

	tree = state.get("tree")
	if tree is not None:
		_check_keys(tree, {"depth", "expanded"}, "tree")
		depth = tree.get("depth")
		if depth is not None and (not isinstance(depth, int) or isinstance(depth, bool) or depth < 0):
			_fail(_("View state: invalid tree.depth"))
		if tree.get("expanded") is not None and not isinstance(tree["expanded"], list):
			_fail(_("View state: invalid tree.expanded"))

	values = state.get("values")
	if values is not None:
		if not isinstance(values, list) or len(values) > MAX_KEYS:
			_fail(_("View state: invalid values"))
		for item in values:
			_check_keys(item, {"key", "agg"}, "values")
			if not isinstance(item.get("key"), str) or item.get("agg") not in AGGS:
				_fail(_("View state: invalid values"))

	pivot = state.get("pivot")
	if pivot is not None:
		_check_keys(pivot, {"rows", "cols", "values", "totals"}, "pivot")
		_key_list(pivot.get("rows", []), "pivot.rows", MAX_PIVOT_DIMS)
		_key_list(pivot.get("cols", []), "pivot.cols", MAX_PIVOT_DIMS)
		for item in pivot.get("values", []) or []:
			_check_keys(item, {"key", "agg"}, "pivot.values")
			if not isinstance(item.get("key"), str) or item.get("agg") not in AGGS:
				_fail(_("View state: invalid pivot.values"))

	if state.get("chart") is not None and not isinstance(state["chart"], dict):
		_fail(_("View state: invalid chart"))
	if state.get("ui") is not None and not isinstance(state["ui"], dict):
		_fail(_("View state: invalid ui"))
	return state


def _validate_filter(flt: Any) -> None:
	if not isinstance(flt, dict) or not isinstance(flt.get("key"), str):
		_fail(_("View state: invalid filter"))
	ftype = flt.get("type")
	if ftype == "text":
		_check_keys(flt, {"key", "type", "op", "value", "source"}, "filters")
		if flt.get("op") not in TEXT_OPS or not isinstance(flt.get("value"), str):
			_fail(_("View state: invalid text filter"))
		if "source" in flt and flt["source"] != "search":
			_fail(_("View state: invalid text filter"))
	elif ftype == "set":
		_check_keys(flt, {"key", "type", "values", "exclude"}, "filters")
		values = flt.get("values")
		if not isinstance(values, list) or len(values) > MAX_SET_VALUES:
			_fail(_("View state: invalid set filter"))
		for v in values:
			if not isinstance(v, _PRIMITIVES) or (isinstance(v, float) and not math.isfinite(v)):
				_fail(_("View state: invalid set filter"))
		if "exclude" in flt and not isinstance(flt["exclude"], bool):
			_fail(_("View state: invalid set filter"))
	elif ftype == "range":
		_check_keys(flt, {"key", "type", "min", "max"}, "filters")
		for bound in ("min", "max"):
			if flt.get(bound) is not None and not _is_number(flt[bound]):
				_fail(_("View state: invalid range filter"))
	elif ftype == "date":
		_check_keys(flt, {"key", "type", "from", "to"}, "filters")
		for bound in ("from", "to"):
			value = flt.get(bound)
			if value is not None and not (isinstance(value, str) and _DATE_RE.match(value)):
				_fail(_("View state: invalid date filter"))
	else:
		_fail(_("View state: unsupported filter type"))
	if flt["key"] == "*" and ftype != "text":
		_fail(_("View state: invalid search filter"))


def referenced_keys(state: dict) -> set[str]:
	"""Every column key the state refers to (for §4.2 step 3)."""
	keys: set[str] = set()
	cols = state.get("columns") or {}
	keys.update(cols.get("order") or [])
	keys.update(cols.get("hidden") or [])
	keys.update((cols.get("widths") or {}).keys())
	pinned = cols.get("pinned") or {}
	keys.update(pinned.get("start") or [])
	keys.update(pinned.get("end") or [])
	keys.update(s["key"] for s in state.get("sort") or [])
	keys.update(f["key"] for f in state.get("filters") or [] if f["key"] != "*")
	keys.update((state.get("group") or {}).get("by") or [])
	keys.update(v["key"] for v in state.get("values") or [])
	pivot = state.get("pivot") or {}
	keys.update(pivot.get("rows") or [])
	keys.update(pivot.get("cols") or [])
	keys.update(v["key"] for v in pivot.get("values") or [])
	return keys


def check_against_columns(state: dict, columns: list[dict]) -> None:
	"""Every referenced key exists in the normalized columns (or is a derived date key)."""
	known = {c["key"] for c in columns}
	date_keys = {c["key"] for c in columns if c.get("date")}
	missing = []
	for key in referenced_keys(state):
		if key in known:
			continue
		base = next((key[: -len(s)] for s in DERIVED_SUFFIXES if key.endswith(s)), None)
		if base is not None and base in date_keys:
			continue
		missing.append(key)
	if missing:
		_fail(_("View state refers to unknown columns: {0}").format(", ".join(sorted(missing))))
