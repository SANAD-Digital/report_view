"""Test helpers: users created inside the test transaction (rolled back by
IntegrationTestCase), and the acc.dev data the tests rely on."""

import json
import os

import frappe
from frappe.tests import IntegrationTestCase

COMPANY = "SND Accounting"
OTHER_COMPANY = "SND Accounting 2"
DOMAIN = "rvtest.invalid"
FIXTURES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "normalize")

USERS = {
	"admin": ["System Manager"],
	"accountant": ["Accounts User", "Accounts Manager"],
	"restricted": ["Accounts User"],
	"auditor": ["Auditor"],
	"none": [],
}

TB_FILTERS = {
	"company": COMPANY,
	"fiscal_year": "2026",
	"from_date": "2026-01-01",
	"to_date": "2026-12-31",
	"with_period_closing_entry_for_opening": 1,
	"with_period_closing_entry_for_current_period": 1,
	"include_default_book_entries": 1,
	"show_net_values": 1,
	"show_group_accounts": 1,
}
TB_JS_FILTERS = [
	{"fieldname": "company", "fieldtype": "Link", "options": "Company"},
	{"fieldname": "fiscal_year", "fieldtype": "Link", "options": "Fiscal Year"},
]
TB_MEASURES = ("opening_debit", "opening_credit", "debit", "credit", "closing_debit", "closing_credit")
AR_FILTERS = {
	"company": COMPANY,
	"report_date": "2026-09-30",
	"ageing_based_on": "Due Date",
	"calculate_ageing_with": "Report Date",
	"range": "30, 60, 90, 120",
	"party_type": "Customer",
}
AP_FILTERS = dict(AR_FILTERS, party_type="Supplier")
# Reports with `add_total_row` (N2.1). Frappe switches a report to `prepared_report=1` on
# its own after a slow run (ADR-009), so a test that needs rows tries them in turn.
TOTAL_ROW_REPORTS = (("Accounts Payable", AP_FILTERS), ("Accounts Receivable", AR_FILTERS))


def email(kind: str) -> str:
	return f"rv_t_{kind}@{DOMAIN}"


def make_users() -> dict[str, str]:
	"""Insert the test users (as Administrator) and return {kind: email}."""
	out = {}
	for kind, roles in USERS.items():
		address = email(kind)
		if not frappe.db.exists("User", address):
			frappe.get_doc(
				{
					"doctype": "User",
					"email": address,
					"first_name": f"rv_t_{kind}",
					"send_welcome_email": 0,
					"user_type": "System User",
					# Disabled: the site_quota app caps *active* users at 10. Permission
					# checks (roles, DocPerm, User Permission) do not depend on `enabled`.
					"enabled": 0,
					"roles": [{"role": r} for r in roles],
				}
			).insert()
		out[kind] = address
	if not frappe.db.exists("User Permission", {"user": out["restricted"], "allow": "Company"}):
		frappe.get_doc(
			{
				"doctype": "User Permission",
				"user": out["restricted"],
				"allow": "Company",
				"for_value": OTHER_COMPANY,
				"apply_to_all_doctypes": 1,
			}
		).insert()
	return out


def load_fixtures() -> list[dict]:
	cases = []
	for name in sorted(os.listdir(FIXTURES_DIR)):
		if name.endswith(".json"):
			with open(os.path.join(FIXTURES_DIR, name), encoding="utf-8") as f:
				cases.append(json.load(f))
	return cases


def as_json(value):
	return json.loads(frappe.as_json(value))


class RVTestCase(IntegrationTestCase):
	"""Creates the rv_t_* users once per class; everything is rolled back afterwards."""

	users: dict[str, str]

	@classmethod
	def setUpClass(cls) -> None:
		super().setUpClass()
		frappe.set_user("Administrator")
		cls.users = make_users()
		# Role/permission caches built while the test users exist must not outlive the rollback.
		cls.addClassCleanup(_rollback_and_clear_cache)

	def as_user(self, kind: str):
		return self.set_user(self.users[kind])


def _rollback_and_clear_cache() -> None:
	frappe.db.rollback()
	frappe.clear_cache()
