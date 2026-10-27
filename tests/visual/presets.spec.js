// @ts-check
// Print presets (ADR-020): save, apply, edit, delete, the default, public presets, reopening.
// Fails on any console error or warning (helpers.js watch_console).
const { test, expect } = require("@playwright/test");
const {
	rv,
	watch_console,
	open,
	settle,
	shown,
	PAGES,
	pages_settings,
	pages_state,
	preset_shot,
	preset_state,
	open_presets,
} = require("./helpers.js");


test("pages: print presets: save as new, the changed dot, save over it, apply, edit and delete", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=tb&lang=en&rv=${PAGES}`);
	await settle(page);
	let st = await preset_state(page);
	expect(st.shown).toBe(true);
	expect(st.name).toBe("Standard");
	expect(st.dot).toBe(false);
	await open_presets(page);
	await expect(page.locator(".rv-preset-pop .rv-preset-empty").first()).toBeVisible();
	await expect(page.locator('.rv-preset-pop [data-act="save"]')).toBeDisabled();
	// save the current settings as a new preset, for this report, as the default
	await page.click('.rv-preset-pop [data-act="save-new"]');
	const dlg = page.locator(".rv-test-dialog");
	await expect(dlg).toBeVisible();
	await expect(dlg.locator('[data-fieldname="visibility"] select')).toBeVisible();
	await dlg.locator('[data-fieldname="preset_name"] input').fill("Board pack");
	await dlg.locator('[data-fieldname="is_default"] input').check();
	await preset_shot(page, "presets-save-new-dialog-light-ltr");
	await dlg.locator(".btn-modal-primary").click();
	await expect(dlg).toHaveCount(0);
	await expect(page.locator(".rv-preset-btn .nm")).toHaveText("Board pack");
	st = await preset_state(page);
	expect(st.store).toHaveLength(1);
	expect(st.store[0]).toMatchObject({ preset_name: "Board pack", public: false, is_default: true, target: "Trial Balance" });
	expect(st.store[0].settings.orientation).toBe("landscape");
	expect(st.store[0].settings.zoom).toBeUndefined();
	expect(st.store[0].settings.hidden).toEqual([]);
	expect(st.dot).toBe(false);
	// the user's settings remember the preset applied
	await page.evaluate(() => window.rv_page.flush_settings());
	expect(await page.evaluate(() => window.rv_test.saved_settings().pages.preset)).toBe(st.store[0].name);
	// a change: the dot; «Save» writes it into the preset
	await page.click('details[data-sec="paper"] > summary');
	await page.click('[data-orient="portrait"]');
	await settle(page);
	await page.keyboard.press("Escape");
	expect((await preset_state(page)).dot).toBe(true);
	await open_presets(page);
	await preset_shot(page, "presets-menu-changed-light-ltr");
	await expect(page.locator('.rv-preset-pop [data-act="save"]')).toBeEnabled();
	await page.click('.rv-preset-pop [data-act="save"]');
	await expect.poll(async () => (await preset_state(page)).store[0].settings.orientation).toBe("portrait");
	expect((await preset_state(page)).dot).toBe(false);
	// Reset: the standard settings, no preset; applying the preset brings it back
	await page.keyboard.press("Escape");
	await page.click('[data-action="reset"]');
	await settle(page);
	st = await preset_state(page);
	expect(st.name).toBe("Standard");
	expect(st.applied).toBe(null);
	await open_presets(page);
	await page.click(`.rv-preset-pop [data-apply="${st.store[0].name}"]`);
	await settle(page);
	st = await preset_state(page);
	expect(st.menu).toBe(false);
	expect(st.name).toBe("Board pack");
	expect(st.settings.orientation).toBe("portrait");
	// edit: a new name and a description
	await open_presets(page);
	await page.click('.rv-preset-pop [data-act="edit"]');
	await dlg.locator('[data-fieldname="preset_name"] input').fill("Board pack, portrait");
	await dlg.locator('[data-fieldname="description"] input').fill("Monthly board meeting");
	await dlg.locator(".btn-modal-primary").click();
	await expect(page.locator(".rv-preset-btn .nm")).toHaveText("Board pack, portrait");
	await expect(page.locator(".rv-preset-pop .rv-preset-item.on .meta")).toContainText("Monthly board meeting");
	// the default star of the row: off and on again
	const star = page.locator(`.rv-preset-pop [data-star="${st.store[0].name}"]`);
	await expect(star).toHaveAttribute("aria-pressed", "true");
	await star.click();
	await expect(star).toHaveAttribute("aria-pressed", "false");
	// delete (frappe.confirm answers yes in the harness)
	await page.click('.rv-preset-pop [data-act="delete"]');
	await expect.poll(async () => (await preset_state(page)).store.length).toBe(0);
	st = await preset_state(page);
	expect(st.name).toBe("Standard");
	expect(st.applied).toBe(null);
	expect(problems, "console errors/warnings").toEqual([]);
});


test("pages: print presets: the default applies when the user has none; a preset for every report keeps this report's columns; a public one is read-only for others", async ({ page }) => {
	const problems = watch_console(page);
	const presets = [
		{ preset_name: "House style", public: true, is_default: true, owner: "finance@rv.test", description: "Company standard", settings: { size: "Letter", orientation: "portrait", hidden: ["debit"], template: "Other report's format" } },
		{ preset_name: "TB without types", target: "Trial Balance", settings: { size: "A3", orientation: "landscape", hidden: ["account__account_type"] } },
		{ preset_name: "Every report, wide margins", settings: { margins: "wide" } },
	];
	await open(page, `report=tb&lang=ar&publish=0&rv=${PAGES}&presets=${encodeURIComponent(JSON.stringify(presets))}`);
	await settle(page);
	let st = await preset_state(page);
	// no saved settings: the public default, its columns and format left out (it is for every report)
	expect(st.name).toBe("House style");
	expect(st.settings).toEqual({ size: "Letter", orientation: "portrait", hidden: [], template: "" });
	await open_presets(page);
	await expect(page.locator(".rv-preset-pop .rv-preset-grp")).toHaveCount(2);
	// this report's own preset before the one for every report
	const mine = await page.locator(".rv-preset-pop .rv-preset-ul").nth(1).locator(".nm").allTextContents();
	expect(mine).toEqual(["TB without types", "Every report, wide margins"]);
	// a public preset of someone else, and no publishing: no save, edit or delete
	await expect(page.locator('.rv-preset-pop [data-act="save"]')).toBeDisabled();
	await expect(page.locator('.rv-preset-pop [data-act="edit"]')).toBeDisabled();
	await expect(page.locator('.rv-preset-pop [data-act="delete"]')).toBeDisabled();
	await preset_shot(page, "presets-menu-light-rtl");
	// this report's preset brings its columns
	await page.click('.rv-preset-pop [data-apply="pp-1"]');
	await settle(page);
	st = await preset_state(page);
	expect(st.settings.size).toBe("A3");
	expect(st.settings.hidden).toEqual(["account__account_type"]);
	expect((await pages_state(page)).titles.length).toBeGreaterThan(0);
	// a preset for every report: the columns stay this report's
	await open_presets(page);
	await page.click('.rv-preset-pop [data-apply="pp-2"]');
	await settle(page);
	st = await preset_state(page);
	expect(st.settings.hidden).toEqual(["account__account_type"]);
	expect(await page.evaluate(() => window.rv_page.pages.settings.margins)).toBe("wide");
	// no visibility choice for a user who may not publish
	await open_presets(page);
	await page.click('.rv-preset-pop [data-act="save-new"]');
	await expect(page.locator('.rv-test-dialog [data-fieldname="visibility"]')).toHaveCount(0);
	await page.evaluate(() => document.querySelector(".rv-test-dialog").remove());
	expect(problems, "console errors/warnings").toEqual([]);
});


test("pages: print presets: the saved preset is shown again on reopening; dark and phone", async ({ page }) => {
	const problems = watch_console(page);
	const presets = [{ preset_name: "Statement, A4", target: "Trial Balance", settings: { size: "A4", orientation: "landscape" } }, { preset_name: "House style", public: true, owner: "finance@rv.test", settings: { size: "Legal" } }];
	const saved = { orientation: "portrait", preset: "pp-0" };
	await open(page, `report=tb&lang=ar&desk=dark&rv=${PAGES}${pages_settings(saved)}&presets=${encodeURIComponent(JSON.stringify(presets))}`);
	await settle(page);
	let st = await preset_state(page);
	// the preset of the saved settings, changed since (portrait): the dot
	expect(st.name).toBe("Statement, A4");
	expect(st.dot).toBe(true);
	expect(st.settings.orientation).toBe("portrait");
	await open_presets(page);
	await preset_shot(page, "presets-menu-dark-rtl");
	await page.keyboard.press("Escape");
	await page.setViewportSize({ width: 390, height: 844 });
	await page.waitForTimeout(300);
	await open_presets(page);
	await page.evaluate(() => Promise.all(document.querySelector(".rv-preset-pop").getAnimations().map((a) => a.finished)));
	const m = await page.evaluate(() => {
		const r = document.querySelector(".rv-preset-pop").getBoundingClientRect();
		return { bottom: Math.round(r.bottom), w: Math.round(r.width), hscroll: document.documentElement.scrollWidth > innerWidth };
	});
	expect(m).toEqual({ bottom: 844, w: 390, hscroll: false });
	await preset_shot(page, "presets-menu-390-dark-rtl");
	await page.keyboard.press("Escape");
	expect((await preset_state(page)).menu).toBe(false);
	expect(problems, "console errors/warnings").toEqual([]);
});
