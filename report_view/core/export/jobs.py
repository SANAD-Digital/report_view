"""The Excel export, at once or as a background job (docs/architecture.md §2.4).

An export of up to ``ASYNC_ROWS`` report rows is built in the request and comes back as
the download. A larger one is built by a job on the long queue (no request timeout, one
web worker not held for a minute): the browser asks for its state and downloads the file
when it is ready, as the PDF of the Pages view does (``report_view.api.pdf``). The job
runs as the user who asked (Frappe's job runner), so the report, ``can_export`` and every
permission of ``frappe.desk.query_report.run`` are checked again inside it. A job and its
file belong to that user, who may have one export job running at a time; the file is
private and removed once downloaded, or after ``KEEP_SECONDS`` (hourly ``cleanup``).
"""

import os
import re
import time
from typing import Any

import frappe
from frappe import _

from report_view.core import engine, normalize, runner
from report_view.core.errors import RVInvalidInput, RVLimitExceeded
from report_view.core.export import model as export_model_mod
from report_view.core.export import xlsx
from report_view.core.guard import guard_export, guard_report
from report_view.core.settings import load_settings

ASYNC_ROWS = 20000
JOB_TIMEOUT = 1500
KEEP_SECONDS = 3600
_FOLDER = "rv_xlsx"
_JOB_ID = re.compile(r"^[a-f0-9]{16}$")


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
	running = frappe.cache.get_value(_running_key(user))
	if running and (_get(running) or {}).get("state") in ("queued", "running"):
		frappe.throw(_("An Excel export is already being prepared. Wait until it is ready."), RVLimitExceeded)
	cleanup()
	job = frappe.generate_hash(length=16)
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
		},
	)
	frappe.cache.set_value(_running_key(user), job, expires_in_sec=JOB_TIMEOUT)
	frappe.enqueue(
		"report_view.core.export.jobs.run_job",
		queue="long",
		timeout=JOB_TIMEOUT,
		job=job,
		enqueue_after_commit=False,
	)
	return {"status": "queued", "job": job, "row_count": row_count}


def run_job(job: str) -> None:
	"""The background job: the report runs again, as the user, and the file is saved."""
	state = _get(job)
	if not state:
		return
	# the request's language (``_lang``), not the user's: the file is the one asked for
	if getattr(frappe.local, "job", None) is not None:
		frappe.local.job.lang_resolved = True
	frappe.local.lang = state.get("lang") or frappe.local.lang
	try:
		_set(job, {**state, "state": "running"})
		report = guard_report(state["report_name"])
		guard_export(report)
		model = export_model_mod.parse(state["export_model"], "xlsx")
		response = run_report(report, state["report_name"], model)
		row_count = response["row_count"]
		content = workbook(report, model, response)
		os.makedirs(_path(None), exist_ok=True)
		with open(_path(job), "wb") as f:
			f.write(content)
		_set(job, {**state, "state": "done", "row_count": row_count})
	except (frappe.ValidationError, frappe.PermissionError) as e:
		# a refusal of Report View or Frappe (translated): the user reads it as it is
		frappe.clear_last_message()
		_set(job, {**state, "state": "failed", "error": str(e) or _("The Excel file could not be made")})
	except Exception:
		frappe.clear_last_message()
		_set(job, {**state, "state": "failed", "error": _("The Excel file could not be made")})
		frappe.log_error(
			title="Report View export job failed",
			reference_doctype="Report",
			reference_name=state.get("report_name"),
		)
	finally:
		if frappe.cache.get_value(_running_key(state["owner"])) == job:
			frappe.cache.delete_value(_running_key(state["owner"]))


def status(job: str) -> dict:
	"""``{state: queued|running|done|failed, row_count, error}`` of the user's own job."""
	state = _job(job)
	return {k: state.get(k) for k in ("state", "row_count", "error")}


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


# ---------------------------------------------------------------- jobs' state and files


def _key(job: str) -> str:
	return f"report_view:xlsx_job:{job}"


def _running_key(user: str) -> str:
	return f"report_view:xlsx_running:{user}"


def _get(job: str) -> dict | None:
	return frappe.cache.get_value(_key(job))


def _set(job: str, state: dict) -> None:
	frappe.cache.set_value(_key(job), state, expires_in_sec=KEEP_SECONDS)


def _job(job: str) -> dict:
	"""The state of a job of this user (another user's job does not exist for them); the
	report and ``can_export`` are checked again, as for the export itself."""
	if not isinstance(job, str) or not _JOB_ID.match(job):
		frappe.throw(_("Invalid export job"), RVInvalidInput)
	state = _get(job)
	if not state or state.get("owner") != frappe.session.user:
		frappe.throw(_("Export job {0} not found").format(job), frappe.DoesNotExistError)
	guard_export(guard_report(state["report_name"]))
	return state


def _path(job: str | None) -> str:
	folder = frappe.get_site_path("private", _FOLDER)
	return folder if job is None else os.path.join(folder, f"{job}.xlsx")


def _remove(job: str) -> None:
	try:
		os.remove(_path(job))
	except OSError:
		pass
	frappe.cache.delete_value(_key(job))
