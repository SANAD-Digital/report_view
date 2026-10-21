import frappe
from frappe.model.document import Document

from report_view.core import print_presets


class PrintPreset(Document):
	"""Saved settings of the print pages (ADR-020): private to their owner (``for_user`` set)
	or public (``for_user`` empty, made by a publisher). The checks live in
	``report_view.core.print_presets`` so the REST API and the toolbar's API share them."""

	def validate(self):
		print_presets.validate_preset(self)

	def on_update(self):
		print_presets.clear_other_defaults(self)
