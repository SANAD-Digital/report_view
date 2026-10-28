"""Variables of a print format (ADR-024): the definitions checked on save, the values of the
print page checked against them, and every render path giving them to the template."""

import json

import frappe

from report_view import api as report_api
from report_view.api import custom_print as custom_api
from report_view.api import document as doc_api
from report_view.core import print_presets
from report_view.core import print_variables as pv
from report_view.core.errors import RVInvalidInput
from report_view.core.printing import Text
from report_view.tests.test_custom_print import _custom_format, _fixture
from report_view.tests.utils import (
	COMPANY,
	OTHER_COMPANY,
	TB_FILTERS,
	TB_JS_FILTERS,
	RVTestCase,
	submitted_journal_entry,
)

DEFS = [
	{"label": "Show details", "fieldname": "show_details", "fieldtype": "Check", "default": 1},
	{
		"label": "Layout",
		"fieldname": "layout",
		"fieldtype": "Select",
		"options": "Short\nLong",
		"default": "Short",
	},
	{"label": "Company", "fieldname": "pick_company", "fieldtype": "Link", "options": "Company"},
	{"label": "Copies", "fieldname": "copies", "fieldtype": "Int", "default": "2"},
	{"label": "Rate", "fieldname": "rate", "fieldtype": "Float", "default": 1.5},
]
SHOW = (
	"<p>D={{ variables.show_details }} L={{ variables.layout }} C={{ variables.pick_company }}"
	" N={{ variables.copies }} R={{ variables.rate }}</p>"
)


def _has_field() -> bool:
	return frappe.get_meta("Print Format").has_field(pv.FIELD)


class TestDefinitions(RVTestCase):
	def test_a_valid_list_is_normalised(self):
		out = pv.parse_definitions(json.dumps(DEFS))
		self.assertEqual(
			[d["fieldname"] for d in out], ["show_details", "layout", "pick_company", "copies", "rate"]
		)
		by = {d["fieldname"]: d for d in out}
		self.assertEqual(by["show_details"]["default"], 1)
		self.assertEqual(by["copies"]["default"], 2)
		self.assertEqual(by["rate"]["default"], 1.5)
		self.assertEqual(by["pick_company"]["default"], "")
		self.assertEqual(by["layout"]["options"], "Short\nLong")
		self.assertEqual(pv.parse_definitions(""), [])

	def test_mistakes_are_refused(self):
		base = {"label": "X", "fieldname": "x", "fieldtype": "Check"}
		bad = [
			"not json",
			json.dumps({"a": 1}),
			[{**base, "fieldname": "X1"}],
			[{**base, "fieldname": "1x"}],
			[{**base, "fieldname": "a" * 41}],
			[{**base, "fieldname": "doc"}],
			[{**base, "fieldname": "filters"}],
			[base, {**base, "label": "Y"}],
			[{**base, "fieldtype": "Data"}],
			[{**base, "label": ""}],
			[{**base, "fieldtype": "Select", "options": ""}],
			[{**base, "fieldtype": "Select", "options": "A\nB", "default": "C"}],
			[{**base, "fieldtype": "Link", "options": "No Such DocType"}],
			[{**base, "fieldtype": "Link", "options": "Journal Entry Account"}],
			[{**base, "fieldtype": "Int", "default": "1.5"}],
			[{**base, "fieldtype": "Float", "default": "abc"}],
			[{**base, "fieldname": f"v{i}"} for i in range(pv.MAX_VARIABLES + 1)],
		]
		for raw in bad:
			with self.subTest(raw=str(raw)[:60]), self.assertRaises(RVInvalidInput):
				pv.parse_definitions(raw)

	def test_saving_a_format_checks_its_variables(self):
		if not _has_field():
			self.skipTest("the custom field rv_variables is not installed")
		doc = frappe.get_doc(
			{
				"doctype": "Print Format",
				"name": "RV Vars Bad",
				"doc_type": "Journal Entry",
				"custom_format": 1,
				"print_format_type": "Jinja",
				"html": "<p>x</p>",
				pv.FIELD: json.dumps([{"label": "X", "fieldname": "doc", "fieldtype": "Check"}]),
			}
		)
		with self.assertRaises(RVInvalidInput):
			doc.insert()
		doc.set(pv.FIELD, json.dumps(DEFS))
		doc.insert()
		self.assertEqual(len(json.loads(doc.get(pv.FIELD))), 5)


