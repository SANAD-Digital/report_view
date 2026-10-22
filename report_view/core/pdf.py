"""Server PDF agent (ADR-016).

Turns the finished, self-contained HTML of the Pages view (ADR-014) into a PDF with a
headless Chromium, the same way Chrome prints it: CSS page size, zero margins,
backgrounds, no header/footer.

Chromium: the bench's own copy for Report View (``report_view_chromium_path`` in
common_site_config, default ``<bench>/chromium-rv/chrome-headless-shell-linux64/
chrome-headless-shell``, installed by ``scripts/install_chromium.sh``: a current Chrome
prints as the users' browsers do), else Frappe's binary (a warning is logged). Either way
it is started here, with the flags and the lifetime below.
Many pages are printed in batches of ``BATCH_PAGES`` sheets, a few at a time, and merged.

The HTML comes from the client, so the page is locked down before any content is set:
JavaScript is disabled, and every request goes through ``Fetch`` interception (in the page
and in every frame or worker attached to it). Only ``data:`` URLs and GET requests for the
site's own ``/assets/`` and ``/files/`` (public files) are served, read from disk;
everything else fails without touching the network. Chromium itself has no network: its
proxy is a closed local port and no host name resolves.

Resources: at most ``engine_slots()`` renders run at once on the bench (slots in redis,
each with an expiry); Chromium runs in a process group of its own that dies with the
process that started it, and ``cleanup_stale`` (hourly) removes whatever a killed worker
left behind.
"""

import asyncio
import base64
import ctypes
import glob
import mimetypes
import os
import queue
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import dataclass, field
from io import BytesIO

import frappe
from frappe import _

from report_view.core.errors import RVInvalidInput, RVLimitExceeded
from report_view.core.settings import get_print_max_pages

MAX_HTML_BYTES = 40 * 1024 * 1024
# A PDF made in the request must end well before gunicorn's timeout (-t 120) kills the
# worker, waiting for an engine included.
TIMEOUT_SECONDS = 60
SYNC_SLOT_WAIT = 10
# A background job: its RQ timeout, and its own budget inside it (waiting for an engine
# included), which leaves a margin to save the file and its state.
JOB_TIMEOUT = 900
JOB_SECONDS = JOB_TIMEOUT - 60
JOB_SLOT_WAIT = 240
# No render lives longer than this; older Chromium processes and profiles are stale.
MAX_RENDER_SECONDS = JOB_TIMEOUT
# Chromium renders at once on the bench (``report_view_pdf_slots`` in common_site_config).
DEFAULT_SLOTS = 2
HEARTBEAT_SECONDS = 2
# sheets per Chromium page, and how many such pages print at once
BATCH_PAGES = 40
PARALLEL = 3
DEFAULT_CHROMIUM = os.path.join("chromium-rv", "chrome-headless-shell-linux64", "chrome-headless-shell")
# profiles live in <bench>/tmp: the same folder for every worker, whatever its TMPDIR
PROFILE_PREFIX = "rv-chromium-"
_OWNER_FILE = "rv-owner"
_SLOT_KEY = "report_view:pdf_slot:{0}"
# deletes a slot only if it is still the caller's
_RELEASE = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0"
_SHEET = re.compile(r'<section class="rv-page[ "]')
_SHEETS_END = "</div><style>@page{"
_USER_DATA_DIR = re.compile(r"--user-data-dir=(\S+)")
_DEVTOOLS = re.compile(r"DevTools listening on (ws://\S+)")
_STUB_HTML = "<!doctype html><html><head></head><body></body></html>"
_FETCH_ALL = {"patterns": [{"urlPattern": "*", "requestStage": "Request"}]}
_AUTO_ATTACH = {"autoAttach": True, "waitForDebuggerOnStart": True, "flatten": True}
_PR_SET_PDEATHSIG = 1
_warned_fallback = False


class RVPdfTimeout(frappe.ValidationError):
	"""Chromium did not finish the PDF within its time budget."""


class RVPdfBusy(frappe.ValidationError):
	"""Every engine slot is taken, or the user already has a PDF job running."""

	http_status_code = 429


class _Deadline(Exception):
	pass


