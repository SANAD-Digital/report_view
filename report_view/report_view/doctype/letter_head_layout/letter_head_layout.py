import json

import frappe
from frappe import _
from frappe.model.document import Document

from report_view.core.letterhead import (
	LAYOUT_VERSION,
	RVLetterHeadEdited,
	content_hash,
	parse_layout,
	write_letter_head,
)


class LetterHeadLayout(Document):
	"""The design of a Letter Head made with the builder (ADR-018): the layout it is generated
	from. The Letter Head itself stays a standard record; this one only keeps it editable.
	A layout changed here (Desk, REST) writes its Letter Head again, as the builder does; the
	builder's own save has written it already (``flags.from_builder``)."""

	def validate(self):
		# a layout edited here is checked as the builder's is, and stored normalised
		layout = parse_layout(self.layout if isinstance(self.layout, str) else json.dumps(self.layout or {}))
		self.layout = json.dumps(layout, ensure_ascii=False, separators=(",", ":"))
		self.layout_version = LAYOUT_VERSION

	def on_update(self):
		if self.flags.from_builder:
			return
		before = self.get_doc_before_save()
		if before and not (self.has_value_changed("layout") or self.has_value_changed("company")):
			return
		lh = frappe.get_doc("Letter Head", self.letter_head)
		# the Letter Head's HTML as the builder last wrote it, else it was edited by hand
		written = before.generated_hash if before else None
		if (lh.content or lh.footer) and content_hash(lh.content, lh.footer) != written:
			frappe.throw(
				_(
					"Letter Head {0} was edited by hand. Open it in the letter head builder to replace its HTML."
				).format(lh.name),
				RVLetterHeadEdited,
			)
		generated = write_letter_head(lh, json.loads(self.layout), self.company or None)
		self.db_set("generated_hash", generated, update_modified=False)