class TestValues(RVTestCase):
	def setUp(self):
		self.pf = frappe._dict(name="X", **{pv.FIELD: json.dumps(DEFS)})

	def test_defaults_fill_what_is_not_sent_and_unknown_keys_are_dropped(self):
		with self.as_user("accountant"):
			out = pv.resolve(self.pf, json.dumps({"copies": "7", "evil": "<script>"}))
		self.assertEqual(
			out, {"show_details": 1, "layout": "Short", "pick_company": "", "copies": 7, "rate": 1.5}
		)
		self.assertNotIn("evil", out)
		self.assertIsInstance(out.layout, Text)

	def test_values_are_coerced_and_bounded(self):
		with self.as_user("accountant"):
			out = pv.resolve(self.pf, {"show_details": "0", "rate": "2.25", "layout": "Long"})
			self.assertEqual((out.show_details, out.rate, out.layout), (0, 2.25, "Long"))
			for values in (
				{"layout": "Medium"},
				{"copies": "1.5"},
				{"copies": "x"},
				{"rate": 1e13},
				{"rate": "nan"},
				{"layout": ["Long"]},
				"[1]",
				"{bad",
			):
				with self.subTest(values=values), self.assertRaises(RVInvalidInput):
					pv.resolve(self.pf, values)

	def test_a_link_must_be_a_record_the_user_may_read(self):
		with self.as_user("accountant"):
			self.assertEqual(pv.resolve(self.pf, {"pick_company": COMPANY}).pick_company, COMPANY)
			with self.assertRaises(frappe.PermissionError):
				pv.resolve(self.pf, {"pick_company": "No Such Company"})
		# a user restricted to the other company may not name this one
		with self.as_user("restricted"):
			self.assertEqual(pv.resolve(self.pf, {"pick_company": OTHER_COMPANY}).pick_company, OTHER_COMPANY)
			with self.assertRaises(frappe.PermissionError):
				pv.resolve(self.pf, {"pick_company": COMPANY})

	def test_string_values_print_escaped(self):
		pf = frappe._dict(
			name="Y",
			**{
				pv.FIELD: json.dumps(
					[{"label": "L", "fieldname": "l", "fieldtype": "Select", "options": "<b>x</b>\ny"}]
				)
			},
		)
		with self.as_user("accountant"):
			out = pv.resolve(pf, {"l": "<b>x</b>"})
		self.assertEqual(str(out.l), "&lt;b&gt;x&lt;/b&gt;")

	def test_a_format_without_variables_has_an_empty_dict(self):
		self.assertEqual(pv.resolve(frappe._dict(name="Z"), {"x": 1}), {})
		self.assertEqual(pv.for_print(None), {})


