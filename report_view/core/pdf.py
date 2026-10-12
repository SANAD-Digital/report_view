"""Server PDF agent (ADR-016).

Turns the finished, self-contained HTML of the Pages view (ADR-014) into a PDF with
Frappe's own headless Chromium, the same way Chrome prints it: CSS page size, zero
margins, backgrounds, no header/footer.

The HTML comes from the client, so the page is locked down before any content is set:
JavaScript is disabled, and every request goes through ``Fetch`` interception. Only
``data:`` URLs and GET requests for the site's own ``/assets/`` and ``/files/`` (public
files) are served, read from disk; everything else fails without touching the network.
"""

import asyncio
import base64
import mimetypes
import os
import time
import urllib.parse
from dataclasses import dataclass, field
from io import BytesIO

import frappe
from frappe import _

from report_view.core.errors import RVInvalidInput, RVLimitExceeded
from report_view.core.settings import get_print_max_pages

MAX_HTML_BYTES = 40 * 1024 * 1024
TIMEOUT_SECONDS = 120
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


def render_pdf(html: str, *, title: str | None = None) -> PdfResult:
	"""Like ``html_to_pdf`` but also reports the blocked and served URLs."""
	if not isinstance(html, str) or not html.strip():
		frappe.throw(_("The printed pages are empty"), RVInvalidInput)
	if len(html.encode("utf-8")) > MAX_HTML_BYTES:
		frappe.throw(
			_("The printed pages are larger than {0} MB").format(MAX_HTML_BYTES // (1024 * 1024)),
			RVInvalidInput,
		)

	from frappe.utils.pdf_generator.chrome_pdf_generator import ChromePDFGenerator

	# Started and released exactly as frappe.utils.pdf.get_chrome_pdf does.
	generator = ChromePDFGenerator()
	agent_id = frappe.generate_hash(length=10)
	generator.add_browser(agent_id)
	try:
		agent = _Agent(generator)
		try:
			result = agent.render(html)
		finally:
			agent.close()
	except _Deadline:
		frappe.throw(
			_("Creating the PDF took longer than {0} seconds. Print fewer pages.").format(TIMEOUT_SECONDS),
			RVPdfTimeout,
		)
	finally:
		generator.remove_browser(agent_id)
		generator._close_browser()

	return _finish(result, title)


def _finish(result: PdfResult, title: str | None) -> PdfResult:
	from pypdf import PdfReader, PdfWriter

	reader = PdfReader(BytesIO(result.pdf))
	result.pages = len(reader.pages)
	max_pages = get_print_max_pages()
	if result.pages > max_pages:
		frappe.throw(
			_("The PDF has {0} pages; at most {1} pages can be printed").format(result.pages, max_pages),
			RVLimitExceeded,
		)
	current = (reader.metadata or {}).get("/Title")
	if title and current != title:
		writer = PdfWriter(clone_from=reader)
		writer.add_metadata({"/Title": title})
		out = BytesIO()
		writer.write(out)
		result.pdf = out.getvalue()
	return result


class _Agent:
	"""One isolated browser context with one locked-down page."""

	def __init__(self, generator):
		from frappe.utils.pdf_generator.cdp_connection import CDPSocketClient

		self.deadline = time.monotonic() + TIMEOUT_SECONDS
		self.blocked: list[str] = []
		self.served: list[str] = []
		self.stub_served = False
		self.session = None
		self.session_id = None
		self.target_id = None
		self.context_id = None

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

		if not generator._devtools_url:
			generator._set_devtools_url()
		self.session = CDPSocketClient(generator._devtools_url)
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

		result = self.send(
			"Page.printToPDF",
			{
				"printBackground": True,
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
					frappe.log_error(title="Report View PDF: failed to dispose the browser context")
		finally:
			try:
				self.session.disconnect()
			except Exception:
				frappe.log_error(title="Report View PDF: failed to disconnect the CDP session")
