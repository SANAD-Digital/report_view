// Variables of a print format (ADR-024, report_view/print_variables.js): the dialog's
// checks (as the server's), the values the pages send, and their place in the settings.
import { test } from "node:test";
import assert from "node:assert/strict";
import "./_setup.mjs";
import "./_json.mjs";

const pv = await import("../../report_view/public/js/report_view/print_variables.js");
const { sanitize_settings, DEFAULT_SETTINGS } = await import("../../report_view/public/js/report_view/views/pages/settings.js");
const { TARGET_KEYS, preset_payload } = await import("../../report_view/public/js/report_view/views/print_presets.js");

const DEFS = [
	{ label: "Show details", fieldname: "show_details", fieldtype: "Check", default: "1" },
	{ label: "Layout", fieldname: "layout", fieldtype: "Select", options: "Short\nLong\n", default: "Short" },
	{ label: "Customer", fieldname: "customer", fieldtype: "Link", options: "Customer" },
	{ label: "Copies", fieldname: "copies", fieldtype: "Int", default: "2" },
	{ label: "Rate", fieldname: "rate", fieldtype: "Float", default: "" },
];

test("valid rows: normalised as the server stores them", () => {
	const { defs, errors } = pv.validate_definitions(DEFS);
	assert.deepEqual(errors, []);
	assert.deepEqual(
		defs.map((d) => [d.fieldname, d.default]),
		[
			["show_details", 1],
			["layout", "Short"],
			["customer", ""],
			["copies", 2],
			["rate", 0],
		]
	);
	assert.equal(defs[1].options, "Short\nLong");
	// an empty row of the table is not a variable
	assert.deepEqual(pv.validate_definitions([{}, { label: "" }]).defs, []);
});

test("mistakes are named, one per row", () => {
	const base = { label: "X", fieldname: "x", fieldtype: "Check" };
	const cases = [
		[{ ...base, fieldname: "X" }],
		[{ ...base, fieldname: "1x" }],
		[{ ...base, fieldname: "a".repeat(41) }],
		[{ ...base, fieldname: "doc" }],
		[{ ...base, fieldname: "_" }],
		[base, { ...base, label: "Y" }],
		[{ ...base, fieldtype: "Data" }],
		[{ ...base, label: "", fieldname: "y" }],
		[{ ...base, fieldtype: "Select", options: "" }],
		[{ ...base, fieldtype: "Select", options: "A\nA" }],
		[{ ...base, fieldtype: "Select", options: "A\nB", default: "C" }],
		[{ ...base, fieldtype: "Link", options: "" }],
		[{ ...base, fieldtype: "Int", default: "1.5" }],
		[{ ...base, fieldtype: "Float", default: "abc" }],
		Array.from({ length: pv.MAX_VARIABLES + 1 }, (_, i) => ({ ...base, fieldname: `v${i}` })),
	];
	for (const rows of cases) assert.ok(pv.validate_definitions(rows).errors.length > 0, JSON.stringify(rows).slice(0, 80));
});

test("values: the saved ones still valid, else the defaults", () => {
	const { defs } = pv.validate_definitions(DEFS);
	assert.deepEqual(pv.values_for(defs, null), { show_details: 1, layout: "Short", customer: "", copies: 2, rate: 0 });
	assert.deepEqual(pv.values_for(defs, { show_details: 0, layout: "Medium", customer: "ACME", copies: 1.5, rate: "2.5", other: 1 }), {
		show_details: 0,
		layout: "Short",
		customer: "ACME",
		copies: 2,
		rate: 2.5,
	});
	assert.equal(pv.to_number("Float", "1e13"), null);
	assert.equal(pv.to_number("Int", "3"), 3);
	assert.equal(pv.to_number("Int", ""), null);
});

test("parse_definitions reads the field, never throws", () => {
	assert.deepEqual(pv.parse_definitions(""), []);
	assert.deepEqual(pv.parse_definitions("{bad"), []);
	assert.deepEqual(pv.parse_definitions(JSON.stringify([{ fieldname: "ok", fieldtype: "Check" }, { fieldname: "Bad", fieldtype: "Check" }, 3])).length, 1);
});

test("the settings keep the values per format, plain values only", () => {
	assert.deepEqual(DEFAULT_SETTINGS.variables, {});
	const s = sanitize_settings({ variables: { "My Format": { show: true, n: 3, s: "x", bad: { a: 1 }, BAD: 1, long: "x".repeat(200) }, "": { a: 1 }, other: "no" } });
	assert.deepEqual(s.variables, { "My Format": { show: true, n: 3, s: "x" } });
	assert.deepEqual(sanitize_settings({ variables: [1] }).variables, {});
	// a copy: the defaults never change
	sanitize_settings(null).variables.x = {};
	assert.deepEqual(DEFAULT_SETTINGS.variables, {});
});

test("presets: the values belong to the target, like the template", () => {
	assert.ok(TARGET_KEYS.includes("variables"));
	const settings = { ...DEFAULT_SETTINGS, variables: { F: { a: 1 } } };
	assert.deepEqual(preset_payload(settings, DEFAULT_SETTINGS).variables, { F: { a: 1 } });
	assert.equal(preset_payload(settings, DEFAULT_SETTINGS, { specific: false }).variables, undefined);
});
