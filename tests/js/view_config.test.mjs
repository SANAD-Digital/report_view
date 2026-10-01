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
	visible_columns,
	AGGREGATES,
} from "../../report_view/public/js/report_view/engine/view_config.js";

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

test("user grouping: facts table, fact rows as the last level, collator order of the groups", () => {
	const report = load("accounts_receivable_frappe_total");
	const { table, config, post } = to_view_config(
		state({ group: { by: ["party", "gone"], subtotals: true, expanded: "all" }, sort: [{ key: "party", dir: "desc" }, { key: "paid", dir: "desc" }, { key: "voucher_no", dir: "asc" }] }),
		report
	);
	assert.equal(table, "facts");
	assert.equal(post.shape, "group");
	assert.deepEqual(config.group_by, ["party", "__rid"]);
	assert.deepEqual(config.sort, [
		["__sort__party", "desc"],
		["paid", "desc"],
		["__sort__voucher_no", "asc"],
		["__rid", "asc"],
	]);
	assert.equal(config.aggregates.paid, "sum");
	assert.equal(config.aggregates.party, "unique");
	assert.equal(config.aggregates.posting_date, "unique");
	assert.equal(config.aggregates.__kind, "count");
	assert.equal(config.aggregates.__sort__party, "min");
	assert.equal(config.aggregates.__curn__currency, "distinct count");
	assert.deepEqual(config.expressions, { __curn__currency: '"currency"' });
	// every sort column is a view column too (Perspective mis-windows hidden sort columns)
	for (const [name] of config.sort) assert.ok(config.columns.includes(name), name);
	assert.deepEqual(config.columns.slice(0, post.keys.length), post.keys);
	assert.equal(post.row_offset, 1);
	assert.equal(post.leaf_depth, 2);
	assert.equal(post.depth, 1);
	assert.deepEqual(post.total, { source: "row0" });
	assert.deepEqual(post.groups.config.group_by, ["party"]);
	assert.equal(to_view_config(state({ group: { by: ["party"], expanded: "none" } }), report).post.depth, 0);
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
