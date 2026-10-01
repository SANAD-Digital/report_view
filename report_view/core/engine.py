"""Python engine for exports (docs/architecture.md §4.3, ADR-001, ADR-008, ADR-012).

Applies a validated view state to a NormalizedReport so that the file holds what the
screen shows. It is the server twin of the browser modules ``engine/view_config.js``
(shapes, filters, sort, column order, grand total), ``engine/report_rows.js`` (the report's
own summary rows), ``engine/tree_nodes.js`` (the report tree) and ``engine/row_layout.js``
(subtotal rows), with the semantics of Perspective. Pure functions, no database access.

Shapes (``layout_mode`` of the result), as in ``to_view_config``:
- ``tree``: a tree report without ``group.by`` and without a browser filter. The rows of
  the report itself, parents and leaves with the report's own values (N9). The grand total
  is the report's reference row (last ``internal_total``, ADR-008), not a computed sum.
- ``levels``: a tree report under a browser filter (or a selection). The matching leaves
  and their ancestors; the values of a parent are aggregated from its matching leaves.
- ``group``: ``group.by``. Groups of the (filtered) facts, ordered by their key.
- ``flat``: a report without a tree. Without a filter the report's own opening stands
  first and its closing rows last, also under a sort; without a filter and a sort the
  summary rows of the report's own groups stay in place. The grand total is the report's
  reference row when it closes the report, else the engine's total.

Every row is written; a row under a folded group or parent is marked ``hidden`` and the
folded row ``open: False`` (``group.expanded``, ``tree.depth``, ``tree.expanded``).
With ``group.subtotals`` an open group (or parent) keeps its title only and a ``foot`` row
after its rows carries the numbers; a folded one always carries its numbers.

Null semantics are Perspective's: ``sum`` and ``avg`` ignore nulls (a sum of nulls is 0, an
average of nulls is null), ``min`` and ``max`` ignore nulls, ``count`` counts rows and
``count_distinct`` counts null as a value. In a sort nulls are the largest value.
"""

from __future__ import annotations

import datetime
import math
import re
import unicodedata
from decimal import Decimal
from typing import Any

from report_view.core.normalize import (
	KIND_CLOSING,
	KIND_DATA,
	KIND_GROUP_HEADER,
	KIND_INTERNAL_TOTAL,
	KIND_OPENING,
	KIND_SEPARATOR,
	SUMMARY_KINDS,
)

MIXED = {"mixed": True}
KIND_PARENT = "parent"
KIND_GROUP = "group"
KIND_FOOT = "foot"
NODE_KINDS = (KIND_DATA, KIND_GROUP_HEADER)
DEFAULT_TREE_DEPTH = 2

FLOAT_TYPES = frozenset(("Currency", "Float", "Percent", "Duration", "Int"))
_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_DATETIME_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?$")
_ASCII_LOWER = {c: c + 32 for c in range(ord("A"), ord("Z") + 1)}
_EPOCH = datetime.date(1970, 1, 1)
_TATWEEL = "ـ"


# ------------------------------------------------------- typed values (N8)


def value_type(fieldtype: str) -> str:
	"""Perspective type of a Frappe fieldtype (twin of ``schema.perspective_type``)."""
	if fieldtype in FLOAT_TYPES:
		return "float"
	if fieldtype == "Date":
		return "date"
	if fieldtype == "Datetime":
		return "datetime"
	if fieldtype == "Check":
		return "boolean"
	return "string"


def _empty(value: Any) -> bool:
	return value is None or value == ""


def _to_float(value: Any) -> float | None:
	if isinstance(value, bool):
		return None
	if isinstance(value, int | float | Decimal):
		number = float(value)
		return number if math.isfinite(number) else None
	if not isinstance(value, str):
		return None
	text = value.strip()
	if not text or "_" in text:
		return None
	try:
		number = float(text)
	except ValueError:
		return None
	return number if math.isfinite(number) else None


def _to_date(value: Any) -> str | None:
	"""``YYYY-MM-DD`` (a datetime gives its date part), or None."""
	if isinstance(value, datetime.datetime):
		return value.date().isoformat()
	if isinstance(value, datetime.date):
		return value.isoformat()
	if not isinstance(value, str):
		return None
	head = value[:10] if len(value) > 10 and value[10] in " T" else value
	match = _DATE_RE.match(head)
	if not match:
		return None
	try:
		datetime.date(int(match[1]), int(match[2]), int(match[3]))
	except ValueError:
		return None
	return head


