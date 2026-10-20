import os
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
from io import BytesIO
from unittest.mock import patch

import frappe
from pypdf import PdfReader

from report_view.api.pdf import pages_pdf_document, pages_pdf_report
from report_view.core.errors import RVInvalidInput, RVLimitExceeded
from report_view.core.pdf import MAX_HTML_BYTES, RVPdfBusy, RVPdfTimeout, html_to_pdf, render_pdf
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
		'<section class="rv-page bg"><div id="marker">orig marker</div></section>'
		f'<section class="rv-page">second page{body_extra}</section>'
		"</body></html>"
	)


def _chromium_pids() -> set[int]:
	"""This user's processes started with one of the agent's profiles."""
	from report_view.core import pdf

	prefix = os.path.join(pdf.profile_root(), pdf.PROFILE_PREFIX)
	return {pid for pid, profile in pdf._engine_processes() if profile.startswith(prefix)}


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

	def test_html_without_sheets_is_refused(self):
		with self.assertRaises(RVInvalidInput):
			html_to_pdf("<!doctype html><html><body><section>no sheet</section></body></html>")
		with self.as_user("accountant"), self.assertRaises(RVInvalidInput):
			pages_pdf_report("Trial Balance", "<html><body>" + "<p>x</p>" * 1000 + "</body></html>")

	def test_output_pages_are_capped_while_printing(self):
		# one sheet that flows over many pages: printing stops one page past the limit
		flow = "".join('<div style="height:250mm">x</div>' for _ in range(40))
		html = (
			"<!doctype html><html><head><style>@page{size:210mm 297mm;margin:0}</style></head><body>"
			f'<section class="rv-page">{flow}</section></body></html>'
		)
		with patch("report_view.core.pdf.get_print_max_pages", return_value=5):
			with self.assertRaises(RVLimitExceeded) as caught:
				render_pdf(html)
		self.assertEqual(caught.exception.rv_args, [6, 5])

	def test_no_request_leaves_the_engine(self):
		"""The SSRF probe of the audit as a regression test: a local listener must see no
		connection whatever the page tries (frames, prefetch, refresh, workers, file:)."""
		server = socket.socket()
		server.bind(("127.0.0.1", 0))
		server.listen(50)
		server.settimeout(0.2)
		port = server.getsockname()[1]
		hits = []
		stop = threading.Event()

		def accept():
			while not stop.is_set():
				try:
					conn, _addr = server.accept()
				except OSError:
					continue
				hits.append(conn.recv(200))
				conn.close()

		thread = threading.Thread(target=accept, daemon=True)
		thread.start()
		u = f"http://127.0.0.1:{port}"
		vectors = [
			f'<link rel="preconnect" href="{u}/">',
			'<link rel="dns-prefetch" href="//rvprobe-dns.example.invalid">',
			f'<link rel="prefetch" href="{u}/prefetch">',
			f'<link rel="stylesheet" href="{u}/css">',
			f'<iframe src="{u}/iframe"></iframe>',
			f"<iframe src=\"data:text/html,<img src='{u}/dataiframe-img'>\"></iframe>",
			f"<iframe src=\"data:text/html,<script>new Image().src='{u}/dataiframe-js'</script>\"></iframe>",
			f"<iframe srcdoc=\"<script>new Image().src='{u}/srcdoc-js'</script><img src='{u}/srcdoc-img'>\"></iframe>",
			f"<object data=\"data:text/html,<img src='{u}/object-img'>\"></object>",
			f"<img src=\"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><image href='{u}/svgimg' width='10' height='10'/></svg>\">",
			f"<style>@import url(\"data:text/css,@import url('{u}/css-in-data');\");</style>",
			f'<meta http-equiv="refresh" content="0;url={u}/refresh">',
			'<img src="file:///etc/passwd"><iframe src="file:///etc/hostname"></iframe>',
			f'<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" onload="new Image().src=\'{u}/onload\'">',
			f'<svg><script>new Image().src="{u}/svg-script"</script></svg>',
			f'<img src="{u}/img"><video src="{u}/video"></video><audio src="{u}/audio"></audio>',
		]
		try:
			result = render_pdf(_pages_html("".join(vectors)))
			time.sleep(0.5)
		finally:
			stop.set()
			thread.join()
			server.close()
		self.assertEqual(result.pages, 2)
		self.assertEqual(hits, [])
		self.assertTrue(any(f"{u}/img" in b for b in result.blocked))

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


