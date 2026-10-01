// Screenshots of the real page components (tests/visual/harness.html) for the design check,
// and the browser-side checks of the engine: RTL scrolling, folding, handle lifecycle.
// Phase 5a-1: subtotal rows, column widths, pinned columns and rows, fold in the URL.
// Saved to docs/progress/screens/phase-5a1/. Fails on any console error or warning.
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const OUT = path.resolve(__dirname, "../../docs/progress/screens/phase-5a1");

// The one documented exception to "no console warnings" (ADR-012): the Perspective client
// prints this wherever window.chrome is missing (headless shell, Firefox, Safari).
const ALLOWED = [/Unknown browser detected/];

// A view state as the `rv` URL parameter carries it (docs/architecture.md §7.4).
const rv = (state) => Buffer.from(JSON.stringify({ v: 1, ...state })).toString("base64url");
const NO_SUBTOTALS = rv({ group: { subtotals: false } });
const PINNED = rv({ columns: { pinned: { start: ["voucher_no", "voucher_type"] } } });

const SHOTS = [
	// subtotal rows of the report tree (on by default), light and dark, RTL and LTR
	{ name: "tb-tree-subtotals-light-rtl", query: "report=tb&lang=ar" },
	{ name: "tb-tree-subtotals-dark-rtl", query: "report=tb&lang=ar&desk=dark" },
	{ name: "tb-tree-subtotals-light-ltr", query: "report=tb&lang=en" },
	{ name: "tb-tree-subtotals-dark-ltr", query: "report=tb&lang=en&desk=dark" },
	{ name: "tb-tree-no-subtotals-light-rtl", query: `report=tb&lang=ar&rv=${NO_SUBTOTALS}` },
	{ name: "tb-tree-no-subtotals-dark-ltr", query: `report=tb&lang=en&desk=dark&rv=${NO_SUBTOTALS}` },
	{ name: "tb-tree-compact-rtl", query: "report=tb&lang=ar&density=compact" },
	// subtotal rows of a user grouping
	{ name: "tb-group-subtotals-light-rtl", query: "report=tb&lang=ar&group=account__root_type" },
	{ name: "tb-group-subtotals-dark-ltr", query: "report=tb&lang=en&desk=dark&group=account__root_type" },
	{ name: "ar-group-party-subtotals-light-ltr", query: "report=ar&lang=en&group=party" },
	{ name: "ar-group-party-subtotals-dark-rtl", query: "report=ar&lang=ar&desk=dark&group=party" },
	// the report's own opening / closing rows, pinned
	{ name: "gl-pinned-rows-light-rtl", query: "report=gl&lang=ar" },
	{ name: "gl-pinned-rows-dark-rtl", query: "report=gl&lang=ar&desk=dark" },
	{ name: "gl-pinned-rows-light-ltr", query: "report=gl&lang=en" },
	{ name: "gl-pinned-rows-dark-ltr", query: "report=gl&lang=en&desk=dark" },
	{ name: "gl-by-account-light-rtl", query: "report=gl_account&lang=ar" },
	{ name: "gl-by-account-dark-ltr", query: "report=gl_account&lang=en&desk=dark" },
	{ name: "ar-by-party-report-light-rtl", query: "report=ar_party&lang=ar" },
	// columns pinned next to the label column
	{ name: "ar-pinned-columns-light-rtl", query: `report=ar&lang=ar&rv=${PINNED}` },
	{ name: "ar-pinned-columns-dark-ltr", query: `report=ar&lang=en&desk=dark&rv=${PINNED}` },
	// 390px
	{ name: "tb-tree-390-rtl", query: "report=tb&lang=ar", width: 390, height: 844, full: true },
	{ name: "tb-tree-390-dark-ltr", query: "report=tb&lang=en&pref=dark", width: 390, height: 844, full: true },
	{ name: "gl-pinned-rows-390-rtl", query: "report=gl&lang=ar", width: 390, height: 844, full: true },
	{ name: "ar-group-party-390-dark-ltr", query: "report=ar&lang=en&pref=dark&group=party", width: 390, height: 844, full: true },
];

