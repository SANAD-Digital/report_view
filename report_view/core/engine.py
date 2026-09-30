"""Minimal Python engine for exports (docs/architecture.md §4.3, ADR-001, ADR-008).

Applies a validated view state to a NormalizedReport: filter -> sort ->
tree / group -> totals. Pure functions, no database access.

Phase 3 scope and rules:
- Modes: ``grid`` only (pivot and charts arrive in phase 5).
- Flat grid: facts in report order (or sorted). The report's own summary rows
  (opening / internal_total / closing) are kept in place only when there is no
  browser filter, selection or sort; the reference total row (last
  internal_total) is replaced by the engine's grand total row.
- Tree (report has a tree and no ``group.by``): rows in report order, sort is
  not applied. With filters or a selection: matching leaves plus their
  ancestors. Grand total without filters = sum of top-most data rows (N4.7);
  with filters = sum of the matching leaves.
- Group (``group.by``): groups built from the (filtered, sorted) facts;
  group rows carry aggregates when ``subtotals`` is true.
- Totals follow ``report_column_total``: sum for Currency/Float/Int/Duration,
  average for Percent (the column ``agg``), ``None`` for non-measures and for
  ``disable_total`` columns; a row-currency column with more than one currency
  gives ``{"mixed": true}``.
"""

from __future__ import annotations

from typing import Any

from report_view.core.normalize import KIND_DATA, KIND_SEPARATOR, SUMMARY_KINDS

MIXED = {"mixed": True}


# ------------------------------------------------------------- helpers


def _empty(value: Any) -> bool:
	return value is None or value == ""


def _to_float(value: Any) -> float | None:
	if _empty(value) or isinstance(value, bool):
		return None
	try:
		return float(value)
	except TypeError, ValueError:
		return None


def derived_value(row: dict, key: str) -> Any:
	"""Value of a column key, including derived date keys ``<k>__year|__quarter|__month``."""
	if key in row:
		return row[key]
	for suffix in ("__year", "__quarter", "__month"):
		if key.endswith(suffix):
			value = row.get(key[: -len(suffix)])
			if not isinstance(value, str) or len(value) < 7:
				return None
			if suffix == "__year":
				return value[:4]
			if suffix == "__month":
				return value[:7]
			return f"{value[:4]}-Q{(int(value[5:7]) - 1) // 3 + 1}"
	return None


# ------------------------------------------------------------- filters


def _text(value: Any) -> str:
	if value is None:
		return ""
	if isinstance(value, list):
		return ", ".join(str(v) for v in value)
	return str(value)


def _match_text(value: Any, op: str, needle: str) -> bool:
	hay = _text(value).casefold()
	needle = needle.casefold()
	if op == "contains":
		return needle in hay
	if op == "not_contains":
		return needle not in hay
	if op == "equals":
		return hay == needle
	if op == "starts_with":
		return hay.startswith(needle)
	return False


def _norm_set_value(value: Any) -> Any:
	if _empty(value):
		return None
	if isinstance(value, float) and value.is_integer():
		return int(value)
	return value


def _row_matches(row: dict, flt: dict, search_keys: list[str]) -> bool:
	ftype = flt["type"]
	key = flt["key"]
	if ftype == "text":
		if key == "*":
			return any(_match_text(row.get(k), "contains", flt["value"]) for k in search_keys)
		return _match_text(derived_value(row, key), flt["op"], flt["value"])
	if ftype == "set":
		values = {_norm_set_value(v) for v in flt.get("values") or []}
		hit = _norm_set_value(derived_value(row, key)) in values
		return not hit if flt.get("exclude") else hit
	if ftype == "range":
		number = _to_float(row.get(key))
		lo, hi = flt.get("min"), flt.get("max")
		if lo is None and hi is None:
			return True
		if number is None:
			return False
		return (lo is None or number >= lo) and (hi is None or number <= hi)
	if ftype == "date":
		value = row.get(key)
		if not isinstance(value, str) or len(value) < 10:
			return flt.get("from") is None and flt.get("to") is None
		day = value[:10]
		return (flt.get("from") is None or day >= flt["from"]) and (flt.get("to") is None or day <= flt["to"])
	return True


def filter_facts(facts: list[dict], filters: list[dict], search_keys: list[str]) -> list[dict]:
	if not filters:
		return list(facts)
	return [r for r in facts if all(_row_matches(r, f, search_keys) for f in filters)]


