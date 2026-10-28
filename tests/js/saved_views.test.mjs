// Saved views (ADR-010): what a view saves, whether the page still shows it, the filters it
// gives, its columns found again (§7.3), the menu's lists and the view the page opens with,
// and the link (§7.4: ?view=, with rv once changed).
import { test } from "node:test";
import assert from "node:assert/strict";

import "./_setup.mjs";
const sv = await import("../../report_view/public/js/report_view/state/saved_views.js");
const { default_state, sanitize, reconcile } = await import("../../report_view/public/js/report_view/state/view_state.js");
const { restrict_state, sanitize_features } = await import("../../report_view/public/js/report_view/state/features.js");
const { build_search, decode_state } = await import("../../report_view/public/js/report_view/state/url.js");

const COLUMNS = [
	{ key: "account", label: "Account", fieldtype: "Link", source_index: 0 },
	{ key: "debit", label: "Debit", fieldtype: "Currency", source_index: 1 },
	{ key: "credit", label: "Credit", fieldtype: "Currency", source_index: 2 },
	{ key: "posting_date", label: "Posting Date", fieldtype: "Date", source_index: 3, date: true },
];

test("a view saves the state without the page's preferences, the filters only when asked", () => {
	const s = sanitize({ sort: [{ key: "debit", dir: "desc" }], ui: { density: "compact", side_panel: "columns" } });
	s.__newer = true;
	const plain = sv.view_payload(s);
	assert.equal(plain.ui, undefined);
	assert.equal(plain.__newer, undefined);
	assert.equal(plain.report_filters, undefined);
	assert.deepEqual(plain.sort, [{ key: "debit", dir: "desc" }]);
	const with_f = sv.view_payload(s, { company: "SND", cost_center: [], finance_book: "", show_zero_values: 0 });
	assert.deepEqual(with_f.report_filters, { company: "SND", show_zero_values: 0 });
	// the page's state is not changed
	assert.equal(s.ui.density, "compact");
});

test("the page shows the view while its state and (kept) filters are the view's", () => {
	const base = sanitize({ sort: [{ key: "debit", dir: "desc" }] });
	const view = { state: sv.view_payload(base), filters: { company: "SND" } };
	const now = sanitize(JSON.parse(JSON.stringify(base)));
	now.ui.density = "compact";
	assert.equal(sv.same_snapshot(sv.snapshot(now, { company: "SND", finance_book: "" }, true), view), true);
	assert.equal(sv.same_snapshot(sv.snapshot(now, { company: "Other" }, true), view), false);
	now.sort = [];
	assert.equal(sv.same_snapshot(sv.snapshot(now, { company: "SND" }, true), view), false);
	// a view without filters: the filters do not count
	const plain = { state: sv.view_payload(base), filters: null };
	assert.equal(sv.same_snapshot(sv.snapshot(base, { company: "Any" }, false), plain), true);
	// the order of keys does not matter
	assert.equal(sv.stable({ b: 1, a: [1, { d: 2, c: 3 }] }), sv.stable({ a: [1, { c: 3, d: 2 }], b: 1 }));
});

test("a view's filters set every report filter: its value, or empty", () => {
	const controls = [
		{ fieldname: "company", fieldtype: "Link" },
		{ fieldname: "cost_center", fieldtype: "MultiSelectList" },
		{ fieldname: "show_zero_values", fieldtype: "Check" },
		{ fieldname: "finance_book", fieldtype: "Link" },
	];
	assert.deepEqual(sv.filters_to_apply({ company: "SND", cost_center: ["A"] }, controls), {
		company: "SND",
		cost_center: ["A"],
		show_zero_values: 0,
		finance_book: "",
	});
});