function watch_console(page) {
	const problems = [];
	page.on("console", (m) => {
		if (!["error", "warning"].includes(m.type())) return;
		if (ALLOWED.some((re) => re.test(m.text()))) return;
		problems.push(`${m.type()}: ${m.text()}`);
	});
	page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
	return problems;
}

async function open(page, query, { width = 1440, height = 1000 } = {}) {
	await page.setViewportSize({ width, height });
	await page.goto(`/harness.html?${query}`);
	await page.waitForFunction(() => document.body.dataset.ready || document.body.dataset.error, null, { timeout: 30_000 });
	const error = await page.evaluate(() => document.body.dataset.error || null);
	expect(error, "harness error").toBeNull();
	await page.evaluate(() => document.fonts.ready);
}

const settle = (page) => page.evaluate(() => window.rv_settle());
const shot = (page, name, full = false) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });

// Geometry of the table: where the pinned label column is, and which columns are drawn.
const probe = (page) =>
	page.evaluate(() => {
		const rt = document.querySelector("regular-table");
		const box = rt.getBoundingClientRect();
		const label = rt.querySelector("tbody th").getBoundingClientRect();
		const heads = [...rt.querySelectorAll("thead tr:last-child th.rv-hd:not(.rt-group-corner)")];
		const total = [...document.querySelectorAll(".rv-rt-total .rv-c:not(.pinned)")];
		return {
			label_start: Math.round(document.documentElement.dir === "rtl" ? box.right - label.right : label.left - box.left),
			label_width: Math.round(label.width),
			columns: heads.map((th) => th.textContent),
			xs: heads.map((th) => rt.getMeta(th).x),
			head_lefts: heads.map((th) => Math.round(th.getBoundingClientRect().left)),
			total_lefts: total.map((c) => Math.round(c.getBoundingClientRect().left)),
			rows: rt.querySelectorAll("tbody tr").length,
		};
	});

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
	await page.locator("regular-table").hover();
	await page.mouse.wheel(0, 100000);
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

test("server bar turns pending after a filter change and does not re-run", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=ar");
	const runs = await page.evaluate(() => window.rv_page.run_token);
	await page.locator('.rv-filter[data-fieldname="show_zero_values"] input[type=checkbox]').check();
	await expect(page.locator(".rv-server")).toHaveClass(/pending/);
	await page.waitForTimeout(500);
	expect(await page.evaluate(() => window.rv_page.run_token)).toBe(runs);
	await shot(page, "tb-pending-rtl");
	await page.locator('[data-action="run"]').click();
	await expect(page.locator(".rv-server")).not.toHaveClass(/pending/);
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
		expect(await kinds(), `cycle ${i}`).toEqual(["table", "table", "view"]);
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

// ---------------------------------------------------------------- phase 5a-1

// What is on screen, row by row: the class of the row, its label and its number cells.
const body = (page) =>
	page.evaluate(() =>
		[...document.querySelectorAll("regular-table tbody tr:not(.stale)")].map((tr) => ({
			cls: tr.className.replace("rv-tr", "").trim(),
			label: tr.firstElementChild.textContent.trim(),
			open: tr.querySelector(".rv-caret")?.getAttribute("aria-expanded") ?? null,
			nums: [...tr.querySelectorAll("td.num")].map((td) => td.textContent.trim()),
		}))
	);
const shown = (page) => page.waitForFunction(() => window.rv_page.opened && window.rv_page.grid.current === window.rv_page.opened);
// The `rv` the page wrote into its URL (history.replaceState, 300 ms after a change).
async function url_state(page) {
	await page.waitForTimeout(450);
	return page.evaluate(() => new URLSearchParams(window.location.search).get("rv"));
}
const header = (page, title) => page.locator("regular-table thead th.rv-hd", { hasText: title }).first();
const width_of = async (locator) => Math.round((await locator.boundingBox()).width);

async function drag_handle(page, th, dx) {
	const box = await th.locator(".rt-column-resize").boundingBox();
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + dx / 2, y, { steps: 4 });
	await page.mouse.move(x + dx, y, { steps: 4 });
	await page.mouse.up();
	await settle(page);
}