def _to_datetime(value: Any) -> float | None:
	"""Milliseconds since the epoch, reading the naive site datetime as UTC, or None."""
	if isinstance(value, datetime.datetime):
		value = value.replace(tzinfo=None).isoformat(sep=" ")
	elif isinstance(value, datetime.date):
		value = value.isoformat()
	if not isinstance(value, str):
		return None
	match = _DATETIME_RE.match(value.strip())
	if not match:
		return None
	hour, minute, second = int(match[4] or 0), int(match[5] or 0), int(match[6] or 0)
	if hour > 23 or minute > 59 or second > 59:
		return None
	try:
		day = datetime.date(int(match[1]), int(match[2]), int(match[3]))
	except ValueError:
		return None
	millis = int(float("0." + match[7]) * 1000) if match[7] else 0
	return float(((day - _EPOCH).days * 86400 + hour * 3600 + minute * 60 + second) * 1000 + millis)


def _to_boolean(value: Any) -> bool | None:
	if value is True or value is False:
		return value
	if value in (1, "1"):
		return True
	if value in (0, "0"):
		return False
	return None


def _to_string(value: Any) -> str | None:
	if _empty(value):
		return None
	if isinstance(value, str):
		return value
	if isinstance(value, bool):
		return "true" if value else "false"
	if isinstance(value, list | tuple):
		parts = [p for p in (_to_string(v) for v in value) if p is not None]
		return ", ".join(parts) if parts else None
	if isinstance(value, Decimal):
		value = float(value)
	if isinstance(value, float) and value.is_integer():
		return str(int(value))
	return str(value)


_CONVERT = {
	"float": _to_float,
	"date": _to_date,
	"datetime": _to_datetime,
	"boolean": _to_boolean,
	"string": _to_string,
}


def typed_value(row: dict, column: dict) -> Any:
	"""The value of a cell as the browser loads it into Perspective (``schema.convert``):
	converted to the type of its column, or None."""
	return _CONVERT[value_type(column["fieldtype"])](row.get(column["key"]))


# ------------------------------------------------------------- filters


def _ascii_lower(text: str) -> str:
	# Perspective lowers ASCII letters only in "contains" and "begins with".
	return text.translate(_ASCII_LOWER)


def effective_filters(filters: list[dict] | None, by_key: dict[str, dict]) -> list[dict]:
	"""The browser filters that narrow the rows (twin of ``view_config.to_filter``).

	A filter without a value (empty text, a range or a date without bounds, an exclusion of
	nothing) is no filter: the view keeps the shape it has without it. Filters the browser
	cannot express are refused before the engine runs (``view_state.check_exportable``).
	"""
	out = []
	for flt in filters or []:
		column = by_key.get(flt["key"])
		if column is None:
			continue
		ftype = flt["type"]
		if ftype == "text":
			if _empty(flt.get("value")):
				continue
		elif ftype == "set":
			if flt.get("exclude") and not flt.get("values"):
				continue
		elif ftype == "range":
			if flt.get("min") is None and flt.get("max") is None:
				continue
		elif ftype == "date":
			if not flt.get("from") and not flt.get("to"):
				continue
		out.append(flt)
	return out


def _row_matches(row: dict, flt: dict, column: dict) -> bool:
	ftype = flt["type"]
	value = typed_value(row, column)
	if ftype == "text":
		if value is None:
			return False
		op = flt.get("op") or "contains"
		if op == "equals":
			return value == flt["value"]
		hay, needle = _ascii_lower(value), _ascii_lower(flt["value"])
		return hay.startswith(needle) if op == "starts_with" else needle in hay
	if ftype == "set":
		values = {_to_string(v) for v in flt.get("values") or []}
		hit = value in values
		return not hit if flt.get("exclude") else hit
	if ftype == "range":
		if value is None:
			return False
		lo, hi = flt.get("min"), flt.get("max")
		return (lo is None or value >= lo) and (hi is None or value <= hi)
	if ftype == "date":
		if value is None:
			return False
		if not isinstance(value, str):
			value = (_EPOCH + datetime.timedelta(milliseconds=value)).isoformat()
		return (not flt.get("from") or value >= flt["from"]) and (not flt.get("to") or value <= flt["to"])
	return True


