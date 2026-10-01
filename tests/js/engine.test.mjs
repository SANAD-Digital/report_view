// The Perspective engine in node (@finos/perspective resolves to its node build): tables of
// the fixtures, the views the page opens, totals against the report's own reference rows
// (ADR-008) and the handle lifecycle (docs/architecture.md §8أ.3).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import perspective from "@finos/perspective";

import { normalize } from "../../report_view/public/js/report_view/adapter/normalize.js";
import { default_state } from "../../report_view/public/js/report_view/state/view_state.js";
import { EngineHandles, ReportSession, VERSION } from "../../report_view/public/js/report_view/engine/perspective_engine.js";
import { tree_index } from "../../report_view/public/js/report_view/engine/tree_nodes.js";
import * as queries from "../../report_view/public/js/report_view/engine/queries.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const dir = path.join(root, "report_view/tests/fixtures/normalize");
const load = (name) => normalize(JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8")).input);
const state = (patch = {}) => ({ ...default_state(), ...patch });
const MEASURES = ["opening_debit", "opening_credit", "debit", "credit", "closing_debit", "closing_credit"];
// Running balances have no meaningful sum (ADR-008 amendment); excluded until column_rules.
const NON_ADDITIVE = new Set(["balance"]);
const TOLERANCE = 0.005;

const handles = new EngineHandles(perspective);

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

async function no_leak() {
	assert.deepEqual(handles.debug_handles(), []);
	assert.deepEqual(await perspective.get_hosted_table_names(), []);
}

function check_reference(report, totals, reference) {
	let compared = 0;
	for (const c of report.columns.filter((c) => c.role === "measure" && c.agg === "sum" && !c.hidden)) {
		if (NON_ADDITIVE.has(c.fieldname)) continue;
		const ref = reference[c.key];
		// Columns the reference row leaves empty have no reference value.
		if (ref === null || ref === undefined || ref === "") continue;
		close(totals.values[c.key], ref, c.key);
		compared += 1;
	}
	assert.ok(compared > 0, "no measure compared");
}

after(async () => {
	await handles.delete_all();
});

test("VERSION in the loader equals the pinned @finos/perspective version", () => {
	const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
	assert.equal(pkg.dependencies["@finos/perspective"], VERSION);
	assert.equal(pkg.dependencies["regular-table"], "0.9.1");
	const installed = JSON.parse(fs.readFileSync(path.join(root, "node_modules/@finos/perspective/package.json"), "utf8"));
	assert.equal(installed.version, VERSION);
});

test("tables are created with the explicit schema (no inference)", async () => {
	const report = load("trial_balance_fy2026");
	await with_session(report, async (session) => {
		const facts = await session.tables.facts.schema();
		const nodes = await session.tables.nodes.schema();
		assert.equal(facts.debit, "float");
		assert.equal(facts.account, "string");
		assert.equal(facts.__sort__account, "float");
		assert.equal(facts.level_3, "string");
		assert.equal(facts.__rid, "float");
		assert.equal(nodes.__has_children, "boolean");
		assert.equal(nodes.__anc_3, "float");
		assert.equal(await session.tables.facts.size(), 16);
		assert.equal(await session.tables.nodes.size(), 31);
	});
	await no_leak();
});

test("(a) tree 'as is': the report's rows, every parent, all six columns; total = the 'Total' row", async () => {
	const report = load("trial_balance_fy2026");
	await with_session(report, async (session) => {
		const opened = await session.open(state());
		assert.equal(opened.post.shape, "tree");
		const cols = await opened.view.to_columns();
		const data = report.rows.filter((r) => r.__kind === "data");
		assert.deepEqual(cols.__rid, data.map((r) => r.__rid));
		assert.equal(opened.body_rows, 31);
		let parents = 0;
		data.forEach((row, i) => {
			if (!row.__is_leaf) parents += 1;
			for (const key of MEASURES) close(cols[key][i], row[key], `${row.account} ${key}`);
			assert.equal(cols.__depth[i], row.__indent);
			assert.equal(cols.__has_children[i], !row.__is_leaf);
		});
		assert.equal(parents, 15);
		const reference = report.report_totals.internal.at(-1);
		assert.equal(reference.account, "Total");
		for (const key of MEASURES) {
			assert.equal(opened.totals.values[key], reference[key], key);
			assert.equal(opened.expected.totals[key], reference[key], key);
		}
		assert.equal(opened.totals.values.closing_debit, 7553469);
		assert.deepEqual(opened.totals.currencies, { currency: "YER" });
		assert.deepEqual(opened.counts, { shown: 31, total: 31, facts: 16, groups: 15 });
		assert.equal(opened.expected.row_count, 16);
		await session.close_view(opened);
	});
	await no_leak();
});

test("tree 'as is': collapse and depth are engine filters; hidden rows are the descendants", async () => {
	const report = load("trial_balance_fy2026");
	const { info } = tree_index(report);
	await with_session(report, async (session) => {
		const shallow = await session.open(state({ tree: { depth: 1, expanded: null } }));
		const rids = (await shallow.view.to_columns()).__rid;
		assert.deepEqual(rids, [...info].filter(([, n]) => n.depth <= 1).map(([rid]) => rid));
		// totals do not move with what is folded
		assert.equal(shallow.totals.values.debit, 30303624);
		await session.close_view(shallow);

		const expanded = [11, 17, 20, 12];
		const folded = await session.open(state({ tree: { depth: 1, expanded } }));
		const open = new Set(expanded);
		const expected = [...info].filter(([, n]) => n.ancestors.every((a) => open.has(a))).map(([rid]) => rid);
		assert.deepEqual((await folded.view.to_columns()).__rid, expected);
		assert.deepEqual(expected, [0, 11, 12, 13, 15, 17, 18, 20, 21, 26]);
		await session.close_view(folded);
	});
	await no_leak();
});

test("(b) levels: Perspective's parent sums = manual sums of their leaves; uneven depth shows no copies", async () => {
	const report = load("trial_balance_fy2026");
	const { info } = tree_index(report);
	const by_rid = new Map(report.rows.map((r) => [r.__rid, r]));
	await with_session(report, async (session) => {
		const opened = await session.open(state({ filters: [{ key: "account", type: "text", op: "contains", value: " - SA" }] }));
		assert.equal(opened.post.shape, "levels");
		const cols = await opened.view.to_columns();
		const paths = cols.__ROW_PATH__;
		// grand total row + one row per node of the report tree (15 parents, 16 leaves)
		assert.equal(paths.length, 32);
		assert.equal(opened.body_rows, 31);
		let parents = 0;
		for (let i = 1; i < paths.length; i++) {
			const rid = paths[i].length === 4 ? paths[i][3] : session.level_rids.get(JSON.stringify(paths[i]));
			assert.ok(by_rid.has(rid), JSON.stringify(paths[i]));
			const leaves = report.facts.filter((f) => f.__rid === rid || info.get(f.__rid).ancestors.includes(rid));
			if (info.get(rid).has_children) parents += 1;
			assert.equal(cols.__kind[i], leaves.length, `leaf count of ${rid}`);
			for (const key of MEASURES) {
				const manual = leaves.reduce((s, f) => s + f[key], 0);
				close(cols[key][i], manual, `${by_rid.get(rid).account} ${key}`);
			}
		}
		assert.equal(parents, 15);
		// report order
		const order = paths.slice(1).map((p) => (p.length === 4 ? p[3] : session.level_rids.get(JSON.stringify(p))));
		assert.deepEqual(order, [...info.keys()]);
		// the leaves do not add up to the report's netted closing total: documented (N9)
		close(opened.totals.values.debit, 30303624, "debit");
		close(opened.totals.values.closing_debit, 24653599, "closing_debit");
		await session.close_view(opened);

		const narrow = await session.open(state({ filters: [{ key: "debit", type: "range", min: 1000000, max: null }] }));
		const kept = report.facts.filter((f) => f.debit >= 1000000);
		assert.equal(narrow.expected.row_count, kept.length);
		close(narrow.totals.values.debit, kept.reduce((s, f) => s + f.debit, 0), "filtered debit");
		await session.close_view(narrow);
	});
	await no_leak();
});

test("(b) grouping by a dimension: group sums = manual sums of the facts; fact rows open below", async () => {
	const report = load("accounts_receivable_frappe_total");
	const sums = report.columns.filter((c) => c.role === "measure" && c.agg === "sum");
	await with_session(report, async (session) => {
		const opened = await session.open(state({ group: { by: ["party"], subtotals: true, expanded: "all" } }));
		assert.equal(opened.post.shape, "group");
		const cols = await opened.view.to_columns();
		const paths = cols.__ROW_PATH__;
		const parties = [...new Set(report.facts.map((f) => f.party))];
		assert.equal(paths.filter((p) => p.length === 1).length, parties.length);
		assert.equal(paths.filter((p) => p.length === 2).length, report.facts.length);
		assert.equal(opened.counts.groups, parties.length);
		assert.equal(opened.body_rows, parties.length + report.facts.length);
		assert.deepEqual(opened.counts, { shown: 66, total: 66, facts: 66, groups: parties.length });
		paths.forEach((p, i) => {
			if (p.length !== 1) return;
			const rows = report.facts.filter((f) => f.party === p[0]);
			assert.equal(cols.__kind[i], rows.length);
			for (const c of sums) close(cols[c.key][i], rows.reduce((s, f) => s + (f[c.key] || 0), 0), `${p[0]} ${c.key}`);
		});
		// groups in collator order, fact rows in report order inside their group
		const names = paths.filter((p) => p.length === 1).map((p) => p[0]);
		const collator = new Intl.Collator("ar", { numeric: true, sensitivity: "base" });
		assert.deepEqual(names, [...names].sort(collator.compare));
		const first = paths.findIndex((p) => p.length === 1);
		const inside = [];
		for (let i = first + 1; i < paths.length && paths[i].length === 2; i++) inside.push(paths[i][1]);
		assert.deepEqual(inside, [...inside].sort((a, b) => a - b));
		for (const c of sums) close(opened.totals.values[c.key], report.facts.reduce((s, f) => s + (f[c.key] || 0), 0), c.key);
		await session.close_view(opened);

		const folded = await session.open(state({ group: { by: ["party"], subtotals: true, expanded: "none" } }));
		assert.equal(folded.body_rows, parties.length);
		await queries.toggle_group(folded.view, folded.post, 1, true);
		assert.ok((await queries.body_rows(folded.view, folded.post)) > parties.length);
		await session.close_view(folded);
	});
	await no_leak();
});

test("(c) accounts receivable, flat: column totals = Frappe's total row", async () => {
	const report = load("accounts_receivable_frappe_total");
	assert.ok(report.report_totals.frappe_total);
	await with_session(report, async (session) => {
		const opened = await session.open(state());
		assert.equal(opened.post.shape, "flat");
		assert.equal(opened.body_rows, report.facts.length);
		assert.deepEqual((await opened.view.to_columns()).__rid, report.facts.map((f) => f.__rid));
		check_reference(report, opened.totals, report.report_totals.frappe_total);
		close(opened.totals.values.outstanding, -66056, "outstanding");
		close(opened.totals.values.age, 1801, "age");
		assert.equal(opened.totals.currencies.currency, "YER");
		assert.equal(opened.expected.row_count, 66);
		for (const v of Object.values(opened.expected.totals)) assert.equal(typeof v, "number");
		await session.close_view(opened);

		const sorted = await session.open(state({ sort: [{ key: "paid", dir: "desc" }] }));
		const paid = (await sorted.view.to_columns()).paid;
		assert.deepEqual(paid, [...paid].sort((a, b) => b - a));
		await session.close_view(sorted);
	});
	await no_leak();
});

test("reports with internal totals: engine total = the last internal total row", async () => {
	for (const name of ["accounts_receivable_group_by_party", "general_ledger_by_account", "general_ledger_consolidated"]) {
		const report = load(name);
		await with_session(report, async (session) => {
			const opened = await session.open(state());
			check_reference(report, opened.totals, report.report_totals.internal.at(-1));
			await session.close_view(opened);
		});
	}
	await no_leak();
});

test("every fixture loads and opens (dates, list rows, uneven shapes)", async () => {
	for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
		const report = load(file.replace(/\.json$/, ""));
		await with_session(report, async (session) => {
			const opened = await session.open(state());
			assert.equal(await opened.view.num_rows(), opened.body_rows + opened.post.row_offset, file);
			assert.equal(await session.tables.facts.size(), report.facts.length, file);
			await session.close_view(opened);
		});
	}
	await no_leak();
});

