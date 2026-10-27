// @ts-check
// The pivot (phase 5b): values checked by hand, drill-down, the columns panel, folding, limits and lifecycle.
// Fails on any console error or warning (helpers.js watch_console).
const { test, expect } = require("@playwright/test");
const {
	rv,
	watch_console,
	open,
	shown,
	header,
	pivot_shot,
	PIVOT_DESIGN,
	pivot_handles,
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
} = require("./helpers.js");


for (const s of PIVOT_SHOTS) {
	test(s.name, async ({ page }) => {
		const problems = watch_console(page);
		await open(page, s.query, { width: s.width || PIVOT_DESIGN.width, height: s.height || PIVOT_DESIGN.height });
		// a link with mode "pivot" opens on the pivot; others switch to it with the tab
		if (!(await page.evaluate(() => window.rv_page.debug_pivot()?.shown))) await to_pivot(page);
		await expect(page.locator('.rv-views [data-mode="pivot"]')).toHaveClass(/on/);
		await expect(page.locator(".rv-pivotbar")).toBeVisible();
		await pivot_shot(page, s.name, Boolean(s.full));
		// header rows: one level per pivot column, plus the value's name when there are several values
		const info = await page.evaluate(() => ({ p: window.rv_page.debug_pivot(), rows: document.querySelectorAll(".rv-pivotgrid regular-table thead tr").length }));
		const levels = info.p.cols.length + (info.p.values.length > 1 || !info.p.cols.length ? 1 : 0);
		expect(info.rows, "header rows").toBe(levels);
		expect(problems, "console errors/warnings").toEqual([]);
	});
}


for (const [name, query, act] of [
	["pivot-tb-drill-light-rtl", `report=tb&lang=ar&rv=${pivot_rv(PV_TB_SPLIT)}`, null],
	["pivot-ar-drill-dark-ltr", `report=ar&lang=en&desk=dark&rv=${pivot_rv(PV_AR_COUNT)}`, null],
	["pivot-tb-sidecols-light-rtl", "report=tb&lang=ar", "sidecols"],
	["pivot-ar-sidecols-dark-ltr", `report=ar&lang=en&desk=dark&rv=${pivot_rv(PV_AR)}`, "sidecols"],
]) {
	test(name, async ({ page }) => {
		const problems = watch_console(page);
		await open(page, query, PIVOT_DESIGN);
		if (!(await page.evaluate(() => window.rv_page.debug_pivot()?.shown))) await to_pivot(page);
		if (act === "sidecols") {
			await page.locator('[data-side="columns"]').click();
			await expect(page.locator('.rv-panel [data-action="pivot-mode"]')).toHaveAttribute("aria-checked", "true");
		} else {
			await page.locator(".rv-pivotgrid regular-table tbody td.pv").first().click();
			await page.waitForFunction(() => document.querySelector(".rv-pv-drill .rv-pv-sub")?.dataset.count);
		}
		await page.waitForTimeout(300);
		await pivot_shot(page, name);
		expect(problems, "console errors/warnings").toEqual([]);
	});
}


