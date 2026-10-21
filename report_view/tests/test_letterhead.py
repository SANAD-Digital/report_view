"""The Letter Head builder (ADR-018): the layout's validation, the generated HTML (its
contract and its escaping), and the API (save flow, hand edits, permissions, preview)."""

import copy
import json
import os
import re

import frappe
from frappe.utils.print_format import render_letterhead_for_print

from report_view.api import letterhead as api
from report_view.core import fonts
from report_view.core import letterhead as lh
from report_view.core.errors import RVInvalidInput
from report_view.tests.utils import COMPANY, OTHER_COMPANY, RVTestCase

LAYOUT = {
	"v": 1,
	"font": "IBM Plex Sans Arabic",
	"colors": {"primary": "#1E5C45", "text": "#17211C", "muted": "#5B6660"},
	"header": {
		"h": 35,
		"pad_top": 6,
		"slots": {"right": 34, "center": 26, "left": 34},
		"elements": [
			{"id": "r1", "type": "field", "slot": "right", "style": {"size": 14, "weight": 700, "color": "primary"}, "props": {"token": "company_name_ar"}},
			{"id": "r2", "type": "field", "slot": "right", "props": {"token": "tax_id", "label": "الرقم الضريبي:"}},
			{"id": "c1", "type": "logo", "slot": "center", "w": 40, "h": 20},
			{"id": "l1", "type": "field", "slot": "left", "props": {"token": "company_name"}},
			{"id": "l2", "type": "field", "slot": "left", "props": {"token": "phone_no", "label": "Tel:"}},
			{"id": "l3", "type": "field", "slot": "left", "props": {"token": "address"}},
			{"id": "t1", "type": "text", "slot": "left", "props": {"text": "Est. 1990\nAden", "dir": "ltr"}},
			{"id": "f1", "type": "line", "slot": None, "x": 9, "y": 33, "w": 162, "props": {"thick": 0.6}, "style": {"color": "primary"}},
			{"id": "q1", "type": "qr", "slot": None, "x": 0, "y": 2, "w": 15, "h": 15, "props": {"source": "text", "text": "https://example.com"}},
		],
	},
	"footer": {
		"h": 15,
		"pad_top": 3,
		"slots": {"right": 40, "center": 20, "left": 40},
		"elements": [
			{"id": "p1", "type": "page", "slot": "center", "props": {"format": "both"}},
			{"id": "b1", "type": "band", "slot": None, "x": 0, "y": 13, "w": 180, "h": 2, "props": {"fill": "#AA0000"}},
		],
	},
}


def layout(**changes):
	out = copy.deepcopy(LAYOUT)
	out.update(changes)
	return out


def with_element(el, band="header"):
	out = copy.deepcopy(LAYOUT)
	out[band]["elements"].append(el)
	return out


def company_value(field):
	return frappe.db.get_value("Company", COMPANY, field)