def filter_facts(facts: list[dict], filters: list[dict], by_key: dict[str, dict]) -> list[dict]:
	"""Facts that pass every (effective) browser filter."""
	if not filters:
		return list(facts)
	pairs = [(f, by_key[f["key"]]) for f in filters]
	return [r for r in facts if all(_row_matches(r, f, c) for f, c in pairs)]


# ---------------------------------------------------------------- sort


def _digit_value(char: str) -> int | None:
	try:
		return unicodedata.decimal(char)
	except ValueError:
		return None


def collation_key(text: str, lang: str | None = None) -> tuple:
	"""Approximation of ``Intl.Collator(lang, {numeric: true, sensitivity: "base"})``.

	Accents, case, hamza forms and the tatweel are ignored; digits (of any script) compare
	as numbers; punctuation stands before digits, digits before letters; in Arabic the
	Arabic letters stand before the others. Without ICU on the server the order of unusual
	characters can differ from the browser's; only the order of rows depends on it.
	"""
	base = "".join(
		c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c) and c != _TATWEEL
	).casefold()
	arabic_first = (lang or "").split("-")[0] == "ar"
	key: list[tuple] = []
	i = 0
	while i < len(base):
		digit = _digit_value(base[i])
		if digit is not None:
			number = 0
			while i < len(base) and (digit := _digit_value(base[i])) is not None:
				number = number * 10 + digit
				i += 1
			key.append((1, 0, number, ""))
			continue
		char = base[i]
		i += 1
		if not char.isalpha():
			key.append((0, 0, 0, char))
		else:
			script = 0 if arabic_first and "؀" <= char <= "ۿ" else 1
			key.append((2, script, 0, char))
	return tuple(key)


def _string_ranks(rows: list[dict], column: dict, lang: str | None) -> dict[str, int]:
	"""Rank of every text of a column (twin of ``schema.sort_keys``): texts the collator
	holds equal keep the order of their first row."""
	unique = list(dict.fromkeys(v for v in (typed_value(r, column) for r in rows) if v is not None))
	unique.sort(key=lambda v: collation_key(v, lang))
	return {v: i for i, v in enumerate(unique)}


class _Sorter:
	"""Sort values of the facts of one report: nulls are the largest value."""

	def __init__(self, table: list[dict], by_key: dict[str, dict], lang: str | None) -> None:
		self.table = table
		self.by_key = by_key
		self.lang = lang
		self._ranks: dict[str, dict[str, int]] = {}

	def of_value(self, value: Any, key: str) -> tuple:
		if value is None:
			return (1, 0)
		if isinstance(value, str) and value_type(self.by_key[key]["fieldtype"]) == "string":
			if key not in self._ranks:
				self._ranks[key] = _string_ranks(self.table, self.by_key[key], self.lang)
			return (0, self._ranks[key].get(value, len(self._ranks[key])))
		return (0, value)

	def of_row(self, row: dict, key: str) -> tuple:
		return self.of_value(typed_value(row, self.by_key[key]), key)

	def sort(self, rows: list[dict], sort: list[dict], value_of: Any = None) -> list[dict]:
		"""Stable multi-key sort; report order (``__rid``) breaks the ties."""
		out = list(rows)
		value_of = value_of or self.of_row
		for item in reversed(sort):
			out.sort(key=lambda r, k=item["key"]: value_of(r, k), reverse=item["dir"] == "desc")
		return out


# ---------------------------------------------------------- aggregation


def aggregate_name(column: dict, aggs: dict[str, str] | None = None) -> str | None:
	"""Aggregate of a column in this view (``values[].agg`` over the column's own), or None
	for a column that carries no total (twin of ``view_config.aggregate_of``)."""
	agg = (aggs or {}).get(column["key"]) or column.get("agg")
	if column.get("role") != "measure" or not agg or (column.get("original") or {}).get("disable_total"):
		return None
	return agg


