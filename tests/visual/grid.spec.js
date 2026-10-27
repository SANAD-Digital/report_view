// @ts-check
// The grid: screenshots of the report trees, horizontal and vertical scroll in both directions, folding, re-runs and the bundle of `bench build`.
// Fails on any console error or warning (helpers.js watch_console).
const path = require("node:path");
const fs = require("node:fs");
const { test, expect } = require("@playwright/test");
const {
	rv,
	SHOTS,
	watch_console,
	open,
	settle,
	wheel_to_end,
	shot,
	probe,
	shown,
} = require("./helpers.js");


for (const s of SHOTS) {
	test(s.name, async ({ page }) => {
		const problems = watch_console(page);
		await open(page, s.query, s);
		await shot(page, s.name, Boolean(s.full));
		expect(problems, "console errors/warnings").toEqual([]);
	});
}


test("RTL: horizontal scroll keeps the label column pinned and reaches the last column", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=ar&lang=ar");
	const before = await probe(page);
	expect(before.label_start).toBeLessThanOrEqual(1);
	expect(before.xs[0]).toBe(0);
	expect(before.total_lefts).toEqual(before.head_lefts);

	// Half way with the wheel (a user in RTL scrolls towards negative x).
	await page.locator("regular-table").hover();
	await page.mouse.wheel(-900, 0);
	await page.waitForTimeout(300);
	await settle(page);
	const middle = await probe(page);
	expect(middle.label_start).toBeLessThanOrEqual(1);
	expect(middle.label_width).toBe(before.label_width);
	expect(middle.xs[0]).toBeGreaterThan(0);
	expect(middle.total_lefts).toEqual(middle.head_lefts);
	await shot(page, "ar-pinned-shadow-scrolled-light-rtl");

	// To the end: the last column of the report is drawn.
	const last = await page.evaluate(() => window.rv_page.grid.model.data.length - 1);
	for (let i = 0; i < 12; i++) {
		await page.mouse.wheel(-1500, 0);
		await page.waitForTimeout(120);
	}
	await settle(page);
	const end = await probe(page);
	expect(end.xs).toContain(last);
	expect(end.label_start).toBeLessThanOrEqual(1);
	expect(problems, "console errors/warnings").toEqual([]);
});


test("LTR: horizontal scroll keeps the label column pinned", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=ar&lang=en");
	await page.locator("regular-table").hover();
	await page.mouse.wheel(900, 0);
	await page.waitForTimeout(300);
	await settle(page);
	const middle = await probe(page);
	expect(middle.label_start).toBeLessThanOrEqual(1);
	expect(middle.xs[0]).toBeGreaterThan(0);
	expect(middle.total_lefts).toEqual(middle.head_lefts);
	await shot(page, "ar-pinned-shadow-scrolled-light-ltr");
	expect(problems, "console errors/warnings").toEqual([]);
});


test("vertical scroll: rows are read in windows, the last row is reachable, no spare row shows", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=ar&lang=ar", { width: 1440, height: 700 });
	const rows = () =>
		page.evaluate(() => {
			const rt = document.querySelector("regular-table");
			const box = rt.getBoundingClientRect();
			const live = [...rt.querySelectorAll("tbody tr:not(.stale)")];
			const ys = live.map((tr) => rt.getMeta(tr.firstElementChild).y);
			const head = rt.querySelector("thead").getBoundingClientRect();
			return {
				ys,
				drawn: rt.querySelectorAll("tbody tr").length,
				total: window.rv_page.grid.body_rows,
				last_bottom: Math.round(live.at(-1).getBoundingClientRect().bottom - box.bottom),
				head_top: Math.round(head.top - box.top),
				labels: live.map((tr) => tr.firstElementChild.textContent.trim()),
			};
		});
	const top = await rows();
	expect(top.total).toBe(66);
	expect(top.ys[0]).toBe(0);
	// only the window on screen is in the DOM
	expect(top.drawn).toBeLessThan(30);
	await wheel_to_end(page, 0, 100000);
	await page.waitForTimeout(300);
	await settle(page);
	const end = await rows();
	expect(end.ys.at(-1)).toBe(65);
	expect(end.ys).toEqual(end.ys.map((_, i) => end.ys[0] + i));
	// the last row ends at the bottom edge: no empty strip below it (views/rtl_adapter.js fit_header)
	expect(Math.abs(end.last_bottom)).toBeLessThanOrEqual(1);
	expect(end.head_top).toBe(0);
	expect(end.labels.every(Boolean)).toBe(true);
	expect(problems, "console errors/warnings").toEqual([]);
});