test("mixed currencies give no total", async () => {
	const report = load("trial_balance_fy2026");
	report.facts[0].currency = "USD";
	await with_session(report, async (session) => {
		const opened = await session.open(state({ group: { by: ["acc_name"], subtotals: true, expanded: "none" } }));
		assert.equal(opened.totals.mixed.debit, true);
		assert.equal(opened.totals.values.debit, null);
		assert.equal("debit" in opened.expected.totals, false);
		assert.equal(opened.totals.currencies.currency, null);
		await session.close_view(opened);
	});
	await no_leak();
});

test("unique values with counts, in collator order, under the other filters", async () => {
	const report = load("accounts_receivable_frappe_total");
	await with_session(report, async (session) => {
		const all = await queries.unique_values(handles, session.tables.facts, "party");
		const count = new Map();
		for (const f of report.facts) count.set(f.party, (count.get(f.party) || 0) + 1);
		assert.equal(all.values.length, count.size);
		assert.equal(all.truncated, false);
		for (const { value, count: n } of all.values) assert.equal(n, count.get(value), value);
		const collator = new Intl.Collator("ar", { numeric: true, sensitivity: "base" });
		assert.deepEqual(all.values.map((v) => v.value), [...count.keys()].sort(collator.compare));
		const some = await queries.unique_values(handles, session.tables.facts, "party", [["paid", ">", 1000]]);
		const expected = new Set(report.facts.filter((f) => f.paid > 1000).map((f) => f.party));
		assert.deepEqual(new Set(some.values.map((v) => v.value)), expected);
		const cut = await queries.unique_values(handles, session.tables.facts, "party", [], { limit: 2 });
		assert.equal(cut.values.length, 2);
		assert.equal(cut.truncated, true);
	});
	await no_leak();
});