test("pivot: values = a manual check on three combinations of the fixture; grand total = the grid's total", async ({ page }) => {
	const problems = watch_console(page);
	// receivables: party x voucher type, paid (sum and count)
	const ar = raw_rows("accounts_receivable_frappe_total.json").filter((r) => r.party && r.voucher_type);
	await open(page, `report=ar&lang=en&rv=${pivot_rv(PV_AR_COUNT)}`);
	let d = await pivot_data(page);
	const combos = [];
	for (const party of [...new Set(ar.map((r) => r.party))]) {
		for (const type of [...new Set(ar.map((r) => r.voucher_type))]) {
			const rows = ar.filter((r) => r.party === party && r.voucher_type === type);
			if (rows.length) combos.push({ party, type, sum: rows.reduce((a, r) => a + (r.paid || 0), 0), count: rows.length });
		}
	}
	expect(combos.length).toBeGreaterThanOrEqual(3);
	for (const c of combos.slice(0, 3)) {
		const i = d.paths.findIndex((p) => p.length === 1 && p[0] === c.party);
		close_to(d.p[`${c.type}|__pv0`][i], c.sum, `${c.party} / ${c.type}`);
		expect(d.p[`${c.type}|__pv1`][i]).toBe(c.count);
	}
	// what the screen shows is that number: the cell of the first combination
	const first = combos[0];
	const shown = await page.evaluate(({ party, type }) => {
		const rt = document.querySelector(".rv-pivotgrid regular-table");
		const x = window.rv_page.debug_pivot().column_paths.indexOf(`${type}|__pv0`);
		for (const td of rt.querySelectorAll("tbody td")) {
			const th = td.parentElement.querySelector("th");
			if (rt.getMeta(td).x === x && th.textContent.includes(party)) return td.textContent;
		}
		return null;
	}, first);
	expect(shown).not.toBeNull();
	if (Math.abs(first.sum) < 0.005) expect(shown.trim()).toBe("—");
	else close_to(Number(shown.replace(/[^\d.-]/g, "")), first.sum, "cell on screen");
	// grand total of the pivot = the grid's total for the same measure and filters
	const pivot_total = d.total.__pv0;
	await page.locator('.rv-views [data-mode="grid"]').click();
	await grid_back(page);
	close_to(pivot_total, (await page.evaluate(() => window.rv_page.debug_totals().totals)).paid, "ar total");

	// with a filter of the page: the same filter on both
	await page.evaluate(() => window.rv_page.controls.set_filter("voucher_type", { key: "voucher_type", type: "set", values: ["Payment Entry"], exclude: false }));
	await page.waitForFunction(() => window.rv_page.opened?.post.fact_filter.length && window.rv_page.grid.current === window.rv_page.opened);
	const grid_filtered = (await page.evaluate(() => window.rv_page.debug_totals().totals)).paid;
	await to_pivot(page);
	d = await pivot_data(page);
	close_to(d.total.__pv0, grid_filtered, "ar filtered total");
	expect(d.column_paths.every((n) => n.startsWith("Payment Entry|"))).toBe(true);

	// general ledger: two pivot columns, the grand total = the grid's debit and credit
	const gl = raw_rows("general_ledger_consolidated.json").filter((r) => r.voucher_type && !String(r.account).startsWith("'"));
	await open(page, `report=gl&lang=en&rv=${pivot_rv(PV_GL)}`);
	d = await pivot_data(page);
	let checked = 0;
	for (const name of d.column_paths.filter((n) => n.endsWith("|__pv0"))) {
		const [vt, pt] = name.split("|");
		for (let i = 1; i < d.paths.length && checked < 3; i++) {
			const rows = gl.filter((r) => r.account === d.paths[i][0] && r.voucher_type === vt && (r.party_type || "null") === pt);
			if (!rows.length) continue;
			close_to(d.p[name][i], rows.reduce((a, r) => a + (r.debit || 0), 0), `${d.paths[i][0]} / ${name}`);
			checked += 1;
		}
	}
	expect(checked).toBe(3);
	const gl_total = d.total;
	await page.locator('.rv-views [data-mode="grid"]').click();
	await grid_back(page);
	const grid = await page.evaluate(() => window.rv_page.debug_totals().totals);
	close_to(gl_total.__pv0, grid.debit, "gl debit");
	close_to(gl_total.__pv1, grid.credit, "gl credit");

	// trial balance: period debit and credit (the leaves add up to the report's total)
	await open(page, `report=tb&lang=en&rv=${pivot_rv({ rows: ["level_1"], cols: ["account__root_type"], values: [{ key: "debit", agg: "sum" }, { key: "credit", agg: "sum" }] })}`);
	d = await pivot_data(page);
	await page.locator('.rv-views [data-mode="grid"]').click();
	await grid_back(page);
	const tb = await page.evaluate(() => window.rv_page.debug_totals().totals);
	close_to(d.total.__pv0, tb.debit, "tb debit");
	close_to(d.total.__pv1, tb.credit, "tb credit");
	expect(problems, "console errors/warnings").toEqual([]);
});


