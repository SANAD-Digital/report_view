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
				f'<img src="http://127.0.0.1:8000/api/method/ping"><img src="https://other.example/files/x.png">'
				f'<img src="https://other.example{asset}"><img src="{asset}">'
			)
		)
		self.assertEqual(result.pages, 2)
		blocked = " ".join(result.blocked)
		self.assertIn(external, blocked)
		self.assertIn(api, blocked)
		self.assertIn("/private/files/x.png", blocked)
		self.assertIn("127.0.0.1:8000/api/method/ping", blocked)
		# another host's /files/ is not this site's
		self.assertIn("other.example/files/x.png", blocked)
		# /assets/ are the bench's own files: served from disk whatever host is named, never fetched
		self.assertEqual(len(result.served), 2)
		self.assertTrue(all(u.endswith(asset) for u in result.served))

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


def _sheets_html(n: int) -> str:
	"""A document shaped as the Pages view sends it: sheets in .rv-print-sheets, then the
	paper's style; each sheet says its number."""
	base = frappe.utils.get_url().rstrip("/") + "/"
	sheets = "".join(
		f'<section class="rv-page ps-classic" data-page="{i}">sheet {i + 1}</section>' for i in range(n)
	)
	return (
		f'<!doctype html><html><head><base href="{base}"><title>t</title><style>body{{margin:0}}'
		" .rv-page{width:210mm;height:297mm;box-sizing:border-box;overflow:hidden;break-after:page}"
		" .rv-page:last-child{break-after:auto}</style></head><body>"
		f'<div class="rv rv-print-root"><div class="rv-print-sheets">{sheets}</div><style>@page{{size:210mm 297mm;margin:0}}</style></div>'
		"</body></html>"
	)


class TestPdfBatches(RVTestCase):
	def test_many_sheets_print_in_batches_and_merge_in_order(self):
		from report_view.core import pdf

		html = _sheets_html(95)
		self.assertEqual(pdf.count_sheets(html), 95)
		chunks = pdf.split_sheets(html, size=40)
		self.assertEqual([pdf.count_sheets(c) for c in chunks], [40, 40, 15])
		self.assertTrue(all(c.endswith("</html>") and "@page{size" in c for c in chunks))
		seen = []
		result = pdf.render_pdf(html, progress=lambda done, total: seen.append((done, total)))
		reader = PdfReader(BytesIO(result.pdf))
		self.assertEqual(len(reader.pages), 95)
		# merged in the order of the sheets
		for i in (0, 39, 40, 94):
			self.assertIn(f"sheet {i + 1}", reader.pages[i].extract_text())
		self.assertEqual(seen[-1], (95, 95))
		self.assertEqual(sorted(d for d, _ in seen), [d for d, _ in seen])

	def test_a_document_without_sheets_stays_whole(self):
		from report_view.core import pdf

		self.assertEqual(len(pdf.split_sheets(_pages_html(), size=1)), 1)

	def test_report_views_own_chromium_when_the_bench_has_it(self):
		from report_view.core import pdf

		path = pdf.chromium_path()
		if not path:
			self.skipTest("no chromium-rv on this bench")
		producer = str(PdfReader(BytesIO(pdf.html_to_pdf(_pages_html()))).metadata.get("/Producer"))
		self.assertIn("Skia", producer)


class TestPdfJobs(RVTestCase):
	"""More than SYNC_PAGES sheets: a background job, its progress, its file, for its owner only."""

	def test_a_long_report_is_printed_by_a_job_of_its_user(self):
		from unittest.mock import patch

		from report_view.api import pdf as api_pdf

		html = _sheets_html(api_pdf.SYNC_PAGES + 5)
		with self.as_user("accountant"), patch("report_view.api.pdf.frappe.enqueue") as enqueue:
			out = api_pdf.pages_pdf_report("Trial Balance", html, "Long")
			self.assertEqual(out["total"], api_pdf.SYNC_PAGES + 5)
			job = out["job"]
			enqueue.assert_called_once()
			self.assertEqual(enqueue.call_args.kwargs["queue"], "long")
			self.assertEqual(api_pdf.pages_pdf_status(job)["state"], "queued")
			# the job, as the worker runs it
			api_pdf.run_pdf_job(job)
			st = api_pdf.pages_pdf_status(job)
			self.assertEqual(
				(st["state"], st["done"], st["total"]),
				("done", api_pdf.SYNC_PAGES + 5, api_pdf.SYNC_PAGES + 5),
			)
		# another user's job does not exist for them
		with self.as_user("auditor"), self.assertRaises(frappe.DoesNotExistError):
			api_pdf.pages_pdf_status(job)
		with self.as_user("accountant"):
			api_pdf.pages_pdf_download(job)
			pdf = frappe.local.response.filecontent
			self.assertEqual(len(PdfReader(BytesIO(pdf)).pages), api_pdf.SYNC_PAGES + 5)
			self.assertEqual(frappe.local.response.filename, "Long.pdf")
			# downloaded once: the files and the state are gone
			with self.assertRaises(frappe.DoesNotExistError):
				api_pdf.pages_pdf_status(job)
			with self.assertRaises(RVInvalidInput):
				api_pdf.pages_pdf_status("../../etc/passwd")

	def test_a_few_pages_come_back_at_once(self):
		from report_view.api import pdf as api_pdf

		with self.as_user("accountant"):
			self.assertIsNone(api_pdf.pages_pdf_report("Trial Balance", _sheets_html(3), "Short"))
			self.assertEqual(len(PdfReader(BytesIO(frappe.local.response.filecontent)).pages), 3)

	def test_gzipped_pages_are_read_with_a_size_cap(self):
		import gzip
		from types import SimpleNamespace
		from unittest.mock import patch

		from werkzeug.datastructures import FileStorage

		from report_view.api import pdf as api_pdf

		def upload(data):
			return SimpleNamespace(
				files={"html_gz": FileStorage(BytesIO(data), "pages.html.gz")},
				host=None,
				host_url=frappe.utils.get_url() + "/",
			)

		with self.as_user("accountant"):
			with patch.object(frappe.local, "request", upload(gzip.compress(_sheets_html(2).encode())), create=True):
				self.assertIsNone(api_pdf.pages_pdf_report("Trial Balance", None, "Packed"))
			self.assertEqual(len(PdfReader(BytesIO(frappe.local.response.filecontent)).pages), 2)
			# a small file that unpacks beyond the cap is refused before it is unpacked whole
			bomb = gzip.compress(b"<p>" + b"x" * (2 * 1024 * 1024))
			with (
				patch.object(api_pdf, "MAX_HTML_BYTES", 1024 * 1024),
				patch.object(frappe.local, "request", upload(bomb), create=True),
				self.assertRaises(RVInvalidInput),
			):
				api_pdf.pages_pdf_report("Trial Balance", None, "Bomb")
			with (
				patch.object(frappe.local, "request", upload(b"not gzip"), create=True),
				self.assertRaises(RVInvalidInput),
			):
				api_pdf.pages_pdf_report("Trial Balance", None, "Bad")
