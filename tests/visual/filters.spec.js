// @ts-check
// Phase 5a-2, wave 1: period picker, floating and set filters, column menu, group panel, search, side panels, column groups.
// Fails on any console error or warning (helpers.js watch_console).
const { test, expect } = require("@playwright/test");
const {
	rv,
	AR_AMOUNTS,
	watch_console,
	open,
	settle,
	header,
	shot2,
	VARIANTS,
	DESIGN,
	handles_of,
	TB_HANDLES,
	STATES,
} = require("./helpers.js");


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
	const saved = await page.evaluate(() => window.rv_test.saved_settings().column_groups.groups);
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