test("pivot drill-down: the rows behind a cell, as many as its count, from a temporary view deleted at once", async ({ page }) => {
	const problems = watch_console(page);
	const ar = raw_rows("accounts_receivable_frappe_total.json").filter((r) => r.party && r.voucher_type);
	await open(page, `report=ar&lang=ar&rv=${pivot_rv(PV_AR_COUNT)}`);
	const before = await pivot_handles(page);
	// count cells on screen: the drill-down of each lists that many rows (= the fixture's rows)
	const cells = await page.evaluate(() => {
		const rt = document.querySelector(".rv-pivotgrid regular-table");
		const o = window.rv_page.debug_pivot();
		const out = [];
		rt.querySelectorAll("tbody td.pv").forEach((td, i) => {
			const name = o.column_paths[rt.getMeta(td).x];
			if (name && name.endsWith("|__pv1")) out.push({ i, count: Number(td.textContent.replace(/[^\d]/g, "")), type: name.split("|")[0], party: td.parentElement.querySelector("th").textContent });
		});
		return out;
	});
	expect(cells.length).toBeGreaterThan(0);
	for (const c of cells.slice(0, 3)) {
		await page.locator(".rv-pivotgrid regular-table tbody td.pv").nth(c.i).click();
		await page.waitForFunction(() => document.querySelector(".rv-pv-drill .rv-pv-sub")?.dataset.count);
		const listed = await page.evaluate(() => ({
			count: Number(document.querySelector(".rv-pv-drill .rv-pv-sub").dataset.count),
			items: document.querySelectorAll(".rv-pv-drill .rv-pv-item").length,
		}));
		expect(listed.count, `drill of ${c.party} / ${c.type}`).toBe(c.count);
		expect(listed.items).toBe(c.count);
		const party = ar.map((r) => r.party).find((p) => c.party.includes(p));
		expect(ar.filter((r) => r.party === party && r.voucher_type === c.type).length).toBe(c.count);
		// the temporary view was deleted in `finally`
		expect(await pivot_handles(page)).toBe(before);
		await page.keyboard.press("Escape");
		await expect(page.locator(".rv-pv-drill")).toHaveCount(0);
	}
	// the grand total row: every row of the report under the page's filters
	await page.locator(".rv-pivot .rv-rt-total .rv-c.pv").last().click();
	await page.waitForFunction(() => document.querySelector(".rv-pv-drill .rv-pv-sub")?.dataset.count);
	expect(await page.evaluate(() => Number(document.querySelector(".rv-pv-drill .rv-pv-sub").dataset.count))).toBe(ar.length);
	expect(problems, "console errors/warnings").toEqual([]);
});


test("pivot from the columns panel: switch, zones, aggregate; the URL keeps the pivot; drag a column to the pivot columns", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=ar&lang=en", PIVOT_DESIGN);
	await page.locator('[data-side="columns"]').click();
	const sw = page.locator('.rv-panel [data-action="pivot-mode"]');
	await expect(sw).toHaveAttribute("aria-checked", "false");
	await expect(page.locator('.rv-panel [data-zone="pivot"]')).toHaveClass(/off/);
	// a column dragged to the pivot columns zone turns the pivot mode on with it
	await page.locator('.rv-panel [data-zone="pivot"]').scrollIntoViewIfNeeded();
	await page.locator('.rv-panel .rv-colitem[data-key="voucher_type"]').dragTo(page.locator('.rv-panel [data-zone="pivot"]'));
	await pivot_changed(page, () => window.rv_page.state.mode === "pivot" && window.rv_page.debug_pivot()?.cols.join() === "voucher_type");
	await expect(sw).toHaveAttribute("aria-checked", "true");
	expect((await page.evaluate(() => window.rv_page.debug_pivot())).rows).toEqual(["party"]);
	// "+ Add" lists: a row level and a value; the aggregate of a value
	await page.locator('.rv-panel [data-add="rows"]').selectOption("posting_date");
	await pivot_changed(page, () => window.rv_page.debug_pivot()?.rows.join() === "party,posting_date");
	await page.locator('.rv-panel [data-add="values"]').selectOption("outstanding");
	await pivot_changed(page, () => window.rv_page.debug_pivot()?.values.length === 2);
	await page.locator('.rv-panel [data-pagg="1"]').selectOption("max");
	await pivot_changed(page, () => window.rv_page.debug_pivot()?.values[1].agg === "max");
	expect(await page.evaluate(() => window.rv_page.pivot_opened.spec.config.aggregates.__pv1)).toBe("high");
	// a pivot column moved to the rows: it leaves the columns
	await page.locator(".rv-pivotbar .rv-gchip").first().dragTo(page.locator(".rv-gp:not(.pv) .rv-gp-chips"));
	await pivot_changed(page, () => window.rv_page.debug_pivot()?.cols.length === 0);
	expect((await page.evaluate(() => window.rv_page.debug_pivot())).rows).toContain("voucher_type");
	// the URL carries the pivot; a page opened with it shows the same pivot
	// (the URL is written 300 ms after the last change)
	await page.waitForTimeout(500);
	const search = await page.evaluate(() => new URLSearchParams(window.location.search).get("rv"));
	expect(search).toBeTruthy();
	const pivot = await page.evaluate(() => window.rv_page.state.pivot);
	await open(page, `report=ar&lang=en&rv=${search}`, PIVOT_DESIGN);
	await pivot_shown(page);
	expect(await page.evaluate(() => window.rv_page.state.pivot)).toEqual(pivot);
	expect(await page.evaluate(() => window.rv_page.state.mode)).toBe("pivot");
	// the switch off: the table again, the pivot's views deleted
	await page.locator('[data-side="columns"]').click();
	await page.locator('.rv-panel [data-action="pivot-mode"]').click();
	await grid_back(page);
	expect(await page.evaluate(() => window.rv_page.debug_handles().filter((h) => /pivot/.test(h.name)))).toEqual([]);
	expect(problems, "console errors/warnings").toEqual([]);
});


