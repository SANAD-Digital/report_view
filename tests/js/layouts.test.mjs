// The trial layouts (ADR-025): what they share with the standard page and what they change in
// it, as pure functions: the drill's link keeps the page it was opened on, the default view
// of a trial layout puts a group's sums on its own row, and the filters read back as the
// chips and the sentence show them.
import { test } from "node:test";
import assert from "node:assert/strict";
import "./_setup.mjs";

globalThis.frappe ??= {};
frappe.datetime ??= { str_to_user: (d) => String(d).split("-").reverse().join("-") };
frappe.format ??= (v) => String(v);

const { drill_href } = await import("../../report_view/public/js/report_view/state/drill.js");
const { default_state } = await import("../../report_view/public/js/report_view/state/view_state.js");
const { value_text, filter_items, has_more, addable_controls } = await import("../../report_view/public/js/report_view/filters/filter_summary.js");
const { LAYOUTS } = await import("../../report_view/public/js/report_view/layouts/layout.js");

test("the trial layouts are A and C; the standard page is none of them", () => {
	assert.deepEqual(LAYOUTS, ["a", "c"]);
});

test("a drill's «Open in Report View» opens the page it came from (the standard one by default)", () => {
	assert.equal(drill_href("General Ledger", { company: "SND" }), "/desk/report-view/General%20Ledger?company=SND");
	assert.equal(drill_href("General Ledger", { company: "SND" }, "report-view-a"), "/desk/report-view-a/General%20Ledger?company=SND");
	assert.equal(drill_href("Trial Balance", {}, "report-view-c"), "/desk/report-view-c/Trial%20Balance");
});

test("default view: subtotals as before, unless the layout asks for the sums on the group row", () => {
	assert.equal(default_state({}).group.subtotals, true);
	assert.equal(default_state({ features: { subtotals: false } }).group.subtotals, false);
	assert.equal(default_state({ subtotals_default: false }).group.subtotals, false);
	// a standard page's config has no such key: the same default as always
	assert.deepEqual(default_state({ features: { subtotals: true } }).group, { by: [], subtotals: true, expanded: "all" });
});

test("a filter's value as a chip says it: a date in the user's format, a list as its value or its count, a tick", () => {
	assert.equal(value_text({ fieldtype: "Link" }, "SND Accounting"), "SND Accounting");
	assert.equal(value_text({ fieldtype: "Date" }, "2026-10-28"), "28-10-2026");
	assert.equal(value_text({ fieldtype: "MultiSelectList" }, ["1110"]), "1110");
	assert.equal(value_text({ fieldtype: "MultiSelectList" }, ["1110", "1310", "4110"]), "3 selected");
	assert.equal(value_text({ fieldtype: "MultiSelectList" }, []), "");
	assert.equal(value_text({ fieldtype: "Check" }, 1), "Yes");
	assert.equal(value_text({ fieldtype: "Select" }, "Categorize by Account"), "Categorize by Account");
	// a document type's name and an Autocomplete's choice read translated (the party type)
	const was = globalThis.__;
	globalThis.__ = (t, a) => ({ Customer: "عميل" })[t] ?? was(t, a);
	try {
		assert.equal(value_text({ fieldtype: "Autocomplete" }, "Customer"), "عميل");
		assert.equal(value_text({ fieldtype: "Link", options: "Party Type" }, "Customer"), "عميل");
		assert.equal(value_text({ fieldtype: "Link", options: "DocType" }, "Customer"), "عميل");
		assert.equal(value_text({ fieldtype: "Link", options: "Customer" }, "Customer"), "Customer");
	} finally {
		globalThis.__ = was;
	}
	assert.equal(value_text({ fieldtype: "Data" }, null), "");
});

test("the items of the head: the company, the period, the bar's filters, then the ones behind «More options» that hold a value", () => {
	const control = (df, value) => ({ df, get_value: () => value });
	const controls = [
		control({ fieldname: "company", label: "Company", fieldtype: "Link", reqd: 1 }, "SND"),
		control({ fieldname: "from_date", label: "From Date", fieldtype: "Date" }, "2026-09-28"),
		control({ fieldname: "to_date", label: "To Date", fieldtype: "Date" }, "2026-10-28"),
		control({ fieldname: "account", label: "Account", fieldtype: "MultiSelectList" }, ["1110", "1310"]),
		control({ fieldname: "party", label: "Party", fieldtype: "Link" }, ""),
		control({ fieldname: "with_closing", label: "With closing", fieldtype: "Check", default: 1 }, 1),
		control({ fieldname: "show_zero", label: "Show zero", fieldtype: "Check" }, 1),
		control({ fieldname: "cost_center", label: "Cost Center", fieldtype: "Link", hidden_due_to_dependency: true }, "Main"),
	];
	const place = new Map([["company", "main"], ["from_date", "period"], ["to_date", "period"], ["account", "more"], ["party", "more"], ["with_closing", "more"], ["show_zero", "more"], ["cost_center", "more"]]);
	const criteria = {
		plan: { keys: { company_key: "company" }, has_period: true, place },
		filters: { controls },
		period_values: () => ({ from: "2026-09-28", to: "2026-10-28" }),
	};
	const items = filter_items(criteria);
	assert.deepEqual(
		items.map((it) => [it.key, it.text]),
		[
			["company", "SND"],
			["__period", "28-09-2026 – 28-10-2026"],
			["account", "2 selected"],
			["show_zero", "Yes"],
		]
	);
	assert.equal(items[1].from, "28-09-2026");
	assert.equal(has_more(criteria), true);
	assert.deepEqual(filter_items(null), []);
});

test("a party's statement: the party always in the head, named by its type, even empty", () => {
	const control = (df, value) => ({ df, get_value: () => value });
	const controls = [
		control({ fieldname: "company", label: "Company", fieldtype: "Link" }, "SND"),
		control({ fieldname: "party_type", label: "Party Type", fieldtype: "Link", hidden: 1 }, "Customer"),
		control({ fieldname: "party", label: "Party", fieldtype: "MultiSelectList" }, []),
	];
	const place = new Map([["company", "main"], ["party_type", "hidden"], ["party", "more"]]);
	const criteria = { plan: { keys: { company_key: "company" }, has_period: false, place }, filters: { controls }, period_values: () => ({}) };
	assert.deepEqual(
		filter_items(criteria).map((it) => [it.key, it.label, Boolean(it.primary)]),
		[["company", "Company", false], ["party", "Customer", true]]
	);
	assert.deepEqual(addable_controls(criteria), []);
});
