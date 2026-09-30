import frappe

from report_view import api
from report_view.core.errors import RVEnrichNotAllowed, RVLimitExceeded
from report_view.tests.utils import COMPANY, RVTestCase


class TestEnrich(RVTestCase):
	@classmethod
	def setUpClass(cls) -> None:
		super().setUpClass()
		cls.accounts = frappe.get_list(
			"Account", filters={"company": COMPANY, "is_group": 0}, pluck="name", limit=5
		)

	def test_allowed_user(self):
		names = [*self.accounts, "RV no such account"]
		with self.as_user("accountant"):
			out = api.enrich("Trial Balance", "Account", names, ["root_type", "account_type"], "account")
		self.assertEqual(out["doctype"], "Account")
		self.assertEqual(set(out["rows"]), set(self.accounts))
		self.assertEqual(out["missing"], 1)
		self.assertEqual(out["dropped_fields"], [])
		for values in out["rows"].values():
			self.assertEqual(set(values), {"root_type", "account_type"})

	def test_triple_not_in_allowlist(self):
		with self.as_user("accountant"):
			for doctype, fields, source in (
				("Account", ["account_number"], "account"),
				("Account", ["root_type"], "parent_account"),
				("Company", ["root_type"], "account"),
			):
				with self.subTest(doctype=doctype, fields=fields, source=source):
					with self.assertRaises(RVEnrichNotAllowed):
						api.enrich("Trial Balance", doctype, self.accounts, fields, source)
			with self.assertRaises(RVEnrichNotAllowed):
				api.enrich("General Ledger", "Account", self.accounts, ["root_type"], "account")

	def test_field_syntax_rejected(self):
		with self.as_user("accountant"):
			for field in ("parent.root_type", "root_type)", "root type"):
				with self.subTest(field=field), self.assertRaises(RVEnrichNotAllowed):
					api.enrich("Trial Balance", "Account", self.accounts, [field], "account")

	def test_names_limit(self):
		with self.as_user("accountant"), self.assertRaises(RVLimitExceeded):
			api.enrich("Trial Balance", "Account", [f"a{i}" for i in range(5001)], ["root_type"], "account")

	def test_user_permissions_apply(self):
		with self.as_user("restricted"):
			out = api.enrich("Trial Balance", "Account", self.accounts, ["root_type"], "account")
		self.assertEqual(out["rows"], {})
		self.assertEqual(out["missing"], len(self.accounts))

	def test_denied_user(self):
		with self.as_user("none"), self.assertRaises(frappe.PermissionError):
			api.enrich("Trial Balance", "Account", self.accounts, ["root_type"], "account")
