// View state -> Perspective view config (docs/architecture.md §8أ.2).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalize } from "../../report_view/public/js/report_view/adapter/normalize.js";
import { default_state } from "../../report_view/public/js/report_view/state/view_state.js";
import {
	to_view_config,
	to_filter,
	toggle_tree_node,
	fold_all,
	pinned_columns,
	visible_columns,
	AGGREGATES,
} from "../../report_view/public/js/report_view/engine/view_config.js";
import { edge_rows } from "../../report_view/public/js/report_view/engine/report_rows.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "../../report_view/tests/fixtures/normalize");
const load = (name) => normalize(JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8")).input);
const state = (patch = {}) => ({ ...default_state(), ...patch });
const MEASURES = ["opening_debit", "opening_credit", "debit", "credit", "closing_debit", "closing_credit"];

test("aggregate names: max is 'high', never Perspective's 'max' or 'low'", () => {
	assert.deepEqual(AGGREGATES, {
		sum: "sum",
		avg: "avg",
		count: "count",
		count_distinct: "distinct count",
		min: "min",
		max: "high",
	});
	const values = Object.values(AGGREGATES);
	assert.equal(values.includes("max"), false);
	assert.equal(values.includes("low"), false);
});

test("tree 'as is': nodes table, no group_by, depth filter, path order, reference total row", () => {
	const report = load("trial_balance_fy2026");
	const { table, config, post } = to_view_config(state(), report, "grid");
	assert.equal(table, "nodes");
	assert.equal(post.shape, "tree");
	assert.deepEqual(config.group_by, []);
	assert.deepEqual(config.split_by, []);
	assert.deepEqual(config.filter, [["__depth", "<=", 3]]);
	assert.deepEqual(config.sort, [["__path", "asc"]]);
	assert.deepEqual(config.columns, ["account", ...MEASURES, "__rid", "__depth", "__has_children", "__leaves", "__path"]);
	assert.deepEqual(post.keys, ["account", ...MEASURES]);
	assert.equal(post.label_key, "account");
	assert.deepEqual(post.data_keys, MEASURES);
	assert.equal(post.row_offset, 0);
	assert.deepEqual(post.total, { source: "row", rid: 31 });
	assert.deepEqual(post.measures, MEASURES);
	assert.deepEqual(post.fact_filter, []);
	assert.equal(post.index.__rid, 7);
});

test("tree depth and explicit expansion become engine filters on the ancestor columns", () => {
	const report = load("trial_balance_fy2026");
	assert.deepEqual(to_view_config(state({ tree: { depth: 1, expanded: null } }), report).config.filter, [
		["__depth", "<=", 1],
	]);
	// by depth 1 the roots are open; closing 1000 leaves the other three roots open
	const expanded = toggle_tree_node(state({ tree: { depth: 1, expanded: null } }), report, 0);
	assert.deepEqual(expanded, [11, 17, 20]);
	const closed = to_view_config(state({ tree: { depth: 1, expanded } }), report).config.filter;
	assert.deepEqual(closed, [
		["__anc_1", "not in", [0]],
		["__anc_2", "not in", [12, 18, 21, 26]],
	]);
	// a closed node below a closed node is not listed: its ancestor already hides it
	assert.equal(JSON.stringify(closed).includes("13"), false);
	// opening 12 lists its closed children one level down
	const more = toggle_tree_node(state({ tree: { depth: 1, expanded } }), report, 12);
	assert.deepEqual(to_view_config(state({ tree: { depth: 1, expanded: more } }), report).config.filter, [
		["__anc_1", "not in", [0]],
		["__anc_2", "not in", [18, 21, 26]],
		["__anc_3", "not in", [13, 15]],
	]);
	// everything open: no filter at all
	const all = report.rows.filter((r) => r.__kind === "data" && !r.__is_leaf).map((r) => r.__rid);
	assert.deepEqual(to_view_config(state({ tree: { depth: null, expanded: all } }), report).config.filter, []);
});

test("user grouping: a view of the groups only, the facts in a flat view sorted by their groups", () => {
	const report = load("accounts_receivable_frappe_total");
	const { table, config, post } = to_view_config(
		state({ group: { by: ["party", "gone"], subtotals: true, expanded: "all" }, sort: [{ key: "party", dir: "desc" }, { key: "paid", dir: "desc" }, { key: "voucher_no", dir: "asc" }] }),
		report
	);
	assert.equal(table, "facts");
	assert.equal(post.shape, "group");
	// no node per fact in the engine: the groups only
	assert.deepEqual(config.group_by, ["party"]);
	assert.deepEqual(config.sort, [["__sort__party", "desc"]]);
	// the facts of a group are one run of the flat view, in the order of the groups
	assert.equal(post.leaves.table, "facts");
	assert.deepEqual(post.leaves.config.sort, [
		["__sort__party", "desc"],
		["paid", "desc"],
		["__sort__voucher_no", "asc"],
		["__rid", "asc"],
	]);
	assert.deepEqual(post.leaves.config.filter, config.filter);
	assert.equal(post.leaves.index.__rid, 0);
	for (const [name] of post.leaves.config.sort) assert.ok(post.leaves.config.columns.includes(name), name);
	assert.equal(config.aggregates.paid, "sum");
	// columns a group row does not show are not aggregated (nor part of the view)
	assert.equal(config.aggregates.party, undefined);
	assert.equal(config.aggregates.posting_date, undefined);
	assert.ok(!config.columns.includes("posting_date"));
	assert.ok(!config.columns.includes("voucher_no"));
	for (const key of post.measures) assert.ok(config.columns.includes(key), key);
	assert.equal(config.aggregates.__kind, "count");
	assert.equal(config.aggregates.__sort__party, "min");
	assert.equal(config.aggregates.__curn__currency, "distinct count");
	assert.deepEqual(config.expressions, { __curn__currency: '"currency"' });
	// every sort column is a view column too (Perspective mis-windows hidden sort columns)
	for (const [name] of config.sort) assert.ok(config.columns.includes(name), name);
	assert.deepEqual(Object.keys(post.index), config.columns);
	assert.deepEqual(post.keys.slice(0, 1), [post.label_key]);
	assert.equal(post.row_offset, 1);
	assert.equal(post.leaf_depth, 2);
	assert.equal(post.depth, 1);
	assert.equal(post.total.source, "row0");
	// without the grouped view open (pivot, charts) the totals and the count come from it
	assert.equal(post.total.view.table, "facts");
	assert.equal(post.total.view.config.aggregates.__kind, "count");
	assert.deepEqual(post.groups.config.group_by, ["party"]);
	assert.equal(to_view_config(state({ group: { by: ["party"], expanded: "none" } }), report).post.depth, 0);
});

test("re-grouped tree (levels): only the totalled and technical columns are in the view", () => {
	const report = load("trial_balance_fy2026");
	const { config, post } = to_view_config(state({ filters: [{ key: "account", type: "text", op: "contains", value: " - SA" }] }), report);
	assert.equal(post.shape, "levels");
	assert.equal(config.group_by.at(-1), "__rid");
	for (const key of post.measures) assert.ok(config.columns.includes(key), key);
	assert.ok(!config.columns.includes("account"));
	for (const name of Object.keys(config.aggregates)) assert.ok(config.columns.includes(name), name);
	assert.ok(Number.isInteger(post.index.__levels));
	assert.equal(post.leaves, null);
});

test("flat: facts table, sort through the collator keys, totals from a temporary view", () => {
	const report = load("accounts_receivable_frappe_total");
	const plain = to_view_config(state(), report);
	assert.equal(plain.table, "facts");
	assert.equal(plain.post.shape, "flat");
	assert.deepEqual(plain.config.group_by, []);
	assert.deepEqual(plain.config.sort, []);
	assert.deepEqual(plain.config.aggregates, {});
	assert.deepEqual(plain.post.technical, ["__rid"]);
	assert.equal(plain.post.total.source, "view");
	assert.equal(plain.post.total.view.table, "facts");
	assert.deepEqual(plain.post.total.view.config.group_by, ["__kind"]);
	assert.equal(plain.post.total.view.config.aggregates.outstanding, "sum");
	assert.deepEqual(plain.post.notices, []);
	const sorted = to_view_config(state({ sort: [{ key: "party", dir: "desc" }, { key: "posting_date", dir: "asc" }] }), report);
	assert.deepEqual(sorted.config.sort, [
		["__sort__party", "desc"],
		["posting_date", "asc"],
		["__rid", "asc"],
	]);
	assert.ok(sorted.config.columns.includes("__sort__party"));
});

test("a tree with browser filters is re-grouped on the level columns of the facts", () => {
	const report = load("trial_balance_fy2026");
	const { table, config, post } = to_view_config(
		state({ filters: [{ key: "debit", type: "range", min: 1000, max: null }] }),
		report
	);
	assert.equal(table, "facts");
	assert.equal(post.shape, "levels");
	assert.deepEqual(config.group_by, ["level_1", "level_2", "level_3", "__rid"]);
	assert.deepEqual(config.filter, [["debit", ">=", 1000]]);
	assert.deepEqual(config.sort, [["__path", "asc"]]);
	assert.equal(config.aggregates.__path, "min");
	assert.equal(config.aggregates.__levels, "min");
	assert.equal(config.aggregates.__rid, "min");
	assert.equal(post.leaf_depth, 4);
	assert.equal(post.depth, 3);
	assert.deepEqual(post.fact_filter, [["debit", ">=", 1000]]);
});

test("filters: no 'between', no 'or'; what cannot be said is reported", () => {
	const columns = [
		{ key: "name", fieldtype: "Data" },
		{ key: "amount", fieldtype: "Currency" },
		{ key: "posted", fieldtype: "Date" },
		{ key: "stamp", fieldtype: "Datetime" },
	];
	const { filter, notices } = to_filter(
		[
			{ key: "name", type: "text", op: "contains", value: "نقد" },
			{ key: "name", type: "text", op: "equals", value: "x" },
			{ key: "name", type: "text", op: "starts_with", value: "1" },
			{ key: "name", type: "text", op: "not_contains", value: "y" },
			{ key: "name", type: "text", op: "contains", value: "" },
			{ key: "name", type: "set", values: ["a", "b"], exclude: false },
			{ key: "name", type: "set", values: ["a", null], exclude: true },
			{ key: "name", type: "set", values: [null], exclude: false },
			{ key: "amount", type: "range", min: 1, max: 5 },
			{ key: "amount", type: "range", min: null, max: 9 },
			{ key: "posted", type: "date", from: "2026-01-01", to: "2026-01-31" },
			{ key: "stamp", type: "date", from: null, to: "2026-01-31" },
			{ key: "amount", type: "text", op: "contains", value: "1" },
			{ key: "*", type: "text", op: "contains", value: "z", source: "search" },
			{ key: "gone", type: "text", op: "contains", value: "z" },
		],
		columns
	);
	assert.deepEqual(filter, [
		["name", "contains", "نقد"],
		["name", "==", "x"],
		["name", "begins with", "1"],
		["name", "in", ["a", "b"]],
		["name", "not in", ["a"]],
		["name", "is not null", null],
		["name", "is null", null],
		["amount", ">=", 1],
		["amount", "<=", 5],
		["amount", "<=", 9],
		["posted", ">=", "2026-01-01"],
		["posted", "<=", "2026-01-31"],
		["stamp", "<=", "2026-01-31 23:59:59.999"],
	]);
	assert.equal(JSON.stringify(filter).includes("between"), false);
	assert.deepEqual(notices.map((n) => n.code), [
		"FILTER_OP_UNSUPPORTED",
		"FILTER_TYPE_MISMATCH",
		"FILTER_SEARCH_UNSUPPORTED",
		"FILTER_UNKNOWN_COLUMN",
	]);
});

test("columns: order and hidden come from the view state; only the grid mode exists yet", () => {
	const report = load("trial_balance_fy2026");
	const s = state({ columns: { order: ["debit", "account"], hidden: ["credit"], widths: {}, pinned: { start: [], end: [] } } });
	assert.deepEqual(
		visible_columns(report, s).map((c) => c.key),
		["debit", "account", "opening_debit", "opening_credit", "closing_debit", "closing_credit"]
	);
	const { config, post } = to_view_config(s, report);
	assert.equal(post.label_key, "debit");
	assert.equal(config.columns.includes("credit"), false);
	assert.equal(post.measures.includes("credit"), false);
	assert.throws(() => to_view_config(s, report, "pivot"), /not available/);
});

test("pinned columns: after the label column, dimensions only, data columns stay neighbours", () => {
	const report = load("accounts_receivable_frappe_total");
	const pinned = { start: ["voucher_no", "invoiced", "posting_date", "nope", "party"], end: [] };
	const st = state({ columns: { ...state().columns, pinned } });
	// a measure, the label column itself and an unknown key are not pinned
	assert.deepEqual(pinned_columns(visible_columns(report, st), st).map((c) => c.key), ["voucher_no", "party"]);
	const { config, post } = to_view_config(st, report);
	assert.equal(post.label_key, "posting_date");
	assert.deepEqual(post.pinned_keys, ["voucher_no", "party"]);
	assert.deepEqual(config.columns.slice(0, 3), ["posting_date", "voucher_no", "party"]);
	assert.equal(post.data_keys.includes("party"), false);
	// one window of the view is one window of the grid's data columns
	post.data_keys.forEach((key, i) => assert.equal(post.index[key], 3 + i));
	assert.deepEqual(to_view_config(state(), report).post.pinned_keys, []);
});

test("report summary rows: pinned and the reference total without a browser filter, gone with one", () => {
	const report = load("general_ledger_consolidated");
	const reference = report.report_totals.internal.at(-1).__rid;
	const { table, post: plain } = to_view_config(state(), report);
	// no summary row between the facts: the facts table shows the whole report
	assert.equal(table, "facts");
	assert.equal(plain.shape, "flat");
	assert.deepEqual(plain.pinned_rows, { top: [0], bottom: [report.rows.at(-1).__rid] });
	assert.deepEqual(plain.total, { source: "row", rid: reference });
	assert.deepEqual(plain.notices, []);

	// a sort changes nothing of what the rows of the whole report stand for
	const sorted = to_view_config(state({ sort: [{ key: "debit", dir: "desc" }] }), report).post;
	assert.deepEqual(sorted.pinned_rows, plain.pinned_rows);
	assert.deepEqual(sorted.total, plain.total);
	assert.deepEqual(sorted.notices, []);

	const filter = [{ key: "debit", type: "range", min: 100, max: null }];
	const narrowed = to_view_config(state({ filters: filter }), report).post;
	assert.deepEqual(narrowed.pinned_rows, { top: [], bottom: [] });
	assert.equal(narrowed.total.source, "view");
	assert.equal(narrowed.total.view.table, "facts");
	assert.deepEqual(narrowed.total.view.config.filter, [["debit", ">=", 100]]);

	// grouping reads the facts only: nothing pinned, the total is the view's row 0
	const grouped = to_view_config(state({ group: { by: ["account"], subtotals: true, expanded: "all" } }), report).post;
	assert.deepEqual(grouped.pinned_rows, { top: [], bottom: [] });
	assert.equal(grouped.total.source, "row0");
	assert.deepEqual(grouped.notices, []);
});

test("rows as reported: a report with summary rows between its facts is shown from the rows table", () => {
	for (const name of ["general_ledger_by_account", "accounts_receivable_group_by_party"]) {
		const report = load(name);
		const edges = edge_rows(report);
		const reference = report.report_totals.internal.at(-1).__rid;
		const { table, config, post } = to_view_config(state(), report);
		assert.equal(table, "rows", name);
		assert.equal(post.shape, "report");
		// no grouping, no sort, no aggregate: the rows in the order of the report
		assert.deepEqual(config.group_by, []);
		assert.deepEqual(config.sort, []);
		assert.deepEqual(config.aggregates, {});
		// the rows of the whole report are pinned outside the body: the view leaves them out
		assert.deepEqual(config.filter, [["__rid", "not in", [...edges.top, ...edges.bottom, reference]]]);
		assert.deepEqual(post.pinned_rows, { top: edges.top, bottom: edges.bottom });
		assert.deepEqual(post.total, { source: "row", rid: reference });
		assert.deepEqual(post.fact_filter, []);
		assert.deepEqual(post.technical, ["__rid"]);
		assert.equal(post.row_offset, 0);
		assert.equal(post.groups, null);
		// they are on screen: nothing to announce
		assert.deepEqual(post.notices, []);
	}
});

test("rows as reported: a filter, a grouping or a sort of the user reads the facts instead", () => {
	const report = load("general_ledger_by_account");
	const edges = edge_rows(report);
	const hidden = [{ code: "REPORT_ROWS_HIDDEN", detail: edges.inner }];
	assert.equal(edges.inner, 24);

	// a sort breaks the groups the rows between the facts close; the rows of the whole
	// report stay pinned above and below the sorted body
	const sorted = to_view_config(state({ sort: [{ key: "debit", dir: "desc" }] }), report);
	assert.equal(sorted.table, "facts");
	assert.equal(sorted.post.shape, "flat");
	assert.deepEqual(sorted.config.sort, [["debit", "desc"], ["__rid", "asc"]]);
	assert.deepEqual(sorted.config.filter, []);
	assert.deepEqual(sorted.post.pinned_rows, { top: edges.top, bottom: edges.bottom });
	assert.deepEqual(sorted.post.total, { source: "row", rid: edges.reference });
	assert.deepEqual(sorted.post.notices, hidden);

	// a browser filter: the facts that match, the engine's total, nothing pinned
	const filter = [{ key: "debit", type: "range", min: 100, max: null }];
	const narrowed = to_view_config(state({ filters: filter }), report);
	assert.equal(narrowed.table, "facts");
	assert.equal(narrowed.post.shape, "flat");
	assert.deepEqual(narrowed.post.pinned_rows, { top: [], bottom: [] });
	assert.equal(narrowed.post.total.source, "view");
	assert.deepEqual(narrowed.post.notices, hidden);

	const grouped = to_view_config(state({ group: { by: ["account"], subtotals: true, expanded: "all" } }), report);
	assert.equal(grouped.table, "facts");
	assert.equal(grouped.post.shape, "group");
	assert.deepEqual(grouped.post.pinned_rows, { top: [], bottom: [] });
	assert.equal(grouped.post.total.source, "row0");
	assert.deepEqual(grouped.post.notices, hidden);

	// a sort on an unknown column is no sort
	assert.equal(to_view_config(state({ sort: [{ key: "nope", dir: "asc" }] }), report).post.shape, "report");
	// a tree report never takes this shape
	assert.equal(to_view_config(state(), load("trial_balance_fy2026")).post.shape, "tree");
});

test("fold in the view state: group.expanded as paths, subtotals, expand all / collapse all", () => {
	const report = load("accounts_receivable_frappe_total");
	const group = (expanded, subtotals = true) => state({ group: { by: ["party"], subtotals, expanded } });
	const all = to_view_config(group("all"), report).post;
	assert.equal(all.depth, 1);
	assert.equal(all.expanded, null);
	assert.equal(all.subtotals, true);
	assert.equal(to_view_config(group("none"), report).post.depth, 0);
	const some = to_view_config(group([["SND"], "bad", ["f"]], false), report).post;
	assert.equal(some.depth, 0);
	assert.deepEqual(some.expanded, [["SND"], ["f"]]);
	assert.equal(some.subtotals, false);

	assert.deepEqual(fold_all(group([["SND"]]), report, true), { group: { by: ["party"], subtotals: true, expanded: "all" } });
	assert.deepEqual(fold_all(group("all"), report, false).group.expanded, "none");
	// a flat view has nothing to fold
	assert.equal(fold_all(state(), report, true), null);

	const tree = load("trial_balance_fy2026");
	assert.deepEqual(fold_all(state({ tree: { depth: null, expanded: [0, 1] } }), tree, true), { tree: { depth: 3, expanded: null } });
	assert.deepEqual(fold_all(state(), tree, false), { tree: { depth: 0, expanded: null } });
	assert.deepEqual(to_view_config(state({ ...fold_all(state(), tree, false) }), tree).config.filter, [["__depth", "<=", 0]]);
	// the re-grouped tree folds by the same state as the tree "as is"
	const levels = to_view_config(
		state({ tree: { depth: null, expanded: [0, 1] }, filters: [{ key: "debit", type: "range", min: 1, max: null }] }),
		tree
	).post;
	assert.equal(levels.shape, "levels");
	assert.deepEqual(levels.tree.expanded, [0, 1]);
});
