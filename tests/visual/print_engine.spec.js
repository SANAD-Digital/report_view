// @ts-check
// The print engine: print formats' styles, the print limit, print runs, errors that stop a print, PDF jobs, phones.
// Fails on any console error or warning (helpers.js watch_console).
const { test, expect } = require("@playwright/test");
const {
	rv,
	watch_console,
	open,
	settle,
	body,
	shown,
	shot3,
	PAGES,
	pages_settings,
	fake_format,
} = require("./helpers.js");


test("pages: a print format's styles stand once beside the sheets, are printed with them and go once into the PDF", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=gl&lang=en&rv=${PAGES}${pages_settings({ orientation: "portrait" })}`);
	await settle(page);
	await fake_format(page);
	const out = await page.evaluate(async () => {
		const v = window.rv_page.pages;
		const cell = document.querySelector('.rv-print-sheets .rv-page[data-page="0"] .fmt-mark');
		const shown = { pages: v.pages.length, in_sheets: v.sheets.querySelectorAll("style").length, shared: v.fmt_css.querySelectorAll("style").length, spacing: getComputedStyle(cell).letterSpacing };
		const restore = await v.prepare_print();
		const root = document.querySelector("body > .rv-print-root");
		const printed = { first: root.firstElementChild === v.fmt_css, filled: v.filled.size };
		const html = await v.print_document(v.print_root);
		restore();
		return {
			shown,
			printed,
			// core/pdf.py splits the sheets at the paper's <style> right after them
			split_mark: html.includes("</div><style>@page{"),
			copies: html.split(".fmt-mark{letter-spacing:3px}").length - 1,
			back: v.stage.contains(v.fmt_css) && v.fmt_css.nextElementSibling === v.sheets,
		};
	});
	expect(out.shown.pages).toBeGreaterThan(3);
	expect(out.shown.in_sheets).toBe(0);
	expect(out.shown.shared).toBeGreaterThan(0);
	expect(out.shown.spacing).toBe("3px");
	expect(out.printed).toEqual({ first: true, filled: out.shown.pages });
	expect(out.split_mark).toBe(true);
	expect(out.copies).toBe(1);
	expect(out.back).toBe(true);
	// back to the standard template: the format's styles leave the page
	await page.evaluate(async () => {
		const v = window.rv_page.pages;
		v.update({ template: "" });
		await v.ready;
	});
	expect(await page.evaluate(() => window.rv_page.pages.fmt_css.childElementCount)).toBe(0);
	expect(problems, "console errors/warnings").toEqual([]);
});


test("pages: a report longer than the print limit mounts the pages that can print and says how many more there are; far sheets are skipped by the browser", async ({ page }) => {
	const problems = watch_console(page);
	await page.addInitScript(() => (window.RV_PRINT_DEFAULTS = {}));
	await open(page, `report=gl&lang=ar&rows=40000&rv=${PAGES}${pages_settings({ orientation: "portrait" })}`);
	await settle(page);
	const out = await page.evaluate(() => {
		const v = window.rv_page.pages;
		const max = v.max_pages();
		return {
			pages: v.pages.length,
			max,
			sheets: v.sheets.querySelectorAll(":scope > .rv-page").length,
			more: document.querySelector(".rv-print-sheets > .rv-print-more")?.textContent || "",
			thumbs: v.thumbs.children.length,
			visibility: getComputedStyle(v.sheets.querySelector(".rv-page")).contentVisibility,
			thumb_visibility: getComputedStyle(v.thumbs.querySelector("button")).contentVisibility,
		};
	});
	expect(out.pages).toBeGreaterThan(out.max);
	expect(out.sheets).toBe(out.max);
	expect(out.thumbs).toBe(out.max);
	expect(out.more).toContain("Excel");
	expect(out.visibility).toBe("auto");
	expect(out.thumb_visibility).toBe("auto");
	// the end of the stage: the last page fills, the card stays a card
	await page.evaluate(() => {
		const stage = document.querySelector(".rv-print-stage");
		stage.scrollTop = stage.scrollHeight;
	});
	await page.waitForTimeout(400);
	await settle(page);
	expect(await page.evaluate(() => window.rv_page.pages.filled.has(window.rv_page.pages.max_pages() - 1))).toBe(true);
	await shot3(page, "pages-gl-over-the-limit-rtl");
	expect(problems, "console errors/warnings").toEqual([]);
});


test("pages: print fills the pages in runs read at once, then gives the far ones back; printed sheets are all drawn", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=gl&lang=ar&rows=2500&rv=${PAGES}${pages_settings({ orientation: "portrait" })}`);
	await settle(page);
	const out = await page.evaluate(async () => {
		const v = window.rv_page.pages;
		let reads = 0;
		const read = v.rows.read_values.bind(v.rows);
		v.rows.read_values = (...a) => ((reads += 1), read(...a));
		const t0 = performance.now();
		const restore = await v.prepare_print();
		const ms = performance.now() - t0;
		const sheets = [...document.querySelectorAll("body > .rv-print-root .rv-page")];
		const empty = sheets.filter((s) => !s.querySelector(".rv-pt tbody tr")).length;
		const visibility = getComputedStyle(sheets.at(-1)).contentVisibility;
		restore();
		return { pages: v.pages.length, reads, ms, empty, visibility, filled_after: v.filled.size };
	});
	expect(out.pages).toBeGreaterThan(40);
	expect(out.empty).toBe(0);
	// a read per run of pages, not one per page
	expect(out.reads).toBeLessThan(out.pages / 4);
	expect(out.visibility).toBe("visible");
	expect(out.filled_after).toBeLessThanOrEqual(16);
	expect(problems, "console errors/warnings").toEqual([]);
});


