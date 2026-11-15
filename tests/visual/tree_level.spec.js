// @ts-check
// The level a report tree opens to (components/tree_level.js), as Frappe's tree reports set it:
// the roots, a level typed or stepped, every node; the same control in the standard page's
// row groups bar, the bars of A and C and the Statement's head. Level 1 is the roots.
const { test, expect } = require("@playwright/test");
const { watch_console, open, settle } = require("./helpers.js");

const control = (page) => page.locator(".rv-tree-level:visible").first();
const read = (page) =>
	page.evaluate(() => {
		const el = [...document.querySelectorAll(".rv-tree-level")].find((e) => !e.hidden && e.offsetParent);
		const s = window.rv_page.state;
		return {
			value: el?.querySelector("input").value,
			max: el?.querySelector("input").max,
			on: el ? [...el.querySelectorAll(".on")].map((x) => x.dataset.tl || "step") : [],
			depth: s.tree?.depth ?? null,
			expanded: s.tree?.expanded ?? null,
		};
	});

for (const [where, query] of [
	["the standard page", "report=tb&lang=ar"],
	["layout A", "report=tb&lang=ar&layout=a"],
	["layout C", "report=tb&lang=en&layout=c"],
	["layout A's Statement", "report=tb&lang=ar&layout=a&mode=statement"],
]) {
	test(`tree level (${where}): roots, a level typed or stepped, all; the ends marked`, async ({ page }) => {
		const problems = watch_console(page);
		await open(page, query);
		await settle(page);
		if (where.includes("Statement") && !(await page.evaluate(() => window.rv_page.state.mode === "statement"))) {
			await page.locator('[data-mode="statement"]:visible').first().click();
			await settle(page);
		}
		const c = control(page);
		await expect(c).toBeVisible();
		const max = Number((await read(page)).max) - 1;
		expect(max).toBeGreaterThan(0);
		await c.locator('[data-tl="roots"]').click();
		await settle(page);
		let s = await read(page);
		expect(s).toMatchObject({ value: "1", depth: 0, expanded: null });
		expect(s.on).toEqual(["roots"]);
		await expect(c.locator('[data-tl="less"]')).toBeDisabled();
		// a level typed, set when Enter is pressed (Frappe's «Set Level»)
		await c.locator("input").fill("2");
		await c.locator("input").press("Enter");
		await settle(page);
		s = await read(page);
		expect(s).toMatchObject({ value: "2", depth: 1 });
		await c.locator('[data-tl="more"]').click();
		await settle(page);
		expect((await read(page)).depth).toBe(Math.min(2, max));
		await c.locator('[data-tl="all"]').click();
		await settle(page);
		s = await read(page);
		expect(s).toMatchObject({ value: String(max + 1), depth: max });
		expect(s.on).toEqual(["all"]);
		await expect(c.locator('[data-tl="more"]')).toBeDisabled();
		// a level past the deepest is the deepest
		await c.locator("input").fill("99");
		await c.locator("input").press("Enter");
		await settle(page);
		expect((await read(page)).depth).toBe(max);
		expect(problems, "console errors/warnings").toEqual([]);
	});
}

test("tree level: a report without a tree has none", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=gl&lang=en");
	await settle(page);
	await expect(page.locator(".rv-tree-level:visible")).toHaveCount(0);
	expect(problems, "console errors/warnings").toEqual([]);
});
