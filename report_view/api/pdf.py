"""Server PDF of the printed pages (ADR-016).

The browser sends the finished HTML of its Pages view; the server prints it with
Chromium. A few pages come back at once as the download; more than ``SYNC_PAGES`` sheets
(or more than ``SYNC_BYTES`` of HTML) are printed by a background job, the browser asks
for its progress and downloads the file when it is ready. A job and its files belong to
the user who started it; a user has one job running at a time, and can cancel it. The
PDF stays until ``KEEP_SECONDS`` after the job's last change (a dropped download can be
retried); the hourly ``report_view.core.pdf.cleanup_stale`` removes older files.

The job's queue is ``report_view_pdf_queue`` in the site config (default ``long``), so
production can give PDFs a worker of their own (ADR-016, «طابور خاص»). The job's state,
cancel, liveness and files are ``core.jobs`` (shared with the Excel export).

The three endpoints that print are rate limited per user (``rate_limit``): a few sheets
are printed in the request, and the bench has ``DEFAULT_SLOTS`` engines for everyone.
"""

import os
import re
import time
import zlib

import frappe
from frappe import _

from report_view.core.custom_print import resolve as resolve_custom
from report_view.core.errors import RVInvalidInput, RVLimitExceeded
from report_view.core.guard import guard_doc_print, guard_print, guard_report
from report_view.core.jobs import ACTIVE as _ACTIVE
from report_view.core.jobs import PDF_JOBS
from report_view.core.limits import rate_limit
from report_view.core.pdf import (
	JOB_SECONDS,
	JOB_SLOT_WAIT,
	JOB_TIMEOUT,
	MAX_HTML_BYTES,
	RVPdfBusy,
	RVPdfTimeout,
	check_html,
	count_sheets,
	html_to_pdf,
	render_pdf,
)

_UNSAFE_FILENAME = re.compile(r'[\\/:*?"<>|\x00-\x1f]+')
SYNC_PAGES = 40
# a request body this large is printed by a job whatever its number of sheets
SYNC_BYTES = 4 * 1024 * 1024
# a job's files and state are kept this long after its last change
KEEP_SECONDS = PDF_JOBS.keep_seconds
# A job that has not reported for this long is lost (its worker was killed): a running job
# reports every couple of seconds, even inside a long batch.
STALE_SECONDS = PDF_JOBS.stale_seconds
QUEUE_CONF = PDF_JOBS.queue_conf
# calls per user and minute of each endpoint that prints
PRINT_RATE_LIMIT = 10

JOBS = PDF_JOBS


class _Cancelled(Exception):
	pass


@frappe.whitelist(methods=["POST"])
@rate_limit(PRINT_RATE_LIMIT)
def pages_pdf_report(report_name: str, html: str | None = None, title: str | None = None):
	"""PDF of a report's printed pages; needs ``print`` on the report's ``ref_doctype``.

	The pages come as ``html``, or gzipped as the uploaded file ``html_gz`` (see ``_html``)."""
	report = guard_report(report_name)
	guard_print(report)
	return _pdf(_html(html), title or report.name)


@frappe.whitelist(methods=["POST"])
@rate_limit(PRINT_RATE_LIMIT)
def pages_pdf_document(doctype: str, name: str, html: str | None = None, title: str | None = None):
	"""PDF of a document's printed pages; needs ``print`` on the document itself."""
	guard_doc_print(doctype, name)
	return _pdf(_html(html), title or name)


@frappe.whitelist(methods=["POST"])
@rate_limit(PRINT_RATE_LIMIT)
def pages_pdf_custom(
	print_format: str | None = None,
	html: str | None = None,
	title: str | None = None,
	token: str | None = None,
):
	"""PDF of a Custom print's pages (ADR-019): the Custom format must be one the user may
	print with (``guard_custom_format``); a print with an inline template names its staged
	``token`` instead, which is its user's only."""
	pf, _payload = resolve_custom(print_format, token)
	return _pdf(_html(html), title or (pf.name if pf else _("Sent template")))


@frappe.whitelist(methods=["GET"])
def pages_pdf_status(job: str) -> dict:
	"""The user's own job (see ``_public``)."""
	return _public(_live(job, _job(job)))


@frappe.whitelist(methods=["POST"])
def pages_pdf_cancel(job: str) -> dict:
	"""Cancel the user's own job: a queued one never starts, a running one stops within a
	few seconds, a finished one's file is removed. Answers as ``pages_pdf_status``."""
	state = _job(job)
	JOBS.cancel(job)
	state = _save(job, state, state="cancelled", stage="cancelled", error_code="cancelled")
	_release_active(state["owner"], job)
	_remove_files(job)
	return _public(state)