test("subtotal rows: after every open group, the open header keeps title and count only; off by the checkbox", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=ar&group=account__root_type", { width: 1440, height: 1500 });
	const on = await body(page);
	const groups = on.filter((r) => r.cls.startsWith("group"));
	const feet = on.filter((r) => r.cls === "foot");
	expect(groups.length).toBe(5);
	expect(feet.length).toBe(5);
	// an open group: no numbers in its header, they stand in the subtotal row after its rows
	for (const g of groups) expect(g.nums.every((n) => n === "")).toBe(true);
	for (const f of feet) expect(f.nums.some((n) => /\d/.test(n))).toBe(true);
	expect(feet[0].label).toContain("إجمالي");
	const first_foot = on.findIndex((r) => r.cls === "foot");
	expect(on[first_foot - 1].cls).toBe("");
	expect(on[first_foot + 1].cls).toMatch(/^group/);

	// closed: the header carries the same numbers its subtotal row showed
	await page.locator("regular-table tbody tr.group").first().locator(".rv-caret").click();
	await page.waitForFunction((n) => window.rv_page.grid.body_rows < n, on.length);
	await settle(page);
	const closed = await body(page);
	expect(closed[0].open).toBe("false");
	expect(closed[0].nums).toEqual(feet[0].nums);
	expect(closed.filter((r) => r.cls === "foot").length).toBe(4);

	// option off: no subtotal row, every header shows its numbers
	await page.locator('.rv-gp-tools input[data-action="subtotals"]').uncheck();
	await page.waitForFunction(() => window.rv_page.opened.post.subtotals === false);
	await shown(page);
	await settle(page);
	const off = await body(page);
	expect(off.filter((r) => r.cls === "foot").length).toBe(0);
	expect(off.filter((r) => r.cls.startsWith("group")).every((g) => g.nums.some((n) => /\d/.test(n)))).toBe(true);
	await shot(page, "tb-group-no-subtotals-light-rtl");
	const state = JSON.parse(Buffer.from(await url_state(page), "base64url").toString());
	expect(state.group.subtotals).toBe(false);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("subtotal rows of the report tree: the parent's own row of the report, shown again after its children", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=en", { width: 1440, height: 2600 });
	const on = await body(page);
	const feet = on.filter((r) => r.cls === "foot");
	const open_parents = on.filter((r) => r.open === "true");
	expect(feet.length).toBe(open_parents.length);
	expect(feet.length).toBeGreaterThan(5);
	for (const p of open_parents) expect(p.nums.every((n) => n === "")).toBe(true);
	// the report's values of the first root, as the standard page shows them
	const root = await page.evaluate(() => {
		const row = window.rv_page.report.rows.find((r) => r.__kind === "data");
		return { debit: row.debit, credit: row.credit };
	});
	const text = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2 });
	const root_foot = on.findLast((r) => r.cls === "foot" && r.label.includes(open_parents[0].label.replace(/^\S+\s*/, "").replace(/\s*\d+$/, "").trim()));
	expect(root_foot.nums).toContain(text(root.debit));
	expect(root_foot.nums).toContain(text(root.credit));
	// status bar and the badge of the grand total count the same thing: the leaf rows
	expect(await page.locator(".rv-status").textContent()).toContain("16 of 16");
	expect(await page.locator(".rv-rt-total .rv-gcount").textContent()).toBe("16");
	expect(problems, "console errors/warnings").toEqual([]);
});

