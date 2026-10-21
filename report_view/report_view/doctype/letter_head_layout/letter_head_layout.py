import json

from frappe.model.document import Document

from report_view.core.letterhead import LAYOUT_VERSION, parse_layout


class LetterHeadLayout(Document):
	"""The design of a Letter Head made with the builder (ADR-018): the layout it is generated
	from. The Letter Head itself stays a standard record; this one only keeps it editable."""

	def validate(self):
		# a layout edited here is checked as the builder's is, and stored normalised
		layout = parse_layout(self.layout if isinstance(self.layout, str) else json.dumps(self.layout or {}))
		self.layout = json.dumps(layout, ensure_ascii=False, separators=(",", ":"))
		self.layout_version = LAYOUT_VERSION
