// @ts-check
// Row details (ADR-023; the approved canvas "Report tables and row details"): the button in the
// first column of a report row (faint, strong on the row's hover and focus, reachable by Tab),
// the drawer it opens with that row (tiles and fields), ↑/↓ to the previous and next row, Esc
// and the focus going back, the dialog, the server's template in a frame, the bottom sheet on
// a phone, and the table's look: zero muted, negative red, the totals row's strong rule, the
// column groups boxed and the balance groups shaded. The harness passes the report's settings
// as get_meta does (rvs=<JSON>). Fails on any console error or warning.
const { test, expect } = require("@playwright/test");
const { watch_console, open, settle, shots_dir, AR_AMOUNTS } = require("./helpers.js");

const OUT = shots_dir("row-details");
const rvs = (row_details) => `&rvs=${encodeURIComponent(JSON.stringify({ row_details }))}`;
const button = (page, i = 0) => page.locator("regular-table tbody tr:not(.stale) > th:first-child .rv-rd-btn").nth(i);
const panel = (page) => page.locator(".rv-rd");
const title = (page) => page.locator(".rv-rd .rv-rd-title");
// the panel at rest (its entrance animation finished)
const panel_ready = (page) =>
	page.waitForFunction(() => {
		const el = document.querySelector(".rv-rd");
		return el && el.getAnimations().every((a) => a.playState === "finished");
	});
const opacity = (loc) => loc.evaluate((el) => Number(getComputedStyle(el).opacity));
const color = (loc) => loc.evaluate((el) => getComputedStyle(el).color);
// a token of the page as the browser computes it (rv_tokens.css)
const token = (page, name) =>
	page.evaluate((n) => {
		const probe = document.createElement("span");
		probe.style.color = `var(${n})`;
		document.querySelector(".rv").append(probe);
		const out = getComputedStyle(probe).color;
		probe.remove();
		return out;
	}, name);
// the name of the account a button stands for (Trial Balance: acc_name of the report row)
const row_name = (loc) => loc.evaluate((b) => window.rv_page.grid.record_at(b.closest("th"))?.rec.row.acc_name || "");

for (const lang of ["ar", "en"]) {
	test(`drawer (${lang}): the button opens the row, ↑/↓ move, Esc closes and gives the focus back`, async ({ page }) => {
		const problems = watch_console(page);
		await open(page, `report=tb&lang=${lang}`);
		const first = button(page, 2);
		// faint at rest, strong on the row's hover
		expect(await opacity(first)).toBeLessThan(0.9);
		await first.evaluate((b) => b.closest("tr").querySelector("td")?.scrollIntoView({ block: "nearest" }));
		await page.locator("regular-table tbody tr:not(.stale)").nth(2).locator("td").first().hover();
		await expect.poll(() => opacity(first)).toBeGreaterThan(0.95);
		expect(await first.getAttribute("aria-label")).toBe(lang === "ar" ? "تفاصيل السطر" : "Row details");
		const name = await row_name(first);
		await first.click();
		await expect(panel(page)).toBeVisible();
		await expect(panel(page)).toHaveClass(/rv-rd-drawer/);
		await expect(page.locator(".rv-rd-scrim")).toBeVisible();
		await panel_ready(page);
		await expect(title(page)).toHaveText(name);
		// from the inline end, about 520px
		const box = await panel(page).boundingBox();
		const vw = page.viewportSize()?.width || 0;
		expect(Math.round(box?.width || 0)).toBe(520);
		if (lang === "ar") expect(Math.round(box?.x || 0)).toBe(0);
		else expect(Math.round((box?.x || 0) + (box?.width || 0))).toBe(vw);
		// the row is marked in the table
		await expect(page.locator("regular-table tbody tr.rv-open")).toHaveCount(1);
		// tiles: the period's and the closing debit and credit; every field labelled
		await expect(page.locator(".rv-rd-tile")).toHaveCount(4);
		expect(await page.locator(".rv-rd-fields dt").count()).toBeGreaterThan(6);
		await page.screenshot({ path: `${OUT}/drawer-${lang}.png` });
		// ↓ the next row, ↑ back
		await page.keyboard.press("ArrowDown");
		const next = await row_name(button(page, 3));
		await expect(title(page)).toHaveText(next);
		await page.keyboard.press("ArrowUp");
		await expect(title(page)).toHaveText(name);
		// the arrow buttons do the same
		await page.locator(".rv-rd-next").click();
		await expect(title(page)).toHaveText(next);
		await page.locator(".rv-rd-prev").click();
		await expect(title(page)).toHaveText(name);
		// Tab stays inside the panel
		for (let i = 0; i < 8; i++) {
			await page.keyboard.press("Tab");
			expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".rv-rd")))).toBe(true);
		}
		await page.keyboard.press("Shift+Tab");
		expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".rv-rd")))).toBe(true);
		// Esc closes; the focus is back on the row's button
		await page.keyboard.press("Escape");
		await expect(panel(page)).toHaveCount(0);
		await expect(page.locator(".rv-rd-scrim")).toHaveCount(0);
		await expect(page.locator("regular-table tbody tr.rv-open")).toHaveCount(0);
		expect(await page.evaluate(() => document.activeElement?.classList.contains("rv-rd-btn"))).toBe(true);
		expect(await page.evaluate(() => window.rv_page.grid.record_at(document.activeElement.closest("th"))?.rec.row.acc_name)).toBe(name);
		expect(problems, "console errors/warnings").toEqual([]);
	});
}