test("tree: folding a parent hides its descendants (engine filter) and keeps the totals", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=ar");
	const before = await page.evaluate(() => ({ rows: window.rv_page.opened.body_rows, totals: window.rv_page.debug_totals() }));
	expect(before.rows).toBe(31);
	expect(before.totals.totals.closing_debit).toBe(7553469);
	await page.locator("regular-table tbody tr").first().locator(".rv-caret").click();
	await page.waitForFunction(() => window.rv_page.opened && window.rv_page.opened.body_rows === 21);
	await settle(page);
	const after = await page.evaluate(() => ({
		filter: window.rv_page.opened.spec.config.filter,
		totals: window.rv_page.debug_totals(),
		first: document.querySelector("regular-table tbody tr th .rv-caret").getAttribute("aria-expanded"),
		handles: window.rv_page.debug_handles(),
	}));
	expect(after.filter).toEqual([["__anc_1", "not in", [0]]]);
	expect(after.totals).toEqual(before.totals);
	expect(after.first).toBe("false");
	// the nodes and facts tables and the one view on screen: the previous view was deleted
	expect(after.handles.map((h) => h.kind).sort()).toEqual(["table", "table", "view"]);
	await shot(page, "tb-tree-parent-collapsed-light-rtl");
	expect(problems, "console errors/warnings").toEqual([]);
});


test("tree with a browser filter: re-grouped on the level columns, sums from the matching leaves", async ({ page }) => {
	const problems = watch_console(page);
	const labels = () =>
		page.evaluate(() =>
			[...document.querySelectorAll("regular-table tbody tr:not(.stale):not(.foot)")].map((tr) => tr.firstElementChild.textContent.trim())
		);
	// every leaf matches: the same 31 nodes as the report tree, no copy of a shallow leaf
	await open(page, `report=tb&lang=ar&rv=${rv({ filters: [{ key: "account", type: "text", op: "contains", value: " - SA" }] })}`, {
		width: 1440,
		height: 2600,
	});
	const all = await page.evaluate(() => ({ post: window.rv_page.opened.post.shape, rows: window.rv_page.opened.body_rows }));
	expect(all).toEqual({ post: "levels", rows: 31 });
	const names = await labels();
	expect(names.length).toBe(31);
	expect(new Set(names).size).toBe(31);

	await open(page, `report=tb&lang=ar&rv=${rv({ filters: [{ key: "debit", type: "range", min: 100000, max: null }] })}`);
	const state = await page.evaluate(() => ({
		counts: window.rv_page.opened.counts,
		totals: window.rv_page.debug_totals().totals,
		expected: window.rv_page.export_model().expected,
	}));
	expect(state.counts).toEqual({ shown: 6, total: 16, facts: 6, groups: null });
	expect(state.totals.debit).toBe(30096601);
	expect(state.expected.row_count).toBe(6);
	await shot(page, "tb-filter-levels-subtotals-light-rtl");
	expect(problems, "console errors/warnings").toEqual([]);
});


test("grouping: a group closes and opens through the engine view", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=ar&group=account__root_type");
	const rows = () => page.evaluate(() => window.rv_page.grid.body_rows);
	const open_rows = await rows();
	await page.locator("regular-table tbody tr.group").first().locator(".rv-caret").click();
	await page.waitForFunction((n) => window.rv_page.grid.body_rows < n, open_rows);
	await settle(page);
	await shot(page, "tb-group-collapsed-light-rtl");
	const closed_rows = await rows();
	await page.locator("regular-table tbody tr.group").first().locator(".rv-caret").click();
	await page.waitForFunction((n) => window.rv_page.grid.body_rows > n, closed_rows);
	expect(await rows()).toBe(open_rows);
	expect(problems, "console errors/warnings").toEqual([]);
});