def _is_mixed(rows: list[dict], column: dict) -> bool:
	"""More than one currency among the rows; a row without a currency counts as one
	(Perspective's distinct count of the currency column, phase-3-perspective §6.10)."""
	currency = column.get("currency") or {}
	if currency.get("kind") != "row":
		return False
	return len({_to_string(r.get(currency["key"])) for r in rows}) > 1


def aggregate(rows: list[dict], column: dict, agg: str | None = None) -> Any:
	"""Aggregate one column over rows with Perspective's null semantics (ADR-008)."""
	agg = aggregate_name(column, {column["key"]: agg} if agg else None)
	if agg is None:
		return None
	if _is_mixed(rows, column):
		return dict(MIXED)
	values = [_to_float(r.get(column["key"])) for r in rows]
	numbers = [n for n in values if n is not None]
	if agg == "count":
		return len(rows)
	if agg == "count_distinct":
		return len(set(values))
	if agg == "sum":
		total = math.fsum(numbers)
		return int(total) if column["fieldtype"] == "Int" else total
	if agg == "avg":
		return math.fsum(numbers) / len(numbers) if numbers else None
	if agg == "min":
		return min(numbers) if numbers else None
	if agg == "max":
		# The browser uses Perspective's "high", which counts an empty cell as 0
		# (docs/research/perspective-experiments.md 7); mirror it so the file equals the screen.
		return max(0 if n is None else n for n in values) if numbers else None
	return None


def totals_for(rows: list[dict], columns: list[dict], aggs: dict[str, str] | None = None) -> dict:
	"""Totals of the measure columns over rows; None where a column carries no total."""
	out = {}
	for col in columns:
		if col.get("role") != "measure":
			continue
		out[col["key"]] = aggregate(rows, col, (aggs or {}).get(col["key"])) if rows else None
	return out


def reported_totals(row: dict | None, columns: list[dict], aggs: dict[str, str] | None = None) -> dict:
	"""The grand total as a row of the report states it (its reference row or Frappe's total
	row): the report's own values, for the columns that carry a total."""
	out = {}
	for col in columns:
		if col.get("role") != "measure":
			continue
		value = (row or {}).get(col["key"])
		if isinstance(value, Decimal):
			value = float(value)
		is_number = isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)
		out[col["key"]] = value if is_number and aggregate_name(col, aggs) else None
	return out


# ---------------------------------------------------------------- columns


def screen_columns(nr: dict, state: dict) -> list[dict]:
	"""Columns the screen shows, in display order (twin of ``view_config.visible_columns``)."""
	cols_state = state.get("columns") or {}
	hidden = set(cols_state.get("hidden") or [])
	cols = [c for c in nr["columns"] if not c["hidden"] and c["key"] not in hidden]
	position = {key: i for i, key in enumerate(cols_state.get("order") or [])}
	return sorted(cols, key=lambda c: position.get(c["key"], len(position)))


def pinned_columns(shown: list[dict], state: dict) -> list[dict]:
	"""Columns pinned after the label column (twin of ``view_config.pinned_columns``):
	visible dimension or attribute columns of ``columns.pinned.start``, in its order."""
	wanted = ((state.get("columns") or {}).get("pinned") or {}).get("start") or []
	by_key = {c["key"]: c for c in shown[1:]}
	out: list[dict] = []
	for key in wanted:
		column = by_key.get(key)
		if column is not None and column["role"] != "measure" and column not in out:
			out.append(column)
	return out


def export_columns(
	nr: dict, state: dict, layout_columns: list[dict] | None, column_keys: list[str] | None
) -> tuple[list[dict], str | None]:
	"""Columns of the file in the order of the screen, and the key of the label column.

	The label column (first visible column), then ``columns.pinned.start``, then the others.
	``layout.columns`` (what the browser shows) gives the columns when it is sent; without it
	the visible columns plus the hidden ones a report exports (``export_hidden``).
	"""
	by_key = {c["key"]: c for c in nr["columns"]}
	cols_state = state.get("columns") or {}
	hidden = set(cols_state.get("hidden") or [])
	shown = screen_columns(nr, state)
	label_key = shown[0]["key"] if shown else None
	pinned = pinned_columns(shown, state)
	if layout_columns:
		keys = list(dict.fromkeys(c["key"] for c in layout_columns))
	else:
		position = {key: i for i, key in enumerate(cols_state.get("order") or [])}
		keys = sorted((c["key"] for c in nr["columns"]), key=lambda k: position.get(k, len(position)))

	pinned_keys = [c["key"] for c in pinned if c["key"] in keys]
	rest = [k for k in keys if k not in pinned_keys]
	at = rest.index(label_key) + 1 if label_key in rest else 0
	keys = rest[:at] + pinned_keys + rest[at:]

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
	if out and label_key not in [c["key"] for c in out]:
		label_key = out[0]["key"]
	return out, label_key


