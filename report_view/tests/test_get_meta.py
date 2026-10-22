import frappe

from report_view import api
from report_view.tests.utils import RVTestCase


class TestGetMeta(RVTestCase):
	def test_allowed_user(self):
		with self.as_user("accountant"):
			meta = api.get_meta("Trial Balance")
		self.assertEqual(
			set(meta), {"report", "script", "perms", "settings", "include_js", "limits", "defaults"}
		)
		self.assertEqual(meta["report"]["ref_doctype"], "GL Entry")
		self.assertIn("frappe.query_reports", meta["script"]["script"])
		self.assertTrue(meta["perms"]["can_export"])
		self.assertEqual(meta["settings"]["source"], "defaults")
		self.assertEqual(
			meta["settings"]["enrich_rules"],
			[
				{
					"source_column": "account",
					"link_doctype": "Account",
					"fields": ["root_type", "account_type"],
				}
			],
		)
		self.assertEqual(
			[d["fieldname"] for d in meta["settings"]["filter_defs"]],
			["company", "fiscal_year", "cost_center", "project", "finance_book"],
		)
		self.assertEqual(meta["limits"], {"max_rows": 100000})
		self.assertEqual(meta["defaults"], {"saved_view": None, "source": None})

	def test_report_without_settings(self):
		with self.as_user("accountant"):
			meta = api.get_meta("Account Balance")
		self.assertIsNone(meta["settings"]["source"])
		self.assertEqual(meta["settings"]["enrich_rules"], [])

	def test_perms_reflect_export_and_print(self):
		with self.as_user("accountant"):
			meta = api.get_meta("Accounts Receivable")
			expected = bool(frappe.permissions.can_export("Sales Invoice"))
		self.assertEqual(meta["perms"]["can_export"], expected)
		with self.as_user("auditor"):
			meta = api.get_meta("Trial Balance")
			expected = frappe.has_permission("GL Entry", "print", ignore_share_permissions=True)
		self.assertEqual(meta["perms"]["can_print"], expected)

	def test_denied_user(self):
		with self.as_user("none"), self.assertRaises(frappe.PermissionError):
			api.get_meta("Trial Balance")


class TestGetEntryState(RVTestCase):
	def test_allowed_user_sees_button(self):
		with self.as_user("accountant"):
			state = api.get_entry_state("Trial Balance")
		self.assertEqual(state, {"show": True, "route": ["report-view", "Trial Balance"]})

	def test_denied_user_gets_no_button_and_no_messages(self):
		with self.as_user("none"):
			frappe.local.message_log = []
			self.assertEqual(api.get_entry_state("Trial Balance"), {"show": False})
			self.assertEqual(frappe.local.message_log, [])

	def test_missing_report(self):
		with self.as_user("accountant"):
			self.assertEqual(api.get_entry_state("No Such Report RV"), {"show": False})