test("keyboard: Tab reaches a row's button, which is strong when focused; Enter opens the row", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=en");
	const b = button(page, 1);
	await b.focus();
	await expect.poll(() => opacity(b)).toBeGreaterThan(0.95);
	expect(await b.evaluate((el) => el.tabIndex)).toBe(0);
	await page.keyboard.press("Enter");
	await expect(panel(page)).toBeVisible();
	await page.locator(".rv-rd-scrim").click({ position: { x: 1300, y: 500 }, force: true }).catch(() => {});
	await page.keyboard.press("Escape");
	await expect(panel(page)).toHaveCount(0);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("dialog: the settings' container", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=tb&lang=ar${rvs({ enabled: true, container: "dialog", content: "fields" })}`);
	await button(page, 2).click();
	await expect(panel(page)).toHaveClass(/rv-rd-dialog/);
	await panel_ready(page);
	const box = await panel(page).boundingBox();
	const vw = page.viewportSize()?.width || 0;
	// in the middle of the window
	expect(Math.abs((box?.x || 0) + (box?.width || 0) / 2 - vw / 2)).toBeLessThan(2);
	await page.screenshot({ path: `${OUT}/dialog-ar.png` });
	await page.keyboard.press("Escape");
	await expect(panel(page)).toHaveCount(0);
	expect(problems, "console errors/warnings").toEqual([]);
});

test("template: the server renders the row; the frame shows it, ↓ renders the next row", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=tb&lang=en${rvs({ enabled: true, container: "dialog", content: "html" })}`);
	await button(page, 2).click();
	const frame = page.frameLocator(".rv-rd-frame");
	await expect(frame.locator(".rd-t")).not.toHaveText("");
	const calls = await page.evaluate(() => window.RV_ROW_CALLS);
	expect(calls.length).toBe(1);
	expect(calls[0].report_name).toBe("Trial Balance");
	expect(Object.keys(calls[0].row)).toContain("closing_debit");
	expect(Object.keys(calls[0].row).some((k) => k.startsWith("__"))).toBe(false);
	expect(calls[0].filters.company).toBeTruthy();
	const shown = await frame.locator(".rd-t").textContent();
	await page.keyboard.press("ArrowDown");
	await expect(frame.locator(".rd-t")).not.toHaveText(shown || "");
	// the printed content has its own Print
	await expect(page.locator('.rv-rd [data-act="print-frame"]')).toBeVisible();
	await page.keyboard.press("Escape");
	expect(problems, "console errors/warnings").toEqual([]);
});

test("print format without a format: said plainly", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=tb&lang=en${rvs({ enabled: true, content: "print_format", print_format: null })}`);
	await button(page, 2).click();
	await expect(page.locator(".rv-rd .rv-rd-state")).toContainText("No print format");
	expect(await page.evaluate(() => window.RV_ROW_CALLS || [])).toEqual([]);
	await page.keyboard.press("Escape");
	expect(problems, "console errors/warnings").toEqual([]);
});

test("off in the settings: no button", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=tb&lang=en${rvs({ enabled: false })}`);
	await expect(page.locator("regular-table tbody .rv-rd-btn")).toHaveCount(0);
	expect(problems, "console errors/warnings").toEqual([]);
});

