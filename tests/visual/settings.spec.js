// @ts-check
// What a report shows (Report View Settings, ADR-023): every feature flag that is off hides
// its controls completely, a link that asks for a view that is off opens the default one,
// the chart types limit the editor and the saved cards, and the server's default view is
// the page's. The harness passes the server's settings as get_meta merges them (rvs=<JSON>).
// Fails on any console error or warning (helpers.js watch_console).
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { rv, watch_console, open, settle, shots_dir, to_charts, cards } = require("./helpers.js");

const OUT = shots_dir("settings");
const q = (features, extra = "") => `report=tb&lang=en&rvs=${encodeURIComponent(JSON.stringify({ features }))}${extra}`;

// what each flag hides, as the user would look for it
const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
const UI = {
	tab_pivot: (p) => visible(p, '.rv-views [data-mode="pivot"]'),
	tab_charts: (p) => visible(p, '.rv-views [data-mode="charts"]'),
	tab_pages: (p) => visible(p, '.rv-views [data-mode="pages"]'),
	print: (p) => visible(p, '.rv-headbar [data-action="print"]'),
	excel: (p) => visible(p, '.rv-headbar [data-action="export"]'),
	density: (p) => visible(p, ".rv-headbar .rv-seg"),
	search: (p) => visible(p, ".rv-toolbar .rv-search"),
	group_bar: (p) => visible(p, ".rv-gp .rv-gp-chips"),
	column_groups: (p) => visible(p, '.rv-gp [data-action="column-groups"]'),
	subtotals: (p) => visible(p, ".rv-gp [data-subtotals] input"),
	filter_row: async (p) => (await p.locator("regular-table thead th.rv-hf").count()) > 0,
	set_filter: async (p) => (await p.locator("regular-table thead .rv-ff-set").count()) > 0,
	side_tabs: (p) => visible(p, ".rv-sidetabs"),
	columns_tab: (p) => visible(p, '.rv-sidetabs [data-side="columns"]'),
	filters_tab: (p) => visible(p, '.rv-sidetabs [data-side="filters"]'),
	period: (p) => visible(p, ".rv-criteria-main .rv-period"),
};

async function ui(page) {
	const out = {};
	for (const [k, fn] of Object.entries(UI)) out[k] = await fn(page);
	return out;
}

// the entries of the column menu of the first data column
async function column_menu(page) {
	await page.locator("regular-table thead th.rv-hd .rv-hmenu").nth(1).click();
	const labels = await page.locator(".rv-pop[role=menu] .rv-mi .rv-mi-lbl, .rv-pop .rv-mi").allInnerTexts();
	await page.keyboard.press("Escape");
	return labels.join("|");
}

test("everything on: the report looks as without settings", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=en");
	const all = await ui(page);
	for (const [k, v] of Object.entries(all)) expect(v, k).toBe(true);
	expect(await column_menu(page)).toMatch(/Pin/);
	expect(problems, "console errors/warnings").toEqual([]);
});

// flag -> what disappears with it (and nothing else of the list)
const CASES = [
	["pivot", ["tab_pivot"]],
	["charts", ["tab_charts"]],
	["pages", ["tab_pages", "print"]],
	["excel", ["excel"]],
	["density", ["density"]],
	["quick_search", ["search"]],
	["grouping", ["group_bar"]],
	["column_groups", ["column_groups"]],
	["subtotals", ["subtotals"]],
	["column_filters", ["filter_row", "set_filter"]],
	["set_filters", ["set_filter"]],
	["side_panel", ["side_tabs", "columns_tab", "filters_tab"]],
	["columns_panel", ["columns_tab"]],
	["filters_panel", ["filters_tab"]],
	["period_picker", ["period"]],
];

for (const [flag, gone] of CASES) {
	test(`${flag} off hides ${gone.join(", ")}`, async ({ page }) => {
		const problems = watch_console(page);
		await open(page, q({ [flag]: false }));
		const now = await ui(page);
		for (const [k, v] of Object.entries(now)) expect(v, k).toBe(!gone.includes(k));
		expect(problems, "console errors/warnings").toEqual([]);
	});
}