class TestRenderPaths(RVTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.skip = not _has_field()
		if cls.skip:
			return
		cls.je = submitted_journal_entry()
		cls.doc_format = (
			frappe.get_doc(
				{
					"doctype": "Print Format",
					"name": "RV Vars Doc",
					"doc_type": "Journal Entry",
					"custom_format": 1,
					"print_format_type": "Jinja",
					"standard": "No",
					"html": SHOW,
					pv.FIELD: json.dumps(DEFS),
				}
			)
			.insert()
			.name
		)
		cls.report_format = (
			frappe.get_doc(
				{
					"doctype": "Print Format",
					"name": "RV Vars Report",
					"print_format_for": "Report",
					"report": "Trial Balance",
					"print_format_type": "Jinja",
					"custom_format": 1,
					"standard": "No",
					"html": SHOW,
					pv.FIELD: json.dumps(DEFS),
				}
			)
			.insert()
			.name
		)
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
		cls.custom_format = _custom_format("RV Vars Custom", SHOW, **{pv.FIELD: json.dumps(DEFS)}).name

	def setUp(self):
		if self.skip:
			self.skipTest("the custom field rv_variables is not installed")

	def test_document_format(self):
		with self.as_user("accountant"):
			options = doc_api.get_doc_print_options("Journal Entry", self.je)
			self.assertEqual(
				[d["fieldname"] for d in options["print_format_variables"][self.doc_format]],
				[d["fieldname"] for d in DEFS],
			)
			out = doc_api.render_doc_print("Journal Entry", self.je, self.doc_format)
			self.assertIn("D=1 L=Short C= N=2 R=1.5", out["html"])
			out = doc_api.render_doc_print(
				"Journal Entry",
				self.je,
				self.doc_format,
				json.dumps({"show_details": 0, "layout": "Long", "pick_company": COMPANY, "copies": 3}),
			)
			self.assertIn(f"D=0 L=Long C={COMPANY} N=3 R=1.5", out["html"])
			with self.assertRaises(RVInvalidInput):
				doc_api.render_doc_print(
					"Journal Entry", self.je, self.doc_format, json.dumps({"layout": "x"})
				)
			with self.assertRaises(frappe.PermissionError):
				doc_api.render_doc_print(
					"Journal Entry", self.je, self.doc_format, json.dumps({"pick_company": "No Such Company"})
				)

	def test_frappes_own_print_gets_the_defaults(self):
		from frappe.www.printview import get_html_and_style

		with self.as_user("accountant"):
			out = get_html_and_style("Journal Entry", self.je, print_format=self.doc_format, no_letterhead=1)
		self.assertIn("D=1 L=Short C= N=2 R=1.5", out["html"])

	def test_report_format(self):
		meta = [{"fieldname": "company", "label": "Company", "fieldtype": "Link"}]
		with self.as_user("accountant"):
			options = report_api.get_print_options("Trial Balance", COMPANY)
			self.assertIn(self.report_format, options["print_format_variables"])
			out = report_api.render_print_format(
				"Trial Balance", self.report_format, TB_FILTERS, TB_JS_FILTERS, meta
			)
			self.assertIn("D=1 L=Short C= N=2 R=1.5", out["html"])
			out = report_api.render_print_format(
				"Trial Balance",
				self.report_format,
				TB_FILTERS,
				TB_JS_FILTERS,
				meta,
				variables=json.dumps({"show_details": False, "rate": 4}),
			)
			self.assertIn("D=0 L=Short C= N=2 R=4.0", out["html"])

	def test_custom_format(self):
		with self.as_user("accountant"):
			options = custom_api.get_options(self.custom_format)
			self.assertIn(self.custom_format, options["print_format_variables"])
			out = custom_api.render(self.custom_format, data={})
			self.assertIn("D=1 L=Short C= N=2 R=1.5", out["html"])
			out = custom_api.render(self.custom_format, data={}, variables=json.dumps({"layout": "Long"}))
			self.assertIn("D=1 L=Long C= N=2 R=1.5", out["html"])
			with self.assertRaises(frappe.PermissionError):
				custom_api.render(self.custom_format, data={}, variables={"pick_company": "No Such Company"})
		# a user restricted to the other company may not print with this one
		with self.as_user("restricted"):
			out = custom_api.render(self.custom_format, data={}, variables={"pick_company": OTHER_COMPANY})
			self.assertIn(f"C={OTHER_COMPANY}", out["html"])
			with self.assertRaises(frappe.PermissionError):
				custom_api.render(self.custom_format, data={}, variables={"pick_company": COMPANY})


class TestPresets(RVTestCase):
	def test_a_preset_keeps_the_values_per_format_plain_values_only(self):
		ok = {"variables": {"My Format": {"show": True, "n": 3, "s": "x"}}}
		self.assertEqual(print_presets.clean_settings(json.dumps(ok)), ok)
		for bad in (
			{"variables": [1]},
			{"variables": {"F": {"x": {"a": 1}}}},
			{"variables": {"F": {"x": "y" * 141}}},
			{"variables": {"F": [1]}},
		):
			with self.subTest(bad=bad), self.assertRaises(RVInvalidInput):
				print_presets.clean_settings(json.dumps(bad))