for (const lang of ["ar", "en"]) {
	test(`column width (${lang}): the handle drags towards the end, not under 72px, and the width survives a reload from the URL`, async ({ page }) => {
		const problems = watch_console(page);
		const end = lang === "ar" ? -1 : 1;
		const title = lang === "ar" ? "مدين" : "Debit";
		await open(page, `report=tb&lang=${lang}`);
		const th = header(page, title);
		const before = await width_of(th);
		await shot(page, `tb-column-width-before-light-${lang === "ar" ? "rtl" : "ltr"}`);
		await drag_handle(page, th, end * 80);
		expect(await width_of(th)).toBe(before + 80);
		const state = await page.evaluate(() => window.rv_page.state.columns.widths);
		expect(state).toEqual({ opening_debit: before + 80 });
		// the cells, the total row and the header stay aligned
		const geo = await probe(page);
		expect(geo.total_lefts).toEqual(geo.head_lefts);
		await shot(page, `tb-column-width-after-light-${lang === "ar" ? "rtl" : "ltr"}`);

		// towards the start, far beyond the minimum
		await drag_handle(page, th, end * -600);
		expect(await width_of(th)).toBe(72);

		// the label column too
		const corner = page.locator("regular-table thead th.rv-hd.rt-group-corner").first();
		const label_before = await width_of(corner);
		await drag_handle(page, corner, end * 60);
		expect(await width_of(corner)).toBe(label_before + 60);
		const edge = await page.evaluate(() => Math.round(document.querySelector(".rv-rt-edge").getBoundingClientRect().width));
		expect(edge).toBe(label_before + 60);

		const saved = await url_state(page);
		const widths = JSON.parse(Buffer.from(saved, "base64url").toString()).columns.widths;
		expect(widths).toEqual({ opening_debit: 72, account: label_before + 60 });
		await open(page, `report=tb&lang=${lang}&rv=${saved}`);
		expect(await width_of(header(page, title))).toBe(72);
		expect(await width_of(page.locator("regular-table thead th.rv-hd.rt-group-corner").first())).toBe(label_before + 60);
		expect((await probe(page)).total_lefts).toEqual((await probe(page)).head_lefts);
		expect(problems, "console errors/warnings").toEqual([]);
	});
}