test("pages: pages that cannot be drawn or laid out never go to print or PDF: a message says so and nothing is printed", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=gl&lang=en&rows=2500&rv=${PAGES}${pages_settings({ orientation: "portrait" })}`);
	await settle(page);
	const out = await page.evaluate(async () => {
		const v = window.rv_page.pages;
		const note = () => document.querySelector(".rv-print-note").textContent;
		let printed = 0;
		window.print = () => (printed += 1);
		let posted = 0;
		const real_fetch = window.fetch;
		window.fetch = (...a) => (String(a[0]).includes("pages_pdf") ? ((posted += 1), Promise.reject(new Error("not to be sent"))) : real_fetch(...a));
		// the far pages are not drawn yet: reading their rows fails
		const read = v.rows.read_values;
		v.rows.read_values = () => Promise.reject(new Error("the view is gone"));
		window.rv_dialogs = [];
		document.querySelector('.rv-print-ft [data-action="print"]').click();
		await new Promise((r) => setTimeout(r, 0));
		while (v.printing) await new Promise((r) => setTimeout(r, 20));
		const print = {
			printed,
			dialogs: window.rv_dialogs.map((d) => d.title),
			message: window.rv_dialogs[0]?.message || "",
			note: note(),
			root: Boolean(document.querySelector("body > .rv-print-root")),
			in_stage: Boolean(document.querySelector(".rv-print-stage .rv-print-sheets")),
			button: document.querySelector('.rv-print-ft [data-action="print"]').disabled,
		};
		window.rv_dialogs = [];
		await v.pdf();
		const pdf = { posted, dialogs: window.rv_dialogs.map((d) => d.title), button: document.querySelector('.rv-print-ft [data-action="pdf"]').disabled };
		v.rows.read_values = read;
		// a layout that fails: the change does not reject, the panel says why, print refuses
		const layout = v.layout_standard;
		v.layout_standard = () => Promise.reject(new Error("no room"));
		v.update({ orientation: "landscape" });
		const ready = await v.ready.then(
			() => "resolved",
			() => "rejected"
		);
		const layout_note = note();
		window.rv_dialogs = [];
		await v.print();
		const after_layout = { printed, dialogs: window.rv_dialogs.map((d) => d.title) };
		v.layout_standard = layout;
		v.update({ orientation: "portrait" });
		await v.ready;
		window.fetch = real_fetch;
		return { print, pdf, ready, layout_note, after_layout, error: v.layout_error, pages: v.pages.length };
	});
	expect(out.print.printed).toBe(0);
	expect(out.print.dialogs).toEqual(["Nothing was printed"]);
	expect(out.print.message).toMatch(/of [\d,]+ pages could not be drawn, so nothing was printed/);
	expect(out.print.message).toContain("the view is gone");
	expect(out.print.note).toMatch(/could not be drawn/);
	// the sheets are back on the stage, the button again usable
	expect(out.print).toMatchObject({ root: false, in_stage: true, button: false });
	expect(out.pdf).toEqual({ posted: 0, dialogs: ["Nothing was printed"], button: false });
	expect(out.ready).toBe("resolved");
	expect(out.layout_note).toContain("The pages could not be laid out: no room");
	expect(out.after_layout).toEqual({ printed: 0, dialogs: ["Nothing was printed"] });
	// a layout that works again clears the failure
	expect(out.error).toBe(null);
	expect(out.pages).toBeGreaterThan(40);
	expect(problems, "console errors/warnings").toEqual([]);
});


test("pages: the link to the letter head builder follows the permission to write Letter Heads, not a role", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=tb&lang=en&rv=${PAGES}`);
	await settle(page);
	const links = await page.evaluate(() => {
		const v = window.rv_page.pages;
		v.open_secs = new Set(["head"]);
		const seen = {};
		for (const [name, can] of [["none", undefined], ["no", () => false], ["yes", (dt) => dt === "Letter Head"]]) {
			if (can) frappe.model.can_write = can;
			else delete frappe.model.can_write;
			v.render_panel();
			seen[name] = document.querySelector(".rv-print-lhb")?.getAttribute("href") || null;
		}
		delete frappe.model.can_write;
		return seen;
	});
	expect(links.none).toBe(null);
	expect(links.no).toBe(null);
	expect(links.yes).toMatch(/^\/desk\/rv-letterhead/);
	expect(problems).toEqual([]);
});


