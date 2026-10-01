"""Experiment 6: run Trial Balance read-only on the dev site with show_net_values=1 and =0.

Research script only (frappe.set_user is allowed here, never in production code).
Usage: cd /home/snd/frappe-bench/sites && ../env/bin/python ../apps/report_view/tests/experiments/perspective/exp6_run_tb.py
Writes data/tb_net{1,0}.json and data/tb_net{1,0}_mid.json next to this file. Nothing is written to the database (rollback).
"""
import datetime
import decimal
import json
import os

import frappe

HERE = os.path.dirname(os.path.abspath(__file__))
MID_FROM = os.environ.get("RV_MID_FROM", "2026-07-01")


def enc(o):
	if isinstance(o, (datetime.date, datetime.datetime)):
		return o.isoformat()
	if isinstance(o, decimal.Decimal):
		return float(o)
	return str(o)


frappe.init(site="acc.dev.sanad.digital")
frappe.connect()
try:
	frappe.set_user("Administrator")
	from frappe.desk.query_report import run

	fixture = json.load(open(os.path.join(HERE, "data", "trial_balance_fy2026.json")))
	base_filters = dict(fixture["input"]["filters"])
	# "fy": the fixture filters (opening balances are all zero on this site for FY 2026).
	# "mid": same year from a later start date, so that opening balances are non-zero and their netting is exercised.
	variants = [("", {}), ("_mid", {"from_date": MID_FROM})]
	for (suffix, extra), net in [(v, n) for v in variants for n in (1, 0)]:
		filters = dict(base_filters, show_net_values=net, **extra)
		r = run("Trial Balance", filters=filters, is_tree=True, parent_field="parent_account")
		rows = [x for x in r["result"] if isinstance(x, dict) and x]
		out = {"filters": filters, "columns": r["columns"], "result": r["result"]}
		with open(os.path.join(HERE, "data", f"tb_net{net}{suffix}.json"), "w") as f:
			json.dump(out, f, ensure_ascii=False, indent=1, default=enc)
		total = rows[-1]
		print(f"{suffix or '_fy'} from={filters['from_date']} show_net_values={net}: rows={len(rows)} total={ {k: total[k] for k in ('opening_debit','opening_credit','debit','credit','closing_debit','closing_credit')} }")
finally:
	frappe.db.rollback()
	frappe.destroy()
