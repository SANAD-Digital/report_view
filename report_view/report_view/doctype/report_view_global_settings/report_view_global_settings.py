import frappe
from frappe import _
from frappe.model.document import Document

from report_view.core.settings import HARD_MAX_ROWS, HARD_PRINT_MAX_PAGES


class ReportViewGlobalSettings(Document):
	"""The fixed limits of Report View and the standard print settings of the Pages view
	(docs/architecture.md §5.2, ADR-015)."""

	def validate(self):
		if self.max_rows and self.max_rows > HARD_MAX_ROWS:
			frappe.throw(_("Maximum rows of a report cannot be more than {0}").format(HARD_MAX_ROWS))
		if self.print_max_pages and self.print_max_pages > HARD_PRINT_MAX_PAGES:
			frappe.throw(
				_("Maximum pages printed at once cannot be more than {0}").format(HARD_PRINT_MAX_PAGES)
			)
		for side in ("top", "bottom", "start", "end"):
			if (self.get(f"margin_{side}") or 0) > 60:
				frappe.throw(_("A page margin cannot be more than {0} mm").format(60))

	def on_update(self):
		# what opens first (default_report_view, default_print_view) and where a custom print
		# opens reach the pages through Desk's boot (core/settings.py boot_session), kept per
		# user: dropped, every user has the new choice at the next load
		frappe.cache.delete_key("bootinfo")
