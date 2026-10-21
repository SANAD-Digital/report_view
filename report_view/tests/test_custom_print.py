"""The "Custom" print source (ADR-019): a Custom print format rendered with the caller's
data, behind the format's own check; a staged print is its user's only."""

import json
import os
from unittest.mock import patch

import frappe

from report_view.api import custom_print as api
from report_view.api.pdf import pages_pdf_custom
from report_view.core import custom_print as cp
from report_view.core.errors import RVInvalidInput
from report_view.tests.utils import COMPANY, RVTestCase

FIXTURES = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures")
TABLE = "Report View Table"


def _fixture(name: str) -> list[dict]:
	with open(os.path.join(FIXTURES, name), encoding="utf-8") as f:
		return json.load(f)


def _custom_format(name: str, html: str, css: str = "", **extra):
	doc = frappe.get_doc(
		{"doctype": "Print Format", "name": name, "print_format_for": "Custom", "html": html, "css": css, **extra}
	)
	cp.before_validate_print_format(doc)
	return doc.insert()


class TestCustomPrint(RVTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		# the options of print_format_for and the shipped table format, as the fixtures
		# install them (bench import-doc); here inside the test's transaction
		meta = frappe.get_meta("Print Format")
		if "Custom" not in (meta.get_field("print_format_for").options or "").split("\n"):
			ps = _fixture("property_setter.json")[0]
			frappe.make_property_setter(
				{
					"doctype": "Print Format",
					"doctype_or_field": "DocField",
					"fieldname": ps["field_name"],
					"property": ps["property"],
					"value": ps["value"],
					"property_type": ps["property_type"],
				}
			)
			frappe.clear_cache(doctype="Print Format")
		if not frappe.db.exists("Print Format", TABLE):
			table = _fixture("print_format.json")[0]
			doc = frappe.get_doc({k: v for k, v in table.items() if k not in ("modified",)})
			cp.before_validate_print_format(doc)
			doc.insert()
		cls.fmt = _custom_format(
			"RV Custom Test",
			"<h1>{{ title }}</h1><p>{{ doc.customer }}</p><p>{{ company }}</p>"
			"{% for r in doc.rows or [] %}<i>{{ r.x }}</i>{% endfor %}<em>{{ _('Total') }}</em>",
			css=".rvx{color:inherit}",
		)
		cls.disabled = _custom_format("RV Custom Disabled", "<p>x</p>", disabled=1)
		cls.doc_format = frappe.get_doc(
			{"doctype": "Print Format", "name": "RV Not Custom", "doc_type": "Company", "custom_format": 1, "print_format_type": "Jinja", "html": "<p>x</p>"}
		).insert()

	# ------------------------------------------------------------ the Print Format

	def test_a_custom_format_is_a_jinja_template_of_no_doctype(self):
		doc = frappe.get_doc(
			{"doctype": "Print Format", "name": "RV Custom Shape", "print_format_for": "Custom", "print_format_type": "JS", "doc_type": "Company", "standard": "Yes", "html": "<p>{{ data }}</p>"}
		)
		cp.before_validate_print_format(doc)
		self.assertEqual((doc.custom_format, doc.standard, doc.print_format_type, doc.doc_type, doc.report), (1, "No", "Jinja", None, None))
		doc.insert()
		# Frappe's validate then asks for the HTML
		empty = frappe.get_doc({"doctype": "Print Format", "name": "RV Custom Empty", "print_format_for": "Custom"})
		cp.before_validate_print_format(empty)
		with self.assertRaises(frappe.MandatoryError):
			empty.insert()
		# other formats are left as they are
		other = frappe.get_doc({"doctype": "Print Format", "print_format_for": "DocType", "doc_type": "Company", "standard": "No"})
		cp.before_validate_print_format(other)
		self.assertEqual((bool(other.custom_format), other.doc_type), (False, "Company"))

	def test_the_fixtures(self):
		ps = _fixture("property_setter.json")
		self.assertEqual(ps[0]["value"].split("\n"), ["DocType", "Report", "Custom"])
		pf = _fixture("print_format.json")[0]
		self.assertEqual((pf["name"], pf["print_format_for"], pf["print_format_type"], pf["custom_format"]), (TABLE, "Custom", "Jinja", 1))

	def test_formats_lists_enabled_custom_formats_only(self):
		with self.as_user("accountant"):
			names = api.formats()
		self.assertIn("RV Custom Test", names)
		self.assertIn(TABLE, names)
		self.assertNotIn("RV Custom Disabled", names)
		self.assertNotIn("RV Not Custom", names)

	# ------------------------------------------------------------ the guard

	def test_the_format_must_be_an_enabled_custom_one(self):
		with self.as_user("accountant"):
			for name in ("RV Custom Disabled", "RV Not Custom", "No Such Format"):
				with self.assertRaises(frappe.DoesNotExistError):
					api.render(name, data={})
			with self.assertRaises(RVInvalidInput):
				api.render("", data={})

	def test_select_on_print_format_is_required(self):
		with self.as_user("accountant"), patch.object(cp.frappe, "has_permission", return_value=False):
			for call in (
				lambda: api.render("RV Custom Test", data={}),
				lambda: api.stage("RV Custom Test", data={"a": 1}),
				lambda: api.get_options("RV Custom Test"),
				lambda: pages_pdf_custom("RV Custom Test", "<html></html>"),
			):
				with self.assertRaises(frappe.PermissionError):
					call()
			self.assertEqual(api.formats(), [])

	# ------------------------------------------------------------ rendering

	def test_render_with_data(self):
		data = {"customer": "Acme <b>", "rows": [{"x": 1}, {"x": "<script>alert(1)</script>"}], "company": COMPANY}
		with self.as_user("accountant"):
			out = api.render("RV Custom Test", data=json.dumps(data), title="Sales <i>")
		self.assertEqual((out["name"], out["type"], out["css"]), ("RV Custom Test", "Jinja", ".rv-page-flow{.rvx{color:inherit}}"))
		self.assertIn("<h1>Sales &lt;i&gt;</h1>", out["html"])
		self.assertIn("<p>Acme &lt;b&gt;</p>", out["html"])
		self.assertIn(f"<p>{COMPANY}</p>", out["html"])
		self.assertIn("<i>1</i>", out["html"])
		self.assertNotIn("<script>", out["html"])
		self.assertEqual(out["title"], "Sales <i>")

	def test_the_css_is_scoped_to_the_content(self):
		css = "@import url(/x.css);@font-face{font-family:F;src:url(/f.ttf)}@page{size:A4}\n.a{color:red}</style><script>"
		self.assertEqual(
			cp.scoped_css(css),
			"@import url(/x.css);@font-face{font-family:F;src:url(/f.ttf)}.rv-page-flow{.a{color:red}><script>}",
		)
		self.assertEqual(cp.scoped_css(""), "")
		self.assertEqual(cp.scoped_css("@page{margin:0}"), "")

	def test_context(self):
		with self.as_user("accountant"):
			ctx = cp.context(self.fmt, [{"a": "x"}], None)
			self.assertEqual(ctx["rows"], [{"a": "x"}])
			self.assertEqual(ctx["doc"], {})
			self.assertEqual(ctx["title"], "RV Custom Test")
			self.assertTrue(ctx["printed_by"])
			self.assertTrue(ctx["company"])
			ctx = cp.context(self.fmt, {"rows": [1], "company": "X"}, "T")
			self.assertEqual((ctx["rows"], ctx["doc"].company, ctx["company"], ctx["title"]), ([1], "X", "X", "T"))

	def test_render_in_another_language(self):
		with self.as_user("accountant"):
			out = api.render("RV Custom Test", data={}, lang="ar")
			self.assertIn("<em>الإجمالي</em>", out["html"])
			self.assertNotEqual(frappe.local.lang, "xx")
			with self.assertRaises(RVInvalidInput):
				api.render("RV Custom Test", data={}, lang="xx-not")

	def test_the_data_must_be_json_of_at_most_5_mb(self):
		with self.as_user("accountant"):
			for bad in ("{oops", "12", '"text"'):
				with self.assertRaises(RVInvalidInput):
					api.render("RV Custom Test", data=bad)
			with patch.object(cp, "MAX_DATA_BYTES", 100):
				with self.assertRaises(RVInvalidInput):
					api.render("RV Custom Test", data={"x": "y" * 200})
				with self.assertRaises(RVInvalidInput):
					api.stage("RV Custom Test", data=json.dumps({"x": "y" * 200}))
			# no data is an empty object
			self.assertIn("<h1>RV Custom Test</h1>", api.render("RV Custom Test")["html"])

	def test_a_broken_template_is_a_translated_message_and_an_error_log(self):
		broken = _custom_format("RV Custom Broken", "<p>{{ doc.x.y.z() }}</p>")
		frappe.db.set_value("Print Format", broken.name, "html", "<p>\n{{ 1/0 }}</p>")
		frappe.clear_document_cache("Print Format", broken.name)
		before = frappe.db.count("Error Log")
		with self.as_user("accountant"):
			with patch.dict(frappe.conf, {"developer_mode": 0}), self.assertRaises(RVInvalidInput) as e:
				api.render(broken.name, data={})
			self.assertNotIn("ZeroDivisionError", str(e.exception))
			with patch.dict(frappe.conf, {"developer_mode": 1}), self.assertRaises(RVInvalidInput) as e:
				api.render(broken.name, data={})
			self.assertIn("ZeroDivisionError", str(e.exception))
			self.assertIn("2", str(e.exception))
		self.assertGreater(frappe.db.count("Error Log"), before)
		frappe.db.set_value("Print Format", broken.name, "html", "<p>{% if %}</p>")
		frappe.clear_document_cache("Print Format", broken.name)
		with self.as_user("accountant"), patch.dict(frappe.conf, {"developer_mode": 1}), self.assertRaises(RVInvalidInput) as e:
			api.render(broken.name, data={})
		self.assertIn("TemplateSyntaxError", str(e.exception))

	def test_the_table_format(self):
		data = {
			"columns": [
				{"label": "Item", "fieldname": "item", "fieldtype": "Data"},
				{"label": "Qty", "fieldname": "qty", "fieldtype": "Int"},
				{"label": "Amount", "fieldname": "amount", "fieldtype": "Currency"},
			],
			"rows": [{"item": "A <b>", "qty": 2, "amount": 10.5}, ["B", 3, 20]],
			"totals": True,
			"subtitle": "Sub <x>",
		}
		with self.as_user("accountant"):
			html = api.render(TABLE, data=data, title="Items")["html"]
			self.assertIn('<table class="rvt">', html)
			self.assertIn(">Item</th>", html)
			self.assertIn("A &lt;b&gt;", html)
			self.assertNotIn("A <b>", html)
			self.assertIn("Sub &lt;x&gt;", html)
			self.assertEqual(html.count("<tr>"), 4)
			self.assertIn("<tfoot>", html)
			self.assertIn(">5</td>", html)
			self.assertIn(frappe.format(30.5, {"fieldtype": "Currency"}), html)
			# the totals as given
			html = api.render(TABLE, data={**data, "totals": {"qty": 99}})["html"]
			self.assertIn(">99</td>", html)
			# no rows, no columns
			self.assertIn("rvt-none", api.render(TABLE, data={"columns": data["columns"], "rows": []})["html"])
			self.assertIn("rvt-empty", api.render(TABLE, data={})["html"])

	# ------------------------------------------------------------ staging

	def test_stage_and_read_back_by_its_user_only(self):
		with self.as_user("accountant"):
			out = api.stage("RV Custom Test", data=json.dumps({"customer": "C1"}), title="T1", letter_head="LH", heading="", signature="S")
			self.assertEqual(out["route"], f"/desk/rv-print/Custom/{out['token']}")
			back = api.staged(out["token"])
			self.assertEqual(back, {"print_format": "RV Custom Test", "data": {"customer": "C1"}, "title": "T1", "options": {"letter_head": "LH", "signature": "S"}})
			# rendered by its token (with any Custom format)
			self.assertIn("<p>C1</p>", api.render("RV Custom Test", token=out["token"])["html"])
			self.assertIn("rvt-empty", api.render(TABLE, token=out["token"])["html"])
			with self.assertRaises(RVInvalidInput):
				api.staged("../../x")
			with self.assertRaises(frappe.DoesNotExistError):
				api.staged("0" * 24)
			with self.assertRaises(RVInvalidInput):
				api.stage("RV Custom Test", data="")
		with self.as_user("admin"):
			with self.assertRaises(frappe.DoesNotExistError):
				api.staged(out["token"])
			with self.assertRaises(frappe.DoesNotExistError):
				api.render("RV Custom Test", token=out["token"])

	def test_print_url(self):
		with self.as_user("accountant"):
			url = cp.print_url("RV Custom Test", data={"customer": "C2"}, title="T")
			token = url.rsplit("/", 1)[1]
			self.assertEqual(api.staged(token)["data"], {"customer": "C2"})
			url = cp.print_url("RV Custom Test", method="my_app.api.rows", args={"a": "b c"}, title="T", letter_head="L")
			self.assertEqual(
				url,
				"/desk/rv-print/Custom/RV%20Custom%20Test?method=my_app.api.rows&args=%7B%22a%22%3A%22b%20c%22%7D&title=T&letter_head=L",
			)
			self.assertTrue(cp.print_url(TABLE, method="a.b", absolute=True).startswith("http"))
			for bad in ({"method": "rm -rf"}, {"method": "nodots"}, {}):
				with self.assertRaises(RVInvalidInput):
					cp.print_url("RV Custom Test", **bad)

	# ------------------------------------------------------------ around the format

	def test_options(self):
		with self.as_user("accountant"):
			out = api.get_options("RV Custom Test")
		self.assertEqual((out["print_format"], out["default_print_format"]), ("RV Custom Test", "RV Custom Test"))
		self.assertIn(TABLE, out["print_formats"])
		self.assertEqual(out["print_format_types"][TABLE], "Jinja")
		for s in out["print_signatures"]:
			sig = frappe.db.get_value("Print Signature", s["name"], ["signature_for", "reference_doctype"], as_dict=True)
			self.assertEqual((sig.signature_for, sig.reference_doctype or None), ("Document", None))
		self.assertIn("print_max_pages", out["limits"])
		self.assertTrue(out["company"])

	def test_heading_signature_letter_head_and_translations(self):
		heading = frappe.get_doc(
			{"doctype": "Print Heading", "print_heading": "RV Custom Heading", "description": "{{ title }} / {{ doc.customer }}"}
		).insert(ignore_if_duplicate=True)
		frappe.get_doc(
			{"doctype": "Print Signature", "signature_name": "RV Custom Sig", "signature_for": "Document", "content_type": "HTML", "html": "<p>{{ doc.customer }}</p>"}
		).insert()
		frappe.get_doc(
			{"doctype": "Print Signature", "signature_name": "RV Custom Sig JE", "signature_for": "Document", "reference_doctype": "Journal Entry", "content_type": "HTML", "html": "<p>x</p>"}
		).insert()
		lh = frappe.get_doc({"doctype": "Letter Head", "letter_head_name": "RV Custom LH", "source": "HTML", "content": "<b>{{ doc.company }}</b>", "footer": "<i>f</i>"}).insert()
		data = json.dumps({"customer": "Cu <1>"})
		with self.as_user("accountant"):
			h = api.render_heading("RV Custom Test", heading.name, data=data, title="Ti")
			self.assertIn("Ti / Cu &lt;1&gt;", h["html"])
			s = api.render_signature("RV Custom Test", "RV Custom Sig", data=data)
			self.assertIn("<p>Cu &lt;1&gt;</p>", s["html"])
			with self.assertRaises(frappe.DoesNotExistError):
				api.render_signature("RV Custom Test", "RV Custom Sig JE", data=data)
			names = [x["name"] for x in api.get_options("RV Custom Test")["print_signatures"]]
			self.assertIn("RV Custom Sig", names)
			self.assertNotIn("RV Custom Sig JE", names)
			out = api.render_letterhead("RV Custom Test", lh.name, company="Co <x>")
			self.assertEqual(out, {"header": "<b>Co &lt;x&gt;</b>", "footer": "<i>f</i>"})
			self.assertEqual(api.get_translations("RV Custom Test", "ar", json.dumps(["Total"])), {"Total": "الإجمالي"})
			with self.assertRaises(RVInvalidInput):
				api.get_translations("RV Custom Test", "xx-not", ["Total"])

	def test_pdf(self):
		from report_view.tests.test_pdf import _pages_html

		with self.as_user("accountant"):
			with self.assertRaises(frappe.DoesNotExistError):
				pages_pdf_custom("RV Not Custom", _pages_html())
			pages_pdf_custom("RV Custom Test", _pages_html())
			self.assertEqual(frappe.local.response.filename, "RV Custom Test.pdf")
			self.assertTrue(frappe.local.response.filecontent.startswith(b"%PDF"))
