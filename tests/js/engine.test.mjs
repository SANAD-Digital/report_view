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
import { build_layout, entry_at, expanded_from_paths } from "../../report_view/public/js/report_view/engine/row_layout.js";

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
		assert.deepEqual(opened.counts, { shown: 16, total: 16, facts: 16, groups: 15 });
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
		// the group view holds the groups only; the facts are the flat view, a run per group
		const cols = await opened.view.to_columns();
		const paths = cols.__ROW_PATH__;
		const parties = [...new Set(report.facts.map((f) => f.party))];
		assert.equal(paths.filter((p) => p.length === 1).length, parties.length);
		assert.equal(paths.length, parties.length + 1);
		assert.equal(await opened.leaves.num_rows(), report.facts.length);
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
		const rows = await body(opened, []);
		for (const party of names) {
			const inside = rows.filter((r) => r.rid !== null && r.path[0] === party).map((r) => r.rid);
			// every fact of the group, under it, in report order
			assert.deepEqual(inside, report.facts.filter((f) => f.party === party).map((f) => f.__rid));
		}
		for (const c of sums) close(opened.totals.values[c.key], report.facts.reduce((s, f) => s + (f[c.key] || 0), 0), c.key);
		await session.close_view(opened);

		const folded = await session.open(state({ group: { by: ["party"], subtotals: true, expanded: "none" } }));
		assert.equal(folded.body_rows, parties.length);
		const after = await session.toggle_group(folded, 1, true);
		assert.equal(after.depths.length, parties.length + report.facts.filter((f) => f.party === names[0]).length);
		assert.deepEqual(after.expanded, [[names[0]]]);
		await session.close_view(folded);
	});
	await no_leak();
});