class TestLayoutValidation(RVTestCase):
	def test_a_layout_is_returned_clean_with_defaults(self):
		clean = lh.validate_layout({"v": 1, "header": {"elements": [{"id": "a", "type": "text", "slot": "right", "props": {"text": "x"}}]}})
		self.assertEqual(clean["font"], "IBM Plex Sans Arabic")
		self.assertEqual(clean["colors"], lh.DEFAULT_COLORS)
		self.assertEqual((clean["header"]["h"], clean["footer"]["h"]), (35, 15))
		el = clean["header"]["elements"][0]
		self.assertEqual(el["style"], {"size": 9, "weight": 400, "color": "text", "align": "start", "gap": 1})
		self.assertEqual(el["props"], {"text": "x", "dir": "auto"})
		self.assertEqual(lh.validate_layout(LAYOUT)["colors"]["primary"], "#1E5C45")

	def test_numbers_are_clamped(self):
		raw = layout()
		raw["header"].update(h=200, pad_top=-3, slots={"right": 90, "center": 0, "left": 0})
		raw["footer"]["h"] = -5
		raw["header"]["elements"][0]["style"]["size"] = 100
		raw["header"]["elements"][7]["props"]["thick"] = 9
		clean = lh.validate_layout(raw)
		self.assertEqual((clean["header"]["h"], clean["header"]["pad_top"], clean["footer"]["h"]), (80, 0, 0))
		self.assertEqual(clean["header"]["slots"]["right"], 70)
		self.assertEqual(clean["header"]["elements"][0]["style"]["size"], 40)
		self.assertEqual(clean["header"]["elements"][7]["props"]["thick"], 3)
		# no footer at all
		self.assertEqual(lh.generate(clean)["footer"], "")

	def test_invalid_layouts_are_refused(self):
		too_many = layout()
		too_many["header"]["elements"] = [{"id": f"e{i}", "type": "text", "slot": "left"} for i in range(61)]
		wide = layout()
		wide["header"]["slots"] = {"right": 60, "center": 30, "left": 30}
		bad = [
			layout(v=2),
			layout(font="Comic Sans"),
			layout(extra=1),
			layout(colors={"primary": "red"}),
			layout(colors={"accent": "#000000"}),
			too_many,
			wide,
			with_element({"id": "x1", "type": "script", "slot": "left"}),
			with_element({"id": "x1", "type": "field", "slot": "left", "props": {"token": "owner"}}),
			with_element({"id": "x1", "type": "field", "slot": "left", "props": {"token": "email", "html": "<b>"}}),
			with_element({"id": "x1", "type": "text", "slot": "left", "onclick": "x"}),
			with_element({"id": "X-1", "type": "text", "slot": "left"}),
			with_element({"id": "r1", "type": "text", "slot": "left"}),
			with_element({"id": "x1", "type": "text", "slot": "top"}),
			with_element({"id": "x1", "type": "text", "slot": "left", "style": {"color": "javascript:x"}}),
			with_element({"id": "x1", "type": "text", "slot": "left", "style": {"font": "x"}}),
			with_element({"id": "x1", "type": "text", "slot": "left", "props": {"text": "x" * 501}}),
			with_element({"id": "x1", "type": "field", "slot": "left", "props": {"token": "email", "label": "x" * 61}}),
			with_element({"id": "x1", "type": "qr", "slot": "left", "props": {"source": "text", "text": "x" * 301}}),
			with_element({"id": "x1", "type": "text", "slot": "left", "x": "10"}),
			with_element({"id": "x1", "type": "image", "slot": "left", "props": {"src": "/private/files/logo.png"}}),
			with_element({"id": "x1", "type": "image", "slot": "left", "props": {"src": "https://evil.example/x.png"}}),
			with_element({"id": "x1", "type": "image", "slot": "left", "props": {"src": "/files/../private/files/x.png"}}),
			with_element({"id": "x1", "type": "image", "slot": "left", "props": {"src": "/files/x.png\" onerror=\"alert(1)"}}),
			with_element({"id": "x1", "type": "image", "slot": "left", "props": {"src": "/files/x.png');background:url('//evil"}}),
		]
		for raw in bad:
			with self.subTest(raw=json.dumps(raw)[-120:]), self.assertRaises(RVInvalidInput):
				lh.validate_layout(raw)

	def test_the_layout_size_is_capped(self):
		big = layout()
		big["header"]["elements"][6]["props"]["text"] = "x" * 400
		text = json.dumps(big) + " " * (lh.MAX_LAYOUT_BYTES)
		with self.assertRaises(RVInvalidInput):
			lh.parse_layout(text)
		self.assertEqual(lh.parse_layout(json.dumps(LAYOUT))["v"], 1)


