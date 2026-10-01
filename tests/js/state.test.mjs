import { test } from "node:test";
import assert from "node:assert/strict";

import { default_state, sanitize, reconcile } from "../../report_view/public/js/report_view/state/view_state.js";
import { encode_state, decode_state, build_search, MAX_URL } from "../../report_view/public/js/report_view/state/url.js";

test("sanitize drops unknown keys and bad values", () => {
	const s = sanitize({ v: 1, mode: "nope", evil: 1, sort: [{ key: "a", dir: "x" }, 5], group: { by: ["g", 3] } });
	assert.equal(s.mode, "grid");
	assert.equal("evil" in s, false);
	assert.deepEqual(s.sort, [{ key: "a", dir: "asc" }]);
	assert.deepEqual(s.group.by, ["g"]);
});

test("a newer state version falls back to the default view", () => {
	assert.equal(sanitize({ v: 99 }).__newer, true);
});

test("reconcile removes references to missing columns", () => {
	const s = sanitize({ group: { by: ["a", "gone"] }, sort: [{ key: "gone", dir: "desc" }] });
	reconcile(s, [{ key: "a" }]);
	assert.deepEqual(s.group.by, ["a"]);
	assert.deepEqual(s.sort, []);
});

test("rv round-trips UTF-8 and excludes report_filters and ui", () => {
	const s = sanitize({ group: { by: ["الحساب"] } });
	s.report_filters = { company: "x" };
	s.ui = { density: "compact" };
	const back = decode_state(encode_state(s));
	assert.deepEqual(back.group.by, ["الحساب"]);
	assert.equal("report_filters" in back, false);
	assert.equal("ui" in back, false);
	assert.equal(decode_state("%%%"), null);
});

test("URL: filters as plain params, rv only for a non-default view, dropped when too long", () => {
	const plain = build_search({ company: "SND", cost_center: ["A"], empty: "" }, default_state(), "/desk/report-view/X");
	assert.equal(plain.search, "?company=SND&cost_center=%5B%22A%22%5D");
	const grouped = build_search({}, sanitize({ group: { by: ["a"] } }), "/p");
	assert.match(grouped.search, /^\?rv=/);
	const huge = sanitize({ group: { by: Array.from({ length: 50 }, (_, i) => "k".repeat(60) + i) } });
	const r = build_search({}, huge, "/p");
	assert.equal(r.rv_dropped, true);
	assert.ok(r.search.length < MAX_URL);
});

test("sanitize keeps fold, widths and pinned columns; widths never go under the minimum", () => {
	const s = sanitize({
		columns: { widths: { a: 40, b: 210.4, c: "x", d: -5 }, pinned: { start: ["a", 3], end: ["z"] } },
		group: { by: ["g"], subtotals: false, expanded: [["A"], ["B", null, 3], "bad", [], [{}]] },
		tree: { depth: 2, expanded: [3, "4", -1, 7.5, 9] },
	});
	assert.deepEqual(s.columns.widths, { a: 72, b: 210 });
	assert.deepEqual(s.columns.pinned, { start: ["a"], end: ["z"] });
	assert.equal(s.group.subtotals, false);
	assert.deepEqual(s.group.expanded, [["A"], ["B", null, 3]]);
	assert.deepEqual(s.tree, { depth: 2, expanded: [3, 9] });
	assert.equal(sanitize({ group: { expanded: "none" } }).group.expanded, "none");
	assert.equal(sanitize({ group: { expanded: "x" } }).group.expanded, "all");

	reconcile(s, [{ key: "b" }]);
	assert.deepEqual(s.columns.widths, { b: 210 });
	assert.deepEqual(s.columns.pinned, { start: [], end: [] });
});

test("URL: a width, a fold, the subtotal option or a pinned column make the view non-default", () => {
	const has_rv = (patch) => {
		const s = sanitize(patch);
		const { search } = build_search({}, s, "/p");
		if (search) assert.deepEqual(sanitize(decode_state(new URLSearchParams(search).get("rv"))), s);
		return search.startsWith("?rv=");
	};
	assert.equal(has_rv({}), false);
	assert.equal(has_rv({ columns: { widths: { a: 200 } } }), true);
	assert.equal(has_rv({ columns: { pinned: { start: ["a"] } } }), true);
	assert.equal(has_rv({ group: { subtotals: false } }), true);
	assert.equal(has_rv({ group: { by: ["g"], expanded: [["A", "x"], [null]] } }), true);
	assert.equal(has_rv({ group: { expanded: "none" } }), true);
	assert.equal(has_rv({ tree: { expanded: [] } }), true);
	assert.equal(has_rv({ tree: { expanded: [0, 4] } }), true);
});
