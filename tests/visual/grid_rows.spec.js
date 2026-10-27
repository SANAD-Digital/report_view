// @ts-check
// Phase 5a-1: subtotal rows, column widths, pinned columns and rows, the report's own rows, folding in the URL, keyboard and lifecycle.
// Fails on any console error or warning (helpers.js watch_console).
const { test, expect } = require("@playwright/test");
const {
	rv,
	PINNED,
	AR_AMOUNTS,
	watch_console,
	open,
	settle,
	wheel_to_end,
	shot,
	probe,
	body,
	shown,
	url_state,
	header,
	width_of,
	drag_handle,
	step,
} = require("./helpers.js");


test("subtotal rows: after every open group, the open header keeps title and count only; off by the checkbox", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=ar&group=account__root_type", { width: 1440, height: 1700 });
	const on = await body(page);
	const groups = on.filter((r) => r.cls.startsWith("group"));
	const feet = on.filter((r) => r.cls === "foot");
	expect(groups.length).toBe(5);
	expect(feet.length).toBe(5);
	// an open group: no numbers in its header, they stand in the subtotal row after its rows
	for (const g of groups) expect(g.nums.every((n) => n === "")).toBe(true);
	for (const f of feet) expect(f.nums.some((n) => /\d/.test(n))).toBe(true);
	expect(feet[0].label).toContain("إجمالي");
	const first_foot = on.findIndex((r) => r.cls === "foot");
	expect(on[first_foot - 1].cls).toBe("");
	expect(on[first_foot + 1].cls).toMatch(/^group/);

	// closed: the header carries the same numbers its subtotal row showed
	await page.locator("regular-table tbody tr.group").first().locator(".rv-caret").click();
	await page.waitForFunction((n) => window.rv_page.grid.body_rows < n, on.length);
	await settle(page);
	const closed = await body(page);
	expect(closed[0].open).toBe("false");
	expect(closed[0].nums).toEqual(feet[0].nums);
	expect(closed.filter((r) => r.cls === "foot").length).toBe(4);

	// option off: no subtotal row, every header shows its numbers
	await page.locator('.rv-gp-tools input[data-action="subtotals"]').uncheck();
	await page.waitForFunction(() => window.rv_page.opened.post.subtotals === false);
	await shown(page);
	await settle(page);
	const off = await body(page);
	expect(off.filter((r) => r.cls === "foot").length).toBe(0);
	expect(off.filter((r) => r.cls.startsWith("group")).every((g) => g.nums.some((n) => /\d/.test(n)))).toBe(true);
	await shot(page, "tb-group-no-subtotals-light-rtl");
	const state = JSON.parse(Buffer.from(await url_state(page), "base64url").toString());
	expect(state.group.subtotals).toBe(false);
	expect(problems, "console errors/warnings").toEqual([]);
});


test("subtotal rows of the report tree: the parent's own row of the report, shown again after its children", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=en", { width: 1440, height: 2900 });
	const on = await body(page);
	const feet = on.filter((r) => r.cls === "foot");
	const open_parents = on.filter((r) => r.open === "true");
	expect(feet.length).toBe(open_parents.length);
	expect(feet.length).toBeGreaterThan(5);
	for (const p of open_parents) expect(p.nums.every((n) => n === "")).toBe(true);
	// the report's values of the first root, as the standard page shows them
	const root = await page.evaluate(() => {
		const row = window.rv_page.report.rows.find((r) => r.__kind === "data");
		return { debit: row.debit, credit: row.credit };
	});
	const text = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2 });
	const root_foot = on.findLast((r) => r.cls === "foot" && r.label.includes(open_parents[0].label.replace(/^\S+\s*(-\s*)?/, "").replace(/\s*\d+$/, "").trim()));
	expect(root_foot.nums).toContain(text(root.debit));
	expect(root_foot.nums).toContain(text(root.credit));
	// status bar and the badge of the grand total count the same thing: the leaf rows
	expect(await page.locator(".rv-status").textContent()).toContain("16 of 16");
	expect(await page.locator(".rv-rt-total .rv-gcount").textContent()).toBe("16");
	expect(problems, "console errors/warnings").toEqual([]);
});