class TestGeneratedHtml(RVTestCase):
	def test_the_html_contract(self):
		html = lh.generate(lh.validate_layout(LAYOUT))
		header, footer = html["header"], html["footer"]
		self.assertTrue(header.startswith("<!-- rv-lh v1 header h=35 -->"))
		self.assertIn('data-rv-lh="header" data-h="35" dir="ltr"', header)
		self.assertIn("height:35mm;overflow:hidden", header)
		self.assertIn('data-rv-lh="footer" data-h="15"', footer)
		for part in (header, footer):
			# the one <style> holds the @font-face of the layout's font (its files are the app's)
			self.assertEqual(part.count("<style>"), 1)
			self.assertIn(lh.FONT_INHERIT + "</style>", part)
			low = re.sub(r"<style>(@font-face\{[^<]*?\})*" + re.escape(lh.FONT_INHERIT) + "</style>", "", part).lower()
			self.assertNotIn("<style", low)
			for banned in ("<script", "grid", "flex", "var(", "transform", "report_view", "javascript:"):
				self.assertNotIn(banned, low)
		# slots: absolute, percent widths, their own direction
		self.assertIn('data-slot="right" dir="rtl" style="position:absolute;top:6mm;right:0;width:34%;padding:0 1mm;box-sizing:border-box;text-align:right"', header)
		self.assertIn('data-slot="left" dir="ltr" style="position:absolute;top:6mm;left:0;width:34%', header)
		self.assertIn("left:50%;margin-left:-13%;width:26%", header)
		# free elements: x and w in % of the 180mm reference, y in mm
		self.assertIn("left:5%;top:33mm;width:90%", header)
		self.assertIn("border-top:0.6mm solid #1E5C45", header)
		self.assertIn("<svg", header)
		# numbers in bdi, every value escaped
		self.assertIn('<bdi dir="ltr">{{ _v|e }}</bdi>', header)
		values = re.findall(r"\{\{(.*?)\}\}", header)
		self.assertTrue(values)
		self.assertTrue(all(v.strip().endswith("|e") for v in values), values)
		# page numbers as Frappe names them
		self.assertIn('<span class="page"></span>', footer)
		self.assertIn('<span class="topage"></span>', footer)
		self.assertIn("background-color:#AA0000", footer)
		# only core globals resolve the company
		self.assertIn('frappe.db.get_single_value("Global Defaults", "default_company")', header)
		self.assertIn("doc.company if doc is defined", header)

	def test_the_font_registry(self):
		reg = fonts.registry()
		names = [e["family"] for e in reg]
		self.assertEqual(len(names), len(set(names)))
		self.assertGreaterEqual(len(names), 40)
		self.assertEqual(lh.FONTS, tuple(names))
		for family in ("IBM Plex Sans Arabic", "DejaVu Sans", "Cairo", "Amiri", "Nazli", "FreeFarsi", "Inter"):
			self.assertIn(family, names)
		for banned in ("B Nazanin", "B Titr", "DecoType Naskh Variants", "PT Bold Heading", "Iranian Sans"):
			self.assertNotIn(banned, names)
		for e in reg:
			self.assertIn(e["category"], fonts.CATEGORIES)
			self.assertTrue(e["licence"] and e["source"])
			faces = list(fonts.font_files(e))
			self.assertEqual(bool(faces), not e.get("system"), e["family"])
			for _style, _weight, files in faces:
				self.assertIn("ttf", files, e["family"])
				for rel in files.values():
					path = os.path.join(fonts.FONTS_DIR, rel)
					self.assertTrue(os.path.isfile(path), rel)
					self.assertGreater(os.path.getsize(path), 1000, rel)

	def test_an_unknown_font_is_refused(self):
		for bad in ("Comic Sans", "B Nazanin", "cairo", "Cairo'", 12):
			with self.assertRaises(RVInvalidInput):
				lh.validate_layout(layout(font=bad))
		self.assertEqual(lh.validate_layout(layout(font="Amiri"))["font"], "Amiri")

	def test_the_letter_head_carries_the_faces_of_its_font_only(self):
		html = lh.generate(lh.validate_layout(layout(font="Cairo")))
		base = frappe.utils.get_url("/assets/report_view/fonts/")
		self.assertTrue(base.startswith(("http://", "https://")))
		for part in html.values():
			self.assertEqual(part.count("<style>"), 1)
			self.assertIn("font-family:'Cairo',sans-serif", part)
			out = frappe.render_template(part, {"doc": {"company": COMPANY}})
			families = set(re.findall(r"@font-face\{font-family:'([^']+)'", out))
			self.assertEqual(families, {"Cairo"})
			# the weights the layout uses (400, 700): no 500 beside 400, wkhtmltopdf would print
			# every regular text with it
			self.assertEqual(re.findall(r"font-weight:(\d+)", out.split("</style>")[0]), ["400", "700"])
			urls = re.findall(r"url\('([^']+)'\)", out)
			self.assertEqual(len(urls), 4)
			self.assertTrue(all(u.startswith(base + "cairo/cairo-") for u in urls), urls)
			self.assertLess(out.index("format('woff2')"), out.index("format('truetype')"))
		# a font that may not be changed ships as TrueType only; a font of the server has no face
		roya = frappe.render_template(lh.generate(lh.validate_layout(layout(font="Roya")))["header"], {"doc": {}})
		self.assertNotIn("woff2", roya)
		self.assertIn(base + "roya/roya-400.ttf", roya)
		self.assertIn("font-family:'Amiri',serif", lh.generate(lh.validate_layout(layout(font="Amiri")))["header"])
		dejavu = lh.generate(lh.validate_layout(layout(font="DejaVu Sans")))["header"]
		self.assertIn(f"<style>{lh.FONT_INHERIT}</style>", dejavu)
		self.assertNotIn("@font-face", dejavu)

	def test_the_print_weights(self):
		self.assertEqual(fonts.print_weights("Cairo", {400, 500, 700}), [400, 700])
		self.assertEqual(fonts.print_weights("Cairo", {500}), [500])
		self.assertEqual(fonts.print_weights("Cairo", {400, 600}), [400, 600])
		self.assertEqual(fonts.print_weights("Amiri", {400, 600}), [400, 700])
		self.assertEqual(fonts.print_weights("Titr", {400}), [700])
		self.assertEqual(fonts.print_weights("Lalezar", {700}), [400])
		self.assertEqual(fonts.print_weights("DejaVu Sans", {400}), [])

	def test_text_and_labels_are_escaped_and_never_jinja(self):
		raw = with_element(
			{"id": "x1", "type": "text", "slot": "left", "props": {"text": "<script>alert(1)</script> {{ 7*7 }} {% if 1 %}IF{% endif %} {# c #} a.__class__"}}
		)
		raw["header"]["elements"].append(
			{"id": "x2", "type": "field", "slot": "left", "props": {"token": "company_name", "label": "{{ frappe.session.user }}<b>"}}
		)
		html = lh.generate(lh.validate_layout(raw))["header"]
		self.assertNotIn("<script", html)
		self.assertNotIn("{{ 7*7 }}", html)
		self.assertNotIn("{% if 1 %}", html)
		self.assertNotIn(".__", html)
		out = frappe.render_template(html, {"doc": {"company": COMPANY}})
		self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", out)
		self.assertNotIn("49", re.sub(r"<svg.*?</svg>", "", out, flags=re.S))
		self.assertIn("&#123;&#123; 7*7 &#125;&#125;", out)
		self.assertIn("&#123;% if 1 %&#125;IF", out)
		self.assertIn("&#123;&#123; frappe.session.user &#125;&#125;&lt;b&gt;", out)
		self.assertNotIn(frappe.session.user + "<b>", out)

	def test_company_values_print_escaped(self):
		html = lh.generate(lh.validate_layout(LAYOUT))
		out = frappe.render_template(html["header"], {"doc": {"company": COMPANY}})
		self.assertIn(frappe.utils.escape_html(company_value("company_name")), out)
		phone = company_value("phone_no")
		if phone:
			self.assertIn(f'Tel: <bdi dir="ltr">{frappe.utils.escape_html(phone)}</bdi>', out)
		self.assertIn("Est. 1990<br>Aden", out)
		self.assertNotIn("None", out)

	def test_the_company_resolution(self):
		html = lh.generate(lh.validate_layout(LAYOUT))["header"]
		other = frappe.render_template(html, {"doc": {"company": OTHER_COMPANY}})
		self.assertIn(frappe.db.get_value("Company", OTHER_COMPANY, "company_name"), other)
		# no doc, or a doc without a company: the default company
		default = frappe.db.get_single_value("Global Defaults", "default_company")
		if default:
			name = frappe.utils.escape_html(frappe.db.get_value("Company", default, "company_name"))
			self.assertIn(name, frappe.render_template(html, {}))
			self.assertIn(name, frappe.render_template(html, {"doc": {"from_date": "2026-01-01"}}))
		# a fixed company wins over the document's
		fixed = lh.generate(lh.validate_layout(LAYOUT), company=OTHER_COMPANY)["header"]
		self.assertIn(f'{{%- set _rvc = "{OTHER_COMPANY}" -%}}', fixed)
		out = frappe.render_template(fixed, {"doc": {"company": COMPANY}})
		self.assertIn(frappe.db.get_value("Company", OTHER_COMPANY, "company_name"), out)

	def test_the_arabic_name_comes_from_translation(self):
		name = company_value("company_name")
		frappe.get_doc({"doctype": "Translation", "language": "ar", "source_text": name, "translated_text": "سند للمحاسبة <ع>"}).insert()
		out = frappe.render_template(lh.generate(lh.validate_layout(LAYOUT))["header"], {"doc": {"company": COMPANY}})
		self.assertIn("سند للمحاسبة &lt;ع&gt;", out)

	def test_a_closed_slot_is_not_printed_and_warned(self):
		raw = layout()
		raw["header"]["slots"]["center"] = 0
		clean = lh.validate_layout(raw)
		self.assertNotIn('data-slot="center"', lh.generate(clean)["header"])
		warnings = lh.layout_warnings(clean, {"company_logo": "/private/files/x.png", "website": ""})
		self.assertTrue(any("c1" in w for w in warnings))


