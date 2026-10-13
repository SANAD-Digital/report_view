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
// Receivables with the text columns between the party and the amounts hidden, so that the
// amounts of a party total are on screen without a horizontal scroll.
const AR_AMOUNTS = rv({ columns: { hidden: ["party_type", "party_account", "customer_primary_contact", "cost_center", "project", "due_date"] } });

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
	// rows as reported: the report's own opening / total / closing rows between its facts
	{ name: "gl-by-account-as-reported-light-rtl", query: "report=gl_account&lang=ar", height: 1500 },
	{ name: "gl-by-account-as-reported-dark-ltr", query: "report=gl_account&lang=en&desk=dark", height: 1500 },
	{ name: "ar-by-party-as-reported-light-rtl", query: `report=ar_party&lang=ar&rv=${AR_AMOUNTS}` },
	{ name: "ar-by-party-as-reported-dark-ltr", query: `report=ar_party&lang=en&desk=dark&rv=${AR_AMOUNTS}` },
	{ name: "ar-by-party-as-reported-all-columns-light-rtl", query: "report=ar_party&lang=ar" },
	{ name: "gl-by-account-as-reported-390-rtl", query: "report=gl_account&lang=ar", width: 390, height: 844, full: true },
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
		const heads = [...rt.querySelectorAll("thead th.rv-hd:not(.rt-group-corner)")];
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
	await open(page, "report=tb&lang=ar&group=account__root_type", { width: 1440, height: 1700 });
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
	await open(page, "report=tb&lang=en", { width: 1440, height: 2900 });
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
	const root_foot = on.findLast((r) => r.cls === "foot" && r.label.includes(open_parents[0].label.replace(/^\S+\s*(-\s*)?/, "").replace(/\s*\d+$/, "").trim()));
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
	// the export is compared with the 47 facts and the grand total as shown
	expect(at_top.expected.row_count).toBe(47);
	expect(at_top.expected.totals.debit).toBe(2521940);
	expect(at_top.expected.totals.balance).toBe(0);

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

test("rows as reported: the opening, total and closing of every account stand between its entries", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=gl_account&lang=ar", { width: 1440, height: 1500 });
	// they are on screen: nothing to announce
	await expect(page.locator(".rv-notice")).toBeHidden();
	const info = await page.evaluate(() => ({
		shape: window.rv_page.opened.post.shape,
		counts: window.rv_page.opened.counts,
		expected: window.rv_page.export_model().expected,
		rows: window.rv_page.grid.body_rows,
		top: [...document.querySelectorAll(".rv-rt-top .rv-row .rv-pin-label")].map((el) => el.textContent.trim()),
		bottom: [...document.querySelectorAll(".rv-rt-bottom .rv-row .rv-pin-label")].map((el) => el.textContent.trim()),
		total: [...document.querySelectorAll(".rv-rt-total .rv-c.num")].map((el) => el.textContent.trim()),
		tools: Boolean(document.querySelector(".rv-gp-tools [data-action=\"expand-all\"]:not([hidden])")),
	}));
	expect(info.shape).toBe("report");
	// the report's own opening (pinned), then 48 entries and the 24 rows of the 8 accounts
	expect(info.rows).toBe(1 + 48 + 24);
	expect(info.top).toEqual(["Opening"]);
	expect(info.bottom[0]).toBe("Closing (Opening + Total)");
	expect(info.bottom[1]).toContain("الإجمالي العام");
	expect(info.total.slice(0, 2)).toEqual(["2,521,940.00", "2,521,940.00"]);
	// rows = the entries, in the status bar, in the badge of the grand total and in the export
	expect(info.counts).toEqual({ shown: 48, total: 48, facts: 48, groups: null });
	expect(info.bottom[1]).toContain("48");
	expect(info.expected.row_count).toBe(48);
	expect(info.expected.totals.debit).toBe(2521940);
	// nothing to fold in a list of report rows
	expect(info.tools).toBe(false);

	const rows = (await body(page)).filter((r) => r.cls !== "spacer");
	// the first account: its opening balance, its 21 entries, its total, its closing
	expect(rows[0].cls).toBe("opening");
	expect(rows[0].label).toBe("Opening");
	expect(rows[0].nums.slice(0, 3)).toEqual(["469.00", "—", "469.00"]);
	expect(rows.slice(1, 22).every((r) => r.cls === "")).toBe(true);
	expect(rows[22].cls).toBe("foot");
	expect(rows[22].label).toBe("Total");
	expect(rows[22].nums.slice(0, 3)).toEqual(["53,831.00", "100.00", "53,731.00"]);
	expect(rows[23].cls).toBe("foot closing");
	expect(rows[23].label).toBe("Closing (Opening + Total)");
	expect(rows[23].nums.slice(0, 3)).toEqual(["54,300.00", "100.00", "54,200.00"]);
	// then the opening of the next account
	expect(rows[24].cls).toBe("opening");
	expect(rows[24].nums.slice(0, 3)).toEqual(["—", "469.00", "-469.00"]);
	// a summary row carries captions, never a link
	expect(await page.locator("regular-table tbody tr.opening a, regular-table tbody tr.foot a").count()).toBe(0);

	// the end of the report: the last account closes right above the pinned rows
	await page.locator("regular-table").hover();
	await page.mouse.wheel(0, 100000);
	await page.waitForTimeout(300);
	await settle(page);
	const last = (await body(page)).filter((r) => r.cls !== "spacer").slice(-2);
	expect(last.map((r) => r.cls)).toEqual(["foot", "foot closing"]);
	await shot(page, "gl-by-account-as-reported-scrolled-end-light-rtl");
	expect(problems, "console errors/warnings").toEqual([]);
});

