import frappe, json, datetime, decimal
frappe.init(site="acc.dev.sanad.digital"); frappe.connect()
frappe.set_user("Administrator")
from frappe.desk.query_report import run

def enc(o):
    if isinstance(o,(datetime.date,datetime.datetime)): return o.isoformat()
    if isinstance(o,decimal.Decimal): return float(o)
    return str(o)

def show(name, filters, is_tree=False, parent_field=None):
    print("="*20, name, "="*20)
    print("filters:", json.dumps(filters, ensure_ascii=False))
    try:
        r = run(name, filters=filters, is_tree=is_tree, parent_field=parent_field)
    except Exception as e:
        print("EXCEPTION:", type(e).__name__, e); frappe.db.rollback(); return
    print("keys:", list(r.keys()))
    print("types:", {k: type(v).__name__ for k,v in r.items()})
    cols = r["columns"]; res = r["result"]
    print("n_columns:", len(cols), "n_rows:", len(res))
    print("column[0]:", json.dumps(cols[0], ensure_ascii=False, default=enc))
    print("column[1]:", json.dumps(cols[1], ensure_ascii=False, default=enc))
    print("all column fieldname/fieldtype:", [(c.get("fieldname"), c.get("fieldtype"), c.get("options")) for c in cols])
    print("row types:", set(type(x).__name__ for x in res))
    for i in range(min(2,len(res))):
        print(f"row[{i}]:", json.dumps(res[i], ensure_ascii=False, default=enc))
    if res:
        print("row[-1]:", json.dumps(res[-1], ensure_ascii=False, default=enc))
    dict_rows=[x for x in res if isinstance(x,dict)]
    print("rows with indent key:", sum(1 for x in dict_rows if "indent" in x), "indent values:", sorted({x.get("indent") for x in dict_rows if "indent" in x}, key=lambda v: (v is None, v)))
    print("empty rows ({} or []):", sum(1 for x in res if not x))
    print("rows with parent_account:", sum(1 for x in dict_rows if x.get("parent_account")))
    print("add_total_row:", r.get("add_total_row"), "skip_total_row:", r.get("skip_total_row"))
    print("message:", repr(r.get("message"))[:300])
    print("chart:", (json.dumps(r.get("chart"), ensure_ascii=False, default=enc)[:400] if r.get("chart") else None))
    print("report_summary:", (json.dumps(r.get("report_summary"), ensure_ascii=False, default=enc)[:600] if r.get("report_summary") else None))
    print("status:", r.get("status"), "execution_time:", r.get("execution_time"))
    print("other keys:", {k:v for k,v in r.items() if k not in ("result","columns","message","chart","report_summary")})
    # cell value types
    if dict_rows:
        print("value types in row[0]:", {k: type(v).__name__ for k,v in dict_rows[0].items()})

co="SND Accounting"; fy="2026"
show("Trial Balance", {"company":co,"fiscal_year":fy,"from_date":"2026-01-01","to_date":"2026-12-31","with_period_closing_entry_for_opening":1,"with_period_closing_entry_for_current_period":1,"show_zero_values":0,"include_default_book_entries":1}, is_tree=True, parent_field="parent_account")
show("General Ledger", {"company":co,"from_date":"2026-01-01","to_date":"2026-12-31","group_by":"Group by Voucher (Consolidated)","include_dimensions":1,"include_default_book_entries":1,"categorize_by":"Categorize by Voucher (Consolidated)"})
show("Accounts Receivable", {"company":co,"report_date":"2026-12-31","ageing_based_on":"Due Date","range":"30, 60, 90, 120","party_type":"Customer"})
print("Prepared Report on site:", frappe.get_all("Prepared Report", fields=["name","report_name","status","filters","creation","job_id","peak_memory_usage","report_end_time"]))
for pr in frappe.get_all("Prepared Report", pluck="name"):
    print("files:", frappe.get_all("File", filters={"attached_to_doctype":"Prepared Report","attached_to_name":pr}, fields=["file_name","file_url","is_private","file_size"]))
frappe.db.rollback()
frappe.destroy()
