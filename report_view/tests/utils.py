"""Test helpers: the site data the tests run on, and users created inside the test
transaction (rolled back by IntegrationTestCase).

The company and fiscal year come from the site: the company with the most GL entries
and the fiscal year of its latest entry. On a fresh site the setup wizard runs first
(``report_view.install.before_tests``); a second company and a fiscal year missing are
created when this module is imported; the first
``IntegrationTestCase.setUpClass`` commits them, as Frappe does with its test records.
"""

import json
import os
import traceback
from functools import cache

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, getdate, nowdate

from report_view.install import before_tests

DOMAIN = "rvtest.invalid"
FIXTURES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "normalize")
TEST_COMPANY = "_Test RV Company"
TEST_OTHER_COMPANY = "_Test RV Company 2"

USERS = {
	"admin": ["System Manager"],
	"accountant": ["Accounts User", "Accounts Manager"],
	"restricted": ["Accounts User"],
	"auditor": ["Auditor"],
	"none": [],
}


# --- the site's data ---------------------------------------------------------------


def _main_company() -> str:
	ranked = frappe.db.sql(
		"""select company from `tabGL Entry` where is_cancelled = 0
		group by company order by count(*) desc, company limit 1"""
	)
	if ranked:
		return ranked[0][0]
	return frappe.db.get_value("Company", {}, "name", order_by="creation asc") or _create_company(
		TEST_COMPANY, "_TRV"
	)


def _create_company(name: str, abbr: str) -> str:
	"""A company with ERPNext's default chart of accounts (only on a site that has none to spare)."""
	if frappe.db.exists("Company", name):
		return name
	currency = frappe.db.get_default("currency") or "USD"
	country = frappe.db.get_single_value("System Settings", "country") or "United States"
	frappe.get_doc(
		{
			"doctype": "Company",
			"company_name": name,
			"abbr": abbr,
			"default_currency": currency,
			"country": country,
			"chart_of_accounts": "Standard",
		}
	).insert(ignore_if_duplicate=True)
	return name


def _fiscal_year(company: str) -> frappe._dict:
	"""The fiscal year of the company's latest GL entry (today when it has none)."""
	latest = frappe.db.sql(
		"select max(posting_date) from `tabGL Entry` where company = %s and is_cancelled = 0", company
	)[0][0]
	day = getdate(latest or nowdate())
	years = frappe.db.sql(
		"""select fy.name, fy.year_start_date, fy.year_end_date from `tabFiscal Year` fy
		where fy.disabled = 0 and %(day)s between fy.year_start_date and fy.year_end_date
		and (not exists (select 1 from `tabFiscal Year Company` c where c.parent = fy.name)
			or exists (select 1 from `tabFiscal Year Company` c where c.parent = fy.name and c.company = %(company)s))
		order by fy.year_start_date desc limit 1""",
		{"day": day, "company": company},
		as_dict=True,
	)
	if years:
		return years[0]
	start = getdate(f"{day.year}-01-01")
	name = f"_Test RV {day.year}"
	if not frappe.db.exists("Fiscal Year", name):
		frappe.get_doc(
			{
				"doctype": "Fiscal Year",
				"year": name,
				"year_start_date": start,
				"year_end_date": add_days(getdate(f"{day.year + 1}-01-01"), -1),
			}
		).insert(ignore_if_duplicate=True)
	return frappe.db.get_value(
		"Fiscal Year", name, ["name", "year_start_date", "year_end_date"], as_dict=True
	)


def _other_company(company: str, fiscal_year: str) -> str:
	"""Another company, preferring one that shares the fiscal year."""
	others = frappe.db.sql(
		"""select c.name from `tabCompany` c
		left join `tabFiscal Year Company` f on f.company = c.name and f.parent = %s
		where c.name != %s order by f.name is null, c.creation, c.name limit 1""",
		(fiscal_year, company),
	)
	return others[0][0] if others else _create_company(TEST_OTHER_COMPANY, "_TRV2")


@cache
def site_data() -> frappe._dict:
	company = _main_company()
	fy = _fiscal_year(company)
	return frappe._dict(
		company=company,
		abbr=frappe.db.get_value("Company", company, "abbr"),
		other_company=_other_company(company, fy.name),
		fiscal_year=fy.name,
		from_date=str(fy.year_start_date),
		to_date=str(fy.year_end_date),
	)


# Test discovery imports this module before the ``before_tests`` hook runs: a fresh site
# gets its setup wizard here first (ERPNext's fixtures, a company, a fiscal year).
before_tests()
_SITE = site_data()
COMPANY = _SITE.company
COMPANY_ABBR = _SITE.abbr
OTHER_COMPANY = _SITE.other_company

TB_FILTERS = {
	"company": COMPANY,
	"fiscal_year": _SITE.fiscal_year,
	"from_date": _SITE.from_date,
	"to_date": _SITE.to_date,
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
	"report_date": _SITE.to_date,
	"ageing_based_on": "Due Date",
	"calculate_ageing_with": "Report Date",
	"range": "30, 60, 90, 120",
	"party_type": "Customer",
}
AP_FILTERS = dict(AR_FILTERS, party_type="Supplier")
# Reports with `add_total_row` (N2.1). Frappe switches a report to `prepared_report=1` on
# its own after a slow run (ADR-009), so a test that needs rows tries them in turn.
TOTAL_ROW_REPORTS = (("Accounts Payable", AP_FILTERS), ("Accounts Receivable", AR_FILTERS))