class TestLetterHeadApi(RVTestCase):
	def save(self, **kwargs):
		kwargs.setdefault("layout", json.dumps(LAYOUT))
		return api.save(**kwargs)

	def test_a_new_letter_head_is_html_and_keeps_its_content(self):
		with self.as_user("admin"):
			out = self.save(name="RV LH Test New", template="classic")
		self.assertEqual(out["letter_head"], "RV LH Test New")
		doc = frappe.get_doc("Letter Head", "RV LH Test New")
		self.assertEqual((doc.source, doc.footer_source), ("HTML", "HTML"))
		self.assertTrue(doc.content.startswith("<!-- rv-lh v1 header h=35 -->"))
		self.assertIn('data-rv-lh="footer"', doc.footer)
		self.assertEqual(doc.content, lh.generate(lh.validate_layout(LAYOUT))["header"])
		if frappe.get_meta("Letter Head").has_field("header_height"):
			self.assertEqual((doc.header_height, doc.footer_height), (35, 15))
		record = frappe.get_doc("Letter Head Layout", {"letter_head": doc.name})
		self.assertEqual(record.generated_hash, lh.content_hash(doc.content, doc.footer))
		self.assertEqual(record.template, "classic")
		self.assertEqual(json.loads(record.layout), lh.validate_layout(LAYOUT))
		self.assertEqual(out["print_format_css"], ".print-format { margin-top: 50mm; margin-bottom: 25mm; }")
		with self.as_user("admin"), self.assertRaises(frappe.DuplicateEntryError):
			self.save(name="RV LH Test New")
		with self.as_user("admin"), self.assertRaises(RVInvalidInput):
			self.save(name="  ")
		# Frappe's report printing renders it with the filters as the document
		with self.as_user("accountant"):
			printed = render_letterhead_for_print("RV LH Test New", {"company": OTHER_COMPANY})
		self.assertIn(frappe.db.get_value("Company", OTHER_COMPANY, "company_name"), printed["header"])

	def test_update_and_hand_edits(self):
		with self.as_user("admin"):
			self.save(name="RV LH Test Edit")
			changed = layout()
			changed["header"]["h"] = 40
			self.save(layout=changed, letter_head="RV LH Test Edit")
		self.assertIn("height:40mm", frappe.db.get_value("Letter Head", "RV LH Test Edit", "content"))
		frappe.db.set_value("Letter Head", "RV LH Test Edit", "content", "<p>by hand</p>")
		with self.as_user("admin"):
			ctx = api.builder_context(letter_head="RV LH Test Edit")
			self.assertTrue(ctx["letter_head"]["hand_edited"])
			self.assertEqual(ctx["letter_head"]["layout"]["header"]["h"], 40)
			with self.assertRaises(lh.RVLetterHeadEdited):
				self.save(letter_head="RV LH Test Edit")
			self.save(letter_head="RV LH Test Edit", overwrite=1)
			self.assertFalse(api.builder_context(letter_head="RV LH Test Edit")["letter_head"]["hand_edited"])
		self.assertIn("rv-lh v1", frappe.db.get_value("Letter Head", "RV LH Test Edit", "content"))

	def test_a_letter_head_made_by_hand_is_not_overwritten_silently(self):
		frappe.get_doc({"doctype": "Letter Head", "letter_head_name": "RV LH Test Hand", "source": "HTML", "content": "<p>old</p>"}).insert()
		with self.as_user("admin"):
			ctx = api.builder_context(letter_head="RV LH Test Hand")
			self.assertEqual((ctx["letter_head"]["has_layout"], ctx["letter_head"]["hand_edited"]), (False, True))
			with self.assertRaises(lh.RVLetterHeadEdited):
				self.save(letter_head="RV LH Test Hand")
			self.save(letter_head="RV LH Test Hand", overwrite=1)
		doc = frappe.get_doc("Letter Head", "RV LH Test Hand")
		self.assertEqual(doc.source, "HTML")
		self.assertIn("rv-lh v1", doc.content)

	def test_saving_needs_letter_head_write(self):
		with self.as_user("admin"):
			self.save(name="RV LH Test Perm")
		with self.as_user("accountant"):
			for call in (
				lambda: self.save(name="RV LH Test Perm 2"),
				lambda: self.save(letter_head="RV LH Test Perm", overwrite=1),
			):
				with self.assertRaises(frappe.PermissionError):
					call()
			self.assertFalse(api.builder_context()["can_write"])
		self.assertFalse(frappe.db.exists("Letter Head", "RV LH Test Perm 2"))

	def test_make_default_sets_the_company_default(self):
		with self.as_user("admin"):
			out = self.save(name="RV LH Test Default", company=COMPANY, make_default=1)
		self.assertTrue(out["company_default"])
		self.assertEqual(company_value("default_letter_head"), "RV LH Test Default")
		record = frappe.get_doc("Letter Head Layout", {"letter_head": "RV LH Test Default"})
		self.assertEqual(record.company, COMPANY)

	def test_preview_renders_the_company(self):
		with self.as_user("accountant"):
			out = api.preview(json.dumps(LAYOUT), company=COMPANY)
			other = api.preview(LAYOUT, company=OTHER_COMPANY)
		self.assertIn(frappe.utils.escape_html(company_value("company_name")), out["header"])
		self.assertNotIn("{{", out["header"] + out["footer"])
		self.assertIn(frappe.db.get_value("Company", OTHER_COMPANY, "company_name"), other["header"])
		self.assertEqual((out["header_height"], out["footer_height"]), (35, 15))
		self.assertIsInstance(out["warnings"], list)
		with self.as_user("restricted"), self.assertRaises(frappe.DoesNotExistError):
			api.preview(LAYOUT, company=COMPANY)
		with self.as_user("accountant"), self.assertRaises(RVInvalidInput):
			api.preview(layout(v=9), company=COMPANY)

	def test_builder_context(self):
		with self.as_user("accountant"):
			ctx = api.builder_context(company=COMPANY)
		self.assertIn(COMPANY, [c.name for c in ctx["companies"]])
		self.assertEqual(ctx["company"], COMPANY)
		self.assertEqual(ctx["company_data"]["values"]["company_name"], company_value("company_name"))
		self.assertEqual(set(ctx["company_data"]["values"]), set(lh.TOKENS))
		self.assertEqual([t["token"] for t in ctx["tokens"]], list(lh.TOKENS))
		self.assertEqual(ctx["fonts"], list(lh.FONTS))
		self.assertEqual(ctx["ref_width"], 180)
		self.assertIsNone(ctx["letter_head"])
		# only the companies the user may read
		with self.as_user("restricted"):
			ctx = api.builder_context()
			self.assertEqual([c.name for c in ctx["companies"]], [OTHER_COMPANY])
			self.assertEqual(ctx["company"], OTHER_COMPANY)
			with self.assertRaises(frappe.DoesNotExistError):
				api.builder_context(company=COMPANY)
		with self.as_user("none"):
			for call in (api.builder_context, lambda: api.preview(LAYOUT), lambda: api.qr_svg("x")):
				with self.assertRaises(frappe.PermissionError):
					call()

	def test_qr_svg(self):
		with self.as_user("accountant"):
			out = api.qr_svg("https://example.com")
			self.assertTrue(out["svg"].startswith("<svg"))
			self.assertIn("viewBox", out["svg"])
			for bad in ("", "x" * 301):
				with self.assertRaises(RVInvalidInput):
					api.qr_svg(bad)