test("rows as reported: the total of every party stands after its invoices", async ({ page }) => {
	const problems = watch_console(page);
	// hidden columns are no filter: the rows stay as reported
	await open(page, `report=ar_party&lang=ar&rv=${AR_AMOUNTS}`);
	await expect(page.locator(".rv-notice")).toBeHidden();
	const info = await page.evaluate(() => ({
		shape: window.rv_page.opened.post.shape,
		rows: window.rv_page.grid.body_rows,
		counts: window.rv_page.opened.counts,
		pinned: document.querySelectorAll(".rv-rt-top .rv-row, .rv-rt-closing").length,
	}));
	expect(info.shape).toBe("report");
	expect(info.rows).toBe(66 + 6);
	expect(info.counts).toEqual({ shown: 66, total: 66, facts: 66, groups: null });
	expect(info.pinned).toBe(0);
	const rows = await body(page);
	// Clint: four invoices, then the party's own total as the report returned it
	expect(rows.slice(0, 4).every((r) => r.cls === "")).toBe(true);
	expect(rows[4].cls).toBe("foot");
	expect(rows[4].label).toBe("Clint");
	// invoiced, paid, credit note, outstanding: the values of the report's own row
	expect(rows[4].nums.slice(0, 4)).toEqual(["—", "11,275.00", "—", "-11,275.00"]);
	expect(rows[7].cls).toBe("foot");
	expect(rows[7].label).toBe("f");
	expect(rows[7].nums.slice(0, 4)).toEqual(["—", "200.00", "—", "-200.00"]);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("rows as reported: a filter, a grouping or a sort reads the facts, and says that the report's rows are hidden", async ({ page }) => {
	const problems = watch_console(page);
	const kinds = () => page.evaluate(() => window.rv_page.debug_handles().map((h) => h.kind).sort());
	const look = () =>
		page.evaluate(() => ({
			shape: window.rv_page.opened.post.shape,
			table: window.rv_page.opened.spec.table,
			rows: window.rv_page.grid.body_rows,
			top: document.querySelectorAll(".rv-rt-top .rv-row").length,
			closing: document.querySelectorAll(".rv-rt-closing").length,
			summary: document.querySelectorAll("regular-table tbody tr.opening, regular-table tbody tr.foot").length,
			expected: window.rv_page.export_model().expected,
		}));
	const set = async (patch) => {
		await page.evaluate(async (p) => {
			Object.assign(window.rv_page.state, { filters: [], sort: [], ...p.state });
			window.rv_page.state.group.by = p.by || [];
			await window.rv_page.render();
		}, patch);
		await shown(page);
		await settle(page);
	};
	await open(page, "report=gl_account&lang=ar");
	// the facts table and the rows table of the report, one view
	expect(await kinds()).toEqual(["table", "table", "view"]);
	const bar = page.locator(".rv-notice");
	await expect(bar).toBeHidden();

	// a sort: the entries sorted; the report's opening, closing and total stay pinned
	await set({ state: { sort: [{ key: "debit", dir: "desc" }] } });
	const sorted = await look();
	expect(sorted).toMatchObject({ shape: "flat", table: "facts", rows: 1 + 48, top: 1, closing: 1, summary: 0 });
	expect(sorted.expected).toMatchObject({ row_count: 48, totals: { debit: 2521940 } });
	await expect(bar).toBeVisible();
	await expect(bar).toHaveClass(/info/);
	await expect(bar).toContainText("24");
	await expect(bar).toContainText("مخفية");
	await shot(page, "gl-by-account-sorted-facts-light-rtl");

	// a filter: the matching entries and the engine's total; nothing of the report is pinned
	await set({ state: { filters: [{ key: "debit", type: "range", min: 100, max: null }] } });
	const narrowed = await look();
	expect(narrowed).toMatchObject({ shape: "flat", table: "facts", top: 0, closing: 0, summary: 0 });
	expect(narrowed.rows).toBeLessThan(48);
	expect(narrowed.expected.row_count).toBe(narrowed.rows);
	// the same notice: one bar; closed by the user, it stays closed while the notice is the same
	expect(await page.locator(".rv-notice").count()).toBe(1);
	expect(await bar.locator("p").count()).toBe(1);
	await bar.locator(".rv-chip-x").click();
	await expect(bar).toBeHidden();

	// a grouping: groups of the entries, computed by the engine
	await set({ by: ["account"] });
	const grouped = await look();
	expect(grouped).toMatchObject({ shape: "group", table: "facts", top: 0, closing: 0 });
	await expect(bar).toBeHidden();

	// back to the default view: the rows as reported again, and no bar
	await set({});
	const back = await look();
	expect(back).toMatchObject({ shape: "report", table: "rows", rows: 1 + 48 + 24, top: 1, closing: 1 });
	expect(back.summary).toBeGreaterThan(0);
	await expect(bar).toBeHidden();

	// no handle is left behind by 20 changes between the four views
	const steps = [{ state: { sort: [{ key: "credit", dir: "asc" }] } }, { state: { filters: [{ key: "credit", type: "range", min: 1, max: null }] } }, { by: ["voucher_type"] }, {}];
	for (let i = 0; i < 20; i++) {
		await set(steps[i % steps.length]);
		expect(await kinds(), `change ${i}`).toEqual(["table", "table", "view"]);
	}
	await page.evaluate(() => window.rv_page.hide());
	await page.waitForFunction(() => window.rv_page.debug_handles().length === 0);
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

// ---------------------------------------------------------------------------------------
// Design parity, wave 1 (docs/progress/phase-5a2-wave1.md): every item of the main screen
// next to its reference capture in reference/design/screens/, light and dark, RTL and LTR,
// at the design's 1440x1100. Saved to docs/progress/screens/phase-5a2/.
const OUT2 = path.resolve(__dirname, "../../docs/progress/screens/phase-5a2");
fs.mkdirSync(OUT2, { recursive: true });
const shot2 = (page, name, full = false) => page.screenshot({ path: path.join(OUT2, `${name}.png`), fullPage: full });
const VARIANTS = [
	{ id: "light-rtl", query: "lang=ar" },
	{ id: "dark-rtl", query: "lang=ar&desk=dark" },
	{ id: "light-ltr", query: "lang=en" },
	{ id: "dark-ltr", query: "lang=en&desk=dark" },
];
const DESIGN = { width: 1440, height: 1100 };
const handles_of = (page) => page.evaluate(() => window.rv_page.debug_handles().map((h) => h.kind).sort().join(","));
// Trial balance "as is": the nodes and the facts tables, and the main view.
const TB_HANDLES = "table,table,view";

// What each shot opens on the page (reference capture in brackets).
const STATES = {
	main: null, // [main.png]
	date: async (page) => page.locator(".rv-datefield").click(), // [date.png]
	search: async (page) => page.locator(".rv-search input").click(), // [search.png]
	colmenu: async (page) => {
		const th = page.locator("regular-table thead th.rv-hd", { has: page.locator('.rv-hcell[data-col="opening_debit"]') });
		await th.hover();
		await th.locator(".rv-hmenu").click();
	}, // [colmenu.png]
	setfilter: async (page) => page.locator('.rv-fcell-in[data-col="account__account_type"] .rv-ff-set').click(), // [setfilter.png]
	sidecols: async (page) => page.locator('[data-side="columns"]').click(), // [sidecols.png]
	sidefilters: async (page) => page.locator('[data-side="filters"]').click(), // [sidefilters.png]
	more: async (page) => page.locator(".rv-more").click(), // (no reference: More options)
};

for (const v of VARIANTS) {
	for (const [state, act] of Object.entries(STATES)) {
		test(`wave 1 ${state} ${v.id}`, async ({ page }) => {
			const problems = watch_console(page);
			await open(page, `report=tb&${v.query}`, DESIGN);
			if (act) {
				await act(page);
				await page.waitForTimeout(400);
			}
			await shot2(page, `tb-${state}-${v.id}`);
			expect(problems, "console errors/warnings").toEqual([]);
		});
	}
}

for (const [name, query, w, h, act] of [
	["tb-main-390-rtl", "report=tb&lang=ar", 390, 844, null],
	["tb-main-390-dark-ltr", "report=tb&lang=en&desk=dark", 390, 844, null],
	["tb-date-390-rtl", "report=tb&lang=ar", 390, 844, (p) => p.locator(".rv-datefield").click()],
	["tb-search-390-rtl", "report=tb&lang=ar", 390, 844, (p) => p.locator(".rv-search input").click()],
	["tb-sidecols-390-rtl", "report=tb&lang=ar", 390, 844, async (p) => {
		await p.locator('[data-side="columns"]').scrollIntoViewIfNeeded();
		await p.locator('[data-side="columns"]').click();
	}],
	["tb-main-compact-rtl", "report=tb&lang=ar&density=compact", 1440, 1100, null],
	["tb-main-compact-dark-ltr", "report=tb&lang=en&density=compact&desk=dark", 1440, 1100, null],
	["ar-main-light-rtl", "report=ar&lang=ar", 1440, 1100, null],
	["gl-main-light-ltr", "report=gl&lang=en", 1440, 1100, null],
]) {
	test(`wave 1 ${name}`, async ({ page }) => {
		const problems = watch_console(page);
		await open(page, query, { width: w, height: h });
		if (act) {
			await act(page);
			await page.waitForTimeout(400);
		}
		await shot2(page, name, w < 600 && !act);
		expect(problems, "console errors/warnings").toEqual([]);
	});
}

test("wave 1 period picker: presets, typed dates and the fiscal mode write the report's own filters", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=ar", DESIGN);
	const runs = await page.evaluate(() => window.rv_page.run_token);
	const values = () => page.evaluate(() => window.rv_page.filters.get_values());
	await page.locator(".rv-datefield").click();
	await expect(page.locator(".rv-pop.dp")).toBeVisible();
	// two months, Sunday first (the system's first day of the week), the range painted
	await expect(page.locator(".dp-cal")).toHaveCount(2);
	await expect(page.locator(".dp-days")).toHaveText("365 يوماً");
	// a preset, then Apply: the filters change and the report runs again
	await page.locator(".dp-pre", { hasText: "الربع الماضي" }).click();
	await page.locator('.dp-ft [data-action="apply"]').click();
	// the period is written as one change (fiscal year first, then the dates): wait for it
	await page.waitForFunction(() => !window.rv_page._runs_held);
	await expect(page.locator(".rv-pop.dp")).toHaveCount(0);
	let v = await values();
	expect([v.from_date, v.to_date, v.fiscal_year]).toEqual(["2026-07-01", "2026-09-30", "2026"]);
	await expect.poll(() => page.evaluate(() => window.rv_page.run_token)).toBeGreaterThan(runs);
	await expect(page.locator(".rv-date-tag")).toHaveText("الربع الماضي");
	// typed dates and a picked end day
	await page.locator(".rv-datefield").click();
	await page.locator('[data-input="from"]').fill("15-08-2026");
	await page.locator('[data-input="from"]').press("Enter");
	// the typed date re-draws the calendars on August
	await expect(page.locator(".dp-cal-hd b").first()).toContainText("أغسطس");
	await page.locator('.dp-d[data-day="2026-08-15"]').click();
	await expect(page.locator(".dp-hint")).toBeVisible();
	await page.locator('.dp-d[data-day="2026-09-10"]').click();
	await expect(page.locator(".dp-days")).toHaveText("27 يوماً");
	await shot2(page, "tb-date-picked-light-rtl");
	await page.locator('.dp-ft [data-action="apply"]').click();
	// the period is written as one change (fiscal year first, then the dates): wait for it
	await page.waitForFunction(() => !window.rv_page._runs_held);
	v = await values();
	expect([v.from_date, v.to_date]).toEqual(["2026-08-15", "2026-09-10"]);
	await expect(page.locator(".rv-date-tag")).toHaveText("فترة مخصصة");
	// fiscal mode: the second quarter of the fiscal year 2025
	await page.locator(".rv-datefield").click();
	await page.locator('[data-mode="fiscal"]').click();
	await page.locator('[data-fy="-1"]').click();
	await page.locator('[data-part="q2"]').click();
	await shot2(page, "tb-date-fiscal-light-rtl");
	await page.locator('.dp-ft [data-action="apply"]').click();
	// the period is written as one change (fiscal year first, then the dates): wait for it
	await page.waitForFunction(() => !window.rv_page._runs_held);
	v = await values();
	expect([v.from_date, v.to_date, v.fiscal_year]).toEqual(["2025-04-01", "2025-06-30", "2025"]);
	await expect(page.locator(".rv-date-tag")).toHaveText("الربع الثاني 2025");
	// Cancel and Escape change nothing and run nothing
	await page.waitForTimeout(500);
	const before = await page.evaluate(() => window.rv_page.run_token);
	await page.locator(".rv-datefield").click();
	await page.locator('.dp-pre[data-from="2026-10-01"][data-to="2026-10-01"]').click();
	await page.keyboard.press("Escape");
	await expect(page.locator(".rv-pop.dp")).toHaveCount(0);
	expect((await values()).from_date).toBe("2025-04-01");
	await page.waitForTimeout(500);
	expect(await page.evaluate(() => window.rv_page.run_token)).toBe(before);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("wave 1 period picker in LTR: arrows and alignment mirrored, same filters", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=en&desk=dark", DESIGN);
	await page.locator(".rv-datefield").click();
	await page.locator('[data-mode="fiscal"]').click();
	await shot2(page, "tb-date-fiscal-dark-ltr");
	await page.locator('[data-month="2"]').click();
	await page.locator('[data-month="4"]').click();
	await page.locator('.dp-ft [data-action="apply"]').click();
	const v = await page.evaluate(() => window.rv_page.filters.get_values());
	expect([v.from_date, v.to_date]).toEqual(["2026-03-01", "2026-05-31"]);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("wave 1 floating filters: contains, range and set write the view state, the URL and the engine filter", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=ar", DESIGN);
	const input = page.locator('.rv-fcell-in[data-col="account"] input');
	await input.click();
	await input.pressSequentially("13", { delay: 30 });
	await page.waitForFunction(() => window.rv_page.state.filters.length === 1 && window.rv_page.opened?.post.shape === "levels");
	await settle(page);
	// the input keeps the focus while the grid shows the result
	expect(await page.evaluate(() => document.activeElement?.closest(".rv-fcell-in")?.dataset.col)).toBe("account");
	expect(await page.evaluate(() => window.rv_page.state.filters)).toEqual([{ key: "account", type: "text", op: "contains", value: "13" }]);
	expect(await page.evaluate(() => window.rv_page.opened.spec.config.filter)).toContainEqual(["account", "contains", "13"]);
	await expect(page.locator(".rv-status")).toContainText("2 من 16");
	await expect(page.locator(".rv-status-flag")).toBeVisible();
	await expect(page.locator(".rv-facet")).toHaveCount(1);
	// the summary says the difference comes from the filter, not from the entries
	await expect(page.locator(".rv-sum").nth(2)).toContainText("فرق بسبب الفلترة");
	// a numeric range on the closing debit
	const lo = page.locator('.rv-fcell-in[data-col="closing_debit"] input[data-edge="min"]');
	await lo.fill("1,000");
	await lo.press("Enter");
	await page.waitForFunction(() => window.rv_page.state.filters.length === 2);
	await settle(page);
	expect(await page.evaluate(() => window.rv_page.opened.spec.config.filter)).toContainEqual(["closing_debit", ">=", 1000]);
	await page.waitForTimeout(400);
	expect(await page.evaluate(() => new URLSearchParams(location.search).get("rv"))).toBeTruthy();
	await shot2(page, "tb-floating-filters-light-rtl");
	// a facet's × removes its filter, the input follows
	await page.locator(".rv-facet-x").first().click();
	await page.waitForFunction(() => window.rv_page.state.filters.length === 1);
	await expect(input).toHaveValue("");
	expect(problems, "console errors/warnings").toEqual([]);
});

test("wave 1 set filter: values and counts from a temporary view, deleted; unticking a value filters the facts", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=tb&lang=en&rv=${rv({ columns: { hidden: [] } })}`, DESIGN);
	expect(await handles_of(page)).toBe(TB_HANDLES);
	await page.locator('.rv-fcell-in[data-col="account__root_type"] .rv-ff-set').click();
	// four root types and the accounts without one ("Not Set")
	await expect(page.locator(".rv-set-pop .rv-setitem:not(.all)")).toHaveCount(5);
	await expect(page.locator(".rv-set-pop .rv-setitem.all .cnt")).toHaveText("5 / 5");
	const counts = await page.locator(".rv-set-pop .rv-setitem:not(.all) .cnt").allTextContents();
	expect(counts.map(Number).reduce((a, b) => a + b, 0)).toBe(16);
	// the temporary view of the values is gone
	expect(await handles_of(page)).toBe(TB_HANDLES);
	await shot2(page, "tb-setfilter-values-light-ltr");
	// "Not Set" off: the four root types remain, an "in" filter of the engine
	await page.locator(".rv-set-pop .rv-setitem:not(.all)", { hasText: "Not Set" }).locator("input").uncheck();
	await page.waitForFunction(() => window.rv_page.state.filters[0]?.type === "set");
	await settle(page);
	const f = await page.evaluate(() => window.rv_page.state.filters[0]);
	expect(f.values.length).toBe(4);
	expect(await page.evaluate(() => window.rv_page.opened.spec.config.filter)).toContainEqual(["account__root_type", "in", f.values]);
	await expect(page.locator('.rv-fcell-in[data-col="account__root_type"] .rv-ff-set')).toHaveClass(/on/);
	// search asks the engine again; Clear removes the filter
	await page.locator(".rv-set-search").fill("Exp");
	await expect(page.locator(".rv-set-pop .rv-setitem:not(.all)")).toHaveCount(1);
	await page.locator('.rv-set-pop [data-action="clear"]').click();
	await page.waitForFunction(() => window.rv_page.state.filters.length === 0);
	await page.keyboard.press("Escape");
	await expect(page.locator(".rv-set-pop")).toHaveCount(0);
	await settle(page);
	expect(await handles_of(page)).toBe(TB_HANDLES);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("wave 1 column menu: sort, hide, group by, reset; keyboard and Escape", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=ar&lang=ar&rv=${AR_AMOUNTS}`, DESIGN);
	const menu = async (key) => {
		const th = page.locator("regular-table thead th.rv-hd", { has: page.locator(`.rv-hcell[data-col="${key}"]`) });
		await th.hover();
		await th.locator(".rv-hmenu").click();
		await expect(page.locator(".rv-pop[role=menu]")).toBeVisible();
	};
	await menu("outstanding");
	// a measure cannot be pinned (said in the item's title); pinning at the end is not offered by the grid
	await expect(page.locator(".rv-pop .rv-mi").nth(0)).toBeDisabled();
	await expect(page.locator(".rv-pop .rv-mi").nth(1)).toBeDisabled();
	await page.locator(".rv-pop .rv-mi", { hasText: "ترتيب تنازلي" }).click();
	await page.waitForFunction(() => window.rv_page.state.sort[0]?.dir === "desc");
	await settle(page);
	expect(await page.evaluate(() => window.rv_page.opened.spec.config.sort[0])).toEqual(["outstanding", "desc"]);
	await expect(page.locator('.rv-hcell[data-col="outstanding"] [data-sort]')).toBeVisible();
	// keyboard: arrows move, Enter applies, Escape closes
	await menu("party");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("Escape");
	await expect(page.locator(".rv-pop[role=menu]")).toHaveCount(0);
	await menu("party");
	await page.locator(".rv-pop .rv-mi", { hasText: "تجميع حسب" }).click();
	await page.waitForFunction(() => window.rv_page.result?.mode === "group");
	await settle(page);
	await expect(page.locator(".rv-gchip")).toHaveCount(1);
	await menu("voucher_type");
	await page.locator(".rv-pop .rv-mi", { hasText: "إخفاء العمود" }).click();
	await page.waitForFunction(() => window.rv_page.state.columns.hidden.includes("voucher_type"));
	await menu("voucher_no");
	await page.locator(".rv-pop .rv-mi", { hasText: "تثبيت يمين" }).click();
	await page.waitForFunction(() => window.rv_page.state.columns.pinned.start.includes("voucher_no"));
	await settle(page);
	await shot2(page, "ar-colmenu-applied-light-rtl");
	await menu("voucher_no");
	await page.locator(".rv-pop .rv-mi", { hasText: "إعادة ضبط الأعمدة" }).click();
	await page.waitForFunction(() => !window.rv_page.state.columns.hidden.length && !window.rv_page.state.sort.length);
	// a click on a title sorts: ascending, descending, none
	const title = page.locator('.rv-hcell[data-col="party"] .rv-hlabel');
	await title.click();
	await page.waitForFunction(() => window.rv_page.state.sort[0]?.dir === "asc");
	await title.click();
	await page.waitForFunction(() => window.rv_page.state.sort[0]?.dir === "desc");
	await title.click();
	await page.waitForFunction(() => !window.rv_page.state.sort.length);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("wave 1 group panel: a header dropped groups, chips reorder by drag and leave by ×", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=ar&lang=en&rv=${AR_AMOUNTS}`, DESIGN);
	const panel = page.locator(".rv-gp");
	await page.locator('.rv-hcell[data-col="party"]').dragTo(panel);
	await page.waitForFunction(() => window.rv_page.state.group.by.join() === "party");
	await page.locator('.rv-hcell[data-col="voucher_type"]').dragTo(panel);
	await page.waitForFunction(() => window.rv_page.state.group.by.join() === "party,voucher_type");
	await settle(page);
	await expect(page.locator(".rv-gsep")).toHaveCount(1);
	await shot2(page, "ar-group-panel-light-ltr");
	// the second chip dropped on the first: it becomes the first level
	await page.locator(".rv-gchip").nth(1).dragTo(page.locator(".rv-gchip").nth(0));
	await page.waitForFunction(() => window.rv_page.state.group.by.join() === "voucher_type,party");
	await settle(page);
	expect(await page.evaluate(() => window.rv_page.opened.spec.config.group_by.slice(0, 2))).toEqual(["voucher_type", "party"]);
	// a measure is no group level
	await page.locator('.rv-hcell[data-col="outstanding"]').dragTo(panel);
	expect(await page.evaluate(() => window.rv_page.state.group.by.length)).toBe(2);
	await page.locator(".rv-gchip .rv-chip-x").first().click();
	await page.waitForFunction(() => window.rv_page.state.group.by.join() === "party");
	await settle(page);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("wave 1 search: Enter is a contains filter on the label column, suggestions search other columns, Backspace removes", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=ar", DESIGN);
	const input = page.locator(".rv-search input");
	await input.click();
	// quick filters, root types and group-by in the dropdown
	await expect(page.locator(".rv-sdrop-col")).toHaveCount(2);
	await page.locator(".rv-sdrop .rv-mi", { hasText: "حسابات عليها حركة" }).click();
	await page.waitForFunction(() => window.rv_page.state.quick_filters.join() === "moving");
	await settle(page);
	expect(await page.evaluate(() => Object.keys(window.rv_page.opened.spec.config.expressions))).toContain("__qf__moving");
	await expect(page.locator(".rv-sum").first()).toContainText("متوازن ضمن");
	await page.locator(".rv-sdrop .rv-mi", { hasText: "نوع الجذر" }).click();
	await page.waitForFunction(() => window.rv_page.state.group.by.join() === "account__root_type");
	await shot2(page, "tb-search-active-light-rtl");
	await input.fill("نقد");
	await expect(page.locator(".rv-sugg")).toHaveCount(3);
	await input.press("Enter");
	await page.waitForFunction(() => window.rv_page.state.filters.some((f) => f.key === "account" && f.value === "نقد"));
	await expect(page.locator(".rv-facet")).toHaveCount(2);
	// the facets: the column filters, then the quick filters; Backspace removes the last one
	await input.press("Backspace");
	await page.waitForFunction(() => !window.rv_page.state.quick_filters.length);
	await input.press("Backspace");
	await page.waitForFunction(() => !window.rv_page.state.filters.length);
	await input.press("Escape");
	await expect(page.locator(".rv-search-pop")).toHaveCount(0);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("wave 1 side panels: columns show and hide, aggregates, the filter sections and their counts", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=ar&lang=ar", DESIGN);
	await page.locator('[data-side="columns"]').click();
	await expect(page.locator(".rv-panel .rv-colitem").first()).toBeVisible();
	await page.locator('.rv-panel [data-col="party_type"]').uncheck();
	await page.waitForFunction(() => window.rv_page.state.columns.hidden.includes("party_type"));
	await page.locator('.rv-panel [data-agg="outstanding"]').selectOption("avg");
	await page.waitForFunction(() => window.rv_page.state.values.some((v) => v.key === "outstanding" && v.agg === "avg"));
	await settle(page);
	expect(await page.evaluate(() => window.rv_page.opened.spec.config.aggregates?.outstanding ?? null)).toBeNull();
	await page.locator('.rv-panel [data-action="col-search"]').fill("Due");
	await expect(page.locator(".rv-panel .rv-colitem")).toHaveCount(1);
	// a column dragged to the row-group zone groups the rows
	await page.locator('.rv-panel [data-action="col-search"]').fill("");
	await page.locator('.rv-panel .rv-colitem[data-key="party"]').dragTo(page.locator('.rv-panel [data-zone="groups"]'));
	await page.waitForFunction(() => window.rv_page.state.group.by.join() === "party");
	await settle(page);
	expect(await page.evaluate(() => window.rv_page.opened.spec.config.aggregates.outstanding)).toBe("avg");
	await shot2(page, "ar-sidecols-applied-light-rtl");
	await page.locator('[data-side="filters"]').click();
	await expect(page.locator(".rv-panel .rv-fsec").first()).toBeVisible();
	const sec = page.locator(".rv-panel .rv-fsec", { hasText: "Voucher Type" });
	await sec.locator(".rv-fsec-hd").click();
	await expect(sec.locator(".rv-setitem:not(.all)").first()).toBeVisible();
	await sec.locator(".rv-setitem:not(.all) input").first().uncheck();
	await page.waitForFunction(() => window.rv_page.state.filters.some((f) => f.key === "voucher_type"));
	await expect(page.locator(".rv-tabcount")).toHaveText("1");
	await page.locator('.rv-panel .rv-link').click();
	await page.waitForFunction(() => !window.rv_page.state.filters.length);
	await page.locator('.rv-panel [data-action="close"]').click();
	await expect(page.locator(".rv-panel")).toBeHidden();
	expect(problems, "console errors/warnings").toEqual([]);
});

test("wave 1 lifecycle: no handle left after 20 filter, sort, group and quick-filter changes and the value lists", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=ar", DESIGN);
	for (let i = 0; i < 20; i++) {
		await page.evaluate(async (i) => {
			const c = window.rv_page.controls;
			const steps = [
				() => c.set_filter("account", i % 2 ? { key: "account", type: "text", op: "contains", value: "1" } : null),
				() => c.toggle_quick("moving"),
				() => c.set_group(i % 2 ? ["account__root_type"] : []),
				() => c.set_sort("debit", i % 2 ? "desc" : null),
			];
			steps[i % 4]();
			await c.load_values("account__root_type");
		}, i);
		await page.waitForTimeout(60);
	}
	await page.evaluate(() => window.rv_page.controls.clear_filters());
	await page.evaluate(() => window.rv_page.controls.set_group([]));
	await page.evaluate(() => window.rv_page.controls.set_sort("debit", null));
	await page.waitForFunction(() => window.rv_page.opened?.post.shape === "tree");
	await settle(page);
	expect(await handles_of(page)).toBe(TB_HANDLES);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("column groups: the user names a group of chosen columns; others stay plain; default comes back", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=ar");
	await page.locator('[data-action="column-groups"]').click();
	const dlg = page.locator(".rv-test-dialog");
	await expect(dlg).toBeVisible();
	// the report's own three groups are offered as the starting point
	await expect(dlg.locator(".rv-cg-group")).toHaveCount(3);
	await shot2(page, "tb-column-groups-dialog-rtl");
	// remove all three, then one new group with the closing debit and credit
	for (let i = 0; i < 3; i++) await dlg.locator("[data-remove]").first().click();
	await dlg.locator('[data-name="0"]').fill("الأرصدة النهائية");
	await dlg.locator('input[data-group="0"][data-key="closing_debit"]').check();
	await dlg.locator('input[data-group="0"][data-key="closing_credit"]').check();
	await dlg.locator(".btn-modal-primary").click();
	await expect(dlg).toHaveCount(0);
	const bands = page.locator("regular-table thead th.rv-hb:not(.empty)");
	await expect(bands).toHaveCount(1);
	await expect(bands.first()).toHaveText("الأرصدة النهائية");
	const groups = await page.evaluate(() => window.rv_page.state.columns.groups);
	expect(groups).toEqual([{ label: "الأرصدة النهائية", keys: ["closing_debit", "closing_credit"] }]);
	// kept for the user: in Frappe user settings
	const saved = await page.evaluate(() => frappe.model.user_settings.store["Report View:Trial Balance"].column_groups.groups);
	expect(saved).toEqual(groups);
	await shot2(page, "tb-column-groups-user-rtl");
	// back to the report's groups
	await page.locator('[data-action="column-groups"]').click();
	await dlg.locator(".btn-modal-secondary").click();
	await expect(page.locator("regular-table thead th.rv-hb:not(.empty)")).toHaveCount(3);
	expect(await page.evaluate(() => window.rv_page.state.columns.groups)).toBeNull();
	expect(problems, "console errors/warnings").toEqual([]);
});

test("a report formatter that wraps default_formatter with $(out) gets HTML, as on query-report", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=ar_jq&lang=en&rv=${AR_AMOUNTS}`);
	// the amounts are drawn (bold, from the report's formatter), not empty cells
	const amounts = await page.evaluate(() =>
		[...document.querySelectorAll("regular-table tbody td.num")].map((td) => td.textContent.trim()).filter((t) => /\d/.test(t)).length
	);
	expect(amounts).toBeGreaterThan(10);
	expect(await page.locator("regular-table tbody td.num [style*='bold']").count()).toBeGreaterThan(0);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("a MultiSelectList filter has one frame (no design input frame on its wrapper)", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=en");
	await page.locator(".rv-more").click();
	const framed = await page.evaluate(() =>
		[...document.querySelectorAll('.rv-more-filters .rv-field[data-fieldtype="MultiSelectList"] *')]
			.filter((e) => parseFloat(getComputedStyle(e).borderTopWidth) > 0 && !e.closest(".dropdown-menu"))
			.map((e) => e.className)
	);
	expect(framed).toEqual(["form-control cursor-pointer input-xs"]);
	expect(problems, "console errors/warnings").toEqual([]);
});

// ---------------------------------------------------------------- Charts dashboard (phase 5d)
// Screenshots in docs/progress/screens/phase-5a2/dashboard-*.png, compared with
// reference/design/screens/charts.png. The page opens on the table, then the Charts tab.
const CHARTS_OUT = path.resolve(__dirname, "../../docs/progress/screens/phase-5a2");
const dash_rv = (charts) => rv({ charts });
const cards = (page) => page.evaluate(() => window.rv_page.charts.debug_cards());

// Every card on screen is read and drawn (cards below the fold wait until they show).
async function cards_ready(page) {
	await page.waitForFunction(() => {
		const c = window.rv_page.charts?.debug_cards();
		return c && c.length > 0 && c.some((x) => x.visible) && c.every((x) => !x.visible || (x.loaded && x.drawn) || x.state === "empty");
	});
	// ECharts animates for 300ms: the screenshot shows the charts at rest.
	await page.waitForTimeout(450);
}

async function to_charts(page) {
	await page.locator('.rv-views [data-mode="charts"]').click();
	await page.waitForFunction(() => window.rv_page.state.mode === "charts" && window.rv_page.charts?.debug_cards);
	await cards_ready(page);
}

// Every card read: each one scrolled into view, then back to the top.
async function load_all(page) {
	const n = (await cards(page)).length;
	for (let i = 0; i < n; i++) {
		await page.evaluate((i) => document.querySelectorAll(".rv-dcard")[i].scrollIntoView({ block: "center" }), i);
		await page.waitForFunction((i) => {
			const c = window.rv_page.charts.debug_cards()[i];
			return c.loaded && (c.drawn || c.state === "empty");
		}, i);
	}
	await page.evaluate(() => window.scrollTo(0, 0));
	await page.waitForTimeout(450);
}

async function to_grid(page) {
	await page.locator('.rv-views [data-mode="grid"]').click();
	await page.waitForFunction(() => window.rv_page.state.mode === "grid" && window.rv_page.grid.current === window.rv_page.opened);
	await settle(page);
}

// Texts of every plot are inside it (a cut label is a design failure).
const labels_outside = (page) =>
	page.evaluate(() => {
		const out = [];
		for (const plot of document.querySelectorAll(".rv-dcard .rv-chart-plot")) {
			const box = plot.getBoundingClientRect();
			for (const t of plot.querySelectorAll("svg text")) {
				const r = t.getBoundingClientRect();
				if (!(r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1)) out.push(t.textContent);
			}
		}
		return out;
	});

const KPI_GL = dash_rv({
	cards: [
		{ id: "k", type: "kpi", series: ["debit", "credit"], size: "full" },
		{ id: "s", type: "stacked", x: "voucher_type", series: ["debit", "credit"] },
		{ id: "l", type: "line", x: "posting_date", series: ["debit"] },
	],
	slicers: [{ key: "voucher_type", type: "set", values: null }],
});

const DASH_SHOTS = [
	{ name: "dashboard-tb-light-rtl", query: "report=tb&lang=ar", height: 1100 },
	{ name: "dashboard-tb-dark-rtl", query: "report=tb&lang=ar&desk=dark", height: 1100 },
	{ name: "dashboard-tb-light-ltr", query: "report=tb&lang=en", height: 1100 },
	{ name: "dashboard-tb-dark-ltr", query: "report=tb&lang=en&desk=dark", height: 1100 },
	{ name: "dashboard-tb-compact-rtl", query: "report=tb&lang=ar&density=compact", height: 1100 },
	{ name: "dashboard-ar-light-rtl", query: "report=ar&lang=ar", height: 1100 },
	{ name: "dashboard-ar-dark-ltr", query: "report=ar&lang=en&desk=dark", height: 1100 },
	{ name: "dashboard-gl-light-rtl", query: "report=gl&lang=ar", height: 1100 },
	{ name: "dashboard-gl-dark-ltr", query: "report=gl&lang=en&desk=dark", height: 1100 },
	{ name: "dashboard-gl-kpi-light-ltr", query: `report=gl&lang=en&rv=${KPI_GL}`, height: 1100 },
	{ name: "dashboard-tb-390-rtl", query: "report=tb&lang=ar", width: 390, height: 844, full: true },
	{ name: "dashboard-ar-390-rtl", query: "report=ar&lang=ar", width: 390, height: 844, full: true },
	{ name: "dashboard-gl-390-dark-ltr", query: "report=gl&lang=en&pref=dark", width: 390, height: 844, full: true },
];

for (const s of DASH_SHOTS) {
	test(s.name, async ({ page }) => {
		const problems = watch_console(page);
		await open(page, s.query, s);
		await to_charts(page);
		if (s.full) await load_all(page);
		await page.screenshot({ path: path.join(CHARTS_OUT, `${s.name}.png`), fullPage: Boolean(s.full) });
		const shown = (await cards(page)).filter((c) => c.loaded);
		expect(shown.length).toBeGreaterThan(1);
		// a donut has its categories as a list next to it, every category with its share
		for (const c of shown.filter((c) => c.type === "donut")) expect(c.labels.length).toBeGreaterThan(0);
		expect(await page.locator(".rv-dcard.is-donut .rv-chart-dlegend li").count()).toBe(
			shown.filter((c) => c.type === "donut").reduce((a, c) => a + c.labels.length, 0)
		);
		expect(await labels_outside(page), "labels outside the plot").toEqual([]);
		expect(problems, "console errors/warnings").toEqual([]);
	});
}

// What the grid shows grouped by a column under some filters: {id: [values]} of its first
// level and its grand total. The table is shown for it, then left without filter nor group.
async function grid_by(page, x, series, filters = []) {
	await page.evaluate(
		({ x, filters }) => {
			const p = window.rv_page;
			p.state.mode = "grid";
			p.state.filters = filters;
			p.state.quick_filters = [];
			p.controls.set_group([x]);
		},
		{ x, filters }
	);
	await page.waitForFunction(() => window.rv_page.result?.mode === "group" && window.rv_page.grid.current === window.rv_page.opened);
	const out = await page.evaluate(
		async ({ series }) => {
			const cols = await window.rv_page.opened.view.to_columns();
			const rows = {};
			cols.__ROW_PATH__.forEach((p, i) => {
				if (p.length === 1) rows[String(p[0])] = series.map((k) => cols[k][i]);
			});
			return { rows, totals: window.rv_page.debug_totals().totals };
		},
		{ series }
	);
	await page.evaluate(() => {
		window.rv_page.state.filters = [];
		window.rv_page.controls.set_group([]);
	});
	await page.waitForFunction(() => window.rv_page.result && window.rv_page.result.mode !== "group" && window.rv_page.grid.current === window.rv_page.opened);
	return out;
}

function same_card(card, grid, label) {
	expect(card.categories.length, `${label}: categories`).toBeGreaterThan(0);
	card.categories.forEach((id, i) => {
		const values = grid.rows[String(id)];
		expect(values, `${label}: ${id} in the grid`).toBeTruthy();
		card.series.forEach((k, j) => expect(Math.abs((card.values[k][i] ?? 0) - (values[j] ?? 0)), `${label}: ${id} ${k}`).toBeLessThan(0.005));
	});
	// a card that shows every category adds up to the grid's grand total
	if (!card.top) card.series.forEach((k) => expect(Math.abs(card.total[k].value - grid.totals[k]), `${label}: total ${k}`).toBeLessThan(0.005));
}

// The dashboard's filters as the grid's own: a slicer of values, a card's filter, a cross-filter.
const as_grid_filters = (slicers) => slicers.map((s) => ({ key: s.key, type: "set", values: s.values, exclude: false }));

test("dashboard: the numbers of every card are the grid's for the same filters (tb, ar, gl)", async ({ page }) => {
	test.setTimeout(120_000);
	const problems = watch_console(page);
	// trial balance: the closing card reads the tree "as is" (its top rows); the others the facts
	await open(page, "report=tb&lang=ar", { height: 1400 });
	await to_charts(page);
	await load_all(page);
	const tb = await cards(page);
	expect(tb.map((c) => c.id)).toEqual(["closing", "expenses", "moving"]);
	expect(tb[0].route).toBe("nodes");
	const top_rows = await page.evaluate(async () => {
		const p = window.rv_page;
		await p.render();
		const cols = await p.opened.view.to_columns();
		const out = {};
		cols.__rid.forEach((rid, i) => {
			if (cols.__depth[i] === 0) out[rid] = [cols.closing_debit[i], cols.closing_credit[i]];
		});
		return out;
	});
	tb[0].rids.forEach((rid, i) => {
		expect(Math.abs(tb[0].values.closing_debit[i] - top_rows[rid][0])).toBeLessThan(0.005);
		expect(Math.abs(tb[0].values.closing_credit[i] - top_rows[rid][1])).toBeLessThan(0.005);
	});
	same_card(tb[1], await grid_by(page, "account", tb[1].series, [{ key: "account__root_type", type: "set", values: ["Expense"], exclude: false }]), "tb expenses");
	same_card(tb[2], await grid_by(page, "account", tb[2].series), "tb moving");

	// receivables and the general ledger: every card by its dimension; the measures side by side = the grand total
	for (const report of ["ar", "gl"]) {
		await open(page, `report=${report}&lang=en`, { height: 1400 });
		await to_charts(page);
		await load_all(page);
		const list = await cards(page);
		for (const c of list) {
			if (c.route === "totals") {
				const totals = await page.evaluate(() => window.rv_page.debug_totals().totals);
				c.series.forEach((k) => expect(Math.abs(c.total[k].value - (totals[k] ?? 0)), `${report} ${c.id} ${k}`).toBeLessThan(0.005));
				continue;
			}
			same_card(c, await grid_by(page, c.x, c.series), `${report} ${c.id}`);
		}
	}
	expect(problems, "console errors/warnings").toEqual([]);
});

test("dashboard: add, edit, duplicate, resize and remove a card; kept in the URL and the user's settings", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=gl&lang=ar", { height: 1400 });
	await to_charts(page);
	const ids = async () => (await cards(page)).map((c) => c.id);
	expect(await ids()).toEqual(["accounts", "vouchers", "dates"]);
	// add: a new card opens its editor
	await page.locator('[data-action="add-card"]').click();
	await page.waitForSelector(".rv-ced-pop");
	expect((await ids()).length).toBe(4);
	await shot_dash(page, "dashboard-gl-editor-rtl");
	// edit: type, dimension, measures, Top N, sort, title
	const id = (await ids())[3];
	await page.locator('.rv-ced-pop .rv-ctype[data-type="donut"]').click();
	await page.waitForFunction((id) => window.rv_page.state.charts?.cards.find((c) => c.id === id)?.type === "donut", id);
	await page.selectOption('.rv-ced-pop [data-f="x"]', "party");
	await page.waitForFunction((id) => window.rv_page.state.charts.cards.find((c) => c.id === id).x === "party", id);
	await page.locator('.rv-ced-pop .rv-chart-measures input[data-key="credit"]').check();
	await page.waitForFunction((id) => window.rv_page.state.charts.cards.find((c) => c.id === id).series.includes("credit"), id);
	await page.locator('.rv-ced-pop [data-top="5"]').click();
	await page.waitForFunction((id) => window.rv_page.state.charts.cards.find((c) => c.id === id).top === 5, id);
	await page.fill(".rv-ced-pop .rv-ced-title", "حسب الطرف");
	await page.press(".rv-ced-pop .rv-ced-title", "Enter");
	await page.waitForFunction((id) => window.rv_page.state.charts.cards.find((c) => c.id === id).title === "حسب الطرف", id);
	await page.keyboard.press("Escape");
	await page.waitForFunction((id) => {
		const c = window.rv_page.charts.debug_cards().find((x) => x.id === id);
		return c.type === "donut" && c.x === "party" && c.loaded;
	}, id);
	expect(await page.locator(`.rv-dcard[data-card="${id}"] h3`).textContent()).toBe("حسب الطرف");
	// a donut with more than one measure says it shows the first one
	await expect(page.locator(`.rv-dcard[data-card="${id}"] .rv-chart-note`)).toBeVisible();
	// card menu: full width, duplicate, remove
	const menu = async (card, item) => {
		await page.locator(`.rv-dcard[data-card="${card}"] .rv-dcard-menu`).click();
		await page.locator(`.rv-pop [data-item="${item}"]`).click();
	};
	await menu("accounts", "size");
	await page.waitForFunction(() => document.querySelector('.rv-dcard[data-card="accounts"]').classList.contains("wide"));
	await menu("accounts", "duplicate");
	await page.waitForFunction(() => window.rv_page.charts.debug_cards().length === 5);
	expect((await ids())[1]).not.toBe("accounts");
	await menu("vouchers", "remove");
	await page.waitForFunction(() => !window.rv_page.charts.debug_cards().some((c) => c.id === "vouchers"));
	// the dashboard is in the URL (rv) and in the user's settings (no cross-filter there)
	await page.waitForFunction(() => /[?&]rv=/.test(window.location.search));
	await page.waitForFunction(() => frappe.model.user_settings.store["Report View:General Ledger"]?.charts?.cards.length === 4, null, { timeout: 5000 });
	// a link with this dashboard opens it
	const charts = await page.evaluate(() => window.rv_page.state.charts);
	await open(page, `report=gl&lang=ar&rv=${dash_rv(charts)}`);
	await to_charts(page);
	expect((await ids()).length).toBe(4);
	expect((await ids()).includes("vouchers")).toBe(false);
	// back to the report's default
	await page.locator('[data-action="dash-menu"]').click();
	await page.locator('.rv-pop [data-item="reset"]').click();
	await page.waitForFunction(() => window.rv_page.state.charts === null);
	await page.waitForFunction(() => window.rv_page.charts.debug_cards().map((c) => c.id).join() === "accounts,vouchers,dates");
	expect(problems, "console errors/warnings").toEqual([]);
});

async function shot_dash(page, name) {
	await page.waitForTimeout(350);
	await page.screenshot({ path: path.join(CHARTS_OUT, `${name}.png`) });
}

// Middle of the bar of a category (first series) of a bar card, to click it as the user does.
const bar_point = (page, id, index) =>
	page.evaluate(
		({ id, index }) => {
			const card = window.rv_page.charts.cards.get(id);
			card.el.scrollIntoView({ block: "center" });
			const r = card.chart.getModel().getSeriesByIndex(0).getData().getItemLayout(index);
			const box = card.plot.getBoundingClientRect();
			return { x: box.left + r.x + r.width / 2, y: box.top + r.y + r.height / 2 };
		},
		{ id, index }
	);

test("dashboard: slicers and the cross-filter filter every card with the grid's numbers", async ({ page }) => {
	test.setTimeout(90_000);
	const problems = watch_console(page);
	await open(page, "report=gl&lang=ar", { height: 1400 });
	await to_charts(page);
	await load_all(page);
	const before = await cards(page);
	// a slicer of values: its list and counts from a temporary view
	await page.locator('[data-action="add-slicer"]').click();
	await page.locator('.rv-pop [data-item="voucher_type"]').click();
	await page.waitForSelector(".rv-set-pop .rv-setitem:not(.all)");
	await shot_dash(page, "dashboard-gl-slicer-rtl");
	expect(await page.evaluate(() => window.rv_page.debug_handles().filter((h) => /unique/.test(h.name)).length)).toBe(0);
	// keep Payment Entry only: untick the others
	const labels = await page.locator(".rv-set-pop .rv-setitem:not(.all)").allTextContents();
	for (let i = 0; i < labels.length; i++) {
		if (!labels[i].includes("Payment Entry")) await page.locator(".rv-set-pop .rv-setitem:not(.all) input").nth(i).uncheck();
	}
	await page.keyboard.press("Escape");
	await page.waitForFunction(() => {
		const s = window.rv_page.state.charts?.slicers?.[0];
		return s && s.values?.length === 1 && s.values[0] === "Payment Entry";
	});
	await load_all(page);
	await expect(page.locator(".rv-slicer.on")).toHaveCount(1);
	const sliced = await cards(page);
	sliced.forEach((c, i) => expect(JSON.stringify(c.values) !== JSON.stringify(before[i].values) || c.categories.length !== before[i].categories.length, c.id).toBe(true));
	expect(sliced.find((c) => c.id === "vouchers").categories).toEqual(["Payment Entry"]);
	const filters = as_grid_filters([{ key: "voucher_type", values: ["Payment Entry"] }]);
	for (const c of sliced) same_card(c, await grid_by(page, c.x, c.series, filters), `sliced ${c.id}`);
	await to_charts(page);
	await load_all(page);

	// cross-filter: a click on an account's bar filters the other cards; the chip clears it
	const account = (await cards(page)).find((c) => c.id === "accounts");
	const hit = await bar_point(page, "accounts", 0);
	await page.mouse.click(hit.x, hit.y);
	await page.waitForFunction((v) => window.rv_page.state.charts?.cross?.value === v, account.categories[0]);
	await page.waitForFunction(() => window.rv_page.charts.debug_cards().every((c) => !c.visible || c.loaded));
	await expect(page.locator(".rv-slicer.cross")).toHaveCount(1);
	await page.evaluate(() => window.scrollTo(0, 0));
	await shot_dash(page, "dashboard-gl-cross-rtl");
	await load_all(page);
	const crossed = await cards(page);
	// the card that was clicked keeps its categories; the others show that account only
	expect(crossed.find((c) => c.id === "accounts").categories).toEqual(account.categories);
	const both = as_grid_filters([
		{ key: "voucher_type", values: ["Payment Entry"] },
		{ key: "account", values: [account.categories[0]] },
	]);
	for (const c of crossed.filter((c) => c.id !== "accounts")) same_card(c, await grid_by(page, c.x, c.series, both), `cross ${c.id}`);
	await to_charts(page);
	// the chip clears it
	await page.locator(".rv-slicer.cross .rv-chip-x").click();
	await page.waitForFunction(() => window.rv_page.state.charts.cross === null);
	// removing the slicer: every card back to all the rows
	await page.locator(".rv-slicer [data-remove]").click();
	await page.waitForFunction(() => window.rv_page.state.charts.slicers.length === 0);
	await load_all(page);
	const back = await cards(page);
	back.forEach((c, i) => expect(c.values, c.id).toEqual(before[i].values));
	expect(problems, "console errors/warnings").toEqual([]);
});

test("dashboard: a cross-filter from a bar of the tree, again to clear; a date slicer", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=ar", { height: 1100 });
	await to_charts(page);
	const p = await bar_point(page, "closing", 0);
	await page.mouse.click(p.x, p.y);
	await page.waitForFunction(() => window.rv_page.state.charts?.cross?.key === "level_1");
	await page.waitForFunction(() => window.rv_page.charts.debug_cards().every((c) => !c.visible || c.loaded));
	await shot_dash(page, "dashboard-tb-cross-rtl");
	// the other cards read the facts of that top-level group only
	const moving = (await cards(page)).find((c) => c.id === "moving");
	expect(moving.route).toBe("facts");
	const p2 = await bar_point(page, "closing", 0);
	await page.mouse.click(p2.x, p2.y);
	await page.waitForFunction(() => window.rv_page.state.charts.cross === null);

	// a date slicer on the general ledger, LTR
	await open(page, "report=gl&lang=en", { height: 1100 });
	await to_charts(page);
	await page.locator('[data-action="add-slicer"]').click();
	await page.locator('.rv-pop [data-item="posting_date"]').click();
	await page.waitForSelector(".rv-dslicer-pop");
	await page.locator('.rv-dslicer-pop [data-f="from"] input').fill("19-04-2026");
	await page.locator('.rv-dslicer-pop [data-f="from"] input').dispatchEvent("change");
	await page.waitForFunction(() => window.rv_page.state.charts?.slicers?.[0]?.from === "2026-04-19");
	await page.waitForFunction(() => window.rv_page.charts.debug_cards().every((c) => !c.visible || c.loaded));
	await shot_dash(page, "dashboard-gl-date-slicer-ltr");
	const dates = (await cards(page)).find((c) => c.id === "dates");
	expect(dates.categories.every((ms) => ms >= Date.UTC(2026, 3, 19))).toBe(true);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("dashboard lifecycle: no handle or chart left after 20 switches, slicer changes, a re-run and leaving", async ({ page }) => {
	test.setTimeout(120_000);
	const problems = watch_console(page);
	const kinds = () => page.evaluate(() => window.rv_page.debug_handles().map((h) => h.kind).sort().join(","));
	await open(page, "report=tb&lang=ar");
	const grid_handles = await kinds();
	for (let i = 0; i < 20; i++) {
		if (i % 2 === 0) {
			await to_charts(page);
			// a card's view is deleted once read: the page keeps only the grid's handles
			expect(await kinds(), `switch ${i}`).toBe(grid_handles);
		} else {
			await to_grid(page);
			expect(await kinds(), `switch ${i}`).toBe(grid_handles);
			expect(await page.evaluate(() => window.rv_page.charts.debug_instances()), `switch ${i}`).toBe(0);
		}
	}
	await to_charts(page);
	for (let i = 0; i < 20; i++) {
		const values = i % 3 === 0 ? null : i % 3 === 1 ? ["Asset"] : ["Expense", "Income"];
		await page.evaluate((values) => window.rv_page.set_chart({ cards: window.rv_page.charts.current().cards, slicers: [{ key: "account__root_type", type: "set", values }], cross: null }), values);
	}
	await page.waitForFunction(() => window.rv_page.charts.debug_cards().every((c) => !c.visible || c.loaded));
	expect(await kinds()).toBe(grid_handles);
	// a re-run in the Charts view: the cards read the new result
	await page.evaluate(() => window.rv_page.run());
	await page.waitForFunction(() => window.rv_page.charts?.debug_cards().some((c) => c.loaded && c.drawn));
	expect(await kinds()).toBe(grid_handles);
	await page.evaluate(() => window.rv_page.hide());
	await page.waitForFunction(() => window.rv_page.debug_handles().length === 0);
	expect(await page.evaluate(() => window.rv_page.charts.debug_instances())).toBe(0);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("dashboard from the bundles written by `bench build` (charts bundle loaded on first use)", async ({ page }) => {
	const manifest = path.resolve(__dirname, "../../../../sites/assets/assets.json");
	const built = fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, "utf8"))["report_view_charts.bundle.js"] : null;
	test.skip(!built || !fs.existsSync(path.resolve(__dirname, "../../../../sites", `.${built}`)), "no build output");
	const problems = watch_console(page);
	const requests = [];
	page.on("request", (r) => requests.push(new URL(r.url()).pathname));
	await open(page, "report=tb&lang=ar&built=1");
	expect(requests).not.toContain(built);
	await to_charts(page);
	expect(requests).toContain(built);
	expect((await cards(page)).filter((c) => c.loaded && c.drawn).length).toBeGreaterThan(1);
	expect(problems, "console errors/warnings").toEqual([]);
});

// ------------------------------------------------------------------ Pivot (phase 5b tasks 2, 3, 5)
// Screenshots to docs/progress/screens/phase-5a2/pivot-*.png (reference:
// reference/design/screens/pivot.png, pivot_drill.png, sidecols_pivot.png).
const PIVOT_OUT = path.resolve(__dirname, "../../docs/progress/screens/phase-5a2");
const pivot_shot = (page, name, full = false) => page.screenshot({ path: path.join(PIVOT_OUT, `${name}.png`), fullPage: full });
const PIVOT_DESIGN = { width: 1440, height: 1100 };
const pivot_handles = (page) => page.evaluate(() => window.rv_page.debug_handles().map((h) => h.kind).sort().join(","));
const FIXTURES = path.resolve(__dirname, "../../report_view/tests/fixtures/normalize");
const raw_rows = (file) => JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf8")).input.raw.result;
const pivot_rv = (pivot, extra = {}) => rv({ mode: "pivot", pivot, ...extra });
const PV_TB_SPLIT = { rows: ["level_1", "level_2"], cols: ["account__root_type"], values: [{ key: "closing_debit", agg: "sum" }, { key: "closing_credit", agg: "sum" }] };
const PV_AR = { rows: ["party"], cols: ["voucher_type"], values: [{ key: "paid", agg: "sum" }] };
const PV_AR_COUNT = { rows: ["party"], cols: ["voucher_type"], values: [{ key: "paid", agg: "sum" }, { key: "paid", agg: "count" }] };
const PV_GL = { rows: ["account"], cols: ["voucher_type", "party_type"], values: [{ key: "debit", agg: "sum" }, { key: "credit", agg: "sum" }] };

const pivot_shown = (page) => page.waitForFunction(() => window.rv_page.debug_pivot()?.shown);

async function to_pivot(page) {
	await page.locator('.rv-views [data-mode="pivot"]').click();
	await pivot_shown(page);
	await settle(page);
}

// The pivot after a change made in the page: a new pivot view is shown and drawn.
async function pivot_changed(page, test) {
	await page.waitForFunction(test);
	await pivot_shown(page);
	await settle(page);
}

async function grid_back(page) {
	await page.waitForFunction(() => window.rv_page.state.mode === "grid" && window.rv_page.grid.current === window.rv_page.opened && window.rv_page.grid.rt);
	await settle(page);
}

const PIVOT_SHOTS = [
	{ name: "pivot-tb-light-rtl", query: "report=tb&lang=ar" },
	{ name: "pivot-tb-dark-rtl", query: "report=tb&lang=ar&desk=dark" },
	{ name: "pivot-tb-light-ltr", query: "report=tb&lang=en" },
	{ name: "pivot-tb-dark-ltr", query: "report=tb&lang=en&desk=dark" },
	{ name: "pivot-tb-compact-rtl", query: "report=tb&lang=ar&density=compact" },
	{ name: "pivot-tb-split-light-rtl", query: `report=tb&lang=ar&rv=${pivot_rv(PV_TB_SPLIT)}` },
	{ name: "pivot-tb-split-dark-ltr", query: `report=tb&lang=en&desk=dark&rv=${pivot_rv(PV_TB_SPLIT)}` },
	{ name: "pivot-ar-light-rtl", query: `report=ar&lang=ar&rv=${pivot_rv(PV_AR_COUNT)}` },
	{ name: "pivot-ar-dark-ltr", query: `report=ar&lang=en&desk=dark&rv=${pivot_rv(PV_AR_COUNT)}` },
	{ name: "pivot-gl-light-ltr", query: `report=gl&lang=en&rv=${pivot_rv(PV_GL)}` },
	{ name: "pivot-gl-dark-rtl", query: `report=gl&lang=ar&desk=dark&rv=${pivot_rv(PV_GL)}` },
	{ name: "pivot-gl-default-light-rtl", query: "report=gl&lang=ar" },
	{ name: "pivot-tb-390-rtl", query: `report=tb&lang=ar&rv=${pivot_rv(PV_TB_SPLIT)}`, width: 390, height: 844, full: true },
	{ name: "pivot-gl-390-dark-ltr", query: `report=gl&lang=en&pref=dark&rv=${pivot_rv(PV_GL)}`, width: 390, height: 844, full: true },
];

for (const s of PIVOT_SHOTS) {
	test(s.name, async ({ page }) => {
		const problems = watch_console(page);
		await open(page, s.query, { width: s.width || PIVOT_DESIGN.width, height: s.height || PIVOT_DESIGN.height });
		// a link with mode "pivot" opens on the pivot; others switch to it with the tab
		if (!(await page.evaluate(() => window.rv_page.debug_pivot()?.shown))) await to_pivot(page);
		await expect(page.locator('.rv-views [data-mode="pivot"]')).toHaveClass(/on/);
		await expect(page.locator(".rv-pivotbar")).toBeVisible();
		await pivot_shot(page, s.name, Boolean(s.full));
		// header rows: one level per pivot column, plus the value's name when there are several values
		const info = await page.evaluate(() => ({ p: window.rv_page.debug_pivot(), rows: document.querySelectorAll(".rv-pivotgrid regular-table thead tr").length }));
		const levels = info.p.cols.length + (info.p.values.length > 1 || !info.p.cols.length ? 1 : 0);
		expect(info.rows, "header rows").toBe(levels);
		expect(problems, "console errors/warnings").toEqual([]);
	});
}

for (const [name, query, act] of [
	["pivot-tb-drill-light-rtl", `report=tb&lang=ar&rv=${pivot_rv(PV_TB_SPLIT)}`, null],
	["pivot-ar-drill-dark-ltr", `report=ar&lang=en&desk=dark&rv=${pivot_rv(PV_AR_COUNT)}`, null],
	["pivot-tb-sidecols-light-rtl", "report=tb&lang=ar", "sidecols"],
	["pivot-ar-sidecols-dark-ltr", `report=ar&lang=en&desk=dark&rv=${pivot_rv(PV_AR)}`, "sidecols"],
]) {
	test(name, async ({ page }) => {
		const problems = watch_console(page);
		await open(page, query, PIVOT_DESIGN);
		if (!(await page.evaluate(() => window.rv_page.debug_pivot()?.shown))) await to_pivot(page);
		if (act === "sidecols") {
			await page.locator('[data-side="columns"]').click();
			await expect(page.locator('.rv-panel [data-action="pivot-mode"]')).toHaveAttribute("aria-checked", "true");
		} else {
			await page.locator(".rv-pivotgrid regular-table tbody td.pv").first().click();
			await page.waitForFunction(() => document.querySelector(".rv-pv-drill .rv-pv-sub")?.dataset.count);
		}
		await page.waitForTimeout(300);
		await pivot_shot(page, name);
		expect(problems, "console errors/warnings").toEqual([]);
	});
}

const pivot_data = (page) =>
	page.evaluate(async () => {
		const o = window.rv_page.pivot_opened;
		const t = await o.totals.to_columns();
		const p = o.view ? await o.view.to_columns() : {};
		return { paths: t.__ROW_PATH__, t, p, total: o.total, column_paths: o.column_paths };
	});

const close_to = (a, b, label) => expect(Math.abs((a ?? 0) - (b ?? 0)), `${label}: ${a} != ${b}`).toBeLessThan(0.005);

test("pivot: values = a manual check on three combinations of the fixture; grand total = the grid's total", async ({ page }) => {
	const problems = watch_console(page);
	// receivables: party x voucher type, paid (sum and count)
	const ar = raw_rows("accounts_receivable_frappe_total.json").filter((r) => r.party && r.voucher_type);
	await open(page, `report=ar&lang=en&rv=${pivot_rv(PV_AR_COUNT)}`);
	let d = await pivot_data(page);
	const combos = [];
	for (const party of [...new Set(ar.map((r) => r.party))]) {
		for (const type of [...new Set(ar.map((r) => r.voucher_type))]) {
			const rows = ar.filter((r) => r.party === party && r.voucher_type === type);
			if (rows.length) combos.push({ party, type, sum: rows.reduce((a, r) => a + (r.paid || 0), 0), count: rows.length });
		}
	}
	expect(combos.length).toBeGreaterThanOrEqual(3);
	for (const c of combos.slice(0, 3)) {
		const i = d.paths.findIndex((p) => p.length === 1 && p[0] === c.party);
		close_to(d.p[`${c.type}|__pv0`][i], c.sum, `${c.party} / ${c.type}`);
		expect(d.p[`${c.type}|__pv1`][i]).toBe(c.count);
	}
	// what the screen shows is that number: the cell of the first combination
	const first = combos[0];
	const shown = await page.evaluate(({ party, type }) => {
		const rt = document.querySelector(".rv-pivotgrid regular-table");
		const x = window.rv_page.pivot_opened.column_paths.indexOf(`${type}|__pv0`);
		for (const td of rt.querySelectorAll("tbody td")) {
			const th = td.parentElement.querySelector("th");
			if (rt.getMeta(td).x === x && th.textContent.includes(party)) return td.textContent;
		}
		return null;
	}, first);
	expect(shown).not.toBeNull();
	if (Math.abs(first.sum) < 0.005) expect(shown.trim()).toBe("—");
	else close_to(Number(shown.replace(/[^\d.-]/g, "")), first.sum, "cell on screen");
	// grand total of the pivot = the grid's total for the same measure and filters
	const pivot_total = d.total.__pv0;
	await page.locator('.rv-views [data-mode="grid"]').click();
	await grid_back(page);
	close_to(pivot_total, (await page.evaluate(() => window.rv_page.debug_totals().totals)).paid, "ar total");

	// with a filter of the page: the same filter on both
	await page.evaluate(() => window.rv_page.controls.set_filter("voucher_type", { key: "voucher_type", type: "set", values: ["Payment Entry"], exclude: false }));
	await page.waitForFunction(() => window.rv_page.opened?.post.fact_filter.length && window.rv_page.grid.current === window.rv_page.opened);
	const grid_filtered = (await page.evaluate(() => window.rv_page.debug_totals().totals)).paid;
	await to_pivot(page);
	d = await pivot_data(page);
	close_to(d.total.__pv0, grid_filtered, "ar filtered total");
	expect(d.column_paths.every((n) => n.startsWith("Payment Entry|"))).toBe(true);

	// general ledger: two pivot columns, the grand total = the grid's debit and credit
	const gl = raw_rows("general_ledger_consolidated.json").filter((r) => r.voucher_type && !String(r.account).startsWith("'"));
	await open(page, `report=gl&lang=en&rv=${pivot_rv(PV_GL)}`);
	d = await pivot_data(page);
	let checked = 0;
	for (const name of d.column_paths.filter((n) => n.endsWith("|__pv0"))) {
		const [vt, pt] = name.split("|");
		for (let i = 1; i < d.paths.length && checked < 3; i++) {
			const rows = gl.filter((r) => r.account === d.paths[i][0] && r.voucher_type === vt && (r.party_type || "null") === pt);
			if (!rows.length) continue;
			close_to(d.p[name][i], rows.reduce((a, r) => a + (r.debit || 0), 0), `${d.paths[i][0]} / ${name}`);
			checked += 1;
		}
	}
	expect(checked).toBe(3);
	const gl_total = d.total;
	await page.locator('.rv-views [data-mode="grid"]').click();
	await grid_back(page);
	const grid = await page.evaluate(() => window.rv_page.debug_totals().totals);
	close_to(gl_total.__pv0, grid.debit, "gl debit");
	close_to(gl_total.__pv1, grid.credit, "gl credit");

	// trial balance: period debit and credit (the leaves add up to the report's total)
	await open(page, `report=tb&lang=en&rv=${pivot_rv({ rows: ["level_1"], cols: ["account__root_type"], values: [{ key: "debit", agg: "sum" }, { key: "credit", agg: "sum" }] })}`);
	d = await pivot_data(page);
	await page.locator('.rv-views [data-mode="grid"]').click();
	await grid_back(page);
	const tb = await page.evaluate(() => window.rv_page.debug_totals().totals);
	close_to(d.total.__pv0, tb.debit, "tb debit");
	close_to(d.total.__pv1, tb.credit, "tb credit");
	expect(problems, "console errors/warnings").toEqual([]);
});

test("pivot drill-down: the rows behind a cell, as many as its count, from a temporary view deleted at once", async ({ page }) => {
	const problems = watch_console(page);
	const ar = raw_rows("accounts_receivable_frappe_total.json").filter((r) => r.party && r.voucher_type);
	await open(page, `report=ar&lang=ar&rv=${pivot_rv(PV_AR_COUNT)}`);
	const before = await pivot_handles(page);
	// count cells on screen: the drill-down of each lists that many rows (= the fixture's rows)
	const cells = await page.evaluate(() => {
		const rt = document.querySelector(".rv-pivotgrid regular-table");
		const o = window.rv_page.pivot_opened;
		const out = [];
		rt.querySelectorAll("tbody td.pv").forEach((td, i) => {
			const name = o.column_paths[rt.getMeta(td).x];
			if (name && name.endsWith("|__pv1")) out.push({ i, count: Number(td.textContent.replace(/[^\d]/g, "")), type: name.split("|")[0], party: td.parentElement.querySelector("th").textContent });
		});
		return out;
	});
	expect(cells.length).toBeGreaterThan(0);
	for (const c of cells.slice(0, 3)) {
		await page.locator(".rv-pivotgrid regular-table tbody td.pv").nth(c.i).click();
		await page.waitForFunction(() => document.querySelector(".rv-pv-drill .rv-pv-sub")?.dataset.count);
		const listed = await page.evaluate(() => ({
			count: Number(document.querySelector(".rv-pv-drill .rv-pv-sub").dataset.count),
			items: document.querySelectorAll(".rv-pv-drill .rv-pv-item").length,
		}));
		expect(listed.count, `drill of ${c.party} / ${c.type}`).toBe(c.count);
		expect(listed.items).toBe(c.count);
		const party = ar.map((r) => r.party).find((p) => c.party.includes(p));
		expect(ar.filter((r) => r.party === party && r.voucher_type === c.type).length).toBe(c.count);
		// the temporary view was deleted in `finally`
		expect(await pivot_handles(page)).toBe(before);
		await page.keyboard.press("Escape");
		await expect(page.locator(".rv-pv-drill")).toHaveCount(0);
	}
	// the grand total row: every row of the report under the page's filters
	await page.locator(".rv-pivot .rv-rt-total .rv-c.pv").last().click();
	await page.waitForFunction(() => document.querySelector(".rv-pv-drill .rv-pv-sub")?.dataset.count);
	expect(await page.evaluate(() => Number(document.querySelector(".rv-pv-drill .rv-pv-sub").dataset.count))).toBe(ar.length);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("pivot from the columns panel: switch, zones, aggregate; the URL keeps the pivot; drag a column to the pivot columns", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=ar&lang=en", PIVOT_DESIGN);
	await page.locator('[data-side="columns"]').click();
	const sw = page.locator('.rv-panel [data-action="pivot-mode"]');
	await expect(sw).toHaveAttribute("aria-checked", "false");
	await expect(page.locator('.rv-panel [data-zone="pivot"]')).toHaveClass(/off/);
	// a column dragged to the pivot columns zone turns the pivot mode on with it
	await page.locator('.rv-panel [data-zone="pivot"]').scrollIntoViewIfNeeded();
	await page.locator('.rv-panel .rv-colitem[data-key="voucher_type"]').dragTo(page.locator('.rv-panel [data-zone="pivot"]'));
	await pivot_changed(page, () => window.rv_page.state.mode === "pivot" && window.rv_page.debug_pivot()?.cols.join() === "voucher_type");
	await expect(sw).toHaveAttribute("aria-checked", "true");
	expect((await page.evaluate(() => window.rv_page.debug_pivot())).rows).toEqual(["party"]);
	// "+ Add" lists: a row level and a value; the aggregate of a value
	await page.locator('.rv-panel [data-add="rows"]').selectOption("posting_date");
	await pivot_changed(page, () => window.rv_page.debug_pivot()?.rows.join() === "party,posting_date");
	await page.locator('.rv-panel [data-add="values"]').selectOption("outstanding");
	await pivot_changed(page, () => window.rv_page.debug_pivot()?.values.length === 2);
	await page.locator('.rv-panel [data-pagg="1"]').selectOption("max");
	await pivot_changed(page, () => window.rv_page.debug_pivot()?.values[1].agg === "max");
	expect(await page.evaluate(() => window.rv_page.pivot_opened.spec.config.aggregates.__pv1)).toBe("high");
	// a pivot column moved to the rows: it leaves the columns
	await page.locator(".rv-pivotbar .rv-gchip").first().dragTo(page.locator(".rv-gp:not(.pv) .rv-gp-chips"));
	await pivot_changed(page, () => window.rv_page.debug_pivot()?.cols.length === 0);
	expect((await page.evaluate(() => window.rv_page.debug_pivot())).rows).toContain("voucher_type");
	// the URL carries the pivot; a page opened with it shows the same pivot
	// (the URL is written 300 ms after the last change)
	await page.waitForTimeout(500);
	const search = await page.evaluate(() => new URLSearchParams(window.location.search).get("rv"));
	expect(search).toBeTruthy();
	const pivot = await page.evaluate(() => window.rv_page.state.pivot);
	await open(page, `report=ar&lang=en&rv=${search}`, PIVOT_DESIGN);
	await pivot_shown(page);
	expect(await page.evaluate(() => window.rv_page.state.pivot)).toEqual(pivot);
	expect(await page.evaluate(() => window.rv_page.state.mode)).toBe("pivot");
	// the switch off: the table again, the pivot's views deleted
	await page.locator('[data-side="columns"]').click();
	await page.locator('.rv-panel [data-action="pivot-mode"]').click();
	await grid_back(page);
	expect(await page.evaluate(() => window.rv_page.debug_handles().filter((h) => /pivot/.test(h.name)))).toEqual([]);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("pivot: folding a row in both views; expand all and collapse all", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=tb&lang=ar&rv=${pivot_rv(PV_TB_SPLIT)}`);
	const rows = () => page.evaluate(() => window.rv_page.pivot.body_rows);
	const all = await rows();
	await page.locator(".rv-gp:not(.pv) [data-action='collapse-all']").click();
	await page.waitForFunction((n) => window.rv_page.pivot.body_rows < n, all);
	const tops = await rows();
	const data = await pivot_data(page);
	expect(data.paths.slice(1).every((p) => p.length === 1)).toBe(true);
	expect(data.p.__ROW_PATH__).toEqual(data.paths);
	await page.locator(".rv-pivotgrid regular-table tbody .rv-caret").first().click();
	await page.waitForFunction((n) => window.rv_page.pivot.body_rows > n, tops);
	await page.locator(".rv-gp:not(.pv) [data-action='expand-all']").click();
	await page.waitForFunction((n) => window.rv_page.pivot.body_rows === n, all);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("pivot: more split columns than the limit are not drawn; a notice says so", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=gl&lang=en&rows=1200&rv=${pivot_rv({ rows: ["account"], cols: ["voucher_no"], values: [{ key: "debit", agg: "sum" }] })}`);
	const p = await page.evaluate(() => window.rv_page.debug_pivot());
	expect(p.blocked).toBe(true);
	expect(p.cols).toEqual([]);
	await expect(page.locator(".rv-notice")).toContainText("500");
	expect(problems, "console errors/warnings").toEqual([]);
});

test("pivot lifecycle: no handle left after 20 switches and pivot changes, a re-run and leaving", async ({ page }) => {
	const problems = watch_console(page);
	const names = () => page.evaluate(() => window.rv_page.debug_handles().map((h) => h.name));
	await open(page, `report=tb&lang=ar&rv=${rv({ pivot: PV_TB_SPLIT })}`);
	const grid_handles = await pivot_handles(page);
	for (let i = 0; i < 20; i++) {
		if (i % 2 === 0) {
			await to_pivot(page);
			if (i % 4 === 0) {
				await page.evaluate((n) => window.rv_page.controls.set_pivot_cols(n ? ["account__root_type"] : []), i % 8);
				await pivot_changed(page, () => window.rv_page.pivot.current === window.rv_page.pivot_opened);
			}
			const pv = (await names()).filter((n) => /\/pivot/.test(n));
			const split = (await page.evaluate(() => window.rv_page.debug_pivot().cols.length)) > 0;
			expect(pv.length, `switch ${i}`).toBe(split ? 2 : 1);
		} else {
			await page.locator('.rv-views [data-mode="grid"]').click();
			await grid_back(page);
			expect(await pivot_handles(page), `switch ${i}`).toBe(grid_handles);
		}
	}
	await to_pivot(page);
	await page.evaluate(() => window.rv_page.run());
	await pivot_changed(page, () => window.rv_page.debug_pivot()?.shown);
	expect((await names()).filter((n) => /\/pivot/.test(n)).length).toBeLessThanOrEqual(2);
	await page.evaluate(() => window.rv_page.hide());
	await page.waitForFunction(() => window.rv_page.debug_handles().length === 0);
	expect(problems, "console errors/warnings").toEqual([]);
});

// ------------------------------------------------------------------------------------------
// Pages view (ADR-014; docs/progress/pages-print.md): the report as printed pages next to
// the table, compared with reference/design/screens/print.png. Saved to
// docs/progress/screens/pages/. The harness answers the print options, a letter head and
// the translations; the language re-run answers the same fixture.
const OUT3 = path.resolve(__dirname, "../../docs/progress/screens/pages");
fs.mkdirSync(OUT3, { recursive: true });
const shot3 = (page, name, full = false) => page.screenshot({ path: path.join(OUT3, `${name}.png`), fullPage: full });
const PAGES = rv({ mode: "pages" });
const pages_settings = (s) => `&pages=${encodeURIComponent(JSON.stringify(s))}`;
// the panel's sections fold: a test opens them all
const open_sections = (page) =>
	page.evaluate(() => {
		const v = window.rv_page.pages;
		v.open_secs = new Set(["paper", "tpl", "head", "heading", "foot", "num", "sign", "border", "wm", "content", "cols"]);
		v.render_panel();
	});
// a Link field of the panel (a Frappe control): typed, committed as the field is left
const pick_link = async (page, key, value) => {
	await page.locator(`[data-link="${key}"] input`).fill(value);
	await page.locator(`[data-link="${key}"] input`).press("Tab");
	await settle(page);
};
// a typed number, committed as the field is left
const type_num = async (page, sel, value) => {
	await page.locator(sel).fill(String(value));
	await page.locator(sel).press("Tab");
	await settle(page);
};

const pages_state = (page) =>
	page.evaluate(() => {
		const v = window.rv_page.pages;
		return {
			pages: v.pages.map((p) => [p.start, p.end]),
			count: v.pages.length,
			filled: v.filled.size,
			rows: v.layout ? v.layout.size : 0,
			box: v.box && { w: v.box.w, h: v.box.h, inner_w: v.box.inner_w },
			measure: v.measure,
			dir: v.sheets.dir,
			note: document.querySelector(".rv-print-note").textContent,
			count_text: document.querySelector(".rv-print-count").textContent,
			titles: [...document.querySelectorAll('.rv-page[data-page="0"] .rv-pt thead th')].map((th) => th.textContent.trim()).filter(Boolean),
			first_rows: [...document.querySelectorAll('.rv-page[data-page="0"] .rv-pt tbody tr')].map((tr) => tr.className),
			footer: document.querySelector('.rv-page[data-page="0"] .rv-page-foot-line').textContent.replace(/\s+/g, " ").trim(),
			letterhead: Boolean(document.querySelector('.rv-page[data-page="0"] .rv-page-lh')),
			total: Boolean(document.querySelector(".rv-page .rv-pt tr.total")),
			signatures: document.querySelectorAll(".rv-page .rv-page-sign div").length,
		};
	});

const PAGE_SHOTS = [
	// the trial balance opens in landscape by itself (too wide for a portrait page)
	{ name: "pages-tb-light-rtl", query: `report=tb&lang=ar&rv=${PAGES}` },
	{ name: "pages-tb-dark-rtl", query: `report=tb&lang=ar&desk=dark&rv=${PAGES}` },
	{ name: "pages-tb-light-ltr", query: `report=tb&lang=en&rv=${PAGES}` },
	{ name: "pages-tb-dark-ltr", query: `report=tb&lang=en&desk=dark&rv=${PAGES}` },
	{ name: "pages-tb-portrait-signatures-light-rtl", query: `report=tb&lang=ar&rv=${PAGES}${pages_settings({ orientation: "portrait", signatures: true })}` },
	{ name: "pages-tb-no-letterhead-a3-light-ltr", query: `report=tb&lang=en&rv=${PAGES}${pages_settings({ letter_head: "", size: "A3", margins: "wide" })}` },
	{ name: "pages-tb-compact-light-rtl", query: `report=tb&lang=ar&density=compact&rv=${PAGES}` },
	{ name: "pages-gl-light-rtl", query: `report=gl&lang=ar&rv=${PAGES}` },
	{ name: "pages-gl-landscape-light-ltr", query: `report=gl&lang=en&rv=${PAGES}${pages_settings({ orientation: "landscape" })}` },
	{ name: "pages-gl-by-account-light-rtl", query: `report=gl_account&lang=ar&rv=${PAGES}` },
	{ name: "pages-ar-group-light-ltr", query: `report=ar&lang=en&group=party&rv=${PAGES}` },
	{ name: "pages-ar-group-dark-rtl", query: `report=ar&lang=ar&desk=dark&group=party&rv=${PAGES}${pages_settings({ orientation: "landscape" })}` },
	{ name: "pages-tb-390-rtl", query: `report=tb&lang=ar&rv=${PAGES}`, width: 390, height: 844, full: true },
];

for (const s of PAGE_SHOTS) {
	test(s.name, async ({ page }) => {
		const problems = watch_console(page);
		await open(page, s.query, s);
		await settle(page);
		await shot3(page, s.name, Boolean(s.full));
		const st = await pages_state(page);
		expect(st.count).toBeGreaterThan(0);
		expect(st.filled).toBeGreaterThan(0);
		expect(problems, "console errors/warnings").toEqual([]);
	});
}

test("pages: the rows of the view are cut into pages without a gap; every page repeats the titles and numbers itself", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=gl&lang=ar&rv=${PAGES}`);
	await settle(page);
	const st = await pages_state(page);
	// contiguous, every display row once
	let at = 0;
	for (const [start, end] of st.pages) {
		expect(start).toBe(at);
		at = end;
	}
	expect(at).toBe(st.rows);
	expect(st.count_text).toContain(String(st.count));
	expect(st.measure.row_h).toBeGreaterThan(10);
	// the report's opening row stands first on the first page, the closing rows and the total last
	expect(st.first_rows[0]).toBe("opening");
	expect(st.total).toBe(true);
	expect(st.titles.length).toBeGreaterThan(5);
	expect(st.footer).toMatch(/1/);
	expect(st.letterhead).toBe(true);
	// every page has the column titles and the footer with its number
	const all = await page.evaluate(async () => {
		const v = window.rv_page.pages;
		await v.fill_all();
		const pages = [...document.querySelectorAll(".rv-page")];
		return pages.map((el, i) => ({
			titles: el.querySelectorAll(".rv-pt thead th").length,
			foot: el.querySelector(".rv-page-foot-line")?.textContent.includes(String(i + 1)),
			rows: el.querySelectorAll(".rv-pt tbody tr").length,
			overflow: el.scrollHeight > el.clientHeight + 1,
		}));
	});
	for (const p of all) {
		expect(p.titles).toBeGreaterThan(5);
		expect(p.foot).toBe(true);
		expect(p.overflow).toBe(false);
	}
	expect(all.reduce((n, p) => n + p.rows, 0)).toBeGreaterThanOrEqual(st.rows);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("pages: paper, orientation, margins, content and columns change the pages; the settings are saved for the user", async ({ page }) => {
	const problems = watch_console(page);
	// the trial balance is too wide for a portrait page: without a saved choice it opens in landscape
	await open(page, `report=tb&lang=en&rv=${PAGES}`);
	await open_sections(page);
	expect((await pages_state(page)).box.w).toBeGreaterThan((await pages_state(page)).box.h);
	await page.click('[data-orient="portrait"]');
	await settle(page);
	await settle(page);
	const portrait = await pages_state(page);
	expect(portrait.box.w).toBeLessThan(portrait.box.h);
	await page.click('[data-orient="landscape"]');
	await settle(page);
	const landscape = await pages_state(page);
	expect(landscape.box.w).toBeGreaterThan(landscape.box.h);
	expect(landscape.measure.body_h).toBeLessThan(portrait.measure.body_h);
	await page.selectOption('select[data-set="size"]', "A3");
	await settle(page);
	const a3 = await pages_state(page);
	expect(a3.box.w).toBeGreaterThan(landscape.box.w);
	await page.click('[data-seg="margins"][data-value="wide"]');
	await settle(page);
	const wide = await pages_state(page);
	expect(wide.box.inner_w).toBeLessThan(a3.box.inner_w);
	// signatures and no grand total
	await page.click('[data-sw="signatures"]');
	await settle(page);
	expect((await pages_state(page)).signatures).toBe(3);
	await page.click('input[data-set="include_total"]');
	await settle(page);
	expect((await pages_state(page)).total).toBe(false);
	// a column hidden for print only: the grid keeps it
	const before = (await pages_state(page)).titles.length;
	await page.click('input[data-col="account__account_type"]');
	await settle(page);
	const after = await pages_state(page);
	expect(after.titles.length).toBe(before - 1);
	expect(after.titles).not.toContain("Account Type");
	const saved = await page.evaluate(() => frappe.model.user_settings.store["Report View:Trial Balance"]?.pages);
	await page.waitForTimeout(900);
	const saved2 = await page.evaluate(() => frappe.model.user_settings.store["Report View:Trial Balance"]?.pages);
	expect((saved2 || saved).orientation).toBe("landscape");
	expect((saved2 || saved).hidden).toEqual(["account__account_type"]);
	const hidden_in_grid = await page.evaluate(() => window.rv_page.state.columns.hidden);
	expect(hidden_in_grid).not.toContain("account__account_type");
	await shot3(page, "pages-tb-settings-changed-light-ltr");
	expect(problems, "console errors/warnings").toEqual([]);
});

test("pages: another language runs the report again and turns the pages; the session language comes back", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=tb&lang=ar&rv=${PAGES}`);
	await settle(page);
	await open_sections(page);
	const arabic = await pages_state(page);
	expect(arabic.dir).toBe("rtl");
	expect(arabic.footer).toContain("صفحة");
	await pick_link(page, "lang", "en");
	await settle(page);
	const english = await pages_state(page);
	expect(english.dir).toBe("ltr");
	expect(english.footer).toMatch(/Page 1 of/);
	expect(english.titles).toContain("Debit");
	// the fixture's columns are wider than a portrait page: that note may stand, no failure may
	expect(english.note).not.toMatch(/could not|تعذّر/);
	await shot3(page, "pages-tb-english-from-arabic-session");
	await pick_link(page, "lang", "");
	await settle(page);
	const back = await pages_state(page);
	expect(back.dir).toBe("rtl");
	expect(back.titles).toEqual(arabic.titles);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("pages: print fills every page and leaves the sheets alone in the document with the paper's @page rule, then puts them back", async ({ page }) => {
	const problems = watch_console(page);
	// an explicit portrait: the general ledger would open in landscape by itself
	await open(page, `report=gl&lang=ar&rv=${PAGES}${pages_settings({ orientation: "portrait", num_line_w: 2, num_line_c: "#2d5c93", wm_type: "text", wm_text: "سري", wm_color: "#1e5c45", pb_on: true, pb_c: "#8a2d3b" })}`);
	await settle(page);
	const prepared = await page.evaluate(async () => {
		const v = window.rv_page.pages;
		window.__restore = await v.prepare_print();
		const printed = document.querySelector("body > .rv-print-root .rv-page");
		const css = (sel, prop) => getComputedStyle(printed.querySelector(sel))[prop];
		window.__printed = {
			rule: css(".rv-page-foot-line", "borderTopColor"),
			mark: css(".rv-page-wm span", "color"),
			border: css(".rv-page-border", "borderTopColor"),
			adjust: getComputedStyle(printed).printColorAdjust || getComputedStyle(printed).webkitPrintColorAdjust,
			// the foot stays inside the page
			foot_inside: printed.querySelector(".rv-page-foot").getBoundingClientRect().bottom <= printed.getBoundingClientRect().bottom + 0.5,
		};
		const root = document.querySelector("body > .rv-print-root");
		return {
			root: Boolean(root),
			dir: root?.dir,
			css: root?.querySelector("style")?.textContent || "",
			filled: v.filled.size,
			pages: v.pages.length,
			in_stage: Boolean(document.querySelector(".rv-print-stage .rv-print-sheets")),
			button_disabled: document.querySelector('.rv-print-ft [data-action="print"]').disabled,
		};
	});
	expect(prepared.root).toBe(true);
	expect(prepared.dir).toBe("rtl");
	expect(prepared.filled).toBe(prepared.pages);
	expect(prepared.in_stage).toBe(false);
	expect(prepared.button_disabled).toBe(true);
	expect(prepared.css).toContain("@page{size:210mm 297mm;margin:0}");
	// the printed sheets keep the colours of their rules, watermark and border
	const printed = await page.evaluate(() => window.__printed);
	expect(printed.rule).toBe("rgb(45, 92, 147)");
	expect(printed.mark).toBe("rgb(30, 92, 69)");
	expect(printed.border).toBe("rgb(138, 45, 59)");
	expect(printed.foot_inside).toBe(true);
	expect(prepared.css).toContain("body>*:not(.rv-print-root){display:none!important}");
	await page.emulateMedia({ media: "print" });
	await shot3(page, "pages-gl-print-media-rtl", true);
	await page.emulateMedia({ media: "screen" });
	const restored = await page.evaluate(() => {
		window.__restore();
		const v = window.rv_page.pages;
		return {
			root: Boolean(document.querySelector(".rv-print-root")),
			in_stage: Boolean(document.querySelector(".rv-print-stage .rv-print-sheets")),
			printing: v.printing,
			button_disabled: document.querySelector('.rv-print-ft [data-action="print"]').disabled,
		};
	});
	expect(restored).toEqual({ root: false, in_stage: true, printing: false, button_disabled: false });
	expect(problems, "console errors/warnings").toEqual([]);
});

test("pages: only the pages near the viewport carry content; far ones give it back; the Print action of the head opens the pages", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=gl&lang=ar&rows=20000");
	await page.click('.rv-headbar [data-action="print"]');
	await page.waitForFunction(() => window.rv_page.state.mode === "pages" && window.rv_page.pages.pages.length > 0);
	await settle(page);
	const st = await pages_state(page);
	expect(st.count).toBeGreaterThan(100);
	expect(st.filled).toBeLessThan(12);
	await page.evaluate(() => {
		const stage = document.querySelector(".rv-print-stage");
		stage.scrollTop = stage.scrollHeight / 2;
	});
	await page.waitForTimeout(600);
	await settle(page);
	const mid = await page.evaluate(() => ({ filled: window.rv_page.pages.filled.size, pos: document.querySelector(".rv-print-pos").textContent }));
	expect(mid.filled).toBeLessThan(40);
	expect(mid.pos).not.toContain("الصفحة 1 من");
	await page.click('.rv-views [data-mode="grid"]');
	await page.waitForFunction(() => window.rv_page.state.mode === "grid" && window.rv_page.grid.rt);
	expect(await page.evaluate(() => window.rv_page.pages.pages.length)).toBe(0);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("pages: the standard template's five print styles, in a list of their own; a style is kept for the user", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=tb&lang=ar&rv=${PAGES}${pages_settings({ orientation: "landscape", signatures: true })}`);
	await settle(page);
	await open_sections(page);
	// the template is a Link field (Frappe's search with the user's permissions); empty is the standard one
	const tpl = page.locator('[data-link="template"] input');
	expect(await tpl.inputValue()).toBe("");
	expect(await tpl.getAttribute("placeholder")).toBeTruthy();
	const options = await page.$$eval('select[data-set="style"] option', (os) => os.map((o) => o.value));
	expect(options).toEqual(["classic", "modern", "ledger", "compact", "minimal"]);
	const rows = {};
	for (const look of ["classic", "modern", "ledger", "compact", "minimal"]) {
		await page.selectOption('select[data-set="style"]', look);
		await settle(page);
		const st = await page.evaluate(() => ({
			cls: document.querySelector('.rv-page[data-page="0"]').className,
			row_h: window.rv_page.pages.measure.row_h,
			pages: window.rv_page.pages.pages.length,
		}));
		expect(st.cls).toContain(`ps-${look}`);
		rows[look] = st.row_h;
		await shot3(page, `pages-tb-template-${look}-rtl`);
	}
	// the compact look holds more rows on a page
	expect(rows.compact).toBeLessThan(rows.classic);
	const saved = await page.evaluate(async () => {
		await new Promise((r) => setTimeout(r, 900));
		return frappe.model.user_settings.store["Report View:Trial Balance"].pages;
	});
	expect([saved.style, saved.template]).toEqual(["minimal", ""]);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("pages: page setup as in a word processor: four margins typed, letter head and footer on their pages, the number band under or above the footer, rules", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=gl&lang=ar&rv=${PAGES}${pages_settings({ orientation: "portrait" })}`);
	await settle(page);
	await open_sections(page);
	const state = () =>
		page.evaluate(async () => {
			const v = window.rv_page.pages;
			await v.fill_all();
			const pages = [...document.querySelectorAll(".rv-print-sheets .rv-page")];
			const p0 = pages[0];
			const css = (el, prop) => (el ? getComputedStyle(el)[prop] : null);
			const root = document.querySelector(".rv-pages").closest(".rv");
			const foot = p0.querySelector(".rv-page-foot");
			return {
				count: pages.length,
				box: v.box,
				lh: pages.map((p) => Boolean(p.querySelector(".rv-page-lh"))),
				lhf: pages.map((p) => Boolean(p.querySelector(".rv-page-lhf"))),
				foot_order: foot ? [...foot.children].map((c) => c.className.split(" ")[0]) : [],
				align: css(p0.querySelector(".rv-page-lh"), "alignItems"),
				head_var: getComputedStyle(root).getPropertyValue("--pp-head-line").trim(),
				num_var: getComputedStyle(root).getPropertyValue("--pp-num-line").trim(),
				lh_mb: getComputedStyle(root).getPropertyValue("--pp-lh-mb").trim(),
				number: (p0.querySelector(".rv-page-foot-line .rv-pnum") || p0.querySelector(".rv-page-topnum .rv-pnum"))?.textContent.trim(),
				name_beside: Boolean(p0.querySelector(".rv-page-foot-line .nm")),
				top_in_head: Boolean(p0.querySelector(".rv-page-top .rv-page-topnum")),
				pad: p0.style.paddingBlock + " | " + p0.style.paddingInline,
			};
		});
	const before = await state();
	expect(before.count).toBeGreaterThan(1);
	// default: the letter head on the first page, its footer on every page, the number under it
	expect(before.lh).toEqual(before.lh.map((_, i) => i === 0));
	expect(before.lhf.every(Boolean)).toBe(true);
	expect(before.foot_order).toEqual(["rv-page-lhf", "rv-page-foot-line"]);
	// page margins typed on each side: "custom", the body narrows by them
	await type_num(page, 'input[data-box="page_m"][data-side="start"]', 25);
	await type_num(page, 'input[data-box="page_m"][data-side="top"]', 20);
	let st = await state();
	expect(st.box.inner_w).toBeLessThan(before.box.inner_w);
	expect(st.box.pad.top).toBeGreaterThan(before.box.pad.top);
	expect(await page.locator('[data-seg="margins"][data-value="custom"]').getAttribute("aria-pressed")).toBe("true");
	// "same on all sides" takes the top value
	await page.click('[data-box-all="page_m"]');
	await settle(page);
	st = await state();
	expect(st.box.pad.start).toBe(st.box.pad.top);
	// letter head margins and on every page; the footer on the last page only
	await type_num(page, 'input[data-box="lh_m"][data-side="bottom"]', 8);
	expect((await state()).lh_mb).toBe("0mm 8mm");
	await page.click('[data-seg="lh_pages"][data-value="all"]');
	await settle(page);
	await page.click('[data-seg="foot_pages"][data-value="last"]');
	await settle(page);
	st = await state();
	expect(st.lh.every(Boolean)).toBe(true);
	expect(st.lhf).toEqual(st.lhf.map((_, i) => i === st.count - 1));
	// as in Word: all but the first page
	await page.click('[data-seg="lh_pages"][data-value="rest"]');
	await settle(page);
	await page.click('[data-seg="foot_pages"][data-value="rest"]');
	await settle(page);
	st = await state();
	expect(st.lh).toEqual(st.lh.map((_, i) => i > 0));
	expect(st.lhf).toEqual(st.lhf.map((_, i) => i > 0));
	await page.click('[data-seg="foot_pages"][data-value="all"]');
	await settle(page);
	// the number band stays under the footer (no choice); a rule of its own when asked; a
	// dashed rule under the letter head
	expect(await page.locator('[data-seg="number_order"]').count()).toBe(0);
	expect((await state()).foot_order).toEqual(["rv-page-lhf", "rv-page-foot-line"]);
	await type_num(page, 'input[data-num="num_line_w"]', 0.6);
	await type_num(page, 'input[data-num="head_line_w"]', 2);
	await page.selectOption('select[data-set="head_line_s"]', "dashed");
	await settle(page);
	await page.locator('input[data-color="num_line_c"]').evaluate((el) => {
		el.value = "#2d5c93";
		el.dispatchEvent(new Event("change", { bubbles: true }));
	});
	await settle(page);
	st = await state();
	expect(st.head_var).toBe("2px dashed #D9DFDB");
	expect(st.num_var).toBe("0.6px solid #2d5c93");
	// numbering from 5, "— n —", without the report's name
	await type_num(page, 'input[data-num="number_start"]', 5);
	await page.selectOption('select[data-set="number_format"]', "dash");
	await settle(page);
	await page.click('[data-sw="number_caption"]');
	await settle(page);
	st = await state();
	expect(st.number).toBe("— 5 —");
	expect(st.name_beside).toBe(false);
	// at the top, in the page head
	await page.selectOption('select[data-set="number_pos"]', "top-start");
	await settle(page);
	expect((await state()).top_in_head).toBe(true);
	await shot3(page, "pages-gl-page-setup-rtl");
	expect(problems, "console errors/warnings").toEqual([]);
});

test("pages: a watermark, text or image, on every page or the first, light and turned; it follows its settings", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=gl&lang=ar&rv=${PAGES}${pages_settings({ orientation: "portrait" })}`);
	await settle(page);
	await open_sections(page);
	const marks = () =>
		page.evaluate(async () => {
			await window.rv_page.pages.fill_all();
			return [...document.querySelectorAll(".rv-print-sheets .rv-page")].map((p) => {
				const wm = p.querySelector(".rv-page-wm");
				const el = wm?.firstElementChild;
				return wm ? { tag: el.tagName, text: el.textContent, opacity: getComputedStyle(el).opacity, transform: getComputedStyle(el).transform } : null;
			});
		});
	expect((await marks()).every((m) => m === null)).toBe(true);
	await page.click('[data-seg="wm_type"][data-value="text"]');
	await settle(page);
	await page.locator('input[data-text="wm_text"]').fill("سري");
	await page.waitForTimeout(500);
	await settle(page);
	let m = await marks();
	expect(m.every((x) => x && x.tag === "SPAN" && x.text === "سري")).toBe(true);
	expect(Number(m[0].opacity)).toBeCloseTo(0.1, 2);
	expect(m[0].transform).not.toBe("none");
	await type_num(page, 'input[data-num="wm_opacity"]', 25);
	await page.click('[data-seg="wm_pages"][data-value="first"]');
	await settle(page);
	m = await marks();
	expect(Number(m[0].opacity)).toBeCloseTo(0.25, 2);
	expect(m.slice(1).every((x) => x === null)).toBe(true);
	// all but the first page
	await page.click('[data-seg="wm_pages"][data-value="rest"]');
	await settle(page);
	m = await marks();
	expect(m[0]).toBeNull();
	expect(m.slice(1).every((x) => x && x.text === "سري")).toBe(true);
	await page.click('[data-seg="wm_pages"][data-value="first"]');
	await settle(page);
	await shot3(page, "pages-gl-watermark-text-rtl");
	// an image (an address of the site's files)
	await page.click('[data-seg="wm_type"][data-value="image"]');
	await settle(page);
	await page.locator('input[data-text="wm_image"]').fill("/assets/frappe/images/frappe-framework-logo.svg");
	await page.waitForTimeout(500);
	await settle(page);
	m = await marks();
	expect(m[0].tag).toBe("IMG");
	// an address that is not one stays out
	await page.locator('input[data-text="wm_image"]').fill("javascript:alert(1)");
	await page.waitForTimeout(500);
	const saved = await page.evaluate(() => window.rv_page.pages.settings.wm_image);
	expect(saved).toBe("/assets/frappe/images/frappe-framework-logo.svg");
	expect(problems.filter((x) => !/frappe-framework-logo/.test(x)), "console errors/warnings").toEqual([]);
});

test("pages: a print heading rendered with the filters, on its pages, instead of the title or above it; a print signature of the site; the site's standard settings", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=gl&lang=ar&rv=${PAGES}${pages_settings({ orientation: "portrait" })}`);
	await settle(page);
	await open_sections(page);
	const heads = () =>
		page.evaluate(async () => {
			await window.rv_page.pages.fill_all();
			return [...document.querySelectorAll(".rv-print-sheets .rv-page")].map((p) => ({
				heading: p.querySelector(".rv-page-heading .ht")?.textContent || null,
				title: Boolean(p.querySelector(".rv-page-hd")),
				cont: Boolean(p.querySelector(".rv-page-cont")),
			}));
		});
	expect((await heads()).every((h) => h.heading === null)).toBe(true);
	await pick_link(page, "heading", "Statement heading");
	await settle(page);
	let h = await heads();
	expect(h.length).toBeGreaterThan(1);
	// the server's rendering, with the company of the filters
	expect(h[0].heading).toMatch(/^Statement of /);
	expect(h[0].title).toBe(true);
	expect(h.slice(1).every((x) => x.heading === null && x.cont)).toBe(true);
	// every page, instead of the report's title
	await page.click('[data-seg="heading_pages"][data-value="all"]');
	await settle(page);
	await page.click('[data-sw="heading_replace"]');
	await settle(page);
	h = await heads();
	expect(h.every((x) => x.heading && !x.title && !x.cont)).toBe(true);
	// alignment, size and the rule under it are variables of the pages
	await page.click('[data-seg="heading_align"][data-value="start"]');
	await type_num(page, 'input[data-num="heading_size"]', 18);
	await settle(page);
	const style = await page.evaluate(() => {
		const ht = document.querySelector('.rv-page[data-page="0"] .rv-page-heading');
		return { align: getComputedStyle(ht).textAlign, size: getComputedStyle(ht.querySelector(".ht")).fontSize };
	});
	expect(["start", "right"]).toContain(style.align);
	expect(parseFloat(style.size)).toBeCloseTo(24, 0);
	// a print signature replaces the standard boxes on the last page
	await page.click('[data-sw="signatures"]');
	await settle(page);
	await pick_link(page, "signature", "Finance approvals");
	await settle(page);
	const sig = await page.evaluate(async () => {
		await window.rv_page.pages.fill_all();
		const pages = [...document.querySelectorAll(".rv-print-sheets .rv-page")];
		const last = pages[pages.length - 1];
		const t = last.querySelector(".rv-signature .rv-sig-t");
		return {
			boxes: last.querySelectorAll(".rv-signature .rv-sig").length,
			standard: document.querySelectorAll(".rv-page .rv-page-sign").length,
			elsewhere: pages.slice(0, -1).some((p) => p.querySelector(".rv-signature")),
			color: t && getComputedStyle(t).color,
			// the CSS of the signature reaches the signature only
			title_color: getComputedStyle(document.querySelector(".rv-page .rv-page-heading .ht")).color,
		};
	});
	expect(sig.boxes).toBe(2);
	expect(sig.standard).toBe(0);
	expect(sig.elsewhere).toBe(false);
	expect(sig.color).toBe("rgb(138, 45, 59)");
	expect(sig.title_color).not.toBe("rgb(138, 45, 59)");
	await shot3(page, "pages-gl-heading-signature-rtl");
	// on every page: in the foot of each page, above the footer; the pages make room for it
	const before = (await pages_state(page)).count;
	await page.click('[data-seg="sig_pages"][data-value="all"]');
	await settle(page);
	const every = await page.evaluate(async () => {
		await window.rv_page.pages.fill_all();
		return [...document.querySelectorAll(".rv-print-sheets .rv-page")].map((p) => {
			const sig = p.querySelector(".rv-page-foot > .rv-page-sig");
			const foot = p.querySelector(".rv-page-foot").getBoundingClientRect();
			const page = p.getBoundingClientRect();
			return { sig: Boolean(sig), inside: foot.bottom <= page.bottom + 1, tail: Boolean(p.querySelector(".rv-page-body > .rv-page-sig")) };
		});
	});
	expect(every.every((x) => x.sig && x.inside && !x.tail)).toBe(true);
	expect(every.length).toBeGreaterThanOrEqual(before);
	// the last page only, at its bottom
	await page.click('[data-seg="sig_pages"][data-value="last"]');
	await settle(page);
	await page.click('[data-seg="sig_pos"][data-value="bottom"]');
	await settle(page);
	const bottom = await page.evaluate(async () => {
		await window.rv_page.pages.fill_all();
		const pages = [...document.querySelectorAll(".rv-print-sheets .rv-page")];
		const last = pages[pages.length - 1];
		const sig = last.querySelector(".rv-page-body > .rv-page-sig.at-bottom");
		const body = last.querySelector(".rv-page-body").getBoundingClientRect();
		return { sig: Boolean(sig), gap: sig ? body.bottom - sig.getBoundingClientRect().bottom : null, others: pages.slice(0, -1).some((p) => p.querySelector(".rv-page-sig")) };
	});
	expect(bottom.sig).toBe(true);
	expect(bottom.gap).toBeLessThan(2);
	expect(bottom.others).toBe(false);
	const saved = await page.evaluate(() => {
		const s = window.rv_page.pages.settings;
		return [s.heading, s.heading_pages, s.heading_replace, s.signature, s.sig_pages, s.sig_pos];
	});
	expect(saved).toEqual(["Statement heading", "all", true, "Finance approvals", "last", "bottom"]);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("pages: the site's standard print settings are where a new user starts and where Reset returns", async ({ page }) => {
	const problems = watch_console(page);
	await page.addInitScript(() => {
		window.RV_PRINT_DEFAULTS = { size: "A3", orientation: "portrait", style: "ledger", heading: "Statement heading", heading_pages: "all", page_numbers: false, number_format: "nonsense" };
	});
	await open(page, `report=tb&lang=en&rv=${PAGES}`);
	await settle(page);
	const st = () => page.evaluate(() => {
		const s = window.rv_page.pages.settings;
		return { size: s.size, orientation: s.orientation, style: s.style, heading: s.heading, heading_pages: s.heading_pages, page_numbers: s.page_numbers, number_format: s.number_format };
	});
	const want = { size: "A3", orientation: "portrait", style: "ledger", heading: "Statement heading", heading_pages: "all", page_numbers: false, number_format: "full" };
	expect(await st()).toEqual(want);
	await page.click('[data-seg="margins"][data-value="wide"]').catch(() => {});
	await page.selectOption('select[data-set="size"]', "A4");
	await settle(page);
	await page.click('.rv-print-hd [data-action="reset"]');
	await settle(page);
	expect(await st()).toEqual(want);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("pages: a long report prints every sheet with its content (far pages are not emptied while printing); the PDF sends only the styles in use", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=gl&lang=ar&rows=2500&rv=${PAGES}${pages_settings({ orientation: "portrait" })}`);
	await settle(page);
	const out = await page.evaluate(async () => {
		const v = window.rv_page.pages;
		const restore = await v.prepare_print();
		// what the stage's observer would do with sheets that left it
		v.trim_filled();
		await new Promise((r) => setTimeout(r, 300));
		const sheets = [...document.querySelectorAll("body > .rv-print-root .rv-page")];
		const empty = sheets.filter((s) => s.querySelector(".rv-page-ph") || !s.querySelector(".rv-pt tbody tr")).length;
		const html = await v.print_document(v.print_root);
		restore();
		return { pages: sheets.length, empty, html_kb: Math.round(html.length / 1024), css_kb: Math.round((html.match(/<head>[\s\S]*?<\/head>/) || [""])[0].length / 1024), keeps_page_rules: /\.rv-page\b/.test(html) };
	});
	expect(out.pages).toBeGreaterThan(16);
	expect(out.empty).toBe(0);
	expect(out.keeps_page_rules).toBe(true);
	expect(out.css_kb).toBeLessThan(400);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("pages: on a phone the pages take the screen and the settings open as a sheet from the bottom bar", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=tb&lang=ar&rv=${PAGES}`);
	await settle(page);
	// the harness opens at desktop size: the phone's width after
	await page.setViewportSize({ width: 390, height: 844 });
	await page.waitForTimeout(300);
	const layout = () =>
		page.evaluate(() => {
			const r = (sel) => document.querySelector(sel).getBoundingClientRect();
			const side = r(".rv-print-side");
			return {
				open: document.querySelector(".rv-pages").classList.contains("sheet-open"),
				side_top: Math.round(side.top),
				side_bottom: Math.round(side.bottom),
				bd_shown: getComputedStyle(document.querySelector(".rv-print-side .bd")).display !== "none",
				stage_w: Math.round(r(".rv-print-stage").width),
				pages_w: Math.round(r(".rv-pages").width),
				hscroll: document.documentElement.scrollWidth > innerWidth,
			};
		});
	let st = await layout();
	// closed: only the bar at the bottom, the stage as wide as the screen
	expect(st.open).toBe(false);
	expect(st.bd_shown).toBe(false);
	expect(st.side_bottom).toBe(844);
	expect(st.side_top).toBeGreaterThan(700);
	expect(st.stage_w).toBeGreaterThanOrEqual(st.pages_w - 1);
	expect(st.hscroll).toBe(false);
	await page.click('[data-action="sheet"]');
	st = await layout();
	expect(st.open).toBe(true);
	expect(st.bd_shown).toBe(true);
	expect(st.side_top).toBeLessThan(500);
	expect(await page.getAttribute('[data-action="sheet"]', "aria-expanded")).toBe("true");
	// a tap outside the sheet closes it; Escape too
	await page.mouse.click(30, 30);
	expect((await layout()).open).toBe(false);
	await page.click('[data-action="sheet"]');
	await page.keyboard.press("Escape");
	expect((await layout()).open).toBe(false);
	expect(problems).toEqual([]);
});

test("pages: the mouse wheel over a focused number field scrolls the panel, the value stays", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=tb&lang=ar&rv=${PAGES}`);
	await settle(page);
	await open_sections(page);
	const field = page.locator('input[data-box="page_m"][data-side="top"]');
	await field.scrollIntoViewIfNeeded();
	const before = await field.inputValue();
	await field.click();
	const box = await field.boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	expect(await field.evaluate((el) => el === document.activeElement)).toBe(true);
	await page.mouse.wheel(0, -120);
	await page.mouse.wheel(0, 240);
	await page.waitForTimeout(200);
	// the field let go of the focus at the first turn: a desktop browser steps only a
	// focused number field (headless Chromium does not step it at all)
	expect(await field.evaluate((el) => el === document.activeElement)).toBe(false);
	expect(await field.inputValue()).toBe(before);
	expect(await page.evaluate(() => window.rv_page.pages.settings.page_m.top)).toBe(Number(before));
	expect(problems).toEqual([]);
});

test("side panel: ticking a column keeps the columns list and the panel where they were", async ({ page }) => {
	const problems = watch_console(page);
	await page.setViewportSize({ width: 1280, height: 640 });
	await open(page, "report=gl&lang=ar");
	await settle(page);
	await page.locator('[data-side="columns"]').click();
	const where = () => page.evaluate(() => ({ list: document.querySelector(".rv-collist").scrollTop, bd: document.querySelector(".rv-panel-bd").scrollTop }));
	// down the list and the panel, then untick and tick the last column
	await page.evaluate(() => {
		const list = document.querySelector(".rv-collist");
		list.scrollTop = list.scrollHeight;
		const bd = document.querySelector(".rv-panel-bd");
		bd.scrollTop = 60;
	});
	const before = await where();
	expect(before.list).toBeGreaterThan(0);
	const last = page.locator(".rv-collist [data-col]:not([disabled])").last();
	const key = await last.getAttribute("data-col");
	await last.click();
	await settle(page);
	expect(await where()).toEqual(before);
	await page.locator(`.rv-collist [data-col="${key}"]`).click();
	await settle(page);
	expect(await where()).toEqual(before);
	expect(await page.evaluate(() => document.activeElement?.dataset?.col)).toBe(key);
	expect(problems).toEqual([]);
});
