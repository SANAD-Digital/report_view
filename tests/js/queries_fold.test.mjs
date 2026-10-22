// The folding of a grouped view (engine/queries.js, B6): the filled levels of an uneven tree
// are closed from the last row up in one burst (not one awaited round trip each), and the
// paths read last by the fold are handed to row_depths instead of being read again.
import { test } from "node:test";
import assert from "node:assert/strict";

import { set_depth, row_depths, ROW_PATH } from "../../report_view/public/js/report_view/engine/queries.js";
import { LEVELS } from "../../report_view/public/js/report_view/engine/tree_nodes.js";

/** A stand-in for a Perspective view: its calls recorded, each answered on a later turn. */
function fake_view(cols) {
	const calls = [];
	let pending = 0;
	let most = 0;
	const later = (value) => {
		pending += 1;
		most = Math.max(most, pending);
		return new Promise((resolve) =>
			setTimeout(() => {
				pending -= 1;
				resolve(value);
			}, 1)
		);
	};
	return {
		calls,
		most: () => most,
		to_columns: (opts) => (calls.push(["to_columns", opts]), later(cols())),
		collapse: (i) => (calls.push(["collapse", i]), later(0)),
		expand: (i) => (calls.push(["expand", i]), later(0)),
		set_depth: (d) => (calls.push(["set_depth", d]), later(undefined)),
	};
}

test("uneven tree: the rows standing for a leaf are closed from the last up, sent together", async () => {
	// row 0 the grand total; [A] opens [A, A1]; [B] a leaf filling level 2 ([B, B]); [C] opens [C, C1]
	const paths = [[], ["A"], ["A", "A1"], ["B"], ["B", "B"], ["C"], ["C", "C1"]];
	// __levels: the real depth of the row's node (B is a leaf of level 0)
	const levels = [0, 0, 1, 0, 1, 0, 1];
	const view = fake_view(() => ({ [ROW_PATH]: paths, [LEVELS]: levels }));
	const post = { shape: "levels", depth: 1, group_keys: ["l1", "l2"], index: { [LEVELS]: 3 } };
	const out = await set_depth(view, post);
	assert.equal(out, null);
	const collapses = view.calls.filter((c) => c[0] === "collapse").map((c) => c[1]);
	// every open group whose depth is its node's own level + 1: A (1), B (3), C (5), last first
	assert.deepEqual(collapses, [5, 3, 1]);
	// all in flight at once: the worker runs them in order
	assert.ok(view.most() >= 3, `collapses were awaited one by one (at most ${view.most()} in flight)`);
});

test("listed groups: the paths of the last level read are row_depths' own (no second read)", async () => {
	// nothing at level 1 is open: the first read is the last, and still stands
	const paths = [["A"], ["B"]];
	const view = fake_view(() => ({ [ROW_PATH]: paths }));
	const post = { shape: "group", depth: 0, expanded: [["Z"]], group_keys: ["g1", "g2"], row_offset: 1 };
	const known = await set_depth(view, post);
	assert.deepEqual(known, { paths });
	const reads = view.calls.filter((c) => c[0] === "to_columns").length;
	const structure = await row_depths(view, post, known.paths);
	assert.equal(view.calls.filter((c) => c[0] === "to_columns").length, reads);
	assert.deepEqual(structure, { depths: [1, 1], paths });
});

test("listed groups: after the last level opened something the paths are read again", async () => {
	let opened = false;
	const view = fake_view(() => ({ [ROW_PATH]: opened ? [["A"], ["A", "x"], ["B"]] : [["A"], ["B"]] }));
	const expand = view.expand;
	view.expand = (i) => ((opened = true), expand(i));
	const post = { shape: "group", depth: 0, expanded: [["A"]], group_keys: ["g1"], row_offset: 1 };
	const known = await set_depth(view, post);
	assert.equal(known, null);
	assert.deepEqual(view.calls.filter((c) => c[0] === "expand").map((c) => c[1]), [1]);
	const structure = await row_depths(view, post, known?.paths);
	assert.deepEqual(structure.depths, [1, 2, 1]);
});