test("harness: frappe.call sends POST unless told, refuses a verb the method's whitelist refuses, and calls error on a failure", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=en");
	await settle(page);
	const out = await page.evaluate(async () => {
		const ask = (opts) =>
			new Promise((resolve) => {
				let always = null;
				frappe.call({ ...opts, always: (r) => (always = r), callback: (r) => resolve({ ok: true, always: Boolean(always), r }), error: (r) => resolve({ ok: false, always: Boolean(always), r }) });
			});
		window.rv_calls = [];
		const get = await ask({ method: "report_view.api.get_meta", args: { report_name: "Trial Balance" }, type: "GET" });
		const wrong = await ask({ method: "report_view.api.get_meta", args: { report_name: "Trial Balance" } });
		const failed = await ask({ method: "report_view.api.no_such_method", type: "POST" });
		const rejected = await frappe.call({ method: "report_view.api.no_such_method" }).then(
			() => "resolved",
			(r) => r.exc_type
		);
		return { get: get.ok, wrong: [wrong.ok, wrong.always, wrong.r.exc_type], failed: [failed.ok, failed.always], rejected, calls: window.rv_calls.map((c) => c.type), table: window.RV_HTTP_METHODS["report_view.api.run"] };
	});
	expect(out.get).toBe(true);
	expect(out.wrong).toEqual([false, true, "PermissionError"]);
	expect(out.failed).toEqual([false, true]);
	expect(out.rejected).toBe("ValidationError");
	expect(out.calls).toEqual(["GET", "POST", "POST", "POST"]);
	expect(out.table).toEqual(["POST"]);
	expect(problems).toEqual(["error: harness: report_view.api.get_meta allows GET, the page sent POST"]);
});


test("pages: the default colours of the rules, border and watermark are the paper's tokens; a chosen colour is kept as chosen", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=gl&lang=en&rv=${PAGES}${pages_settings({ orientation: "portrait", pb_on: true, wm_type: "text", wm_text: "DRAFT", head_line_w: 1 })}`);
	await settle(page);
	const out = await page.evaluate(() => {
		const v = window.rv_page.pages;
		const root = document.querySelector(".rv-pages").closest(".rv");
		const tok = (n) => getComputedStyle(root).getPropertyValue(n).trim().toLowerCase();
		const page0 = document.querySelector('.rv-print-sheets .rv-page[data-page="0"]');
		return {
			settings: [v.settings.pb_c, v.settings.wm_color, v.settings.head_line_c],
			tokens: { line: tok("--pp-line"), tx: tok("--pp-tx"), mark: tok("--pp-mark") },
			pb: root.style.getPropertyValue("--pp-pb").toLowerCase(),
			head: root.style.getPropertyValue("--pp-head-line").toLowerCase(),
			wm: root.style.getPropertyValue("--pp-wm-color").toLowerCase(),
			border: getComputedStyle(page0.querySelector(".rv-page-border")).borderTopColor,
		};
	});
	expect(out.settings).toEqual(["", "", ""]);
	expect(out.pb).toContain(out.tokens.tx);
	expect(out.head).toBe(`1px solid ${out.tokens.line}`);
	expect(out.wm).toBe(out.tokens.mark);
	expect(out.border).toBe("rgb(27, 31, 29)");
	await page.evaluate(() => window.rv_page.pages.update({ pb_c: "#2d5c93" }));
	expect(await page.evaluate(() => document.querySelector(".rv-pages").closest(".rv").style.getPropertyValue("--pp-pb"))).toContain("#2d5c93");
	expect(problems, "console errors/warnings").toEqual([]);
});


test("pages: a tool's menu listens to the document only while it is open; leaving the pages stops every listener", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=tb&lang=en&rv=${PAGES}`);
	await settle(page);
	const listening = () => page.evaluate(() => Boolean(window.rv_page.pages.listening));
	expect(await listening()).toBe(false);
	await page.click('details[data-sec="paper"] > summary');
	expect(await listening()).toBe(true);
	await page.mouse.click(700, 600);
	expect(await page.locator(".rv-print-pop").count()).toBe(0);
	expect(await listening()).toBe(false);
	await page.click('details[data-sec="paper"] > summary');
	await page.click('.rv-views [data-mode="grid"]');
	await page.waitForFunction(() => window.rv_page.state.mode === "grid" && window.rv_page.grid.rt);
	expect(await listening()).toBe(false);
	expect(problems, "console errors/warnings").toEqual([]);
});


