// Pure parts of the production hardening of the page: the fold of a grouping of the user
// (engine/group_fold.js), the column runs read from a grouped view, the wait for a queued
// Excel export (export_job.js), and the engine's reuse of an opened view (view_key).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import perspective from "@finos/perspective";

import { GroupFold } from "../../report_view/public/js/report_view/engine/group_fold.js";
import { column_runs } from "../../report_view/public/js/report_view/engine/queries.js";
import { wait_for_export, ExportJobError } from "../../report_view/public/js/report_view/export_job.js";
import { expanded_from_paths } from "../../report_view/public/js/report_view/engine/row_layout.js";
import { normalize } from "../../report_view/public/js/report_view/adapter/normalize.js";
import { default_state } from "../../report_view/public/js/report_view/state/view_state.js";
import { EngineHandles, ReportSession } from "../../report_view/public/js/report_view/engine/perspective_engine.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "../../report_view/tests/fixtures/normalize");
const load = (name) => normalize(JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8")).input);
const state = (patch = {}) => ({ ...default_state(), ...patch });
const handles = new EngineHandles(perspective);
after(() => handles.delete_all());

// x(p: 2 facts, q: 1 fact), y(p: 3 facts): the group view of two keys, every group shown
const PATHS = [["x"], ["x", "p"], ["x", "q"], ["y"], ["y", "p"]];
const COUNTS = [3, 2, 1, 3, 3];

test("group fold: every group open shows the facts of each deepest group as its run of the flat view", () => {
	const fold = new GroupFold(PATHS, COUNTS, 2);
	assert.equal(fold.leaf_count, 6);
	assert.deepEqual([...fold.depths], [1, 2, 3, 3, 2, 3, 1, 2, 3, 3, 3]);
	assert.deepEqual([...fold.leaf_at], [-1, -1, 0, 1, -1, 2, -1, -1, 3, 4, 5]);
	assert.deepEqual([...fold.group_at], [0, 1, -1, -1, 2, -1, 3, 4, -1, -1, -1]);
	assert.equal(fold.expanded(), "all");
});

test("group fold: the view state's fold, as Perspective opens it (a listed group under a closed one stays closed)", () => {
	const fold = new GroupFold(PATHS, COUNTS, 2);
	fold.apply({ depth: 0, expanded: null });
	assert.deepEqual([...fold.depths], [1, 1]);
	assert.equal(fold.expanded(), "none");
	fold.apply({ depth: 1, expanded: null });
	assert.deepEqual([...fold.depths], [1, 2, 2, 1, 2]);
	fold.apply({ depth: null, expanded: [["x"], ["x", "q"], ["y", "p"]] });
	// y is not listed: y/p stays closed under it
	assert.deepEqual([...fold.depths], [1, 2, 2, 3, 1]);
	assert.deepEqual(fold.expanded(), [["x"], ["x", "q"]]);
});

test("group fold: closing a group closes the groups inside it, opening opens that one only", () => {
	const fold = new GroupFold(PATHS, COUNTS, 2);
	assert.equal(fold.toggle_row(0, false), true);
	assert.deepEqual([...fold.depths], [1, 1, 2, 3, 3, 3]);
	fold.toggle_row(0, true);
	assert.deepEqual([...fold.depths], [1, 2, 2, 1, 2, 3, 3, 3]);
	// a fact row is no group
	assert.equal(fold.toggle_row(5, false), false);
	// the same answer as the paths of the rows would give
	const paths = [];
	let last = null;
	for (let i = 0; i < fold.depths.length; i++) {
		if (fold.group_at[i] >= 0) last = PATHS[fold.group_at[i]];
		paths.push(fold.group_at[i] >= 0 ? last : [...last, fold.leaf_at[i]]);
	}
	assert.deepEqual(fold.expanded(), expanded_from_paths(paths, 3));
});

test("group fold: no groups (nothing matches the filters)", () => {
	const fold = new GroupFold([], [], 1);
	assert.equal(fold.depths.length, 0);
	assert.equal(fold.expanded(), "all");
});

test("column runs: neighbouring view columns read together, unknown names left out", () => {
	assert.deepEqual(column_runs({ a: 0, b: 1, c: 2, d: 5, e: 6 }, ["e", "a", "b", "d", "zz", "a"]), [
		[0, 2],
		[5, 7],
	]);
	assert.deepEqual(column_runs({ a: 0 }, []), []);
});

test("export job: polls until done, reports every state, gives the server's error, stops on the limit or the user", async () => {
	let t = 0;
	const clock = { now: () => t, sleep: async (ms) => void (t += ms) };
	const states = ["queued", "running", "running", "done"];
	const seen = [];
	let calls = 0;
	const done = await wait_for_export("abc", {
		...clock,
		status: async (job) => {
			assert.equal(job, "abc");
			return { state: states[calls++], row_count: 25000 };
		},
		on_state: (s) => seen.push(s.state),
	});
	assert.equal(done.state, "done");
	assert.deepEqual(seen, states);
	assert.equal(t, 3 * 1500);

	await assert.rejects(
		wait_for_export("abc", { ...clock, status: async () => ({ state: "failed", error: "Out of memory" }) }),
		(e) => e instanceof ExportJobError && e.reason === "failed" && e.message === "Out of memory"
	);
	t = 0;
	await assert.rejects(
		wait_for_export("abc", { ...clock, limit_ms: 10000, status: async () => ({ state: "running" }) }),
		(e) => e.reason === "timeout"
	);
	let stop = false;
	let asked = 0;
	await assert.rejects(
		wait_for_export("abc", {
			...clock,
			cancelled: () => stop,
			status: async () => {
				asked += 1;
				if (asked === 2) stop = true;
				return { state: "running" };
			},
		}),
		(e) => e.reason === "cancelled"
	);
	assert.equal(asked, 2);
});

test("engine: a view state with the same engine config keeps its key; the fold of a grouping is no part of it", async () => {
	const report = load("accounts_receivable_frappe_total");
	const session = await ReportSession.create(handles, report, { locale: "ar" });
	try {
		const by = (patch) => session.view_key(session.spec_of(state(patch)));
		const grouped = { group: { by: ["party"], subtotals: true, expanded: "all" } };
		assert.equal(by(grouped), by({ group: { ...grouped.group, subtotals: false } }));
		assert.equal(by(grouped), by({ ...grouped, mode: "pivot" }));
		assert.equal(by(grouped), by({ group: { ...grouped.group, expanded: "none" } }));
		assert.notEqual(by(grouped), by({ group: { by: ["voucher_type"] } }));
		assert.notEqual(by({}), by({ filters: [{ key: "party", type: "text", op: "contains", value: "a" }] }));
		// a flat view: the aggregate of a measure changes the total, so the key
		assert.notEqual(by({}), by({ values: [{ key: "paid", agg: "avg" }] }));

		// the light path (pivot, charts): the same counts and totals without the grid view
		const filtered = { ...grouped, filters: [{ key: "party", type: "text", op: "contains", value: "a" }] };
		const full = await session.open(state(filtered));
		const light = await session.summarize(state(filtered));
		assert.equal(light.view, null);
		assert.deepEqual(light.counts, full.counts);
		assert.deepEqual(light.expected, full.expected);
		await session.close_view(full);
		assert.deepEqual(handles.debug_handles().filter((h) => h.kind === "view"), []);

		// a newer request of the main slot makes an older one give null, its views deleted
		const first = session.open(state(grouped));
		session.supersede();
		assert.equal(await first, null);
		assert.deepEqual(handles.debug_handles().filter((h) => h.kind === "view"), []);
	} finally {
		await session.close();
	}
});

test("bundles: the Charts bundle takes the page's shared modules (one popover), the Pages view is a bundle of its own", (t) => {
	const esbuild = path.resolve(here, "../../../frappe/node_modules/.bin/esbuild");
	if (!fs.existsSync(esbuild)) return t.skip("no esbuild on this bench");
	const js = path.resolve(here, "../../report_view/public/js");
	const inputs = (bundle) => {
		const meta = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rv-bundle-")), "meta.json");
		execFileSync(esbuild, [path.join(js, bundle), "--bundle", "--format=iife", "--target=es2017", "--outfile=/dev/null", `--metafile=${meta}`, "--log-level=error"]);
		const out = fs.readFileSync(meta, "utf8");
		fs.rmSync(path.dirname(meta), { recursive: true, force: true });
		return Object.keys(JSON.parse(out).inputs).filter((k) => !k.includes("node_modules")).map((k) => k.split("public/js/")[1]);
	};
	const charts = inputs("report_view_charts.bundle.js");
	for (const shared of ["components/popover.js", "components/set_filter.js", "components/icons.js", "engine/chart_config.js", "state/dashboard_state.js"]) {
		assert.ok(!charts.includes(`report_view/${shared}`), `${shared} is bundled twice`);
	}
	assert.ok(charts.includes("report_view/views/charts_view.js"));
	const main = inputs("report_view.bundle.js");
	assert.ok(!main.includes("report_view/views/pages_view.js"), "pages_view.js is in the main bundle");
	assert.ok(main.includes("report_view/components/popover.js"));
	assert.ok(inputs("report_view_pages.bundle.js").includes("report_view/views/pages_view.js"));
});