# ------------------------------------------------- the report's own rows


def _group_tail(between: list[dict]) -> list[str]:
	"""Kinds of the rows that close a group of the report: the summary rows right after a
	fact, in the last place where facts stand on both sides."""
	tail_kinds = (KIND_CLOSING, KIND_INTERNAL_TOTAL)
	for i in range(len(between) - 1, 0, -1):
		if between[i]["__kind"] != KIND_DATA or between[i - 1]["__kind"] == KIND_DATA:
			continue
		start = i - 1
		while start > 0 and between[start - 1]["__kind"] != KIND_DATA:
			start -= 1
		kinds = []
		for row in between[start:i]:
			if row["__kind"] not in tail_kinds:
				break
			kinds.append(row["__kind"])
		if kinds:
			return kinds
	return []


def edge_rows(nr: dict) -> dict:
	"""The summary rows that stand for the whole report (twin of ``report_rows.edge_rows``).

	Returns ``{top, bottom, reference, inner}``: ``__rid`` of the report's opening row, of
	its closing / total rows, of the reference total row (ADR-008: the last
	``internal_total``) when it closes the report, and the number of summary rows of the
	report's own groups (between the facts). Read from the order of the kinds alone.
	"""
	none = {"top": [], "bottom": [], "reference": None, "inner": 0}
	if nr.get("tree"):
		return none
	rows = [r for r in nr["rows"] if r["__kind"] != KIND_SEPARATOR]
	data_at = [i for i, r in enumerate(rows) if r["__kind"] == KIND_DATA]
	if not data_at:
		return none
	first, last = data_at[0], data_at[-1]
	between = rows[first : last + 1]

	leading = [r for r in rows[:first] if r["__kind"] == KIND_OPENING]
	groups_open = any(r["__kind"] == KIND_OPENING for r in between)
	top = leading[:1] if len(leading) >= (2 if groups_open else 1) else []

	trailing = [r for r in rows[last + 1 :] if r["__kind"] in (KIND_CLOSING, KIND_INTERNAL_TOTAL)]
	tail = _group_tail(between)
	own = 0
	while own < len(tail) and own < len(trailing) and trailing[own]["__kind"] == tail[own]:
		own += 1
	closing = trailing[own:]

	internal = nr["report_totals"]["internal"]
	reference = internal[-1]["__rid"] if internal else None
	if reference not in [r["__rid"] for r in closing]:
		reference = None
	bottom = [r["__rid"] for r in closing if r["__rid"] != reference]
	summary = sum(1 for r in rows if r["__kind"] in SUMMARY_KINDS or r["__kind"] == KIND_GROUP_HEADER)
	shown = len(top) + len(bottom) + (0 if reference is None else 1)
	return {
		"top": [r["__rid"] for r in top],
		"bottom": bottom,
		"reference": reference,
		"inner": summary - shown,
	}


# ------------------------------------------------------------------ tree


def tree_index(nr: dict) -> dict[int, dict]:
	"""Structure of the report tree from ``__parent`` (twin of ``tree_nodes.tree_index``).

	Per ``__rid``: ``{row, depth, ancestors (top-down), children, top}``; ``top`` marks the
	data rows without a data row above them (the total of a tree without a reference row).
	"""
	info: dict[int, dict] = {}
	for row in nr["rows"]:
		if row["__kind"] not in NODE_KINDS:
			continue
		up = info.get(row["__parent"]) if row["__parent"] is not None else None
		ancestors = [*up["ancestors"], row["__parent"]] if up else []
		data_above = bool(up) and (up["row"]["__kind"] == KIND_DATA or up["data_above"])
		info[row["__rid"]] = {
			"row": row,
			"depth": len(ancestors),
			"ancestors": ancestors,
			"children": [],
			"data_above": data_above,
			"top": row["__kind"] == KIND_DATA and not data_above,
		}
		if up:
			up["children"].append(row["__rid"])
	return info


