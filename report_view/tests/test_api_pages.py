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
		self.assertEqual(
			set(out),
			{
				"letter_heads",
				"default_letter_head",
				"print_formats",
				"print_format_types",
				"reports",
				"print_headings",
				"print_signatures",
				"languages",
				"lang",
				"defaults",
				"limits",
			},
		)
		self.assertGreater(out["limits"]["print_max_pages"], 0)
		self.assertEqual(set(out["print_format_types"]), set(out["print_formats"]))
		self.assertTrue(all(set(lh) == {"name", "is_default"} for lh in out["letter_heads"]))
		names = {lh["name"] for lh in out["letter_heads"]}
		self.assertTrue(out["default_letter_head"] is None or out["default_letter_head"] in names)
		self.assertTrue(all(lg["name"] in get_all_languages() for lg in out["languages"]))
		self.assertIn(out["lang"], get_all_languages())
		# the report's own formats, JS (rendered in the browser) or Jinja (on the server)
		for name in out["print_formats"]:
			doc = frappe.get_doc("Print Format", name)
			self.assertEqual((doc.print_format_for, doc.disabled), ("Report", 0))
			self.assertIn(doc.print_format_type, ("JS", "Jinja"))
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
		def labels(r):
			return [c["label"] if isinstance(c, dict) else str(c) for c in r["raw"]["columns"]]

		self.assertEqual(len(labels(arabic)), len(labels(english)))
		self.assertNotEqual(labels(arabic), labels(english))
		self.assertEqual(len(arabic["raw"]["result"]), len(english["raw"]["result"]))


class TestJinjaPrintFormat(RVTestCase):
	def test_jinja_and_js_formats_of_the_report_are_offered(self):
		with self.as_user("accountant"):
			options = api.get_print_options("Trial Balance", COMPANY)
		types = {n: frappe.db.get_value("Print Format", n, "print_format_type") for n in options["print_formats"]}
		self.assertTrue(set(types.values()) <= {"JS", "Jinja"})
		if "Jinja" not in types.values():
			self.skipTest("no Jinja report print format for Trial Balance on this site")

	def test_a_jinja_format_is_rendered_with_the_report_rows(self):
		from report_view.tests.utils import TB_FILTERS, TB_JS_FILTERS

		name = frappe.db.get_value(
			"Print Format",
			{"report": "Trial Balance", "print_format_type": "Jinja", "disabled": 0, "print_format_for": "Report"},
			"name",
		)
		if not name:
			self.skipTest("no Jinja report print format for Trial Balance on this site")
		meta = [{"fieldname": "company", "label": "Company", "fieldtype": "Link"}]
		with self.as_user("accountant"):
			out = api.render_print_format("Trial Balance", name, TB_FILTERS, TB_JS_FILTERS, meta)
			# a JS format is not rendered here
			js = frappe.db.get_value("Print Format", {"report": "Trial Balance", "print_format_type": "JS"}, "name")
			if js:
				with self.assertRaises(RVInvalidInput):
					api.render_print_format("Trial Balance", js, TB_FILTERS, TB_JS_FILTERS, meta)
		self.assertEqual(out["type"], "Jinja")
		self.assertIn("<table", out["html"])
		# the criteria and the report's rows are in it
		self.assertIn(TB_FILTERS["to_date"], out["html"])
		self.assertIn("1000", out["html"])
		with self.as_user("none"), self.assertRaises(frappe.PermissionError):
			api.render_print_format("Trial Balance", name, TB_FILTERS, TB_JS_FILTERS, meta)