# ---------------------------------------------------------------- sort


def _sort_key(value: Any) -> tuple:
	if _empty(value):
		return (2, 0, "")
	number = _to_float(value) if not isinstance(value, str) else None
	if number is not None:
		return (0, number, "")
	return (1, 0, _text(value).casefold())


def sort_rows(rows: list[dict], sort: list[dict]) -> list[dict]:
	out = list(rows)
	for item in reversed(sort or []):
		key = item["key"]
		reverse = item["dir"] == "desc"
		present = [r for r in out if not _empty(derived_value(r, key))]
		absent = [r for r in out if _empty(derived_value(r, key))]
		present.sort(key=lambda r: _sort_key(derived_value(r, key)), reverse=reverse)
		out = present + absent  # empty values always last
	return out


# ---------------------------------------------------------- aggregation


def _currency_values(rows: list[dict], column: dict) -> set:
	cur = column.get("currency") or {}
	if cur.get("kind") != "row":
		return set()
	return {
		r.get(cur["key"]) for r in rows if not _empty(r.get(column["key"])) and not _empty(r.get(cur["key"]))
	}


def aggregate(rows: list[dict], column: dict, agg: str | None = None) -> Any:
	"""Aggregate one column over rows (ADR-008 rules)."""
	agg = agg if agg is not None else column.get("agg")
	if column.get("role") != "measure" or agg is None:
		return None
	key = column["key"]
	if column["fieldtype"] == "Currency" and len(_currency_values(rows, column)) > 1:
		return dict(MIXED)
	numbers = [n for n in (_to_float(r.get(key)) for r in rows) if n is not None]
	if agg == "count":
		return sum(1 for r in rows if not _empty(r.get(key)))
	if agg == "sum":
		total = sum(numbers)
		return int(total) if column["fieldtype"] == "Int" else total
	if agg == "avg":
		# report_column_total divides by the number of rows, not of non-empty cells.
		return sum(numbers) / len(rows) if rows else None
	if agg == "min":
		return min(numbers) if numbers else None
	if agg == "max":
		return max(numbers) if numbers else None
	return None


def totals_for(rows: list[dict], columns: list[dict]) -> dict:
	out = {}
	for col in columns:
		if col.get("role") != "measure":
			continue
		if (col.get("original") or {}).get("disable_total"):
			out[col["key"]] = None
			continue
		out[col["key"]] = aggregate(rows, col) if rows else None
	return out


# ---------------------------------------------------------------- columns


def export_columns(
	nr: dict, state: dict, layout_columns: list[dict] | None, column_keys: list[str] | None
) -> list[dict]:
	by_key = {c["key"]: c for c in nr["columns"]}
	cols_state = state.get("columns") or {}
	hidden = set(cols_state.get("hidden") or [])
	if layout_columns:
		keys = [c["key"] for c in layout_columns]
	elif cols_state.get("order"):
		keys = list(cols_state["order"])
		keys += [c["key"] for c in nr["columns"] if c["export_hidden"] and c["key"] not in keys]
	else:
		keys = [c["key"] for c in nr["columns"]]
	out = []
	for key in keys:
		col = by_key.get(key)
		if col is None or key in hidden:
			continue
		if col["hidden"] and not col["export_hidden"]:
			continue
		if column_keys is not None and key not in column_keys:
			continue
		out.append(col)
	return out


# ------------------------------------------------------------------ apply


def _out_row(row: dict, kind: str, level: int, label: str | None = None, count: int | None = None) -> dict:
	return {
		"kind": kind,
		"level": level,
		"values": row,
		"label": label,
		"count": count,
		"bold": kind != KIND_DATA or bool(row.get("__bold")),
		"collapsed": False,
		"rid": row.get("__rid"),
	}


def _reference_rid(nr: dict) -> int | None:
	"""The report's own grand total row (last internal_total, ADR-008). The export
	replaces it with the engine's grand total row, so it is not repeated in the body."""
	internal = nr["report_totals"]["internal"]
	return internal[-1]["__rid"] if internal else None


