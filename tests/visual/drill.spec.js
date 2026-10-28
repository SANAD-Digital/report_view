// @ts-check
// Configured drill (phase 5d): «Drill to General Ledger» of a Trial Balance row (the shipped rule
// of report_view/defaults/trial_balance.json, passed as get_meta passes it) from the context menu
// and from the row details footer; the target runs through the same api.run with the filters
// the rule maps (the company and the period of the page, the row's account) and is drawn as a
// compact Report View grid in a drawer; closing it deletes its views and tables. A refusal of
// the server (another company) is shown, nothing is drawn instead. The drill turned off in the
// settings offers nothing. Arabic and English, light and dark.
const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { watch_console, open, settle } = require("./helpers.js");

const OUT = process.env.RV_RANGE_SHOTS || path.resolve(__dirname, "../../test-results/screens/range");
fs.mkdirSync(OUT, { recursive: true });
const TB = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../report_view/defaults/trial_balance.json"), "utf8"));
const rvs = (o) => `&rvs=${encodeURIComponent(JSON.stringify(o))}`;
const DRILL = rvs({ drilldowns: TB.drilldowns });
const ACCOUNT = "1110 - نقد - SA";

const row_y = (page, account) =>
	page.evaluate((a) => {
		const row = window.rv_page.report.rows.find((r) => r.account === a);
		return window.rv_page.grid.locate(`r:${row.__rid}`);
	}, account);

async function right_click(page, y, key) {
	await page.evaluate(([y, key]) => window.rv_page.grid.reveal(y, window.rv_page.grid.range_keys().indexOf(key)), [y, key]);
	await settle(page);
	const p = await page.evaluate(
		([y, key]) => {
			const g = window.rv_page.grid;
			const c = g.range_keys().indexOf(key);
			for (const tr of g.rt.querySelectorAll("tbody tr:not(.stale)")) {
				for (const cell of tr.children) {
					const at = g.cell_of(cell);
					if (at && at.y === y && at.c === c) {
						const b = cell.getBoundingClientRect();
						return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
					}
				}
			}
			return null;
		},
		[y, key]
	);
	expect(p).not.toBeNull();
	await page.mouse.click(p.x, p.y, { button: "right" });
	await expect(page.locator(".rv-ctx")).toBeVisible();
}

const drill_ready = (page) => page.waitForFunction(() => ["ready", "error", "empty"].includes(document.querySelector(".rv-drill")?.dataset.state), null, { timeout: 30000 });

for (const theme of ["light", "dark"]) {
	for (const lang of ["ar", "en"]) {
		test(`context menu → Drill to General Ledger (${lang}, ${theme}): the account and the period, a compact grid; closed, nothing left`, async ({ page }) => {
			const problems = watch_console(page);
			await open(page, `report=tb&lang=${lang}&desk=${theme}${DRILL}`);
			const handles = () => page.evaluate(() => window.rv_page.debug_handles().length);
			const before = await handles();
			await right_click(page, await row_y(page, ACCOUNT), "debit");
			const item = page.locator('.rv-ctx [data-item="drill"]');
			await expect(item).toBeVisible();
			await item.click();
			await drill_ready(page);
			const drawer = page.locator(".rv-drill");
			await expect(drawer).toHaveAttribute("data-state", "ready");
			const calls = await page.evaluate(() => window.RV_DRILL_CALLS);
			const run = calls.find((c) => c.method === "report_view.api.run");
			expect(run.args.report_name).toBe("General Ledger");
			const filters = typeof run.args.filters === "string" ? JSON.parse(run.args.filters) : run.args.filters;
			expect(filters).toEqual({
				company: "SND Accounting",
				from_date: "2026-01-01",
				to_date: "2026-12-31",
				account: [ACCOUNT],
				categorize_by: "Categorize by Voucher (Consolidated)",
			});
			expect(calls.map((c) => c.method)).toEqual(["report_view.api.get_meta", "report_view.api.run"]);
			await expect(drawer.locator("regular-table tbody tr:not(.stale)").first()).toBeVisible();
			expect(await drawer.locator(".rv-drill-grid.compact").count()).toBe(1);
			await expect(drawer.locator(".rv-rt-total")).toBeVisible();
			expect(await handles()).toBeGreaterThan(before);
			await expect(drawer.locator('[data-act="open-report"]')).toHaveAttribute("href", /\/desk\/report-view\/General%20Ledger\?company=SND\+Accounting/);
			await page.waitForTimeout(300);
			await page.screenshot({ path: `${OUT}/drill-tb-gl-${lang}-${theme}.png` });
			const box = await drawer.boundingBox();
			const vw = page.viewportSize()?.width || 0;
			if (lang === "ar") expect(Math.round(box?.x || 0)).toBe(0);
			else expect(Math.round((box?.x || 0) + (box?.width || 0))).toBe(vw);
			await page.keyboard.press("Escape");
			await expect(drawer).toHaveCount(0);
			await page.waitForFunction((n) => window.rv_page.debug_handles().length === n, before);
			expect(problems).toEqual([]);
		});
	}
}

