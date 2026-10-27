// @ts-check
// Shared helpers of the visual specs (tests/visual/*.spec.js): opening the harness, the
// console watch, screenshots, geometry probes, view-state builders. Each spec file runs in
// its own worker; nothing here keeps state between tests.
const fs = require("node:fs");
const path = require("node:path");
const { expect } = require("@playwright/test");


// <screens>: test-results/screens/ (git-ignored) on every run; RV_SHOTS=docs writes them to
// docs/progress/screens/ instead, at the end of a phase (docs/progress/_template.md), so a run
// of the tests does not rewrite the tracked pictures.
const SHOTS_ROOT = path.resolve(__dirname, process.env.RV_SHOTS === "docs" ? "../../docs/progress/screens" : "../../test-results/screens");

const shots_dir = (name) => {
	const dir = path.join(SHOTS_ROOT, name);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
};

const OUT = shots_dir("phase-5a1");


// The documented exceptions to "no console warnings" (ADR-012), both from Perspective, not
// from Report View: its client prints the first wherever window.chrome is missing (headless
// shell, Firefox, Safari); Firefox prints the second when it compiles Perspective's WASM
// (built with the legacy exception-handling instructions).
const ALLOWED = [/Unknown browser detected/, /WebAssembly exception handling 'try' instruction is deprecated/];


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


// The wheel over the table until it stops moving. Chromium jumps the whole delta at once;
// Firefox and WebKit scroll smoothly and cap what one wheel event moves.
async function wheel_to_end(page, dx, dy, tries = 30) {
	await page.locator("regular-table").hover();
	let last = null;
	for (let i = 0; i < tries; i++) {
		await page.mouse.wheel(dx, dy);
		await page.waitForTimeout(150);
		const pos = await page.evaluate(() => {
			const rt = document.querySelector("regular-table");
			return `${rt.scrollLeft},${rt.scrollTop}`;
		});
		if (pos === last) return;
		last = pos;
	}
}

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


// ---------------------------------------------------------------------------------------
// Design parity, wave 1 (docs/progress/phase-5a2-wave1.md): every item of the main screen
// next to its reference capture in reference/design/screens/, light and dark, RTL and LTR,
// at the design's 1440x1100. Saved to <screens>/phase-5a2/.
const OUT2 = shots_dir("phase-5a2");

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


// ---------------------------------------------------------------- Charts dashboard (phase 5d)
// Screenshots in <screens>/phase-5a2/dashboard-*.png, compared with
// reference/design/screens/charts.png. The page opens on the table, then the Charts tab.
const CHARTS_OUT = shots_dir("phase-5a2");

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
				// the text with its box and the plot's (left, top, right, bottom): a failure says where
				const at = (b) => [b.left, b.top, b.right, b.bottom].map(Math.round).join(",");
				if (!(r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1)) out.push(`${t.textContent} [${at(r)}] in [${at(box)}] ${getComputedStyle(t).fontFamily}`);
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


// One step of a dashboard test: its own time limit, so a slow step names itself under load.
const STEP_MS = 15_000;

const step = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: STEP_MS });


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


// ------------------------------------------------------------------ Pivot (phase 5b tasks 2, 3, 5)
// Screenshots to <screens>/phase-5a2/pivot-*.png (reference:
// reference/design/screens/pivot.png, pivot_drill.png, sidecols_pivot.png).
const PIVOT_OUT = shots_dir("phase-5a2");

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


const pivot_data = (page) =>
	page.evaluate(async () => {
		const o = window.rv_page.pivot_opened;
		const t = await o.totals.to_columns();
		const p = o.view ? await o.view.to_columns() : {};
		return { paths: t.__ROW_PATH__, t, p, total: o.total, column_paths: o.column_paths };
	});


const close_to = (a, b, label) => expect(Math.abs((a ?? 0) - (b ?? 0)), `${label}: ${a} != ${b}`).toBeLessThan(0.005);


// ------------------------------------------------------------------------------------------
// Pages view (ADR-014; docs/progress/pages-print.md): the report as printed pages next to
// the table, compared with reference/design/screens/print.png. Saved to
// <screens>/pages/. The harness answers the print options, a letter head and
// the translations; the language re-run answers the same fixture.
const OUT3 = shots_dir("pages");

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


