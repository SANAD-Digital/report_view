// Design parity, wave 1 (docs/progress/phase-5a2-wave1.md): period presets and fiscal parts,
// quick filters as engine expressions, the default column order, the criteria bar plan, the
// set filter selection, number parsing, view state keys, and the engine paths behind them
// (counts, unique values and summary totals under a quick filter; no handle left).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import perspective from "@finos/perspective";

import { normalize } from "../../report_view/public/js/report_view/adapter/normalize.js";
import { apply_enrichment } from "../../report_view/public/js/report_view/adapter/enrich.js";
import { default_state, sanitize, reconcile } from "../../report_view/public/js/report_view/state/view_state.js";
import { build_search } from "../../report_view/public/js/report_view/state/url.js";
import {
	to_view_config,
	quick_filter_terms,
	ordered_columns,
	visible_columns,
	QUICK_PREFIX,
} from "../../report_view/public/js/report_view/engine/view_config.js";
import { EngineHandles, ReportSession } from "../../report_view/public/js/report_view/engine/perspective_engine.js";
import {
	preset_list,
	fiscal_range,
	fiscal_part_of,
	month_cells,
	week_columns,
	days_between,
	eom,
} from "../../report_view/public/js/report_view/filters/periods.js";
import { plan_criteria } from "../../report_view/public/js/report_view/filters/criteria.js";
import { toggle_value } from "../../report_view/public/js/report_view/components/set_filter.js";
import { parse_number } from "../../report_view/public/js/report_view/components/header_cells.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "../../report_view/tests/fixtures/normalize");
const load = (name) => normalize(JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8")).input);
const handles = new EngineHandles(perspective);

const NOT_ZERO = (key) => `abs("${key}") > 0.005`;
const QUICK = [
	{ id: "moving", expression: `${NOT_ZERO("debit")} or ${NOT_ZERO("credit")}` },
	{ id: "debit_closing", expression: NOT_ZERO("closing_debit"), exclusive: "side" },
];

// Trial balance with its account enrichment, as the page has it after api.enrich.
function trial_balance() {
	const report = load("trial_balance_fy2026");
	const values = {};
	for (const r of report.rows) if (r.account) values[r.account] = { root_type: r.account.startsWith("1") ? "Asset" : "Expense", account_type: null };
	apply_enrichment(report, { source_column: "account", link_doctype: "Account" }, values, ["root_type", "account_type"], (f) => f, {
		root_type: { fieldtype: "Select", options: "Asset\nExpense" },
	});
	return report;
}

after(async () => {
	assert.deepEqual(handles.debug_handles(), []);
});

test("period presets: ranges of the design, fiscal years when known", () => {
	const fys = [
		{ name: "2025", from: "2025-04-01", to: "2026-03-31" },
		{ name: "2026", from: "2026-04-01", to: "2027-03-31" },
	];
	const list = preset_list("2026-10-07", { first_day: 0, fiscal_years: fys });
	const by = Object.fromEntries(list.filter((p) => !p.sep).map((p) => [p.id, [p.from, p.to]]));
	assert.deepEqual(by.today, ["2026-10-07", "2026-10-07"]);
	assert.deepEqual(by.yesterday, ["2026-10-06", "2026-10-06"]);
	assert.deepEqual(by.last_7, ["2026-10-01", "2026-10-07"]);
	assert.deepEqual(by.week, ["2026-10-04", "2026-10-10"]);
	assert.deepEqual(by.month, ["2026-10-01", "2026-10-31"]);
	assert.deepEqual(by.last_month, ["2026-09-01", "2026-09-30"]);
	assert.deepEqual(by.quarter, ["2026-10-01", "2026-12-31"]);
	assert.deepEqual(by.last_quarter, ["2026-07-01", "2026-09-30"]);
	assert.deepEqual(by.last_6_months, ["2026-05-01", "2026-10-31"]);
	assert.deepEqual(by.fiscal_year, ["2026-04-01", "2027-03-31"]);
	assert.deepEqual(by.last_year, ["2025-04-01", "2026-03-31"]);
	assert.deepEqual(by.year_to_date, ["2026-04-01", "2026-10-07"]);
	assert.equal(list.filter((p) => p.sep).length, 2);
	// Monday first: the week starts on the Monday before
	const monday = preset_list("2026-10-07", { first_day: 1 }).find((p) => p.id === "week");
	assert.deepEqual([monday.from, monday.to], ["2026-10-05", "2026-10-11"]);
	// no fiscal year: calendar years
	const cal = preset_list("2026-10-07").find((p) => p.id === "fiscal_year");
	assert.deepEqual([cal.from, cal.to], ["2026-01-01", "2026-12-31"]);
	assert.equal(eom(2028, 1), "2028-02-29");
	assert.equal(days_between("2026-04-01", "2026-09-30"), 183);
});

test("fiscal parts: months of the fiscal year, and back from a range", () => {
	const fy = { name: "2026", from: "2026-04-01", to: "2027-03-31" };
	assert.deepEqual(fiscal_range(fy, 0, 11), ["2026-04-01", "2027-03-31"]);
	assert.deepEqual(fiscal_range(fy, 3, 5), ["2026-07-01", "2026-09-30"]);
	assert.deepEqual(fiscal_range(fy, 9, 11), ["2027-01-01", "2027-03-31"]);
	assert.deepEqual(fiscal_part_of(fy, "2026-07-01", "2026-09-30"), { m0: 3, m1: 5 });
	assert.equal(fiscal_part_of(fy, "2026-07-02", "2026-09-30"), null);
});

test("calendar grid: blanks before the first day, columns from the first weekday", () => {
	const apr = month_cells(2026, 3, 0);
	assert.equal(apr.filter((d) => d === null).length, 3); // 1 April 2026 is a Wednesday
	assert.equal(apr.at(-1), "2026-04-30");
	assert.equal(month_cells(2026, 3, 1).filter((d) => d === null).length, 2);
	assert.deepEqual(week_columns(6), [6, 0, 1, 2, 3, 4, 5]);
});

test("quick filters: boolean expressions of the engine, filtered with == true", () => {
	const out = quick_filter_terms({ quick_filters: ["moving", "nope"] }, QUICK);
	assert.deepEqual(out.filter, [[`${QUICK_PREFIX}moving`, "==", true]]);
	assert.deepEqual(Object.keys(out.expressions), [`${QUICK_PREFIX}moving`]);
	assert.deepEqual(out.notices, [{ code: "QUICK_FILTER_UNKNOWN", detail: "nope" }]);
	// a tree with a quick filter is re-grouped on the facts, the expression goes with every view
	const report = trial_balance();
	const { table, config, post } = to_view_config({ ...default_state(), quick_filters: ["moving"] }, report, "grid", { quick_filters: QUICK });
	assert.equal(table, "facts");
	assert.equal(post.shape, "levels");
	assert.ok(config.filter.some(([name]) => name === `${QUICK_PREFIX}moving`));
	assert.equal(config.expressions[`${QUICK_PREFIX}moving`], QUICK[0].expression);
	assert.deepEqual(post.filter_expressions, { [`${QUICK_PREFIX}moving`]: QUICK[0].expression });
});

test("column order: enrichment columns stand right after their source column", () => {
	const report = trial_balance();
	const keys = ordered_columns(report).map((c) => c.key);
	assert.deepEqual(keys.slice(0, 3), ["account", "account__root_type", "account__account_type"]);
	const shown = visible_columns(report, sanitize(default_state({ default_hidden: ["account__root_type"] })));
	assert.deepEqual(shown.slice(0, 3).map((c) => c.key), ["account", "account__account_type", "opening_debit"]);
	// an explicit order still wins
	const ordered = visible_columns(report, { columns: { hidden: [], order: ["credit", "account"] } });
	assert.deepEqual(ordered.slice(0, 2).map((c) => c.key), ["credit", "account"]);
});

test("view state: quick filters, aggregates and the side panel are kept; default hidden columns are no change", () => {
	const s = sanitize({ quick_filters: ["moving", 3], values: [{ key: "debit", agg: "avg" }, { key: "x", agg: "median" }], ui: { side_panel: "filters" } });
	assert.deepEqual(s.quick_filters, ["moving"]);
	assert.deepEqual(s.values, [{ key: "debit", agg: "avg" }]);
	assert.equal(s.ui.side_panel, "filters");
	const base = default_state({ default_hidden: ["account__root_type"] });
	assert.equal(build_search({}, sanitize(base, { default_hidden: ["account__root_type"] }), "/p", base).search, "");
	assert.match(build_search({}, sanitize({ quick_filters: ["moving"] }), "/p", base).search, /rv=/);
	const shown = { ...sanitize(base), columns: { ...base.columns, hidden: [] } };
	assert.match(build_search({}, shown, "/p", base).search, /rv=/);
	const r = reconcile(sanitize({ values: [{ key: "gone", agg: "sum" }, { key: "debit", agg: "max" }] }), [{ key: "debit" }]);
	assert.deepEqual(r.values, [{ key: "debit", agg: "max" }]);
});

test("criteria bar: company and period on the line, required filters never hidden, the rest behind More options", () => {
	const tb = plan_criteria([
		{ fieldname: "company", fieldtype: "Link", reqd: 1 },
		{ fieldname: "fiscal_year", fieldtype: "Link", reqd: 1 },
		{ fieldname: "from_date", fieldtype: "Date" },
		{ fieldname: "to_date", fieldtype: "Date" },
		{ fieldname: "cost_center", fieldtype: "MultiSelectList" },
		{ fieldname: "show_zero_values", fieldtype: "Check" },
	]);
	assert.equal(tb.has_period, true);
	assert.deepEqual(Object.fromEntries(tb.place), {
		company: "main",
		fiscal_year: "period",
		from_date: "period",
		to_date: "period",
		cost_center: "more",
		show_zero_values: "more",
	});
	const ar = plan_criteria([
		{ fieldname: "company", fieldtype: "Link", reqd: 1 },
		{ fieldname: "report_date", fieldtype: "Date" },
		{ fieldname: "party_type", fieldtype: "Link", reqd: 1 },
		{ fieldname: "range", fieldtype: "Data" },
	]);
	assert.equal(ar.has_period, false);
	assert.deepEqual(Object.fromEntries(ar.place), { company: "main", report_date: "main", party_type: "main", range: "more" });
});

test("criteria bar: hidden filters stay hidden; a Timespan the dates depend on belongs to the period", () => {
	// Shape of snd_accounting's party balance reports (Customer Trial Balance).
	const snd = plan_criteria([
		{ fieldname: "company", fieldtype: "Link", reqd: 1 },
		{ fieldname: "timespan", fieldtype: "Select", reqd: 1, default: "Select Date Range" },
		{ fieldname: "from_date", fieldtype: "Date", depends_on: "eval:doc.timespan == 'Select Date Range'" },
		{ fieldname: "to_date", fieldtype: "Date", depends_on: "eval:doc.timespan == 'Select Date Range'" },
		{ fieldname: "party_type", fieldtype: "Link", read_only: 1, hidden: 1 },
		{ fieldname: "party_name", fieldtype: "Data", hidden: 1 },
		{ fieldname: "party", fieldtype: "MultiSelectList" },
	]);
	assert.deepEqual(snd.range, { key: "timespan", value: "Select Date Range" });
	assert.deepEqual(Object.fromEntries(snd.place), {
		company: "main",
		timespan: "period",
		from_date: "period",
		to_date: "period",
		party_type: "hidden",
		party_name: "hidden",
		party: "more",
	});
});

test("set filter selection: null is everything; unticking one keeps the others; all again is null", () => {
	const all = ["A", "B", null];
	const one_off = toggle_value(null, all, "B");
	assert.deepEqual(one_off, ["A", null]);
	assert.equal(toggle_value(one_off, all, "B"), null);
	assert.deepEqual(toggle_value(["A"], all, ""), ["A", ""]);
	assert.equal(parse_number(" 1,234.50 "), 1234.5);
	assert.equal(parse_number("-12"), -12);
	assert.equal(parse_number("12a"), null);
	assert.equal(parse_number(""), null);
});

test("engine: counts, unique values and summary totals under a quick filter; temporary views deleted", async () => {
	const report = trial_balance();
	const session = await ReportSession.create(handles, report, { locale: "ar", quick_filters: QUICK });
	try {
		const moving = report.facts.filter((r) => Math.abs(r.debit || 0) > 0.005 || Math.abs(r.credit || 0) > 0.005);
		const state = { ...default_state(), quick_filters: ["moving"] };
		const opened = await session.open(state);
		assert.equal(opened.counts.shown, moving.length);
		assert.equal(opened.counts.total, report.facts.length);
		// totals of the summary: the engine's, = a sum by hand of the matching facts
		const totals = await session.summary_totals(opened, ["debit", "credit"]);
		const sum = (k) => moving.reduce((a, r) => a + (r[k] || 0), 0);
		assert.ok(Math.abs(totals.debit - sum("debit")) < 0.005);
		assert.ok(Math.abs(totals.credit - sum("credit")) < 0.005);
		// a hidden measure is read from a temporary totals view
		const hidden = { ...state, columns: { ...state.columns, hidden: ["opening_debit", "closing_debit"] } };
		const opened2 = await session.open(hidden);
		const t2 = await session.summary_totals(opened2, ["closing_debit"]);
		assert.ok(Math.abs(t2.closing_debit - sum("closing_debit")) < 0.005);
		await session.close_view(opened2);
		// unique values with their counts under the quick filter
		const uv = await session.unique_values(state, "account__root_type");
		const total = uv.values.reduce((a, v) => a + v.count, 0);
		assert.equal(total, moving.length);
		// without a filter: the report's own reference row (ADR-008)
		const plain = await session.open(default_state());
		const ref = await session.summary_totals(plain, ["closing_debit", "closing_credit"]);
		const row = report.report_totals.internal.at(-1);
		assert.equal(ref.closing_debit, row.closing_debit);
		await session.close_view(plain);
		await session.close_view(opened);
		assert.equal(handles.debug_handles().filter((h) => h.kind === "view").length, 0);
	} finally {
		await session.close();
	}
});

test("column groups: sanitized, one group per column, members kept side by side, bands from the user's groups", async () => {
	const { sanitize_groups, order_for_groups, header_bands } = await import("../../report_view/public/js/report_view/state/column_groups.js");
	assert.equal(sanitize_groups(undefined), null);
	assert.deepEqual(
		sanitize_groups([
			{ label: " Opening ", keys: ["od", "oc"] },
			{ label: "Dup", keys: ["oc", "cd"] },
			{ label: "", keys: ["x"] },
			{ label: "Empty", keys: [] },
		]),
		[
			{ label: "Opening", keys: ["od", "oc"] },
			{ label: "Dup", keys: ["cd"] },
		]
	);
	assert.deepEqual(order_for_groups(["a", "od", "b", "oc", "c"], [{ keys: ["od", "oc"] }]), ["a", "od", "oc", "b", "c"]);
	const user = header_bands({ columns: { groups: [{ label: "G", keys: ["od"] }] } }, { bands: [{ id: "x", label: "X" }], columns: { oc: { band: "x" } } });
	assert.equal(user.bands.get(user.band_of({ key: "od", fieldname: "od" })).label, "G");
	assert.equal(user.band_of({ key: "oc", fieldname: "oc" }), null);
	const report = header_bands({ columns: { groups: null } }, { bands: [{ id: "x", label: "X" }], columns: { oc: { band: "x" } } });
	assert.equal(report.band_of({ key: "oc", fieldname: "oc" }), "x");
});
