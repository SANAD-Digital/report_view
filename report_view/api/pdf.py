"""Server PDF of the printed pages (ADR-016).

The browser sends the finished HTML of its Pages view; the server prints it with
Chromium and answers with the PDF as a download.
"""

import re

import frappe
from frappe import _

from report_view.core.guard import guard_print, guard_report
from report_view.core.pdf import html_to_pdf

_UNSAFE_FILENAME = re.compile(r'[\\/:*?"<>|\x00-\x1f]+')


@frappe.whitelist(methods=["POST"])
def pages_pdf_report(report_name: str, html: str, title: str | None = None) -> None:
	"""PDF of a report's printed pages; needs ``print`` on the report's ``ref_doctype``."""
	report = guard_report(report_name)
	guard_print(report)
	_respond(html_to_pdf(html, title=title), title or report.name)


@frappe.whitelist(methods=["POST"])
def pages_pdf_document(doctype: str, name: str, html: str, title: str | None = None) -> None:
	"""PDF of a document's printed pages; needs ``print`` on the document itself."""
	_check_document_print(doctype, name)
	_respond(html_to_pdf(html, title=title), title or name)


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
