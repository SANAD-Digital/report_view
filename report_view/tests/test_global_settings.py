import frappe

from report_view.core.settings import HARD_MAX_ROWS, HARD_PRINT_MAX_PAGES
from report_view.tests.utils import RVTestCase


class TestReportViewGlobalSettings(RVTestCase):
	"""The fixed limits are a ceiling the settings cannot raise (docs/architecture.md §5.2)."""

	def test_limits_above_the_ceiling_are_refused(self):
		for field, value in (
			("max_rows", HARD_MAX_ROWS + 1),
			("print_max_pages", HARD_PRINT_MAX_PAGES + 1),
			("margin_top", 61),
			("margin_end", 61),
		):
			settings = frappe.get_doc("Report View Global Settings")
			settings.set(field, value)
			with self.subTest(field=field), self.assertRaises(frappe.ValidationError):
				settings.validate()

	def test_limits_at_the_ceiling_are_kept(self):
		settings = frappe.get_doc("Report View Global Settings")
		settings.update(
			{"max_rows": HARD_MAX_ROWS, "print_max_pages": HARD_PRINT_MAX_PAGES, "margin_start": 60}
		)
		settings.validate()