class TestPrintHeadingAndSignature(RVTestCase):
	"""ADR-015: a Print Heading and a Print Signature rendered with the report's filters,
	behind the report and print permissions; the site's standard settings."""

	@classmethod
	def setUpClass(cls) -> None:
		super().setUpClass()
		cls.heading = frappe.get_doc(
			{
				"doctype": "Print Heading",
				"print_heading": "RV Test Heading {{ doc.company }}",
				"description": "Period {{ doc.from_date }} to {{ doc.to_date }}\n{{ filters.company.label }}: {{ filters.company.value }}",
			}
		).insert(ignore_if_duplicate=True)
		cls.sig_table = frappe.get_doc(
			{
				"doctype": "Print Signature",
				"signature_name": "RV Test Table",
				"signature_for": "Report",
				"content_type": "Table",
				"css": ".rv-sig-t{color:red}</style><script>x</script>",
				"signatories": [
					{"label": "Prepared by", "person_name": "<b>Sara</b>", "show_date": 1},
					{"label": "Approved by"},
				],
			}
		).insert()
		cls.sig_html = frappe.get_doc(
			{
				"doctype": "Print Signature",
				"signature_name": "RV Test HTML",
				"signature_for": "Report",
				"report": "Trial Balance",
				"content_type": "HTML",
				"html": "<p class='who'>{{ printed_by }} · {{ doc.company }} · {{ title }}</p>",
			}
		).insert()
		cls.sig_other = frappe.get_doc(
			{
				"doctype": "Print Signature",
				"signature_name": "RV Test Other Report",
				"signature_for": "Report",
				"report": "General Ledger",
				"content_type": "HTML",
				"html": "<p>gl</p>",
			}
		).insert()
		cls.sig_off = frappe.get_doc(
			{
				"doctype": "Print Signature",
				"signature_name": "RV Test Disabled",
				"disabled": 1,
				"content_type": "HTML",
				"html": "<p>off</p>",
			}
		).insert()
		cls.sig_doc = frappe.get_doc(
			{
				"doctype": "Print Signature",
				"signature_name": "RV Test Document",
				"signature_for": "Document",
				"reference_doctype": "Company",
				"content_type": "HTML",
				"html": "<p>{{ doc.name }}</p>",
			}
		).insert()

	def test_options_list_the_headings_and_the_signatures_of_the_report(self):
		with self.as_user("accountant"):
			out = api.get_print_options("Trial Balance", COMPANY)
		self.assertIn(self.heading.name, out["print_headings"])
		names = {s["name"] for s in out["print_signatures"]}
		# for every report, for this report; not another report's, a disabled one or a document's
		self.assertTrue({"RV Test Table", "RV Test HTML"} <= names)
		self.assertFalse({"RV Test Other Report", "RV Test Disabled", "RV Test Document"} & names)

	def test_a_heading_is_rendered_with_the_filters(self):
		from report_view.tests.utils import TB_FILTERS

		meta = [{"fieldname": "company", "label": "Company", "fieldtype": "Link"}]
		with self.as_user("accountant"):
			out = api.render_print_heading("Trial Balance", self.heading.name, TB_FILTERS, meta)
		self.assertEqual(out["title"], f"RV Test Heading {TB_FILTERS['company']}")
		# a plain text keeps its lines
		self.assertIn(f"Period {TB_FILTERS['from_date']} to {TB_FILTERS['to_date']}<br>", out["html"])
		self.assertIn(f"Company: {TB_FILTERS['company']}", out["html"])
		with self.as_user("none"), self.assertRaises(frappe.PermissionError):
			api.render_print_heading("Trial Balance", self.heading.name, TB_FILTERS, meta)
		with self.as_user("accountant"), self.assertRaises(frappe.DoesNotExistError):
			api.render_print_heading("Trial Balance", "No Such Heading", TB_FILTERS, meta)

	def test_a_table_signature_escapes_its_values_and_scopes_its_css(self):
		from report_view.tests.utils import TB_FILTERS

		with self.as_user("accountant"):
			out = api.render_print_signature("Trial Balance", "RV Test Table", TB_FILTERS)
		self.assertEqual(out["type"], "Table")
		self.assertEqual(out["html"].count('class="rv-sig"'), 2)
		self.assertIn("&lt;b&gt;Sara&lt;/b&gt;", out["html"])
		self.assertIn("repeat(2,", out["html"])
		# nested in .rv-signature, and it cannot close its <style>
		self.assertTrue(out["css"].startswith(".rv-signature{"))
		self.assertNotIn("</style", out["css"].lower())

	def test_an_html_signature_reads_the_report_context(self):
		from report_view.tests.utils import TB_FILTERS

		with self.as_user("accountant"):
			out = api.render_print_signature("Trial Balance", "RV Test HTML", TB_FILTERS)
			self.assertIn(TB_FILTERS["company"], out["html"])
			self.assertIn(frappe.utils.get_fullname(), out["html"])
			# another report's signature, a disabled one, a document's: not for this report
			for name in ("RV Test Other Report", "RV Test Disabled", "RV Test Document"):
				with self.assertRaises(frappe.DoesNotExistError):
					api.render_print_signature("Trial Balance", name, TB_FILTERS)
		with self.as_user("none"), self.assertRaises(frappe.PermissionError):
			api.render_print_signature("Trial Balance", "RV Test HTML", TB_FILTERS)

	def test_a_document_signature_in_a_print_format(self):
		from report_view.core.printing import report_view_signature

		company = frappe.get_doc("Company", COMPANY)
		html = report_view_signature("RV Test Document", company)
		self.assertIn(f"<p>{COMPANY}</p>", html)
		self.assertIn('class="rv-signature"', html)
		# not a document of its type, or a report's signature: nothing
		self.assertEqual(report_view_signature("RV Test Document", frappe.get_doc("Currency", "USD")), "")
		self.assertEqual(report_view_signature("RV Test HTML", company), "")

	def test_signature_validation(self):
		with self.assertRaises(frappe.ValidationError):
			frappe.get_doc({"doctype": "Print Signature", "signature_name": "RV Test Empty", "content_type": "Table"}).insert()
		with self.assertRaises(frappe.ValidationError):
			frappe.get_doc(
				{"doctype": "Print Signature", "signature_name": "RV Test Bad", "content_type": "HTML", "html": "{% if %}"}
			).insert()

	def test_the_site_standard_settings_and_limits(self):
		from report_view.core.settings import get_print_max_pages, get_row_limit, print_defaults

		gs = frappe.get_doc("Report View Global Settings")
		gs.update(
			{
				"max_rows": 1234,
				"print_max_pages": 77,
				"paper_size": "A3",
				"orientation": "Landscape page",
				"margins": "Custom",
				"margin_top": 20,
				"print_style": "Accounting grid",
				"print_heading": self.heading.name,
				"heading_pages": "Every page",
				"page_numbers": 0,
				"number_format": "1 / 3",
			}
		)
		gs.save()
		system = frappe.utils.cint(frappe.db.get_single_value("System Settings", "max_report_rows"))
		self.assertEqual(get_row_limit(), min(1234, system) if system > 0 else 1234)
		self.assertEqual(get_print_max_pages(), 77)
		d = print_defaults()
		self.assertEqual(
			(d["size"], d["orientation"], d["margins"], d["page_m"]["top"], d["style"], d["heading_pages"], d["page_numbers"], d["number_format"]),
			("A3", "landscape", "custom", 20, "ledger", "all", False, "short"),
		)
		with self.as_user("accountant"):
			out = api.get_print_options("Trial Balance", COMPANY)
		self.assertEqual(out["defaults"]["heading"], self.heading.name)
		self.assertEqual(out["limits"]["print_max_pages"], 77)
		# the hard caps
		gs.max_rows = 10**7
		with self.assertRaises(frappe.ValidationError):
			gs.save()