for (const lang of ["ar", "en"]) {
	test(`column width (${lang}): the handle drags towards the end, not under 72px, and the width survives a reload from the URL`, async ({ page }) => {
		const problems = watch_console(page);
		const end = lang === "ar" ? -1 : 1;
		const title = lang === "ar" ? "مدين" : "Debit";
		await open(page, `report=tb&lang=${lang}`);
		const th = header(page, title);
		const before = await width_of(th);
		await shot(page, `tb-column-width-before-light-${lang === "ar" ? "rtl" : "ltr"}`);
		await drag_handle(page, th, end * 80);
		expect(await width_of(th)).toBe(before + 80);
		const state = await page.evaluate(() => window.rv_page.state.columns.widths);
		expect(state).toEqual({ opening_debit: before + 80 });
		// the cells, the total row and the header stay aligned
		const geo = await probe(page);
		expect(geo.total_lefts).toEqual(geo.head_lefts);
		await shot(page, `tb-column-width-after-light-${lang === "ar" ? "rtl" : "ltr"}`);

		// towards the start, far beyond the minimum
		await drag_handle(page, th, end * -600);
		expect(await width_of(th)).toBe(72);

		// the label column too
		const corner = page.locator("regular-table thead th.rv-hd.rt-group-corner").first();
		const label_before = await width_of(corner);
		await drag_handle(page, corner, end * 60);
		expect(await width_of(corner)).toBe(label_before + 60);
		const edge = await page.evaluate(() => Math.round(document.querySelector(".rv-rt-edge").getBoundingClientRect().width));
		expect(edge).toBe(label_before + 60);

		const saved = await url_state(page);
		const widths = JSON.parse(Buffer.from(saved, "base64url").toString()).columns.widths;
		expect(widths).toEqual({ opening_debit: 72, account: label_before + 60 });
		await open(page, `report=tb&lang=${lang}&rv=${saved}`);
		expect(await width_of(header(page, title))).toBe(72);
		expect(await width_of(page.locator("regular-table thead th.rv-hd.rt-group-corner").first())).toBe(label_before + 60);
		expect((await probe(page)).total_lefts).toEqual((await probe(page)).head_lefts);
		expect(problems, "console errors/warnings").toEqual([]);
	});
}