test("range_stats summarises the numeric cells of a window", async () => {
	const report = load("accounts_receivable_frappe_total");
	await with_session(report, async (session) => {
		const opened = await session.open(state());
		const x = opened.post.index.paid;
		const stats = await queries.range_stats(opened.view, { start_row: 0, end_row: 5, start_col: x, end_col: x + 1 });
		const paid = report.facts.slice(0, 5).map((f) => f.paid);
		assert.equal(stats.count, 5);
		close(stats.sum, paid.reduce((a, b) => a + b, 0), "sum");
		assert.equal(stats.min, Math.min(...paid));
		assert.equal(stats.max, Math.max(...paid));
		await session.close_view(opened);
	});
	await no_leak();
});

test("handles: a deleted handle throws at once, delete goes through the manager, views die before their table", async () => {
	const table = await handles.table({ a: "float" }, "guard");
	await table.update({ a: [1, 2, 3] });
	const v1 = await handles.view(table, { columns: ["a"] });
	const v2 = await handles.view(table, { columns: ["a"] });
	assert.throws(() => v1.delete(), /through EngineHandles/);
	assert.throws(() => table.delete(), /through EngineHandles/);
	assert.equal(handles.debug_handles().length, 3);
	await handles.delete(v1);
	assert.throws(() => v1.num_rows(), /was deleted/);
	assert.throws(() => handles.delete(v1), /already deleted/);
	assert.equal(handles.is_alive(v1), false);
	// the table still has a view: the manager deletes it first, and the table really goes
	await handles.delete(table);
	assert.throws(() => v2.to_columns(), /was deleted/);
	assert.throws(() => table.size(), /was deleted/);
	assert.throws(() => handles.view(table, {}), /deleted/);
	await no_leak();
});