def _sheets_html(n: int, rows: int = 0) -> str:
	"""A document shaped as the Pages view sends it: sheets in .rv-print-sheets, then the
	paper's style; each sheet says its number (and has ``rows`` rows of a table)."""
	base = frappe.utils.get_url().rstrip("/") + "/"
	table = (
		"<table>" + "<tr><td>a</td><td>b</td><td>c</td><td>d</td></tr>" * rows + "</table>" if rows else ""
	)
	sheets = "".join(
		f'<section class="rv-page ps-classic" data-page="{i}">sheet {i + 1}{table}</section>'
		for i in range(n)
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

	def test_a_timeout_stops_every_batch_and_the_engine(self):
		from report_view.core import pdf

		before = _chromium_pids()
		started = time.monotonic()
		with self.assertRaises(RVPdfTimeout):
			pdf.render_pdf(_sheets_html(400, rows=60), timeout=1)
		self.assertLess(time.monotonic() - started, 12)
		self.assertEqual(_chromium_pids() - before, set())

	def test_report_views_own_chromium_when_the_bench_has_it(self):
		from report_view.core import pdf

		path = pdf.chromium_path()
		if not path:
			self.skipTest("no chromium-rv on this bench")
		producer = str(PdfReader(BytesIO(pdf.html_to_pdf(_pages_html()))).metadata.get("/Producer"))
		self.assertIn("Skia", producer)

	def test_frappes_chromium_is_the_fallback_with_a_warning(self):
		from report_view.core import pdf

		frappes = os.path.join(frappe.utils.get_bench_path(), "chromium", "chrome-linux", "headless_shell")
		if not os.path.isfile(frappes):
			# never download it from a test
			self.skipTest("no Frappe Chromium on this bench")
		before = _chromium_pids()
		with (
			patch.object(pdf, "chromium_path", return_value=None),
			patch.object(pdf, "_warned_fallback", False),
			patch.object(pdf.frappe, "logger") as logger,
		):
			result = pdf.render_pdf(_pages_html())
		self.assertEqual(result.pages, 2)
		logger.return_value.warning.assert_called_once()
		self.assertEqual(_chromium_pids() - before, set())

	def test_a_blocked_navigation_keeps_the_content(self):
		for _i in range(3):
			html = _pages_html(head_extra='<meta http-equiv="refresh" content="0;url=https://example.com/x">')
			text = PdfReader(BytesIO(html_to_pdf(html))).pages[0].extract_text()
			self.assertIn("orig marker", text)


class TestPdfJobs(RVTestCase):
	"""More than SYNC_PAGES sheets: a background job, its progress, its file, for its owner only."""

	def tearDown(self):
		from report_view.api import pdf as api_pdf

		for address in self.users.values():
			frappe.cache.delete_value(api_pdf._active_key(address))
		super().tearDown()

	def _start(self, kind="accountant", sheets=None, title="Long"):
		"""A job as the endpoint makes it (not queued for real); ``(job, enqueue mock)``."""
		from report_view.api import pdf as api_pdf

		html = _sheets_html(sheets or api_pdf.SYNC_PAGES + 5)
		with self.as_user(kind), patch("report_view.api.pdf.frappe.enqueue") as enqueue:
			out = api_pdf.pages_pdf_report("Trial Balance", html, title)
		return out["job"], enqueue

	def test_a_long_report_is_printed_by_a_job_of_its_user(self):
		from report_view.api import pdf as api_pdf

		job, enqueue = self._start()
		enqueue.assert_called_once()
		self.assertEqual(enqueue.call_args.kwargs["queue"], "long")
		self.assertEqual(enqueue.call_args.kwargs["timeout"], api_pdf.JOB_TIMEOUT)
		self.assertEqual(enqueue.call_args.kwargs["job_id"], api_pdf._rq_id(job))
		with self.as_user("accountant"):
			st = api_pdf.pages_pdf_status(job)
			self.assertEqual((st["state"], st["stage"], st["cancellable"]), ("queued", "queued", True))
			self.assertLess(st["seconds_since_update"], 5)
			# the job, as the worker runs it
			api_pdf.run_pdf_job(job)
			st = api_pdf.pages_pdf_status(job)
			self.assertEqual(
				(st["state"], st["stage"], st["done"], st["total"], st["error"], st["downloadable"]),
				("done", "done", api_pdf.SYNC_PAGES + 5, api_pdf.SYNC_PAGES + 5, None, True),
			)
		# another user's job does not exist for them
		with self.as_user("auditor"):
			with self.assertRaises(frappe.DoesNotExistError):
				api_pdf.pages_pdf_status(job)
			with self.assertRaises(frappe.DoesNotExistError):
				api_pdf.pages_pdf_cancel(job)
		with self.as_user("accountant"):
			api_pdf.pages_pdf_download(job)
			pdf = frappe.local.response.filecontent
			self.assertEqual(len(PdfReader(BytesIO(pdf)).pages), api_pdf.SYNC_PAGES + 5)
			self.assertEqual(frappe.local.response.filename, "Long.pdf")
			# a dropped download can be asked again: the file stays until it expires
			frappe.local.response.filecontent = None
			api_pdf.pages_pdf_download(job)
			self.assertEqual(frappe.local.response.filecontent, pdf)
			self.assertEqual(api_pdf.pages_pdf_status(job)["state"], "done")
			with self.assertRaises(RVInvalidInput):
				api_pdf.pages_pdf_status("../../etc/passwd")
			# discarding it removes the file
			api_pdf.pages_pdf_cancel(job)
			self.assertFalse(os.path.exists(api_pdf._path(job, "pdf")))

	def test_one_job_per_user_and_cancel(self):
		from report_view.api import pdf as api_pdf

		job, _enqueue = self._start()
		with self.assertRaises(RVPdfBusy):
			self._start()
		# another user is not held up
		other, _enqueue = self._start(kind="restricted")
		with self.as_user("accountant"):
			st = api_pdf.pages_pdf_cancel(job)
			self.assertEqual(
				(st["state"], st["stage"], st["error_code"]), ("failed", "cancelled", "cancelled")
			)
			self.assertEqual(st["error"], frappe._("The PDF was cancelled"))
			self.assertFalse(os.path.exists(api_pdf._path(job, "html")))
			# a cancelled job never starts
			api_pdf.run_pdf_job(job)
			self.assertEqual(api_pdf.pages_pdf_status(job)["stage"], "cancelled")
			with self.assertRaises(RVInvalidInput):
				api_pdf.pages_pdf_download(job)
		again, _enqueue = self._start()
		with self.as_user("accountant"):
			api_pdf.pages_pdf_cancel(again)
		with self.as_user("restricted"):
			api_pdf.pages_pdf_cancel(other)

	def test_a_running_job_stops_when_cancelled(self):
		from report_view.api import pdf as api_pdf
		from report_view.core import pdf

		job, _enqueue = self._start(sheets=300)
		real = pdf.render_pdf

		def cancel_then_render(html, **kwargs):
			progress = kwargs["progress"]

			def cancel_on_first_batch(done, total):
				frappe.cache.set_value(api_pdf._cancel_key(job), 1)
				progress(done, total)

			return real(html, **{**kwargs, "progress": cancel_on_first_batch})

		before = _chromium_pids()
		with (
			self.as_user("accountant"),
			patch("report_view.api.pdf.render_pdf", side_effect=cancel_then_render),
		):
			api_pdf.run_pdf_job(job)
			st = api_pdf.pages_pdf_status(job)
		self.assertEqual((st["state"], st["error_code"]), ("failed", "cancelled"))
		self.assertLess(st["done"], 300)
		self.assertFalse(os.path.exists(api_pdf._path(job, "pdf")))
		self.assertEqual(_chromium_pids() - before, set())

	def test_a_job_without_heartbeat_is_reported_lost(self):
		from report_view.api import pdf as api_pdf

		job, _enqueue = self._start()
		state = api_pdf._get(job)
		api_pdf._set(
			job, {**state, "state": "running", "updated_at": time.time() - api_pdf.STALE_SECONDS - 5}
		)
		with self.as_user("accountant"), patch("report_view.api.pdf.frappe.log_error") as log_error:
			st = api_pdf.pages_pdf_status(job)
			self.assertEqual((st["state"], st["error_code"]), ("failed", "lost"))
			self.assertEqual(st["error"], frappe._("Creating the PDF stopped unexpectedly. Try again."))
			log_error.assert_called_once()
		# the user may start another one at once
		again, _enqueue = self._start()
		with self.as_user("accountant"):
			api_pdf.pages_pdf_cancel(again)

	def test_a_failed_job_says_a_generic_message_and_logs_the_error(self):
		from report_view.api import pdf as api_pdf

		job, _enqueue = self._start()
		with (
			self.as_user("accountant"),
			patch(
				"report_view.api.pdf.render_pdf",
				side_effect=RuntimeError("Page.printToPDF: secret internals"),
			),
			patch("report_view.api.pdf.frappe.log_error") as log_error,
		):
			api_pdf.run_pdf_job(job)
			st = api_pdf.pages_pdf_status(job)
		self.assertEqual((st["state"], st["error_code"]), ("failed", "failed"))
		self.assertNotIn("secret", st["error"])
		log_error.assert_called_once()

	def test_the_queue_comes_from_the_site_config(self):
		from report_view.api import pdf as api_pdf

		with patch.dict(frappe.conf, {api_pdf.QUEUE_CONF: "rv_pdf"}):
			# not a configured worker queue: long
			self.assertEqual(api_pdf._queue(), "long")
			with patch(
				"frappe.utils.background_jobs.get_queues_timeout",
				return_value={"short": 300, "default": 300, "long": 1500, "rv_pdf": 900},
			):
				self.assertEqual(api_pdf._queue(), "rv_pdf")

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
			with patch.object(
				frappe.local, "request", upload(gzip.compress(_sheets_html(2).encode())), create=True
			):
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


class TestPdfEngine(RVTestCase):
	"""The engine's limits and lifetime: slots, a Chromium that dies with its parent, cleanup."""

	def test_engine_slots_are_shared_and_a_dead_holder_is_taken_back(self):
		from report_view.core import pdf

		key = pdf._SLOT_KEY.format(0)
		with patch.object(pdf, "engine_slots", return_value=1):
			# a holder on another host: busy
			frappe.cache.set(key, "other-host:1:x", ex=30)
			try:
				with self.assertRaises(RVPdfBusy):
					pdf.render_pdf(_pages_html(), slot_wait=0.5)
			finally:
				frappe.cache.eval(pdf._RELEASE, 1, key, "other-host:1:x")
			# a holder of this host that no longer exists: its slot is taken back
			dead = subprocess.Popen([sys.executable, "-c", "pass"])
			dead.wait()
			frappe.cache.set(key, f"{socket.gethostname()}:{dead.pid}:x", ex=30)
			self.assertEqual(pdf.render_pdf(_pages_html()).pages, 2)
		# released after the render
		self.assertIsNone(frappe.cache.get(key))

	def test_chromium_dies_with_its_parent_and_cleanup_removes_its_profile(self):
		from report_view.core import pdf

		path = pdf.chromium_path()
		if not path:
			self.skipTest("no chromium-rv on this bench")
		child = subprocess.Popen(
			[
				sys.executable,
				"-c",
				"import sys, time\n"
				"from report_view.core.pdf import _OwnChromium\n"
				"c = _OwnChromium(sys.argv[1])\n"
				"print(c.process.pid, c.profile, flush=True)\n"
				"time.sleep(60)\n",
				path,
			],
			stdout=subprocess.PIPE,
			text=True,
		)
		try:
			pid, profile = child.stdout.readline().split()
			pid = int(pid)
			self.assertIn(pid, _chromium_pids())
			child.send_signal(signal.SIGKILL)
			child.wait()
			end = time.monotonic() + 5
			while pid in _chromium_pids() and time.monotonic() < end:
				time.sleep(0.1)
			self.assertNotIn(pid, _chromium_pids())
			# the killed parent could not remove the profile; the cleanup does
			self.assertTrue(os.path.isdir(profile))
			self.assertIn(profile, pdf.cleanup_stale()["profiles"])
			self.assertFalse(os.path.exists(profile))
		finally:
			if child.poll() is None:
				child.kill()
			child.stdout.close()

	def test_cleanup_kills_an_orphan_older_than_a_render(self):
		from report_view.core import pdf

		profile = tempfile.mkdtemp(prefix=pdf.PROFILE_PREFIX, dir=pdf.profile_root())
		with open(os.path.join(profile, pdf._OWNER_FILE), "w") as f:
			f.write("999999999 1")
		orphan = subprocess.Popen(
			[sys.executable, "-c", "import time; time.sleep(60)", f"--user-data-dir={profile}"],
			start_new_session=True,
		)
		try:
			end = time.monotonic() + 5
			while orphan.pid not in _chromium_pids() and time.monotonic() < end:
				time.sleep(0.05)
			age = pdf._proc_age
			with patch.object(pdf, "_proc_age", lambda p: 10**6 if p == orphan.pid else age(p)):
				out = pdf.cleanup_stale()
			self.assertIn(orphan.pid, out["killed"])
			self.assertEqual(orphan.wait(timeout=5), -signal.SIGKILL)
			self.assertFalse(os.path.exists(profile))
		finally:
			if orphan.poll() is None:
				orphan.kill()
				orphan.wait()
