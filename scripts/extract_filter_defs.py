#!/usr/bin/env python3
"""Dev tool: extract the server filter definitions of the catalogued reports (ADR-021).

Frappe checks a Link filter's value only for the filters it is told about
(``validate_filters_permissions``). For a Script Report those come from the browser, so
Report View ships the Link / Dynamic Link / MultiSelectList filters of every report in
``docs/research/report-catalog.md`` in ``report_view/defaults/<scrub(report)>.json``
(``filter_defs``), read here from the report's own ``.js`` in the installed apps.

Usage (from the bench root or anywhere)::

    python3 apps/report_view/scripts/extract_filter_defs.py            # write the files
    python3 apps/report_view/scripts/extract_filter_defs.py --check    # exit 1 if a file differs

Only ``filter_defs`` of an existing file is replaced; its other keys keep their text.
The scanner reads object literals with a string ``fieldname`` and ``fieldtype``. A filter
built at run time (``erpnext.utils.add_dimensions`` and the like) has no literal and is
reported as ``dynamic``; a Link whose ``options`` is not a string literal is reported too.
Review both by hand before committing the output.
"""

import argparse
import json
import os
import re
import sys

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APPS_DIR = os.path.dirname(APP_DIR)
DEFAULTS_DIR = os.path.join(APP_DIR, "report_view", "defaults")

# docs/research/report-catalog.md §2: report -> its .js, and the shared files its filters come from
CATALOG = {
	"Trial Balance": "erpnext/erpnext/accounts/report/trial_balance/trial_balance.js",
	"General Ledger": "erpnext/erpnext/accounts/report/general_ledger/general_ledger.js",
	"Accounts Receivable": "erpnext/erpnext/accounts/report/accounts_receivable/accounts_receivable.js",
	"Accounts Payable": "erpnext/erpnext/accounts/report/accounts_payable/accounts_payable.js",
	"Balance Sheet": "erpnext/erpnext/accounts/report/balance_sheet/balance_sheet.js",
	"Profit and Loss Statement": (
		"erpnext/erpnext/accounts/report/profit_and_loss_statement/profit_and_loss_statement.js"
	),
	"Cash Flow": "erpnext/erpnext/accounts/report/cash_flow/cash_flow.js",
	"Accounts Receivable Summary": (
		"erpnext/erpnext/accounts/report/accounts_receivable_summary/accounts_receivable_summary.js"
	),
	"Gross Profit": "erpnext/erpnext/accounts/report/gross_profit/gross_profit.js",
	"Sales Register": "erpnext/erpnext/accounts/report/sales_register/sales_register.js",
	"Purchase Register": "erpnext/erpnext/accounts/report/purchase_register/purchase_register.js",
	"Trial Balance for Party": (
		"erpnext/erpnext/accounts/report/trial_balance_for_party/trial_balance_for_party.js"
	),
	"Budget Variance Report": (
		"erpnext/erpnext/accounts/report/budget_variance_report/budget_variance_report.js"
	),
	"Stock Ledger": "erpnext/erpnext/stock/report/stock_ledger/stock_ledger.js",
	"Stock Balance": "erpnext/erpnext/stock/report/stock_balance/stock_balance.js",
	"Stock Projected Qty": "erpnext/erpnext/stock/report/stock_projected_qty/stock_projected_qty.js",
	"Stock Ageing": "erpnext/erpnext/stock/report/stock_ageing/stock_ageing.js",
	"Warehouse wise Item Balance Age and Value": (
		"erpnext/erpnext/stock/report/warehouse_wise_item_balance_age_and_value/"
		"warehouse_wise_item_balance_age_and_value.js"
	),
	"Item Price Stock": "erpnext/erpnext/stock/report/item_price_stock/item_price_stock.js",
	"Sales Analytics": "erpnext/erpnext/selling/report/sales_analytics/sales_analytics.js",
	"Sales Order Analysis": "erpnext/erpnext/selling/report/sales_order_analysis/sales_order_analysis.js",
	"Customer Ledger Summary": (
		"erpnext/erpnext/accounts/report/customer_ledger_summary/customer_ledger_summary.js"
	),
	"Sales Partner Transaction Summary": (
		"erpnext/erpnext/selling/report/sales_partner_transaction_summary/"
		"sales_partner_transaction_summary.js"
	),
	"Purchase Analytics": "erpnext/erpnext/buying/report/purchase_analytics/purchase_analytics.js",
	"Purchase Order Analysis": (
		"erpnext/erpnext/buying/report/purchase_order_analysis/purchase_order_analysis.js"
	),
	"Supplier Ledger Summary": (
		"erpnext/erpnext/accounts/report/supplier_ledger_summary/supplier_ledger_summary.js"
	),
	"Monthly Attendance Sheet": "hrms/hrms/hr/report/monthly_attendance_sheet/monthly_attendance_sheet.js",
	"Salary Register": "hrms/hrms/payroll/report/salary_register/salary_register.js",
	"Employee Leave Balance": "hrms/hrms/hr/report/employee_leave_balance/employee_leave_balance.js",
	"Employee Advance Summary": "hrms/hrms/hr/report/employee_advance_summary/employee_advance_summary.js",
	"Employee Birthday": "hrms/hrms/hr/report/employee_birthday/employee_birthday.js",
}
FS_JS = "erpnext/erpnext/public/js/financial_statements.js"
# reports whose filters are erpnext.financial_statements.filters (get_filters() of fs.js)
SHARED = {
	"Balance Sheet": [FS_JS],
	"Profit and Loss Statement": [FS_JS],
	"Cash Flow": [FS_JS],
}
KEPT_TYPES = ("Link", "Dynamic Link", "MultiSelectList")
# Reviewed by hand: values the scanner cannot read. A Dynamic Link's options name the
# filter that holds its DocType (its get_options returns that filter's value).
REVIEWED = {
	"Trial Balance for Party": {"party": {"options": "party_type"}},
}
# filters a report adds at run time; their fieldnames depend on the site
DYNAMIC_MARKERS = ("add_dimensions", "add_inventory_dimensions")

