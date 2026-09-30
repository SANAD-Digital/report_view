"""Excel export with openpyxl (docs/architecture.md §4.3, §9.2).

Values are raw (never HTML from a formatter). Numbers keep their numeric type
with a number format built from the system precision; dates are real dates
with the system date format.
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
		except (TypeError, ValueError):
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
		if value in (None, "", []) or value == 0 and isinstance(value, int) and not isinstance(value, bool):
			continue
		if isinstance(value, list):
			value = ", ".join(str(v) for v in value)
		parts.append(f"{_(frappe.unscrub(key))}: {value}")
	return " | ".join(parts)


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
			ws.merge_cells(start_row=band_row, start_column=start + 1, end_row=band_row, end_column=start + span)
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

	label_index = 0
	label_key = (nr.get("tree") or {}).get("label_key")
	for i, col in enumerate(columns):
		if col["key"] == label_key:
			label_index = i
			break

	include_subtotals = layout.get("include_subtotals", True)
	for out in result["rows"]:
		if out["kind"] == "group" and not include_subtotals:
			values = {c["key"]: None for c in columns}
			values.update({k: v for k, v in out["values"].items() if k not in number_formats})
		else:
			values = out["values"]
		for i, col in enumerate(columns):
			if out["kind"] == "group" and i == 0:
				value = f"{out['label'] or _('(empty)')} ({out['count']})"
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
		level = min(out["level"], 7)
		if level:
			ws.row_dimensions[row].outline_level = level
		if out.get("collapsed"):
			ws.row_dimensions[row].hidden = True
		row += 1

	# Grand total (ADR-008), always a wide bold row.
	total_fill = PatternFill("solid", fgColor="E7E6E6")
	for i, col in enumerate(columns):
		value = _cell_value(result["totals"].get(col["key"]), col) if col["key"] in result["totals"] else None
		if i == 0 and value is None:
			value = _("Total")
		cell = ws.cell(row=row, column=i + 1, value=value)
		cell.font, cell.fill, cell.border = bold, total_fill, header_border
		if col["key"] in number_formats and isinstance(value, int | float):
			cell.number_format = number_formats[col["key"]]

	buffer = BytesIO()
	wb.save(buffer)
	return buffer.getvalue()