class _Aborted(Exception):
	"""Another batch failed, or the caller stopped the render."""


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
	html: str,
	*,
	title: str | None = None,
	progress=None,
	heartbeat=None,
	timeout: int = TIMEOUT_SECONDS,
	slot_wait: int = SYNC_SLOT_WAIT,
) -> PdfResult:
	"""Like ``html_to_pdf`` but also reports the blocked and served URLs.

	``progress(done, total)`` is called (in this thread) as batches of sheets are printed;
	``heartbeat(stage)`` every ``HEARTBEAT_SECONDS`` while waiting for an engine
	(``"waiting"``) and while printing (``"rendering"``). Either may raise to stop the
	render. ``timeout`` covers everything, the wait for an engine (at most ``slot_wait``)
	included.
	"""
	check_html(html)
	total = count_sheets(html)
	max_pages = get_print_max_pages()
	_check_pages(total, max_pages)
	chunks = split_sheets(_with_title(html, title))
	policy = _Policy()
	deadline = time.monotonic() + timeout
	abort = threading.Event()
	try:
		with _Slot(deadline, slot_wait, heartbeat), _browser(deadline) as devtools_url:
			if heartbeat:
				heartbeat("rendering")
			parts: list[PdfResult | None] = [None] * len(chunks)
			done = 0

			def one(i):
				agent = _Agent(devtools_url, policy, deadline, abort, max_pages)
				try:
					return i, agent.render(chunks[i])
				finally:
					agent.close()

			pool = ThreadPoolExecutor(max_workers=min(PARALLEL, len(chunks)))
			try:
				pending = {pool.submit(one, i) for i in range(len(chunks))}
				while pending:
					finished, pending = wait(pending, timeout=HEARTBEAT_SECONDS, return_when=FIRST_COMPLETED)
					for future in finished:
						i, part = future.result()
						parts[i] = part
						done += count_sheets(chunks[i])
						if progress:
							progress(min(done, total), total)
					if pending and heartbeat:
						heartbeat("rendering")
			except BaseException:
				# the other batches stop at their next CDP step (within a second)
				abort.set()
				raise
			finally:
				pool.shutdown(wait=True, cancel_futures=True)
	except _Deadline:
		_throw(
			_("Creating the PDF took longer than {0} seconds. Print fewer pages.").format(timeout),
			RVPdfTimeout,
			timeout,
		)
	result = _merge(parts, title)
	_check_pages(result.pages, max_pages)
	return result


