import frappe, json, datetime, decimal, gzip
frappe.init(site="acc.dev.sanad.digital"); frappe.connect()
frappe.set_user("Administrator")
from frappe.desk.query_report import run
def enc(o):
    if isinstance(o,(datetime.date,datetime.datetime)): return o.isoformat()
    if isinstance(o,decimal.Decimal): return float(o)
    return str(o)
co="SND Accounting"
f={"company":co,"fiscal_year":"2026","from_date":"2026-01-01","to_date":"2026-12-31","with_period_closing_entry_for_opening":1,"with_period_closing_entry_for_current_period":1,"show_zero_values":0,"include_default_book_entries":1,"show_net_values":1,"show_group_accounts":1}
r=run("Trial Balance", filters=f, is_tree=True, parent_field="parent_account")
res=r["result"]
print("TB with show_group_accounts=1: n_rows", len(res), "indent values", sorted({x.get("indent") for x in res}))
for i in range(3): print(f"row[{i}] account={res[i]['account']!r} parent={res[i].get('parent_account')!r} indent={res[i].get('indent')} is_group={res[i].get('is_group_account')} debit={res[i].get('debit')}")
print("row[-1]:", json.dumps(res[-1], ensure_ascii=False, default=enc))
# GL columns without fieldtype
r2=run("General Ledger", filters={"company":co,"from_date":"2026-01-01","to_date":"2026-12-31","categorize_by":"Categorize by Voucher (Consolidated)","include_default_book_entries":1})
print("GL cols lacking fieldtype:", [c for c in r2["columns"] if "fieldtype" not in c][:3])
print("GL first row keys:", list(r2["result"][0].keys()))
print("GL row types:", {type(x).__name__ for x in r2["result"]}, "; rows whose account startswith quote:", [x["account"] for x in r2["result"] if isinstance(x.get("account"),str) and x["account"].startswith("'")])
# AR total row index / type
r3=run("Accounts Receivable", filters={"company":co,"report_date":"2026-12-31","ageing_based_on":"Due Date","range":"30, 60, 90, 120","party_type":"Customer"})
print("AR last row type:", type(r3["result"][-1]).__name__, "second to last:", type(r3["result"][-2]).__name__, "; len(cols)=", len(r3["columns"]), "len(total row)=", len(r3["result"][-1]))
print("AR total row [0..3]:", r3["result"][-1][:4], "index of currency col:", [c["fieldname"] for c in r3["columns"]].index("currency"), "->", r3["result"][-1][[c["fieldname"] for c in r3["columns"]].index("currency")])
# AR with group_by_party
r4=run("Accounts Receivable", filters={"company":co,"report_date":"2026-12-31","ageing_based_on":"Due Date","range":"30, 60, 90, 120","party_type":"Customer","group_by_party":1})
print("AR group_by_party: skip_total_row", r4["skip_total_row"], "add_total_row", r4["add_total_row"], "last row:", json.dumps(r4["result"][-1], ensure_ascii=False, default=enc)[:300])
print("AR rows with bold:", sum(1 for x in r4["result"] if isinstance(x,dict) and x.get("bold")), "empty rows:", sum(1 for x in r4["result"] if not x))
# Prepared report file content
pr=frappe.get_doc("Prepared Report","fgmec8i05u")
raw=pr.get_prepared_data()
d=json.loads(raw)
print("Prepared file top-level type:", type(d).__name__, "keys:", list(d.keys()) if isinstance(d,dict) else None)
print("Prepared columns[0]:", d["columns"][0] if isinstance(d,dict) else d[0][:1], "; n result:", len(d["result"]) if isinstance(d,dict) else None, "; other:", {k:v for k,v in d.items() if k not in("result","columns")} if isinstance(d,dict) else None)
print("pr.get('columns'):", pr.get("columns"))
# run Stock Balance as prepared? (prepared_report flag)
print("Stock Balance prepared_report flag:", frappe.db.get_value("Report","Stock Balance","prepared_report"))
r5=run("Stock Balance", filters={"company":co})
print("Stock Balance run keys:", list(r5.keys()), "prepared_report:", r5.get("prepared_report"), "doc type:", type(r5.get("doc")).__name__, "columns[0]:", r5["columns"][0] if r5.get("columns") else None, "n rows:", len(r5.get("result",[])))
print("doc as_dict keys:", list(r5["doc"].as_dict().keys()) if r5.get("doc") else None)
r6=run("Stock Balance", filters={"company":co, "prepared_report_name":"fgmec8i05u"})
print("explicit prepared_report_name -> keys", list(r6.keys()), "n rows", len(r6.get("result",[])))
r7=run("Stock Balance", filters={"company":co,"warehouse":"nonexistent-xyz"})
print("no matching prepared -> keys", list(r7.keys()), "result present:", "result" in r7, "doc:", r7.get("doc"))
frappe.db.rollback(); frappe.destroy()
