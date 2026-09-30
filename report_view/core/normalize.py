"""Python twin of adapter/normalize.js (docs/architecture.md §3).

Pure functions: no database access and no permission logic. Input is the raw
response of ``frappe.desk.query_report.run`` (as returned by ``api.run``), the
current report filters, the report JS settings object (``report_settings``:
``tree``, ``name_field``, ``parent_field``, ``initial_depth``,
``export_hidden_cols``) and an optional ``register`` config (JSON subset of
§5.1: ``tree``, ``columns``, ``group_header_key``).

The output (``NormalizedReport``) is JSON-serialisable and must be identical
to the JS adapter's output for the shared cases in
``report_view/tests/fixtures/normalize/*.json``.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

# Canonical Frappe field types (case-insensitive match, N1.3).
FIELDTYPES: tuple[str, ...] = (
	"Autocomplete",
	"Attach",
	"Attach Image",
	"Barcode",
	"Button",
	"Check",
	"Code",
	"Color",
	"Column Break",
	"Currency",
	"Data",
	"Date",
	"Datetime",
	"Duration",
	"Dynamic Link",
	"Float",
	"Fold",
	"Geolocation",
	"Heading",
	"HTML",
	"HTML Editor",
	"Icon",
	"Image",
	"Int",
	"JSON",
	"Link",
	"Long Text",
	"Markdown Editor",
	"Password",
	"Percent",
	"Phone",
	"Rating",
	"Read Only",
	"Section Break",
	"Select",
	"Signature",
	"Small Text",
	"Tab Break",
	"Table",
	"Table MultiSelect",
	"Text",
	"Text Editor",
	"Time",
)
_FIELDTYPE_BY_LOWER = {ft.lower(): ft for ft in FIELDTYPES}

MEASURE_TYPES = frozenset(("Currency", "Float", "Int", "Percent", "Duration"))
DIMENSION_TYPES = frozenset(("Link", "Dynamic Link", "Data", "Select", "Date", "Datetime", "Check"))
DATE_TYPES = frozenset(("Date", "Datetime"))
ROLES = frozenset(("dimension", "measure", "attribute"))
AGGS = frozenset(("sum", "avg", "count", "min", "max"))

KIND_DATA = "data"
KIND_FRAPPE_TOTAL = "frappe_total"
KIND_INTERNAL_TOTAL = "internal_total"
KIND_OPENING = "opening"
KIND_CLOSING = "closing"
KIND_GROUP_HEADER = "group_header"
KIND_SEPARATOR = "separator"
SUMMARY_KINDS = frozenset((KIND_INTERNAL_TOTAL, KIND_OPENING, KIND_CLOSING))

META_KEYS = ("__rid", "__kind", "__indent", "__parent", "__is_leaf", "__bold", "__label_raw")

# A Link whose options look like a fieldname (snake_case) refers to a report filter (N1.8).
_FILTER_OPTION_RE = re.compile(r"^[a-z_][a-z0-9_]*$")
_COMPANY_CURRENCY_RE = re.compile(r"^Company:([^:]+):default_currency$")

Translate = Callable[[str], str]


def scrub(txt: Any) -> str:
	"""Same rule as ``frappe.scrub``: spaces and dashes to underscores, lower case."""
	return ("" if txt is None else str(txt)).replace(" ", "_").replace("-", "_").lower()


def normalize(
	raw: dict,
	filters: dict | None = None,
	report_settings: dict | None = None,
	register: dict | None = None,
	translate: Translate | None = None,
) -> dict:
	"""Build a NormalizedReport (§3.1) from a raw ``run`` response (N1-N5)."""
	raw = raw or {}
	filters = filters or {}
	report_settings = report_settings or {}
	register = register or {}
	translate = translate or (lambda s: s)
	notices: list[dict] = []

	raw_rows = list(raw.get("result") or [])
	add_total_row = bool(raw.get("add_total_row"))
	skip_raw = raw.get("skip_total_row")
	skip_total_row = bool(skip_raw)
	if skip_raw not in (None, True, False, 0, 1):
		notices.append({"code": "SKIP_TOTAL_NON_BOOL", "detail": skip_raw})

	# N2.1: Frappe total row = last row, a list, when add_total_row and not skip_total_row.
	frappe_total_raw = None
	if raw_rows and isinstance(raw_rows[-1], list | tuple) and add_total_row and not skip_total_row:
		frappe_total_raw = raw_rows.pop()

	first_dict = next((r for r in raw_rows if isinstance(r, dict) and r), None)
	columns = _build_columns(
		raw.get("columns") or [], first_dict, filters, report_settings, register, notices
	)

	# N2.2: every row becomes a dict keyed by column key.
	has_list = any(isinstance(r, list | tuple) for r in raw_rows)
	has_dict = any(isinstance(r, dict) for r in raw_rows)
	rows = [_row_to_dict(r, columns) for r in raw_rows]

	tree_enabled = _tree_enabled(rows, register)
	label_key = _label_key(columns, report_settings, register)

	_classify_rows(rows, columns, label_key, tree_enabled, register, translate)
	if tree_enabled:
		_build_tree(rows, report_settings, notices)
	else:
		for row in rows:
			row["__indent"] = None
			row["__parent"] = None
			row["__is_leaf"] = True

	facts = [r for r in rows if r["__kind"] == KIND_DATA and (not tree_enabled or r["__is_leaf"])]

	tree = None
	if tree_enabled:
		reg_tree = register.get("tree") or {}
		initial_depth = reg_tree.get("initial_depth")
		if initial_depth is None:
			initial_depth = report_settings.get("initial_depth")
		if initial_depth is None:
			initial_depth = 2
		tree = {
			"enabled": True,
			"id_key": "__rid",
			"parent_key": "__parent",
			"label_key": label_key,
			"initial_depth": initial_depth,
		}

	frappe_total = None
	if frappe_total_raw is not None:
		frappe_total = {}
		for col in columns:
			idx = col["source_index"]
			frappe_total[col["key"]] = frappe_total_raw[idx] if idx < len(frappe_total_raw) else None

	return {
		"columns": columns,
		"rows": rows,
		"facts": facts,
		"tree": tree,
		"report_totals": {
			"frappe_total": frappe_total,
			"internal": [r for r in rows if r["__kind"] == KIND_INTERNAL_TOTAL],
		},
		"message": raw.get("message") or None,
		"chart": _normalize_chart(raw.get("chart")),
		"report_summary": raw.get("report_summary") or None,
		"flags": {
			"add_total_row": add_total_row,
			"skip_total_row": skip_total_row,
			"prepared": bool(raw.get("prepared_report")),
			"mixed_row_shapes": has_list and has_dict,
		},
		"notices": notices,
	}


# ---------------------------------------------------------------- N1 columns


def _parse_column(col: Any) -> dict:
	"""Same rule as ``get_column_as_dict`` (Q:1094-1117)."""
	if isinstance(col, str):
		parts = col.split(":")
		out: dict = {}
		if len(parts) > 1:
			if "/" in parts[1]:
				out["fieldtype"], out["options"] = parts[1].split("/", 1)
			else:
				out["fieldtype"] = parts[1]
			if len(parts) == 3:
				out["width"] = parts[2]
		out["label"] = parts[0]
		out["fieldname"] = scrub(parts[0])
		return out
	out = dict(col or {})
	if not out.get("fieldname"):
		out["fieldname"] = scrub(out.get("label"))
	return out


def _canonical_fieldtype(value: Any, fieldname: str, notices: list[dict]) -> str:
	if value in (None, ""):
		return "Data"
	value = str(value)
	if value in FIELDTYPES:
		return value
	canonical = _FIELDTYPE_BY_LOWER.get(value.lower())
	if canonical:
		notices.append({"code": "FIELDTYPE_CASE", "detail": fieldname})
		return canonical
	notices.append({"code": "FIELDTYPE_UNKNOWN", "detail": fieldname})
	return value


def _to_int_or_none(value: Any) -> int | None:
	if value in (None, ""):
		return None
	try:
		return int(float(value))
	except TypeError, ValueError:
		return None


def _build_columns(
	raw_columns: list,
	first_row: dict | None,
	filters: dict,
	report_settings: dict,
	register: dict,
	notices: list[dict],
) -> list[dict]:
	columns: list[dict] = []
	seen: dict[str, int] = {}
	export_hidden_cols = report_settings.get("export_hidden_cols") is True
	for idx, raw_col in enumerate(raw_columns):
		col = _parse_column(raw_col)
		fieldname = col["fieldname"]
		seen[fieldname] = seen.get(fieldname, 0) + 1
		key = fieldname if seen[fieldname] == 1 else f"{fieldname}__{seen[fieldname]}"
		fieldtype = _canonical_fieldtype(col.get("fieldtype"), fieldname, notices)
		hidden = bool(col.get("hidden")) and str(col.get("hidden")) not in ("0", "False", "false")
		columns.append(
			{
				"key": key,
				"fieldname": fieldname,
				"label": col.get("label") if col.get("label") is not None else fieldname,
				"fieldtype": fieldtype,
				"options": col.get("options") if col.get("options") not in ("",) else None,
				"width": _to_int_or_none(col.get("width")),
				"hidden": hidden,
				"export_hidden": hidden and export_hidden_cols,
				"role": None,
				"agg": None,
				"currency": None,
				"link": None,
				"date": fieldtype in DATE_TYPES,
				"source_index": idx,
				"original": col,
			}
		)

	fieldnames = {c["fieldname"] for c in columns}
	row_keys = set(first_row.keys()) if first_row else set()
	currency_refs: set[str] = set()
	for col in columns:
		if col["fieldtype"] == "Currency":
			col["currency"] = _currency_of(col["options"], fieldnames, row_keys)
			if col["currency"]["kind"] == "row":
				currency_refs.add(col["currency"]["key"])
		col["link"] = _link_of(col, filters)

	list_valued = {k for k, v in (first_row or {}).items() if isinstance(v, list)}
	overrides = register.get("columns") or {}
	for col in columns:
		ft = col["fieldtype"]
		if col["hidden"] or col["fieldname"] in currency_refs or col["fieldname"] in list_valued:
			role = "attribute"
		elif ft in MEASURE_TYPES:
			role = "measure"
		elif ft in DIMENSION_TYPES:
			role = "dimension"
		else:
			role = "attribute"
		agg = ("avg" if ft == "Percent" else "sum") if role == "measure" else None
		override = overrides.get(col["fieldname"]) or {}
		if override.get("role") in ROLES:
			role = override["role"]
			if role != "measure":
				agg = None
			elif agg is None:
				agg = "avg" if ft == "Percent" else "sum"
		if "agg" in override and (override["agg"] in AGGS or override["agg"] is None):
			agg = override["agg"]
		col["role"] = role
		col["agg"] = agg
	return columns


def _currency_of(options: Any, fieldnames: set[str], row_keys: set[str]) -> dict:
	if options:
		if options in fieldnames or options in row_keys:
			return {"kind": "row", "key": options}
		match = _COMPANY_CURRENCY_RE.match(str(options))
		if match:
			return {"kind": "company", "company_key": match.group(1)}
	return {"kind": "system"}


def _link_of(col: dict, filters: dict) -> dict | None:
	options = col["options"]
	if not options:
		return None
	if col["fieldtype"] == "Dynamic Link":
		return {"kind": "dynamic", "doctype_key": options}
	if col["fieldtype"] == "Link":
		if options in filters or _FILTER_OPTION_RE.match(str(options)):
			return {"kind": "filter", "filter": options}
		return {"kind": "static", "doctype": options}
	return None


# ------------------------------------------------------------- N2 row shapes


def _row_to_dict(raw_row: Any, columns: list[dict]) -> dict:
	if isinstance(raw_row, list | tuple):
		row = {}
		for col in columns:
			idx = col["source_index"]
			row[col["key"]] = raw_row[idx] if idx < len(raw_row) else None
		return row
	row = dict(raw_row or {})
	for col in columns:
		if col["key"] not in row:
			row[col["key"]] = row.get(col["fieldname"])
	return row


# ------------------------------------------------------------ N3 classify


def _has_value(value: Any) -> bool:
	return value is not None and value != ""


def _is_nonzero_measure(value: Any) -> bool:
	if not _has_value(value):
		return False
	if isinstance(value, bool):
		return value
	if isinstance(value, int | float):
		return value != 0
	return True


def _is_quoted(value: Any) -> bool:
	return isinstance(value, str) and len(value) >= 2 and value[0] == "'" and value[-1] == "'"


def _classify_rows(
	rows: list[dict],
	columns: list[dict],
	label_key: str | None,
	tree_enabled: bool,
	register: dict,
	translate: Translate,
) -> None:
	dims = [c["key"] for c in columns if c["role"] == "dimension"]
	measures = [c["key"] for c in columns if c["role"] == "measure"]
	# The label column is checked first, then every other dimension column (GL keeps
	# 'Opening' in `account`, AR keeps "Total" in `party`).
	label_scan = ([label_key] if label_key else []) + [k for k in dims if k != label_key]
	total_words = {"Total", translate("Total")}
	group_header_key = register.get("group_header_key")

	for rid, row in enumerate(rows):
		row["__rid"] = rid
		row["__bold"] = bool(row.get("bold"))
		row["__label_raw"] = None
		kind = None

		# N3.1 separator: no dimension value and no non-zero measure.
		if not any(_has_value(row.get(k)) for k in dims) and not any(
			_is_nonzero_measure(row.get(k)) for k in measures
		):
			kind = KIND_SEPARATOR

		# N3.2 quoted label.
		if kind is None:
			for key in label_scan:
				value = row.get(key)
				if _is_quoted(value):
					label = value[1:-1]
					row["__label_raw"] = value
					row[key] = label
					if label == "Opening":
						kind = KIND_OPENING
					elif label == "Closing (Opening + Total)":
						kind = KIND_CLOSING
					else:
						kind = KIND_INTERNAL_TOTAL
					break

		# N3.3 bold total without quotes.
		if kind is None and row["__bold"]:
			if any(row.get(k) in total_words for k in label_scan):
				kind = KIND_INTERNAL_TOTAL

		# N3.4 (register.classify_row) is JS-only: functions do not cross to Python.

		# N3.5 group header in tree reports: no indent, next row indented.
		if kind is None and tree_enabled and row.get("indent") is None:
			nxt = rows[rid + 1] if rid + 1 < len(rows) else None
			if nxt is not None and _num(nxt.get("indent")) > 0:
				kind = KIND_GROUP_HEADER

		# N3.6 group header without indent.
		if kind is None and measures:
			if group_header_key:
				if _has_value(row.get(group_header_key)) and not any(
					_has_value(row.get(k)) for k in dims + measures if k != group_header_key
				):
					kind = KIND_GROUP_HEADER
			elif not any(_has_value(row.get(k)) for k in measures) and (
				sum(1 for k in dims if _has_value(row.get(k))) == 1
			):
				kind = KIND_GROUP_HEADER

		row["__kind"] = kind or KIND_DATA

	# N3.7 refinement: in a flat report that carries an unquoted bold "Total" (N3.3),
	# the other bold rows are the report's own subtotals (AR group_by_party), not
	# facts; counting them would double every total (ADR-008).
	if not tree_enabled:
		has_bold_total = any(
			r["__kind"] == KIND_INTERNAL_TOTAL and r["__bold"] and r["__label_raw"] is None for r in rows
		)
		if has_bold_total:
			for row in rows:
				if row["__kind"] == KIND_DATA and row["__bold"]:
					row["__kind"] = KIND_INTERNAL_TOTAL


def _num(value: Any) -> float:
	if isinstance(value, bool) or value is None or value == "":
		return 0
	try:
		return float(value)
	except TypeError, ValueError:
		return 0


# ----------------------------------------------------------------- N4 tree


def _tree_enabled(rows: list[dict], register: dict) -> bool:
	reg_tree = register.get("tree") or {}
	if reg_tree.get("enabled") is False:
		return False
	if reg_tree.get("enabled") is True:
		return True
	return any("indent" in r for r in rows)


def _label_key(columns: list[dict], report_settings: dict, register: dict) -> str | None:
	reg_tree = register.get("tree") or {}
	keys = {c["key"] for c in columns}
	for candidate in (reg_tree.get("label_key"), report_settings.get("name_field")):
		if candidate and candidate in keys:
			return candidate
	for col in columns:
		if col["role"] == "dimension" and not col["hidden"]:
			return col["key"]
	return None


def _build_tree(rows: list[dict], report_settings: dict, notices: list[dict]) -> None:
	stack: list[tuple[float, int]] = []
	tree_rows: list[dict] = []
	for row in rows:
		indent = row.get("indent")
		row["__indent"] = _clean_number(indent) if _has_value(indent) else None
		row["__parent"] = None
		row["__is_leaf"] = True
		if row["__kind"] in SUMMARY_KINDS or row["__kind"] == KIND_SEPARATOR:
			continue
		level = _num(indent) if _has_value(indent) else 0
		while stack and stack[-1][0] >= level:
			stack.pop()
		row["__parent"] = stack[-1][1] if stack else None
		stack.append((level, row["__rid"]))
		tree_rows.append(row)

	for i, row in enumerate(tree_rows):
		nxt = tree_rows[i + 1] if i + 1 < len(tree_rows) else None
		level = _num(row.get("indent"))
		row["__is_leaf"] = nxt is None or _num(nxt.get("indent")) <= level

	name_field = report_settings.get("name_field")
	parent_field = report_settings.get("parent_field")
	if name_field and parent_field:
		by_rid = {r["__rid"]: r for r in rows}
		for row in tree_rows:
			parent = by_rid.get(row["__parent"]) if row["__parent"] is not None else None
			expected = parent.get(name_field) if parent else None
			actual = row.get(parent_field)
			if (expected or None) != (actual or None):
				notices.append({"code": "TREE_PARENT_MISMATCH", "detail": row["__rid"]})


def _clean_number(value: Any) -> Any:
	if isinstance(value, float) and value.is_integer():
		return int(value)
	return value


# ------------------------------------------------------------------- N5


def _normalize_chart(chart: Any) -> Any:
	if not chart:
		return None
	return chart