def check_html(html) -> None:
	"""Refuse what is not the Pages view's printed pages: empty, too large, no sheets."""
	if not isinstance(html, str) or not html.strip():
		frappe.throw(_("The printed pages are empty"), RVInvalidInput)
	if len(html.encode("utf-8")) > MAX_HTML_BYTES:
		frappe.throw(
			_("The printed pages are larger than {0} MB").format(MAX_HTML_BYTES // (1024 * 1024)),
			RVInvalidInput,
		)
	if not count_sheets(html):
		frappe.throw(_("The printed pages have no pages to print"), RVInvalidInput)


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


def _throw(message: str, exc, *args):
	"""``frappe.throw`` with the message's arguments kept on the exception (``rv_args``),
	so a background job can say it again later in its user's language."""
	try:
		frappe.throw(message, exc)
	except exc as e:
		e.rv_args = list(args)
		raise


def _check_pages(pages: int, max_pages: int | None = None) -> None:
	max_pages = max_pages or get_print_max_pages()
	if pages > max_pages:
		_throw(
			_("The PDF has {0} pages; at most {1} pages can be printed").format(pages, max_pages),
			RVLimitExceeded,
			pages,
			max_pages,
		)


# ---------------------------------------------------------------- the engine binary


def chromium_path() -> str | None:
	"""Report View's own Chromium, if the bench has it (see the module's docstring)."""
	conf = frappe.get_common_site_config().get("report_view_chromium_path")
	path = conf or os.path.join(frappe.utils.get_bench_path(), DEFAULT_CHROMIUM)
	return path if os.path.isfile(path) and os.access(path, os.X_OK) else None


def _engine_path() -> str:
	"""Report View's Chromium, else Frappe's binary (found or downloaded by Frappe's public
	helper); it is started here either way, never through Frappe's generator."""
	global _warned_fallback
	path = chromium_path()
	if path:
		return path
	from frappe.utils.print_utils import find_or_download_chromium_executable

	if not _warned_fallback:
		_warned_fallback = True
		frappe.logger("report_view").warning(
			"Report View PDF: its own Chromium (%s) is missing, falling back to Frappe's Chromium; "
			"PDFs may differ slightly from the browser's print. Install it with "
			"apps/report_view/scripts/install_chromium.sh",
			os.path.join(frappe.utils.get_bench_path(), DEFAULT_CHROMIUM),
		)
	return find_or_download_chromium_executable()


# ---------------------------------------------------------------- engine slots


def engine_slots() -> int:
	return max(
		1, frappe.utils.cint(frappe.get_common_site_config().get("report_view_pdf_slots")) or DEFAULT_SLOTS
	)


class _Slot:
	"""One of ``engine_slots()`` bench-wide render slots (redis ``SET NX EX``, so a killed
	holder's slot expires; one whose process is gone on this host is taken back at once)."""

	def __init__(self, deadline: float, slot_wait: float, heartbeat=None):
		self.deadline = deadline
		self.slot_wait = slot_wait
		self.heartbeat = heartbeat
		self.key = None
		self.token = f"{socket.gethostname()}:{os.getpid()}:{frappe.generate_hash(length=10)}"

	def __enter__(self):
		slots = engine_slots()
		give_up = min(time.monotonic() + self.slot_wait, self.deadline)
		beat = 0.0
		while True:
			ttl = max(1, int(self.deadline - time.monotonic()) + 30)
			for i in range(slots):
				key = _SLOT_KEY.format(i)
				if frappe.cache.set(key, self.token, nx=True, ex=ttl):
					self.key = key
					return self
			_reclaim_slots(slots)
			if time.monotonic() >= give_up:
				_throw(_("The PDF engine is busy with other PDFs. Try again in a minute."), RVPdfBusy)
			if self.heartbeat and time.monotonic() - beat >= HEARTBEAT_SECONDS:
				beat = time.monotonic()
				self.heartbeat("waiting")
			time.sleep(0.25)

	def __exit__(self, *exc):
		if self.key:
			try:
				frappe.cache.eval(_RELEASE, 1, self.key, self.token)
			except Exception:
				# the slot expires by itself
				frappe.logger("report_view").warning("Report View PDF: could not release %s", self.key)
		return False


def _reclaim_slots(slots: int) -> None:
	"""Free the slots held by processes of this host that no longer exist."""
	host = socket.gethostname()
	for i in range(slots):
		key = _SLOT_KEY.format(i)
		token = frappe.cache.get(key)
		if not token:
			continue
		holder_host, _sep, pid = token.decode(errors="replace").rsplit(":", 1)[0].rpartition(":")
		pid = frappe.utils.cint(pid)
		if holder_host == host and pid and not _pid_alive(pid):
			frappe.cache.eval(_RELEASE, 1, key, token)


def _pid_alive(pid: int) -> bool:
	try:
		os.kill(pid, 0)
	except ProcessLookupError:
		return False
	except PermissionError:
		return True
	return True


# ---------------------------------------------------------------- processes


def _proc_start(pid: int) -> int | None:
	"""The process's start time (clock ticks since boot), ``None`` if it is gone."""
	try:
		with open(f"/proc/{pid}/stat") as f:
			stat = f.read()
	except OSError:
		return None
	# the command name (2nd field) may hold spaces; the 22nd field counts from after it
	return int(stat[stat.rfind(")") + 2 :].split()[19])


def _proc_age(pid: int) -> float:
	start = _proc_start(pid)
	if start is None:
		return 0
	with open("/proc/uptime") as f:
		uptime = float(f.read().split()[0])
	return uptime - start / os.sysconf("SC_CLK_TCK")


def _die_with_parent():
	"""``preexec_fn`` for Chromium: SIGKILL when the thread that starts it ends (a gunicorn
	timeout, an RQ timeout, the OOM killer, a deploy). Linux only."""
	if not sys.platform.startswith("linux"):
		return None
	try:
		prctl = ctypes.CDLL(None, use_errno=True).prctl
	except OSError, AttributeError:
		return None
	parent = os.getpid()

	def preexec():
		prctl(_PR_SET_PDEATHSIG, signal.SIGKILL)
		if os.getppid() != parent:
			# the parent died before prctl took effect
			os._exit(1)

	return preexec


def _kill_group(pid: int, sig=signal.SIGKILL) -> None:
	"""Signal ``pid``'s process group (Chromium and its helpers), never our own group."""
	try:
		pgid = os.getpgid(pid)
	except ProcessLookupError:
		return
	try:
		if pgid != os.getpgrp():
			os.killpg(pgid, sig)
		else:
			os.kill(pid, sig)
	except ProcessLookupError, PermissionError:
		pass


class _browser:
	"""A Chromium for one PDF, started here and stopped after (see ``_engine_path``)."""

	def __init__(self, deadline: float | None = None):
		self.deadline = deadline

	def __enter__(self) -> str:
		self.own = _OwnChromium(_engine_path(), self.deadline)
		return self.own.devtools_url

	def __exit__(self, *exc):
		self.own.close()
		return False


class _OwnChromium:
	"""A headless Chromium with a fresh profile, in a session (process group) of its own that
	is killed with the process that started it; its DevTools address read from stderr."""

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
		"--disable-sync",
		"--disable-domain-reliability",
		"--no-pings",
		"--no-first-run",
		"--no-default-browser-check",
		"--hide-scrollbars",
		"--mute-audio",
		"--force-color-profile=srgb",
		# No network at all (defence in depth: every allowed request is answered from disk by
		# the Fetch interception): a proxy on a closed local port, loopback included, and no
		# host name resolves.
		"--proxy-server=127.0.0.1:9",
		"--proxy-bypass-list=<-loopback>",
		"--host-resolver-rules=MAP * ~NOTFOUND",
		"--dns-prefetch-disable",
		# No speculative requests, and every frame in the page's own process, where its
		# requests meet the page's interception (out-of-process frames are attached too).
		"--disable-features=NetworkPrediction,Prerender2,SpeculationRules,IsolateOrigins,site-per-process,Translate,MediaRouter,OptimizationHints",
		"--disable-site-isolation-trials",
		"about:blank",
	)

	def __init__(self, path: str, deadline: float | None = None):
		self.process = None
		self.profile = tempfile.mkdtemp(prefix=PROFILE_PREFIX, dir=profile_root())
		# who started it, for cleanup_stale: the pid and its start time
		with open(os.path.join(self.profile, _OWNER_FILE), "w") as f:
			f.write(f"{os.getpid()} {_proc_start(os.getpid()) or 0}")
		try:
			self.process = subprocess.Popen(
				[path, f"--user-data-dir={self.profile}", *self.ARGS],
				stdin=subprocess.DEVNULL,
				stdout=subprocess.DEVNULL,
				stderr=subprocess.PIPE,
				text=True,
				start_new_session=True,
				preexec_fn=_die_with_parent(),
			)
		except OSError:
			shutil.rmtree(self.profile, ignore_errors=True)
			frappe.log_error(title="Report View PDF engine could not start")
			frappe.throw(_("The PDF engine could not start"))
		lines: queue.Queue = queue.Queue()

		def read():
			# keeps reading so Chromium never blocks on a full pipe
			for line in self.process.stderr:
				lines.put(line)

		threading.Thread(target=read, daemon=True).start()
		self.devtools_url = None
		end = time.monotonic() + 15
		if deadline:
			end = min(end, deadline)
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
			if deadline and time.monotonic() >= deadline:
				raise _Deadline
			frappe.log_error(title="Report View PDF engine could not start", message=path)
			frappe.throw(_("The PDF engine could not start"))

	def close(self):
		if self.process:
			if self.process.poll() is None:
				_kill_group(self.process.pid, signal.SIGTERM)
				try:
					self.process.wait(timeout=3)
				except subprocess.TimeoutExpired:
					pass
			# the browser and any helper left in its group
			_kill_group(self.process.pid, signal.SIGKILL)
			try:
				self.process.wait(timeout=5)
			except subprocess.TimeoutExpired:
				pass
		shutil.rmtree(self.profile, ignore_errors=True)