def row_label(row: dict, label_key: str | None, columns: list[dict]) -> str | None:
	"""Text that names a tree row: its label column, else its first dimension with a value."""
	if label_key and not _empty(row.get(label_key)):
		return _to_string(row[label_key])
	for col in columns:
		if col["role"] == "dimension" and not _empty(row.get(col["key"])):
			return _to_string(row[col["key"]])
	return None


def _tree_open(nr: dict, state: dict, info: dict[int, dict]) -> Any:
	"""``open(rid)`` of the parents of the report tree: the listed parents once the user
	folded one (``tree.expanded``), else every parent above ``tree.depth``."""
	tree_state = state.get("tree") or {}
	expanded = tree_state.get("expanded")
	if isinstance(expanded, list):
		listed = set(expanded)
		return lambda rid: rid in listed
	depth = tree_state.get("depth")
	if depth is None:
		depth = (nr.get("tree") or {}).get("initial_depth")
	if depth is None:
		depth = DEFAULT_TREE_DEPTH
	return lambda rid: info[rid]["depth"] < depth


# ------------------------------------------------------------------ rows


def _out_row(
	kind: str,
	level: int,
	values: dict,
	*,
	rid: int | None = None,
	label: str | None = None,
	group_key: str | None = None,
	group_value: Any = None,
	count: int | None = None,
	is_open: bool | None = None,
	hidden: bool = False,
	bold: bool | None = None,
) -> dict:
	return {
		"kind": kind,
		"level": level,
		"values": values,
		"rid": rid,
		"label": label,
		"group_key": group_key,
		"group_value": group_value,
		"count": count,
		"open": is_open,
		"hidden": hidden,
		"bold": kind != KIND_DATA if bold is None else bold,
	}


def _data_row(row: dict, level: int = 0, hidden: bool = False) -> dict:
	bold = row["__kind"] != KIND_DATA or bool(row.get("__bold"))
	return _out_row(row["__kind"], level, row, rid=row["__rid"], hidden=hidden, bold=bold)


def _path_element(value: Any) -> tuple:
	"""One element of a group path as Perspective names it (``__ROW_PATH__``): text, number
	(a date is its epoch milliseconds), boolean or null."""
	if value is None:
		return ("null", None)
	if isinstance(value, bool):
		return ("boolean", value)
	if isinstance(value, int | float):
		return ("number", float(value))
	return ("string", str(value))


def _group_path_value(value: Any, column: dict) -> tuple:
	if value is not None and value_type(column["fieldtype"]) == "date":
		day = datetime.date.fromisoformat(value)
		return ("number", float((day - _EPOCH).days * 86400000))
	return _path_element(value)