test("pivot: folding a row in both views; expand all and collapse all", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=tb&lang=ar&rv=${pivot_rv(PV_TB_SPLIT)}`);
	const rows = () => page.evaluate(() => window.rv_page.pivot.body_rows);
	const all = await rows();
	await page.locator(".rv-gp:not(.pv) [data-action='collapse-all']").click();
	await page.waitForFunction((n) => window.rv_page.pivot.body_rows < n, all);
	const tops = await rows();
	const data = await pivot_data(page);
	expect(data.paths.slice(1).every((p) => p.length === 1)).toBe(true);
	expect(data.p.__ROW_PATH__).toEqual(data.paths);
	await page.locator(".rv-pivotgrid regular-table tbody .rv-caret").first().click();
	await page.waitForFunction((n) => window.rv_page.pivot.body_rows > n, tops);
	await page.locator(".rv-gp:not(.pv) [data-action='expand-all']").click();
	await page.waitForFunction((n) => window.rv_page.pivot.body_rows === n, all);
	expect(problems, "console errors/warnings").toEqual([]);
});


test("pivot: more split columns than the limit are not drawn; a notice says so", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=gl&lang=en&rows=1200&rv=${pivot_rv({ rows: ["account"], cols: ["voucher_no"], values: [{ key: "debit", agg: "sum" }] })}`);
	const p = await page.evaluate(() => window.rv_page.debug_pivot());
	expect(p.blocked).toBe(true);
	expect(p.cols).toEqual([]);
	await expect(page.locator(".rv-notice")).toContainText("500");
	expect(problems, "console errors/warnings").toEqual([]);
});


test("pivot lifecycle: no handle left after 20 switches and pivot changes, a re-run and leaving", async ({ page }) => {
	const problems = watch_console(page);
	const names = () => page.evaluate(() => window.rv_page.debug_handles().map((h) => h.name));
	await open(page, `report=tb&lang=ar&rv=${rv({ pivot: PV_TB_SPLIT })}`);
	const grid_handles = await pivot_handles(page);
	for (let i = 0; i < 20; i++) {
		if (i % 2 === 0) {
			await to_pivot(page);
			if (i % 4 === 0) {
				await page.evaluate((n) => window.rv_page.controls.set_pivot_cols(n ? ["account__root_type"] : []), i % 8);
				await pivot_changed(page, () => window.rv_page.pivot.current === window.rv_page.pivot_opened);
			}
			const split = (await page.evaluate(() => window.rv_page.debug_pivot().cols.length)) > 0;
			// the pivot replaced is deleted once its last read is done: soon, not at once
			await expect.poll(async () => (await names()).filter((n) => /\/pivot/.test(n)).length, { message: `switch ${i}` }).toBe(split ? 2 : 1);
		} else {
			await page.locator('.rv-views [data-mode="grid"]').click();
			await grid_back(page);
			expect(await pivot_handles(page), `switch ${i}`).toBe(grid_handles);
		}
	}
	await to_pivot(page);
	await page.evaluate(() => window.rv_page.run());
	await pivot_changed(page, () => window.rv_page.debug_pivot()?.shown);
	expect((await names()).filter((n) => /\/pivot/.test(n)).length).toBeLessThanOrEqual(2);
	await page.evaluate(() => window.rv_page.hide());
	await page.waitForFunction(() => window.rv_page.debug_handles().length === 0);
	expect(problems, "console errors/warnings").toEqual([]);
});