// ---------------------------------------------------------------- print engine (prod-hardening)
// A Jinja format of 300 rows, as the server would render it (the harness has no formats).
const fake_format = (page) =>
	page.evaluate(async () => {
		const v = window.rv_page.pages;
		const css = ".fmt-t{width:100%;border-collapse:collapse}.fmt-t td,.fmt-t th{border:1px solid var(--pp-line);padding:3px 7px}.fmt-mark{letter-spacing:3px}";
		const rows = Array.from({ length: 300 }, (_, i) => `<tr><td class="fmt-mark">${i + 1}</td><td>Item ${i}</td><td>${(i * 13.7).toFixed(2)}</td></tr>`).join("");
		v.options.print_formats = ["Big"];
		v.options.print_format_types = { Big: "Jinja" };
		v.host.pages_format = async () => ({ type: "Jinja", html: `<div class="print-format"><h2>Invoice</h2><table class="fmt-t"><thead><tr><th>#</th><th>Item</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table></div>`, css });
		v.update({ template: "Big" });
		await v.ready;
		await window.rv_settle();
	});


// ---------------------------------------------------------------- print presets (ADR-020)
// The shots go to RV_SHOTS when it names a folder (a review), else beside the other pages shots.
const PRESET_OUT = process.env.RV_SHOTS && process.env.RV_SHOTS !== "docs" ? process.env.RV_SHOTS : OUT3;

fs.mkdirSync(PRESET_OUT, { recursive: true });

const preset_shot = (page, name, full = false) => page.screenshot({ path: path.join(PRESET_OUT, `${name}.png`), fullPage: full });

const preset_state = (page) =>
	page.evaluate(() => {
		const v = window.rv_page.pages;
		const btn = document.querySelector(".rv-preset-btn");
		return {
			shown: !document.querySelector(".rv-preset").hidden,
			name: btn?.querySelector(".nm").textContent,
			dot: !btn?.querySelector(".dot").hidden,
			menu: Boolean(document.querySelector(".rv-preset-pop")),
			applied: v.presets.applied?.name || null,
			store: JSON.parse(JSON.stringify(window.RV_PRESETS)),
			settings: { size: v.settings.size, orientation: v.settings.orientation, hidden: [...v.settings.hidden], template: v.settings.template },
		};
	});

const open_presets = async (page) => {
	if (!(await preset_state(page)).menu) await page.click(".rv-preset-btn");
	await expect(page.locator(".rv-preset-pop")).toBeVisible();
};

module.exports = {
	SHOTS_ROOT,
	shots_dir,
	OUT,
	ALLOWED,
	rv,
	NO_SUBTOTALS,
	PINNED,
	AR_AMOUNTS,
	SHOTS,
	watch_console,
	open,
	settle,
	wheel_to_end,
	shot,
	probe,
	body,
	shown,
	url_state,
	header,
	width_of,
	drag_handle,
	OUT2,
	shot2,
	VARIANTS,
	DESIGN,
	handles_of,
	TB_HANDLES,
	STATES,
	CHARTS_OUT,
	dash_rv,
	cards,
	cards_ready,
	to_charts,
	load_all,
	to_grid,
	labels_outside,
	KPI_GL,
	DASH_SHOTS,
	grid_by,
	same_card,
	as_grid_filters,
	STEP_MS,
	step,
	shot_dash,
	bar_point,
	PIVOT_OUT,
	pivot_shot,
	PIVOT_DESIGN,
	pivot_handles,
	FIXTURES,
	raw_rows,
	pivot_rv,
	PV_TB_SPLIT,
	PV_AR,
	PV_AR_COUNT,
	PV_GL,
	pivot_shown,
	to_pivot,
	pivot_changed,
	grid_back,
	PIVOT_SHOTS,
	pivot_data,
	close_to,
	OUT3,
	shot3,
	PAGES,
	pages_settings,
	open_sections,
	pick_link,
	type_num,
	pages_state,
	PAGE_SHOTS,
	fake_format,
	PRESET_OUT,
	preset_shot,
	preset_state,
	open_presets,
};
