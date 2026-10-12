import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils.jinja import validate_template


class PrintSignature(Document):
	"""Signature boxes printed under a report (Pages view) or in a document's print format
	(``report_view_signature``): a table of signatories, or an HTML/Jinja template (ADR-015)."""

	def validate(self):
		if self.signature_for == "Report":
			self.reference_doctype = None
		else:
			self.report = None
		if self.content_type == "Table":
			if not self.signatories:
				frappe.throw(_("Add at least one signatory"))
		elif not (self.html or "").strip():
			frappe.throw(_("Write the HTML of the signature"))
		else:
			# a template that does not compile is refused here, not at print time
			validate_template(self.html)