test("pinning and grouping off: no pin and no Group by in the column menu, nor in the search options", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, q({ pinning: false, grouping: false }));
	const menu = await column_menu(page);
	expect(menu).not.toMatch(/Pin|Group by/);
	expect(menu).toMatch(/Sort ascending/);
	await page.locator(".rv-search input").focus();
	await expect(page.locator(".rv-search-pop")).toBeVisible();
	expect(await page.locator(".rv-search-pop .rv-sdrop-t", { hasText: "Group by" }).count()).toBe(0);
	await page.keyboard.press("Escape");
	// a grouping asked for anyway (a link) is not applied
	await page.evaluate(() => window.rv_page.controls.set_group(["account__root_type"]));
	await settle(page);
	expect(await page.evaluate(() => window.rv_page.state.group.by)).toEqual([]);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("pivot off: the columns panel has no pivot mode, and a link to the pivot opens the table", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, q({ pivot: false }, `&rv=${rv({ mode: "pivot", ui: {} })}`));
	expect(await page.evaluate(() => window.rv_page.state.mode)).toBe("grid");
	expect(await page.evaluate(() => window.rv_page.pivot_opened)).toBeNull();
	await page.locator('.rv-sidetabs [data-side="columns"]').click();
	await expect(page.locator(".rv-panel .rv-collist")).toBeVisible();
	expect(await page.locator('.rv-panel [data-action="pivot-mode"]').isVisible()).toBe(false);
	expect(await page.locator('.rv-panel [data-zone="pivot"]').isVisible()).toBe(false);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("chart types: the editor offers the allowed ones, a saved card of another type is dropped", async ({ page }) => {
	const problems = watch_console(page);
	const dash = rv({ charts: { cards: [{ id: "c1", type: "donut", x: "level_1" }, { id: "c2", type: "bar", x: "level_1" }] } });
	await open(page, q({ chart_types: ["bar", "line"] }, `&rv=${dash}`));
	await to_charts(page);
	expect((await cards(page)).map((c) => c.type)).toEqual(["bar"]);
	await page.evaluate(() => window.rv_page.charts.cards.get("c2").open_editor());
	await expect(page.locator(".rv-ced-types")).toBeVisible();
	expect(await page.locator(".rv-ced-types .rv-ctype").evaluateAll((els) => els.map((e) => e.dataset.type))).toEqual(["bar", "line"]);
	await page.keyboard.press("Escape");
	expect(problems, "console errors/warnings").toEqual([]);
});

test("chart types: the default dashboard takes the nearest allowed type", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, q({ chart_types: ["line", "kpi"] }));
	await to_charts(page);
	const types = (await cards(page)).map((c) => c.type);
	expect(types.length).toBeGreaterThan(0);
	for (const t of types) expect(["line", "kpi"]).toContain(t);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("the server's default view: the mode and the grouping, and no rv in a clean URL", async ({ page }) => {
	const problems = watch_console(page);
	const rvs = { default_view: { group_by: ["account__root_type"], hidden: [], pinned: [] } };
	await open(page, `report=tb&lang=en&rvs=${encodeURIComponent(JSON.stringify(rvs))}`);
	await page.waitForFunction(() => window.rv_page.result?.mode === "group");
	expect(await page.evaluate(() => window.rv_page.state.group.by)).toEqual(["account__root_type"]);
	await page.waitForTimeout(450);
	expect(await page.evaluate(() => new URLSearchParams(window.location.search).get("rv"))).toBeNull();
	expect(problems, "console errors/warnings").toEqual([]);
});

test("screens: every tool on, and a report with most tools off (light, RTL)", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=ar");
	await page.screenshot({ path: path.join(OUT, "settings-all-on-rtl.png") });
	const features = { pivot: false, charts: false, grouping: false, column_filters: false, side_panel: false, density: false, excel: false };
	await open(page, `report=tb&lang=ar&rvs=${encodeURIComponent(JSON.stringify({ features }))}`);
	await page.screenshot({ path: path.join(OUT, "settings-features-off-rtl.png") });
	expect(fs.existsSync(path.join(OUT, "settings-features-off-rtl.png"))).toBe(true);
	expect(problems, "console errors/warnings").toEqual([]);
});
