"""The letter head details moved from fields of Company to a child table under it (ADR-030,
2026-11-16). The fields of the first deploy go: on a site whose Company table is at MariaDB's
row size, migrate inserted their Custom Field records and failed to add their columns, so
Company could no longer be saved and every migrate failed again.

Run before the doctypes sync (pre_model_sync): a change of Company's own definition alters
its table, which those fields would make fail too. A column of theirs, where it was made, is
dropped only when it holds no value: nothing is lost."""

import frappe

OLD_FIELDS = (
	"rv_company_name_ar",
	"rv_activity_ar",
	"rv_activity_en",
	"rv_address_ar",
	"rv_letter_head_column",
	"rv_cr_no",
	"rv_unified_no",
	"rv_po_box",
	"rv_bank_name",
	"rv_iban",
)


def execute():
	for name in frappe.get_all(
		"Custom Field", filters={"dt": "Company", "fieldname": ["in", OLD_FIELDS]}, pluck="name"
	):
		frappe.delete_doc("Custom Field", name, force=True, ignore_permissions=True)
	columns = set(frappe.db.get_table_columns("Company"))
	for field in OLD_FIELDS:
		if field not in columns:
			continue
		holds_values = frappe.db.sql(
			f"select 1 from `tabCompany` where coalesce(`{field}`, '') != '' limit 1"
		)
		if not holds_values:
			frappe.db.sql_ddl(f"alter table `tabCompany` drop column `{field}`")
	frappe.clear_cache(doctype="Company")