_STRING_VALUE = re.compile(r"""^\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\s*$""", re.S)
_LINK_OPTIONS = re.compile(r"""get_link_options\(\s*["']([^"']+)["']""")


def _skip_string(src: str, i: int) -> int:
	"""Index after the string literal (', " or `) that starts at ``i``."""
	quote = src[i]
	i += 1
	while i < len(src):
		c = src[i]
		if c == "\\":
			i += 2
			continue
		if c == quote:
			return i + 1
		i += 1
	return i


def _objects(src: str):
	"""Yield (start, end) of every ``{...}`` span, skipping strings and comments."""
	stack = []
	i = 0
	n = len(src)
	while i < n:
		c = src[i]
		if c in "\"'`":
			i = _skip_string(src, i)
			continue
		if src.startswith("//", i):
			j = src.find("\n", i)
			i = n if j < 0 else j
			continue
		if src.startswith("/*", i):
			j = src.find("*/", i + 2)
			i = n if j < 0 else j + 2
			continue
		if c == "{":
			stack.append(i)
		elif c == "}" and stack:
			yield stack.pop(), i + 1
		i += 1


def _top_level_props(body: str) -> dict[str, str]:
	"""``key: <raw value>`` pairs at depth 0 of an object body (without its braces)."""
	props = {}
	depth = 0
	start = 0
	parts = []
	i = 0
	while i < len(body):
		c = body[i]
		if c in "\"'`":
			i = _skip_string(body, i)
			continue
		if c in "{[(":
			depth += 1
		elif c in "}])":
			depth -= 1
		elif c == "," and depth == 0:
			parts.append(body[start:i])
			start = i + 1
		i += 1
	parts.append(body[start:])
	for part in parts:
		m = re.match(r"\s*([A-Za-z_$][\w$]*)\s*:(.*)$", part, re.S)
		if m:
			props[m.group(1)] = m.group(2).strip()
	return props


