"""The state and files of Report View's background jobs: the Excel export
(``core.export.jobs``) and the server PDF (``api.pdf``).

A job's state is a dict in Redis under its own key, written by the web request that
starts it and by the worker that runs it (read with ``use_local_cache=False``, so a
request never sees an old copy). A job belongs to the user who started it: another
user's job does not exist for them. A user has one active job of a kind at a time.
A job is cancelled through a key of its own that the worker checks between steps.
``live`` fails a job whose worker is gone: the RQ job failed or was stopped, it finished
without a final state, it has not reported for ``stale_seconds``, or no worker serves its
queue. The job's files are in ``private/<folder>`` of the site and go after
``keep_seconds`` (hourly, and before a job is made).
"""

import os
import time
from collections.abc import Callable

import frappe
from frappe import _

ACTIVE = ("queued", "running")


class Jobs:
	def __init__(
		self,
		*,
		state_prefix: str,
		active_prefix: str,
		cancel_prefix: str,
		rq_prefix: str,
		folder: str,
		queue_conf: str,
		invalid_message: Callable[[], str],
		not_found_message: Callable[[str], str],
		keep_seconds: int = 3600,
		stale_seconds: int = 60,
		no_worker_seconds: int = 120,
		log_title: str = "Report View job lost",
	):
		self.state_prefix = state_prefix
		self.active_prefix = active_prefix
		self.cancel_prefix = cancel_prefix
		self.rq_prefix = rq_prefix
		self.folder = folder
		self.queue_conf = queue_conf
		self.invalid_message = invalid_message
		self.not_found_message = not_found_message
		self.keep_seconds = keep_seconds
		self.stale_seconds = stale_seconds
		self.no_worker_seconds = no_worker_seconds
		self.log_title = log_title

	# ------------------------------------------------------------ keys and state

	def key(self, job: str) -> str:
		return f"{self.state_prefix}{job}"

	def cancel_key(self, job: str) -> str:
		return f"{self.cancel_prefix}{job}"

	def active_key(self, user: str) -> str:
		return f"{self.active_prefix}{user}"

	def rq_id(self, job: str) -> str:
		return f"{self.rq_prefix}{job}"

	def new_id(self) -> str:
		return frappe.generate_hash(length=16)

	def get(self, job: str) -> dict | None:
		return frappe.cache.get_value(self.key(job), use_local_cache=False)

	def set(self, job: str, state: dict) -> None:
		frappe.cache.set_value(self.key(job), state, expires_in_sec=self.keep_seconds)

	def save(self, job: str, current: dict, **changes) -> dict:
		"""``current`` with ``changes`` and a new ``updated_at`` (the job's heartbeat)."""
		state = {**current, **changes, "updated_at": time.time()}
		self.set(job, state)
		return state

	def owned(self, job: str) -> dict:
		"""The state of a job of this user (another user's job does not exist for them)."""
		from report_view.core.errors import RVInvalidInput

		if not isinstance(job, str) or len(job) != 16 or any(c not in "0123456789abcdef" for c in job):
			frappe.throw(self.invalid_message(), RVInvalidInput)
		state = self.get(job)
		if not state or state.get("owner") != frappe.session.user:
			frappe.throw(self.not_found_message(job), frappe.DoesNotExistError)
		return state

	def remove(self, job: str) -> None:
		frappe.cache.delete_value(self.key(job))

	# ------------------------------------------------------------ one job per user

	def active(self, user: str) -> str | None:
		return frappe.cache.get_value(self.active_key(user), use_local_cache=False)

	def set_active(self, user: str, job: str, seconds: int | None = None) -> None:
		frappe.cache.set_value(self.active_key(user), job, expires_in_sec=seconds or self.keep_seconds)

	def release_active(self, user: str | None, job: str) -> None:
		if user and self.active(user) == job:
			frappe.cache.delete_value(self.active_key(user))

	def has_active(self, user: str) -> bool:
		"""Whether the user's active job is still queued or running (after ``live``)."""
		job = self.active(user)
		if not job:
			return False
		state = self.get(job)
		return bool(state and state.get("owner") == user and self.live(job, state).get("state") in ACTIVE)

	# ------------------------------------------------------------ cancel

	def cancel(self, job: str) -> None:
		"""Mark the job cancelled; a queued RQ job is dropped from its queue."""
		from frappe.utils.background_jobs import get_job
		from rq.job import JobStatus

		frappe.cache.set_value(self.cancel_key(job), 1, expires_in_sec=self.keep_seconds)
		rq_job = get_job(self.rq_id(job))
		if rq_job and rq_job.get_status(refresh=False) == JobStatus.QUEUED:
			try:
				rq_job.cancel()
			except Exception:
				# the job sees the cancel key when it starts
				pass

	def cancelled(self, job: str) -> bool:
		return bool(frappe.cache.get_value(self.cancel_key(job), use_local_cache=False))

	# ------------------------------------------------------------ the worker

	def queue(self) -> str:
		"""The queue named by ``queue_conf`` in the site config when it is a configured
		queue (the ``workers`` key of common_site_config), else ``long``."""
		from frappe.utils.background_jobs import get_queues_timeout

		name = frappe.conf.get(self.queue_conf) or "long"
		if name not in get_queues_timeout():
			frappe.logger("report_view").warning(
				"Report View: queue %r of %s is not configured in workers; using long", name, self.queue_conf
			)
			return "long"
		return name

	def live(self, job: str, state: dict, on_lost: Callable[[str, dict], None] | None = None) -> dict:
		"""``state``, failed with ``error_code`` ``lost`` or ``no_worker`` if its worker is
		gone; a job cancelled by its user reads as cancelled. ``on_lost(job, state)`` runs
		once for a lost job (to remove its files)."""
		if self.cancelled(job) and state.get("state") != "cancelled":
			return self.save(job, state, state="cancelled", stage="cancelled", error_code="cancelled")
		if state.get("state") not in ACTIVE:
			return state
		from frappe.utils.background_jobs import get_job
		from rq.job import JobStatus

		age = time.time() - (state.get("updated_at") or state.get("created_at") or 0)
		rq_job = get_job(self.rq_id(job))
		status = rq_job.get_status(refresh=False) if rq_job else None
		lost = None
		if status in (JobStatus.FAILED, JobStatus.STOPPED, JobStatus.CANCELED):
			lost = "lost"
		elif status == JobStatus.QUEUED:
			if age > self.no_worker_seconds and not self.has_worker(state.get("queue") or "long"):
				lost = "no_worker"
		elif age > self.stale_seconds:
			# started without a heartbeat, finished without a final state, or gone
			lost = "lost"
		if not lost:
			return state
		frappe.log_error(
			title=self.log_title,
			message=f"job {job}, state {state.get('state')}, RQ status {status}, {int(age)} s since its last report",
		)
		state = self.save(job, state, state="failed", stage="failed", error_code=lost)
		self.release_active(state.get("owner"), job)
		if on_lost:
			on_lost(job, state)
		return state

	@staticmethod
	def has_worker(queue: str) -> bool:
		from frappe.utils.background_jobs import get_queue, get_workers

		try:
			return bool(get_workers(get_queue(queue)))
		except Exception:
			return True

	# ------------------------------------------------------------ files

	def path(self, job: str | None, ext: str | None = None) -> str:
		folder = frappe.get_site_path("private", self.folder)
		return folder if job is None else os.path.join(folder, f"{job}.{ext}")

	def remove_files(self, job: str, exts: tuple[str, ...]) -> None:
		for ext in exts:
			try:
				os.remove(self.path(job, ext))
			except OSError:
				pass

	def clean_old_files(self) -> int:
		"""Files older than ``keep_seconds``; the number removed."""
		folder = self.path(None)
		if not os.path.isdir(folder):
			return 0
		limit = time.time() - self.keep_seconds
		removed = 0
		for name in os.listdir(folder):
			path = os.path.join(folder, name)
			try:
				if os.path.getmtime(path) < limit:
					os.remove(path)
					removed += 1
			except OSError:
				pass
		return removed