test("row details footer offers the drill of its row", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=tb&lang=en${DRILL}`);
	const y = await row_y(page, ACCOUNT);
	await page.evaluate((y) => window.rv_page.grid.reveal(y, 0), y);
	await settle(page);
	await page.evaluate((y) => {
		const g = window.rv_page.grid;
		for (const tr of g.rt.querySelectorAll("tbody tr:not(.stale)")) if (g.rt.getMeta(tr.firstElementChild)?.y === y) tr.querySelector(".rv-rd-btn").click();
	}, y);
	const panel = page.locator(".rv-rd:not(.rv-drill)");
	await expect(panel).toBeVisible();
	const verb = panel.locator(".rv-rd-actions [data-extra]");
	await expect(verb).toHaveText("Drill to General Ledger");
	await verb.click();
	await drill_ready(page);
	await expect(page.locator(".rv-drill")).toHaveAttribute("data-state", "ready");
	await page.screenshot({ path: `${OUT}/drill-from-row-details-en.png` });
	await page.keyboard.press("Escape");
	await expect(page.locator(".rv-drill")).toHaveCount(0);
	await expect(panel).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(panel).toHaveCount(0);
	expect(problems).toEqual([]);
});

for (const lang of ["ar", "en"]) {
	test(`the server's refusal is shown: another company (${lang})`, async ({ page }) => {
		const problems = watch_console(page);
		await open(page, `report=tb&lang=${lang}${DRILL}`);
		const before = await page.evaluate(() => window.rv_page.debug_handles().length);
		// a forged drill: the page's company is one the user may not see
		await page.evaluate((a) => {
			const p = window.rv_page;
			const row = p.report.rows.find((r) => r.account === a);
			p.last_filters = { ...p.last_filters, company: "Forbidden Co" };
			p.open_drill(p.drill_rules[0], row);
		}, ACCOUNT);
		await drill_ready(page);
		const drawer = page.locator(".rv-drill");
		await expect(drawer).toHaveAttribute("data-state", "error");
		await expect(drawer.locator(".rv-rd-state-s")).toContainText("Forbidden Co");
		await expect(drawer.locator("regular-table")).toHaveCount(0);
		await page.screenshot({ path: `${OUT}/drill-refused-${lang}.png` });
		await page.keyboard.press("Escape");
		await expect(drawer).toHaveCount(0);
		expect(await page.evaluate(() => window.rv_page.debug_handles().length)).toBe(before);
		expect(problems).toEqual([]);
	});
}

test("drill turned off in the settings: no drill in the menu or the row details", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=tb&lang=en${rvs({ drilldowns: TB.drilldowns, features: { drill: false } })}`);
	await right_click(page, await row_y(page, ACCOUNT), "debit");
	await expect(page.locator('.rv-ctx [data-item="drill"]')).toHaveCount(0);
	await page.keyboard.press("Escape");
	expect(await page.evaluate(() => window.rv_page.drill_actions(window.rv_page.report.rows.find((r) => r.account === "1110 - نقد - SA")).length)).toBe(0);
	expect(problems).toEqual([]);
});
