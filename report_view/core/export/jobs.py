"""The Excel export, at once or as a background job (docs/architecture.md §2.4).

An export of up to ``ASYNC_ROWS`` report rows is built in the request and comes back as
the download. A larger one is built by a job on the long queue (no request timeout, one
web worker not held for a minute): the browser asks for its state and downloads the file
when it is ready, as the PDF of the Pages view does (``report_view.api.pdf``). The job
runs as the user who asked (Frappe's job runner), so the report, ``can_export`` and every
permission of ``frappe.desk.query_report.run`` are checked again inside it. A job and its
file belong to that user, who may have one export job running at a time, and can cancel
it; the file is private and removed once downloaded, or after ``KEEP_SECONDS`` (hourly
``cleanup``). The state, cancel, liveness (a killed worker fails the job instead of
leaving it ``running``) and files are ``core.jobs``, shared with the server PDF. The
queue is ``report_view_export_queue`` in the site config (default ``long``).
"""

import os
import time
from typing import Any

import frappe
from frappe import _

from report_view.core import engine, normalize, runner
from report_view.core.errors import RVInvalidInput, RVLimitExceeded
from report_view.core.export import model as export_model_mod
from report_view.core.export import xlsx
from report_view.core.guard import guard_export, guard_report
from report_view.core.jobs import ACTIVE, XLSX_JOB_TIMEOUT, XLSX_JOBS
from report_view.core.settings import load_settings

ASYNC_ROWS = 20000
JOB_TIMEOUT = XLSX_JOB_TIMEOUT
KEEP_SECONDS = XLSX_JOBS.keep_seconds
JOBS = XLSX_JOBS


def run_report(report, report_name: str, model: dict) -> dict:
	"""The report's run for an export: ``ok`` or a translated refusal."""
	response = runner.run(
		report, report_name, model["filters"], model["js_filters"], model["prepared_report_name"]
	)
	if response["status"] == "too_large":
		frappe.throw(
			_("The report has {0} rows, more than the limit of {1}").format(
				response["row_count"], response["limit"]
			),
			RVLimitExceeded,
		)
	if response["status"] != "ok":
		frappe.throw(_("The prepared report result is not available"), RVInvalidInput)
	return response


def workbook(report, model: dict, response: dict) -> bytes:
	"""The workbook of a report's run and the view state of the export model."""
	settings = load_settings(report.name)
	nr = normalize.normalize(
		response.pop("raw"), model["filters"], settings["report_settings"], {}, translate=_
	)
	export_model_mod.check_against_report(model, nr)
	result = engine.apply(
		nr,
		model["view_state"],
		model["selection"],
		model["layout"]["columns"],
		lang=frappe.local.lang,
		quick_filters=model["quick_filters"],
	)
	export_model_mod.compare_expected(model, result, nr, report.name)
	return xlsx.build(report.name, nr, result, model, settings)


def filename(report) -> str:
	return f"{frappe.scrub(report.name)}.xlsx"


# ---------------------------------------------------------------- the background job


def enqueue(report, report_name: str, export_model: Any, row_count: int | None) -> dict:
	"""Queue the export of ``export_model`` (as the browser sent it): ``{"status": "queued",
	"job", "row_count"}``. Refused while another export job of the user is running."""
	user = frappe.session.user
	if JOBS.has_active(user):
		frappe.throw(_("An Excel export is already being prepared. Wait until it is ready."), RVLimitExceeded)
	cleanup()
	job = JOBS.new_id()
	queue = JOBS.queue()
	now = time.time()
	_set(
		job,
		{
			"owner": user,
			"state": "queued",
			"report_name": report_name,
			"export_model": export_model if isinstance(export_model, str) else frappe.as_json(export_model),
			"lang": frappe.local.lang,
			"filename": filename(report),
			"row_count": row_count,
			"error": None,
			"queue": queue,
			"created_at": now,
			"updated_at": now,
		},
	)
	JOBS.set_active(user, job, JOB_TIMEOUT)
	frappe.enqueue(
		"report_view.core.export.jobs.run_job",
		queue=queue,
		timeout=JOB_TIMEOUT,
		job_id=JOBS.rq_id(job),
		job=job,
		enqueue_after_commit=False,
	)
	return {"status": "queued", "job": job, "row_count": row_count}


