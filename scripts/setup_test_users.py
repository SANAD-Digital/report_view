"""Create the report_view test users on a DEVELOPMENT site.

Run from the bench "sites" directory:
    cd sites && ../env/bin/python ../apps/report_view/scripts/setup_test_users.py <site> [company]

Idempotent: re-running updates roles, passwords and permissions in place.
Passwords are development-only and are documented in docs/progress/phase-0.md.
This is a development setup script, not application code: it is never imported
by the app.
"""

import sys

import frappe
from frappe.permissions import update as update_perm

USERS = {
	"rv_admin": {"roles": ["System Manager"], "password": "***REMOVED***"},
	"rv_accountant": {"roles": ["Accounts User", "Accounts Manager"], "password": "***REMOVED***"},
	"rv_restricted": {"roles": ["Accounts User"], "password": "***REMOVED***"},
	"rv_noexport": {"roles": ["Accounts User"], "password": "***REMOVED***"},
	"rv_none": {"roles": [], "password": "***REMOVED***"},
}
EMAIL_DOMAIN = "rv.test"
NO_EXPORT_DOCTYPES = ("GL Entry", "Account")


def email_of(username):
	return f"{username}@{EMAIL_DOMAIN}"


def upsert_user(username, cfg):
	email = email_of(username)
	if frappe.db.exists("User", email):
		user = frappe.get_doc("User", email)
	else:
		user = frappe.new_doc("User")
		user.email = email
		user.first_name = username
		user.username = username
	user.enabled = 1
	user.user_type = "System User"
	user.send_welcome_email = 0
	user.new_password = cfg["password"]
	user.set("roles", [])
	for role in cfg["roles"]:
		user.append("roles", {"role": role})
	user.save()
	return email


def restrict_to_company(email, company):
	filters = {"user": email, "allow": "Company", "for_value": company}
	if not frappe.db.exists("User Permission", filters):
		frappe.get_doc({"doctype": "User Permission", "apply_to_all_doctypes": 1, **filters}).insert()


def remove_export_for_accounts_user():
	# Export is a role-level permission in Frappe, so the only way to give an
	# Accounts User no export right is to clear it on the role itself.
	for doctype in NO_EXPORT_DOCTYPES:
		update_perm(doctype, "Accounts User", 0, "export", 0)


def main(site, company=None):
	frappe.init(site=site)
	frappe.connect()
	frappe.set_user("Administrator")
	try:
		if not company:
			company = frappe.db.get_single_value("Global Defaults", "default_company")
		for username, cfg in USERS.items():
			email = upsert_user(username, cfg)
			print("user ok:", email, cfg["roles"])
		restrict_to_company(email_of("rv_restricted"), company)
		print("rv_restricted limited to company:", company)
		remove_export_for_accounts_user()
		print("export cleared for Accounts User on:", NO_EXPORT_DOCTYPES)
		frappe.db.commit()
	finally:
		frappe.destroy()


if __name__ == "__main__":
	main(*sys.argv[1:])
