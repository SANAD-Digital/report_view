"""The document print page API (ADR-017): a document's print format in the pages of
Report View, behind the print permission on the document."""

from unittest.mock import patch

import frappe
from frappe.tests import UnitTestCase

from report_view.api import document as api
from report_view.core.errors import RVInvalidInput
from report_view.tests.utils import RVTestCase, submitted_journal_entry


class TestDocumentPrint(RVTestCase):
	def setUp(self):
		self.je = submitted_journal_entry()

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

	def test_a_print_style_dresses_the_standard_format_only(self):
		"""Frappe's Print Styles, its own first in its order; the one chosen reaches Frappe's
		renderer for the Standard format; an unknown one is refused."""
		if frappe.get_meta("Journal Entry").default_print_format:
			self.skipTest("Journal Entry has a default print format on this site")
		with self.as_user("accountant"):
			opts = api.get_doc_print_options("Journal Entry", self.je)
		styles = opts["print_styles"]
		ours = [s for s in styles if s in api._STANDARD_PRINT_STYLES]
		self.assertEqual(ours, [s for s in api._STANDARD_PRINT_STYLES if s in styles])
		self.assertEqual(styles[: len(ours)], ours)
		if not styles:
			self.skipTest("no Print Style on this site")
		seen = []
		real = api.get_html_and_style

		def spy(*args, **kwargs):
			seen.append(kwargs.get("style"))
			return real(*args, **kwargs)

		with self.as_user("accountant"), patch.object(api, "get_html_and_style", side_effect=spy):
			api.render_doc_print("Journal Entry", self.je, print_style=styles[0])
			api.render_doc_print("Journal Entry", self.je)
			with self.assertRaises(frappe.DoesNotExistError):
				api.render_doc_print("Journal Entry", self.je, print_style="No Such Style")
		self.assertEqual(seen, [styles[0], None])

	def test_the_documents_own_print_settings_only_are_taken(self):
		"""Frappe's additional print settings: the document's own (get_print_settings) as 0/1;
		a flag such as allow_print_for_draft is never changed from the print page."""
		doc = frappe._dict(get_print_settings=lambda: ["compact_item_print", "print_uom_after_quantity"])
		out = api._allowed_doc_settings(
			doc, '{"compact_item_print": true, "print_uom_after_quantity": "0", "allow_print_for_draft": 1}'
		)
		self.assertEqual(out, {"compact_item_print": 1, "print_uom_after_quantity": 0})
		self.assertEqual(api._allowed_doc_settings(doc, None), {})
		with self.assertRaises(RVInvalidInput):
			api._allowed_doc_settings(doc, "[1, 2]")
		with self.as_user("accountant"):
			opts = api.get_doc_print_options("Journal Entry", self.je)
		self.assertIsInstance(opts["doc_settings"], list)
		for f in opts["doc_settings"]:
			self.assertEqual(set(f), {"fieldname", "label", "default"})

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
			{
				"doctype": "Print Heading",
				"print_heading": "RV Doc Heading",
				"description": "{{ doc.name }} / {{ doc.voucher_type }}",
			}
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
			{
				"doctype": "Print Signature",
				"signature_name": "RV Other Doc Sig",
				"signature_for": "Document",
				"reference_doctype": "Sales Invoice",
				"content_type": "HTML",
				"html": "<p>x</p>",
			}
		).insert()
		with self.as_user("accountant"):
			h = api.render_doc_heading("Journal Entry", self.je, heading.name)
			self.assertIn(self.je, h["html"])
			s = api.render_doc_signature("Journal Entry", self.je, "RV Doc Sig")
			self.assertIn(f"<p>{self.je}</p>", s["html"])
			with self.assertRaises(frappe.DoesNotExistError):
				api.render_doc_signature("Journal Entry", self.je, "RV Other Doc Sig")
			names = {
				x["name"] for x in api.get_doc_print_options("Journal Entry", self.je)["print_signatures"]
			}
			self.assertIn("RV Doc Sig", names)
			self.assertNotIn("RV Other Doc Sig", names)
			lh = frappe.db.get_value("Letter Head", {"disabled": 0}, "name")
			if lh:
				out = api.render_doc_letterhead("Journal Entry", self.je, lh)
				self.assertEqual(set(out) - {"header", "footer"}, set())

	def test_a_letter_head_prints_the_document_escaped(self):
		lh = frappe.get_doc(
			{
				"doctype": "Letter Head",
				"letter_head_name": "RV Test Escaped Letter Head",
				"source": "HTML",
				"content": "<div>{{ doc.user_remark }}</div>",
				"footer": "{{ doc.user_remark|e }}",
			}
		).insert(ignore_if_duplicate=True)
		doc = frappe.get_doc("Journal Entry", self.je)
		doc.user_remark = "<img src=x onerror=alert(1)>"
		with self.as_user("accountant"), patch.object(api, "guard_doc_print", return_value=doc):
			out = api.render_doc_letterhead("Journal Entry", self.je, lh.name)
		self.assertEqual(out["header"], "<div>&lt;img src=x onerror=alert(1)&gt;</div>")
		self.assertEqual(out["footer"], "&lt;img src=x onerror=alert(1)&gt;")


class TestDocumentFragment(UnitTestCase):
	"""A format of Frappe's new print format builder comes back as a whole document: the pages
	take its body, and its styles apart."""

	def test_a_whole_document_gives_its_body_and_its_styles(self):
		from report_view.core.printing import document_fragment

		whole = (
			'<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>X</title>'
			'<link rel="stylesheet" href="/assets/frappe/dist/css/print_format.bundle.css">'
			"<style>body { display: flex; } .a { color: red; }</style></head>"
			'<body><div class="print-format-doc"><p>Body</p></div><script>alert(1)</script></body></html>'
		)
		html, css = document_fragment(whole, ".own { margin: 0 }")
		self.assertEqual(html, '<div class="print-format-doc"><p>Body</p></div>')
		self.assertIn(".own { margin: 0 }", css)
		self.assertIn("body { display: flex; }", css)
		self.assertNotIn("print_format.bundle", html + css)
		# a fragment comes back as it came
		self.assertEqual(document_fragment("<div>x</div>", "c"), ("<div>x</div>", "c"))
		# the classes of <body> stay on an element around its content (the builder's
		# <body class="print-format-doc">, which every rule of the format starts from)
		html, _ = document_fragment(
			'<!DOCTYPE html><html><body class="print-format-doc"><p>B</p></body></html>'
		)
		self.assertEqual(html, '<div class="print-format-doc"><p>B</p></div>')

	def test_the_stylesheets_a_whole_document_links(self):
		"""Frappe's own (under /assets/) are kept for the pages to set under the format; a
		stylesheet of another site, and a fragment, give none."""
		from report_view.core.printing import linked_stylesheets

		whole = (
			'<!DOCTYPE html><html><head><link rel="stylesheet" href="/assets/frappe/dist/css/print_format.bundle.X.css">'
			'<link rel="stylesheet" href="https://example.com/x.css"><link rel="icon" href="/assets/i.png"></head><body></body></html>'
		)
		self.assertEqual(linked_stylesheets(whole), ["/assets/frappe/dist/css/print_format.bundle.X.css"])
		self.assertEqual(linked_stylesheets("<div>x</div>"), [])
