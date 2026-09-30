// Engine totals against the report's own references (ADR-008 and its phase-3 amendment):
// - flat reports with add_total_row: Frappe's total row;
// - reports with internal totals: the last internal_total row;
// - trees without view filters: the sum of root rows (N4.7).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalize } from "../../report_view/public/js/report_view/adapter/normalize.js";
import * as aq from "arquero";
import { create_engine, use_arquero } from "../../report_view/public/js/report_view/engine/engine.js";

use_arquero(aq);
import { flt } from "../../report_view/public/js/report_view/engine/aggregate.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "../../report_view/tests/fixtures/normalize");
const load = (name) => {
	const f = JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8"));
	return normalize(f.input);
};
// Running balances have no meaningful sum (ADR-008 amendment); excluded until column_rules.
const NON_ADDITIVE = new Set(["balance"]);

function close(actual, expected, key) {
	assert.ok(Math.abs(flt(actual) - flt(expected)) < 0.005, `${key}: ${actual} != ${expected}`);
}

function check_against(report, reference) {
	const engine = create_engine(report);
	const out = engine.apply({});
	let compared = 0;
	for (const c of report.columns.filter((c) => c.role === "measure" && c.agg === "sum")) {
		if (NON_ADDITIVE.has(c.fieldname)) continue;
		// Columns the reference row leaves empty (AR `age`) have no reference value.
		const ref = reference[c.key];
		if (ref === null || ref === undefined || ref === "") continue;
		close(out.totals[c.key], reference[c.key], c.key);
		compared += 1;
	}
	assert.ok(compared > 0, "no measure compared");
	return out;
}

test("trial balance: tree total = last internal 'Total' row (six columns)", () => {
	const r = load("trial_balance_fy2026");
	const ref = r.report_totals.internal.at(-1);
	const out = check_against(r, ref);
	assert.equal(out.mode, "tree");
	for (const k of ["opening_debit", "opening_credit", "debit", "credit", "closing_debit", "closing_credit"]) {
		close(out.totals[k], ref[k], k);
	}
});

test("trial balance: tree rows follow the report hierarchy", () => {
	const r = load("trial_balance_fy2026");
	const out = create_engine(r).apply({});
	const roots = r.rows.filter((x) => x.__kind === "data" && x.__parent === null);
	assert.equal(out.rows.length, roots.length);
	const count = (list) => list.reduce((n, x) => n + 1 + (x._children ? count(x._children) : 0), 0);
	assert.equal(count(out.rows), r.rows.filter((x) => x.__kind === "data").length);
});

test("trial balance: group by currency sums the leaves (debit/credit equal the report)", () => {
	const r = load("trial_balance_fy2026");
	const out = create_engine(r).apply({ group: { by: ["currency"] } });
	assert.equal(out.mode, "group");
	const ref = r.report_totals.internal.at(-1);
	close(out.rows[0].debit, ref.debit, "debit");
	close(out.rows[0].credit, ref.credit, "credit");
	assert.equal(out.rows[0].__count, r.facts.length);
	let manual = 0;
	for (const f of r.facts) manual += f.closing_debit;
	close(out.rows[0].closing_debit, manual, "closing_debit (leaves)");
});

test("multi-level grouping: children sum to their parent", () => {
	const r = load("trial_balance_fy2026");
	const out = create_engine(r).apply({ group: { by: ["currency", "acc_number"] } });
	const top = out.rows[0];
	let s = 0;
	for (const g of top._children) s += g.debit;
	close(top.debit, s, "debit");
	assert.equal(top._children[0].__depth, 1);
});

test("accounts receivable: flat total = Frappe total row", () => {
	const r = load("accounts_receivable_frappe_total");
	assert.ok(r.report_totals.frappe_total);
	check_against(r, r.report_totals.frappe_total);
});

test("accounts receivable grouped by party: total = last internal total", () => {
	const r = load("accounts_receivable_group_by_party");
	check_against(r, r.report_totals.internal.at(-1));
});

test("general ledger: total = last internal total (balance excluded)", () => {
	for (const name of ["general_ledger_by_account", "general_ledger_consolidated"]) {
		const r = load(name);
		check_against(r, r.report_totals.internal.at(-1));
	}
});

test("view filters: tree total falls back to matching leaves", () => {
	const r = load("trial_balance_fy2026");
	const leaf = r.facts[0];
	const out = create_engine(r).apply({
		filters: [{ key: "account", type: "text", op: "equals", value: leaf.account }],
	});
	assert.equal(out.row_count, 1);
	close(out.totals.debit, leaf.debit, "debit");
});

test("expected block for export holds numbers only", () => {
	const r = load("trial_balance_fy2026");
	const engine = create_engine(r);
	const exp = engine.expected(engine.apply({}));
	assert.equal(exp.row_count, r.facts.length);
	for (const v of Object.values(exp.totals)) assert.equal(typeof v, "number");
});

test("mixed currencies give no total", () => {
	const r = load("trial_balance_fy2026");
	r.facts[0].currency = "USD";
	r.rows.find((x) => x.__rid === r.facts[0].__rid).currency = "USD";
	const out = create_engine(r).apply({ group: { by: ["acc_name"] } });
	assert.equal(out.totals.__mixed.debit, true);
	assert.equal(out.totals.debit, null);
});