test("pages: a PDF job tells waiting from printing, can be cancelled, and stops when the server cancels or fails it", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=tb&lang=en&rv=${PAGES}`);
	await settle(page);
	const out = await page.evaluate(async () => {
		const v = window.rv_page.pages;
		const answers = [
			{ state: "queued", stage: "queued", done: 0, total: 50, cancellable: true },
			{ state: "queued", stage: "waiting", done: 0, total: 50, cancellable: true },
			{ state: "running", stage: "rendering", done: 20, total: 50, cancellable: true },
		];
		const calls = [];
		const seen = [];
		const real = window.fetch;
		window.fetch = async (url, init) => {
			calls.push(String(url).split("?")[0]);
			if (String(url).includes("pages_pdf_status")) {
				const a = answers.shift() || { state: "failed", stage: "cancelled", error_code: "cancelled", cancellable: false };
				return new Response(JSON.stringify({ message: a }), { status: 200, headers: { "Content-Type": "application/json" } });
			}
			return new Response(JSON.stringify({ message: {} }), { status: 200, headers: { "Content-Type": "application/json" } });
		};
		const spy = setInterval(() => {
			const btn = v.busy_el.querySelector('[data-action="pdf-cancel"]');
			seen.push(`${v.busy_el.querySelector(".txt").textContent}|${btn.hidden ? "" : "cancel"}`);
		}, 250);
		// the server cancels: the wait ends
		await v.wait_pdf_job("abcdef0123456789", 50, "x");
		// the person cancels: the cancel endpoint is asked, the wait ends
		answers.push({ state: "running", stage: "rendering", done: 5, total: 50, cancellable: true });
		const second = v.wait_pdf_job("abcdef0123456789", 50, "x");
		setTimeout(() => v.busy_el.querySelector('[data-action="pdf-cancel"]').click(), 1500);
		await second;
		clearInterval(spy);
		window.fetch = real;
		return { calls, seen: [...new Set(seen)], job: v.pdf_job };
	});
	expect(out.seen.some((s) => s.startsWith("Waiting for the server") && s.endsWith("|cancel"))).toBe(true);
	expect(out.seen.some((s) => /20 of 50/.test(s))).toBe(true);
	expect(out.calls.filter((c) => c.endsWith("pages_pdf_cancel")).length).toBe(1);
	expect(out.calls.some((c) => c.endsWith("pages_pdf_download"))).toBe(false);
	expect(out.job).toBe(null);
	expect(problems, "console errors/warnings").toEqual([]);
});


test("pages: on a phone the sheet has a scrim and a close button, and no field takes the focus (no keyboard, no list)", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=tb&lang=ar&rv=${PAGES}`);
	await settle(page);
	await page.setViewportSize({ width: 440, height: 956 });
	await page.waitForTimeout(300);
	const st = () =>
		page.evaluate(() => {
			const m = document.querySelector(".rv-print-pop");
			const s = document.querySelector(".rv-print-scrim");
			const r = m?.getBoundingClientRect();
			const sr = s?.getBoundingClientRect();
			// the sheet is drawn, not clipped by the toolbar it belongs to: its centre is itself
			const hit = r && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
			return {
				open: Boolean(m),
				drawn: Boolean(hit && m.contains(hit)),
				scrim: sr ? Math.round(sr.width) === innerWidth && Math.round(sr.height) === innerHeight : false,
				focus: document.activeElement === m,
				list: Boolean(document.querySelector(".rv-print-pop .awesomplete > ul:not([hidden])")),
				close: Boolean(m?.querySelector(".rv-pop-x[aria-label]")),
			};
		});
	await page.locator('details[data-sec="tpl"] > summary').click();
	let s = await st();
	expect(s).toEqual({ open: true, drawn: true, scrim: true, focus: true, list: false, close: true });
	await page.locator(".rv-pop-x").click();
	expect((await st()).open).toBe(false);
	await page.locator('details[data-sec="tpl"] > summary').click();
	// a tap on the dimmed pages closes the sheet
	await page.mouse.click(220, 120);
	expect((await st()).open).toBe(false);
	expect(problems).toEqual([]);
});