def cleanup_stale(max_age: float | None = None) -> dict:
	"""What a killed worker left behind (hourly, ``scheduler_events`` in hooks.py):

	- Chromium processes of the agent (their ``--user-data-dir`` is one of our profiles)
	  older than ``max_age`` whose starting process is gone: killed with their group;
	- profiles no running Chromium uses, whose owner is gone or older than ``max_age``;
	- the site's job files older than an hour (``core.jobs.PDF_JOBS.clean_old_files``).
	"""
	max_age = MAX_RENDER_SECONDS + 60 if max_age is None else max_age
	# the system temp folder too: where profiles were made before <bench>/tmp
	roots = {profile_root(), tempfile.gettempdir(), "/tmp"}
	prefixes = tuple(os.path.join(root, PROFILE_PREFIX) for root in roots)
	killed, in_use = [], set()
	for pid, profile in _engine_processes():
		if not profile.startswith(prefixes):
			continue
		if _proc_age(pid) > max_age and not _owner_alive(profile):
			_kill_group(pid)
			killed.append(pid)
		else:
			in_use.add(profile)
	removed = []
	for path in (p for root in roots for p in glob.glob(os.path.join(root, PROFILE_PREFIX + "*"))):
		if path in in_use or not os.path.isdir(path):
			continue
		owner = os.path.join(path, _OWNER_FILE)
		try:
			age = time.time() - os.path.getmtime(owner if os.path.exists(owner) else path)
		except OSError:
			continue
		if age > max_age or not _owner_alive(path):
			shutil.rmtree(path, ignore_errors=True)
			removed.append(path)
	files = 0
	if getattr(frappe.local, "site", None):
		from report_view.core.jobs import PDF_JOBS

		files = PDF_JOBS.clean_old_files()
	if killed or removed:
		frappe.logger("report_view").warning(
			"Report View PDF cleanup: killed %s, removed %s profiles", killed, len(removed)
		)
	return {"killed": killed, "profiles": removed, "files": files}


