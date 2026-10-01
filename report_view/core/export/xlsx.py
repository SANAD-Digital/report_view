"""Excel export with openpyxl (docs/architecture.md §4.3, §9.2).

Values are raw (never HTML from a formatter). Numbers keep their numeric type
with a number format built from the system precision; dates are real dates
with the system date format.

Rows follow the screen (``core/engine.py``): every row is written with its outline
level; the rows under a folded group or parent are hidden and the folded row is
marked collapsed, so Excel opens them with its own outline buttons.
"""

import datetime
import re
from io import BytesIO
from typing import Any

import frappe
from frappe import _
from frappe.utils.jinja_globals import is_rtl
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from report_view.core.export.model import column_precision

NUMERIC_TYPES = ("Currency", "Float", "Int", "Percent", "Duration")
_SHEET_TITLE_BAD = re.compile(r"[\\/*?:\[\]]")
MIXED_MARK = "—"


def _number_format(precision: int) -> str:
	return "#,##0" + ("." + "0" * precision if precision > 0 else "")


def _date_format() -> str:
	fmt = frappe.db.get_single_value("System Settings", "date_format") or "yyyy-mm-dd"
	return fmt.lower()


def _cell_value(value: Any, column: dict) -> Any:
	if value is None or value == "":
		return None
	if isinstance(value, dict) and value.get("mixed"):
		return MIXED_MARK
	ft = column["fieldtype"]
	if ft in NUMERIC_TYPES and not isinstance(value, bool):
		try:
			return float(value) if ft != "Int" else int(float(value))
		except TypeError, ValueError:
			return str(value)
	if ft == "Date" and isinstance(value, str) and len(value) >= 10:
		try:
			return datetime.date.fromisoformat(value[:10])
		except ValueError:
			return value
	if ft == "Datetime" and isinstance(value, str):
		try:
			return datetime.datetime.fromisoformat(value)
		except ValueError:
			return value
	if isinstance(value, list):
		return ", ".join(str(v) for v in value)
	if isinstance(value, int | float | bool | datetime.date):
		return value
	return str(value)


def _filters_text(filters: dict) -> str:
	parts = []
	for key, value in filters.items():
		if value in (None, "", []) or (value == 0 and isinstance(value, int) and not isinstance(value, bool)):
			continue
		if isinstance(value, list):
			value = ", ".join(str(v) for v in value)
		parts.append(f"{_(frappe.unscrub(key))}: {value}")
	return " | ".join(parts)


def _group_label(out: dict, by_key: dict[str, dict]) -> str:
	"""Text that names a group row or the group of a subtotal row."""
	if out["label"] is not None:
		return out["label"]
	value = out["group_value"]
	if value is None or value == "":
		return _("Not Set")
	fieldtype = (by_key.get(out["group_key"]) or {}).get("fieldtype")
	if fieldtype == "Date":
		return frappe.utils.formatdate(value)
	if fieldtype == "Datetime":
		return frappe.utils.format_datetime(value)
	if isinstance(value, list):
		return ", ".join(str(v) for v in value)
	return str(value)


def _bands(columns: list[dict], balance_pairs: list[dict]) -> dict[int, tuple[int, str]]:
	"""Column-index -> (span, label) for adjacent debit/credit pairs."""
	index = {c["key"]: i for i, c in enumerate(columns)}
	bands = {}
	for pair in balance_pairs:
		d, c = index.get(pair.get("debit_column")), index.get(pair.get("credit_column"))
		if d is not None and c is not None and abs(d - c) == 1:
			bands[min(d, c)] = (2, pair.get("label") or "")
	return bands


