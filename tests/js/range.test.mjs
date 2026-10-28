// Cell range selection (phase 5c, state/range.js): the selection model in data coordinates, the
// keyboard steps (RTL), the rule of the rows a sum counts, the clipboard text (TSV, HTML), and
// the range math over to_columns of real Perspective views (queries.range_stats_of), groups
// folded and open, against the engine's own totals.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import perspective from "@finos/perspective";
import "./_setup.mjs";

const {
	RangeSelection,
	range_end,
	rect_cells,
	in_rect,
	step_cell,
	countable_rows,
	raw_number,
	to_tsv,
	to_html_table,
	export_file_name,
} = await import("../../report_view/public/js/report_view/state/range.js");
const { range_stats_of } = await import("../../report_view/public/js/report_view/engine/queries.js");

const KEYS = ["account", "opening", "debit", "credit", "closing"];

test("selection: anchor and focus in data coordinates, the rectangle by column keys", () => {
	const sel = new RangeSelection();
	assert.equal(sel.rect(KEYS), null);
	sel.set(range_end(12, "credit", "r:7"));
	assert.deepEqual(sel.rect(KEYS), { y0: 12, y1: 12, c0: 3, c1: 3 });
	sel.extend(range_end(4, "opening", "g:[\"A\"]"));
	assert.deepEqual(sel.rect(KEYS), { y0: 4, y1: 12, c0: 1, c1: 3 });
	assert.equal(rect_cells(sel.rect(KEYS)), 27);
	assert.ok(in_rect(sel.rect(KEYS), 4, 1) && in_rect(sel.rect(KEYS), 12, 3) && !in_rect(sel.rect(KEYS), 13, 3));
	// the columns are keys: a column moved keeps the same cells, a column hidden ends the range
	assert.deepEqual(sel.rect(["account", "credit", "debit", "opening", "closing"]), { y0: 4, y1: 12, c0: 1, c1: 3 });
	assert.equal(sel.rect(["account", "debit", "credit"]), null);
	const v = sel.version;
	assert.equal(sel.clear(), true);
	assert.equal(sel.clear(), false);
	assert.ok(sel.version > v);
	assert.equal(sel.active, false);
});

test("keyboard: arrows, Shift and Ctrl to the edge, Home/End, pages; left and right follow the screen in RTL", () => {
	const o = { rows: 100, cols: 5, page: 10 };
	assert.deepEqual(step_cell({ y: 3, c: 2 }, "ArrowDown", o), { y: 4, c: 2 });
	assert.deepEqual(step_cell({ y: 0, c: 0 }, "ArrowUp", o), { y: 0, c: 0 });
	assert.deepEqual(step_cell({ y: 3, c: 2 }, "ArrowRight", o), { y: 3, c: 3 });
	assert.deepEqual(step_cell({ y: 3, c: 2 }, "ArrowRight", { ...o, rtl: true }), { y: 3, c: 1 });
	assert.deepEqual(step_cell({ y: 3, c: 2 }, "ArrowLeft", { ...o, rtl: true }), { y: 3, c: 3 });
	assert.deepEqual(step_cell({ y: 3, c: 2 }, "ArrowDown", { ...o, ctrl: true }), { y: 99, c: 2 });
	assert.deepEqual(step_cell({ y: 95, c: 2 }, "PageDown", o), { y: 99, c: 2 });
	assert.deepEqual(step_cell({ y: 5, c: 2 }, "Home", { ...o, ctrl: true }), { y: 0, c: 0 });
	assert.deepEqual(step_cell({ y: 5, c: 2 }, "End", o), { y: 5, c: 4 });
	assert.equal(step_cell({ y: 5, c: 2 }, "a", o), null);
});

test("the rule: open groups and their subtotals never count twice; a closed group counts with its value", () => {
	const E = (kind, depth, open = false, blank = false) => ({ kind, depth, open, blank });
	// a tree with subtotal rows: A (open, numbers in its foot) > a1, a2, foot A; B closed
	const rows = [E("group", 0, true, true), E("row", 1), E("row", 1), E("foot", 0), E("group", 0)];
	assert.deepEqual(countable_rows(rows), [false, true, true, false, true]);
	// the subtotal row alone (its children not in the range) counts
	assert.deepEqual(countable_rows([E("foot", 0), E("group", 0)]), [true, true]);
	// without subtotal rows an open group shows its numbers: left out when a child is in the range
	assert.deepEqual(countable_rows([E("group", 0, true), E("row", 1)]), [false, true]);
	// the open group alone in the range: its own value
	assert.deepEqual(countable_rows([E("row", 1), E("group", 0, true)]), [true, true]);
	// nested: the inner group's foot follows its leaves, the outer foot follows the inner foot
	const nested = [E("group", 0, true, true), E("group", 1, true, true), E("row", 2), E("foot", 1), E("foot", 0)];
	assert.deepEqual(countable_rows(nested), [false, false, true, false, false]);
	// a range starting inside a group: the inner foot is left out, the outer one too
	assert.deepEqual(countable_rows([E("row", 2), E("foot", 1), E("foot", 0)]), [true, false, false]);
	// the report's own summary rows only when no fact is in the range; spacers never
	assert.deepEqual(countable_rows([E("summary", 0), E("row", 0), E("spacer", 0)]), [false, true, false]);
	assert.deepEqual(countable_rows([E("summary", 0), E("summary", 0)]), [true, true]);
});

