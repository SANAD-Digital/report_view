// Configured drill (phase 5d, state/drill.js): the rules made valid, the rules a row offers, the
// target's filters made of a row and of the page's filters, the link to open the target; and the
// shipped Trial Balance -> General Ledger rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./_setup.mjs";

const { drill_rules, rules_for_row, map_filters, drill_href, link_open_of, MAX_RULES } = await import("../../report_view/public/js/report_view/state/drill.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const TB = JSON.parse(fs.readFileSync(path.resolve(here, "../../report_view/defaults/trial_balance.json"), "utf8"));

const GL = { label: "General Ledger", source_column: "account", report: "General Ledger", filters: { company: "filter:company", account: ["row:account"], from_date: "filter:from_date", categorize_by: "Categorize by Voucher (Consolidated)" } };

test("rules: valid ones kept, the rest dropped (the server refuses them on save)", () => {
	assert.deepEqual(drill_rules(null), []);
	const out = drill_rules([
		GL,
		{ label: "", source_column: "account", report: "X" },
		{ label: "Bad column", source_column: "acc-ount", report: "X" },
		{ label: "Bad filter", source_column: "account", report: "X", filters: { "a b": "row:account" } },
		{ label: "Bad value", source_column: "account", report: "X", filters: { a: { x: 1 } } },
		"nope",
	]);
	assert.deepEqual(out, [GL]);
	assert.equal(drill_rules(Array.from({ length: 30 }, (_, i) => ({ ...GL, label: `L${i}` }))).length, MAX_RULES);
});

test("a row offers the rules whose source column has a value", () => {
	const cols = [{ key: "account", fieldname: "account" }, { key: "account_name", fieldname: "account_name" }];
	assert.equal(rules_for_row([GL], { account: "1110 - Cash - SA" }, cols).length, 1);
	assert.equal(rules_for_row([GL], { account: "" }, cols).length, 0);
	assert.equal(rules_for_row([GL], null, cols).length, 0);
});

test("filters: row:, filter:, literals and lists; empty values left out", () => {
	const row = { account: "1110 - Cash - SA", account_name: "Cash" };
	const page = { company: "SND Accounting", from_date: "2026-01-01", to_date: "2026-12-31", cost_center: [] };
	const out = map_filters({ ...GL, filters: { ...GL.filters, to_date: "filter:to_date", cost_center: "filter:cost_center", project: "filter:project", party: ["row:party"] } }, row, page);
	assert.deepEqual(out, {
		company: "SND Accounting",
		account: ["1110 - Cash - SA"],
		from_date: "2026-01-01",
		to_date: "2026-12-31",
		categorize_by: "Categorize by Voucher (Consolidated)",
	});
	// a duplicated column of the report: the row's key of its fieldname
	const dup = map_filters({ filters: { account: "row:account" } }, { account_2: "X" }, {}, [{ key: "account_2", fieldname: "account" }]);
	assert.deepEqual(dup, { account: "X" });
	// a list filter of the page stays a list
	assert.deepEqual(map_filters({ filters: { cost_center: ["filter:cost_center"] } }, {}, { cost_center: ["A", "B"] }), { cost_center: ["A", "B"] });
});

test("the link of the target in Report View carries its filters", () => {
	const href = drill_href("General Ledger", { company: "SND", account: ["1110"] });
	assert.equal(href, "/desk/report-view/General%20Ledger?company=SND&account=%5B%221110%22%5D");
});

test("shipped: Trial Balance drills to the General Ledger of the account and the period", () => {
	const rules = drill_rules(TB.drilldowns);
	assert.equal(rules.length, 1);
	const [rule] = rules;
	assert.equal(rule.report, "General Ledger");
	const out = map_filters(rule, { account: "1110 - Cash - SA" }, { company: "SND Accounting", fiscal_year: "2026", from_date: "2026-01-01", to_date: "2026-12-31" });
	assert.deepEqual(out, {
		company: "SND Accounting",
		from_date: "2026-01-01",
		to_date: "2026-12-31",
		account: ["1110 - Cash - SA"],
		categorize_by: "Categorize by Voucher (Consolidated)",
	});
});

test("link_open: New tab by default; Same tab and Drawer as the settings say", () => {
	assert.equal(link_open_of(null), "new_tab");
	assert.equal(link_open_of({ link_open: "same_tab" }), "same_tab");
	assert.equal(link_open_of({ link_open: "Drawer" }), "drawer");
	assert.equal(link_open_of({ link_open: "elsewhere" }), "new_tab");
});
