"""The document print page API (ADR-017): a document's print format in the pages of
Report View, behind the print permission on the document."""

import frappe

from report_view.api import document as api
from report_view.core.errors import RVInvalidInput
from report_view.tests.utils import COMPANY, RVTestCase


def a_journal_entry():
	return frappe.db.get_value("Journal Entry", {"docstatus": 1, "company": COMPANY}, "name")


class TestDocumentPrint(RVTestCase):
	def setUp(self):
		self.je = a_journal_entry()
		if not self.je:
			self.skipTest("no submitted Journal Entry on this site")

	def test_options_of_a_document(self):
		with self.as_user("accountant"):
			out = api.get_doc_print_options("Journal Entry", self.je)
		self.assertEqual((out["doctype"], out["name"]), ("Journal Entry", self.je))
		for name in out["print_formats"]:
			pf = frappe.get_doc("Print Format", name)
			self.assertEqual((pf.doc_type, pf.disabled), ("Journal Entry", 0))
		# document signatures only (for this doctype or for all)
		for s in out["print_signatures"]:
			self.assertEqual(frappe.db.get_value("Print Signature", s["name"], "signature_for"), "Document")
		self.assertIn("print_max_pages", out["limits"])

	def test_the_format_is_frappes_html_without_its_letter_head(self):
		with self.as_user("accountant"):
			out = api.render_doc_print("Journal Entry", self.je)
		self.assertEqual(out["type"], "Jinja")
		self.assertIn(self.je, out["html"])
		self.assertIn("print-format", out["css"])
		self.assertNotIn('class="letter-head"', out["html"])
		with self.as_user("accountant"), self.assertRaises(frappe.DoesNotExistError):
			api.render_doc_print("Journal Entry", self.je, "No Such Format")

	def test_print_permission_is_required(self):
		with self.as_user("none"):
			for call in (
				lambda: api.get_doc_print_options("Journal Entry", self.je),
				lambda: api.render_doc_print("Journal Entry", self.je),
				lambda: api.get_doc_translations("Journal Entry", self.je, "ar", ["Total"]),
			):
				with self.assertRaises(frappe.PermissionError):
					call()
		with self.as_user("accountant"):
			with self.assertRaises(RVInvalidInput):
				api.get_doc_print_options("", "")
			with self.assertRaises(frappe.DoesNotExistError):
				api.get_doc_print_options("No Such Doctype", "x")

	def test_heading_signature_and_letter_head_with_the_document(self):
		heading = frappe.get_doc(
			{"doctype": "Print Heading", "print_heading": "RV Doc Heading", "description": "{{ doc.name }} / {{ doc.voucher_type }}"}
		).insert(ignore_if_duplicate=True)
		frappe.get_doc(
			{
				"doctype": "Print Signature",
				"signature_name": "RV Doc Sig",
				"signature_for": "Document",
				"reference_doctype": "Journal Entry",
				"content_type": "HTML",
				"html": "<p>{{ doc.name }}</p>",
			}
		).insert()
		frappe.get_doc(
			{"doctype": "Print Signature", "signature_name": "RV Other Doc Sig", "signature_for": "Document", "reference_doctype": "Sales Invoice", "content_type": "HTML", "html": "<p>x</p>"}
		).insert()
		with self.as_user("accountant"):
			h = api.render_doc_heading("Journal Entry", self.je, heading.name)
			self.assertIn(self.je, h["html"])
			s = api.render_doc_signature("Journal Entry", self.je, "RV Doc Sig")
			self.assertIn(f"<p>{self.je}</p>", s["html"])
			with self.assertRaises(frappe.DoesNotExistError):
				api.render_doc_signature("Journal Entry", self.je, "RV Other Doc Sig")
			names = {x["name"] for x in api.get_doc_print_options("Journal Entry", self.je)["print_signatures"]}
			self.assertIn("RV Doc Sig", names)
			self.assertNotIn("RV Other Doc Sig", names)
			lh = frappe.db.get_value("Letter Head", {"disabled": 0}, "name")
			if lh:
				out = api.render_doc_letterhead("Journal Entry", self.je, lh)
				self.assertEqual(set(out) - {"header", "footer"}, set())