def _literal(raw: str | None) -> str | None:
	m = _STRING_VALUE.match(raw or "")
	if not m:
		return None
	return m.group(1) if m.group(1) is not None else m.group(2)


def extract(paths: list[str], reviewed: dict | None = None) -> tuple[list[dict], list[str]]:
	"""Filter definitions of the given .js files, and notes for review."""
	reviewed = reviewed or {}
	defs: dict[str, dict] = {}
	notes = []
	for rel in paths:
		with open(os.path.join(APPS_DIR, rel), encoding="utf-8") as f:
			src = f.read()
		for marker in DYNAMIC_MARKERS:
			if marker in src:
				notes.append(f"dynamic: {marker} (site dimensions, MultiSelectList; not shipped)")
		for start, end in _objects(src):
			props = _top_level_props(src[start + 1 : end - 1])
			fieldname = _literal(props.get("fieldname"))
			fieldtype = _literal(props.get("fieldtype"))
			if not fieldname or not fieldtype:
				continue
			if fieldtype not in KEPT_TYPES or fieldname in defs:
				continue
			options = reviewed.get(fieldname, {}).get("options") or _literal(props.get("options"))
			if not options and fieldtype == "MultiSelectList":
				m = _LINK_OPTIONS.search(props.get("get_data", ""))
				options = m.group(1) if m else None
			if not options:
				# a MultiSelectList of fixed values (a Select) or a Link the scanner cannot read
				notes.append(f"skipped, no literal options: {fieldname} ({fieldtype})")
				continue
			defs[fieldname] = {"fieldname": fieldname, "fieldtype": fieldtype, "options": options}
	return list(defs.values()), notes


def _scrub(name: str) -> str:
	return name.replace(" ", "_").replace("-", "_").lower()


def _defs_block(defs: list[dict]) -> str:
	"""The defaults files' style: tabs, one filter definition per line."""
	if not defs:
		return "[]"
	return "[\n" + ",\n".join("\t\t" + json.dumps(d, ensure_ascii=False) for d in defs) + "\n\t]"


def _render(old: str | None, report: str, defs: list[dict]) -> str:
	"""A new file, or ``old`` with its ``filter_defs`` replaced (its other keys keep their text)."""
	if old is None:
		text = json.dumps({"report": report, "enabled": 1, "filter_defs": "__DEFS__"}, indent="\t")
		return text.replace('"__DEFS__"', _defs_block(defs)) + "\n"
	m = re.search(r'"filter_defs"\s*:\s*\[', old)
	if m:
		end = old.index("]", m.end()) + 1  # the definitions hold no "]"
		return old[: m.start()] + '"filter_defs": ' + _defs_block(defs) + old[end:]
	close = old.rstrip().rindex("}")
	return old[:close].rstrip() + ',\n\t"filter_defs": ' + _defs_block(defs) + "\n}\n"


def main() -> int:
	parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
	parser.add_argument("--check", action="store_true", help="exit 1 if a file would change")
	args = parser.parse_args()
	changed = []
	for report, path in CATALOG.items():
		if not os.path.exists(os.path.join(APPS_DIR, path)):
			print(f"skip {report}: {path} is not installed", file=sys.stderr)
			continue
		defs, notes = extract([path, *SHARED.get(report, [])], REVIEWED.get(report))
		target = os.path.join(DEFAULTS_DIR, _scrub(report) + ".json")
		old = None
		if os.path.exists(target):
			with open(target, encoding="utf-8") as f:
				old = f.read()
		text = _render(old, report, defs)
		json.loads(text)  # never write a broken file
		print(f"{report}: {len(defs)} filter defs")
		for note in dict.fromkeys(notes):
			print(f"  review: {note}")
		if old != text:
			changed.append(target)
			if not args.check:
				with open(target, "w", encoding="utf-8") as f:
					f.write(text)
	if args.check and changed:
		print("out of date: " + ", ".join(os.path.relpath(p, APP_DIR) for p in changed), file=sys.stderr)
		return 1
	return 0


if __name__ == "__main__":
	sys.exit(main())