def run_job(job: str) -> None:
	"""The background job: the report runs again, as the user, and the file is saved.
	A job cancelled before it starts never runs; one cancelled while it runs keeps no file."""
	state = _get(job)
	if not state:
		return
	if JOBS.cancelled(job):
		JOBS.release_active(state["owner"], job)
		return
	# the request's language (``_lang``), not the user's: the file is the one asked for
	if getattr(frappe.local, "job", None) is not None:
		frappe.local.job.lang_resolved = True
	frappe.local.lang = state.get("lang") or frappe.local.lang
	try:
		state = JOBS.save(job, state, state="running")
		report = guard_report(state["report_name"])
		guard_export(report)
		model = export_model_mod.parse(state["export_model"], "xlsx")
		response = run_report(report, state["report_name"], model)
		row_count = response["row_count"]
		content = workbook(report, model, response)
		if JOBS.cancelled(job):
			state = JOBS.save(job, state, state="cancelled", error_code="cancelled")
			return
		os.makedirs(_path(None), exist_ok=True)
		with open(_path(job), "wb") as f:
			f.write(content)
		state = JOBS.save(job, state, state="done", row_count=row_count)
	except (frappe.ValidationError, frappe.PermissionError) as e:
		# a refusal of Report View or Frappe (translated): the user reads it as it is
		frappe.clear_last_message()
		state = JOBS.save(job, state, state="failed", error=str(e) or _("The Excel file could not be made"))
	except Exception:
		frappe.clear_last_message()
		state = JOBS.save(job, state, state="failed", error=_("The Excel file could not be made"))
		frappe.log_error(
			title="Report View export job failed",
			reference_doctype="Report",
			reference_name=state.get("report_name"),
		)
	finally:
		JOBS.release_active(state["owner"], job)


def status(job: str) -> dict:
	"""``{state: queued|running|done|failed, row_count, error, error_code, cancellable}`` of
	the user's own job. A job whose worker is gone reads as failed (``error_code`` ``lost``
	or ``no_worker``); a cancelled one as failed with ``error_code`` ``cancelled``."""
	state = JOBS.live(job, _job(job), on_lost=lambda j, _state: _remove_file(j))
	internal = state.get("state")
	return {
		"state": "failed" if internal == "cancelled" else internal,
		"row_count": state.get("row_count"),
		"error": state.get("error") or _error_text(state.get("error_code")),
		"error_code": state.get("error_code"),
		"cancellable": internal in ACTIVE,
	}


def cancel(job: str) -> dict:
	"""Cancel the user's own job: a queued one never starts, a running one keeps no file,
	a finished one's file is removed. Answers as ``status``."""
	state = _job(job)
	JOBS.cancel(job)
	JOBS.save(job, state, state="cancelled", error_code="cancelled")
	JOBS.release_active(state["owner"], job)
	_remove_file(job)
	return status(job)


def _error_text(code: str | None) -> str | None:
	if not code:
		return None
	if code == "cancelled":
		return _("The Excel export was cancelled")
	if code == "lost":
		return _("Creating the Excel file stopped unexpectedly. Try again.")
	if code == "no_worker":
		return _("No background worker is running for exports. Ask your administrator.")
	return _("The Excel file could not be made")


def download(job: str) -> tuple[bytes, str]:
	"""The file of the user's finished job and its name; the job and its file are removed."""
	state = _job(job)
	if state.get("state") != "done":
		frappe.throw(_("The Excel file is not ready yet"), RVInvalidInput)
	try:
		with open(_path(job), "rb") as f:
			content = f.read()
	except OSError:
		frappe.throw(_("Export job {0} not found").format(job), frappe.DoesNotExistError)
	_remove(job)
	return content, state.get("filename") or "report.xlsx"


def cleanup() -> None:
	"""Files of jobs never downloaded go after ``KEEP_SECONDS`` (hourly, and before a job)."""
	JOBS.clean_old_files()


# ---------------------------------------------------------------- jobs' state and files


def _key(job: str) -> str:
	return JOBS.key(job)


def _running_key(user: str) -> str:
	return JOBS.active_key(user)


def _get(job: str) -> dict | None:
	return JOBS.get(job)


def _set(job: str, state: dict) -> None:
	JOBS.set(job, state)


def _job(job: str) -> dict:
	"""The state of a job of this user (another user's job does not exist for them); the
	report and ``can_export`` are checked again, as for the export itself."""
	state = JOBS.owned(job)
	guard_export(guard_report(state["report_name"]))
	return state


def _path(job: str | None) -> str:
	return JOBS.path(job, "xlsx")


def _remove_file(job: str) -> None:
	JOBS.remove_files(job, ("xlsx",))


def _remove(job: str) -> None:
	_remove_file(job)
	JOBS.remove(job)
