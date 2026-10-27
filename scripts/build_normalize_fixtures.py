"""Build the shared normalize fixtures from real report runs on a DEVELOPMENT site.

Run from the bench "sites" directory:
    cd sites && ../env/bin/python ../apps/report_view/scripts/build_normalize_fixtures.py <site> [company]

Read-only: every report is run as Administrator through
``frappe.desk.query_report.run`` (except one case that captures a report's raw
``execute()`` output to exercise string columns and list rows), the response is
round-tripped through ``frappe.as_json`` exactly like an HTTP response, and the
transaction is rolled back. ``expected`` is produced by
``report_view.core.normalize`` and must be reviewed by hand before committing.

This is a development script, not application code: it is never imported by
the app.
"""

import json
import os
import sys

import frappe

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "report_view", "tests", "fixtures", "normalize")

TB_SETTINGS = {
	"tree": True,
	"name_field": "account",
	"parent_field": "parent_account",
	"export_hidden_cols": True,
	"initial_depth": 3,
}


SYNTHETIC_RAW = {
	"columns": [
		{"fieldname": "label", "label": "Label", "fieldtype": "Data"},
		"Party:Link/party_type:120",
		{"label": "Amount", "fieldtype": "currency", "options": "currency", "width": "110"},
		{"fieldname": "amount", "label": "Amount 2", "fieldtype": "Float"},
		{"fieldname": "rate", "label": "Rate", "fieldtype": "Percent"},
		{"fieldname": "currency", "label": "Currency", "fieldtype": "Link", "options": "Currency"},
		{"fieldname": "posted", "label": "Posted", "fieldtype": "Datetime", "hidden": 1},
		{"fieldname": "note", "label": "Note", "fieldtype": "Small Text"},
	],
	"result": [
		{"label": "Group A"},
		{"label": "a1", "party": "C1", "amount": 10.0, "rate": 50, "currency": "YER", "indent": 1},
		["a2", "C2", 5.5, 5.5, 25, "USD", "2026-01-02 10:00:00", "n"],
		{},
		{"label": "'Opening'", "amount": 0, "indent": 0},
		{"label": "'Closing (Opening + Total)'", "amount": 15.5, "indent": 0},
	],
	"message": "",
	"chart": {},
	"report_summary": [],
	"skip_total_row": 2,
	"status": None,
	"add_total_row": 0,
}


def http(obj):
	return json.loads(frappe.as_json(obj))


def write_case(name, raw, filters, report_settings=None, register=None, description=""):
	from report_view.core.normalize import normalize

	raw = http(raw)
	raw.pop("execution_time", None)
	report_settings = report_settings or {}
	register = register or {}
	expected = http(normalize(raw, filters, report_settings, register))
	case = {
		"name": name,
		"description": description,
		"input": {"raw": raw, "filters": filters, "report_settings": report_settings, "register": register},
		"expected": expected,
	}
	with open(os.path.join(OUT, name + ".json"), "w", encoding="utf-8") as f:
		json.dump(case, f, ensure_ascii=False, indent=1, sort_keys=True)
		f.write("\n")
	print(name, "rows", len(expected["rows"]), "facts", len(expected["facts"]))


