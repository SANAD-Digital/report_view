// Quick filters as engine expressions, the view state that keeps them, and the engine paths
// behind them: counts, unique values and summary totals under a quick filter; no handle left.
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
import { to_view_config, quick_filter_terms, QUICK_PREFIX } from "../../report_view/public/js/report_view/engine/view_config.js";
import { EngineHandles, ReportSession } from "../../report_view/public/js/report_view/engine/perspective_engine.js";

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