test("column width: a double click on the handle fits the content on screen", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=ar&lang=ar&rv=${rv({ columns: { widths: { party_account: 80, posting_date: 400 } } })}`);
	const th = header(page, "Receivable Account");
	expect(await width_of(th)).toBe(80);
	const clipped = await page.evaluate(() => {
		const td = [...document.querySelectorAll("regular-table tbody td")].find((c) => c.textContent.startsWith("1310"));
		return td.firstElementChild.scrollWidth > td.firstElementChild.clientWidth;
	});
	expect(clipped).toBe(true);
	await th.locator(".rt-column-resize").dblclick();
	await settle(page);
	const fitted = await width_of(th);
	expect(fitted).toBeGreaterThan(120);
	expect(fitted).toBeLessThan(260);
	const fits = await page.evaluate(() =>
		[...document.querySelectorAll("regular-table tbody td")]
			.filter((c) => c.textContent.startsWith("1310"))
			.every((td) => td.firstElementChild.scrollWidth <= td.firstElementChild.clientWidth)
	);
	expect(fits).toBe(true);
	expect(await page.evaluate(() => window.rv_page.state.columns.widths.party_account)).toBe(fitted);
	// the label column shrinks to its content
	const corner = page.locator("regular-table thead th.rv-hd.rt-group-corner").first();
	await corner.locator(".rt-column-resize").dblclick();
	await settle(page);
	expect(await width_of(corner)).toBeLessThan(200);
	await shot(page, "ar-column-autosize-light-rtl");
	expect(problems, "console errors/warnings").toEqual([]);
});

test("pinned columns: columns.pinned.start stay next to the label column while the others scroll", async ({ page }) => {
	const problems = watch_console(page);
	for (const lang of ["ar", "en"]) {
		await open(page, `report=ar&lang=${lang}&rv=${PINNED}`);
		const geo = () =>
			page.evaluate(() => {
				const rt = document.querySelector("regular-table");
				const box = rt.getBoundingClientRect();
				const rtl = document.documentElement.dir === "rtl";
				const start = (el) => Math.round(rtl ? box.right - el.getBoundingClientRect().right : el.getBoundingClientRect().left - box.left);
				const heads = [...rt.querySelectorAll("thead th.rv-hd.rt-group-corner")];
				const row = [...rt.querySelectorAll("tbody tr:first-child th")];
				return {
					titles: heads.map((th) => th.textContent.trim()),
					head_starts: heads.map(start),
					cell_starts: row.map(start),
					cells: row.map((th) => th.textContent.trim()),
					first_x: rt.getMeta(rt.querySelector("tbody td")).x,
					edge: Math.round(document.querySelector(".rv-rt-edge").getBoundingClientRect().width),
					total_pins: [...document.querySelectorAll(".rv-rt-total .rv-c.pinned")].map(start),
				};
			});
		const before = await geo();
		expect(before.titles.slice(1)).toEqual(["Voucher No", "Voucher Type"]);
		expect(before.head_starts[0]).toBeLessThanOrEqual(1);
		expect(before.cell_starts).toEqual(before.head_starts);
		expect(before.total_pins).toEqual(before.head_starts);
		expect(before.cells[1]).toMatch(/^ACC-/);
		expect(before.first_x).toBe(0);
		await page.locator("regular-table").hover();
		await page.mouse.wheel(lang === "ar" ? -700 : 700, 0);
		await page.waitForTimeout(300);
		await settle(page);
		const after = await geo();
		expect(after.first_x).toBeGreaterThan(0);
		expect(after.head_starts).toEqual(before.head_starts);
		expect(after.cell_starts).toEqual(before.head_starts);
		expect(after.cells).toEqual(before.cells);
		// the shadow stands at the end of the last pinned column
		expect(after.edge).toBe(before.head_starts[2] + (await width_of(page.locator("regular-table thead th.rv-hd.rt-group-corner").nth(2))));
		const all = await probe(page);
		expect(all.total_lefts).toEqual(all.head_lefts);
		await shot(page, `ar-pinned-columns-scrolled-light-${lang === "ar" ? "rtl" : "ltr"}`);
	}
	// on a phone only the label column is pinned: the others would leave no room
	await open(page, `report=ar&lang=ar&rv=${PINNED}`, { width: 390, height: 844 });
	expect(await page.locator("regular-table thead th.rv-hd.rt-group-corner").count()).toBe(1);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("general ledger: the report's opening row under the headers, its closing row above the grand total", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=gl&lang=ar", { width: 1440, height: 800 });
	const layout = () =>
		page.evaluate(() => {
			const rt = document.querySelector("regular-table");
			const r = (el) => el.getBoundingClientRect();
			const top = document.querySelector(".rv-rt-top");
			const first = [...rt.querySelectorAll("tbody tr:not(.spacer):not(.stale)")][0];
			const text = (sel) => [...document.querySelectorAll(sel)].map((el) => el.textContent.trim());
			return {
				top_rows: text(".rv-rt-top .rv-row .rv-pin-label"),
				bottom_rows: text(".rv-rt-bottom .rv-row .rv-pin-label"),
				gap_head: Math.round(r(top).top - r(rt.querySelector("thead")).bottom),
				gap_first: Math.round(r(first).top - r(top).bottom),
				first_y: rt.getMeta(first.firstElementChild).y,
				top_width: Math.round(r(top).width),
				table_width: rt.clientWidth,
				total: text(".rv-rt-total .rv-c.num"),
				closing: text(".rv-rt-closing .rv-c.num"),
				counts: window.rv_page.opened.counts,
				expected: window.rv_page.export_model().expected,
			};
		});
	const at_top = await layout();
	expect(at_top.top_rows).toEqual(["Opening"]);
	expect(at_top.bottom_rows[0]).toBe("Closing (Opening + Total)");
	expect(at_top.bottom_rows[1]).toContain("الإجمالي العام");
	expect(at_top.gap_head).toBe(0);
	// the first fact stands right under the pinned row, not behind it
	expect(at_top.gap_first).toBe(0);
	expect(at_top.first_y).toBe(1);
	expect(at_top.top_width).toBe(at_top.table_width);
	// the grand total is the report's own 'Total' row: balance 0, not the sum of running balances
	expect(at_top.total.slice(0, 3)).toEqual(["2,521,940.00", "2,521,940.00", "—"]);
	expect(at_top.closing.slice(0, 3)).toEqual(["2,521,940.00", "2,521,940.00", "—"]);
	expect(at_top.counts).toEqual({ shown: 47, total: 47, facts: 47, groups: null });
	// the export is compared with the engine's sums of the 47 facts
	expect(at_top.expected.row_count).toBe(47);
	expect(at_top.expected.totals.debit).toBe(2521940);

	// scrolled to the end: the opening row stays, the last fact ends above the closing row
	await page.locator("regular-table").hover();
	await page.mouse.wheel(0, 100000);
	await page.waitForTimeout(300);
	await settle(page);
	const at_end = await page.evaluate(() => {
		const rt = document.querySelector("regular-table");
		const live = [...rt.querySelectorAll("tbody tr:not(.stale)")];
		return {
			top_rows: document.querySelectorAll(".rv-rt-top .rv-row").length,
			last_y: rt.getMeta(live.at(-1).firstElementChild).y,
			rows: window.rv_page.grid.body_rows,
			last_bottom: Math.round(live.at(-1).getBoundingClientRect().bottom - rt.getBoundingClientRect().top - rt.clientHeight),
		};
	});
	expect(at_end.top_rows).toBe(1);
	expect(at_end.rows).toBe(48);
	expect(at_end.last_y).toBe(47);
	expect(Math.abs(at_end.last_bottom)).toBeLessThanOrEqual(1);
	await shot(page, "gl-pinned-rows-scrolled-end-light-rtl");

	// a browser filter: the report's rows no longer describe what is shown and leave the screen
	await open(page, `report=gl&lang=ar&rv=${rv({ filters: [{ key: "debit", type: "range", min: 100, max: null }] })}`, { width: 1440, height: 800 });
	const filtered = await layout();
	expect(filtered.top_rows).toEqual([]);
	expect(filtered.bottom_rows.length).toBe(1);
	expect(filtered.first_y).toBe(0);
	expect(filtered.counts.shown).toBeLessThan(47);
	expect(filtered.counts.total).toBe(47);
	await shot(page, "gl-filtered-no-pinned-rows-light-rtl");
	// grouping reads the facts only
	await open(page, "report=gl&lang=ar&group=account", { width: 1440, height: 800 });
	expect(await page.locator(".rv-rt-top .rv-row").count()).toBe(0);
	expect(await page.locator(".rv-rt-bottom .rv-row").count()).toBe(1);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("the report's own subtotals between the facts are announced once, not dropped in silence", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=gl_account&lang=ar");
	const bar = page.locator(".rv-notice");
	await expect(bar).toBeVisible();
	await expect(bar).toHaveClass(/info/);
	await expect(bar).toContainText("24");
	await expect(bar).toContainText("Excel");
	expect(await page.locator(".rv-rt-top .rv-row").count()).toBe(1);
	expect(await page.locator(".rv-rt-closing").count()).toBe(1);
	// closed by the user: it stays closed while the notice is the same
	await bar.locator(".rv-chip-x").click();
	await expect(bar).toBeHidden();
	await page.evaluate(() => window.rv_page.render());
	await shown(page);
	await expect(bar).toBeHidden();
	expect(problems, "console errors/warnings").toEqual([]);
});

test("filters the engine cannot express are told to the user, once", async ({ page }) => {
	const problems = watch_console(page);
	const filters = [
		{ key: "voucher_type", type: "text", op: "not_contains", value: "Journal" },
		{ key: "*", type: "text", op: "contains", value: "SND", source: "search" },
		{ key: "paid", type: "range", min: 1, max: null },
	];
	await open(page, `report=ar&lang=ar&rv=${rv({ filters })}`);
	const bar = page.locator(".rv-notice");
	await expect(bar).toBeVisible();
	await expect(bar).toHaveClass(/warn/);
	expect(await bar.locator("p").count()).toBe(3);
	await expect(bar).toContainText("نوع السند");
	await expect(bar).toContainText("البحث الحر");
	// the filter that can be expressed is applied
	const counts = await page.evaluate(() => window.rv_page.opened.counts);
	expect(counts.shown).toBeLessThan(counts.total);
	await shot(page, "ar-unsupported-filters-notice-light-rtl");
	// the same notices on the next render: one bar, not a second one
	await page.evaluate(() => window.rv_page.render());
	await shown(page);
	expect(await page.locator(".rv-notice").count()).toBe(1);
	expect(await bar.locator("p").count()).toBe(3);
	// no such filter: no bar
	await open(page, "report=ar&lang=ar");
	await expect(page.locator(".rv-notice")).toBeHidden();
	expect(problems, "console errors/warnings").toEqual([]);
});

test("fold of the report tree: kept in the URL, restored from it; expand all and collapse all", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=ar", { width: 1440, height: 2600 });
	const labels = async () => (await body(page)).map((r) => `${r.cls}|${r.label}`);
	// close the second root, then a parent inside the first one
	await page.locator("regular-table tbody tr.group.d0").nth(1).locator(".rv-caret").click();
	await page.waitForFunction(() => Array.isArray(window.rv_page.state.tree.expanded));
	await shown(page);
	await settle(page);
	const before = await page.evaluate(() => window.rv_page.opened.body_rows);
	await page.locator("regular-table tbody tr.group.d1").first().locator(".rv-caret").click();
	await page.waitForFunction((n) => window.rv_page.opened.body_rows < n, before);
	await shown(page);
	await settle(page);
	const folded = await labels();
	const saved = await url_state(page);
	const expanded = JSON.parse(Buffer.from(saved, "base64url").toString()).tree.expanded;
	expect(expanded.length).toBeGreaterThan(0);
	await open(page, `report=tb&lang=ar&rv=${saved}`, { width: 1440, height: 2600 });
	expect(await labels()).toEqual(folded);
	await shot(page, "tb-tree-fold-from-url-light-rtl");

	await page.locator('.rv-gp-tools [data-action="collapse-all"]').click();
	await page.waitForFunction(() => window.rv_page.opened.body_rows === 4);
	await shown(page);
	await settle(page);
	const roots = await body(page);
	expect(roots.length).toBe(4);
	expect(roots.every((r) => r.open === "false" && r.nums.some((n) => /\d/.test(n)))).toBe(true);
	await shot(page, "tb-tree-collapse-all-light-rtl");
	const collapsed = await url_state(page);
	expect(JSON.parse(Buffer.from(collapsed, "base64url").toString()).tree).toEqual({ depth: 0, expanded: null });

	await page.locator('.rv-gp-tools [data-action="expand-all"]').click();
	await page.waitForFunction(() => window.rv_page.opened.body_rows === 31);
	await shown(page);
	await settle(page);
	const all = await body(page);
	expect(all.filter((r) => r.open === "false").length).toBe(0);
	expect(all.filter((r) => r.cls === "foot").length).toBe(15);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("fold of a grouping: kept in the URL as paths, restored from it; expand all and collapse all", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=ar&lang=en&group=party", { width: 1440, height: 900 });
	expect(await page.evaluate(() => window.rv_page.state.group.expanded)).toBe("all");
	const tools = page.locator(".rv-gp-tools");
	await tools.locator('[data-action="collapse-all"]').click();
	await page.waitForFunction(() => window.rv_page.opened.post.depth === 0);
	await shown(page);
	await settle(page);
	const closed = await body(page);
	expect(closed.length).toBe(6);
	expect(closed.every((r) => r.open === "false")).toBe(true);
	// open two groups by hand
	await page.locator("regular-table tbody tr.group").nth(1).locator(".rv-caret").click();
	await page.waitForFunction(() => Array.isArray(window.rv_page.state.group.expanded));
	await settle(page);
	await page.locator("regular-table tbody tr.group").first().locator(".rv-caret").click();
	await page.waitForFunction(() => window.rv_page.state.group.expanded.length === 2);
	await settle(page);
	const views_before = await page.evaluate(() => window.rv_page.render_token);
	const folded = (await body(page)).map((r) => `${r.cls}|${r.label}|${r.open}`);
	const saved = await url_state(page);
	const state = JSON.parse(Buffer.from(saved, "base64url").toString());
	expect(state.group.expanded.length).toBe(2);
	expect(state.group.expanded.every((p) => Array.isArray(p) && p.length === 1)).toBe(true);
	// a fold of a group is done in the view: no new view was opened for it
	expect(await page.evaluate(() => window.rv_page.render_token)).toBe(views_before);
	await shot(page, "ar-group-fold-light-ltr");

	await open(page, `report=ar&lang=en&rv=${saved}`, { width: 1440, height: 900 });
	expect((await body(page)).map((r) => `${r.cls}|${r.label}|${r.open}`)).toEqual(folded);
	await shot(page, "ar-group-fold-from-url-light-ltr");

	await page.locator('.rv-gp-tools [data-action="expand-all"]').click();
	await page.waitForFunction(() => window.rv_page.state.group.expanded === "all" && window.rv_page.grid.body_rows === 66 + 6 + 6);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("keyboard: Enter and Space on the caret fold and open, the focus stays on it", async ({ page }) => {
	const problems = watch_console(page);
	for (const query of ["report=tb&lang=ar", "report=ar&lang=ar&group=party"]) {
		await open(page, query);
		const rows = () => page.evaluate(() => window.rv_page.grid.body_rows);
		const focused = () =>
			page.evaluate(() => {
				const el = document.activeElement;
				return el?.classList.contains("rv-caret") ? el.getAttribute("aria-expanded") : null;
			});
		const all = await rows();
		await page.locator("regular-table tbody tr.group").first().locator(".rv-caret").focus();
		expect(await focused()).toBe("true");
		await page.keyboard.press("Enter");
		await page.waitForFunction((n) => window.rv_page.grid.body_rows < n, all);
		await shown(page);
		await settle(page);
		expect(await focused()).toBe("false");
		await page.keyboard.press("Space");
		await page.waitForFunction((n) => window.rv_page.grid.body_rows === n, all);
		await shown(page);
		await settle(page);
		expect(await focused()).toBe("true");
	}
	// the toolbar tools are reachable and named
	await expect(page.locator('.rv-gp-tools [data-action="expand-all"]')).toHaveAttribute("aria-label", "توسيع الكل");
	await expect(page.locator('.rv-gp-tools [data-action="collapse-all"]')).toHaveAttribute("aria-label", "طي الكل");
	expect(problems, "console errors/warnings").toEqual([]);
});

test("loading state: the first run of a page says that the engine is being prepared", async ({ page }) => {
	const problems = watch_console(page);
	await page.addInitScript(() => {
		window.rv_seen = [];
		new MutationObserver(() => {
			const p = document.querySelector('.rv-state[data-state="loading"] p');
			if (p && !window.rv_seen.includes(p.textContent)) window.rv_seen.push(p.textContent);
		}).observe(document, { childList: true, subtree: true });
	});
	await open(page, "report=tb&lang=ar");
	expect(await page.evaluate(() => window.rv_seen)).toEqual(["جارٍ تجهيز المحرك…"]);
	// the engine is ready: a second run loads the report only
	await page.evaluate(() => {
		window.rv_seen = [];
		return window.rv_page.run();
	});
	await shown(page);
	expect(await page.evaluate(() => window.rv_seen)).toEqual([]);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("lifecycle: no handle is left after 20 changes of fold, subtotals, widths and grouping", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=ar&lang=ar&group=party");
	const kinds = () => page.evaluate(() => window.rv_page.debug_handles().map((h) => h.kind).sort());
	expect(await kinds()).toEqual(["table", "view"]);
	const tools = page.locator(".rv-gp-tools");
	for (let i = 0; i < 20; i++) {
		const step = i % 5;
		if (step === 0) await tools.locator('[data-action="collapse-all"]').click();
		else if (step === 1) await page.locator("regular-table tbody tr.group").first().locator(".rv-caret").click();
		else if (step === 2) await tools.locator('input[data-action="subtotals"]').click();
		else if (step === 3) await drag_handle(page, page.locator("regular-table thead th.rv-hd").nth(2), i % 2 ? 30 : -30);
		else await tools.locator('[data-action="expand-all"]').click();
		await page.waitForTimeout(120);
		await shown(page);
		await settle(page);
		expect(await kinds(), `change ${i}`).toEqual(["table", "view"]);
	}
	// a tree report, through its three shapes
	await open(page, "report=tb&lang=ar");
	for (let i = 0; i < 20; i++) {
		await page.evaluate(async (k) => {
			const s = window.rv_page.state;
			if (k % 4 === 0) s.tree = { depth: 0, expanded: null };
			else if (k % 4 === 1) s.tree = { depth: null, expanded: [0, 1] };
			else if (k % 4 === 2) s.filters = s.filters.length ? [] : [{ key: "debit", type: "range", min: 1, max: null }];
			else s.group.subtotals = !s.group.subtotals;
			await window.rv_page.render();
		}, i);
		await shown(page);
		expect(await kinds(), `tree change ${i}`).toEqual(["table", "table", "view"]);
	}
	await page.evaluate(() => window.rv_page.hide());
	await page.waitForFunction(() => window.rv_page.debug_handles().length === 0);
	expect(problems, "console errors/warnings").toEqual([]);
});