class TestPdfMargins(RVTestCase):
	"""Hook pdf_body_html: wkhtmltopdf with repeated header and footer gets the margins of a
	builder letter head (it does not measure the header itself)."""

	def render(self, letter_head, footer="", generator="wkhtmltopdf", repeat=1, body="<div class='print-format'>x</div>"):
		from jinja2 import Template

		old = frappe.local.form_dict.get("pdf_generator")
		frappe.local.form_dict.pdf_generator = generator
		try:
			return lh.pdf_body_html(
				jenv=None,
				template=Template(body),
				print_format=None,
				args={"letter_head": letter_head, "footer": footer, "no_letterhead": 0, "print_settings": frappe._dict(repeat_header_footer=repeat)},
			)
		finally:
			frappe.local.form_dict.pdf_generator = old

	def test_builder_letter_head_gets_margins(self):
		html = self.render('<div class="rvlh" data-rv-lh="header" data-h="35">', '<div class="rvlh" data-rv-lh="footer" data-h="14">')
		self.assertIn(".print-format { margin-top: 50mm; margin-bottom: 24mm; }", html)

	def test_left_alone(self):
		builder = '<div class="rvlh" data-rv-lh="header" data-h="35">'
		self.assertNotIn("margin-top", self.render("<div>a hand made letter head</div>"))
		self.assertNotIn("margin-top", self.render(builder, generator="chrome"))
		self.assertNotIn("margin-top", self.render(builder, repeat=0))
		# a format with its own top margin keeps it
		own = self.render(builder, body="<style>.print-format{margin-top:20mm}</style><div class='print-format'>x</div>")
		self.assertEqual(own.count("margin-top"), 1)