def apply(
	nr: dict, state: dict, selection: dict | None = None, layout_columns: list[dict] | None = None
) -> dict:
	"""Apply a validated view state. Returns ``{columns, rows, totals, row_count, layout_mode}``."""
	state = state or {}
	filters = state.get("filters") or []
	sort = state.get("sort") or []
	group_by = (state.get("group") or {}).get("by") or []
	subtotals = (state.get("group") or {}).get("subtotals", True)
	tree_depth = (state.get("tree") or {}).get("depth")
	row_rids = set(selection["row_rids"]) if selection and selection.get("row_rids") is not None else None
	column_keys = selection.get("column_keys") if selection else None

	search_keys = [c["key"] for c in nr["columns"] if c["role"] in ("dimension", "attribute")]
	facts = filter_facts(nr["facts"], filters, search_keys)
	if row_rids is not None:
		facts = [r for r in facts if r["__rid"] in row_rids]
	narrowed = bool(filters) or row_rids is not None
	measures = [c for c in nr["columns"] if c["role"] == "measure"]

	tree = nr.get("tree")
	if tree and not group_by:
		layout_mode = "tree"
		rows_out, totals = _apply_tree(nr, facts, narrowed, tree_depth, measures)
	elif group_by:
		layout_mode = "group"
		facts = sort_rows(facts, sort)
		rows_out = []
		_group_rows(facts, group_by, 0, measures, subtotals, rows_out)
		totals = totals_for(facts, measures)
	else:
		layout_mode = "flat"
		if narrowed or sort:
			rows_out = [_out_row(r, KIND_DATA, 0) for r in sort_rows(facts, sort)]
		else:
			fact_rids = {r["__rid"] for r in facts}
			skip = _reference_rid(nr)
			rows_out = [
				_out_row(r, r["__kind"], 0)
				for r in nr["rows"]
				if (r["__rid"] in fact_rids or r["__kind"] in SUMMARY_KINDS) and r["__rid"] != skip
			]
		totals = totals_for(facts, measures)

	return {
		"columns": export_columns(nr, state, layout_columns, column_keys),
		"rows": rows_out,
		"totals": totals,
		"row_count": len(facts),
		"layout_mode": layout_mode,
	}


def _apply_tree(
	nr: dict, facts: list[dict], narrowed: bool, depth: int | None, measures: list[dict]
) -> tuple[list[dict], dict]:
	by_rid = {r["__rid"]: r for r in nr["rows"]}

	def level_of(row: dict) -> int:
		level, parent = 0, row["__parent"]
		while parent is not None:
			level += 1
			parent = by_rid[parent]["__parent"]
		return level

	if narrowed:
		keep = set()
		for fact in facts:
			rid = fact["__rid"]
			while rid is not None and rid not in keep:
				keep.add(rid)
				rid = by_rid[rid]["__parent"]
		source = [r for r in nr["rows"] if r["__rid"] in keep]
		total_rows = facts
	else:
		skip = _reference_rid(nr)
		source = [r for r in nr["rows"] if r["__kind"] != KIND_SEPARATOR and r["__rid"] != skip]

		def has_data_ancestor(row: dict) -> bool:
			parent = row["__parent"]
			while parent is not None:
				if by_rid[parent]["__kind"] == KIND_DATA:
					return True
				parent = by_rid[parent]["__parent"]
			return False

		total_rows = [r for r in nr["rows"] if r["__kind"] == KIND_DATA and not has_data_ancestor(r)]

	rows_out = []
	for row in source:
		kind = row["__kind"]
		out = _out_row(row, kind if kind != KIND_DATA or row["__is_leaf"] else "parent", level_of(row))
		if kind == KIND_DATA and not row["__is_leaf"]:
			out["bold"] = True
		out["collapsed"] = depth is not None and out["level"] >= depth
		rows_out.append(out)
	return rows_out, totals_for(total_rows, measures)


def _group_rows(
	facts: list[dict],
	group_by: list[str],
	level: int,
	measures: list[dict],
	subtotals: bool,
	out: list[dict],
) -> None:
	if level >= len(group_by):
		out.extend(_out_row(r, KIND_DATA, level) for r in facts)
		return
	key = group_by[level]
	groups: dict[Any, list[dict]] = {}
	for row in facts:
		groups.setdefault(_norm_set_value(derived_value(row, key)), []).append(row)
	for value, members in groups.items():
		values = {key: value}
		if subtotals:
			values.update(totals_for(members, measures))
		out.append(_out_row(values, "group", level, label=_text(value), count=len(members)))
		_group_rows(members, group_by, level + 1, measures, subtotals, out)
