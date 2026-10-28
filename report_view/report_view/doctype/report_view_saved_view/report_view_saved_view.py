from frappe.model.document import Document

from report_view.core import saved_views


class ReportViewSavedView(Document):
	"""A saved view of a report (ADR-010): private to its owner, shared with roles, or
	public to whoever may open the report. The checks live in ``report_view.core.saved_views``
	so the REST API and ``report_view.api.views`` share them."""

	def validate(self):
		saved_views.validate_view(self)

	def on_trash(self):
		saved_views.check_owner(self)
