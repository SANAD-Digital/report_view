// Screenshots of the real page components (tests/visual/harness.html) for the design check.
// Saved to docs/progress/screens/phase-3/. Fails on any console error or warning.
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const OUT = path.resolve(__dirname, "../../docs/progress/screens/phase-3");

const SHOTS = [
	{ name: "tb-tree-light-rtl", query: "report=tb&lang=ar" },
	{ name: "tb-tree-dark-rtl", query: "report=tb&lang=ar&desk=dark" },
	{ name: "tb-tree-light-ltr", query: "report=tb&lang=en" },
	{ name: "tb-tree-compact-rtl", query: "report=tb&lang=ar&density=compact" },
	{ name: "tb-group-root-type-rtl", query: "report=tb&lang=ar&group=account__root_type" },
	{ name: "ar-group-party-rtl", query: "report=ar&lang=ar&group=party" },
	{ name: "tb-tree-390-rtl", query: "report=tb&lang=ar", width: 390, height: 844, full: true },
	{ name: "tb-tree-390-dark-ltr", query: "report=tb&lang=en&pref=dark", width: 390, height: 844, full: true },
];

for (const shot of SHOTS) {
	test(shot.name, async ({ page }) => {
		const problems = [];
		page.on("console", (m) => {
			if (["error", "warning"].includes(m.type())) problems.push(`${m.type()}: ${m.text()}`);
		});
		page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
		await page.setViewportSize({ width: shot.width || 1440, height: shot.height || 1000 });
		await page.goto(`/harness.html?${shot.query}`);
		await page.waitForFunction(() => document.body.dataset.ready || document.body.dataset.error, null, { timeout: 30_000 });
		const error = await page.evaluate(() => document.body.dataset.error || null);
		expect(error, "harness error").toBeNull();
		await page.evaluate(() => document.fonts.ready);
		await page.screenshot({ path: path.join(OUT, `${shot.name}.png`), fullPage: Boolean(shot.full) });
		expect(problems, "console errors/warnings").toEqual([]);
	});
}

test("server bar turns pending after a filter change and does not re-run", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.goto("/harness.html?report=tb&lang=ar");
	await page.waitForFunction(() => document.body.dataset.ready);
	const runs = await page.evaluate(() => window.rv_page.run_token);
	await page.locator('.rv-filter[data-fieldname="show_zero_values"] input[type=checkbox]').check();
	await expect(page.locator(".rv-server")).toHaveClass(/pending/);
	await page.waitForTimeout(500);
	expect(await page.evaluate(() => window.rv_page.run_token)).toBe(runs);
	await page.screenshot({ path: path.join(OUT, "tb-pending-rtl.png") });
	await page.locator('[data-action="run"]').click();
	await expect(page.locator(".rv-server")).not.toHaveClass(/pending/);
});
