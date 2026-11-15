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

	def test_what_opens_first_reaches_desk_through_its_boot(self):
		"""«A report opens in» and «A document's Print opens in» as routes in Desk's boot
		(report_view_entry.bundle.js reads them); «System page» is Frappe's own (""). Saving
		the settings drops every user's cached boot, so the choice reaches them at the next load."""
		from report_view.core.settings import boot_session

		def boot():
			frappe.clear_document_cache("Report View Global Settings")
			info = frappe._dict()
			boot_session(info)
			return info.report_view

		# whatever the site chose: the test sets each value itself (rolled back after it)
		frappe.db.set_single_value("Report View Global Settings", "default_report_view", "System page")
		frappe.db.set_single_value("Report View Global Settings", "default_print_view", "System page")
		self.assertEqual(
			{k: boot()[k] for k in ("report_route", "print_route")}, {"report_route": "", "print_route": ""}
		)
		for label, route in (
			("Standard design", "report-view"),
			("Design A", "report-view-a"),
			("Design C", "report-view-c"),
		):
			frappe.db.set_single_value("Report View Global Settings", "default_report_view", label)
			self.assertEqual(boot()["report_route"], route, label)
		frappe.db.set_single_value("Report View Global Settings", "default_print_view", "Advanced Print")
		self.assertEqual(boot()["print_route"], "rv-print")
		frappe.cache.hset("bootinfo", "someone@rv.test", {"x": 1})
		settings = frappe.get_doc("Report View Global Settings")
		settings.default_report_view = "System page"
		settings.save(ignore_permissions=True)
		self.assertIsNone(frappe.cache.hget("bootinfo", "someone@rv.test"))
		self.assertEqual(boot()["report_route"], "")