test("column width: a double click on the handle fits the content on screen", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=ar&lang=ar&rv=${rv({ columns: { widths: { party_account: 80, posting_date: 400 } } })}`);
	const th = header(page, "Receivable Account");
	expect(await width_of(th)).toBe(80);
	const clipped = await page.evaluate(() => {
		const td = [...document.querySelectorAll("regular-table tbody td")].find((c) => c.textContent.startsWith("1310"));
		return td.firstElementChild.scrollWidth > td.firstElementChild.clientWidth;
	});
	expect(clipped).toBe(true);
	await th.locator(".rt-column-resize").dblclick();
	await settle(page);
	const fitted = await width_of(th);
	expect(fitted).toBeGreaterThan(120);
	expect(fitted).toBeLessThan(260);
	const fits = await page.evaluate(() =>
		[...document.querySelectorAll("regular-table tbody td")]
			.filter((c) => c.textContent.startsWith("1310"))
			.every((td) => td.firstElementChild.scrollWidth <= td.firstElementChild.clientWidth)
	);
	expect(fits).toBe(true);
	expect(await page.evaluate(() => window.rv_page.state.columns.widths.party_account)).toBe(fitted);
	// the label column shrinks to its content
	const corner = page.locator("regular-table thead th.rv-hd.rt-group-corner").first();
	await corner.locator(".rt-column-resize").dblclick();
	await settle(page);
	expect(await width_of(corner)).toBeLessThan(200);
	await shot(page, "ar-column-autosize-light-rtl");
	expect(problems, "console errors/warnings").toEqual([]);
});


test("pinned columns: columns.pinned.start stay next to the label column while the others scroll", async ({ page }) => {
	const problems = watch_console(page);
	for (const lang of ["ar", "en"]) {
		await open(page, `report=ar&lang=${lang}&rv=${PINNED}`);
		const geo = () =>
			page.evaluate(() => {
				const rt = document.querySelector("regular-table");
				const box = rt.getBoundingClientRect();
				const rtl = document.documentElement.dir === "rtl";
				const start = (el) => Math.round(rtl ? box.right - el.getBoundingClientRect().right : el.getBoundingClientRect().left - box.left);
				const heads = [...rt.querySelectorAll("thead th.rv-hd.rt-group-corner")];
				const row = [...rt.querySelectorAll("tbody tr:first-child th")];
				return {
					titles: heads.map((th) => th.textContent.trim()),
					head_starts: heads.map(start),
					cell_starts: row.map(start),
					cells: row.map((th) => th.textContent.trim()),
					first_x: rt.getMeta(rt.querySelector("tbody td")).x,
					edge: Math.round(document.querySelector(".rv-rt-edge").getBoundingClientRect().width),
					total_pins: [...document.querySelectorAll(".rv-rt-total .rv-c.pinned")].map(start),
				};
			});
		const before = await geo();
		expect(before.titles.slice(1)).toEqual(["Voucher No", "Voucher Type"]);
		expect(before.head_starts[0]).toBeLessThanOrEqual(1);
		expect(before.cell_starts).toEqual(before.head_starts);
		expect(before.total_pins).toEqual(before.head_starts);
		expect(before.cells[1]).toMatch(/^ACC-/);
		expect(before.first_x).toBe(0);
		await page.locator("regular-table").hover();
		await page.mouse.wheel(lang === "ar" ? -700 : 700, 0);
		await page.waitForTimeout(300);
		await settle(page);
		const after = await geo();
		expect(after.first_x).toBeGreaterThan(0);
		expect(after.head_starts).toEqual(before.head_starts);
		expect(after.cell_starts).toEqual(before.head_starts);
		expect(after.cells).toEqual(before.cells);
		// the shadow stands at the end of the last pinned column
		expect(after.edge).toBe(before.head_starts[2] + (await width_of(page.locator("regular-table thead th.rv-hd.rt-group-corner").nth(2))));
		const all = await probe(page);
		expect(all.total_lefts).toEqual(all.head_lefts);
		await shot(page, `ar-pinned-columns-scrolled-light-${lang === "ar" ? "rtl" : "ltr"}`);
	}
	// on a phone only the label column is pinned: the others would leave no room
	await open(page, `report=ar&lang=ar&rv=${PINNED}`, { width: 390, height: 844 });
	expect(await page.locator("regular-table thead th.rv-hd.rt-group-corner").count()).toBe(1);
	expect(problems, "console errors/warnings").toEqual([]);
});


test("general ledger: the report's opening row under the headers, its closing row above the grand total", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=gl&lang=ar", { width: 1440, height: 800 });
	const layout = () =>
		page.evaluate(() => {
			const rt = document.querySelector("regular-table");
			const r = (el) => el.getBoundingClientRect();
			const top = document.querySelector(".rv-rt-top");
			const first = [...rt.querySelectorAll("tbody tr:not(.spacer):not(.stale)")][0];
			const text = (sel) => [...document.querySelectorAll(sel)].map((el) => el.textContent.trim());
			return {
				top_rows: text(".rv-rt-top .rv-row .rv-pin-label"),
				bottom_rows: text(".rv-rt-bottom .rv-row .rv-pin-label"),
				gap_head: Math.round(r(top).top - r(rt.querySelector("thead")).bottom),
				gap_first: Math.round(r(first).top - r(top).bottom),
				first_y: rt.getMeta(first.firstElementChild).y,
				top_width: Math.round(r(top).width),
				table_width: rt.clientWidth,
				total: text(".rv-rt-total .rv-c.num"),
				closing: text(".rv-rt-closing .rv-c.num"),
				counts: window.rv_page.opened.counts,
				expected: window.rv_page.export_model().expected,
			};
		});
	const at_top = await layout();
	expect(at_top.top_rows).toEqual(["Opening"]);
	expect(at_top.bottom_rows[0]).toBe("Closing (Opening + Total)");
	expect(at_top.bottom_rows[1]).toContain("الإجمالي العام");
	expect(at_top.gap_head).toBe(0);
	// the first fact stands right under the pinned row, not behind it
	expect(at_top.gap_first).toBe(0);
	expect(at_top.first_y).toBe(1);
	expect(at_top.top_width).toBe(at_top.table_width);
	// the grand total is the report's own 'Total' row: balance 0, not the sum of running balances
	expect(at_top.total.slice(0, 3)).toEqual(["2,521,940.00", "2,521,940.00", "—"]);
	expect(at_top.closing.slice(0, 3)).toEqual(["2,521,940.00", "2,521,940.00", "—"]);
	expect(at_top.counts).toEqual({ shown: 47, total: 47, facts: 47, groups: null });
	// the export is compared with the 47 facts and the grand total as shown
	expect(at_top.expected.row_count).toBe(47);
	expect(at_top.expected.totals.debit).toBe(2521940);
	expect(at_top.expected.totals.balance).toBe(0);

	// scrolled to the end: the opening row stays, the last fact ends above the closing row
	await wheel_to_end(page, 0, 100000);
	await page.waitForTimeout(300);
	await settle(page);
	const at_end = await page.evaluate(() => {
		const rt = document.querySelector("regular-table");
		const live = [...rt.querySelectorAll("tbody tr:not(.stale)")];
		return {
			top_rows: document.querySelectorAll(".rv-rt-top .rv-row").length,
			last_y: rt.getMeta(live.at(-1).firstElementChild).y,
			rows: window.rv_page.grid.body_rows,
			last_bottom: Math.round(live.at(-1).getBoundingClientRect().bottom - rt.getBoundingClientRect().top - rt.clientHeight),
		};
	});
	expect(at_end.top_rows).toBe(1);
	expect(at_end.rows).toBe(48);
	expect(at_end.last_y).toBe(47);
	expect(Math.abs(at_end.last_bottom)).toBeLessThanOrEqual(1);
	await shot(page, "gl-pinned-rows-scrolled-end-light-rtl");

	// a browser filter: the report's rows no longer describe what is shown and leave the screen
	await open(page, `report=gl&lang=ar&rv=${rv({ filters: [{ key: "debit", type: "range", min: 100, max: null }] })}`, { width: 1440, height: 800 });
	const filtered = await layout();
	expect(filtered.top_rows).toEqual([]);
	expect(filtered.bottom_rows.length).toBe(1);
	expect(filtered.first_y).toBe(0);
	expect(filtered.counts.shown).toBeLessThan(47);
	expect(filtered.counts.total).toBe(47);
	await shot(page, "gl-filtered-no-pinned-rows-light-rtl");
	// grouping reads the facts only
	await open(page, "report=gl&lang=ar&group=account", { width: 1440, height: 800 });
	expect(await page.locator(".rv-rt-top .rv-row").count()).toBe(0);
	expect(await page.locator(".rv-rt-bottom .rv-row").count()).toBe(1);
	expect(problems, "console errors/warnings").toEqual([]);
});


test("rows as reported: the opening, total and closing of every account stand between its entries", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=gl_account&lang=ar", { width: 1440, height: 1500 });
	// they are on screen: nothing to announce
	await expect(page.locator(".rv-notice")).toBeHidden();
	const info = await page.evaluate(() => ({
		shape: window.rv_page.opened.post.shape,
		counts: window.rv_page.opened.counts,
		expected: window.rv_page.export_model().expected,
		rows: window.rv_page.grid.body_rows,
		top: [...document.querySelectorAll(".rv-rt-top .rv-row .rv-pin-label")].map((el) => el.textContent.trim()),
		bottom: [...document.querySelectorAll(".rv-rt-bottom .rv-row .rv-pin-label")].map((el) => el.textContent.trim()),
		total: [...document.querySelectorAll(".rv-rt-total .rv-c.num")].map((el) => el.textContent.trim()),
		tools: Boolean(document.querySelector(".rv-gp-tools [data-action=\"expand-all\"]:not([hidden])")),
	}));
	expect(info.shape).toBe("report");
	// the report's own opening (pinned), then 48 entries and the 24 rows of the 8 accounts
	expect(info.rows).toBe(1 + 48 + 24);
	expect(info.top).toEqual(["Opening"]);
	expect(info.bottom[0]).toBe("Closing (Opening + Total)");
	expect(info.bottom[1]).toContain("الإجمالي العام");
	expect(info.total.slice(0, 2)).toEqual(["2,521,940.00", "2,521,940.00"]);
	// rows = the entries, in the status bar, in the badge of the grand total and in the export
	expect(info.counts).toEqual({ shown: 48, total: 48, facts: 48, groups: null });
	expect(info.bottom[1]).toContain("48");
	expect(info.expected.row_count).toBe(48);
	expect(info.expected.totals.debit).toBe(2521940);
	// nothing to fold in a list of report rows
	expect(info.tools).toBe(false);

	const rows = (await body(page)).filter((r) => r.cls !== "spacer");
	// the first account: its opening balance, its 21 entries, its total, its closing
	expect(rows[0].cls).toBe("opening");
	expect(rows[0].label).toBe("Opening");
	expect(rows[0].nums.slice(0, 3)).toEqual(["469.00", "—", "469.00"]);
	expect(rows.slice(1, 22).every((r) => r.cls === "")).toBe(true);
	expect(rows[22].cls).toBe("foot");
	expect(rows[22].label).toBe("Total");
	expect(rows[22].nums.slice(0, 3)).toEqual(["53,831.00", "100.00", "53,731.00"]);
	expect(rows[23].cls).toBe("foot closing");
	expect(rows[23].label).toBe("Closing (Opening + Total)");
	expect(rows[23].nums.slice(0, 3)).toEqual(["54,300.00", "100.00", "54,200.00"]);
	// then the opening of the next account
	expect(rows[24].cls).toBe("opening");
	expect(rows[24].nums.slice(0, 3)).toEqual(["—", "469.00", "-469.00"]);
	// a summary row carries captions, never a link
	expect(await page.locator("regular-table tbody tr.opening a, regular-table tbody tr.foot a").count()).toBe(0);

	// the end of the report: the last account closes right above the pinned rows
	await wheel_to_end(page, 0, 100000);
	await page.waitForTimeout(300);
	await settle(page);
	const last = (await body(page)).filter((r) => r.cls !== "spacer").slice(-2);
	expect(last.map((r) => r.cls)).toEqual(["foot", "foot closing"]);
	await shot(page, "gl-by-account-as-reported-scrolled-end-light-rtl");
	expect(problems, "console errors/warnings").toEqual([]);
});


test("rows as reported: the total of every party stands after its invoices", async ({ page }) => {
	const problems = watch_console(page);
	// hidden columns are no filter: the rows stay as reported
	await open(page, `report=ar_party&lang=ar&rv=${AR_AMOUNTS}`);
	await expect(page.locator(".rv-notice")).toBeHidden();
	const info = await page.evaluate(() => ({
		shape: window.rv_page.opened.post.shape,
		rows: window.rv_page.grid.body_rows,
		counts: window.rv_page.opened.counts,
		pinned: document.querySelectorAll(".rv-rt-top .rv-row, .rv-rt-closing").length,
	}));
	expect(info.shape).toBe("report");
	expect(info.rows).toBe(66 + 6);
	expect(info.counts).toEqual({ shown: 66, total: 66, facts: 66, groups: null });
	expect(info.pinned).toBe(0);
	const rows = await body(page);
	// Clint: four invoices, then the party's own total as the report returned it
	expect(rows.slice(0, 4).every((r) => r.cls === "")).toBe(true);
	expect(rows[4].cls).toBe("foot");
	expect(rows[4].label).toBe("Clint");
	// invoiced, paid, credit note, outstanding: the values of the report's own row
	expect(rows[4].nums.slice(0, 4)).toEqual(["—", "11,275.00", "—", "-11,275.00"]);
	expect(rows[7].cls).toBe("foot");
	expect(rows[7].label).toBe("f");
	expect(rows[7].nums.slice(0, 4)).toEqual(["—", "200.00", "—", "-200.00"]);
	expect(problems, "console errors/warnings").toEqual([]);
});


test("rows as reported: a filter, a grouping or a sort reads the facts, and says that the report's rows are hidden", async ({ page }) => {
	const problems = watch_console(page);
	const kinds = () => page.evaluate(() => window.rv_page.debug_handles().map((h) => h.kind).sort());
	const look = () =>
		page.evaluate(() => ({
			shape: window.rv_page.opened.post.shape,
			table: window.rv_page.opened.spec.table,
			rows: window.rv_page.grid.body_rows,
			top: document.querySelectorAll(".rv-rt-top .rv-row").length,
			closing: document.querySelectorAll(".rv-rt-closing").length,
			summary: document.querySelectorAll("regular-table tbody tr.opening, regular-table tbody tr.foot").length,
			expected: window.rv_page.export_model().expected,
		}));
	const set = async (patch) => {
		await page.evaluate(async (p) => {
			Object.assign(window.rv_page.state, { filters: [], sort: [], ...p.state });
			window.rv_page.state.group.by = p.by || [];
			await window.rv_page.render();
		}, patch);
		await shown(page);
		await settle(page);
	};
	await open(page, "report=gl_account&lang=ar");
	// the facts table and the rows table of the report, one view
	expect(await kinds()).toEqual(["table", "table", "view"]);
	const bar = page.locator(".rv-notice");
	await expect(bar).toBeHidden();

	// a sort: the entries sorted; the report's opening, closing and total stay pinned
	await set({ state: { sort: [{ key: "debit", dir: "desc" }] } });
	const sorted = await look();
	expect(sorted).toMatchObject({ shape: "flat", table: "facts", rows: 1 + 48, top: 1, closing: 1, summary: 0 });
	expect(sorted.expected).toMatchObject({ row_count: 48, totals: { debit: 2521940 } });
	await expect(bar).toBeVisible();
	await expect(bar).toHaveClass(/info/);
	await expect(bar).toContainText("24");
	await expect(bar).toContainText("مخفية");
	await shot(page, "gl-by-account-sorted-facts-light-rtl");

	// a filter: the matching entries and the engine's total; nothing of the report is pinned
	await set({ state: { filters: [{ key: "debit", type: "range", min: 100, max: null }] } });
	const narrowed = await look();
	expect(narrowed).toMatchObject({ shape: "flat", table: "facts", top: 0, closing: 0, summary: 0 });
	expect(narrowed.rows).toBeLessThan(48);
	expect(narrowed.expected.row_count).toBe(narrowed.rows);
	// the same notice: one bar; closed by the user, it stays closed while the notice is the same
	expect(await page.locator(".rv-notice").count()).toBe(1);
	expect(await bar.locator("p").count()).toBe(1);
	await bar.locator(".rv-chip-x").click();
	await expect(bar).toBeHidden();

	// a grouping: groups of the entries, computed by the engine
	await set({ by: ["account"] });
	const grouped = await look();
	expect(grouped).toMatchObject({ shape: "group", table: "facts", top: 0, closing: 0 });
	await expect(bar).toBeHidden();

	// back to the default view: the rows as reported again, and no bar
	await set({});
	const back = await look();
	expect(back).toMatchObject({ shape: "report", table: "rows", rows: 1 + 48 + 24, top: 1, closing: 1 });
	expect(back.summary).toBeGreaterThan(0);
	await expect(bar).toBeHidden();

	// no handle is left behind by 20 changes between the four views
	const steps = [{ state: { sort: [{ key: "credit", dir: "asc" }] } }, { state: { filters: [{ key: "credit", type: "range", min: 1, max: null }] } }, { by: ["voucher_type"] }, {}];
	for (let i = 0; i < 20; i++) {
		await set(steps[i % steps.length]);
		expect(await kinds(), `change ${i}`).toEqual(steps[i % steps.length].by ? ["table", "table", "view", "view"] : ["table", "table", "view"]);
	}
	await page.evaluate(() => window.rv_page.hide());
	await page.waitForFunction(() => window.rv_page.debug_handles().length === 0);
	expect(problems, "console errors/warnings").toEqual([]);
});


test("filters the engine cannot express are told to the user, once", async ({ page }) => {
	const problems = watch_console(page);
	const filters = [
		{ key: "voucher_type", type: "text", op: "not_contains", value: "Journal" },
		{ key: "*", type: "text", op: "contains", value: "SND", source: "search" },
		{ key: "paid", type: "range", min: 1, max: null },
	];
	await open(page, `report=ar&lang=ar&rv=${rv({ filters })}`);
	const bar = page.locator(".rv-notice");
	await expect(bar).toBeVisible();
	await expect(bar).toHaveClass(/warn/);
	expect(await bar.locator("p").count()).toBe(3);
	await expect(bar).toContainText("نوع السند");
	await expect(bar).toContainText("البحث الحر");
	// the filter that can be expressed is applied
	const counts = await page.evaluate(() => window.rv_page.opened.counts);
	expect(counts.shown).toBeLessThan(counts.total);
	await shot(page, "ar-unsupported-filters-notice-light-rtl");
	// the same notices on the next render: one bar, not a second one
	await page.evaluate(() => window.rv_page.render());
	await shown(page);
	expect(await page.locator(".rv-notice").count()).toBe(1);
	expect(await bar.locator("p").count()).toBe(3);
	// no such filter: no bar
	await open(page, "report=ar&lang=ar");
	await expect(page.locator(".rv-notice")).toBeHidden();
	expect(problems, "console errors/warnings").toEqual([]);
});


test("fold of the report tree: kept in the URL, restored from it; expand all and collapse all", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=ar", { width: 1440, height: 2600 });
	const labels = async () => (await body(page)).map((r) => `${r.cls}|${r.label}`);
	// close the second root, then a parent inside the first one
	await page.locator("regular-table tbody tr.group.d0").nth(1).locator(".rv-caret").click();
	await page.waitForFunction(() => Array.isArray(window.rv_page.state.tree.expanded));
	await shown(page);
	await settle(page);
	const before = await page.evaluate(() => window.rv_page.opened.body_rows);
	await page.locator("regular-table tbody tr.group.d1").first().locator(".rv-caret").click();
	await page.waitForFunction((n) => window.rv_page.opened.body_rows < n, before);
	await shown(page);
	await settle(page);
	const folded = await labels();
	const saved = await url_state(page);
	const expanded = JSON.parse(Buffer.from(saved, "base64url").toString()).tree.expanded;
	expect(expanded.length).toBeGreaterThan(0);
	await open(page, `report=tb&lang=ar&rv=${saved}`, { width: 1440, height: 2600 });
	expect(await labels()).toEqual(folded);
	await shot(page, "tb-tree-fold-from-url-light-rtl");

	await page.locator('.rv-gp-tools [data-action="collapse-all"]').click();
	await page.waitForFunction(() => window.rv_page.opened.body_rows === 4);
	await shown(page);
	await settle(page);
	const roots = await body(page);
	expect(roots.length).toBe(4);
	expect(roots.every((r) => r.open === "false" && r.nums.some((n) => /\d/.test(n)))).toBe(true);
	await shot(page, "tb-tree-collapse-all-light-rtl");
	const collapsed = await url_state(page);
	expect(JSON.parse(Buffer.from(collapsed, "base64url").toString()).tree).toEqual({ depth: 0, expanded: null });

	await page.locator('.rv-gp-tools [data-action="expand-all"]').click();
	await page.waitForFunction(() => window.rv_page.opened.body_rows === 31);
	await shown(page);
	await settle(page);
	const all = await body(page);
	expect(all.filter((r) => r.open === "false").length).toBe(0);
	expect(all.filter((r) => r.cls === "foot").length).toBe(15);
	expect(problems, "console errors/warnings").toEqual([]);
});


test("fold of a grouping: kept in the URL as paths, restored from it; expand all and collapse all", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=ar&lang=en&group=party", { width: 1440, height: 900 });
	expect(await page.evaluate(() => window.rv_page.state.group.expanded)).toBe("all");
	const tools = page.locator(".rv-gp-tools");
	await tools.locator('[data-action="collapse-all"]').click();
	await page.waitForFunction(() => window.rv_page.opened.post.depth === 0);
	await shown(page);
	await settle(page);
	const closed = await body(page);
	expect(closed.length).toBe(6);
	expect(closed.every((r) => r.open === "false")).toBe(true);
	// open two groups by hand
	await page.locator("regular-table tbody tr.group").nth(1).locator(".rv-caret").click();
	await page.waitForFunction(() => Array.isArray(window.rv_page.state.group.expanded));
	await settle(page);
	await page.locator("regular-table tbody tr.group").first().locator(".rv-caret").click();
	await page.waitForFunction(() => window.rv_page.state.group.expanded.length === 2);
	await settle(page);
	const views_before = await page.evaluate(() => window.rv_page.render_token);
	const folded = (await body(page)).map((r) => `${r.cls}|${r.label}|${r.open}`);
	const saved = await url_state(page);
	const state = JSON.parse(Buffer.from(saved, "base64url").toString());
	expect(state.group.expanded.length).toBe(2);
	expect(state.group.expanded.every((p) => Array.isArray(p) && p.length === 1)).toBe(true);
	// a fold of a group is done in the view: no new view was opened for it
	expect(await page.evaluate(() => window.rv_page.render_token)).toBe(views_before);
	await shot(page, "ar-group-fold-light-ltr");

	await open(page, `report=ar&lang=en&rv=${saved}`, { width: 1440, height: 900 });
	expect((await body(page)).map((r) => `${r.cls}|${r.label}|${r.open}`)).toEqual(folded);
	await shot(page, "ar-group-fold-from-url-light-ltr");

	await page.locator('.rv-gp-tools [data-action="expand-all"]').click();
	await page.waitForFunction(() => window.rv_page.state.group.expanded === "all" && window.rv_page.grid.body_rows === 66 + 6 + 6);
	expect(problems, "console errors/warnings").toEqual([]);
});


test("keyboard: Enter and Space on the caret fold and open, the focus stays on it", async ({ page }) => {
	const problems = watch_console(page);
	for (const query of ["report=tb&lang=ar", "report=ar&lang=ar&group=party"]) {
		await open(page, query);
		const rows = () => page.evaluate(() => window.rv_page.grid.body_rows);
		const focused = () =>
			page.evaluate(() => {
				const el = document.activeElement;
				return el?.classList.contains("rv-caret") ? el.getAttribute("aria-expanded") : null;
			});
		const all = await rows();
		await page.locator("regular-table tbody tr.group").first().locator(".rv-caret").focus();
		expect(await focused()).toBe("true");
		await page.keyboard.press("Enter");
		await page.waitForFunction((n) => window.rv_page.grid.body_rows < n, all);
		await shown(page);
		await settle(page);
		expect(await focused()).toBe("false");
		await page.keyboard.press("Space");
		await page.waitForFunction((n) => window.rv_page.grid.body_rows === n, all);
		await shown(page);
		await settle(page);
		expect(await focused()).toBe("true");
	}
	// the toolbar tools are reachable and named
	await expect(page.locator('.rv-gp-tools [data-action="expand-all"]')).toHaveAttribute("aria-label", "توسيع الكل");
	await expect(page.locator('.rv-gp-tools [data-action="collapse-all"]')).toHaveAttribute("aria-label", "طي الكل");
	expect(problems, "console errors/warnings").toEqual([]);
});


test("loading state: the first run of a page says that the engine is being prepared", async ({ page }) => {
	const problems = watch_console(page);
	await page.addInitScript(() => {
		window.rv_seen = [];
		new MutationObserver(() => {
			const p = document.querySelector('.rv-state[data-state="loading"] p');
			if (p && !window.rv_seen.includes(p.textContent)) window.rv_seen.push(p.textContent);
		}).observe(document, { childList: true, subtree: true });
	});
	await open(page, "report=tb&lang=ar");
	expect(await page.evaluate(() => window.rv_seen)).toEqual(["جارٍ تجهيز المحرك…"]);
	// the engine is ready: a second run loads the report only
	await page.evaluate(() => {
		window.rv_seen = [];
		return window.rv_page.run();
	});
	await shown(page);
	expect(await page.evaluate(() => window.rv_seen)).toEqual([]);
	expect(problems, "console errors/warnings").toEqual([]);
});


test("lifecycle: no handle is left after 20 changes of fold, subtotals, widths and grouping", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=ar&lang=ar&group=party");
	const kinds = () => page.evaluate(() => window.rv_page.debug_handles().map((h) => h.kind).sort());
	expect(await kinds()).toEqual(["table", "view", "view"]);
	const tools = page.locator(".rv-gp-tools");
	for (let i = 0; i < 20; i++) {
		const step = i % 5;
		if (step === 0) await tools.locator('[data-action="collapse-all"]').click();
		else if (step === 1) await page.locator("regular-table tbody tr.group").first().locator(".rv-caret").click();
		else if (step === 2) await tools.locator('input[data-action="subtotals"]').click();
		else if (step === 3) await drag_handle(page, page.locator("regular-table thead th.rv-hd").nth(2), i % 2 ? 30 : -30);
		else await tools.locator('[data-action="expand-all"]').click();
		await page.waitForTimeout(120);
		await shown(page);
		await settle(page);
		expect(await kinds(), `change ${i}`).toEqual(["table", "view", "view"]);
	}
	// a tree report, through its three shapes
	await open(page, "report=tb&lang=ar");
	for (let i = 0; i < 20; i++) {
		await page.evaluate(async (k) => {
			const s = window.rv_page.state;
			if (k % 4 === 0) s.tree = { depth: 0, expanded: null };
			else if (k % 4 === 1) s.tree = { depth: null, expanded: [0, 1] };
			else if (k % 4 === 2) s.filters = s.filters.length ? [] : [{ key: "debit", type: "range", min: 1, max: null }];
			else s.group.subtotals = !s.group.subtotals;
			await window.rv_page.render();
		}, i);
		await shown(page);
		expect(await kinds(), `tree change ${i}`).toEqual(["table", "table", "view"]);
	}
	await page.evaluate(() => window.rv_page.hide());
	await page.waitForFunction(() => window.rv_page.debug_handles().length === 0);
	expect(problems, "console errors/warnings").toEqual([]);
});
