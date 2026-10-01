// Rows of the grid body from the rows of a view (engine/row_layout.js) and the report's own
// summary rows (engine/report_rows.js): placement only, nothing is computed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalize } from "../../report_view/public/js/report_view/adapter/normalize.js";
import { build_layout, entry_at, expanded_from_paths } from "../../report_view/public/js/report_view/engine/row_layout.js";
import { edge_rows, build_report_rows } from "../../report_view/public/js/report_view/engine/report_rows.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "../../report_view/tests/fixtures/normalize");
const load = (name) => normalize(JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8")).input);

// "3" = view row 3, "f1" = the subtotal row of the group at view row 1, "." = spacer
const shown = (layout) =>
	Array.from({ length: layout.size }, (_, y) => {
		const e = entry_at(layout, y);
		return e.kind === "spacer" ? "." : e.kind === "foot" ? `f${e.row}` : String(e.row);
	}).join(" ");

test("subtotal rows: after the last visible descendant of every open group, inner groups first", () => {
	// A (open) > A1 (open) > two rows, A2 (closed); B (closed); C (open) > one row
	const depths = [1, 2, 3, 3, 2, 1, 1, 2];
	const layout = build_layout(depths, { subtotals: true });
	assert.equal(shown(layout), "0 1 2 3 f1 4 f0 5 6 7 f6");
	assert.deepEqual([...layout.open], [1, 1, 0, 0, 0, 0, 1, 0]);
	assert.equal(layout.size, depths.length + 3);
	assert.equal(layout.count, depths.length);
});

test("subtotal rows: none when the option is off, none for closed groups or a flat view", () => {
	assert.equal(shown(build_layout([1, 2, 2, 1, 2], { subtotals: false })), "0 1 2 3 4");
	assert.equal(shown(build_layout([1, 1, 1], { subtotals: true })), "0 1 2");
	assert.equal(shown(build_layout(new Uint8Array(3), { subtotals: true })), "0 1 2");
	assert.equal(build_layout([], { subtotals: true }).size, 0);
});

test("subtotal rows: the report tree (depths from 0) closes every level at the end", () => {
	const layout = build_layout([0, 1, 2, 2, 1, 2], { subtotals: true });
	assert.equal(shown(layout), "0 1 2 3 f1 4 5 f4 f0");
});

test("spacer rows keep the room of the report rows pinned under the headers", () => {
	const layout = build_layout([1, 2], { subtotals: true, top: 2 });
	assert.equal(shown(layout), ". . 0 1 f0");
	assert.equal(layout.size, 5);
	assert.deepEqual(entry_at(layout, 99), { kind: "spacer", row: -1 });
});

test("group.expanded from the view: 'all', 'none', or the paths of the open groups", () => {
	const all = [["A"], ["A", 1], ["B"], ["B", 2]];
	assert.equal(expanded_from_paths(all, 2), "all");
	assert.equal(expanded_from_paths([["A"], ["B"]], 2), "none");
	assert.deepEqual(expanded_from_paths([["A"], ["B"], ["B", 2], ["C"]], 2), [["B"]]);
	// two levels: an open group with a closed child
	const nested = [["A"], ["A", "x"], ["A", "x", 1], ["A", "y"], ["B"]];
	assert.deepEqual(expanded_from_paths(nested, 3), [["A"], ["A", "x"]]);
	// null is a group value like any other
	assert.deepEqual(expanded_from_paths([[null], [null, 5], ["A"]], 2), [[null]]);
});

test("report summary rows: General Ledger, consolidated", () => {
	const report = load("general_ledger_consolidated");
	const edges = edge_rows(report);
	const kind = (rid) => report.rows.find((r) => r.__rid === rid).__kind;
	assert.deepEqual(edges.top.map(kind), ["opening"]);
	assert.deepEqual(edges.bottom.map(kind), ["closing"]);
	assert.equal(edges.reference, report.report_totals.internal.at(-1).__rid);
	assert.equal(edges.inner, 0);
});

test("report summary rows: General Ledger by account keeps the report's own rows only", () => {
	const report = load("general_ledger_by_account");
	const edges = edge_rows(report);
	// the report's opening is the first row; the opening of the first account is not pinned
	assert.deepEqual(edges.top, [0]);
	assert.equal(edges.reference, report.report_totals.internal.at(-1).__rid);
	assert.deepEqual(edges.bottom, [report.rows.at(-1).__rid]);
	assert.equal(report.rows.at(-1).__kind, "closing");
	const summary = report.rows.filter((r) => ["opening", "closing", "internal_total"].includes(r.__kind)).length;
	assert.equal(edges.inner, summary - 3);
	assert.ok(edges.inner > 0);
});

test("report summary rows: receivables by party, a frappe total row, and a tree", () => {
	const by_party = load("accounts_receivable_group_by_party");
	const edges = edge_rows(by_party);
	assert.deepEqual(edges.top, []);
	assert.deepEqual(edges.bottom, []);
	assert.equal(edges.reference, by_party.report_totals.internal.at(-1).__rid);
	assert.equal(edges.inner, by_party.report_totals.internal.length - 1);

	assert.deepEqual(edge_rows(load("accounts_receivable_frappe_total")), { top: [], bottom: [], reference: null, inner: 0 });
	assert.deepEqual(edge_rows(load("trial_balance_fy2026")), { top: [], bottom: [], reference: null, inner: 0 });
});

// A report as the adapter gives it, from the kinds of its rows alone:
// d = fact, O = opening, T = internal total, C = closing, G = group header, - = separator.
const KINDS = { d: "data", O: "opening", T: "internal_total", C: "closing", G: "group_header", "-": "separator" };
function sketch(kinds) {
	const rows = kinds.split(" ").map((k, i) => ({ __rid: i, __kind: KINDS[k] }));
	return {
		tree: null,
		rows,
		facts: rows.filter((r) => r.__kind === "data"),
		report_totals: { frappe_total: null, internal: rows.filter((r) => r.__kind === "internal_total") },
	};
}

test("report summary rows: the same rows with the separators taken out of the report", () => {
	for (const name of ["general_ledger_consolidated", "general_ledger_by_account", "accounts_receivable_group_by_party"]) {
		const report = load(name);
		const bare = { ...report, rows: report.rows.filter((r) => r.__kind !== "separator") };
		assert.ok(name === "general_ledger_consolidated" || bare.rows.length < report.rows.length, name);
		assert.deepEqual(edge_rows(bare), edge_rows(report), name);
	}
});

test("report summary rows: groups of the report without separators between them", () => {
	// the report's opening, then per group: opening, facts, total, closing; then total, closing
	assert.deepEqual(edge_rows(sketch("O O d d T C O d T C O d d T C T C")), { top: [0], bottom: [16], reference: 15, inner: 9 });
	// no row of the whole report: the first opening and the last total and closing belong to
	// the first and the last group, nothing is pinned
	assert.deepEqual(edge_rows(sketch("O d d T C O d T C")), { top: [], bottom: [], reference: null, inner: 6 });
	// groups closed by a total, then the report's total (receivables by party)
	assert.deepEqual(edge_rows(sketch("d d T d T d d d T T")), { top: [], bottom: [], reference: 9, inner: 3 });
	assert.deepEqual(edge_rows(sketch("d d T d T")), { top: [], bottom: [], reference: null, inner: 2 });
	// groups opened by a header only: the total after the last fact is the report's
	assert.deepEqual(edge_rows(sketch("G d d G d T")), { top: [], bottom: [], reference: 5, inner: 2 });
	// no groups: one opening, the facts, total and closing (with or without separators)
	assert.deepEqual(edge_rows(sketch("O d d d T C")), { top: [0], bottom: [5], reference: 4, inner: 0 });
	assert.deepEqual(edge_rows(sketch("O - d d d - T C")), { top: [0], bottom: [7], reference: 6, inner: 0 });
	// only the first opening is the report's
	assert.deepEqual(edge_rows(sketch("O O d T")).top, [0]);
	// nothing but facts, and no fact at all
	assert.deepEqual(edge_rows(sketch("d d d")), { top: [], bottom: [], reference: null, inner: 0 });
	assert.deepEqual(edge_rows(sketch("O T C")), { top: [], bottom: [], reference: null, inner: 0 });
});

test("rows table: every row of the report but the separators, only when rows stand between the facts", () => {
	const by_account = load("general_ledger_by_account");
	const reported = build_report_rows(by_account);
	assert.deepEqual(reported.rows, by_account.rows.filter((r) => r.__kind !== "separator"));
	assert.equal(reported.rows.length, 48 + 27);
	assert.deepEqual(reported.edges, edge_rows(by_account));
	assert.equal(build_report_rows(load("accounts_receivable_group_by_party")).rows.length, 66 + 7);
	// the facts table already shows all of these
	assert.equal(build_report_rows(load("general_ledger_consolidated")), null);
	assert.equal(build_report_rows(load("accounts_receivable_frappe_total")), null);
	assert.equal(build_report_rows(load("trial_balance_fy2026")), null);
	// group headers between the facts count as rows of the report's own groups
	assert.equal(build_report_rows(sketch("G d d G d")).rows.length, 5);
});
