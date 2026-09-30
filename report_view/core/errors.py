"""Expected error types of report_view (docs/architecture.md §2.0).

The class name is the code the browser reads from ``exc_type``.
"""

import frappe


class RVUnsupportedReport(frappe.ValidationError):
	"""Report Builder or another unsupported report type."""


class RVNoExport(frappe.PermissionError):
	"""``can_export`` failed on the report's ``ref_doctype``."""


class RVNoPrint(frappe.PermissionError):
	"""No ``print`` permission on the report's ``ref_doctype``."""


class RVInvalidInput(frappe.ValidationError):
	"""Invalid input: JSON, type or size."""


class RVInvalidViewState(frappe.ValidationError):
	"""View state does not match the schema or references unknown columns."""


class RVEnrichNotAllowed(frappe.PermissionError):
	"""Enrichment triple outside the server allowlist."""


class RVLimitExceeded(frappe.ValidationError):
	"""A limit was exceeded (enrich names, model size, row limit)."""


class RVExportMismatch(frappe.ValidationError):
	"""Server totals differ from the ``expected`` totals sent by the browser."""

	http_status_code = 409


class RVViewNotFound(frappe.DoesNotExistError):
	"""Saved view missing, not visible, or belonging to another report."""


class RVNotOwner(frappe.PermissionError):
	"""Editing or deleting a saved view the user does not own."""


class RVReportError(frappe.ValidationError):
	"""Exception raised by the report's own code; the original message is passed on."""