class TestShippedHeadingsAndSignatures(RVTestCase):
	"""The standard print headings and signatures (fixtures, ADR-015) render for a report
	in both languages; the document signature renders in a document's print format."""

	@classmethod
	def setUpClass(cls) -> None:
		import json
		import os

		from frappe.core.doctype.data_import.data_import import import_doc

		super().setUpClass()
		folder = os.path.join(frappe.get_app_path("report_view"), "fixtures")
		cls.shipped = {}
		for f in ("print_heading.json", "print_signature.json"):
			path = os.path.join(folder, f)
			import_doc(path)
			cls.shipped[f] = json.load(open(path, encoding="utf-8"))

	def render_all(self, lang):
		from report_view.tests.utils import TB_FILTERS

		meta = [{"fieldname": "company", "label": "Company", "fieldtype": "Link"}]
		out = {}
		with self.as_user("accountant"):
			frappe.local.lang = lang
			try:
				for d in self.shipped["print_heading.json"]:
					out[d["name"]] = api.render_print_heading("Trial Balance", d["name"], TB_FILTERS, meta)
				for d in self.shipped["print_signature.json"]:
					if d["signature_for"] == "Report":
						out[d["name"]] = api.render_print_signature("Trial Balance", d["name"], TB_FILTERS, meta)
			finally:
				frappe.local.lang = "en"
		return out

	def test_every_shipped_heading_and_signature_renders(self):
		from report_view.tests.utils import TB_FILTERS

		en = self.render_all("en")
		ar = self.render_all("ar")
		self.assertEqual(len(en), 5 + 9)
		for name, r in en.items():
			self.assertTrue(r["html"].strip() or r.get("title"), name)
			self.assertNotIn("{{", r["html"], name)
			self.assertNotIn("{#", r["html"], name)
		self.assertIn(TB_FILTERS["company"], en["Financial Statement"]["html"])
		self.assertIn("Company:", en["Account Statement"]["html"])
		# in Arabic: the names and the words of the templates are translated
		self.assertEqual(ar["Financial Statement"]["title"], "قائمة مالية")
		self.assertIn("سرّي", ar["Confidential Report"]["html"])
		self.assertIn("ختم الشركة", ar["Signature and Company Stamp"]["html"])
		self.assertIn("الصفة", ar["Signature Grid"]["html"])
		self.assertIn("راجعه", ar["Prepared, Reviewed, Approved"]["html"])
		self.assertIn("رئيس اللجنة", ar["Inventory Count Committee"]["html"])
		for r in en.values():
			if r.get("css"):
				self.assertTrue(r["css"].startswith(".rv-signature{"))

	def test_the_shipped_document_signature(self):
		from report_view.core.printing import report_view_signature

		doc = frappe.get_doc("Company", COMPANY)
		html = report_view_signature("Issued by and Received by", doc)
		self.assertIn("Received by", html)
		self.assertIn(frappe.utils.get_fullname(doc.owner), html)
		# every shipped document signature renders for a document, its rules scoped to it
		for name, words in {
			"Approval Steps": ["Prepared by", "Reviewed by", "Approved by"],
			"Accountant, Manager and Stamp": ["Company stamp", "Finance Manager"],
			"Receipt Acknowledgement": ["I acknowledge that I have received the above"],
		}.items():
			html = report_view_signature(name, doc)
			self.assertIn(".rv-signature{", html)
			for word in words:
				self.assertIn(word, html)