# ---------------------------------------------------------------- the two kinds of job


# The server PDF (api.pdf, ADR-016). A running job reports every couple of seconds, even
# inside a long batch, so a minute without a report means its worker was killed.
PDF_JOBS = Jobs(
	state_prefix="report_view:pdf_job:",
	active_prefix="report_view:pdf_active_job:",
	cancel_prefix="report_view:pdf_job_cancel:",
	rq_prefix="report_view_pdf_",
	folder="rv_pdf",
	queue_conf="report_view_pdf_queue",
	invalid_message=lambda: _("Invalid PDF job"),
	not_found_message=lambda job: _("PDF job {0} not found").format(job),
	keep_seconds=3600,
	stale_seconds=60,
	no_worker_seconds=120,
	log_title="Report View PDF job lost",
)

# The Excel export (core.export.jobs). Its run is one step (the report, then the workbook)
# with no report in between, so it is lost only past its RQ timeout and a minute.
XLSX_JOB_TIMEOUT = 1500
XLSX_JOBS = Jobs(
	state_prefix="report_view:xlsx_job:",
	active_prefix="report_view:xlsx_running:",
	cancel_prefix="report_view:xlsx_job_cancel:",
	rq_prefix="report_view_xlsx_",
	folder="rv_xlsx",
	queue_conf="report_view_export_queue",
	invalid_message=lambda: _("Invalid export job"),
	not_found_message=lambda job: _("Export job {0} not found").format(job),
	keep_seconds=3600,
	stale_seconds=XLSX_JOB_TIMEOUT + 60,
	no_worker_seconds=120,
	log_title="Report View export job lost",
)
