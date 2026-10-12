"""Server PDF agent (ADR-016).

Turns the finished, self-contained HTML of the Pages view (ADR-014) into a PDF with
Frappe's own headless Chromium, the same way Chrome prints it: CSS page size, zero
margins, backgrounds, no header/footer.

Chromium: the bench's own copy for Report View when there is one (``report_view_chromium_path``
in common_site_config, default ``<bench>/chromium-rv/chrome-headless-shell-linux64/
chrome-headless-shell``: a current Chrome prints as the users' browsers do), else Frappe's.
Many pages are printed in batches of ``BATCH_PAGES`` sheets, a few at a time, and merged.

The HTML comes from the client, so the page is locked down before any content is set:
JavaScript is disabled, and every request goes through ``Fetch`` interception. Only
``data:`` URLs and GET requests for the site's own ``/assets/`` and ``/files/`` (public
files) are served, read from disk; everything else fails without touching the network.
"""

import asyncio
import base64
import mimetypes
import os
import queue
import re
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from io import BytesIO

import frappe
from frappe import _

from report_view.core.errors import RVInvalidInput, RVLimitExceeded
from report_view.core.settings import get_print_max_pages

MAX_HTML_BYTES = 40 * 1024 * 1024
TIMEOUT_SECONDS = 120
# sheets per Chromium page, and how many such pages print at once
BATCH_PAGES = 40
PARALLEL = 3
DEFAULT_CHROMIUM = os.path.join("chromium-rv", "chrome-headless-shell-linux64", "chrome-headless-shell")
_SHEET = re.compile(r'<section class="rv-page[ "]')
_SHEETS_END = "</div><style>@page{"
_DEVTOOLS = re.compile(r"DevTools listening on (ws://\S+)")
_STUB_HTML = "<!doctype html><html><head></head><body></body></html>"


class RVPdfTimeout(frappe.ValidationError):
	"""Chromium did not finish the PDF within ``TIMEOUT_SECONDS``."""


class _Deadline(Exception):
	pass


@dataclass
class PdfResult:
	pdf: bytes
	pages: int
	blocked: list[str] = field(default_factory=list)
	served: list[str] = field(default_factory=list)


def html_to_pdf(html: str, *, title: str | None = None) -> bytes:
	"""Return the PDF bytes of ``html`` as Chrome's print would produce them."""
	return render_pdf(html, title=title).pdf