test("handles: a call in flight settles before its view is deleted; racing opens keep the newest only", async () => {
	const table = await handles.table({ a: "float" }, "race");
	await table.update({ a: [1, 2, 3] });
	const view = await handles.view(table, { columns: ["a"] });
	const reading = view.to_columns();
	const deleting = handles.delete(view);
	assert.deepEqual(await reading, { a: [1, 2, 3] });
	await deleting;
	const [first, second] = await Promise.all([
		handles.latest_view("slot", table, { columns: ["a"] }),
		handles.latest_view("slot", table, { columns: ["a"], sort: [["a", "desc"]] }),
	]);
	assert.equal(first, null);
	assert.deepEqual(await second.to_columns(), { a: [3, 2, 1] });
	assert.equal(handles.debug_handles().filter((h) => h.kind === "view").length, 1);
	// a view still being created when its table is deleted does not survive it
	const late = handles.view(table, { columns: ["a"] });
	await handles.delete(table);
	await assert.rejects(late, /deleted/);
	await no_leak();
});

test("(d) lifecycle: nothing is left after 20 switches between two reports", async () => {
	const reports = [load("trial_balance_fy2026"), load("accounts_receivable_frappe_total")];
	const before = await perspective.system_info();
	for (let i = 0; i < 20; i++) {
		const report = reports[i % 2];
		const session = await ReportSession.create(handles, report, { locale: "ar" });
		const first = await session.open(state());
		// a setting changes: the new view is opened before the old one is deleted
		const key = i % 2 ? "party" : "currency";
		const second = await session.open(state({ group: { by: [key], subtotals: true, expanded: "all" } }));
		await session.close_view(first);
		await queries.unique_values(handles, session.tables.facts, key);
		assert.ok(handles.debug_handles().length >= 2);
		if (i % 3 === 0) await session.close_view(second);
		// switching report: the session deletes its views, then its tables
		await session.close();
		assert.deepEqual(handles.debug_handles(), [], `cycle ${i}`);
	}
	await no_leak();
	const after_info = await perspective.system_info();
	assert.ok(Number(after_info.used_size) <= Number(before.used_size) + 1024 * 1024, "engine memory grew");
});