test("§7.3: a renamed column is found again by its label, then by its place and type", () => {
	const state = sanitize({
		sort: [{ key: "dr", dir: "desc" }],
		columns: { hidden: ["cr"], widths: { dr: 120 } },
		group: { by: ["acct"] },
		filters: [{ key: "gone", type: "text", op: "contains", value: "x" }],
	});
	const ref = {
		dr: { label: "Debit", fieldtype: "Currency", source_index: 9 },
		cr: { label: "Old credit", fieldtype: "Currency", source_index: 2 },
		acct: { label: "Account", fieldtype: "Link", source_index: 0 },
		gone: { label: "Remarks", fieldtype: "Data", source_index: 7 },
	};
	const out = sv.rebind(state, ref, COLUMNS);
	assert.deepEqual(out.renamed, { dr: "debit", cr: "credit", acct: "account" });
	assert.deepEqual(out.missing, ["Remarks"]);
	assert.deepEqual(state.sort, [{ key: "debit", dir: "desc" }]);
	assert.deepEqual(state.columns.hidden, ["credit"]);
	assert.deepEqual(state.columns.widths, { debit: 120 });
	assert.deepEqual(state.group.by, ["account"]);
	// the missing one is left for reconcile to drop
	reconcile(state, COLUMNS);
	assert.equal(state.filters.length, 1);
	// a translated label is found too; a derived date key is no missing column
	const s2 = sanitize({ sort: [{ key: "x", dir: "asc" }], group: { by: ["posting_date__year"] } });
	const out2 = sv.rebind(s2, { x: { label: "Haben", fieldtype: "Data", source_index: 50 } }, COLUMNS, (t) => (t === "Haben" ? "Credit" : t));
	assert.deepEqual(out2.renamed, { x: "credit" });
	assert.deepEqual(out2.missing, []);
	// without a reference: nothing to look for, the key is reported
	assert.deepEqual(sv.rebind(sanitize({ sort: [{ key: "zz", dir: "asc" }] }), null, COLUMNS).missing, ["zz"]);
});

test("a view that asks for what the report turned off is held to its settings", () => {
	const features = sanitize_features({ pivot: false, grouping: false, pinning: false });
	const state = sanitize({ mode: "pivot", group: { by: ["account"] }, columns: { pinned: { start: ["account"] } }, pivot: { rows: ["account"] } });
	restrict_state(state, features);
	assert.equal(state.mode, "grid");
	assert.equal(state.pivot, null);
	assert.deepEqual(state.group.by, []);
	assert.deepEqual(state.columns.pinned, { start: [], end: [] });
});

test("the menu's lists, the roles offered, the view the page opens with", () => {
	const rows = [
		{ name: "b", title: "Board", is_owner: false },
		{ name: "m2", title: "Zeta", is_owner: true },
		{ name: "m1", title: "Alpha", is_owner: true },
	];
	const { mine, shared } = sv.split_views(rows);
	assert.deepEqual(mine.map((r) => r.name), ["m1", "m2"]);
	assert.deepEqual(shared.map((r) => r.name), ["b"]);
	assert.deepEqual(sv.share_roles(["All", "Guest", "Desk User", "Accounts User", "Auditor", "Accounts User", "Administrator"]), ["Accounts User", "Auditor"]);
	const p = (q) => new URLSearchParams(q);
	const defaults = { saved_view: "d1" };
	assert.deepEqual(sv.view_to_open(p("view=x"), defaults), { name: "x", from: "link" });
	assert.deepEqual(sv.view_to_open(p("view=x&rv=abc"), defaults), { name: "x", from: "link" });
	assert.deepEqual(sv.view_to_open(p("rv=abc"), defaults), { name: null, from: null });
	assert.deepEqual(sv.view_to_open(p(""), defaults), { name: "d1", from: "default" });
	assert.deepEqual(sv.view_to_open(p(""), { saved_view: null }), { name: null, from: null });
	assert.deepEqual(sv.columns_payload([{ key: "a", label: "A", fieldtype: "Data", source_index: 3, original: {} }]), [{ key: "a", label: "A", fieldtype: "Data", source_index: 3 }]);
});

test("§7.4: the link names the view; a changed view carries its state too", () => {
	const base = default_state({});
	const state = sanitize({ sort: [{ key: "debit", dir: "desc" }] });
	const path = "/desk/report-view/Trial%20Balance";
	// as saved: the name only (even when the view is not the report's default state)
	let q = new URLSearchParams(build_search({ company: "SND" }, state, path, base, { name: "sv-1", modified: false }).search);
	assert.equal(q.get("view"), "sv-1");
	assert.equal(q.get("rv"), null);
	assert.equal(q.get("company"), "SND");
	// changed: the state too, even when it is the report's default state
	q = new URLSearchParams(build_search({}, sanitize(base), path, base, { name: "sv-1", modified: true }).search);
	assert.equal(q.get("view"), "sv-1");
	assert.ok(decode_state(q.get("rv")));
	// no view: as before
	q = new URLSearchParams(build_search({}, state, path, base).search);
	assert.equal(q.get("view"), null);
	assert.deepEqual(decode_state(q.get("rv")).sort, [{ key: "debit", dir: "desc" }]);
});