for (const lang of ["ar", "en"]) {
	test(`phone (${lang}): the drawer is a bottom sheet`, async ({ page }) => {
		const problems = watch_console(page);
		await open(page, `report=tb&lang=${lang}`, { width: 390, height: 844 });
		await button(page, 1).click();
		await expect(panel(page)).toBeVisible();
		await panel_ready(page);
		const box = await panel(page).boundingBox();
		expect(Math.round(box?.x || 0)).toBe(0);
		expect(Math.round(box?.width || 0)).toBe(390);
		expect(Math.round((box?.y || 0) + (box?.height || 0))).toBe(844);
		expect(box?.height || 0).toBeLessThan(844 * 0.9);
		await page.screenshot({ path: `${OUT}/sheet-${lang}.png` });
		await page.keyboard.press("Escape");
		await expect(panel(page)).toHaveCount(0);
		expect(problems, "console errors/warnings").toEqual([]);
	});
}

test("table look: zero muted, negative red, the totals row's strong rule, groups boxed, balance groups shaded", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=ar&lang=en&rv=${AR_AMOUNTS}`);
	await settle(page);
	const neg = page.locator("regular-table tbody td.neg .rv-cc").first();
	await expect(neg).toBeVisible();
	expect(await color(neg)).toBe(await token(page, "--err"));
	const plain = page.locator("regular-table tbody td.num:not(.neg):not(.zero) .rv-cc").first();
	expect(await color(plain)).toBe(await token(page, "--tx"));
	expect(await plain.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain("tabular-nums");
	const zero = page.locator("regular-table tbody td.zero .rv-cc").first();
	expect(await color(zero)).toBe(await token(page, "--tx-4"));
	const rule = await page.locator(".rv-rt-total").evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth));
	expect(rule).toBeGreaterThanOrEqual(1.5);
	expect(await page.locator(".rv-rt-total .rv-c.num").first().evaluate((el) => Number(getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(700);

	await open(page, "report=tb&lang=en");
	// the bands are boxes: a line on their top and sides (inset shadows: no width added to the
	// columns), rounded top corners, the header's soft background
	const band = page.locator("regular-table thead th.rv-hb:not(.empty)").first();
	const b = await band.evaluate((el) => {
		const s = getComputedStyle(el);
		return { lines: (s.boxShadow.match(/inset/g) || []).length, radius: parseFloat(s.borderTopLeftRadius), bg: s.backgroundColor };
	});
	expect(b.lines).toBe(3);
	expect(b.radius).toBeGreaterThan(0);
	expect(b.bg).toBe(await page.evaluate(() => {
		const p = document.createElement("span");
		p.style.backgroundColor = "var(--hdr)";
		document.querySelector(".rv").append(p);
		const out = getComputedStyle(p).backgroundColor;
		p.remove();
		return out;
	}));
	// opening and closing balance columns shaded, the period's not
	const shade = await page.evaluate(() => {
		const rt = document.querySelector("regular-table");
		const out = {};
		for (const td of rt.querySelectorAll("tbody tr:not(.group):not(.foot) td")) {
			const key = rt.getMeta(td) && window.rv_page.grid.model.data[rt.getMeta(td).x]?.column.key;
			if (key && !(key in out)) out[key] = td.classList.contains("shade");
		}
		return out;
	});
	expect(shade).toMatchObject({ opening_debit: true, opening_credit: true, debit: false, credit: false, closing_debit: true, closing_credit: true });
	expect(problems, "console errors/warnings").toEqual([]);
});

for (const [name, query] of [
	["table-light-rtl", "report=tb&lang=ar"],
	["table-dark-rtl", "report=tb&lang=ar&desk=dark"],
	["table-light-ltr", "report=tb&lang=en"],
	["table-dark-ltr", "report=tb&lang=en&desk=dark"],
	["table-compact-rtl", "report=tb&lang=ar&density=compact"],
	["ar-light-ltr", `report=ar&lang=en&rv=${AR_AMOUNTS}`],
	["ar-dark-rtl", `report=ar&lang=ar&desk=dark&rv=${AR_AMOUNTS}`],
]) {
	test(`look: ${name}`, async ({ page }) => {
		const problems = watch_console(page);
		await open(page, query);
		await settle(page);
		await page.screenshot({ path: `${OUT}/${name}.png` });
		expect(problems, "console errors/warnings").toEqual([]);
	});
}
