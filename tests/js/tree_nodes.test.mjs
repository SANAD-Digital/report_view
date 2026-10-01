// N9: the nodes table (tree "as is") and the facts table with level columns.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalize } from "../../report_view/public/js/report_view/adapter/normalize.js";
import {
	tree_index,
	build_nodes,
	build_facts,
	row_label,
} from "../../report_view/public/js/report_view/engine/tree_nodes.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "../../report_view/tests/fixtures/normalize");
const load = (name) => normalize(JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8")).input);
const column = (extras, name) => extras.find((e) => e.name === name).values;

test("trial balance nodes: every data row, in report order, with depth, ancestors and counts", () => {
	const report = load("trial_balance_fy2026");
	const nodes = build_nodes(report);
	const data = report.rows.filter((r) => r.__kind === "data");
	assert.deepEqual(nodes.rows.map((r) => r.__rid), data.map((r) => r.__rid));
	assert.equal(nodes.rows.length, 31);
	assert.equal(nodes.max_depth, 3);
	assert.deepEqual(column(nodes.extras, "__depth"), data.map((r) => r.__indent));
	assert.deepEqual(column(nodes.extras, "__path"), data.map((_, i) => i));
	assert.deepEqual(column(nodes.extras, "__has_children"), data.map((r) => !r.__is_leaf));
	// 1110 - نقد: 1000 > 1100-1600 > 1100
	const cash = data.findIndex((r) => r.acc_number === "1110");
	assert.deepEqual(
		["__anc_1", "__anc_2", "__anc_3"].map((n) => column(nodes.extras, n)[cash]),
		[0, 1, 2]
	);
	// 4110 - مبيعات is a leaf two levels down: its third ancestor is empty
	const sales = data.findIndex((r) => r.acc_number === "4110");
	assert.deepEqual(
		["__anc_1", "__anc_2", "__anc_3"].map((n) => column(nodes.extras, n)[sales]),
		[17, 18, null]
	);
	assert.equal(nodes.extras.some((e) => e.name === "__anc_4"), false);
	const leaves = column(nodes.extras, "__leaves");
	assert.equal(leaves[0], 6);
	assert.equal(leaves[cash], 0);
	const top = column(nodes.extras, "__top");
	assert.deepEqual(data.filter((_, i) => top[i]).map((r) => r.acc_number), ["1000", "2000", "4000", "5000"]);
	assert.equal(leaves.filter((_, i) => top[i]).reduce((a, b) => a + b, 0), report.facts.length);
});

test("trial balance facts: leaves with level_1..n; a short chain is filled with the leaf itself", () => {
	const report = load("trial_balance_fy2026");
	const facts = build_facts(report);
	assert.deepEqual(facts.rows.map((r) => r.__rid), report.facts.map((r) => r.__rid));
	assert.deepEqual(facts.level_names, ["level_1", "level_2", "level_3"]);
	const at = (rid) => facts.rows.findIndex((r) => r.__rid === rid);
	const levels = (rid) => facts.level_names.map((n) => column(facts.extras, n)[at(rid)]);
	assert.deepEqual(levels(3), [
		"1000 - استخدام الاموال (الأصول) - SA",
		"1100-1600 - أصول متداولة - SA",
		"1100 - النقدية الحاضرة - SA",
	]);
	assert.deepEqual(levels(19), ["4000 - الإيرادات - SA", "4100 - إيراد مباشر - SA", "4110 - مبيعات - SA"]);
	assert.equal(column(facts.extras, "__levels")[at(19)], 2);
	assert.equal(column(facts.extras, "__levels")[at(3)], 3);
	assert.equal(column(facts.extras, "__path")[at(19)], 19);
	for (const name of facts.level_names) assert.ok(column(facts.extras, name).every((v) => v !== null), name);
	// every level path leads back to the report row of that node
	assert.equal(facts.level_rids.get(JSON.stringify(levels(3).slice(0, 2))), 1);
	assert.equal(facts.level_rids.get(JSON.stringify(levels(19))), 19);
});

test("a group header is a node without values: the data rows below it are the topmost ones", () => {
	const report = {
		columns: [{ key: "name", role: "dimension" }],
		tree: { enabled: true, label_key: "name" },
		rows: [
			{ __rid: 0, __kind: "group_header", __parent: null, name: "A" },
			{ __rid: 1, __kind: "data", __parent: 0, name: "a1" },
			{ __rid: 2, __kind: "data", __parent: 1, name: "a1x" },
			{ __rid: 3, __kind: "separator", __parent: null, name: null },
			{ __rid: 4, __kind: "internal_total", __parent: null, name: "Total" },
		],
	};
	report.facts = [report.rows[2]];
	const { rows, info } = tree_index(report);
	assert.deepEqual(rows.map((r) => r.__rid), [0, 1, 2]);
	assert.deepEqual([0, 1, 2].map((rid) => info.get(rid).top), [false, true, false]);
	assert.deepEqual([0, 1, 2].map((rid) => info.get(rid).leaves), [1, 1, 0]);
	const facts = build_facts(report);
	assert.deepEqual(facts.extras.find((e) => e.name === "level_1").values, ["A"]);
	assert.deepEqual(facts.extras.find((e) => e.name === "level_2").values, ["a1"]);
	assert.equal(row_label({ other: "x" }, "name", [{ key: "other", role: "dimension" }]), "x");
});
