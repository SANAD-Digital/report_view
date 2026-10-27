// @ts-check
// The charts dashboard (phase 5d): cards with the grid's numbers, editing, slicers and the cross-filter, lifecycle.
// Fails on any console error or warning (helpers.js watch_console).
const path = require("node:path");
const fs = require("node:fs");
const { test, expect } = require("@playwright/test");
const {
	rv,
	watch_console,
	open,
	shown,
	CHARTS_OUT,
	dash_rv,
	cards,
	to_charts,
	load_all,
	to_grid,
	labels_outside,
	DASH_SHOTS,
	grid_by,
	same_card,
	as_grid_filters,
	STEP_MS,
	step,
	shot_dash,
	bar_point,
} = require("./helpers.js");


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


test("dashboard: the numbers of every card are the grid's for the same filters (tb)", async ({ page }) => {
	test.setTimeout(90_000);
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
	expect(problems, "console errors/warnings").toEqual([]);
});


// receivables and the general ledger: every card by its dimension; the measures side by side = the grand total
for (const report of ["ar", "gl"]) {
	test(`dashboard: the numbers of every card are the grid's for the same filters (${report})`, async ({ page }) => {
		test.setTimeout(90_000);
		const problems = watch_console(page);
		await open(page, `report=${report}&lang=en`, { height: 1400 });
		await to_charts(page);
		await load_all(page);
		const list = await cards(page);
		expect(list.length).toBeGreaterThan(0);
		for (const c of list) {
			if (c.route === "totals") {
				const totals = await page.evaluate(() => window.rv_page.debug_totals().totals);
				c.series.forEach((k) => expect(Math.abs(c.total[k].value - (totals[k] ?? 0)), `${report} ${c.id} ${k}`).toBeLessThan(0.005));
				continue;
			}
			same_card(c, await grid_by(page, c.x, c.series), `${report} ${c.id}`);
		}
		expect(problems, "console errors/warnings").toEqual([]);
	});
}


test("dashboard: add a card and edit it: type, dimension, measures, Top N, sort and title", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=gl&lang=ar", { height: 1400 });
	await to_charts(page);
	const ids = async () => (await cards(page)).map((c) => c.id);
	expect(await ids()).toEqual(["accounts", "vouchers", "dates"]);
	// add: a new card opens its editor
	await page.locator('[data-action="add-card"]').click();
	await page.waitForSelector(".rv-ced-pop", { timeout: STEP_MS });
	expect((await ids()).length).toBe(4);
	await shot_dash(page, "dashboard-gl-editor-rtl");
	// edit: type, dimension, measures, Top N, sort, title
	const id = (await ids())[3];
	await page.locator('.rv-ced-pop .rv-ctype[data-type="donut"]').click();
	await step(page, (id) => window.rv_page.state.charts?.cards.find((c) => c.id === id)?.type === "donut", id);
	await page.selectOption('.rv-ced-pop [data-f="x"]', "party");
	await step(page, (id) => window.rv_page.state.charts.cards.find((c) => c.id === id).x === "party", id);
	await page.locator('.rv-ced-pop .rv-chart-measures input[data-key="credit"]').check();
	await step(page, (id) => window.rv_page.state.charts.cards.find((c) => c.id === id).series.includes("credit"), id);
	await page.locator('.rv-ced-pop [data-top="5"]').click();
	await step(page, (id) => window.rv_page.state.charts.cards.find((c) => c.id === id).top === 5, id);
	await page.fill(".rv-ced-pop .rv-ced-title", "حسب الطرف");
	await page.press(".rv-ced-pop .rv-ced-title", "Enter");
	await step(page, (id) => window.rv_page.state.charts.cards.find((c) => c.id === id).title === "حسب الطرف", id);
	await page.keyboard.press("Escape");
	await step(
		page,
		(id) => {
			const c = window.rv_page.charts.debug_cards().find((x) => x.id === id);
			return c.type === "donut" && c.x === "party" && c.loaded;
		},
		id
	);
	// the card is drawn again with its title (a draw follows the last change)
	await expect(page.locator(`.rv-dcard[data-card="${id}"] h3`)).toHaveText("حسب الطرف", { timeout: STEP_MS });
	// a donut with more than one measure says it shows the first one
	await expect(page.locator(`.rv-dcard[data-card="${id}"] .rv-chart-note`)).toBeVisible();
	// the edited card is in the user's settings once the burst of changes is written
	await page.evaluate(() => window.rv_page.flush_settings());
	const saved = await page.evaluate((id) => window.rv_test.saved_settings()?.charts?.cards.find((c) => c.id === id), id);
	expect(saved).toMatchObject({ type: "donut", x: "party", top: 5, title: "حسب الطرف" });
	expect(problems, "console errors/warnings").toEqual([]);
});


test("dashboard: full width, duplicate and remove a card; kept in the URL and the user's settings; reset", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=gl&lang=ar", { height: 1400 });
	await to_charts(page);
	const ids = async () => (await cards(page)).map((c) => c.id);
	expect(await ids()).toEqual(["accounts", "vouchers", "dates"]);
	// card menu: full width, duplicate, remove
	const menu = async (card, item) => {
		await page.locator(`.rv-dcard[data-card="${card}"] .rv-dcard-menu`).click();
		await page.locator(`.rv-pop [data-item="${item}"]`).click();
	};
	await menu("accounts", "size");
	await step(page, () => document.querySelector('.rv-dcard[data-card="accounts"]').classList.contains("wide"));
	await menu("accounts", "duplicate");
	await step(page, () => window.rv_page.charts.debug_cards().length === 4);
	expect((await ids())[1]).not.toBe("accounts");
	await menu("vouchers", "remove");
	await step(page, () => !window.rv_page.charts.debug_cards().some((c) => c.id === "vouchers"));
	// the dashboard is in the URL (rv) and in the user's settings (no cross-filter there)
	await step(page, () => /[?&]rv=/.test(window.location.search));
	await page.evaluate(() => window.rv_page.flush_settings());
	const saved = await page.evaluate(() => window.rv_test.saved_settings()?.charts);
	expect(saved.cards.length).toBe(3);
	expect(saved.cross).toBe(null);
	// a link with this dashboard opens it
	const charts = await page.evaluate(() => window.rv_page.state.charts);
	await open(page, `report=gl&lang=ar&rv=${dash_rv(charts)}`);
	await to_charts(page);
	expect((await ids()).length).toBe(3);
	expect((await ids()).includes("vouchers")).toBe(false);
	// back to the report's default
	await page.locator('[data-action="dash-menu"]').click();
	await page.locator('.rv-pop [data-item="reset"]').click();
	await step(page, () => window.rv_page.state.charts === null);
	await step(page, () => window.rv_page.charts.debug_cards().map((c) => c.id).join() === "accounts,vouchers,dates");
	expect(problems, "console errors/warnings").toEqual([]);
});


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
	// a run in the Charts view opens no grid view: only the tables stay until the grid is shown again
	expect(await kinds()).toBe("table,table");
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