test("the bundle written by `bench build` runs the same page (WASM and worker from /assets)", async ({ page }) => {
	const manifest = path.resolve(__dirname, "../../../../sites/assets/assets.json");
	const built = fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, "utf8"))["report_view.bundle.js"] : null;
	test.skip(!built || !fs.existsSync(path.resolve(__dirname, "../../../../sites", `.${built}`)), "no build output");
	const problems = watch_console(page);
	const requests = [];
	page.on("request", (r) => requests.push(new URL(r.url()).pathname + new URL(r.url()).search));
	await open(page, "report=tb&lang=ar&built=1");
	expect(requests).toContain(built);
	expect(requests).toContain("/assets/report_view/node_modules/@finos/perspective/dist/wasm/perspective-server.wasm?v=3.8.0");
	expect(requests).toContain("/assets/report_view/node_modules/@finos/perspective/dist/wasm/perspective-js.wasm?v=3.8.0");
	expect(requests).toContain("/assets/report_view/node_modules/@finos/perspective/dist/cdn/perspective-server.worker.js?v=3.8.0");
	expect(requests.some((r) => r.includes("dist/harness.js"))).toBe(false);
	const state = await page.evaluate(() => ({
		totals: window.rv_page.debug_totals(),
		rows: window.rv_page.opened.body_rows,
		drawn: document.querySelectorAll("regular-table tbody tr").length,
		first: document.querySelector("regular-table tbody th").textContent.trim(),
	}));
	expect(state.totals.mode).toBe("tree");
	expect(state.totals.totals.closing_credit).toBe(7553469);
	expect(state.rows).toBe(31);
	expect(state.drawn).toBeGreaterThan(5);
	expect(state.first).toContain("1000");
	await shot(page, "tb-tree-built-bundle-rtl");
	expect(problems, "console errors/warnings").toEqual([]);
});


test("a filter change runs the report again by itself, as query-report does; refresh re-runs", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=ar");
	const runs = await page.evaluate(() => window.rv_page.run_token);
	// the filters other than the company and the period stand behind "More options"
	await page.locator(".rv-more").click();
	await page.locator('.rv-filter[data-fieldname="show_zero_values"] input[type=checkbox]').check();
	await expect.poll(() => page.evaluate(() => window.rv_page.run_token)).toBe(runs + 1);
	await page.keyboard.press("Escape");
	await page.locator('.rv-headbar [data-action="refresh"]').click();
	await expect.poll(() => page.evaluate(() => window.rv_page.run_token)).toBe(runs + 2);
	expect(problems, "console errors/warnings").toEqual([]);
});


test("lifecycle: no view or table is left after 20 switches, re-runs and leaving the page", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=ar");
	const kinds = () => page.evaluate(() => window.rv_page.debug_handles().map((h) => h.kind).sort());
	expect(await kinds()).toEqual(["table", "table", "view"]);
	for (let i = 0; i < 20; i++) {
		// alternately: a new run of the report, and a change of the view state
		if (i % 2) {
			await page.evaluate(() => window.rv_page.run());
		} else {
			await page.evaluate(async (by) => {
				window.rv_page.state.group.by = by;
				await window.rv_page.render();
			}, i % 4 ? [] : ["account__root_type"]);
		}
		await page.waitForFunction(() => window.rv_page.opened && window.rv_page.grid.current === window.rv_page.opened);
		// a grouping holds two views: its groups and the flat view of their facts
		expect(await kinds(), `cycle ${i}`).toEqual(i % 4 < 2 ? ["table", "table", "view", "view"] : ["table", "table", "view"]);
	}
	// leaving the page: every view and table is deleted
	await page.evaluate(() => window.rv_page.hide());
	await page.waitForFunction(() => window.rv_page.debug_handles().length === 0);
	// a minute later the worker is terminated; coming back starts a new one
	await page.evaluate(() => window.rv_page.debug_dispose_engine());
	// and back: the tables are loaded again from the same result
	await page.evaluate(() => window.rv_page.show());
	await page.waitForFunction(() => window.rv_page.opened && window.rv_page.grid.current === window.rv_page.opened);
	expect(await kinds()).toEqual(["table", "table", "view"]);
	expect((await page.evaluate(() => window.rv_page.debug_totals())).totals.debit).toBe(30303624);
	expect(problems, "console errors/warnings").toEqual([]);
});