def main(site, company):
	frappe.init(site=site)
	frappe.connect()
	frappe.set_user("Administrator")
	frappe.local.lang = "en"
	from frappe.desk.query_report import run

	os.makedirs(OUT, exist_ok=True)
	try:
		tb = {
			"company": company,
			"fiscal_year": "2026",
			"from_date": "2026-01-01",
			"to_date": "2026-12-31",
			"with_period_closing_entry_for_opening": 1,
			"with_period_closing_entry_for_current_period": 1,
			"include_default_book_entries": 1,
			"show_net_values": 1,
			"show_group_accounts": 1,
		}
		write_case(
			"trial_balance_fy2026",
			run("Trial Balance", filters=dict(tb), is_tree=True, parent_field="parent_account"),
			tb,
			TB_SETTINGS,
			description="Tree by indent; quoted internal 'Total'; hidden columns with export_hidden_cols",
		)

		gl = {
			"company": company,
			"from_date": "2026-04-01",
			"to_date": "2026-04-30",
			"categorize_by": "Categorize by Voucher (Consolidated)",
			"include_default_book_entries": 1,
		}
		write_case(
			"general_ledger_consolidated",
			run("General Ledger", filters=dict(gl)),
			gl,
			description="'Opening'/'Total'/'Closing (Opening + Total)'; columns without fieldtype",
		)
		gl_acc = dict(gl, categorize_by="Categorize by Account")
		write_case(
			"general_ledger_by_account",
			run("General Ledger", filters=dict(gl_acc)),
			gl_acc,
			description="Per-account summary rows and near-empty separator rows",
		)

		ar = {
			"company": company,
			"report_date": "2026-05-31",
			"ageing_based_on": "Due Date",
			"calculate_ageing_with": "Report Date",
			"range": "30, 60, 90, 120",
			"party_type": "Customer",
		}
		write_case(
			"accounts_receivable_frappe_total",
			run("Accounts Receivable", filters=dict(ar)),
			ar,
			description="Frappe total row as a list after dict rows (N2.1)",
		)
		ar_gp = dict(ar, group_by_party=1)
		write_case(
			"accounts_receivable_group_by_party",
			run("Accounts Receivable", filters=dict(ar_gp)),
			ar_gp,
			description="skip_total_row; bold party subtotals; unquoted bold 'Total'; {} separators",
		)

		sb = {
			"company": company,
			"from_date": "2026-01-01",
			"to_date": "2026-09-30",
			"valuation_field_type": "Currency",
		}
		write_case(
			"stock_balance",
			run("Stock Balance", filters=dict(sb), ignore_prepared_report=True),
			sb,
			description="Prepared report run directly (ignore_prepared_report); Company currency; Frappe total",
		)
		prepared = frappe.get_list(
			"Prepared Report",
			filters={"report_name": "Stock Balance", "status": "Completed"},
			fields=["name", "filters"],
			order_by="creation desc",
			limit=1,
		)
		if prepared:
			pr_filters = json.loads(prepared[0].filters or "{}")
			write_case(
				"stock_balance_prepared",
				run("Stock Balance", filters=dict(pr_filters, prepared_report_name=prepared[0].name)),
				pr_filters,
				description="Result read from a Prepared Report file (flags.prepared)",
			)

		elb = {
			"from_date": "2026-01-01",
			"to_date": "2026-12-31",
			"company": company,
			"employee_status": "Active",
		}
		write_case(
			"employee_leave_balance_float",
			run("Employee Leave Balance", filters=dict(elb)),
			elb,
			description='fieldtype "float" (N1.3); tree by indent where every row has indent 1',
		)

		from hrms.hr.report.employee_birthday.employee_birthday import execute as birthday_execute

		eb = {"company": company, "month": "Sep"}
		columns, data = birthday_execute(frappe._dict(eb))
		write_case(
			"employee_birthday_list_rows",
			{
				"columns": columns,
				"result": [list(r) for r in data],
				"message": None,
				"chart": None,
				"report_summary": None,
				"skip_total_row": 0,
				"status": None,
				"add_total_row": 0,
			},
			eb,
			description="Raw execute() output: string columns and list rows (N1.1, N2.2)",
		)

		spq = {"company": company}
		write_case(
			"stock_projected_qty",
			run("Stock Projected Qty", filters=dict(spq)),
			spq,
			description="Frappe total row whose first cell is 'Total'; columns without fieldtype",
		)
		write_case(
			"synthetic_edge_shapes",
			SYNTHETIC_RAW,
			{"party_type": "Customer"},
			{"tree": True, "name_field": "label"},
			description="Hand-written (not from a run): shapes absent from the development data; "
			"mixed list/dict rows, duplicate fieldnames, leaked numeric skip_total_row, "
			"group header without indent, Link to a filter, empty chart",
		)
	finally:
		frappe.db.rollback()
		frappe.destroy()


if __name__ == "__main__":
	main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "SND Accounting")