def profile_root() -> str:
	"""``<bench>/tmp``, where the engine's Chromium profiles are made."""
	root = os.path.join(frappe.utils.get_bench_path(), "tmp")
	os.makedirs(root, exist_ok=True)
	return root


def _engine_processes():
	"""``(pid, profile)`` of this user's processes started with a ``--user-data-dir``.
	Chromium rewrites its command line as one string, so it is searched as text."""
	for pid, args in _processes():
		m = _USER_DATA_DIR.search(" ".join(args))
		if m:
			yield pid, m.group(1)


def _processes():
	"""``(pid, argv)`` of this user's processes."""
	uid = os.getuid()
	for entry in os.listdir("/proc"):
		if not entry.isdigit():
			continue
		try:
			if os.stat(f"/proc/{entry}").st_uid != uid:
				continue
			with open(f"/proc/{entry}/cmdline", "rb") as f:
				args = f.read().split(b"\0")
		except OSError:
			continue
		yield int(entry), [a.decode(errors="replace") for a in args if a]


def _owner_alive(profile: str) -> bool:
	"""Whether the process that started this profile's Chromium still runs."""
	try:
		with open(os.path.join(profile, _OWNER_FILE)) as f:
			pid, start = (int(v) for v in f.read().split())
	except OSError, ValueError:
		return False
	return _proc_start(pid) == start


# ---------------------------------------------------------------- the page


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