def build(
	report_name: str,
	nr: dict,
	result: dict,
	model: dict,
	settings: dict,
) -> bytes:
	"""Build the workbook and return its bytes."""
	columns = result["columns"]
	layout = model["layout"]
	filters = model["filters"]
	rtl = is_rtl()
	wb = Workbook()
	ws = wb.active
	ws.title = (_SHEET_TITLE_BAD.sub(" ", _(report_name)) or "Report")[:31]
	ws.sheet_view.rightToLeft = rtl
	ws.sheet_properties.outlinePr.summaryBelow = False

	bold = Font(bold=True)
	header_fill = PatternFill("solid", fgColor="F2F2F2")
	thin = Side(style="thin", color="BFBFBF")
	header_border = Border(top=thin, bottom=thin, left=thin, right=thin)
	ncols = max(len(columns), 1)
	number_formats = {
		c["key"]: _number_format(column_precision(c)) for c in columns if c["fieldtype"] in NUMERIC_TYPES
	}
	date_fmt = _date_format()

	row = 1
	company = filters.get("company") or frappe.defaults.get_user_default("Company")
	if company:
		ws.cell(row=row, column=1, value=str(company)).font = Font(bold=True, size=14)
		ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=ncols)
		row += 1
	ws.cell(row=row, column=1, value=layout.get("title") or _(report_name)).font = Font(bold=True, size=12)
	ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=ncols)
	row += 1
	if layout.get("include_filters"):
		text = _filters_text(filters)
		if text:
			ws.cell(row=row, column=1, value=text)
			ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=ncols)
			row += 1
	row += 1

	bands = _bands(columns, settings.get("balance_pairs") or [])
	covered: set[int] = set()
	band_row = row
	if bands:
		header_row = row + 1
		for start, (span, label) in bands.items():
			cell = ws.cell(row=band_row, column=start + 1, value=_(label))
			cell.font, cell.fill, cell.border = bold, header_fill, header_border
			cell.alignment = Alignment(horizontal="center")
			ws.merge_cells(
				start_row=band_row, start_column=start + 1, end_row=band_row, end_column=start + span
			)
			covered.update(range(start, start + span))
		for i in range(len(columns)):
			if i not in covered:
				ws.merge_cells(start_row=band_row, start_column=i + 1, end_row=header_row, end_column=i + 1)
		row = header_row
	for i, col in enumerate(columns):
		# Without a band above it, the header cell spans both header rows.
		target = row if not bands or i in covered else band_row
		cell = ws.cell(row=target, column=i + 1, value=_(col["label"]))
		cell.font, cell.fill, cell.border = bold, header_fill, header_border
		cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
		width = col.get("width") or 120
		ws.column_dimensions[get_column_letter(i + 1)].width = max(8, min(80, width / 7))
	row += 1
	ws.freeze_panes = ws.cell(row=row, column=1)

	# The column that names a row on screen: group titles, subtotal titles and the indent.
	label_index = next((i for i, c in enumerate(columns) if c["key"] == result["label_key"]), 0)
	by_key = {c["key"]: c for c in nr["columns"]}

	include_subtotals = layout.get("include_subtotals", True)
	for out in result["rows"]:
		kind = out["kind"]
		if kind == "foot" and not include_subtotals:
			continue
		values = {} if kind == "group" and not include_subtotals else out["values"]
		title = None
		if kind == "group":
			title = f"{_group_label(out, by_key)} ({out['count']})"
		elif kind == "foot":
			title = _("Total {0}").format(_group_label(out, by_key))
		for i, col in enumerate(columns):
			if title is not None and i == label_index:
				value = title
			else:
				value = _cell_value(values.get(col["key"]), col)
			cell = ws.cell(row=row, column=i + 1, value=value)
			if col["key"] in number_formats and isinstance(value, int | float):
				cell.number_format = number_formats[col["key"]]
			elif col["fieldtype"] == "Date" and isinstance(value, datetime.date):
				cell.number_format = date_fmt
			elif col["fieldtype"] == "Datetime" and isinstance(value, datetime.datetime):
				cell.number_format = date_fmt + " hh:mm:ss"
			if out["bold"]:
				cell.font = bold
			if i == label_index and out["level"]:
				cell.alignment = Alignment(indent=min(out["level"], 15))
		dimension = ws.row_dimensions[row]
		level = min(out["level"], 7)
		if level:
			dimension.outline_level = level
		if out["hidden"]:
			dimension.hidden = True
		if out["open"] is False:
			# A folded group or parent: its rows are in the sheet, hidden under it.
			dimension.collapsed = True
		row += 1

	# Grand total (ADR-008), always a wide bold row: the report's own reference row when it
	# is the total on screen, else the engine's total.
	total_fill = PatternFill("solid", fgColor="E7E6E6")
	for i, col in enumerate(columns):
		value = _cell_value(result["totals"].get(col["key"]), col) if col["key"] in result["totals"] else None
		if i == label_index and value is None:
			value = _("Total")
		cell = ws.cell(row=row, column=i + 1, value=value)
		cell.font, cell.fill, cell.border = bold, total_fill, header_border
		if col["key"] in number_formats and isinstance(value, int | float):
			cell.number_format = number_formats[col["key"]]

	buffer = BytesIO()
	wb.save(buffer)
	return buffer.getvalue()
