"""Server PDF of the printed pages (ADR-016).

The browser sends the finished HTML of its Pages view; the server prints it with
Chromium. A few pages come back at once as the download; more than ``SYNC_PAGES`` sheets
are printed by a background job (the long queue: no request timeout), the browser asks
for its progress and downloads the file when it is ready. A job and its files belong to
the user who started it and are removed once downloaded (or after ``KEEP_SECONDS``).
"""

import os
import re
import time
import zlib

import frappe
from frappe import _

from report_view.core.errors import RVInvalidInput
from report_view.core.guard import guard_print, guard_report
from report_view.core.pdf import MAX_HTML_BYTES, count_sheets, html_to_pdf, render_pdf

_UNSAFE_FILENAME = re.compile(r'[\\/:*?"<>|\x00-\x1f]+')
_JOB_ID = re.compile(r"^[a-f0-9]{16}$")
SYNC_PAGES = 40
JOB_TIMEOUT = 900
KEEP_SECONDS = 3600
_FOLDER = "rv_pdf"


@frappe.whitelist(methods=["POST"])
def pages_pdf_report(report_name: str, html: str | None = None, title: str | None = None):
	"""PDF of a report's printed pages; needs ``print`` on the report's ``ref_doctype``.

	The pages come as ``html``, or gzipped as the uploaded file ``html_gz`` (see ``_html``)."""
	report = guard_report(report_name)
	guard_print(report)
	return _pdf(_html(html), title or report.name)


@frappe.whitelist(methods=["POST"])
def pages_pdf_document(doctype: str, name: str, html: str | None = None, title: str | None = None):
	"""PDF of a document's printed pages; needs ``print`` on the document itself."""
	_check_document_print(doctype, name)
	return _pdf(_html(html), title or name)


@frappe.whitelist(methods=["GET"])
def pages_pdf_status(job: str) -> dict:
	"""``{state: queued|running|done|failed, done, total, error}`` of the user's own job."""
	state = _job(job)
	return {k: state.get(k) for k in ("state", "done", "total", "error")}


@frappe.whitelist(methods=["GET"])
def pages_pdf_download(job: str) -> None:
	"""The PDF of the user's finished job, as a download; the job's files are removed."""
	state = _job(job)
	if state.get("state") != "done":
		frappe.throw(_("The PDF is not ready yet"), RVInvalidInput)
	path = _path(job, "pdf")
	with open(path, "rb") as f:
		pdf = f.read()
	_remove(job)
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
	except (zlib.error, UnicodeDecodeError):
		frappe.throw(_("The printed pages could not be read"), RVInvalidInput)
	if len(data) > MAX_HTML_BYTES or unpack.unconsumed_tail:
		frappe.throw(
			_("The printed pages are larger than {0} MB").format(MAX_HTML_BYTES // (1024 * 1024)),
			RVInvalidInput,
		)
	return text


def _pdf(html: str, title: str):
	"""The download at once for a few sheets; else a job: ``{"job", "total"}``."""
	total = count_sheets(html) if isinstance(html, str) else 0
	if total <= SYNC_PAGES:
		_respond(html_to_pdf(html, title=title), title)
		return None
	_clean_old()
	job = frappe.generate_hash(length=16)
	os.makedirs(_path(None), exist_ok=True)
	with open(_path(job, "html"), "w", encoding="utf-8") as f:
		f.write(html)
	_set(job, {"owner": frappe.session.user, "state": "queued", "done": 0, "total": total, "title": title})
	frappe.enqueue(
		"report_view.api.pdf.run_pdf_job",
		queue="long",
		timeout=JOB_TIMEOUT,
		job=job,
		enqueue_after_commit=False,
	)
	return {"job": job, "total": total}


def run_pdf_job(job: str) -> None:
	"""The background job: prints the saved sheets, keeps its progress, saves the PDF."""
	state = _get(job)
	if not state:
		return

	def progress(done, total):
		_set(job, {**state, "state": "running", "done": done, "total": total})

	try:
		progress(0, state["total"])
		with open(_path(job, "html"), encoding="utf-8") as f:
			html = f.read()
		result = render_pdf(html, title=state.get("title"), progress=progress, timeout=JOB_TIMEOUT - 60)
		with open(_path(job, "pdf"), "wb") as f:
			f.write(result.pdf)
		_set(job, {**state, "state": "done", "done": state["total"], "total": state["total"]})
	except Exception as e:
		frappe.clear_last_message()
		_set(job, {**state, "state": "failed", "error": str(e) or _("The PDF could not be made")})
		frappe.log_error(title="Report View PDF job failed")
	finally:
		try:
			os.remove(_path(job, "html"))
		except OSError:
			pass


# ---------------------------------------------------------------- jobs' state and files


def _key(job: str) -> str:
	return f"report_view:pdf_job:{job}"


def _get(job: str) -> dict | None:
	return frappe.cache.get_value(_key(job))


def _set(job: str, state: dict) -> None:
	frappe.cache.set_value(_key(job), state, expires_in_sec=KEEP_SECONDS)


def _job(job: str) -> dict:
	"""The state of a job of this user (another user's job does not exist for them)."""
	if not isinstance(job, str) or not _JOB_ID.match(job):
		frappe.throw(_("Invalid PDF job"), RVInvalidInput)
	state = _get(job)
	if not state or state.get("owner") != frappe.session.user:
		frappe.throw(_("PDF job {0} not found").format(job), frappe.DoesNotExistError)
	return state


def _path(job: str | None, ext: str | None = None) -> str:
	folder = frappe.get_site_path("private", _FOLDER)
	return folder if job is None else os.path.join(folder, f"{job}.{ext}")


def _remove(job: str) -> None:
	for ext in ("html", "pdf"):
		try:
			os.remove(_path(job, ext))
		except OSError:
			pass
	frappe.cache.delete_value(_key(job))


def _clean_old() -> None:
	"""Files of jobs never downloaded go after ``KEEP_SECONDS``."""
	folder = _path(None)
	if not os.path.isdir(folder):
		return
	limit = time.time() - KEEP_SECONDS
	for name in os.listdir(folder):
		path = os.path.join(folder, name)
		try:
			if os.path.getmtime(path) < limit:
				os.remove(path)
		except OSError:
			pass


def _check_document_print(doctype: str, name: str) -> None:
	"""Strict ``print`` check, as ``frappe.www.printview.validate_print_permission`` does for its
	``print`` branch. Its ``read`` / website / share-key fallbacks are not taken: Report View
	requires ``print`` for printing (CLAUDE.md)."""
	if not isinstance(doctype, str) or not isinstance(name, str) or not doctype or not name:
		frappe.throw(_("Document is required"), frappe.DoesNotExistError)
	# Doctype level first, so a user without print learns nothing about the document.
	if not frappe.has_permission(doctype, "print"):
		frappe.throw(_("You are not allowed to print {0}").format(_(doctype)), frappe.PermissionError)
	doc = frappe.get_doc(doctype, name)
	if not frappe.has_permission(doctype, "print", doc=doc):
		frappe.throw(_("You are not allowed to print {0}").format(_(doctype)), frappe.PermissionError)


def _respond(pdf: bytes, title: str) -> None:
	"""Answer as a download, as ``frappe.utils.print_format.download_pdf`` does."""
	filename = _UNSAFE_FILENAME.sub("-", str(title)).strip(" .-")[:120] or "report"
	frappe.local.response.filename = f"{filename}.pdf"
	frappe.local.response.filecontent = pdf
	frappe.local.response.type = "pdf"