test("range math over to_columns fixtures: numeric cells only, the rows the rule keeps", () => {
	// what to_columns returns for a window of two numeric columns and a text column
	const cols = { __ROW_PATH__: [[], ["A"], ["A", 1], ["A", 2], ["B"]], party: ["", "A", "A", "A", "B"], debit: [60, 30, 10, 20, 30], credit: [6, 3, 1, null, 3] };
	const keep = countable_rows([
		{ kind: "group", depth: -1, open: true },
		{ kind: "group", depth: 0, open: true },
		{ kind: "row", depth: 1 },
		{ kind: "row", depth: 1 },
		{ kind: "group", depth: 0 },
	]);
	const stats = range_stats_of([cols.debit, cols.credit], keep);
	// debit 10 + 20 + 30 (B closed), credit 1 + 3 (null is no number); the totals left out
	assert.equal(stats.count, 5);
	assert.equal(stats.sum, 64);
	assert.equal(stats.avg, 64 / 5);
	assert.equal(stats.min, 1);
	assert.equal(stats.max, 30);
	assert.deepEqual(range_stats_of([["x", null, NaN, Infinity]]), { count: 0, sum: 0, avg: null, min: null, max: null });
});

// A grouped view of real facts in Perspective: the rule over its own to_columns equals the
// engine's grand total, groups folded and open.
const table_data = {
	party: ["A", "A", "A", "B", "B", "C", "C", "C", "C"],
	voucher: ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9"],
	amount: [10.1, 20.2, 30.3, 5.5, 4.5, 1, 2, 3, 4.25],
};
const client = perspective;
const leaks = [];
after(async () => {
	for (const x of leaks.reverse()) await x.delete();
});

test("range math over Perspective: whole range with groups folded and open = the engine's total", async () => {
	const table = await client.table(table_data);
	const view = await table.view({ group_by: ["party", "voucher"], columns: ["amount"], aggregates: { amount: "sum" } });
	leaks.push(table);
	try {
		// close B (row 5 = ["B"] after A's three vouchers: [], A, v1, v2, v3, B, ...)
		const before = await view.to_columns({ start_row: 0, end_row: 1 });
		const total = before.amount[0];
		const paths = (await view.to_columns()).__ROW_PATH__;
		await view.collapse(paths.findIndex((p) => p.length === 1 && p[0] === "B"));
		const cols = await view.to_columns({ start_row: 1 });
		const p = cols.__ROW_PATH__;
		const entries = p.map((path, i) => {
			const open = i + 1 < p.length && p[i + 1].length > path.length;
			return { kind: path.length === 2 ? "row" : "group", depth: path.length - 1, open, blank: false };
		});
		const keep = countable_rows(entries);
		const stats = range_stats_of([cols.amount], keep);
		assert.ok(Math.abs(stats.sum - total) < 1e-9, `${stats.sum} != ${total}`);
		// the closed group B counts once, with its value; the open A and C give way to their vouchers
		assert.equal(stats.count, 3 + 1 + 4);
		// a part of A: its header and two vouchers = those two vouchers
		const part = range_stats_of([cols.amount.slice(0, 3)], countable_rows(entries.slice(0, 3)));
		assert.ok(Math.abs(part.sum - (10.1 + 20.2)) < 1e-9);
		// the header of C alone: C's value
		const ci = p.findIndex((x) => x.length === 1 && x[0] === "C");
		const c_only = range_stats_of([[cols.amount[ci]]], countable_rows([entries[ci]].map((e) => ({ ...e }))));
		// alone, the header of an open group is the last row of its range: it counts
		assert.ok(Math.abs(c_only.sum - 10.25) < 1e-9);
	} finally {
		await view.delete();
	}
});

test("clipboard: raw values as TSV (Excel keeps columns and numbers), a plain HTML table", () => {
	const rows = [
		["1110 - Cash", 539611, 0.30000000000000004, null],
		['say "hi"\tthere', -12.5, "2026-01-31", true],
	];
	const tsv = to_tsv(rows, ["Account", "Debit", "Credit", "Flag"]);
	assert.equal(tsv, 'Account\tDebit\tCredit\tFlag\r\n1110 - Cash\t539611\t0.3\t\r\n"say ""hi""\tthere"\t-12.5\t2026-01-31\t1\r\n');
	// no grouping, no currency symbol: Excel reads them as numbers
	assert.equal(raw_number(1234567.891), "1234567.891");
	assert.equal(raw_number(-0), "0");
	const html = to_html_table([[1, "<b>x</b>"]], ["A", "B"]);
	assert.equal(html, '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td x:num="1">1</td><td>&lt;b&gt;x&lt;/b&gt;</td></tr></tbody></table>');
	assert.equal(export_file_name('Trial: "Balance"'), "Trial Balance - selection.tsv");
});
