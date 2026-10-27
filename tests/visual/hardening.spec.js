// @ts-check
// Production hardening of the front end: keyboard sorting, Excel export and its server job, lazy Pages, grouping that reads nothing.
// Fails on any console error or warning (helpers.js watch_console).
const { test, expect } = require("@playwright/test");
const {
	rv,
	watch_console,
	open,
	settle,
	body,
	shown,
	to_grid,
	to_pivot,
	grid_back,
} = require("./helpers.js");


// ------------------------------------------------------------ production hardening (front end)

test("a11y: a column title sorts with Enter and Space, keeps the focus, and aria-sort says the sort", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=ar&lang=en");
	await settle(page);
	const key = await page.evaluate(() => window.rv_page.grid.model.data[0].column.key);
	const title = page.locator(`regular-table thead .rv-hcell[data-col="${key}"] .rv-hlabel`);
	await expect(title).toHaveAttribute("role", "button");
	await expect(title).toHaveAttribute("tabindex", "0");
	const sort_of = () => page.evaluate((key) => ({
		state: window.rv_page.state.sort.find((s) => s.key === key)?.dir || null,
		aria: document.querySelector(`regular-table thead .rv-hcell[data-col="${key}"]`).closest("th").getAttribute("aria-sort"),
		focused: document.activeElement?.classList.contains("rv-hlabel") && document.activeElement.closest(".rv-hcell")?.dataset.col === key,
	}), key);
	await title.focus();
	await page.keyboard.press("Enter");
	await page.waitForFunction((key) => window.rv_page.state.sort.some((s) => s.key === key) && window.rv_page.grid.current === window.rv_page.opened, key);
	await settle(page);
	expect(await sort_of()).toEqual({ state: "asc", aria: "ascending", focused: true });
	await page.keyboard.press(" ");
	await page.waitForFunction((key) => window.rv_page.state.sort.find((s) => s.key === key)?.dir === "desc", key);
	await settle(page);
	expect(await sort_of()).toEqual({ state: "desc", aria: "descending", focused: true });
	expect(problems).toEqual([]);
});


test("Excel: the button is the table's; disabled with a note in the pivot, the charts and the pages", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=en");
	await settle(page);
	const button = page.locator('.rv-headbar [data-action="export"]');
	await expect(button).toBeEnabled();
	for (const mode of ["pivot", "charts", "pages"]) {
		await page.locator(`.rv-views [data-mode="${mode}"]`).click();
		await page.waitForFunction((mode) => window.rv_page.state.mode === mode, mode);
		await expect(button).toBeDisabled();
		await expect(button).toHaveAttribute("title", "Excel export is available in the Table view");
	}
	await to_grid(page);
	await expect(button).toBeEnabled();
	expect(problems).toEqual([]);
});


