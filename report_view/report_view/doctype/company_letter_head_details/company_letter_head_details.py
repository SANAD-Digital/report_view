from frappe.model.document import Document


class CompanyLetterHeadDetails(Document):
	"""What the company's letter head prints that Company lacks (ADR-030): one row under the
	company (its table «Letter Head Details»). A child table, not fields of Company: it adds
	no column to tabCompany, which on a site with many apps is near MariaDB's row size."""

	pass
