"""The Letter Head builder (ADR-018): the layout's validation, the generated HTML (its
contract and its escaping), and the API (save flow, hand edits, permissions, preview)."""

import copy
import json
import os
import re
from html.parser import HTMLParser
from unittest.mock import patch

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
			{
				"id": "r1",
				"type": "field",
				"slot": "right",
				"style": {"size": 14, "weight": 700, "color": "primary"},
				"props": {"token": "company_name_ar"},
			},
			{
				"id": "r2",
				"type": "field",
				"slot": "right",
				"props": {"token": "tax_id", "label": "الرقم الضريبي:"},
			},
			{"id": "c1", "type": "logo", "slot": "center", "w": 40, "h": 20},
			{"id": "l1", "type": "field", "slot": "left", "props": {"token": "company_name"}},
			{"id": "l2", "type": "field", "slot": "left", "props": {"token": "phone_no", "label": "Tel:"}},
			{"id": "l3", "type": "field", "slot": "left", "props": {"token": "address"}},
			{"id": "t1", "type": "text", "slot": "left", "props": {"text": "Est. 1990\nAden", "dir": "ltr"}},
			{
				"id": "f1",
				"type": "line",
				"slot": None,
				"x": 9,
				"y": 33,
				"w": 162,
				"props": {"thick": 0.6},
				"style": {"color": "primary"},
			},
			{
				"id": "q1",
				"type": "qr",
				"slot": None,
				"x": 0,
				"y": 2,
				"w": 15,
				"h": 15,
				"props": {"source": "text", "text": "https://example.com"},
			},
		],
	},
	"footer": {
		"h": 15,
		"pad_top": 3,
		"slots": {"right": 40, "center": 20, "left": 40},
		"elements": [
			{"id": "p1", "type": "page", "slot": "center", "props": {"format": "both"}},
			{
				"id": "b1",
				"type": "band",
				"slot": None,
				"x": 0,
				"y": 13,
				"w": 180,
				"h": 2,
				"props": {"fill": "#AA0000"},
			},
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
		clean = lh.validate_layout(
			{
				"v": 1,
				"header": {
					"elements": [{"id": "a", "type": "text", "slot": "right", "props": {"text": "x"}}]
				},
			}
		)
		self.assertEqual(clean["font"], "IBM Plex Sans Arabic")
		self.assertEqual(clean["colors"], lh.DEFAULT_COLORS)
		self.assertEqual((clean["header"]["h"], clean["footer"]["h"]), (35, 15))
		el = clean["header"]["elements"][0]
		# the defaults of the type, from the contract (letterhead_contract.json)
		self.assertEqual(
			el["style"], {"size": 10, "weight": 400, "color": "text", "align": "start", "gap": 1}
		)
		self.assertEqual(el["style"], lh.ELEMENT_DEFAULTS["text"]["style"])
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
			with_element(
				{"id": "x1", "type": "field", "slot": "left", "props": {"token": "email", "html": "<b>"}}
			),
			with_element({"id": "x1", "type": "text", "slot": "left", "onclick": "x"}),
			with_element({"id": "X-1", "type": "text", "slot": "left"}),
			with_element({"id": "r1", "type": "text", "slot": "left"}),
			with_element({"id": "x1", "type": "text", "slot": "top"}),
			with_element({"id": "x1", "type": "text", "slot": "left", "style": {"color": "javascript:x"}}),
			with_element({"id": "x1", "type": "text", "slot": "left", "style": {"font": "x"}}),
			with_element({"id": "x1", "type": "text", "slot": "left", "props": {"text": "x" * 501}}),
			with_element(
				{"id": "x1", "type": "field", "slot": "left", "props": {"token": "email", "label": "x" * 61}}
			),
			with_element(
				{"id": "x1", "type": "qr", "slot": "left", "props": {"source": "text", "text": "x" * 301}}
			),
			with_element({"id": "x1", "type": "text", "slot": "left", "x": "10"}),
			with_element(
				{"id": "x1", "type": "image", "slot": "left", "props": {"src": "/private/files/logo.png"}}
			),
			with_element(
				{"id": "x1", "type": "image", "slot": "left", "props": {"src": "https://evil.example/x.png"}}
			),
			with_element(
				{
					"id": "x1",
					"type": "image",
					"slot": "left",
					"props": {"src": "/files/../private/files/x.png"},
				}
			),
			with_element(
				{
					"id": "x1",
					"type": "image",
					"slot": "left",
					"props": {"src": '/files/x.png" onerror="alert(1)'},
				}
			),
			with_element(
				{
					"id": "x1",
					"type": "image",
					"slot": "left",
					"props": {"src": "/files/x.png');background:url('//evil"},
				}
			),
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
			low = re.sub(
				r"<style>(@font-face\{[^<]*?\})*" + re.escape(lh.FONT_INHERIT) + "</style>", "", part
			).lower()
			self.assertNotIn("<style", low)
			for banned in ("<script", "grid", "flex", "var(", "transform", "report_view", "javascript:"):
				self.assertNotIn(banned, low)
		# slots: absolute, percent widths, their own direction
		self.assertIn(
			'data-slot="right" dir="rtl" style="position:absolute;top:6mm;right:0;width:34%;padding:0 1mm;box-sizing:border-box;text-align:right"',
			header,
		)
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
		for family in (
			"IBM Plex Sans Arabic",
			"DejaVu Sans",
			"Cairo",
			"Amiri",
			"Nazli",
			"FreeFarsi",
			"Inter",
		):
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
		roya = frappe.render_template(
			lh.generate(lh.validate_layout(layout(font="Roya")))["header"], {"doc": {}}
		)
		self.assertNotIn("woff2", roya)
		self.assertIn(base + "roya/roya-400.ttf", roya)
		self.assertIn(
			"font-family:'Amiri',serif", lh.generate(lh.validate_layout(layout(font="Amiri")))["header"]
		)
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
			{
				"id": "x1",
				"type": "text",
				"slot": "left",
				"props": {
					"text": "<script>alert(1)</script> {{ 7*7 }} {% if 1 %}IF{% endif %} {# c #} a.__class__"
				},
			}
		)
		raw["header"]["elements"].append(
			{
				"id": "x2",
				"type": "field",
				"slot": "left",
				"props": {"token": "company_name", "label": "{{ frappe.session.user }}<b>"},
			}
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
		frappe.get_doc(
			{
				"doctype": "Translation",
				"language": "ar",
				"source_text": name,
				"translated_text": "سند للمحاسبة <ع>",
			}
		).insert()
		out = frappe.render_template(
			lh.generate(lh.validate_layout(LAYOUT))["header"], {"doc": {"company": COMPANY}}
		)
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
		frappe.get_doc(
			{
				"doctype": "Letter Head",
				"letter_head_name": "RV LH Test Hand",
				"source": "HTML",
				"content": "<p>old</p>",
			}
		).insert()
		with self.as_user("admin"):
			ctx = api.builder_context(letter_head="RV LH Test Hand")
			self.assertEqual(
				(ctx["letter_head"]["has_layout"], ctx["letter_head"]["hand_edited"]), (False, True)
			)
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
		self.assertIsNone(ctx["letter_head"])
		# only what the page reads: the contract (limits, fields, fonts) is imported by the page
		self.assertEqual(
			set(ctx), {"companies", "company", "company_data", "letter_head", "can_write", "can_set_default"}
		)
		self.assertEqual(set(ctx["company_data"]), {"name", "values", "logo", "logo_public"})
		# a switch of the preview company reads that company only
		with self.as_user("accountant"):
			other = api.company_data(OTHER_COMPANY)
		self.assertEqual(other["company_data"]["name"], OTHER_COMPANY)
		self.assertIn("can_set_default", other)
		# only the companies the user may read
		with self.as_user("restricted"):
			ctx = api.builder_context()
			self.assertEqual([c.name for c in ctx["companies"]], [OTHER_COMPANY])
			self.assertEqual(ctx["company"], OTHER_COMPANY)
			with self.assertRaises(frappe.DoesNotExistError):
				api.builder_context(company=COMPANY)
			with self.assertRaises(frappe.DoesNotExistError):
				api.company_data(COMPANY)
		with self.as_user("none"):
			for call in (
				api.builder_context,
				lambda: api.preview(LAYOUT),
				lambda: api.qr_svg("x"),
				lambda: api.company_data(COMPANY),
			):
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

	def render(
		self,
		letter_head,
		footer="",
		generator="wkhtmltopdf",
		repeat=1,
		body="<div class='print-format'>x</div>",
	):
		from jinja2 import Template

		old = frappe.local.form_dict.get("pdf_generator")
		frappe.local.form_dict.pdf_generator = generator
		try:
			return lh.pdf_body_html(
				jenv=None,
				template=Template(body),
				print_format=None,
				args={
					"letter_head": letter_head,
					"footer": footer,
					"no_letterhead": 0,
					"print_settings": frappe._dict(repeat_header_footer=repeat),
				},
			)
		finally:
			frappe.local.form_dict.pdf_generator = old

	def test_builder_letter_head_gets_margins(self):
		html = self.render(
			'<div class="rvlh" data-rv-lh="header" data-h="35">',
			'<div class="rvlh" data-rv-lh="footer" data-h="14">',
		)
		self.assertIn(".print-format { margin-top: 50mm; margin-bottom: 24mm; }", html)

	def test_left_alone(self):
		builder = '<div class="rvlh" data-rv-lh="header" data-h="35">'
		self.assertNotIn("margin-top", self.render("<div>a hand made letter head</div>"))
		self.assertNotIn("margin-top", self.render(builder, generator="chrome"))
		self.assertNotIn("margin-top", self.render(builder, repeat=0))
		# a format with its own top margin keeps it
		own = self.render(
			builder, body="<style>.print-format{margin-top:20mm}</style><div class='print-format'>x</div>"
		)
		self.assertEqual(own.count("margin-top"), 1)


class TestBandCorners(RVTestCase):
	def band(self, corners):
		layout = copy.deepcopy(lh.validate_layout({"v": 1}))
		layout["header"]["elements"] = [
			{
				"id": "b1",
				"type": "band",
				"slot": None,
				"x": 0,
				"y": 0,
				"w": 50,
				"h": 20,
				"props": {
					"fill": "primary",
					"radius": 10,
					**({"corners": corners} if corners is not None else {}),
				},
			}
		]
		return lh.validate_layout(layout)

	def test_corners_normalised_and_drawn(self):
		self.assertEqual(self.band(None)["header"]["elements"][0]["props"]["corners"], "all")
		self.assertEqual(self.band("br,tl")["header"]["elements"][0]["props"]["corners"], "tl,br")
		self.assertEqual(self.band("tl,tr,br,bl")["header"]["elements"][0]["props"]["corners"], "all")
		html = lh.generate(self.band("br"), company=COMPANY)["header"]
		self.assertIn("border-radius:0 0 10mm 0", html)
		self.assertIn("border-radius:10mm", lh.generate(self.band(None), company=COMPANY)["header"])

	def test_bad_corners_refused(self):
		for bad in ("top", "tl;br", ["tl"]):
			with self.assertRaises(RVInvalidInput):
				self.band(bad)


class _Styles(HTMLParser):
	"""Per drawn part of a band (the root, each slot, each element): its dir and its inline
	style as a dict, and the style of the first styled element inside an element (the rule of
	a line, the box of a band, the picture of a logo, an image or a QR code)."""

	def __init__(self):
		super().__init__()
		self.parts, self.stack, self.want = {}, [], None

	@staticmethod
	def style(value):
		# harmless syntax only: property order and spaces
		return dict(
			(k.strip(), v.strip())
			for k, _, v in (p.partition(":") for p in (value or "").split(";"))
			if k.strip()
		)

	def handle_starttag(self, tag, attrs):
		a = dict(attrs)
		key = (
			f"el:{a['data-el']}"
			if "data-el" in a
			else f"slot:{a['data-slot']}"
			if "data-slot" in a
			else f"band:{a['data-rv-lh']}"
			if "data-rv-lh" in a
			else None
		)
		if key:
			self.parts[key] = {"dir": a.get("dir"), "style": self.style(a.get("style"))}
			self.want = key if key.startswith("el:") else None
		elif self.want and "style" in a and "inner" not in self.parts[self.want]:
			self.parts[self.want]["inner"] = self.style(a["style"])


def _parts(html: str) -> dict:
	p = _Styles()
	p.feed(html)
	return p.parts


class TestRendererParity(RVTestCase):
	"""The editor (render.js) and the print (core/letterhead.py) draw a layout alike: the six
	styles of the gallery and an edge fixture of every type and option, as
	tests/js/letterhead_parity.test.mjs wrote them (report_view/tests/fixtures/
	letterhead_parity.json), drawn again here with the same company values and compared
	part by part: dir and inline styles, numbers exact."""

	GOLDEN = os.path.join(os.path.dirname(__file__), "fixtures", "letterhead_parity.json")

	def draw(self, layout, values, logo):
		"""The bands as they print for a company with ``values``: the template's company
		block reads them from the fixture instead of the database."""
		line1, line2, country = values["address"].split("\n")
		fx = {
			"o": frappe._dict({**values, "company_logo": logo}),
			"a": frappe._dict(
				address_line1=line1, address_line2=line2, city="", state="", pincode="", country=country
			),
			"n": values["company_name_ar"],
		}
		block = "{%- set _rvo = fx.o -%}{%- set _rva = fx.a -%}{%- set _rvn = fx.n -%}\n"
		with (
			patch.object(lh, "_company_block", lambda uses, company: block if uses else ""),
			patch.object(lh, "company_website", lambda company: values["website"]),
		):
			html = lh.generate(layout)
		return {band: frappe.render_template(html[band], {"fx": fx}) for band in ("header", "footer")}

	def test_both_renderers_draw_alike(self):
		with open(self.GOLDEN, encoding="utf-8") as f:
			golden = json.load(f)
		self.assertEqual(len(golden["cases"]), 7)
		compared = 0
		for case in golden["cases"]:
			with self.subTest(case=case["id"]):
				clean = lh.validate_layout(case["layout"])
				# the editor's clamping and the server's validation keep the same layout
				self.assertEqual(clean, case["layout"])
				py = self.draw(clean, golden["values"], golden["logo"])
				for band in ("header", "footer"):
					js, pp = _parts(case[band]), _parts(py[band])
					for key, part in js.items():
						self.assertIn(key, pp, f"{case['id']} {band}: {key} is drawn by the editor only")
						self.assertEqual(part, pp[key], f"{case['id']} {band} {key}")
						compared += key.startswith("el:")
					extra = {k for k in pp if k.startswith("el:")} - set(js)
					self.assertFalse(extra, f"{case['id']} {band}: printed only: {extra}")
		# every element of the fixtures that prints was compared (not an empty match)
		self.assertGreater(compared, 70)


class TestDirectionAndWarnings(RVTestCase):
	def free(self, el):
		raw = {
			"v": 1,
			"header": {
				"slots": {"right": 0, "center": 0, "left": 0},
				"elements": [{"id": "x1", "slot": None, "x": 10, "y": 2, "w": 80, **el}],
			},
		}
		return lh.validate_layout(raw)

	def test_a_free_arabic_element_aligns_as_the_editor_draws_it(self):
		# a text: its own content decides (the editor's rule), not "auto" = left
		html = lh.generate(
			self.free({"type": "text", "style": {"align": "start"}, "props": {"text": "مرحبا"}})
		)["header"]
		self.assertIn('data-el="x1" dir="rtl"', html)
		self.assertIn("text-align:right", html)
		html = lh.generate(
			self.free({"type": "text", "style": {"align": "start"}, "props": {"text": "Hello"}})
		)["header"]
		self.assertIn("text-align:left", html)
		# a field without a label: the printed value decides, at print time
		layout = self.free(
			{"type": "field", "style": {"align": "start"}, "props": {"token": "company_name_ar"}}
		)
		block = "{%- set _rvo = fx -%}{%- set _rvn = fx.n -%}"
		with patch.object(lh, "_company_block", lambda uses, company: block):
			html = lh.generate(layout)["header"]
		arabic = frappe.render_template(html, {"fx": {"n": "شركة سند"}})
		self.assertIn('dir="rtl"', arabic)
		self.assertIn("text-align:right", arabic)
		latin = frappe.render_template(html, {"fx": {"n": "SND Co"}})
		self.assertIn('dir="ltr"', latin)
		self.assertIn("text-align:left", latin)
		# a page number: Arabic or both read from the right, as the editor aligns them
		for fmt, align in (("ar", "right"), ("both", "right"), ("en", "left")):
			html = lh.generate(
				self.free({"type": "page", "style": {"align": "start"}, "props": {"format": fmt}})
			)["header"]
			self.assertIn(f"text-align:{align}", html, fmt)

	def test_values_are_trimmed_and_a_blank_one_is_hidden(self):
		layout = self.free({"type": "field", "props": {"token": "company_name_ar", "label": "x"}})
		with patch.object(lh, "_company_block", lambda uses, company: "{%- set _rvn = fx -%}"):
			html = lh.generate(layout)["header"]
		self.assertNotIn('data-el="x1"', frappe.render_template(html, {"fx": "   "}))
		self.assertIn("<bdi>SND</bdi>", frappe.render_template(html, {"fx": "  SND "}))

	def test_a_thin_double_line_prints_as_drawn(self):
		html = lh.generate(self.free({"type": "line", "props": {"thick": 0.4, "style": "double"}}))["header"]
		self.assertIn("border-top:0.8mm double", html)

	def test_overflowing_elements_are_warned(self):
		tall = self.free({"type": "logo", "y": 30, "h": 10})
		self.assertTrue(
			any("x1" in w and "edge" in w for w in lh.layout_warnings(tall, {"company_logo": "/files/a.png"}))
		)
		fits = self.free({"type": "logo", "y": 5, "h": 10})
		self.assertFalse(any("x1" in w for w in lh.layout_warnings(fits, {"company_logo": "/files/a.png"})))
		# a free element is kept within the band's width
		wide = self.free({"type": "text", "x": 170, "w": 60, "props": {"text": "x"}})["header"]["elements"][0]
		self.assertEqual((wide["x"], wide["w"]), (120, 60))

	def test_the_contract_is_the_one_source(self):
		from report_view.core.contract import CONTRACT

		self.assertEqual(lh.TOKENS, tuple(CONTRACT["tokens"]))
		self.assertEqual(lh.MAX_TEXT, CONTRACT["limits"]["text"])
		self.assertEqual(lh.BANDS["header"]["h"], (10, 80, 35))
		self.assertEqual(fonts.DEFAULT_FONT, CONTRACT["fonts"]["default"])
		self.assertEqual(fonts.CATEGORIES, tuple(CONTRACT["fonts"]["categories"]))
		# a free element without a width takes its type's (as the editor does), a missing slot its default
		clean = lh.validate_layout(
			{
				"v": 1,
				"header": {
					"slots": {"right": 40},
					"elements": [{"id": "a", "type": "text", "slot": None, "w": 0, "props": {"text": "x"}}],
				},
			}
		)
		self.assertEqual(clean["header"]["elements"][0]["w"], CONTRACT["element_defaults"]["text"]["w"])
		self.assertEqual(clean["header"]["slots"], {"right": 40, "center": 26, "left": 34})


class TestLayoutRecord(RVTestCase):
	"""Letter Head Layout edited outside the builder writes its Letter Head; deleting a builder
	Letter Head deletes its layout (doc_events of Letter Head)."""

	def test_a_layout_saved_in_desk_writes_its_letter_head(self):
		with self.as_user("admin"):
			api.save(layout=json.dumps(LAYOUT), name="RV LH Test Desk")
			record = frappe.get_doc("Letter Head Layout", {"letter_head": "RV LH Test Desk"})
			changed = layout()
			changed["header"]["h"] = 44
			record.layout = json.dumps(changed)
			record.save()
		content, footer = frappe.db.get_value("Letter Head", "RV LH Test Desk", ["content", "footer"])
		self.assertIn("height:44mm", content)
		record.reload()
		self.assertEqual(record.generated_hash, lh.content_hash(content, footer))
		with self.as_user("admin"):
			self.assertFalse(api.builder_context(letter_head="RV LH Test Desk")["letter_head"]["hand_edited"])
		# a letter head edited by hand is not replaced from Desk
		frappe.db.set_value("Letter Head", "RV LH Test Desk", "content", "<p>by hand</p>")
		changed["header"]["h"] = 50
		record.layout = json.dumps(changed)
		with self.as_user("admin"), self.assertRaises(lh.RVLetterHeadEdited):
			record.save()

	def patched_events(self, **mine):
		"""The doc_events of Letter Head with report_view's (they live in hooks.py)."""
		hooks = frappe.get_doc_hooks()
		events = {**hooks.get("Letter Head", {})}
		for event, handler in mine.items():
			events[event] = list(dict.fromkeys([*events.get(event, []), handler]))
		return patch.dict(hooks, {"Letter Head": events})

	def test_a_new_letter_head_is_written_once(self):
		from frappe.model.document import Document

		saved = []
		real = Document.save

		def save(doc, *args, **kwargs):
			if doc.doctype == "Letter Head":
				saved.append(doc.name)
			return real(doc, *args, **kwargs)

		with (
			self.patched_events(before_insert="report_view.core.letterhead.keep_builder_source"),
			patch.object(Document, "save", save),
		):
			with self.as_user("admin"):
				api.save(layout=json.dumps(LAYOUT), name="RV LH Test Once")
		doc = frappe.get_doc("Letter Head", "RV LH Test Once")
		self.assertEqual((doc.source, doc.footer_source), ("HTML", "HTML"))
		self.assertEqual(saved, [], "inserted once, not saved again")
		# without the doc_event it is still an HTML letter head (inserted, then saved)
		with self.as_user("admin"):
			api.save(layout=json.dumps(LAYOUT), name="RV LH Test Twice")
		self.assertEqual(frappe.db.get_value("Letter Head", "RV LH Test Twice", "source"), "HTML")

	def test_deleting_a_builder_letter_head_deletes_its_layout(self):
		with self.as_user("admin"):
			api.save(layout=json.dumps(LAYOUT), name="RV LH Test Delete")
		with self.patched_events(on_trash="report_view.core.letterhead.delete_layout"):
			frappe.delete_doc("Letter Head", "RV LH Test Delete")
		self.assertFalse(frappe.db.exists("Letter Head", "RV LH Test Delete"))
		self.assertFalse(frappe.db.exists("Letter Head Layout", {"letter_head": "RV LH Test Delete"}))

	def test_the_letter_head_events_are_registered(self):
		events = frappe.get_hooks("doc_events").get("Letter Head") or {}
		self.assertIn("report_view.core.letterhead.delete_layout", events.get("on_trash", []))
		self.assertIn("report_view.core.letterhead.keep_builder_source", events.get("before_insert", []))


class TestPdfBodyHook(RVTestCase):
	def test_a_standard_print_is_the_previous_hooks_own(self):
		from frappe.utils.pdf import pdf_body_html as frappe_body
		from jinja2 import Template

		args = {
			"letter_head": "<div>hand made</div>",
			"footer": "",
			"no_letterhead": 0,
			"print_settings": frappe._dict(repeat_header_footer=1),
		}
		body = Template("<div class='print-format'>{{ letter_head }}</div>")
		old = frappe.local.form_dict.get("pdf_generator")
		frappe.local.form_dict.pdf_generator = "wkhtmltopdf"
		try:
			self.assertEqual(
				lh.pdf_body_html(jenv=None, template=body, print_format=None, args=args),
				frappe_body(jenv=None, template=body, print_format=None, args=args),
			)
		finally:
			frappe.local.form_dict.pdf_generator = old
		self.assertEqual(lh.previous_pdf_body_html(), "frappe.utils.pdf.pdf_body_html")

	def test_an_app_after_report_view_is_warned(self):
		with patch.object(
			frappe, "get_hooks", lambda name, *a, **k: [lh.FRAPPE_HOOK, lh.HOOK, "other_app.pdf.body"]
		):
			self.assertEqual(lh.previous_pdf_body_html(), lh.FRAPPE_HOOK)
			self.assertFalse(lh.check_pdf_body_html_hook())
		with patch.object(frappe, "get_hooks", lambda name, *a, **k: [lh.FRAPPE_HOOK, lh.HOOK]):
			self.assertTrue(lh.check_pdf_body_html_hook())
