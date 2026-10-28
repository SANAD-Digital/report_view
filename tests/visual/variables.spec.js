// @ts-check
// Variables of a print format (ADR-024): a format with variables shows the «Variables» tool,
// one control per variable; changing a value renders the format again with it (and only the
// format), and the value is saved with the print settings, per format.
// Fails on any console error or warning (helpers.js watch_console).
const path = require("path");
const { test, expect } = require("@playwright/test");
const { watch_console, open, settle, PAGES, pages_settings } = require("./helpers.js");

const SHOTS = process.env.RV_SHOTS && process.env.RV_SHOTS !== "docs" ? process.env.RV_SHOTS : null;

const DEFS = [
	{ label: "Show details", fieldname: "show_details", fieldtype: "Check", default: 1 },
	{ label: "Layout", fieldname: "layout", fieldtype: "Select", options: "Short\nLong", default: "Short" },
	{ label: "Copies", fieldname: "copies", fieldtype: "Int", default: 2 },
];

/** A Jinja format «Vars» whose HTML shows the values it was rendered with. */
const with_variables = (page, defs) =>
	page.evaluate(async (defs) => {
		const v = window.rv_page.pages;
		window.RV_VAR_CALLS = [];
		v.options.print_formats = ["Vars", "Plain"];
		v.options.print_format_types = { Vars: "Jinja", Plain: "Jinja" };
		v.options.print_format_variables = { Vars: defs };
		const letterhead = v.host.pages_letterhead.bind(v.host);
		window.RV_LH_CALLS = 0;
		v.host.pages_letterhead = (...a) => {
			window.RV_LH_CALLS += 1;
			return letterhead(...a);
		};
		v.host.pages_format = async (name, lang, type, cols, vars) => {
			window.RV_VAR_CALLS.push({ name, vars });
			const detail = vars?.show_details ? `<p class="var-detail">Details on</p>` : "";
			return { type: "Jinja", html: `<div class="print-format"><h2 class="var-out">${name}: ${JSON.stringify(vars)}</h2>${detail}</div>`, css: "" };
		};
		v.update({ template: "Vars" });
		await v.ready;
		await window.rv_settle();
	}, defs);

test("variables: the tool shows a control per variable; a switch renders the format again and is saved", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=gl&lang=en&rv=${PAGES}${pages_settings({ orientation: "portrait" })}`);
	await settle(page);
	await with_variables(page, DEFS);
	const tool = page.locator('details[data-sec="vars"] > summary');
	await expect(tool).toBeVisible();
	await tool.click();
	const menu = page.locator(".rv-print-pop");
	await expect(menu.locator("[data-var-sw=show_details]")).toHaveAttribute("aria-checked", "true");
	await expect(menu.locator("select[data-var=layout]")).toHaveValue("Short");
	await expect(menu.locator("input[data-var-num=copies]")).toHaveValue("2");
	await expect(page.locator(".rv-print-sheets .var-detail").first()).toBeVisible();
	if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "variables-menu-ltr.png") });
	const before = await page.evaluate(() => ({ calls: window.RV_VAR_CALLS.length, lh: window.RV_LH_CALLS }));
	await menu.locator("[data-var-sw=show_details]").click();
	await expect(menu.locator("[data-var-sw=show_details]")).toHaveAttribute("aria-checked", "false");
	await expect(page.locator(".rv-print-sheets .var-out").first()).toContainText('"show_details":0');
	await expect(page.locator(".rv-print-sheets .var-detail")).toHaveCount(0);
	// the menu stays open while the format renders again
	await expect(menu).toBeVisible();
	await menu.locator("select[data-var=layout]").selectOption("Long");
	await expect(page.locator(".rv-print-sheets .var-out").first()).toContainText('"layout":"Long"');
	const out = await page.evaluate(() => {
		const v = window.rv_page.pages;
		return { calls: window.RV_VAR_CALLS.slice(), lh: window.RV_LH_CALLS, saved: JSON.parse(JSON.stringify(v.settings.variables)) };
	});
	// one render per change, the letter head from its cache
	expect(out.calls.length - before.calls).toBe(2);
	expect(out.lh).toBe(before.lh);
	expect(out.calls.at(-1)).toEqual({ name: "Vars", vars: { show_details: 0, layout: "Long", copies: 2 } });
	expect(out.saved).toEqual({ Vars: { show_details: 0, layout: "Long" } });
	if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "variables-changed-ltr.png") });
	// a format without variables: no tool, rendered with none
	await page.evaluate(async () => {
		const v = window.rv_page.pages;
		v.update({ template: "Plain" });
		await v.ready;
	});
	await expect(page.locator('details[data-sec="vars"]')).toHaveCount(0);
	expect(await page.evaluate(() => window.RV_VAR_CALLS.at(-1))).toEqual({ name: "Plain", vars: null });
	expect(problems, "console errors/warnings").toEqual([]);
});

test("variables: Arabic, right to left, and the sheet of a phone", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=gl&lang=ar&rv=${PAGES}`, { width: 390, height: 844 });
	await settle(page);
	await with_variables(page, DEFS);
	await page.locator('details[data-sec="vars"] > summary').click();
	const menu = page.locator(".rv-print-pop");
	await expect(menu.locator("[data-var-sw=show_details]")).toHaveAttribute("aria-checked", "true");
	// the sheet slides in: the picture once it stands
	await menu.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
	if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "variables-phone-rtl.png") });
	await menu.locator("input[data-var-num=copies]").fill("5");
	await expect(page.locator(".rv-print-sheets .var-out").first()).toContainText('"copies":5');
	expect(problems, "console errors/warnings").toEqual([]);
});
