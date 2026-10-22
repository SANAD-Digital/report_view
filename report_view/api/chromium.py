"""The PDF agent's Chromium in Report View Global Settings (ADR-016): what it prints with,
and a button to install the pinned build. System Manager only: it runs on the bench."""

import frappe

from report_view.core import chromium


@frappe.whitelist(methods=["GET"])
def engine_status() -> dict:
	frappe.only_for("System Manager")
	return chromium.status()


@frappe.whitelist(methods=["POST"])
def engine_install(force: int | str = 0) -> dict:
	frappe.only_for("System Manager")
	if not chromium.supported():
		frappe.throw(frappe._("Chrome for Testing has no build for this server's system"))
	frappe.enqueue(
		"report_view.core.chromium.install_job",
		queue="long",
		timeout=chromium.INSTALL_TIMEOUT + 60,
		job_id=chromium.JOB_ID,
		deduplicate=True,
		force=bool(frappe.utils.cint(force)),
	)
	return chromium.status()