# --- records a test needs, created inside its transaction ----------------------------


def submitted_journal_entry(company: str = COMPANY) -> str:
	"""A submitted Journal Entry of the company: the site's latest, or a new one."""
	name = frappe.db.get_value(
		"Journal Entry", {"docstatus": 1, "company": company}, "name", order_by="creation desc"
	)
	if name:
		return name
	cash = frappe.db.get_value(
		"Account", {"company": company, "is_group": 0, "account_type": ["in", ["Cash", "Bank"]]}, "name"
	)
	income = frappe.db.get_value(
		"Account", {"company": company, "is_group": 0, "root_type": "Income", "account_type": ""}, "name"
	)
	cost_center = frappe.get_cached_value("Company", company, "cost_center")
	je = frappe.get_doc(
		{
			"doctype": "Journal Entry",
			"company": company,
			"posting_date": _SITE.to_date if getdate(_SITE.to_date) < getdate() else nowdate(),
			"user_remark": "Report View test entry",
			"accounts": [
				{"account": cash, "debit_in_account_currency": 100, "cost_center": cost_center},
				{"account": income, "credit_in_account_currency": 100, "cost_center": cost_center},
			],
		}
	)
	je.insert()
	je.submit()
	return je.name


def report_print_format(report: str, print_format_type: str = "Jinja", html: str | None = None) -> str:
	"""An enabled report print format of that type: the site's, or a new one."""
	name = frappe.db.get_value(
		"Print Format",
		{
			"report": report,
			"print_format_type": print_format_type,
			"disabled": 0,
			"print_format_for": "Report",
		},
		"name",
	)
	if name:
		return name
	if html is None:
		html = (
			"<table>{% for row in data %}<tr><td>{{ row.account or '' }}</td>"
			"<td>{{ row.debit or '' }}</td></tr>{% endfor %}</table>"
			"<p>{{ filters.to_date }}</p>"
		)
	doc = frappe.get_doc(
		{
			"doctype": "Print Format",
			"name": f"RV Test {report} {print_format_type}",
			"print_format_for": "Report",
			"report": report,
			"print_format_type": print_format_type,
			"custom_format": 1,
			"standard": "No",
			"html": html,
		}
	).insert()
	return doc.name


def report_builder_report() -> str:
	"""An enabled Report Builder report: the site's, or a new one."""
	name = frappe.db.get_value("Report", {"report_type": "Report Builder", "disabled": 0}, "name")
	if name:
		return name
	return (
		frappe.get_doc(
			{
				"doctype": "Report",
				"report_name": "RV Test Report Builder",
				"ref_doctype": "ToDo",
				"report_type": "Report Builder",
				"is_standard": "No",
				"json": "{}",
			}
		)
		.insert()
		.name
	)


# --- users ---------------------------------------------------------------------------


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


def purge_users(users: list[str]) -> None:
	"""Delete test users and what Frappe created with them (contact, shares, permissions)."""
	for user in users:
		frappe.db.delete("User Permission", {"user": user})
		for contact in frappe.get_all("Contact", filters={"user": user}, pluck="name"):
			frappe.delete_doc("Contact", contact, force=True, ignore_permissions=True)
		frappe.delete_doc("User", user, force=True, ignore_permissions=True)
		frappe.db.delete("DefaultValue", {"parent": user})
		frappe.db.delete("Comment", {"reference_doctype": "User", "reference_name": user})


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
	"""Creates the rv_t_* users once per class; everything is rolled back afterwards.

	After the rollback the users must be gone. If they are not, something in the class
	committed the test transaction: the users are removed and the class fails, with the
	stack of the first commit Frappe saw."""

	users: dict[str, str]

	@classmethod
	def setUpClass(cls) -> None:
		super().setUpClass()
		frappe.set_user("Administrator")
		cls.users = make_users()
		cls._first_commit = None
		frappe.db.before_commit.add(cls._watch_commit)
		# Role/permission caches built while the test users exist must not outlive the rollback.
		cls.addClassCleanup(cls._rollback_and_check)

	@classmethod
	def _watch_commit(cls) -> None:
		if cls._first_commit is None:
			cls._first_commit = "".join(traceback.format_stack(limit=12))

	@classmethod
	def _rollback_and_check(cls) -> None:
		frappe.db.rollback()
		frappe.set_user("Administrator")
		users = list(cls.users.values())
		leaked = frappe.get_all("User", filters={"name": ["in", users]}, pluck="name")
		logs = frappe.get_all("Error Log", filters={"owner": ["in", users]}, pluck="name")
		# only the caches of the test users (roles, permissions, defaults, boot), not the site's
		for user in users:
			frappe.clear_cache(user=user)
		if leaked or logs:
			purge_users(leaked)
			for name in logs:
				frappe.delete_doc("Error Log", name, force=True, ignore_permissions=True)
			frappe.db.commit()
			raise AssertionError(
				f"{cls.__name__} committed the test transaction; {len(leaked)} test users and {len(logs)} "
				"Error Logs of theirs outlived the rollback and were removed.\nFirst commit seen:\n"
				f"{cls._first_commit or '(implicit: DDL or a second connection)'}"
			)

	def as_user(self, kind: str):
		return self.set_user(self.users[kind])