class _Agent:
	"""One isolated browser context with one locked-down page."""

	def __init__(
		self, devtools_url: str, policy: _Policy, deadline: float, abort: threading.Event, max_pages: int
	):
		from frappe.utils.pdf_generator.cdp_connection import CDPSocketClient

		self.deadline = deadline
		self.abort = abort
		self.max_pages = max_pages
		self.blocked: list[str] = []
		self.served: list[str] = []
		self.attached: list[str] = []
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
		try:
			self._open()
		except BaseException:
			self.close()
			raise

	def _open(self):
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

	def _await(self, awaitable):
		"""Run the loop until ``awaitable`` is done, the deadline passes or the render is
		aborted (checked every second)."""
		loop = self.session.loop
		future = asyncio.ensure_future(awaitable, loop=loop)
		while not future.done():
			if self.abort.is_set():
				raise _Aborted
			remaining = self.deadline - time.monotonic()
			if remaining <= 0:
				raise _Deadline
			loop.run_until_complete(asyncio.wait({future}, timeout=min(1.0, remaining)))
		return future.result()

	def _raw_send(self, method, params, session_id):
		task = self.session.send(method, params or {}, session_id, return_future=True)
		future = self._await(task)
		response = self._await(future)
		if response.get("error"):
			raise RuntimeError(f"{method}: {response['error']}")
		return response.get("result")

	def _browser_send(self, method, params=None):
		return self._raw_send(method, params, None)

	def send(self, method, params=None):
		return self._raw_send(method, params, self.session_id)

	def _post(self, method, params, session_id=None):
		"""Fire-and-forget command, used from event callbacks."""
		self.session.send(method, params, session_id or self.session_id, return_future=True)

	def _listen(self, method, callback, session_id=None):
		return self.session.start_listener(method, callback, session_id)

	def _wait(self, method, event):
		try:
			self._await(event[1])
		finally:
			self.session.remove_listener(method, event)

	def _lifecycle(self, name: str):
		def on_event(future, response):
			if response.get("params", {}).get("name") == name and not future.done():
				future.set_result(True)

		return self._listen("Page.lifecycleEvent", on_event, self.session_id)

	# -- network policy ------------------------------------------------------

	def _on_attached(self, future, response):
		"""A frame or worker of the page got a target of its own: the same interception and
		no scripts, before it may run (``waitForDebuggerOnStart``)."""
		params = response.get("params") or {}
		child = params.get("sessionId")
		if not child:
			return
		kind = (params.get("targetInfo") or {}).get("type") or ""
		self.attached.append(kind)
		self._post("Fetch.enable", _FETCH_ALL, child)
		if kind in ("iframe", "page"):
			self._post("Emulation.setScriptExecutionDisabled", {"value": True}, child)
		self._post("Target.setAutoAttach", _AUTO_ATTACH, child)
		self._post("Runtime.runIfWaitingForDebugger", {}, child)

	def _on_request_paused(self, future, response):
		params = response.get("params") or {}
		request_id = params.get("requestId")
		if not request_id:
			return
		# the page's own session, or a frame or worker attached to it
		session_id = response.get("sessionId") or self.session_id
		request = params.get("request") or {}
		url = request.get("url") or ""
		resource_type = params.get("resourceType")
		if request.get("method") == "GET" and url.startswith("data:") and resource_type != "Document":
			self._post("Fetch.continueRequest", {"requestId": request_id}, session_id)
			return
		if (
			not self.stub_served
			and session_id == self.session_id
			and resource_type == "Document"
			and url == self.base_url
			and request.get("method") == "GET"
		):
			# The page first navigates to the site root so the content gets the site's origin;
			# that navigation is answered with an empty document, never sent to the network.
			self.stub_served = True
			self._fulfill(request_id, _STUB_HTML.encode(), "text/html; charset=utf-8", session_id)
			return
		path = self._allowed_path(request.get("method"), url, resource_type)
		if path:
			with open(path, "rb") as f:
				body = f.read()
			mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
			self.served.append(url)
			self._fulfill(request_id, body, mime, session_id)
			return
		self.blocked.append(url)
		# a navigation that is aborted commits no error page, so the content stays (a
		# <meta http-equiv="refresh"> would otherwise replace it before it is printed)
		reason = "Aborted" if resource_type == "Document" else "BlockedByClient"
		self._post("Fetch.failRequest", {"requestId": request_id, "errorReason": reason}, session_id)

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

	def _fulfill(self, request_id, body: bytes, mime: str, session_id=None):
		self._post(
			"Fetch.fulfillRequest",
			{
				"requestId": request_id,
				"responseCode": 200,
				"responseHeaders": [{"name": "Content-Type", "value": mime}],
				"body": base64.b64encode(body).decode(),
			},
			session_id,
		)

	# -- rendering -----------------------------------------------------------

	def render(self, html: str) -> PdfResult:
		# Lock the page down before anything is loaded into it. The listeners take every
		# session of this connection: the page's and those of the frames attached to it.
		self.send("Emulation.setScriptExecutionDisabled", {"value": True})
		self.send("Emulation.setEmulatedMedia", {"media": "print"})
		self._listen("Fetch.requestPaused", self._on_request_paused)
		self._listen("Target.attachedToTarget", self._on_attached)
		self.send("Fetch.enable", _FETCH_ALL)
		self.send("Target.setAutoAttach", _AUTO_ATTACH)
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
				# never more than one page past the limit (the merged PDF is checked after)
				"pageRanges": f"1-{self.max_pages + 1}",
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
		stopped = self.abort.is_set() or time.monotonic() >= self.deadline
		# Cleanup gets its own short budget, even after a timeout.
		self.deadline = time.monotonic() + 5
		self.abort = threading.Event()
		try:
			if self.session.connection is not None and self.context_id and not stopped:
				try:
					self._browser_send("Target.disposeBrowserContext", {"browserContextId": self.context_id})
				except Exception:
					# the browser stops after the PDF anyway (it is this PDF's own)
					pass
		finally:
			try:
				self.session.disconnect()
			except Exception:
				pass
			finally:
				self.session.loop.close()
				asyncio.set_event_loop(None)
