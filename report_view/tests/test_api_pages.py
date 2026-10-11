"""The Pages view API (ADR-014): print options, a report print format and translations,
behind the report and print permissions like the rest of the API."""

import frappe
from frappe.translate import get_all_languages

from report_view import api
from report_view.core.errors import RVInvalidInput, RVNoPrint
from report_view.tests.utils import COMPANY, RVTestCase


class TestApiPages(RVTestCase):
	def test_print_options_for_a_user_who_may_print(self):
		with self.as_user("accountant"):
			out = api.get_print_options("Trial Balance", COMPANY)
		self.assertEqual(set(out), {"letter_heads", "default_letter_head", "print_formats", "languages", "lang"})
		self.assertTrue(all(set(lh) == {"name", "is_default"} for lh in out["letter_heads"]))
		names = {lh["name"] for lh in out["letter_heads"]}
		self.assertTrue(out["default_letter_head"] is None or out["default_letter_head"] in names)
		self.assertTrue(all(lg["name"] in get_all_languages() for lg in out["languages"]))
		self.assertIn(out["lang"], get_all_languages())
		# the query-report dialog lists JS formats of the report only
		for name in out["print_formats"]:
			doc = frappe.get_doc("Print Format", name)
			self.assertEqual((doc.print_format_for, doc.print_format_type, doc.disabled), ("Report", "JS", 0))
			self.assertEqual(doc.report, "Trial Balance")

	def test_print_options_need_the_report_and_print(self):
		with self.as_user("none"), self.assertRaises(frappe.PermissionError):
			api.get_print_options("Trial Balance")
		with self.as_user("accountant"), self.assertRaises(frappe.DoesNotExistError):
			api.get_print_options("No Such Report")

	def test_print_options_without_print_permission(self):
		"""A role with the report but without ``print`` on its doctype gets RVNoPrint."""
		with self.as_user("accountant"):
			with self.set_user(self.users["accountant"]):
				report = frappe.get_doc("Report", "Trial Balance")
		# Auditor may read GL Entry reports in ERPNext but has no print on GL Entry
		if frappe.has_permission(report.ref_doctype, "print", user=self.users["auditor"], ignore_share_permissions=True):
			self.skipTest("the auditor role may print GL Entry on this site")
		with self.as_user("auditor"):
			try:
				api.get_print_options("Trial Balance")
			except (RVNoPrint, frappe.PermissionError):
				return
		self.fail("get_print_options answered a user without the print permission")

	def test_print_format_is_read_for_its_report_only(self):
		with self.as_user("accountant"):
			options = api.get_print_options("Accounts Receivable", COMPANY)
			if not options["print_formats"]:
				self.skipTest("no report print format for Accounts Receivable on this site")
			name = options["print_formats"][0]
			out = api.get_print_format("Accounts Receivable", name)
			self.assertEqual(out["name"], name)
			self.assertTrue(out["html"])
			# the same format is not a format of another report
			with self.assertRaises(frappe.DoesNotExistError):
				api.get_print_format("Trial Balance", name)
			with self.assertRaises(RVInvalidInput):
				api.get_print_format("Trial Balance", "")

	def test_translations_of_an_enabled_language(self):
		with self.as_user("accountant"):
			out = api.get_translations("Trial Balance", "ar", ["Grand Total", "Page {0} of {1}", "no such message xyz"])
		self.assertEqual(out.get("Grand Total"), "الإجمالي العام")
		self.assertIn("Page {0} of {1}", out)
		self.assertNotIn("no such message xyz", out)
		# a JSON string of messages, as the request carries it
		with self.as_user("accountant"):
			again = api.get_translations("Trial Balance", "ar", frappe.as_json(["Grand Total"]))
		self.assertEqual(again, {"Grand Total": "الإجمالي العام"})

	def test_translations_refuse_a_disabled_language_and_bad_input(self):
		with self.as_user("accountant"):
			with self.assertRaises(RVInvalidInput):
				api.get_translations("Trial Balance", "xx-no-such", ["Total"])
			with self.assertRaises(RVInvalidInput):
				api.get_translations("Trial Balance", "ar", ["Total", 5])
			with self.assertRaises(RVInvalidInput):
				api.get_translations("Trial Balance", "ar", ["x"] * (api.MAX_TRANSLATION_MESSAGES + 1))
		with self.as_user("none"), self.assertRaises(frappe.PermissionError):
			api.get_translations("Trial Balance", "ar", ["Total"])

	def test_run_in_another_language_translates_the_labels(self):
		"""``_lang`` in the request: the report's labels come in that language (ADR-014)."""
		from report_view.tests.utils import TB_FILTERS, TB_JS_FILTERS

		with self.as_user("accountant"):
			frappe.local.lang = "ar"
			arabic = api.run("Trial Balance", TB_FILTERS, TB_JS_FILTERS)
			frappe.local.lang = "en"
			english = api.run("Trial Balance", TB_FILTERS, TB_JS_FILTERS)
		labels = lambda r: [c["label"] if isinstance(c, dict) else str(c) for c in r["raw"]["columns"]]
		self.assertEqual(len(labels(arabic)), len(labels(english)))
		self.assertNotEqual(labels(arabic), labels(english))
		self.assertEqual(len(arabic["raw"]["result"]), len(english["raw"]["result"]))
