"""Shared permission checks (docs/architecture.md §2.0).

Every whitelisted function calls ``guard_report`` on its first line. The checks
reuse Frappe's own ``get_report_doc``; nothing is re-implemented here.
"""

import frappe
from frappe import _
from frappe.core.doctype.report.report import Report
from frappe.desk.query_report import get_report_doc

from report_view.core.errors import RVInvalidInput, RVNoExport, RVNoPrint, RVUnsupportedReport

SUPPORTED_REPORT_TYPES = ("Script Report", "Query Report")


def guard_report(report_name: str) -> Report:
	"""Return the report document if the session user may run it, else raise.

	``get_report_doc`` checks report roles / Custom Role, ``report`` permission on
	``ref_doctype`` and ``disabled`` (Q:24-58), and resolves Custom Reports to
	their reference report.
	"""
	if not isinstance(report_name, str) or not report_name.strip():
		frappe.throw(_("Report name is required"), frappe.DoesNotExistError)
	report = get_report_doc(report_name)
	if report.report_type not in SUPPORTED_REPORT_TYPES:
		frappe.throw(
			_("Report type {0} is not supported in Report View").format(_(report.report_type)),
			RVUnsupportedReport,
		)
	return report


def guard_report_quiet(report_name: str) -> Report | None:
	"""Like ``guard_report`` but returns ``None`` when the report is refused (not
	permitted, not found, invalid), without leaving the rejection's messages in
	``frappe.local.message_log``. Any other error is a bug and is raised."""
	message_log = getattr(frappe.local, "message_log", None)
	mark = len(message_log) if message_log is not None else 0
	try:
		return guard_report(report_name)
	except (frappe.PermissionError, frappe.DoesNotExistError, frappe.ValidationError):
		message_log = getattr(frappe.local, "message_log", None)
		if message_log is not None:
			del message_log[mark:]
		return None


def guard_export(report: Report) -> None:
	"""Raise ``RVNoExport`` unless the user may export ``report.ref_doctype``."""
	if not frappe.permissions.can_export(report.ref_doctype, raise_exception=False):
		frappe.throw(
			_("You are not allowed to export {0}").format(_(report.ref_doctype)),
			RVNoExport,
		)


def guard_print(report: Report) -> None:
	"""Raise ``RVNoPrint`` unless the user has ``print`` on ``report.ref_doctype``.

	``ignore_share_permissions`` is required: a single shared document of the
	doctype would otherwise grant ``print`` (permissions.py:178-209).
	"""
	if not frappe.has_permission(report.ref_doctype, "print", ignore_share_permissions=True):
		frappe.throw(
			_("You are not allowed to print {0}").format(_(report.ref_doctype)),
			RVNoPrint,
		)


def guard_doc_print(doctype: str, name: str):
	"""The document, if the user may print it; else raise. The one check of the document
	print page (``api.document``) and of its PDF (``api.pdf.pages_pdf_document``).

	``print`` is checked on the doctype first, so a user without it learns nothing about
	the document, then on the document itself. Frappe's print page also lets ``read``
	print (``frappe.www.printview.validate_print_permission``); Report View asks for
	``print`` (CLAUDE.md). A child table is not a printable document."""
	if not isinstance(doctype, str) or not isinstance(name, str) or not doctype or not name:
		frappe.throw(_("Document type and name are required"), RVInvalidInput)
	if not frappe.db.exists("DocType", doctype) or frappe.get_meta(doctype).istable:
		frappe.throw(_("Document type {0} not found").format(doctype), frappe.DoesNotExistError)
	if not frappe.has_permission(doctype, "print"):
		frappe.throw(_("You are not allowed to print {0}").format(_(doctype)), frappe.PermissionError)
	doc = frappe.get_doc(doctype, name)
	if not frappe.has_permission(doctype, "print", doc=doc):
		frappe.throw(_("You are not allowed to print {0}").format(_(doctype)), frappe.PermissionError)
	return doc


def can_export(report: Report) -> bool:
	"""Non-raising export check, for ``get_meta.perms`` only."""
	return bool(frappe.permissions.can_export(report.ref_doctype, raise_exception=False))


def can_print(report: Report) -> bool:
	"""Non-raising print check, for ``get_meta.perms`` only."""
	return bool(frappe.has_permission(report.ref_doctype, "print", ignore_share_permissions=True))