@frappe.whitelist(methods=["GET"])
def pages_pdf_download(job: str) -> None:
	"""The PDF of the user's finished job, as a download. The file stays until the job
	expires, so a dropped download can be asked again."""
	state = _live(job, _job(job))
	if state.get("state") != "done":
		frappe.throw(_("The PDF is not ready yet"), RVInvalidInput)
	try:
		with open(_path(job, "pdf"), "rb") as f:
			pdf = f.read()
	except OSError:
		frappe.throw(_("The PDF is no longer available. Make it again."), frappe.DoesNotExistError)
	_save(job, state, downloads=(state.get("downloads") or 0) + 1)
	_respond(pdf, state.get("title") or "report")


def _html(html: str | None) -> str | None:
	"""The pages as sent: the browser gzips them (a tenth of the size; Arabic text sent as a
	form field takes three times its bytes). Unpacked up to ``MAX_HTML_BYTES`` only, so a
	small file cannot unpack into a huge one."""
	upload = getattr(frappe.local, "request", None) and frappe.request.files.get("html_gz")
	if not upload:
		return html
	unpack = zlib.decompressobj(16 + zlib.MAX_WBITS)
	try:
		data = unpack.decompress(upload.stream.read(MAX_HTML_BYTES), MAX_HTML_BYTES + 1)
		text = data.decode("utf-8")
	except zlib.error, UnicodeDecodeError:
		frappe.throw(_("The printed pages could not be read"), RVInvalidInput)
	if len(data) > MAX_HTML_BYTES or unpack.unconsumed_tail:
		frappe.throw(
			_("The printed pages are larger than {0} MB").format(MAX_HTML_BYTES // (1024 * 1024)),
			RVInvalidInput,
		)
	return text


def _pdf(html: str, title: str):
	"""The download at once for a few sheets; else a job: ``{"job", "total"}``."""
	check_html(html)
	total = count_sheets(html)
	if total <= SYNC_PAGES and len(html) <= SYNC_BYTES:
		_respond(html_to_pdf(html, title=title), title)
		return None
	user = frappe.session.user
	_check_no_active_job(user)
	clean_old_files()
	job = JOBS.new_id()
	os.makedirs(_path(None), exist_ok=True)
	with open(_path(job, "html"), "w", encoding="utf-8") as f:
		f.write(html)
	queue = _queue()
	now = time.time()
	_set(
		job,
		{
			"owner": user,
			"state": "queued",
			"stage": "queued",
			"done": 0,
			"total": total,
			"title": title,
			"queue": queue,
			"created_at": now,
			"updated_at": now,
		},
	)
	JOBS.set_active(user, job)
	frappe.enqueue(
		"report_view.api.pdf.run_pdf_job",
		queue=queue,
		timeout=JOB_TIMEOUT,
		job_id=_rq_id(job),
		job=job,
		enqueue_after_commit=False,
	)
	return {"job": job, "total": total}


def run_pdf_job(job: str) -> None:
	"""The background job: prints the saved sheets, keeps its progress and a heartbeat,
	saves the PDF. Stops when the job is cancelled."""
	state = _get(job)
	if not state or state.get("state") != "queued" or _cancelled(job):
		_remove_files(job, pdf=False)
		return

	def heartbeat(stage):
		nonlocal state
		if _cancelled(job):
			raise _Cancelled
		state = _save(job, state, state="queued" if stage == "waiting" else "running", stage=stage)

	def progress(done, total):
		nonlocal state
		if _cancelled(job):
			raise _Cancelled
		state = _save(job, state, state="running", stage="rendering", done=done, total=total)

	try:
		with open(_path(job, "html"), encoding="utf-8") as f:
			html = f.read()
		result = render_pdf(
			html,
			title=state.get("title"),
			progress=progress,
			heartbeat=heartbeat,
			timeout=JOB_SECONDS,
			slot_wait=JOB_SLOT_WAIT,
		)
		if _cancelled(job):
			raise _Cancelled
		with open(_path(job, "pdf"), "wb") as f:
			f.write(result.pdf)
		state = _save(job, state, state="done", stage="done", done=state["total"], pages=result.pages)
	except _Cancelled:
		frappe.clear_last_message()
		state = _save(job, state, state="cancelled", stage="cancelled", error_code="cancelled")
		_remove_files(job)
	except Exception as e:
		frappe.clear_last_message()
		code, args = _error_code(e)
		state = _save(job, state, state="failed", stage="failed", error_code=code, error_args=args)
		if code in ("failed", "timeout"):
			frappe.log_error(title="Report View PDF job failed")
	finally:
		_remove_files(job, pdf=False)
		_release_active(state.get("owner"), job)


# ---------------------------------------------------------------- jobs' state


def _error_code(e: Exception) -> tuple[str, list]:
	"""The kind of a job's failure and its message's arguments (the text is made when the
	user asks, in their language; a real error stays in the Error Log only)."""
	args = getattr(e, "rv_args", None) or []
	if isinstance(e, RVPdfTimeout):
		return "timeout", args
	if isinstance(e, RVLimitExceeded) and len(args) == 2:
		return "limit", args
	if isinstance(e, RVPdfBusy):
		return "busy", []
	return "failed", []


def _error_text(code: str | None, args: list) -> str | None:
	if not code:
		return None
	if code == "timeout" and args:
		return _("Creating the PDF took longer than {0} seconds. Print fewer pages.").format(*args)
	if code == "limit":
		return _("The PDF has {0} pages; at most {1} pages can be printed").format(*args)
	if code == "busy":
		return _("The PDF engine is busy with other PDFs. Try again in a minute.")
	if code == "cancelled":
		return _("The PDF was cancelled")
	if code == "lost":
		return _("Creating the PDF stopped unexpectedly. Try again.")
	if code == "no_worker":
		return _("No background worker is running for PDFs. Ask your administrator.")
	return _("The PDF could not be made")


def _public(state: dict) -> dict:
	"""What the browser reads.

	- ``state``: ``queued`` | ``running`` | ``done`` | ``failed`` (a cancelled job reads as
	  ``failed`` with ``error_code`` ``cancelled``, so an older page stops polling);
	- ``stage``: ``queued`` (waiting for a worker), ``waiting`` (for a free engine),
	  ``rendering``, ``done``, ``failed``, ``cancelled``;
	- ``done``, ``total``: sheets printed so far, of all;
	- ``error`` (translated text) and ``error_code``: ``timeout`` | ``limit`` | ``busy`` |
	  ``lost`` | ``no_worker`` | ``cancelled`` | ``failed``;
	- ``updated_at`` (Unix time of the last heartbeat), ``seconds_since_update``;
	- ``cancellable``, ``downloadable``.
	"""
	internal = state.get("state")
	updated = state.get("updated_at") or state.get("created_at") or 0
	return {
		"state": "failed" if internal == "cancelled" else internal,
		"stage": state.get("stage") or internal,
		"done": state.get("done"),
		"total": state.get("total"),
		"error": _error_text(state.get("error_code"), state.get("error_args") or []),
		"error_code": state.get("error_code"),
		"updated_at": updated,
		"seconds_since_update": max(0, int(time.time() - updated)) if updated else None,
		"cancellable": internal in _ACTIVE,
		"downloadable": internal == "done",
	}


def _live(job: str, state: dict) -> dict:
	"""``state``, failed if its worker is gone (``Jobs.live``); a lost job's files go."""
	return JOBS.live(job, state, on_lost=lambda j, _state: _remove_files(j))


def _queue() -> str:
	return JOBS.queue()


def _check_no_active_job(user: str) -> None:
	"""One job per user: another one is refused while the first is queued or running."""
	if JOBS.has_active(user):
		frappe.throw(_("A PDF of yours is still being made. Wait for it to finish, or cancel it."), RVPdfBusy)


def _release_active(user: str | None, job: str) -> None:
	JOBS.release_active(user, job)


def _key(job: str) -> str:
	return JOBS.key(job)


def _rq_id(job: str) -> str:
	return JOBS.rq_id(job)


def _cancelled(job: str) -> bool:
	return JOBS.cancelled(job)


def _get(job: str) -> dict | None:
	return JOBS.get(job)


def _set(job: str, state: dict) -> None:
	JOBS.set(job, state)


def _save(job: str, current: dict, **changes) -> dict:
	return JOBS.save(job, current, **changes)


def _job(job: str) -> dict:
	"""The state of a job of this user (another user's job does not exist for them)."""
	return JOBS.owned(job)


# ---------------------------------------------------------------- jobs' files


def _path(job: str | None, ext: str | None = None) -> str:
	return JOBS.path(job, ext)


def _remove_files(job: str, pdf: bool = True) -> None:
	JOBS.remove_files(job, ("html", "pdf") if pdf else ("html",))


def clean_old_files() -> int:
	"""Files of jobs older than ``KEEP_SECONDS`` (when a job is made, and hourly through
	``report_view.core.pdf.cleanup_stale``); the number removed."""
	return JOBS.clean_old_files()


def _respond(pdf: bytes, title: str) -> None:
	"""Answer as a download, as ``frappe.utils.print_format.download_pdf`` does."""
	filename = _UNSAFE_FILENAME.sub("-", str(title)).strip(" .-")[:120] or "report"
	frappe.local.response.filename = f"{filename}.pdf"
	frappe.local.response.filecontent = pdf
	frappe.local.response.type = "pdf"
