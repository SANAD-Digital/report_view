"""Create the report_view test users on a DEVELOPMENT site.

Run from the bench "sites" directory:
    cd sites && ../env/bin/python ../apps/report_view/scripts/setup_test_users.py <site> [company]

Idempotent: re-running updates roles, passwords and permissions in place.
The passwords come from the environment, one variable per user (never from the
code): RV_ADMIN_PASSWORD, RV_ACCOUNTANT_PASSWORD, RV_RESTRICTED_PASSWORD,
RV_NOEXPORT_PASSWORD and RV_NONE_PASSWORD (the upper-case username + _PASSWORD).
This is a development setup script, not application code: it is never imported
by the app.
"""

import os
import sys

import frappe
from frappe.permissions import update_permission_property

USERS = {
	"rv_admin": {"roles": ["System Manager"]},
	"rv_accountant": {"roles": ["Accounts User", "Accounts Manager"]},
	"rv_restricted": {"roles": ["Accounts User"]},
	"rv_noexport": {"roles": ["Accounts User"]},
	"rv_none": {"roles": []},
}
EMAIL_DOMAIN = "rv.test"
NO_EXPORT_DOCTYPES = ("GL Entry", "Account")


def email_of(username):
	return f"{username}@{EMAIL_DOMAIN}"


def password_variable(username):
	return f"{username.upper()}_PASSWORD"


def read_passwords():
	"""{username: password} from the environment; exits naming every missing variable."""
	passwords = {u: os.environ.get(password_variable(u)) for u in USERS}
	missing = [password_variable(u) for u, p in passwords.items() if not p]
	if missing:
		sys.exit("Set the test users' passwords in the environment: " + ", ".join(missing))
	return passwords


def upsert_user(username, cfg, password):
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
	user.new_password = password
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
		update_permission_property(doctype, "Accounts User", 0, "export", 0)


def main(site, company=None):
	passwords = read_passwords()
	frappe.init(site=site)
	frappe.connect()
	frappe.set_user("Administrator")
	try:
		if not company:
			company = frappe.db.get_single_value("Global Defaults", "default_company")
		for username, cfg in USERS.items():
			email = upsert_user(username, cfg, passwords[username])
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
