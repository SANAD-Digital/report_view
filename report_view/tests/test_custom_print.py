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
			self.assertEqual(back, {"print_format": "RV Custom Test", "inline": False, "data": {"customer": "C1"}, "title": "T1", "options": {"letter_head": "LH", "signature": "S"}})
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

	# ------------------------------------------------------------ an inline template

	def _inline(self, html, data=None, css=None, **kw):
		return api.stage(html=html, css=css, data=json.dumps(data if data is not None else {}), **kw)["token"]

	def test_inline_template_render(self):
		html = (
			"<h2>{{ title }}</h2><p>{{ doc.customer }}</p><p>{{ company }}</p><p>{{ printed_by }}</p>"
			"{% for r in rows %}<i>{{ r.x }}</i>{% endfor %}<b>{{ _('Total') }}</b>"
			"<u>{{ format_value(1234.5, 'Currency', 'USD') }}</u><s>{{ format_value(doc.customer, 'Data') }}</s>"
			"{% for i in range(3) %}{{ i }}{% endfor %}<em>{{ doc.rows|length }}</em>"
		)
		data = {"customer": "A <b>", "company": "Co <c>", "rows": [{"x": "<script>x()</script>"}, {"x": 2}]}
		with self.as_user("accountant"):
			token = self._inline(html, data, css=".k{color:inherit}", title="Inl <t>", letter_head="LH")
			back = api.staged(token)
			self.assertEqual((back["print_format"], back["inline"], back["title"]), (None, True, "Inl <t>"))
			self.assertNotIn("html", back)
			out = api.render(token=token, lang="ar")
		self.assertEqual((out["name"], out["inline"], out["css"]), ("", True, ".rv-page-flow{.k{color:inherit}}"))
		h = out["html"]
		self.assertIn("<h2>Inl &lt;t&gt;</h2>", h)
		self.assertIn("<p>A &lt;b&gt;</p>", h)
		self.assertIn("<p>Co &lt;c&gt;</p>", h)
		self.assertNotIn("<script>", h)
		self.assertIn("<b>الإجمالي</b>", h)
		self.assertIn("1,234.50", h)
		self.assertIn("<s>A &lt;b&gt;</s>", h)
		self.assertIn("012", h)
		self.assertIn("<em>2</em>", h)

	def test_print_format_or_html_one_of_them(self):
		with self.as_user("accountant"):
			for kw in ({}, {"print_format": "RV Custom Test", "html": "<p>x</p>"}):
				with self.assertRaises(RVInvalidInput):
					api.stage(data="{}", **kw)
				with self.assertRaises(RVInvalidInput):
					cp.print_url(data={}, **kw)
			with self.assertRaises(RVInvalidInput):
				cp.print_url(html="<p>x</p>", method="a.b")
			url = cp.print_url(html="<p>{{ doc.a }}</p>", data={"a": "z"})
			self.assertIn("<p>z</p>", api.render(token=url.rsplit("/", 1)[1])["html"])
			with patch.object(cp, "MAX_INLINE_HTML", 10), self.assertRaises(RVInvalidInput):
				self._inline("<p>" + "x" * 20 + "</p>")
			with patch.object(cp, "MAX_INLINE_CSS", 10), self.assertRaises(RVInvalidInput):
				self._inline("<p>x</p>", css="a{}" * 10)
			# a broken template is told when it is sent
			with self.assertRaises(RVInvalidInput):
				self._inline("<p>{% if %}</p>")

	def test_the_sandbox_of_an_inline_template(self):
		blocked = (
			"{{ frappe.db.get_value('User', 'Administrator', 'api_key') }}",
			"{{ frappe.get_list('User') }}",
			"{{ ''.__class__ }}",
			"{{ (''|attr('\\x5f\\x5fclass\\x5f\\x5f')).__mro__ }}",
			"{{ ''|attr('__class__') }}",
			"{{ data|attr('__init__') }}",
			"{% include 'templates/print_formats/standard.html' %}",
			"{% import 'x.html' as y %}",
			"{% extends 'x.html' %}",
			"{{ lipsum() }}{{ cycler(1) }}",
			"{% for i in range(60000) %}{% endfor %}{% for i in range(60000) %}{% endfor %}",
			"{{ data.update({'a': 1}) }}",
			"{{ get_doc('User', 'Administrator') }}",
		)
		with self.as_user("accountant"):
			for html in blocked:
				with self.subTest(html=html):
					try:
						token = self._inline(html, {"a": 1})
					except RVInvalidInput:
						continue
					# refused, or an unsafe attribute is Undefined and prints nothing
					try:
						out = api.render(token=token)["html"]
					except RVInvalidInput:
						continue
					self.assertEqual(out, "")
			# what is not defined prints nothing (Jinja's Undefined), and leaks nothing
			token = self._inline("<p>{{ frappe }}|{{ db }}|{{ doc.nothing }}</p>")
			self.assertEqual(api.render(token=token)["html"], "<p>||</p>")

	def test_inline_token_is_its_users_only_and_a_saved_format_on_its_data(self):
		with self.as_user("accountant"):
			token = self._inline("<p>{{ doc.customer }}</p>", {"customer": "Mine", "rows": []})
			# the same data with a saved Custom format, and back
			self.assertIn("<p>Mine</p>", api.render("RV Custom Test", token=token)["html"])
			self.assertIn("<p>Mine</p>", api.render(token=token)["html"])
			opts = api.get_options(token=token)
			self.assertEqual((opts["print_format"], opts["inline"]), (None, True))
			self.assertIn("RV Custom Test", opts["print_formats"])
			self.assertTrue(opts["default_print_format"])
			self.assertEqual(api.get_translations(lang="ar", messages=json.dumps(["Total"]), token=token), {"Total": "الإجمالي"})
		with self.as_user("admin"):
			for call in (
				lambda: api.render(token=token),
				lambda: api.staged(token),
				lambda: api.get_options(token=token),
				lambda: pages_pdf_custom(token=token, html="<html></html>"),
			):
				with self.assertRaises(frappe.DoesNotExistError):
					call()
			with self.assertRaises(RVInvalidInput):
				api.render()

	def test_inline_needs_a_desk_user(self):
		# a user with no desk role is a Website User
		with self.as_user("none"), self.assertRaises(frappe.PermissionError):
			api.stage(html="<p>x</p>", data="{}")
		with self.as_user("accountant"), patch.object(cp.frappe, "get_cached_value", return_value="Website User"):
			with self.assertRaises(frappe.PermissionError):
				api.stage(html="<p>x</p>", data="{}")
		with self.set_user("Guest"), self.assertRaises(frappe.PermissionError):
			cp.guard_inline()

	def test_inline_heading_signature_letter_head_and_pdf(self):
		from report_view.tests.test_pdf import _pages_html

		heading = frappe.get_doc(
			{"doctype": "Print Heading", "print_heading": "RV Inline Heading", "description": "{{ title }}:{{ doc.customer }}"}
		).insert(ignore_if_duplicate=True)
		frappe.get_doc(
			{"doctype": "Print Signature", "signature_name": "RV Inline Sig", "signature_for": "Document", "content_type": "HTML", "html": "<p>{{ doc.customer }}</p>"}
		).insert()
		with self.as_user("accountant"):
			token = self._inline("<p>x</p>", {"customer": "Cu <1>"}, title="Ti")
			self.assertIn("Ti:Cu &lt;1&gt;", api.render_heading(heading=heading.name, token=token, title="Ti")["html"])
			self.assertIn("<p>Cu &lt;1&gt;</p>", api.render_signature(signature="RV Inline Sig", token=token)["html"])
			pages_pdf_custom(token=token, html=_pages_html())
			self.assertTrue(frappe.local.response.filecontent.startswith(b"%PDF"))
			self.assertEqual(frappe.local.response.filename, "Sent template.pdf")



class TestOpenIn(RVTestCase):
	"""Where report_view.print() opens a print by default: in the boot, from the settings."""

	def test_boot_default(self):
		from report_view.core import settings

		gs = frappe.get_single("Report View Global Settings")
		old = gs.custom_print_open_in
		try:
			for value, expected in (("Same tab", "same"), ("New tab", "tab")):
				gs.custom_print_open_in = value
				gs.save()
				frappe.clear_document_cache("Report View Global Settings", "Report View Global Settings")
				boot = frappe._dict()
				settings.boot_session(boot)
				self.assertEqual(boot.report_view, {"custom_print_open_in": expected})
		finally:
			gs.custom_print_open_in = old
			gs.save()
