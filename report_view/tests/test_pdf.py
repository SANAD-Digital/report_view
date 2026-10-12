from io import BytesIO

import frappe
from pypdf import PdfReader

from report_view.api.pdf import pages_pdf_document, pages_pdf_report
from report_view.core.errors import RVInvalidInput
from report_view.core.pdf import MAX_HTML_BYTES, html_to_pdf, render_pdf
from report_view.tests.utils import COMPANY, RVTestCase


def _pages_html(body_extra: str = "", head_extra: str = "") -> str:
	base = frappe.utils.get_url().rstrip("/") + "/"
	return (
		"<!doctype html><html><head>"
		f'<base href="{base}"><title>orig</title>'
		"<style>@page{size:210mm 297mm;margin:0} body{margin:0}"
		" section{width:210mm;height:297mm;box-sizing:border-box;overflow:hidden;break-after:page}"
		" section:last-of-type{break-after:auto} .bg{background:#1f6feb;color:#fff}</style>"
		f"{head_extra}</head><body>"
		'<section class="bg"><div id="marker">orig marker</div></section>'
		f"<section>second page{body_extra}</section>"
		"</body></html>"
	)


class TestPdf(RVTestCase):
	def test_two_a4_pages(self):
		pdf = html_to_pdf(_pages_html())
		self.assertTrue(pdf.startswith(b"%PDF"))
		reader = PdfReader(BytesIO(pdf))
		self.assertEqual(len(reader.pages), 2)
		for page in reader.pages:
			self.assertAlmostEqual(float(page.mediabox.width), 595, delta=1)
			self.assertAlmostEqual(float(page.mediabox.height), 842, delta=1)

	def test_title_metadata(self):
		reader = PdfReader(BytesIO(html_to_pdf(_pages_html(), title="Trial Balance 2026")))
		self.assertEqual(reader.metadata.title, "Trial Balance 2026")

	def test_network_policy(self):
		external = "https://example.com/x.png"
		api = "/api/method/frappe.auth.get_logged_user"
		asset = "/assets/frappe/images/frappe-framework-logo.svg"
		result = render_pdf(
			_pages_html(
				f'<img src="{external}"><img src="{api}"><img src="/private/files/x.png">'
				f'<img src="http://127.0.0.1:8000{asset}"><img src="{asset}">'
			)
		)
		self.assertEqual(result.pages, 2)
		blocked = " ".join(result.blocked)
		self.assertIn(external, blocked)
		self.assertIn(api, blocked)
		self.assertIn("/private/files/x.png", blocked)
		self.assertIn("127.0.0.1:8000", blocked)
		self.assertEqual(len(result.served), 1)
		self.assertTrue(result.served[0].endswith(asset))

	def test_scripts_do_not_run(self):
		script = (
			"<script>document.title='ran';document.getElementById('marker').textContent='ran marker'</script>"
		)
		reader = PdfReader(BytesIO(html_to_pdf(_pages_html(body_extra=script))))
		self.assertEqual(reader.metadata.title, "orig")
		text = reader.pages[0].extract_text()
		self.assertIn("orig marker", text)
		self.assertNotIn("ran marker", text)

	def test_html_size_cap(self):
		with self.assertRaises(RVInvalidInput):
			html_to_pdf("x" * (MAX_HTML_BYTES + 1))

	def test_report_endpoint(self):
		with self.as_user("none"), self.assertRaises(frappe.PermissionError):
			pages_pdf_report("Trial Balance", _pages_html())
		with self.as_user("accountant"):
			pages_pdf_report("Trial Balance", _pages_html(), title="Trial/Balance")
			self.assertEqual(frappe.local.response.filename, "Trial-Balance.pdf")
			self.assertEqual(frappe.local.response.type, "pdf")
			self.assertTrue(frappe.local.response.filecontent.startswith(b"%PDF"))

	def test_document_endpoint(self):
		with self.as_user("none"), self.assertRaises(frappe.PermissionError):
			pages_pdf_document("Company", COMPANY, _pages_html())
		with self.as_user("admin"):
			pages_pdf_document("Company", COMPANY, _pages_html())
			self.assertEqual(frappe.local.response.filename, f"{COMPANY}.pdf")
			self.assertTrue(frappe.local.response.filecontent.startswith(b"%PDF"))