def render_pdf(
	html: str, *, title: str | None = None, progress=None, timeout: int = TIMEOUT_SECONDS
) -> PdfResult:
	"""Like ``html_to_pdf`` but also reports the blocked and served URLs.

	``progress(done, total)`` is called (in this thread) as batches of sheets are printed.
	"""
	if not isinstance(html, str) or not html.strip():
		frappe.throw(_("The printed pages are empty"), RVInvalidInput)
	if len(html.encode("utf-8")) > MAX_HTML_BYTES:
		frappe.throw(
			_("The printed pages are larger than {0} MB").format(MAX_HTML_BYTES // (1024 * 1024)),
			RVInvalidInput,
		)
	_check_pages(count_sheets(html))
	chunks = split_sheets(_with_title(html, title))
	total = count_sheets(html)
	policy = _Policy()
	deadline = time.monotonic() + timeout
	try:
		with _browser() as devtools_url:
			parts: list[PdfResult | None] = [None] * len(chunks)
			done = 0

			def one(i):
				agent = _Agent(devtools_url, policy, deadline)
				try:
					return i, agent.render(chunks[i])
				finally:
					agent.close()

			with ThreadPoolExecutor(max_workers=min(PARALLEL, len(chunks))) as pool:
				for future in as_completed([pool.submit(one, i) for i in range(len(chunks))]):
					i, part = future.result()
					parts[i] = part
					done += count_sheets(chunks[i])
					if progress:
						progress(min(done, total), total)
	except _Deadline:
		frappe.throw(
			_("Creating the PDF took longer than {0} seconds. Print fewer pages.").format(timeout),
			RVPdfTimeout,
		)
	result = _merge(parts, title)
	_check_pages(result.pages)
	return result


def count_sheets(html: str) -> int:
	return len(_SHEET.findall(html))


def split_sheets(html: str, size: int = BATCH_PAGES) -> list[str]:
	"""The document as documents of at most ``size`` sheets each: the same head and styles,
	a run of the sheets. A document without the Pages view's sheets stays whole."""
	starts = [m.start() for m in _SHEET.finditer(html)]
	end = html.rfind(_SHEETS_END)
	if len(starts) <= size or end < starts[-1]:
		return [html]
	head, tail = html[: starts[0]], html[end:]
	bounds = [*starts, end]
	return [
		head + html[bounds[i] : bounds[min(i + size, len(starts))]] + tail
		for i in range(0, len(starts), size)
	]


def _with_title(html: str, title: str | None) -> str:
	"""The document with ``title`` as its ``<title>``: Chromium writes it into the PDF, so
	the PDF is never copied again to name it."""
	if not title:
		return html
	tag = f"<title>{frappe.utils.escape_html(str(title))}</title>"
	head = re.search(r"<title[^>]*>.*?</title>", html[:20000], re.S | re.I)
	if head:
		return html[: head.start()] + tag + html[head.end() :]
	opening = re.search(r"<head[^>]*>", html[:20000], re.I)
	if opening:
		return html[: opening.end()] + tag + html[opening.end() :]
	return html


def _merge(parts: list[PdfResult], title: str | None) -> PdfResult:
	"""One PDF of the batches, in one pass (its pages counted on the way)."""
	from pypdf import PdfReader, PdfWriter

	if len(parts) == 1:
		parts[0].pages = len(PdfReader(BytesIO(parts[0].pdf)).pages)
		return parts[0]
	writer = PdfWriter()
	for part in parts:
		writer.append(BytesIO(part.pdf), import_outline=False)
	if title:
		writer.add_metadata({"/Title": str(title)})
	out = BytesIO()
	writer.write(out)
	return PdfResult(
		pdf=out.getvalue(),
		pages=len(writer.pages),
		blocked=[u for p in parts for u in p.blocked],
		served=[u for p in parts for u in p.served],
	)


def chromium_path() -> str | None:
	"""Report View's own Chromium, if the bench has it (see the module's docstring)."""
	conf = frappe.get_common_site_config().get("report_view_chromium_path")
	path = conf or os.path.join(frappe.utils.get_bench_path(), DEFAULT_CHROMIUM)
	return path if os.path.isfile(path) and os.access(path, os.X_OK) else None


class _browser:
	"""A Chromium for one PDF: Report View's own (started here, stopped after), else
	Frappe's (started and released as ``frappe.utils.pdf.get_chrome_pdf`` does)."""

	def __enter__(self) -> str:
		self.own = None
		self.generator = None
		path = chromium_path()
		if path:
			self.own = _OwnChromium(path)
			return self.own.devtools_url
		from frappe.utils.pdf_generator.chrome_pdf_generator import ChromePDFGenerator

		self.generator = ChromePDFGenerator()
		self.agent_id = frappe.generate_hash(length=10)
		self.generator.add_browser(self.agent_id)
		if not self.generator._devtools_url:
			self.generator._set_devtools_url()
		return self.generator._devtools_url

	def __exit__(self, *exc):
		if self.own:
			self.own.close()
		if self.generator:
			self.generator.remove_browser(self.agent_id)
			self.generator._close_browser()
		return False


class _OwnChromium:
	"""headless_shell started with a fresh profile; its DevTools address read from stderr."""

	ARGS = (
		"--headless",
		"--remote-debugging-port=0",
		"--no-sandbox",
		"--disable-gpu",
		"--disable-dev-shm-usage",
		"--disable-extensions",
		"--disable-background-networking",
		"--disable-component-update",
		"--disable-default-apps",
		"--disable-breakpad",
		"--no-first-run",
		"--no-default-browser-check",
		"--hide-scrollbars",
		"--mute-audio",
		"--force-color-profile=srgb",
		"about:blank",
	)

	def __init__(self, path: str):
		self.profile = tempfile.mkdtemp(prefix="rv-chromium-")
		self.process = subprocess.Popen(
			[path, f"--user-data-dir={self.profile}", *self.ARGS],
			stdout=subprocess.DEVNULL,
			stderr=subprocess.PIPE,
			text=True,
		)
		lines: queue.Queue = queue.Queue()

		def read():
			# keeps reading so Chromium never blocks on a full pipe
			for line in self.process.stderr:
				lines.put(line)

		threading.Thread(target=read, daemon=True).start()
		self.devtools_url = None
		end = time.monotonic() + 15
		while not self.devtools_url and time.monotonic() < end:
			try:
				m = _DEVTOOLS.search(lines.get(timeout=0.2))
			except queue.Empty:
				if self.process.poll() is not None:
					break
				continue
			if m:
				self.devtools_url = m.group(1)
		if not self.devtools_url:
			self.close()
			frappe.throw(_("The PDF engine could not start"))

	def close(self):
		if self.process.poll() is None:
			self.process.terminate()
			try:
				self.process.wait(timeout=5)
			except subprocess.TimeoutExpired:
				self.process.kill()
		shutil.rmtree(self.profile, ignore_errors=True)


class _Policy:
	"""What the pages may load, read once in the request's thread (the batches run in
	threads of their own, without Frappe's context)."""

	def __init__(self):
		# The site's own host, over http or https (a proxy may hide the scheme). Nothing
		# allowed is fetched over the network, so the scheme does not widen the policy.
		self.hosts = {urllib.parse.urlsplit(frappe.utils.get_url()).netloc.lower()}
		if getattr(frappe.local, "request", None):
			self.hosts.add(urllib.parse.urlsplit(frappe.local.request.host_url).netloc.lower())
		self.base_url = frappe.utils.get_url().rstrip("/") + "/"
		bench_sites = os.path.abspath(os.path.join(frappe.utils.get_bench_path(), "sites"))
		# Like Frappe's own interception: /assets/ is checked lexically (its entries are
		# bench-made symlinks to each app's public folder), /files/ after resolving links.
		self.assets_root = os.path.abspath(os.path.join(bench_sites, "assets"))
		self.files_root = os.path.realpath(frappe.utils.get_site_path("public", "files"))


def _check_pages(pages: int) -> None:
	max_pages = get_print_max_pages()
	if pages > max_pages:
		frappe.throw(
			_("The PDF has {0} pages; at most {1} pages can be printed").format(pages, max_pages),
			RVLimitExceeded,
		)


class _Agent:
	"""One isolated browser context with one locked-down page."""

	def __init__(self, devtools_url: str, policy: _Policy, deadline: float):
		from frappe.utils.pdf_generator.cdp_connection import CDPSocketClient

		self.deadline = deadline
		self.blocked: list[str] = []
		self.served: list[str] = []
		self.stub_served = False
		self.session = None
		self.session_id = None
		self.target_id = None
		self.context_id = None

		self.hosts = policy.hosts
		self.base_url = policy.base_url
		self.assets_root = policy.assets_root
		self.files_root = policy.files_root

		self.session = CDPSocketClient(devtools_url)
		self.session.connect()
		result = self._browser_send("Target.createBrowserContext", {"disposeOnDetach": True})
		self.context_id = result["browserContextId"]
		result = self._browser_send(
			"Target.createTarget", {"url": "about:blank", "browserContextId": self.context_id}
		)
		self.target_id = result["targetId"]
		result = self._browser_send("Target.attachToTarget", {"targetId": self.target_id, "flatten": True})
		self.session_id = result["sessionId"]

	# -- CDP helpers ---------------------------------------------------------

	def _remaining(self) -> float:
		remaining = self.deadline - time.monotonic()
		if remaining <= 0:
			raise _Deadline
		return remaining

	def _await(self, awaitable):
		try:
			return self.session.loop.run_until_complete(asyncio.wait_for(awaitable, self._remaining()))
		except TimeoutError as e:
			raise _Deadline from e

	def _raw_send(self, method, params, session_id):
		task = self.session.send(method, params or {}, session_id, return_future=True)
		future = self._await(task)
		response = self._await(future)
		result, error = self.session._destructure_response(response)
		if error:
			raise RuntimeError(f"{method}: {error}")
		return result

	def _browser_send(self, method, params=None):
		return self._raw_send(method, params, None)

	def send(self, method, params=None):
		return self._raw_send(method, params, self.session_id)

	def _post(self, method, params):
		"""Fire-and-forget command, used from event callbacks."""
		self.session.send(method, params, self.session_id, return_future=True)

	def _listen(self, method, callback):
		return self.session.start_listener(method, callback, self.session_id)

	def _wait(self, method, event):
		try:
			self._await(asyncio.shield(event[1]))
		finally:
			self.session.remove_listener(method, event)

	def _lifecycle(self, name: str):
		def on_event(future, response):
			if response.get("params", {}).get("name") == name and not future.done():
				future.set_result(True)

		return self._listen("Page.lifecycleEvent", on_event)

	# -- network policy ------------------------------------------------------

	def _on_request_paused(self, future, response):
		params = response.get("params") or {}
		request_id = params.get("requestId")
		if not request_id:
			return
		request = params.get("request") or {}
		url = request.get("url") or ""
		if request.get("method") == "GET" and url.startswith("data:"):
			self._post("Fetch.continueRequest", {"requestId": request_id})
			return
		if (
			not self.stub_served
			and params.get("resourceType") == "Document"
			and url == self.base_url
			and request.get("method") == "GET"
		):
			# The page first navigates to the site root so the content gets the site's origin;
			# that navigation is answered with an empty document, never sent to the network.
			self.stub_served = True
			self._fulfill(request_id, _STUB_HTML.encode(), "text/html; charset=utf-8")
			return
		path = self._allowed_path(request.get("method"), url, params.get("resourceType"))
		if path:
			with open(path, "rb") as f:
				body = f.read()
			mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
			self.served.append(url)
			self._fulfill(request_id, body, mime)
			return
		self.blocked.append(url)
		self._post("Fetch.failRequest", {"requestId": request_id, "errorReason": "BlockedByClient"})

	def _allowed_path(self, method, url, resource_type) -> str | None:
		"""The file on disk for an allowed URL, else ``None``."""
		if method != "GET" or resource_type == "Document":
			return None
		parts = urllib.parse.urlsplit(url)
		if parts.scheme not in ("http", "https"):
			return None
		path = urllib.parse.unquote(parts.path)
		# /assets/ are the bench's own built files, the same whatever host a stylesheet names
		# (a format may load its font from another site of the bench): served from this
		# bench's disk, never fetched. /files/ belong to this site only.
		if not path.startswith("/assets/") and parts.netloc.lower() not in self.hosts:
			return None
		if path.startswith("/assets/"):
			root = self.assets_root
			target = os.path.abspath(os.path.join(root, path[len("/assets/") :]))
		elif path.startswith("/files/"):
			root = self.files_root
			target = os.path.realpath(os.path.join(root, path[len("/files/") :]))
		else:
			return None
		if os.path.commonpath([target, root]) != root or not os.path.isfile(target):
			return None
		return target

	def _fulfill(self, request_id, body: bytes, mime: str):
		self._post(
			"Fetch.fulfillRequest",
			{
				"requestId": request_id,
				"responseCode": 200,
				"responseHeaders": [{"name": "Content-Type", "value": mime}],
				"body": base64.b64encode(body).decode(),
			},
		)

	# -- rendering -----------------------------------------------------------

	def render(self, html: str) -> PdfResult:
		# Lock the page down before anything is loaded into it.
		self.send("Emulation.setScriptExecutionDisabled", {"value": True})
		self.send("Emulation.setEmulatedMedia", {"media": "print"})
		self._listen("Fetch.requestPaused", self._on_request_paused)
		self.send("Fetch.enable", {"patterns": [{"urlPattern": "*", "requestStage": "Request"}]})
		self.send("Page.enable")
		self.send("Page.setLifecycleEventsEnabled", {"enabled": True})

		loaded = self._lifecycle("load")
		self.send("Page.navigate", {"url": self.base_url})
		self._wait("Page.lifecycleEvent", loaded)

		frame_id = self.send("Page.getFrameTree")["frameTree"]["frame"]["id"]
		loaded = self._lifecycle("load")
		self.send("Page.setDocumentContent", {"frameId": frame_id, "html": html})
		self._wait("Page.lifecycleEvent", loaded)
		self._wait_for_fonts()
		self._drop_links()

		result = self.send(
			"Page.printToPDF",
			{
				"printBackground": True,
				# a tagged PDF (a structure for every cell) costs time, memory and size on
				# long tables, and the browser's own print does not make one either
				"generateTaggedPDF": False,
				"generateDocumentOutline": False,
				"preferCSSPageSize": True,
				"displayHeaderFooter": False,
				"scale": 1,
				"marginTop": 0,
				"marginBottom": 0,
				"marginLeft": 0,
				"marginRight": 0,
			},
		)
		return PdfResult(
			pdf=base64.b64decode(result["data"]), pages=0, blocked=self.blocked, served=self.served
		)

	def _wait_for_fonts(self):
		"""Wait for ``document.fonts.ready`` and every image.

		Page scripts stay disabled; a DevTools evaluation still runs.
		"""
		return self.send(
			"Runtime.evaluate",
			{
				"expression": (
					"Promise.all([document.fonts.ready,"
					" ...Array.from(document.images, i => i.complete ? null"
					" : new Promise(r => { i.addEventListener('load', r); i.addEventListener('error', r); }))"
					"]).then(() => document.fonts.status)"
				),
				"awaitPromise": True,
				"returnByValue": True,
			},
		)

	def _drop_links(self):
		"""Links become plain text in the PDF, looking as they did.

		Chromium makes a PDF link of every ``<a href>``: a report page has hundreds (each
		account, voucher, party), which made the file about six times larger and its batches
		slow to merge, and they only open Desk pages that need a login. The browser's own
		look of a link is kept by a rule of no weight, first in the page, so the page's own
		rules still win as before.
		"""
		self.send(
			"Runtime.evaluate",
			{
				"expression": (
					"(() => { const s = document.createElement('style');"
					" s.textContent = ':where(a[data-rv-link]){color:-webkit-link;text-decoration:underline}';"
					" document.head.prepend(s);"
					" for (const a of document.querySelectorAll('a[href]'))"
					" { a.setAttribute('data-rv-link', ''); a.removeAttribute('href'); } })()"
				),
				"returnByValue": True,
			},
		)

	def close(self):
		if not self.session:
			return
		# Cleanup gets its own short budget, even after a timeout.
		self.deadline = time.monotonic() + 5
		try:
			if self.session.connection is not None:
				try:
					if self.context_id:
						self._browser_send(
							"Target.disposeBrowserContext", {"browserContextId": self.context_id}
						)
				except Exception:
					# the browser stops after the PDF anyway (it is this PDF's own)
					pass
		finally:
			try:
				self.session.disconnect()
			except Exception:
				pass