test("Excel: a quick filter (a Trial Balance preset) is exported with its definition; an unknown id is left out", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=en");
	await settle(page);
	let sent = null;
	await page.route("**/api/method/report_view.api.export_xlsx", async (route) => {
		sent = JSON.parse(route.request().postData());
		await route.fulfill({ status: 200, headers: { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="tb.xlsx"' }, body: "PK" });
	});
	await page.evaluate(() => window.rv_page.change((s) => (s.quick_filters = ["debit_closing", "gone"])));
	await page.waitForFunction(() => window.rv_page.grid.current === window.rv_page.opened && window.rv_page.opened.post.fact_filter.length > 0);
	const download = page.waitForEvent("download");
	await page.locator('.rv-headbar [data-action="export"]').click();
	expect((await download).suggestedFilename()).toBe("tb.xlsx");
	expect(sent.export_model.view_state.quick_filters).toEqual(["debit_closing"]);
	expect(sent.export_model.view_state.mode).toBe("grid");
	const defs = sent.export_model.quick_filters;
	expect(defs.map((q) => q.id)).toEqual(["moving", "non_zero", "debit_closing", "credit_closing"]);
	expect(defs.every((q) => Object.keys(q).sort().join() === "expression,id")).toBe(true);
	expect(sent.export_model.expected.row_count).toBe(await page.evaluate(() => window.rv_page.opened.counts.shown));
	expect(problems.filter((p) => !/QUICK_FILTER_UNKNOWN|gone/.test(p))).toEqual([]);
});


test("Excel: a large export is a server job: its state is shown, it can be stopped, the file downloads when done", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=gl&lang=en");
	await settle(page);
	await page.route("**/api/method/report_view.api.export_xlsx", (route) =>
		route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ message: { status: "queued", job: "0123456789abcdef", row_count: 25000 } }) })
	);
	await page.route("**/api/method/report_view.api.export_xlsx_download?*", (route) =>
		route.fulfill({ status: 200, headers: { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="gl.xlsx"' }, body: "PK" })
	);
	// the status: queued, running, then done
	await page.evaluate(() => {
		const server = window.RV_SERVER;
		window.rv_job_calls = [];
		window.rv_cancels = [];
		window.RV_SERVER = (method, args) => {
			if (method === "report_view.api.export_xlsx_cancel") {
				window.rv_cancels.push(args.job);
				return { state: "cancelled", error_code: "cancelled", cancellable: false };
			}
			if (method !== "report_view.api.export_xlsx_status") return server(method, args);
			window.rv_job_calls.push(args.job);
			const n = window.rv_job_calls.length;
			return { state: window.rv_job_hold ? "running" : n < 2 ? "queued" : n < 3 ? "running" : "done", row_count: 25000, error: null, cancellable: window.rv_job_hold === true };
		};
	});
	const job = page.locator(".rv-headbar .rv-xjob");
	const button = page.locator('.rv-headbar [data-action="export"]');
	const download = page.waitForEvent("download");
	await button.click();
	await expect(job).toBeVisible();
	await expect(job).toHaveAttribute("role", "status");
	await expect(job.locator(".txt")).toContainText("25,000");
	await expect(button).toBeDisabled();
	expect((await download).suggestedFilename()).toBe("gl.xlsx");
	await expect(job).toBeHidden();
	await expect(button).toBeEnabled();
	expect(await page.evaluate(() => [...new Set(window.rv_job_calls)])).toEqual(["0123456789abcdef"]);

	// stopping: the server is asked to cancel the job (it says it can); the indicator goes, no file, the button is back
	await page.evaluate(() => {
		window.rv_job_calls = [];
		window.rv_job_hold = true;
	});
	await button.click();
	await expect(job).toBeVisible();
	await page.waitForFunction(() => window.rv_job_calls.length >= 1);
	await job.locator('[data-action="export-stop"]').click();
	await expect(job).toBeHidden();
	await expect(button).toBeEnabled();
	// the button comes back once the wait for the job has ended: no status is asked any more
	const calls = await page.evaluate(() => window.rv_job_calls.length);
	expect(await page.evaluate(() => window.rv_page.export_job)).toBe(null);
	await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
	expect(await page.evaluate(() => window.rv_job_calls.length)).toBe(calls);
	expect(await page.evaluate(() => window.rv_cancels)).toEqual(["0123456789abcdef"]);
	expect(problems).toEqual([]);
});


test("pages: the Pages view is made the first time it is used, not with the page", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=ar&lang=en");
	await settle(page);
	expect(await page.evaluate(() => window.rv_page.pages_view)).toBeNull();
	await page.locator('.rv-views [data-mode="pages"]').click();
	await page.waitForFunction(() => window.rv_page.pages_view && window.rv_page.pages.pages?.length > 0);
	await to_grid(page);
	expect(problems).toEqual([]);
});


test("grouping: a change of density, of subtotals or of mode keeps the grid's views; a fold reads nothing", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=ar&lang=en&group=party");
	await settle(page);
	const kept = () => page.evaluate(() => {
		const p = window.rv_page;
		const same = p.opened === window.rv_kept && p.grid.current === p.opened;
		window.rv_kept = p.opened;
		return same;
	});
	await kept();
	await page.evaluate(() => window.rv_page.set_density("compact"));
	await settle(page);
	expect(await kept()).toBe(true);
	await page.evaluate(() => window.rv_page.set_subtotals(false));
	await settle(page);
	expect(await kept()).toBe(true);
	await to_pivot(page);
	await page.locator('.rv-views [data-mode="grid"]').click();
	await grid_back(page);
	expect(await kept()).toBe(true);
	// the fold of a group: placement only, the grid keeps its view
	const reads = await page.evaluate(async () => {
		const p = window.rv_page;
		const before = p.grid.body_rows;
		await p.grid.toggle_group(0, false);
		return { before, after: p.grid.body_rows, kept: p.grid.current === p.opened };
	});
	expect(reads.kept).toBe(true);
	expect(reads.after).toBeLessThan(reads.before);
	await page.evaluate(() => window.rv_page.set_density("comfortable"));
	expect(problems).toEqual([]);
});