class _View:
	"""One application of a view state: what every shape shares."""

	def __init__(self, nr: dict, state: dict, lang: str | None) -> None:
		self.nr = nr
		self.state = state
		self.by_key = {c["key"]: c for c in nr["columns"]}
		self.measures = [c for c in nr["columns"] if c["role"] == "measure"]
		self.measure_keys = {c["key"] for c in self.measures}
		shown = screen_columns(nr, state)
		# The column that names a row on screen: the first visible one.
		self.label_key = shown[0]["key"] if shown else None
		self._open_paths: set[tuple] = set()
		self.aggs = {v["key"]: v["agg"] for v in state.get("values") or []}
		group = state.get("group") or {}
		self.subtotals = group.get("subtotals", True) is not False
		self.expanded = group.get("expanded", "all")
		self.sorter = _Sorter(nr["facts"], self.by_key, lang)
		self.rows: list[dict] = []

	def totals(self, rows: list[dict]) -> dict:
		return totals_for(rows, self.measures, self.aggs)

	def _numbers(self, values: dict) -> dict:
		return {c["key"]: values.get(c["key"]) for c in self.measures}

	def add_group(
		self,
		level: int,
		members: list[dict],
		is_open: bool,
		hidden: bool,
		*,
		label: str | None,
		group_key: str | None = None,
		group_value: Any = None,
		rid: int | None = None,
	) -> dict | None:
		"""A group row computed by the engine. Returns its subtotal row, to be added after
		the rows of the group, when the group is open and subtotals are asked for."""
		totals = self.totals(members)
		moved = self.subtotals and is_open
		named = {"rid": rid, "label": label, "group_key": group_key, "group_value": group_value}
		self.rows.append(
			_out_row(
				KIND_GROUP,
				level,
				{} if moved else totals,
				count=len(members),
				is_open=is_open,
				hidden=hidden,
				**named,
			)
		)
		return _out_row(KIND_FOOT, level, totals, hidden=hidden, **named) if moved else None

	# -- group.by

	def _group_open(self, path: tuple) -> bool:
		if self.expanded == "none":
			return False
		if isinstance(self.expanded, list):
			return path in self._open_paths
		return True

	def group(self, facts: list[dict], keys: list[str], sort: list[dict]) -> None:
		if isinstance(self.expanded, list):
			self._open_paths = {tuple(_path_element(v) for v in path) for path in self.expanded}
		direction = {s["key"]: s["dir"] for s in self.state.get("sort") or []}
		leaf_sort = [s for s in sort if s["key"] not in keys]
		self._group_level(facts, keys, 0, (), False, direction, leaf_sort)

	def _leaf_sort_value(self, row: dict, key: str) -> tuple:
		# A fact is the last level of the grouping: its sort value is its own aggregate
		# (the sum of a null is 0).
		column = self.by_key[key]
		if aggregate_name(column, self.aggs) is not None:
			value = aggregate([row], column, self.aggs.get(key))
			return self.sorter.of_value(None if isinstance(value, dict) else value, key)
		return self.sorter.of_row(row, key)

	def _group_level(
		self,
		facts: list[dict],
		keys: list[str],
		level: int,
		path: tuple,
		hidden: bool,
		direction: dict[str, str],
		leaf_sort: list[dict],
	) -> None:
		if level >= len(keys):
			for row in self.sorter.sort(facts, leaf_sort, self._leaf_sort_value):
				self.rows.append(_data_row(row, level, hidden))
			return
		key = keys[level]
		column = self.by_key[key]
		buckets: dict[Any, list[dict]] = {}
		for row in facts:
			buckets.setdefault(typed_value(row, column), []).append(row)
		ordered = sorted(
			buckets.items(),
			key=lambda item: self.sorter.of_value(item[0], key),
			reverse=direction.get(key) == "desc",
		)
		for value, members in ordered:
			here = (*path, _group_path_value(value, column))
			is_open = self._group_open(here)
			raw = members[0].get(key) if value is not None else None
			foot = self.add_group(level, members, is_open, hidden, label=None, group_key=key, group_value=raw)
			self._group_level(members, keys, level + 1, here, hidden or not is_open, direction, leaf_sort)
			if foot:
				self.rows.append(foot)

	# -- the report tree

	def tree(self, info: dict[int, dict]) -> None:
		"""The tree "as is": the rows of the report with their own values."""
		is_open = _tree_open(self.nr, self.state, info)
		pending: list[tuple[int, dict]] = []
		for rid, node in info.items():
			depth, row = node["depth"], node["row"]
			while pending and pending[-1][0] >= depth:
				self.rows.append(pending.pop()[1])
			hidden = any(not is_open(a) for a in node["ancestors"])
			if not node["children"]:
				self.rows.append(_data_row(row, depth, hidden))
				continue
			opened = is_open(rid)
			moved = self.subtotals and opened
			values = {k: v for k, v in row.items() if k not in self.measure_keys} if moved else row
			self.rows.append(
				_out_row(KIND_PARENT, depth, values, rid=rid, is_open=opened, hidden=hidden, bold=True)
			)
			if moved:
				label = row_label(row, self.label_key, self.nr["columns"])
				foot = _out_row(KIND_FOOT, depth, self._numbers(row), rid=rid, label=label, hidden=hidden)
				pending.append((depth, foot))
		while pending:
			self.rows.append(pending.pop()[1])

	def levels(self, info: dict[int, dict], facts: list[dict]) -> None:
		"""The tree re-grouped from the matching leaves: a parent aggregates its leaves."""
		is_open = _tree_open(self.nr, self.state, info)
		members: dict[int, list[dict]] = {}
		for fact in facts:
			for rid in info[fact["__rid"]]["ancestors"]:
				members.setdefault(rid, []).append(fact)
		kept = {f["__rid"] for f in facts} | set(members)

		def walk(rid: int, hidden: bool) -> None:
			node = info[rid]
			row = node["row"]
			if rid not in members:
				self.rows.append(_data_row(row, node["depth"], hidden))
				return
			opened = is_open(rid)
			label = row_label(row, self.label_key, self.nr["columns"])
			foot = self.add_group(node["depth"], members[rid], opened, hidden, label=label, rid=rid)
			for child in node["children"]:
				if child in kept:
					walk(child, hidden or not opened)
			if foot:
				self.rows.append(foot)

		for rid, node in info.items():
			if node["depth"] == 0 and rid in kept:
				walk(rid, False)