test("user grouping, two levels and a sort: the facts under every group are the group's, in the user's order", async () => {
	const report = load("general_ledger_consolidated");
	const keys = ["account", "voucher_type"];
	await with_session(report, async (session) => {
		const opened = await session.open(state({ group: { by: keys, subtotals: true, expanded: "all" }, sort: [{ key: "debit", dir: "desc" }] }));
		const rows = await body(opened, ["debit"]);
		const by_rid = new Map(report.facts.map((f) => [f.__rid, f]));
		let seen = 0;
		let group = null;
		for (const r of rows) {
			if (r.kind === "foot") continue;
			if (r.rid === null) {
				group = r.path;
				continue;
			}
			seen += 1;
			const fact = by_rid.get(r.rid);
			assert.equal(group.length, 2);
			assert.deepEqual([fact.account ?? null, fact.voucher_type ?? null], group, `fact ${r.rid}`);
		}
		assert.equal(seen, report.facts.length);
		// the deepest groups: their sums are the sums of the facts shown under them
		for (let i = 0; i < rows.length; i++) {
			if (rows[i].rid !== null || rows[i].kind !== "row" || rows[i].path.length !== 2) continue;
			let sum = 0;
			const debits = [];
			for (let j = i + 1; j < rows.length && rows[j].rid !== null; j++) {
				sum += by_rid.get(rows[j].rid).debit || 0;
				debits.push(by_rid.get(rows[j].rid).debit ?? null);
			}
			close(rows[i].values.debit, sum, rows[i].path.join("/"));
			assert.deepEqual(debits, [...debits].sort((a, b) => (b ?? -Infinity) - (a ?? -Infinity)));
		}
		// a closed parent closes its children; opening it again opens it alone (as Perspective)
		const first = rows.findIndex((r) => r.path.length === 1);
		let fold = await session.toggle_group(opened, 1 + first, false);
		assert.ok(fold.depths.length < opened.fold.leaf_count);
		fold = await session.toggle_group(opened, 1 + first, true);
		assert.equal(fold.depths[first + 1], 2);
		assert.notEqual(fold.depths[first + 2], 3);
		await session.close_view(opened);
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

test("reports with internal totals: the total shown, and sent with an export, is the reference row", async () => {
	for (const name of ["accounts_receivable_group_by_party", "general_ledger_by_account", "general_ledger_consolidated"]) {
		const report = load(name);
		const reference = report.report_totals.internal.at(-1);
		await with_session(report, async (session) => {
			const opened = await session.open(state());
			// on screen: the report's own total row, as the report returned it (ADR-008)
			assert.deepEqual(opened.post.total, { source: "row", rid: reference.__rid });
			const shown = {};
			for (const key of opened.post.measures) {
				const ref = typeof reference[key] === "number" ? reference[key] : null;
				assert.equal(opened.totals.values[key], ref, `${name} ${key}`);
				if (ref !== null) shown[key] = ref;
			}
			// for the export: the total as shown, and the facts
			assert.deepEqual(opened.expected.totals, shown, name);
			assert.equal(opened.expected.row_count, report.facts.length);
			// what Perspective sums from the facts is the same on every additive column
			const engine = await queries.totals(handles, session.tables.facts, {
				group_by: ["__kind"],
				columns: opened.post.measures,
				aggregates: Object.fromEntries(opened.post.measures.map((k) => [k, "sum"])),
			});
			check_reference(report, { values: engine }, reference);
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

// The rows of the grid body as views/grid_view.js places them: every display row with the
// values of its view row (a subtotal row reads the row of its group).
async function body(opened, measures) {
	const layout = build_layout(opened.depths, { subtotals: opened.post.subtotals });
	if (opened.fold) {
		// a grouping of the user: groups from the group view, facts from the flat view
		const groups = await opened.view.to_columns();
		const leaves = await opened.leaves.to_columns();
		const { fold } = opened;
		const path_of = [];
		let last = [];
		for (let i = 0; i < opened.depths.length; i++) {
			if (fold.group_at[i] >= 0) last = fold.paths[fold.group_at[i]];
			path_of.push(fold.group_at[i] >= 0 ? last : [...last.slice(0, opened.post.group_keys.length), leaves.__rid[fold.leaf_at[i]]]);
		}
		return Array.from({ length: layout.size }, (_, y) => {
			const entry = entry_at(layout, y);
			const g = fold.group_at[entry.row];
			return {
				kind: entry.kind,
				row: entry.row,
				open: Boolean(layout.open[entry.row]),
				path: path_of[entry.row],
				rid: g >= 0 ? null : leaves.__rid[fold.leaf_at[entry.row]],
				values: Object.fromEntries(measures.map((k) => [k, g >= 0 ? groups[k][1 + g] : null])),
			};
		});
	}
	const cols = await opened.view.to_columns();
	const off = opened.post.row_offset;
	return Array.from({ length: layout.size }, (_, y) => {
		const entry = entry_at(layout, y);
		const at = off + entry.row;
		return {
			kind: entry.kind,
			row: entry.row,
			open: Boolean(layout.open[entry.row]),
			path: cols.__ROW_PATH__ ? cols.__ROW_PATH__[at] : null,
			rid: cols.__rid ? cols.__rid[at] : null,
			values: Object.fromEntries(measures.map((k) => [k, cols[k][at]])),
		};
	});
}

test("subtotal rows, receivables by party: one after each open group, values = manual sums", async () => {
	const report = load("accounts_receivable_frappe_total");
	const sums = report.columns.filter((c) => c.role === "measure" && c.agg === "sum" && !c.hidden).map((c) => c.key);
	const parties = [...new Set(report.facts.map((f) => f.party))];
	await with_session(report, async (session) => {
		const opened = await session.open(state({ group: { by: ["party"], subtotals: true, expanded: "all" } }));
		assert.equal(opened.depths.length, opened.body_rows);
		const rows = await body(opened, sums);
		const feet = rows.filter((r) => r.kind === "foot");
		assert.equal(feet.length, parties.length);
		assert.equal(rows.length, opened.body_rows + parties.length);
		rows.forEach((r, y) => {
			if (r.kind !== "foot") return;
			// right after the last fact of its group, before the next group
			assert.equal(rows[y - 1].path.length, 2);
			assert.equal(rows[y - 1].path[0], r.path[0]);
			if (rows[y + 1]) assert.equal(rows[y + 1].path.length, 1);
			const facts = report.facts.filter((f) => f.party === r.path[0]);
			for (const key of sums) close(r.values[key], facts.reduce((s, f) => s + (f[key] || 0), 0), `${r.path[0]} ${key}`);
		});
		await session.close_view(opened);

		// option off: the rows of the view, nothing else
		const off = await session.open(state({ group: { by: ["party"], subtotals: false, expanded: "all" } }));
		assert.equal((await body(off, sums)).filter((r) => r.kind === "foot").length, 0);
		await session.close_view(off);

		// a closed group has no subtotal row: its own row carries the numbers
		const none = await session.open(state({ group: { by: ["party"], subtotals: true, expanded: "none" } }));
		const closed = await body(none, sums);
		assert.equal(closed.length, parties.length);
		assert.equal(closed.some((r) => r.kind === "foot" || r.open), false);
		await session.close_view(none);
	});
	await no_leak();
});

test("subtotal rows, trial balance: re-grouped parents = manual sums; 'as is' parents = the report's rows", async () => {
	const report = load("trial_balance_fy2026");
	const { info } = tree_index(report);
	const by_rid = new Map(report.rows.map((r) => [r.__rid, r]));
	await with_session(report, async (session) => {
		const levels = await session.open(state({ filters: [{ key: "account", type: "text", op: "contains", value: " - SA" }] }));
		const rows = await body(levels, MEASURES);
		const feet = rows.filter((r) => r.kind === "foot");
		// the tree opens to depth 3: every parent that shows its children has one subtotal row
		const open_parents = rows.filter((r) => r.kind === "row" && r.open);
		assert.ok(feet.length > 0);
		assert.equal(feet.length, open_parents.length);
		for (const foot of feet) {
			const rid = session.level_rids.get(JSON.stringify(foot.path));
			const leaves = report.facts.filter((f) => info.get(f.__rid).ancestors.includes(rid));
			assert.ok(leaves.length > 0);
			for (const key of MEASURES) close(foot.values[key], leaves.reduce((s, f) => s + f[key], 0), `${rid} ${key}`);
		}
		await session.close_view(levels);

		const tree = await session.open(state());
		const as_is = await body(tree, MEASURES);
		const tree_feet = as_is.filter((r) => r.kind === "foot");
		assert.equal(tree_feet.length, as_is.filter((r) => r.kind === "row" && r.open).length);
		assert.equal(as_is.length, tree.body_rows + tree_feet.length);
		as_is.forEach((r, y) => {
			if (r.kind !== "foot") return;
			const parent = by_rid.get(r.rid);
			assert.equal(parent.__is_leaf, false);
			// the report's own values of the parent, not a sum made here
			for (const key of MEASURES) assert.equal(r.values[key], parent[key], `${parent.account} ${key}`);
			// after its last visible descendant
			assert.ok(info.get(as_is[y - 1].rid).ancestors.includes(r.rid) || as_is[y - 1].kind === "foot");
			const next = as_is[y + 1];
			if (next && next.kind === "row") assert.equal(info.get(next.rid).ancestors.includes(r.rid), false);
		});
		await session.close_view(tree);
	});
	await no_leak();
});

test("fold from the view state: the listed groups open, the view gives the same list back", async () => {
	const report = load("accounts_receivable_frappe_total");
	const parties = [...new Set(report.facts.map((f) => f.party))];
	const count = (party) => report.facts.filter((f) => f.party === party).length;
	await with_session(report, async (session) => {
		const wanted = [[parties[0]], [parties[2]], ["no such party"]];
		const opened = await session.open(state({ group: { by: ["party"], subtotals: true, expanded: wanted } }));
		assert.equal(opened.body_rows, parties.length + count(parties[0]) + count(parties[2]));
		const back = opened.fold.expanded();
		assert.deepEqual(new Set(back.map((p) => p[0])), new Set([parties[0], parties[2]]));

		// closing one through the view, as a click does
		const row = [...opened.fold.group_at].findIndex((g) => g >= 0 && opened.fold.paths[g][0] === parties[0]);
		const after = await session.toggle_group(opened, 1 + row, false);
		assert.deepEqual(after.expanded, [[parties[2]]]);
		assert.equal(after.depths.length, parties.length + count(parties[2]));
		// the same fold given again to the view (a change of mode or density keeps the view)
		session.adopt(opened, session.spec_of(state({ group: { by: ["party"], subtotals: false, expanded: after.expanded } })));
		assert.equal(opened.depths.length, parties.length + count(parties[2]));
		assert.equal(opened.post.subtotals, false);
		await session.close_view(opened);

		const all = await session.open(state({ group: { by: ["party"], subtotals: true, expanded: "all" } }));
		assert.equal(all.fold.expanded(), "all");
		await session.close_view(all);
		const none = await session.open(state({ group: { by: ["party"], subtotals: true, expanded: "none" } }));
		assert.equal(none.fold.expanded(), "none");
		await session.close_view(none);
	});
	await no_leak();
});

test("fold of a re-grouped tree: the open parents of the view state, as in the tree 'as is'", async () => {
	const report = load("trial_balance_fy2026");
	const { info } = tree_index(report);
	const filters = [{ key: "account", type: "text", op: "contains", value: " - SA" }];
	await with_session(report, async (session) => {
		const expanded = [0, 11, 12];
		const tree = await session.open(state({ tree: { depth: null, expanded } }));
		const as_is = (await tree.view.to_columns()).__rid;
		await session.close_view(tree);

		const levels = await session.open(state({ tree: { depth: null, expanded }, filters }));
		assert.equal(levels.post.shape, "levels");
		const shown = levels.paths.map((p) => (p.length === levels.post.leaf_depth ? p.at(-1) : session.level_rids.get(JSON.stringify(p))));
		// every leaf matches the filter: the same nodes, in the same order
		assert.deepEqual(shown, as_is);
		const open = new Set(expanded);
		assert.deepEqual(shown, [...info].filter(([, n]) => n.ancestors.every((a) => open.has(a))).map(([rid]) => rid));
		await session.close_view(levels);
	});
	await no_leak();
});

test("general ledger: with a browser filter the shown total is the engine's, of the matching facts", async () => {
	const report = load("general_ledger_consolidated");
	await with_session(report, async (session) => {
		const opened = await session.open(state({ filters: [{ key: "debit", type: "range", min: 100, max: null }] }));
		const kept = report.facts.filter((f) => f.debit >= 100);
		assert.ok(kept.length > 0 && kept.length < report.facts.length);
		assert.deepEqual(opened.post.pinned_rows, { top: [], bottom: [] });
		close(opened.totals.values.debit, kept.reduce((s, f) => s + f.debit, 0), "debit");
		assert.deepEqual(opened.expected.totals, Object.fromEntries(Object.entries(opened.totals.values).filter(([, v]) => typeof v === "number")));
		assert.equal(opened.counts.shown, kept.length);
		assert.equal(opened.counts.total, report.facts.length);
		await session.close_view(opened);
	});
	await no_leak();
});

// ---------------------------------------------------------------- rows as reported

const SUMMARY_KINDS = new Set(["opening", "internal_total", "closing", "group_header"]);

// Every row of a view of the rows table against the row of the report it stands for.
async function check_as_reported(report, session, opened) {
	const by_rid = new Map(report.rows.map((r) => [r.__rid, r]));
	const pinned = new Set([...opened.post.pinned_rows.top, ...opened.post.pinned_rows.bottom, opened.post.total.rid]);
	const expected = report.rows.filter((r) => r.__kind !== "separator" && !pinned.has(r.__rid));
	const cols = await opened.view.to_columns();
	// every row of the report but the separators and the pinned ones, in the report's order
	assert.deepEqual(cols.__rid, expected.map((r) => r.__rid));
	assert.equal(opened.body_rows, expected.length);
	const measures = report.columns.filter((c) => c.role === "measure" && !c.hidden).map((c) => c.key);
	let summary = 0;
	cols.__rid.forEach((rid, i) => {
		const row = by_rid.get(rid);
		if (SUMMARY_KINDS.has(row.__kind)) summary += 1;
		// the report's own values, not sums made here: an empty cell stays empty
		for (const key of measures) {
			const value = typeof row[key] === "number" ? row[key] : null;
			assert.equal(cols[key][i], value, `${row.__kind} ${rid} ${key}`);
		}
	});
	return { summary, expected, cols };
}

test("rows as reported, general ledger by account: the 24 rows of its accounts in their places, with their values", async () => {
	const report = load("general_ledger_by_account");
	await with_session(report, async (session) => {
		const schema = await session.tables.rows.schema();
		assert.equal(schema.debit, "float");
		assert.equal(schema.posting_date, "date");
		assert.equal(schema.account, "string");
		assert.equal(schema.__rid, "float");
		assert.equal(schema.__kind, "string");
		assert.equal(await session.tables.rows.size(), report.rows.filter((r) => r.__kind !== "separator").length);
		assert.equal(await session.tables.facts.size(), 48);

		const opened = await session.open(state());
		assert.equal(opened.post.shape, "report");
		assert.equal(opened.spec.table, "rows");
		const { summary, expected, cols } = await check_as_reported(report, session, opened);
		assert.equal(summary, 24);
		assert.equal(expected.length, 48 + 24);
		// per account: its opening, its facts, its total, its closing
		const kinds = expected.map((r) => r.__kind);
		assert.equal(kinds[0], "opening");
		assert.deepEqual(kinds.slice(-2), ["internal_total", "closing"]);
		assert.equal(kinds.filter((k) => k === "opening").length, 8);
		assert.equal(kinds.filter((k) => k === "internal_total").length, 8);
		assert.equal(kinds.filter((k) => k === "closing").length, 8);
		kinds.forEach((k, i) => {
			if (k === "opening") assert.equal(kinds[i + 1], "data", `opening at ${i}`);
			if (k === "internal_total") {
				assert.equal(kinds[i - 1], "data", `total at ${i}`);
				assert.equal(kinds[i + 1], "closing", `total at ${i}`);
			}
		});
		// the opening balance of the first account is on screen with the report's value
		assert.equal(expected[0].__rid, 2);
		assert.equal(cols.account[0], "Opening");
		assert.equal(cols.debit[0], 469);
		assert.equal(cols.balance[0], 469);
		// the rows of the whole report are pinned, not in the body
		assert.deepEqual(opened.post.pinned_rows.top, [0]);
		assert.deepEqual(opened.post.pinned_rows.bottom, [report.rows.at(-1).__rid]);
		assert.equal(opened.post.total.rid, report.report_totals.internal.at(-1).__rid);
		// rows = the facts everywhere; the summary rows are not counted
		assert.deepEqual(opened.counts, { shown: 48, total: 48, facts: 48, groups: null });
		assert.equal(opened.expected.row_count, 48);
		assert.equal(opened.expected.totals.debit, report.report_totals.internal.at(-1).debit);
		assert.equal(opened.depths, null);
		await session.close_view(opened);
	});
	await no_leak();
});

test("rows as reported, receivables by party: the total of every party after its facts", async () => {
	const report = load("accounts_receivable_group_by_party");
	const reference = report.report_totals.internal.at(-1);
	await with_session(report, async (session) => {
		const opened = await session.open(state());
		assert.equal(opened.post.shape, "report");
		const { summary, expected, cols } = await check_as_reported(report, session, opened);
		assert.equal(summary, report.report_totals.internal.length - 1);
		assert.equal(summary, 6);
		// a party total stands right after the facts of its party and carries their sums
		expected.forEach((row, i) => {
			if (row.__kind !== "internal_total") return;
			assert.equal(expected[i - 1].__kind, "data");
			assert.equal(expected[i - 1].party, row.party);
			assert.equal(cols.party[i], row.party);
			const facts = report.facts.filter((f) => f.party === row.party);
			close(cols.outstanding[i], facts.reduce((s, f) => s + (f.outstanding || 0), 0), `${row.party} outstanding`);
		});
		assert.deepEqual(opened.post.pinned_rows, { top: [], bottom: [] });
		assert.equal(opened.totals.values.outstanding, reference.outstanding);
		assert.equal(opened.expected.totals.outstanding, -66056);
		assert.deepEqual(opened.counts, { shown: 66, total: 66, facts: 66, groups: null });
		await session.close_view(opened);
	});
	await no_leak();
});

test("rows as reported: a filter, a grouping or a sort moves the view to the facts; nothing is left behind", async () => {
	const report = load("general_ledger_by_account");
	const reference = report.report_totals.internal.at(-1);
	const tables = () => handles.debug_handles().filter((h) => h.kind === "table").length;
	const views = () => handles.debug_handles().filter((h) => h.kind === "view").length;
	await with_session(report, async (session) => {
		assert.equal(tables(), 2);
		// a sort: the facts sorted, the rows of the whole report still pinned, the reference total
		const sorted = await session.open(state({ sort: [{ key: "debit", dir: "desc" }] }));
		assert.equal(sorted.spec.table, "facts");
		const s = await sorted.view.to_columns();
		assert.equal(s.__rid.length, 48);
		assert.deepEqual([...s.__rid].sort((a, b) => a - b), report.facts.map((f) => f.__rid));
		assert.deepEqual(s.debit, [...s.debit].sort((a, b) => b - a));
		assert.deepEqual(sorted.post.pinned_rows.top, [0]);
		assert.equal(sorted.totals.values.debit, reference.debit);
		assert.equal(sorted.expected.totals.debit, reference.debit);
		assert.equal(sorted.expected.row_count, 48);
		assert.deepEqual(sorted.post.notices, [{ code: "REPORT_ROWS_HIDDEN", detail: 24 }]);
		await session.close_view(sorted);

		// a filter: the matching facts, the engine's total of them
		const narrowed = await session.open(state({ filters: [{ key: "debit", type: "range", min: 100, max: null }] }));
		const kept = report.facts.filter((f) => f.debit >= 100);
		assert.ok(kept.length > 0 && kept.length < 48);
		assert.deepEqual((await narrowed.view.to_columns()).__rid, kept.map((f) => f.__rid));
		assert.deepEqual(narrowed.post.pinned_rows, { top: [], bottom: [] });
		close(narrowed.totals.values.debit, kept.reduce((t, f) => t + f.debit, 0), "debit");
		close(narrowed.expected.totals.debit, kept.reduce((t, f) => t + f.debit, 0), "expected debit");
		assert.equal(narrowed.expected.row_count, kept.length);
		assert.deepEqual(narrowed.counts, { shown: kept.length, total: 48, facts: kept.length, groups: null });
		await session.close_view(narrowed);

		// a grouping: Perspective's groups of the facts
		const grouped = await session.open(state({ group: { by: ["account"], subtotals: true, expanded: "all" } }));
		assert.equal(grouped.spec.table, "facts");
		const accounts = new Set(report.facts.map((f) => f.account));
		assert.equal(grouped.counts.groups, accounts.size);
		assert.equal(grouped.body_rows, accounts.size + 48);
		close(grouped.totals.values.debit, report.facts.reduce((t, f) => t + f.debit, 0), "grouped debit");
		assert.equal(grouped.expected.row_count, 48);
		await session.close_view(grouped);

		// and back: the rows as reported again
		const back = await session.open(state());
		assert.equal(back.spec.table, "rows");
		assert.equal(back.body_rows, 72);
		await session.close_view(back);
		assert.equal(views(), 0);
		assert.equal(tables(), 2);

		// 20 changes between the shapes, each view opened before the previous one is deleted
		const states = [
			state(),
			state({ sort: [{ key: "debit", dir: "desc" }] }),
			state({ filters: [{ key: "debit", type: "range", min: 100, max: null }] }),
			state({ group: { by: ["account"], subtotals: true, expanded: "all" } }),
		];
		let previous = null;
		for (let i = 0; i < 20; i++) {
			const next = await session.open(states[i % states.length]);
			if (previous) await session.close_view(previous);
			previous = next;
			// a grouping of the user: its group view and its flat view of the facts
			assert.equal(views(), next.leaves ? 2 : 1, `change ${i}`);
			assert.equal(tables(), 2, `change ${i}`);
		}
	});
	// the session deletes the view left open, then its two tables
	await no_leak();
});
