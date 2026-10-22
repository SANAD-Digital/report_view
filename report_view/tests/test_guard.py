import frappe

from report_view.core.errors import RVInvalidInput, RVNoExport, RVNoPrint, RVUnsupportedReport
from report_view.core.guard import (
	guard_doc_print,
	guard_export,
	guard_print,
	guard_report,
	guard_report_quiet,
)
from report_view.tests.utils import RVTestCase, report_builder_report


class TestGuard(RVTestCase):
	def test_guard_report_allowed(self):
		with self.as_user("accountant"):
			report = guard_report("Trial Balance")
		self.assertEqual(report.name, "Trial Balance")

	def test_guard_report_denied_without_roles(self):
		with self.as_user("none"), self.assertRaises(frappe.PermissionError):
			guard_report("Trial Balance")

	def test_guard_report_missing(self):
		with self.as_user("accountant"), self.assertRaises(frappe.DoesNotExistError):
			guard_report("No Such Report RV")

	def test_guard_report_unsupported_type(self):
		builder = report_builder_report()
		with self.as_user("admin"), self.assertRaises(RVUnsupportedReport):
			guard_report(builder)

	def test_guard_report_quiet(self):
		with self.as_user("accountant"):
			self.assertEqual(guard_report_quiet("Trial Balance").name, "Trial Balance")
		with self.as_user("none"):
			frappe.local.message_log = []
			self.assertIsNone(guard_report_quiet("Trial Balance"))
			self.assertEqual(frappe.local.message_log, [])

	def test_guard_export(self):
		with self.as_user("accountant"):
			guard_export(guard_report("Trial Balance"))
			report = guard_report("Accounts Receivable")
			if frappe.permissions.can_export("Sales Invoice"):
				self.skipTest("Accounts User can export Sales Invoice on this site")
			with self.assertRaises(RVNoExport):
				guard_export(report)

	def test_guard_print(self):
		with self.as_user("accountant"):
			guard_print(guard_report("Trial Balance"))
		with self.as_user("auditor"):
			report = guard_report("Trial Balance")
			if frappe.has_permission("GL Entry", "print", ignore_share_permissions=True):
				self.skipTest("Auditor can print GL Entry on this site")
			with self.assertRaises(RVNoPrint):
				guard_print(report)

	def test_guard_doc_print(self):
		"""C4: the one document print check of the document page and of its PDF."""
		from report_view.api import document, pdf

		self.assertIs(document.guard_doc_print, guard_doc_print)
		self.assertIs(pdf.guard_doc_print, guard_doc_print)
		company = frappe.db.get_value("Company", {}, "name")
		with self.as_user("admin"):
			self.assertEqual(guard_doc_print("Company", company).name, company)
			for doctype, name in (("", ""), ("Company", None), (None, company)):
				with self.subTest(doctype=doctype, name=name), self.assertRaises(RVInvalidInput):
					guard_doc_print(doctype, name)
			# a child table is not a document; an unknown doctype or name does not exist
			for doctype, name in (
				("Journal Entry Account", "x"),
				("No Such Doctype", "x"),
				("Company", "rv-no-such"),
			):
				with self.subTest(doctype=doctype), self.assertRaises(frappe.DoesNotExistError):
					guard_doc_print(doctype, name)
		with self.as_user("none"), self.assertRaises(frappe.PermissionError):
			guard_doc_print("Company", company)