# ------------------------------------------------------------------ apply


def apply(
	nr: dict,
	state: dict,
	selection: dict | None = None,
	layout_columns: list[dict] | None = None,
	lang: str | None = None,
) -> dict:
	"""Apply a validated view state.

	Returns ``{columns, label_key, rows, totals, total_source, row_count, layout_mode}``.
	``rows``: ``{kind, level, values, rid, label, group_key, count, open, hidden, bold}``
	with ``kind`` a row kind of the report, ``parent``, ``group`` or ``foot``.
	``total_source``: ``reference`` (the report's own row), ``frappe_total`` or ``engine``.
	``row_count``: the facts that pass the browser filters (and the selection).
	"""
	state = state or {}
	view = _View(nr, state, lang)
	by_key = view.by_key
	filters = effective_filters(state.get("filters"), by_key)
	row_rids = set(selection["row_rids"]) if selection and selection.get("row_rids") is not None else None
	column_keys = selection.get("column_keys") if selection else None
	columns, label_key = export_columns(nr, state, layout_columns, column_keys)

	facts = filter_facts(nr["facts"], filters, by_key)
	if row_rids is not None:
		facts = [r for r in facts if r["__rid"] in row_rids]
	narrowed = bool(filters) or row_rids is not None
	group_keys = [k for k in (state.get("group") or {}).get("by") or [] if k in by_key]
	sort = [s for s in state.get("sort") or [] if s["key"] in by_key]
	by_rid = {r["__rid"]: r for r in nr["rows"]}
	internal = nr["report_totals"]["internal"]

	totals = view.totals(facts)
	total_source = "engine"
	if group_keys:
		layout_mode = "group"
		view.group(facts, group_keys, sort)
	elif nr.get("tree"):
		info = tree_index(nr)
		if narrowed:
			layout_mode = "levels"
			view.levels(info, [f for f in facts if f["__rid"] in info])
		else:
			layout_mode = "tree"
			view.tree(info)
			if internal:
				totals, total_source = reported_totals(internal[-1], view.measures, view.aggs), "reference"
			elif nr["report_totals"]["frappe_total"]:
				totals = reported_totals(nr["report_totals"]["frappe_total"], view.measures, view.aggs)
				total_source = "frappe_total"
			else:
				totals = view.totals([n["row"] for n in info.values() if n["top"]])
	else:
		layout_mode = "flat"
		if narrowed:
			view.rows = [_data_row(r) for r in view.sorter.sort(facts, sort)]
		else:
			edges = edge_rows(nr)
			pinned = {*edges["top"], *edges["bottom"]}
			if edges["reference"] is not None:
				pinned.add(edges["reference"])
				totals = reported_totals(by_rid[edges["reference"]], view.measures, view.aggs)
				total_source = "reference"
			if sort or not edges["inner"]:
				body = view.sorter.sort(facts, sort)
			else:
				# The rows as the report returned them: the summary rows of its own groups
				# stay between the facts they close.
				body = [r for r in nr["rows"] if r["__kind"] != KIND_SEPARATOR and r["__rid"] not in pinned]
			top = [by_rid[rid] for rid in edges["top"]]
			bottom = [by_rid[rid] for rid in edges["bottom"]]
			view.rows = [_data_row(r) for r in [*top, *body, *bottom]]

	return {
		"columns": columns,
		"label_key": label_key,
		"rows": view.rows,
		"totals": totals,
		"total_source": total_source,
		"row_count": len(facts),
		"layout_mode": layout_mode,
	}
