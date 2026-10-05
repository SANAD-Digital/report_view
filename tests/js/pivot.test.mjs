// Pivot (analysis) mode (phase 5b tasks 2, 3 and 5): the pivot of a view state
// (engine/pivot_config.js), and, in the Perspective engine for node, its numbers against a
// manual check on the fixture rows, its totals against the grid's, the drill-down rows and
// the handle lifecycle of pivot views.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import perspective from "@finos/perspective";

import { normalize } from "../../report_view/public/js/report_view/adapter/normalize.js";
import { default_state, sanitize } from "../../report_view/public/js/report_view/state/view_state.js";
import { build_search, decode_state } from "../../report_view/public/js/report_view/state/url.js";
import { EngineHandles, ReportSession } from "../../report_view/public/js/report_view/engine/perspective_engine.js";
import {
	MAX_PIVOT_COLUMNS,
	pivot_dimensions,
	pivot_measures,
	default_pivot,
	resolve_pivot,
	to_pivot_config,
	drill_config,
	split_value,
} from "../../report_view/public/js/report_view/engine/pivot_config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "../../report_view/tests/fixtures/normalize");
const load = (name) => normalize(JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8")).input);
const state = (patch = {}) => ({ ...default_state(), ...patch });
const TOLERANCE = 0.005;
const handles = new EngineHandles(perspective);

after(async () => {
	await handles.delete_all();
});

function close(actual, expected, label) {
	assert.ok(Math.abs((actual ?? 0) - (expected ?? 0)) < TOLERANCE, `${label}: ${actual} != ${expected}`);
}

async function with_session(report, fn) {
	const session = await ReportSession.create(handles, report, { locale: "ar" });
	try {
		return await fn(session);
	} finally {
		await session.close();
	}
}

// Sum of a measure over the facts that match every {key: value} (the manual check).
function manual(report, match, key) {
	let sum = 0;
	let count = 0;
	for (const row of report.facts) {
		if (Object.entries(match).every(([k, v]) => (row[k] ?? null) === v)) {
			sum += Number(row[key]) || 0;
			count += 1;
		}
	}
	return { sum, count };
}

// ------------------------------------------------------------------ pivot of a view state

test("pivot dimensions and measures: tree levels first, text/date/check columns; numeric measures", () => {
	const tb = load("trial_balance_fy2026");
	assert.deepEqual(
		pivot_dimensions(tb).map((d) => d.key),
		["level_1", "level_2", "level_3", "account"]
	);
	assert.deepEqual(pivot_measures(tb), ["opening_debit", "opening_credit", "debit", "credit", "closing_debit", "closing_credit"]);
	const ar = load("accounts_receivable_frappe_total");
	const dims = pivot_dimensions(ar).map((d) => d.key);
	assert.ok(dims.includes("party") && dims.includes("posting_date") && dims.includes("voucher_type"));
	assert.ok(!dims.includes("invoiced"));
});

test("default pivot: register.pivot, else the top-level groups or the first linked dimension, no pivot columns, first measure", () => {
	const tb = load("trial_balance_fy2026");
	assert.deepEqual(default_pivot(tb, {}, "account"), {
		rows: ["level_1"],
		cols: [],
		values: [{ key: "opening_debit", agg: "sum" }],
		totals: { rows: true, cols: true },
	});
	const own = { pivot: { rows: ["level_1", "level_2"], values: [{ key: "closing_debit", agg: "sum" }, { key: "closing_credit", agg: "sum" }] } };
	const tb_default = default_pivot(tb, own, "account");
	assert.deepEqual(tb_default.rows, ["level_1", "level_2"]);
	assert.deepEqual(tb_default.values.map((v) => v.key), ["closing_debit", "closing_credit"]);
	const ar = load("accounts_receivable_frappe_total");
	const p = default_pivot(ar, {}, "posting_date");
	assert.deepEqual(p.rows, ["party"]);
	assert.deepEqual(p.cols, []);
	assert.deepEqual(p.values, [{ key: "invoiced", agg: "sum" }]);
	const gl = load("general_ledger_consolidated");
	assert.deepEqual(default_pivot(gl, {}, "posting_date").rows, ["account"]);
});

test("resolve_pivot keeps what fits the report; a pivot column is never also a row; no rows or values fall back", () => {
	const ar = load("accounts_receivable_frappe_total");
	const p = resolve_pivot(
		state({ pivot: { rows: ["party", "nope"], cols: ["party", "voucher_type"], values: [{ key: "paid", agg: "avg" }, { key: "nope", agg: "sum" }, { key: "paid", agg: "avg" }] } }),
		ar,
		{},
		"posting_date"
	);
	assert.deepEqual(p.rows, ["party"]);
	assert.deepEqual(p.cols, ["voucher_type"]);
	assert.deepEqual(p.values, [{ key: "paid", agg: "avg" }]);
	const empty = resolve_pivot(state({ pivot: { rows: [], cols: [], values: [] } }), ar, {}, "posting_date");
	assert.deepEqual(empty.rows, ["party"]);
	assert.deepEqual(empty.values, [{ key: "invoiced", agg: "sum" }]);
});

test("view state: pivot is sanitized, makes the view a non-default one and goes through the URL", () => {
	const s = sanitize({
		v: 1,
		mode: "pivot",
		pivot: { rows: ["a", 3], cols: ["b"], values: [{ key: "x", agg: "max" }, { key: "y", agg: "median" }], totals: { cols: false }, junk: 1 },
	});
	assert.equal(s.mode, "pivot");
	assert.deepEqual(s.pivot, { rows: ["a"], cols: ["b"], values: [{ key: "x", agg: "max" }], totals: { rows: true, cols: false } });
	assert.equal(sanitize({ v: 1, pivot: "x" }).pivot, null);
	assert.equal(default_state().pivot, null);
	const { search } = build_search({}, s, "/desk/report-view/X", default_state());
	const rv = new URLSearchParams(search).get("rv");
	assert.deepEqual(sanitize(decode_state(rv)).pivot, s.pivot);
	assert.equal(build_search({}, default_state(), "/desk/report-view/X", default_state()).search, "");
});

test("pivot config: group_by rows, split_by columns, values as engine columns with their aggregate, report order", () => {
	const ar = load("accounts_receivable_frappe_total");
	const pivot = { rows: ["party"], cols: ["voucher_type"], values: [{ key: "invoiced", agg: "sum" }, { key: "invoiced", agg: "max" }], totals: { rows: true, cols: true } };
	const spec = to_pivot_config(state(), ar, pivot);
	assert.deepEqual(spec.config.group_by, ["party"]);
	assert.deepEqual(spec.config.split_by, ["voucher_type"]);
	assert.deepEqual(spec.config.columns, ["__pv0", "__pv1"]);
	assert.equal(spec.config.aggregates.__pv0, "sum");
	assert.equal(spec.config.aggregates.__pv1, "high");
	assert.deepEqual(spec.config.sort, [["__sort__party", "asc"], ["__sort__voucher_type", "col asc"]]);
	assert.deepEqual(spec.totals.split_by, undefined);
	assert.ok(spec.totals.columns.includes("__kind"));
	assert.deepEqual(spec.totals.sort, [["__sort__party", "asc"]]);
	assert.equal(spec.count.length, 2);
	// a filter of the page is the pivot's filter
	const filtered = to_pivot_config(state({ filters: [{ key: "party", type: "text", op: "contains", value: "a" }] }), ar, pivot);
	assert.deepEqual(filtered.config.filter, [["party", "contains", "a"]]);
	assert.deepEqual(filtered.totals.filter, [["party", "contains", "a"]]);
	// too many split columns: drawn without the split, said in a notice
	const many = to_pivot_config(state(), ar, pivot, { split_columns: MAX_PIVOT_COLUMNS + 1 });
	assert.deepEqual(many.config.split_by, []);
	assert.equal(many.post.blocked, true);
	assert.deepEqual(many.post.notices.map((n) => n.code), ["PIVOT_TOO_MANY_COLUMNS"]);
	assert.equal(to_pivot_config(state(), ar, pivot, { split_columns: MAX_PIVOT_COLUMNS }).post.blocked, false);
	// tree levels sort in report order
	const tb = load("trial_balance_fy2026");
	const t = to_pivot_config(state(), tb, { rows: ["level_1", "level_2"], cols: [], values: [{ key: "debit", agg: "sum" }] });
	assert.deepEqual(t.config.sort, [["__path", "asc"]]);
	assert.equal(t.count, null);
});

test("drill config: the row path and the column path as filter terms, nulls as 'is null', dates as dates", () => {
	const ar = load("accounts_receivable_frappe_total");
	const pivot = { rows: ["party", "posting_date"], cols: ["voucher_type"], values: [{ key: "paid", agg: "sum" }] };
	const spec = to_pivot_config(state({ filters: [{ key: "party", type: "text", op: "contains", value: "x" }] }), ar, pivot);
	const value = spec.post.values[0];
	const c = drill_config(spec.post, ["P1", Date.UTC(2026, 0, 5)], [split_value(spec.post.dims.voucher_type, "null")], value, "posting_date");
	assert.deepEqual(c.filter, [
		["party", "contains", "x"],
		["party", "==", "P1"],
		["posting_date", "==", "2026-01-05"],
		["voucher_type", "is null", null],
	]);
	assert.deepEqual(c.columns, ["__rid", "posting_date", "paid"]);
	assert.deepEqual(drill_config(spec.post, [], [], value, null).filter, [["party", "contains", "x"]]);
});

// ------------------------------------------------------------------ engine

async function pivot_cells(opened) {
	const out = { paths: [], cells: {}, totals: null };
	const t = await opened.totals.to_columns();
	out.paths = t.__ROW_PATH__;
	out.totals = t;
	if (opened.view) {
		const p = await opened.view.to_columns();
		assert.deepEqual(p.__ROW_PATH__, t.__ROW_PATH__, "the two views have the same rows");
		out.cells = p;
	}
	return out;
}

test("receivables: pivot values = a manual check on three combinations; totals = the grid's total", async () => {
	const ar = load("accounts_receivable_frappe_total");
	await with_session(ar, async (session) => {
		const pivot = { rows: ["party"], cols: ["voucher_type"], values: [{ key: "invoiced", agg: "sum" }, { key: "paid", agg: "count" }], totals: { rows: true, cols: true } };
		const opened = await session.open_pivot(state(), pivot);
		const data = await pivot_cells(opened);
		const parties = [...new Set(ar.facts.map((r) => r.party))];
		const types = [...new Set(ar.facts.map((r) => r.voucher_type))];
		let checked = 0;
		for (const party of parties) {
			for (const type of types) {
				const m = manual(ar, { party, voucher_type: type }, "invoiced");
				if (!m.count) continue;
				const i = data.paths.findIndex((p) => p.length === 1 && p[0] === party);
				close(data.cells[`${type}|__pv0`][i], m.sum, `${party} / ${type}`);
				assert.equal(data.cells[`${type}|__pv1`][i], m.count, `${party} / ${type} count`);
				checked += 1;
			}
		}
		assert.ok(checked >= 3, `combinations checked: ${checked}`);
		// totals column of a row = the row over every pivot column; grand total = the grid's
		const party = parties[0];
		const i = data.paths.findIndex((p) => p.length === 1 && p[0] === party);
		close(data.totals.__pv0[i], manual(ar, { party }, "invoiced").sum, "row total");
		const grid = await session.open(state(), "grid");
		close(opened.total.__pv0, grid.totals.values.invoiced, "grand total = the grid's");
		assert.equal(opened.total.__kind, ar.facts.length);
		await session.close_view(grid);
		// drill-down: the facts of a cell, as many as its count
		const type = types[0];
		const at = data.paths.findIndex((p) => p.length === 1 && manual(ar, { party: p[0], voucher_type: type }, "invoiced").count > 0);
		const drill = await session.pivot_drill(opened, data.paths[at], [type], opened.post.values[0], "posting_date");
		assert.equal(drill.count, data.cells[`${type}|__pv1`][at]);
		assert.equal(drill.rids.length, drill.count);
		await session.close_pivot(opened);
	});
});

test("general ledger: two pivot columns, manual check; trial balance by tree levels in report order", async () => {
	const gl = load("general_ledger_consolidated");
	await with_session(gl, async (session) => {
		const pivot = { rows: ["account"], cols: ["voucher_type", "party_type"], values: [{ key: "debit", agg: "sum" }] };
		const opened = await session.open_pivot(state(), pivot);
		const data = await pivot_cells(opened);
		let checked = 0;
		for (const name of opened.column_paths) {
			const [vt, pt] = name.split("|");
			const match = { voucher_type: split_value({ type: "string" }, vt), party_type: split_value({ type: "string" }, pt) };
			for (let i = 1; i < data.paths.length && checked < 6; i++) {
				const m = manual(gl, { ...match, account: data.paths[i][0] }, "debit");
				if (!m.count) continue;
				close(data.cells[name][i], m.sum, `${data.paths[i][0]} / ${name}`);
				checked += 1;
			}
		}
		assert.ok(checked >= 3);
		const grid = await session.open(state(), "grid");
		close(opened.total.__pv0, grid.totals.values.debit, "grand total");
		await session.close_view(grid);
		await session.close_pivot(opened);
	});
	const tb = load("trial_balance_fy2026");
	await with_session(tb, async (session) => {
		const opened = await session.open_pivot(state(), { rows: ["level_1", "level_2"], cols: [], values: [{ key: "debit", agg: "sum" }] });
		assert.equal(opened.view, null);
		const t = await opened.totals.to_columns();
		// report order: the first top-level group is the first top-level row of the report
		const first_top = tb.rows.find((r) => r.__parent === null || r.__parent === undefined);
		assert.ok(String(t.__ROW_PATH__[1][0]).includes(first_top.account.split(" - ")[0]));
		// period debit: the report's leaves add up to its total
		const leaves = tb.facts.reduce((a, r) => a + (r.debit || 0), 0);
		close(opened.total.__pv0, leaves, "tb debit");
		// fold: both views in step
		const tops = await session.open_pivot(state(), { rows: ["level_1"], cols: [], values: [{ key: "debit", agg: "sum" }] });
		assert.ok(opened.body_rows > tops.body_rows);
		assert.equal(await session.fold_pivot(opened, { depth: 0 }), tops.body_rows);
		assert.equal(await session.fold_pivot(opened, { row: 1, open: true }) > tops.body_rows, true);
		await session.close_pivot(tops);
		await session.close_pivot(opened);
	});
});

test("pivot views: a superseded pivot is deleted, nothing is left after 20 changes", async () => {
	const ar = load("accounts_receivable_frappe_total");
	await with_session(ar, async (session) => {
		const a = session.open_pivot(state(), { rows: ["party"], cols: ["voucher_type"], values: [{ key: "paid", agg: "sum" }] });
		const b = session.open_pivot(state(), { rows: ["voucher_type"], cols: [], values: [{ key: "paid", agg: "sum" }] });
		const [ra, rb] = await Promise.all([a, b]);
		assert.equal(ra, null);
		assert.ok(rb);
		await session.close_pivot(rb);
		let previous = null;
		for (let i = 0; i < 20; i++) {
			const p = await session.open_pivot(state(), { rows: [i % 2 ? "party" : "voucher_type"], cols: i % 3 ? ["currency"] : [], values: [{ key: "paid", agg: "sum" }] });
			if (previous) await session.close_pivot(previous);
			previous = p;
		}
		await session.close_pivot(previous);
		assert.deepEqual(
			handles.debug_handles().filter((h) => h.kind === "view"),
			[]
		);
	});
	assert.deepEqual(handles.debug_handles(), []);
});
