// @ts-check
// The Pages view: cutting into pages, page setup, languages, print, virtual sheets, the toolbar and its menus, phones.
// Fails on any console error or warning (helpers.js watch_console).
const { test, expect } = require("@playwright/test");
const {
	rv,
	watch_console,
	open,
	settle,
	body,
	step,
	shot3,
	PAGES,
	pages_settings,
	open_sections,
	pick_link,
	type_num,
	pages_state,
	PAGE_SHOTS,
} = require("./helpers.js");


for (const s of PAGE_SHOTS) {
	test(s.name, async ({ page }) => {
		const problems = watch_console(page);
		await open(page, s.query, s);
		await settle(page);
		await shot3(page, s.name, Boolean(s.full));
		const st = await pages_state(page);
		expect(st.count).toBeGreaterThan(0);
		expect(st.filled).toBeGreaterThan(0);
		expect(problems, "console errors/warnings").toEqual([]);
	});
}


test("pages: the rows of the view are cut into pages without a gap; every page repeats the titles and numbers itself", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=gl&lang=ar&rv=${PAGES}`);
	await settle(page);
	const st = await pages_state(page);
	// contiguous, every display row once
	let at = 0;
	for (const [start, end] of st.pages) {
		expect(start).toBe(at);
		at = end;
	}
	expect(at).toBe(st.rows);
	expect(st.count_text).toContain(String(st.count));
	expect(st.measure.row_h).toBeGreaterThan(10);
	// the report's opening row stands first on the first page, the closing rows and the total last
	expect(st.first_rows[0]).toBe("opening");
	expect(st.total).toBe(true);
	expect(st.titles.length).toBeGreaterThan(5);
	expect(st.footer).toMatch(/1/);
	expect(st.letterhead).toBe(true);
	// every page has the column titles and the footer with its number
	const all = await page.evaluate(async () => {
		const v = window.rv_page.pages;
		await v.fill_all();
		const pages = [...document.querySelectorAll(".rv-page")];
		return pages.map((el, i) => ({
			titles: el.querySelectorAll(".rv-pt thead th").length,
			foot: el.querySelector(".rv-page-foot-line")?.textContent.includes(String(i + 1)),
			rows: el.querySelectorAll(".rv-pt tbody tr").length,
			overflow: el.scrollHeight > el.clientHeight + 1,
		}));
	});
	for (const p of all) {
		expect(p.titles).toBeGreaterThan(5);
		expect(p.foot).toBe(true);
		expect(p.overflow).toBe(false);
	}
	expect(all.reduce((n, p) => n + p.rows, 0)).toBeGreaterThanOrEqual(st.rows);
	expect(problems, "console errors/warnings").toEqual([]);
});


test("pages: paper, orientation, margins, content and columns change the pages; the settings are saved for the user", async ({ page }) => {
	const problems = watch_console(page);
	// the trial balance is too wide for a portrait page: without a saved choice it opens in landscape
	await open(page, `report=tb&lang=en&rv=${PAGES}`);
	await open_sections(page);
	expect((await pages_state(page)).box.w).toBeGreaterThan((await pages_state(page)).box.h);
	await page.click('[data-orient="portrait"]');
	await settle(page);
	await settle(page);
	const portrait = await pages_state(page);
	expect(portrait.box.w).toBeLessThan(portrait.box.h);
	await page.click('[data-orient="landscape"]');
	await settle(page);
	const landscape = await pages_state(page);
	expect(landscape.box.w).toBeGreaterThan(landscape.box.h);
	expect(landscape.measure.body_h).toBeLessThan(portrait.measure.body_h);
	await page.selectOption('select[data-set="size"]', "A3");
	await settle(page);
	const a3 = await pages_state(page);
	expect(a3.box.w).toBeGreaterThan(landscape.box.w);
	await page.click('[data-seg="margins"][data-value="wide"]');
	await settle(page);
	const wide = await pages_state(page);
	expect(wide.box.inner_w).toBeLessThan(a3.box.inner_w);
	// signatures and no grand total
	await page.click('[data-sw="signatures"]');
	await settle(page);
	expect((await pages_state(page)).signatures).toBe(3);
	await page.click('input[data-set="include_total"]');
	await settle(page);
	expect((await pages_state(page)).total).toBe(false);
	// a column hidden for print only: the grid keeps it
	const before = (await pages_state(page)).titles.length;
	await page.click('input[data-col="account__account_type"]');
	await settle(page);
	const after = await pages_state(page);
	expect(after.titles.length).toBe(before - 1);
	expect(after.titles).not.toContain("Account Type");
	// the burst of changes written now (the page writes it after a pause, or when it is left)
	await page.evaluate(() => window.rv_page.flush_settings());
	const saved = await page.evaluate(() => window.rv_test.saved_settings()?.pages);
	expect(saved.orientation).toBe("landscape");
	expect(saved.hidden).toEqual(["account__account_type"]);
	const hidden_in_grid = await page.evaluate(() => window.rv_page.state.columns.hidden);
	expect(hidden_in_grid).not.toContain("account__account_type");
	await shot3(page, "pages-tb-settings-changed-light-ltr");
	expect(problems, "console errors/warnings").toEqual([]);
});


test("pages: another language runs the report again and turns the pages; the session language comes back", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=tb&lang=ar&rv=${PAGES}`);
	await settle(page);
	await open_sections(page);
	const arabic = await pages_state(page);
	expect(arabic.dir).toBe("rtl");
	expect(arabic.footer).toContain("صفحة");
	await pick_link(page, "lang", "en");
	await settle(page);
	const english = await pages_state(page);
	expect(english.dir).toBe("ltr");
	expect(english.footer).toMatch(/Page 1 of/);
	expect(english.titles).toContain("Debit");
	// the fixture's columns are wider than a portrait page: that note may stand, no failure may
	expect(english.note).not.toMatch(/could not|تعذّر/);
	await shot3(page, "pages-tb-english-from-arabic-session");
	await pick_link(page, "lang", "");
	await settle(page);
	const back = await pages_state(page);
	expect(back.dir).toBe("rtl");
	expect(back.titles).toEqual(arabic.titles);
	expect(problems, "console errors/warnings").toEqual([]);
});


test("pages: print fills every page and leaves the sheets alone in the document with the paper's @page rule, then puts them back", async ({ page }) => {
	const problems = watch_console(page);
	// an explicit portrait: the general ledger would open in landscape by itself
	await open(page, `report=gl&lang=ar&rv=${PAGES}${pages_settings({ orientation: "portrait", num_line_w: 2, num_line_c: "#2d5c93", wm_type: "text", wm_text: "سري", wm_color: "#1e5c45", pb_on: true, pb_c: "#8a2d3b" })}`);
	await settle(page);
	const prepared = await page.evaluate(async () => {
		const v = window.rv_page.pages;
		window.__restore = await v.prepare_print();
		const printed = document.querySelector("body > .rv-print-root .rv-page");
		const css = (sel, prop) => getComputedStyle(printed.querySelector(sel))[prop];
		window.__printed = {
			rule: css(".rv-page-foot-line", "borderTopColor"),
			mark: css(".rv-page-wm span", "color"),
			border: css(".rv-page-border", "borderTopColor"),
			adjust: getComputedStyle(printed).printColorAdjust || getComputedStyle(printed).webkitPrintColorAdjust,
			// the foot stays inside the page
			foot_inside: printed.querySelector(".rv-page-foot").getBoundingClientRect().bottom <= printed.getBoundingClientRect().bottom + 0.5,
		};
		const root = document.querySelector("body > .rv-print-root");
		return {
			root: Boolean(root),
			dir: root?.dir,
			css: root?.querySelector("style")?.textContent || "",
			filled: v.filled.size,
			pages: v.pages.length,
			in_stage: Boolean(document.querySelector(".rv-print-stage .rv-print-sheets")),
			button_disabled: document.querySelector('.rv-print-ft [data-action="print"]').disabled,
		};
	});
	expect(prepared.root).toBe(true);
	expect(prepared.dir).toBe("rtl");
	expect(prepared.filled).toBe(prepared.pages);
	expect(prepared.in_stage).toBe(false);
	expect(prepared.button_disabled).toBe(true);
	expect(prepared.css).toContain("@page{size:210mm 297mm;margin:0}");
	// the printed sheets keep the colours of their rules, watermark and border
	const printed = await page.evaluate(() => window.__printed);
	expect(printed.rule).toBe("rgb(45, 92, 147)");
	expect(printed.mark).toBe("rgb(30, 92, 69)");
	expect(printed.border).toBe("rgb(138, 45, 59)");
	expect(printed.foot_inside).toBe(true);
	await page.emulateMedia({ media: "print" });
	// in print only the sheets show (rv_pages.css @media print), one sheet per paper
	const media = await page.evaluate(() => ({
		others: [...document.body.children].filter((el) => !el.classList.contains("rv-print-root")).every((el) => getComputedStyle(el).display === "none"),
		root: getComputedStyle(document.querySelector(".rv-print-root")).display,
		break: getComputedStyle(document.querySelector(".rv-print-root .rv-page")).breakAfter,
	}));
	expect(media).toEqual({ others: true, root: "block", break: "page" });
	await shot3(page, "pages-gl-print-media-rtl", true);
	await page.emulateMedia({ media: "screen" });
	const restored = await page.evaluate(() => {
		window.__restore();
		const v = window.rv_page.pages;
		return {
			root: Boolean(document.querySelector(".rv-print-root")),
			in_stage: Boolean(document.querySelector(".rv-print-stage .rv-print-sheets")),
			printing: v.printing,
			button_disabled: document.querySelector('.rv-print-ft [data-action="print"]').disabled,
		};
	});
	expect(restored).toEqual({ root: false, in_stage: true, printing: false, button_disabled: false });
	expect(problems, "console errors/warnings").toEqual([]);
});


test("pages: only the pages near the viewport carry content; far ones give it back; the Print action of the head opens the pages", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=gl&lang=ar&rows=20000");
	await page.click('.rv-headbar [data-action="print"]');
	await page.waitForFunction(() => window.rv_page.state.mode === "pages" && window.rv_page.pages.pages.length > 0);
	await settle(page);
	const st = await pages_state(page);
	expect(st.count).toBeGreaterThan(100);
	expect(st.filled).toBeLessThan(12);
	await page.evaluate(() => {
		const stage = document.querySelector(".rv-print-stage");
		stage.scrollTop = stage.scrollHeight / 2;
	});
	// the readout follows the scroll, the pages near it are filled
	await page.waitForFunction(() => !document.querySelector(".rv-print-pos").textContent.includes("الصفحة 1 من"));
	await settle(page);
	const mid = await page.evaluate(() => ({ filled: window.rv_page.pages.filled.size, pos: document.querySelector(".rv-print-pos").textContent }));
	expect(mid.filled).toBeLessThan(40);
	expect(mid.pos).not.toContain("الصفحة 1 من");
	await page.click('.rv-views [data-mode="grid"]');
	await page.waitForFunction(() => window.rv_page.state.mode === "grid" && window.rv_page.grid.rt);
	expect(await page.evaluate(() => window.rv_page.pages.pages.length)).toBe(0);
	expect(problems, "console errors/warnings").toEqual([]);
});


test("pages: the standard template's five print styles, in a list of their own; a style is kept for the user", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=tb&lang=ar&rv=${PAGES}${pages_settings({ orientation: "landscape", signatures: true })}`);
	await settle(page);
	await open_sections(page);
	// the template is a Link field (Frappe's search with the user's permissions); empty is the standard one
	const tpl = page.locator('[data-link="template"] input');
	expect(await tpl.inputValue()).toBe("");
	expect(await tpl.getAttribute("placeholder")).toBeTruthy();
	const options = await page.$$eval('select[data-set="style"] option', (os) => os.map((o) => o.value));
	expect(options).toEqual(["classic", "modern", "ledger", "compact", "minimal"]);
	const rows = {};
	for (const look of ["classic", "modern", "ledger", "compact", "minimal"]) {
		await page.selectOption('select[data-set="style"]', look);
		await settle(page);
		const st = await page.evaluate(() => ({
			cls: document.querySelector('.rv-page[data-page="0"]').className,
			row_h: window.rv_page.pages.measure.row_h,
			pages: window.rv_page.pages.pages.length,
		}));
		expect(st.cls).toContain(`ps-${look}`);
		rows[look] = st.row_h;
		await shot3(page, `pages-tb-template-${look}-rtl`);
	}
	// the compact look holds more rows on a page
	expect(rows.compact).toBeLessThan(rows.classic);
	const saved = await page.evaluate(async () => {
		await window.rv_page.flush_settings();
		return window.rv_test.saved_settings().pages;
	});
	expect([saved.style, saved.template]).toEqual(["minimal", ""]);
	expect(problems, "console errors/warnings").toEqual([]);
});


test("pages: page setup as in a word processor: four margins typed, letter head and footer on their pages, the number band under or above the footer, rules", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=gl&lang=ar&rv=${PAGES}${pages_settings({ orientation: "portrait" })}`);
	await settle(page);
	await open_sections(page);
	const state = () =>
		page.evaluate(async () => {
			const v = window.rv_page.pages;
			await v.fill_all();
			const pages = [...document.querySelectorAll(".rv-print-sheets .rv-page")];
			const p0 = pages[0];
			const css = (el, prop) => (el ? getComputedStyle(el)[prop] : null);
			const root = document.querySelector(".rv-pages").closest(".rv");
			const foot = p0.querySelector(".rv-page-foot");
			return {
				count: pages.length,
				box: v.box,
				lh: pages.map((p) => Boolean(p.querySelector(".rv-page-lh"))),
				lhf: pages.map((p) => Boolean(p.querySelector(".rv-page-lhf"))),
				foot_order: foot ? [...foot.children].map((c) => c.className.split(" ")[0]) : [],
				align: css(p0.querySelector(".rv-page-lh"), "alignItems"),
				head_var: getComputedStyle(root).getPropertyValue("--pp-head-line").trim(),
				num_var: getComputedStyle(root).getPropertyValue("--pp-num-line").trim(),
				lh_mb: getComputedStyle(root).getPropertyValue("--pp-lh-mb").trim(),
				number: (p0.querySelector(".rv-page-foot-line .rv-pnum") || p0.querySelector(".rv-page-topnum .rv-pnum"))?.textContent.trim(),
				name_beside: Boolean(p0.querySelector(".rv-page-foot-line .nm")),
				top_in_head: Boolean(p0.querySelector(".rv-page-top .rv-page-topnum")),
				pad: p0.style.paddingBlock + " | " + p0.style.paddingInline,
			};
		});
	const before = await state();
	expect(before.count).toBeGreaterThan(1);
	// default: the letter head on the first page, its footer on every page, the number under it
	expect(before.lh).toEqual(before.lh.map((_, i) => i === 0));
	expect(before.lhf.every(Boolean)).toBe(true);
	expect(before.foot_order).toEqual(["rv-page-lhf", "rv-page-foot-line"]);
	// page margins typed on each side: "custom", the body narrows by them
	await type_num(page, 'input[data-box="page_m"][data-side="start"]', 25);
	await type_num(page, 'input[data-box="page_m"][data-side="top"]', 20);
	let st = await state();
	expect(st.box.inner_w).toBeLessThan(before.box.inner_w);
	expect(st.box.pad.top).toBeGreaterThan(before.box.pad.top);
	expect(await page.locator('[data-seg="margins"][data-value="custom"]').getAttribute("aria-pressed")).toBe("true");
	// "same on all sides" takes the top value
	await page.click('[data-box-all="page_m"]');
	await settle(page);
	st = await state();
	expect(st.box.pad.start).toBe(st.box.pad.top);
	// letter head margins and on every page; the footer on the last page only
	await type_num(page, 'input[data-box="lh_m"][data-side="bottom"]', 8);
	expect((await state()).lh_mb).toBe("0mm 8mm");
	await page.click('[data-seg="lh_pages"][data-value="all"]');
	await settle(page);
	await page.click('[data-seg="foot_pages"][data-value="last"]');
	await settle(page);
	st = await state();
	expect(st.lh.every(Boolean)).toBe(true);
	expect(st.lhf).toEqual(st.lhf.map((_, i) => i === st.count - 1));
	// as in Word: all but the first page
	await page.click('[data-seg="lh_pages"][data-value="rest"]');
	await settle(page);
	await page.click('[data-seg="foot_pages"][data-value="rest"]');
	await settle(page);
	st = await state();
	expect(st.lh).toEqual(st.lh.map((_, i) => i > 0));
	expect(st.lhf).toEqual(st.lhf.map((_, i) => i > 0));
	await page.click('[data-seg="foot_pages"][data-value="all"]');
	await settle(page);
	// the number band stays under the footer (no choice); a rule of its own when asked; a
	// dashed rule under the letter head
	expect(await page.locator('[data-seg="number_order"]').count()).toBe(0);
	expect((await state()).foot_order).toEqual(["rv-page-lhf", "rv-page-foot-line"]);
	await type_num(page, 'input[data-num="num_line_w"]', 0.6);
	await type_num(page, 'input[data-num="head_line_w"]', 2);
	await page.selectOption('select[data-set="head_line_s"]', "dashed");
	await settle(page);
	await page.locator('input[data-color="num_line_c"]').evaluate((el) => {
		el.value = "#2d5c93";
		el.dispatchEvent(new Event("change", { bubbles: true }));
	});
	await settle(page);
	st = await state();
	expect(st.head_var).toBe("2px dashed #D9DFDB");
	expect(st.num_var).toBe("0.6px solid #2d5c93");
	// numbering from 5, "— n —", without the report's name
	await type_num(page, 'input[data-num="number_start"]', 5);
	await page.selectOption('select[data-set="number_format"]', "dash");
	await settle(page);
	await page.click('[data-sw="number_caption"]');
	await settle(page);
	st = await state();
	expect(st.number).toBe("— 5 —");
	expect(st.name_beside).toBe(false);
	// at the top, in the page head
	await page.selectOption('select[data-set="number_pos"]', "top-start");
	await settle(page);
	expect((await state()).top_in_head).toBe(true);
	await shot3(page, "pages-gl-page-setup-rtl");
	expect(problems, "console errors/warnings").toEqual([]);
});


test("pages: a watermark, text or image, on every page or the first, light and turned; it follows its settings", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=gl&lang=ar&rv=${PAGES}${pages_settings({ orientation: "portrait" })}`);
	await settle(page);
	await open_sections(page);
	const marks = () =>
		page.evaluate(async () => {
			await window.rv_page.pages.fill_all();
			return [...document.querySelectorAll(".rv-print-sheets .rv-page")].map((p) => {
				const wm = p.querySelector(".rv-page-wm");
				const el = wm?.firstElementChild;
				return wm ? { tag: el.tagName, text: el.textContent, opacity: getComputedStyle(el).opacity, transform: getComputedStyle(el).transform } : null;
			});
		});
	expect((await marks()).every((m) => m === null)).toBe(true);
	await page.click('[data-seg="wm_type"][data-value="text"]');
	await settle(page);
	await page.locator('input[data-text="wm_text"]').fill("سري");
	await page.waitForFunction(() => [...document.querySelectorAll(".rv-page[data-page] .rv-page-wm span")].some((s) => s.textContent === "سري"));
	await settle(page);
	let m = await marks();
	expect(m.every((x) => x && x.tag === "SPAN" && x.text === "سري")).toBe(true);
	expect(Number(m[0].opacity)).toBeCloseTo(0.1, 2);
	expect(m[0].transform).not.toBe("none");
	await type_num(page, 'input[data-num="wm_opacity"]', 25);
	await page.click('[data-seg="wm_pages"][data-value="first"]');
	await settle(page);
	m = await marks();
	expect(Number(m[0].opacity)).toBeCloseTo(0.25, 2);
	expect(m.slice(1).every((x) => x === null)).toBe(true);
	// all but the first page
	await page.click('[data-seg="wm_pages"][data-value="rest"]');
	await settle(page);
	m = await marks();
	expect(m[0]).toBeNull();
	expect(m.slice(1).every((x) => x && x.text === "سري")).toBe(true);
	await page.click('[data-seg="wm_pages"][data-value="first"]');
	await settle(page);
	await shot3(page, "pages-gl-watermark-text-rtl");
	// an image (an address of the site's files)
	await page.click('[data-seg="wm_type"][data-value="image"]');
	await settle(page);
	await page.locator('input[data-text="wm_image"]').fill("/assets/frappe/images/frappe-framework-logo.svg");
	await page.waitForFunction(() => document.querySelector(".rv-page[data-page] .rv-page-wm img"));
	await settle(page);
	m = await marks();
	expect(m[0].tag).toBe("IMG");
	// an address that is not one stays out
	// refused as it is typed (no timer to wait for)
	await page.locator('input[data-text="wm_image"]').fill("javascript:alert(1)");
	await settle(page);
	const saved = await page.evaluate(() => window.rv_page.pages.settings.wm_image);
	expect(saved).toBe("/assets/frappe/images/frappe-framework-logo.svg");
	expect(problems.filter((x) => !/frappe-framework-logo/.test(x)), "console errors/warnings").toEqual([]);
});


test("pages: a print heading rendered with the filters, on its pages, instead of the title or above it; a print signature of the site; the site's standard settings", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=gl&lang=ar&rv=${PAGES}${pages_settings({ orientation: "portrait" })}`);
	await settle(page);
	await open_sections(page);
	const heads = () =>
		page.evaluate(async () => {
			await window.rv_page.pages.fill_all();
			return [...document.querySelectorAll(".rv-print-sheets .rv-page")].map((p) => ({
				heading: p.querySelector(".rv-page-heading .ht")?.textContent || null,
				title: Boolean(p.querySelector(".rv-page-hd")),
				cont: Boolean(p.querySelector(".rv-page-cont")),
			}));
		});
	expect((await heads()).every((h) => h.heading === null)).toBe(true);
	await pick_link(page, "heading", "Statement heading");
	await settle(page);
	let h = await heads();
	expect(h.length).toBeGreaterThan(1);
	// the server's rendering, with the company of the filters
	expect(h[0].heading).toMatch(/^Statement of /);
	expect(h[0].title).toBe(true);
	expect(h.slice(1).every((x) => x.heading === null && x.cont)).toBe(true);
	// every page, instead of the report's title
	await page.click('[data-seg="heading_pages"][data-value="all"]');
	await settle(page);
	await page.click('[data-sw="heading_replace"]');
	await settle(page);
	h = await heads();
	expect(h.every((x) => x.heading && !x.title && !x.cont)).toBe(true);
	// alignment, size and the rule under it are variables of the pages
	await page.click('[data-seg="heading_align"][data-value="start"]');
	await type_num(page, 'input[data-num="heading_size"]', 18);
	await settle(page);
	const style = await page.evaluate(() => {
		const ht = document.querySelector('.rv-page[data-page="0"] .rv-page-heading');
		return { align: getComputedStyle(ht).textAlign, size: getComputedStyle(ht.querySelector(".ht")).fontSize };
	});
	expect(["start", "right"]).toContain(style.align);
	expect(parseFloat(style.size)).toBeCloseTo(24, 0);
	// a print signature replaces the standard boxes on the last page
	await page.click('[data-sw="signatures"]');
	await settle(page);
	await pick_link(page, "signature", "Finance approvals");
	await settle(page);
	const sig = await page.evaluate(async () => {
		await window.rv_page.pages.fill_all();
		const pages = [...document.querySelectorAll(".rv-print-sheets .rv-page")];
		const last = pages[pages.length - 1];
		const t = last.querySelector(".rv-signature .rv-sig-t");
		return {
			boxes: last.querySelectorAll(".rv-signature .rv-sig").length,
			standard: document.querySelectorAll(".rv-page .rv-page-sign").length,
			elsewhere: pages.slice(0, -1).some((p) => p.querySelector(".rv-signature")),
			color: t && getComputedStyle(t).color,
			// the CSS of the signature reaches the signature only
			title_color: getComputedStyle(document.querySelector(".rv-page .rv-page-heading .ht")).color,
		};
	});
	expect(sig.boxes).toBe(2);
	expect(sig.standard).toBe(0);
	expect(sig.elsewhere).toBe(false);
	expect(sig.color).toBe("rgb(138, 45, 59)");
	expect(sig.title_color).not.toBe("rgb(138, 45, 59)");
	await shot3(page, "pages-gl-heading-signature-rtl");
	// on every page: in the foot of each page, above the footer; the pages make room for it
	const before = (await pages_state(page)).count;
	await page.click('[data-seg="sig_pages"][data-value="all"]');
	await settle(page);
	const every = await page.evaluate(async () => {
		await window.rv_page.pages.fill_all();
		return [...document.querySelectorAll(".rv-print-sheets .rv-page")].map((p) => {
			const sig = p.querySelector(".rv-page-foot > .rv-page-sig");
			const foot = p.querySelector(".rv-page-foot").getBoundingClientRect();
			const page = p.getBoundingClientRect();
			return { sig: Boolean(sig), inside: foot.bottom <= page.bottom + 1, tail: Boolean(p.querySelector(".rv-page-body > .rv-page-sig")) };
		});
	});
	expect(every.every((x) => x.sig && x.inside && !x.tail)).toBe(true);
	expect(every.length).toBeGreaterThanOrEqual(before);
	// the last page only, at its bottom
	await page.click('[data-seg="sig_pages"][data-value="last"]');
	await settle(page);
	await page.click('[data-seg="sig_pos"][data-value="bottom"]');
	await settle(page);
	const bottom = await page.evaluate(async () => {
		await window.rv_page.pages.fill_all();
		const pages = [...document.querySelectorAll(".rv-print-sheets .rv-page")];
		const last = pages[pages.length - 1];
		const sig = last.querySelector(".rv-page-body > .rv-page-sig.at-bottom");
		const body = last.querySelector(".rv-page-body").getBoundingClientRect();
		return { sig: Boolean(sig), gap: sig ? body.bottom - sig.getBoundingClientRect().bottom : null, others: pages.slice(0, -1).some((p) => p.querySelector(".rv-page-sig")) };
	});
	expect(bottom.sig).toBe(true);
	expect(bottom.gap).toBeLessThan(2);
	expect(bottom.others).toBe(false);
	const saved = await page.evaluate(() => {
		const s = window.rv_page.pages.settings;
		return [s.heading, s.heading_pages, s.heading_replace, s.signature, s.sig_pages, s.sig_pos];
	});
	expect(saved).toEqual(["Statement heading", "all", true, "Finance approvals", "last", "bottom"]);
	expect(problems, "console errors/warnings").toEqual([]);
});


test("pages: the site's standard print settings are where a new user starts and where Reset returns", async ({ page }) => {
	const problems = watch_console(page);
	await page.addInitScript(() => {
		window.RV_PRINT_DEFAULTS = { size: "A3", orientation: "portrait", style: "ledger", heading: "Statement heading", heading_pages: "all", page_numbers: false, number_format: "nonsense" };
	});
	await open(page, `report=tb&lang=en&rv=${PAGES}`);
	await settle(page);
	const st = () => page.evaluate(() => {
		const s = window.rv_page.pages.settings;
		return { size: s.size, orientation: s.orientation, style: s.style, heading: s.heading, heading_pages: s.heading_pages, page_numbers: s.page_numbers, number_format: s.number_format };
	});
	const want = { size: "A3", orientation: "portrait", style: "ledger", heading: "Statement heading", heading_pages: "all", page_numbers: false, number_format: "full" };
	expect(await st()).toEqual(want);
	// the paper tool of the toolbar opens its menu
	await page.click('details[data-sec="paper"] > summary');
	await page.click('[data-seg="margins"][data-value="wide"]').catch(() => {});
	await page.selectOption('select[data-set="size"]', "A4");
	await settle(page);
	await page.click('.rv-print-hd [data-action="reset"]');
	await settle(page);
	expect(await st()).toEqual(want);
	expect(problems, "console errors/warnings").toEqual([]);
});


test("pages: a long report prints every sheet with its content (far pages are not emptied while printing); the PDF sends only the styles in use", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=gl&lang=ar&rows=2500&rv=${PAGES}${pages_settings({ orientation: "portrait" })}`);
	await settle(page);
	const out = await page.evaluate(async () => {
		const v = window.rv_page.pages;
		const restore = await v.prepare_print();
		// what the stage's observer would do with sheets that left it
		v.trim_filled();
		await new Promise((r) => setTimeout(r, 300));
		const sheets = [...document.querySelectorAll("body > .rv-print-root .rv-page")];
		const empty = sheets.filter((s) => s.querySelector(".rv-page-ph") || !s.querySelector(".rv-pt tbody tr")).length;
		const html = await v.print_document(v.print_root);
		restore();
		return { pages: sheets.length, empty, html_kb: Math.round(html.length / 1024), css_kb: Math.round((html.match(/<head>[\s\S]*?<\/head>/) || [""])[0].length / 1024), keeps_page_rules: /\.rv-page\b/.test(html) };
	});
	expect(out.pages).toBeGreaterThan(16);
	expect(out.empty).toBe(0);
	expect(out.keeps_page_rules).toBe(true);
	expect(out.css_kb).toBeLessThan(400);
	expect(problems, "console errors/warnings").toEqual([]);
});


test("pages: the toolbar opens one tool's menu at a time, under its tool; elsewhere or Escape closes it", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=tb&lang=ar&rv=${PAGES}`);
	await settle(page);
	const menu = () =>
		page.evaluate(() => {
			const m = document.querySelector(".rv-print-pop");
			if (!m) return null;
			const r = m.getBoundingClientRect();
			return { secs: [...m.querySelectorAll(".rv-pop-sec")].map((x) => x.dataset.sec), top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width) };
		});
	// four groups, every section a tool, nothing open
	expect(await page.locator(".rv-rg").count()).toBe(4);
	expect(await menu()).toBe(null);
	await page.click('details[data-sec="sign"] > summary');
	let m = await menu();
	expect(m.secs).toEqual(["sign"]);
	const tool = await page.locator('details[data-sec="sign"] > summary').boundingBox();
	expect(m.top).toBeGreaterThanOrEqual(Math.round(tool.y + tool.height));
	// a change inside the menu keeps it open
	await page.click('.rv-print-pop [data-sw="signatures"]');
	await settle(page);
	expect((await menu()).secs).toEqual(["sign"]);
	// another tool replaces it; the same tool again closes it
	await page.click('details[data-sec="paper"] > summary');
	expect((await menu()).secs).toEqual(["paper"]);
	await page.click('details[data-sec="paper"] > summary');
	expect(await menu()).toBe(null);
	// a click on the pages closes it, Escape too
	await page.click('details[data-sec="foot"] > summary');
	// the part of the stage on screen, without its scroll bars: the stage runs below the
	// viewport, where Chromium still delivers a click (to the document) and Firefox does not
	const stage = await page.evaluate(() => {
		const el = document.querySelector(".rv-print-stage");
		const r = el.getBoundingClientRect();
		const y = r.top + el.clientTop;
		return { x: r.left + el.clientLeft, y, width: el.clientWidth, height: Math.min(el.clientHeight, window.innerHeight - y) };
	});
	const open_menu = await page.locator(".rv-print-pop").boundingBox();
	// a point of the stage away from the menu
	const x = open_menu.x > stage.x + 60 ? stage.x + 20 : stage.x + stage.width - 20;
	await page.mouse.click(x, stage.y + stage.height - 20);
	expect(await menu()).toBe(null);
	await page.click('details[data-sec="foot"] > summary');
	await page.keyboard.press("Escape");
	expect(await menu()).toBe(null);
	// the thumbnails: one a page, the current marked, a click goes to its page
	const n = await page.evaluate(() => window.rv_page.pages.pages.length);
	expect(await page.locator(".rv-print-thumbs [data-thumb]").count()).toBe(n);
	expect(await page.getAttribute(".rv-print-thumbs [data-thumb='0']", "aria-current")).toBe("page");
	expect(problems).toEqual([]);
});


test("pages: on a phone the toolbar stays on top and a tool's menu opens as a sheet from the bottom", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=tb&lang=ar&rv=${PAGES}`);
	await settle(page);
	// the harness opens at desktop size: the phone's width after
	await page.setViewportSize({ width: 390, height: 844 });
	await page.waitForTimeout(300);
	const st = () =>
		page.evaluate(() => {
			const m = document.querySelector(".rv-print-pop")?.getBoundingClientRect();
			return { menu: m ? { top: Math.round(m.top), bottom: Math.round(m.bottom), w: Math.round(m.width) } : null, thumbs: getComputedStyle(document.querySelector(".rv-print-thumbs")).display, hscroll: document.documentElement.scrollWidth > innerWidth };
		});
	let s = await st();
	expect(s.menu).toBe(null);
	expect(s.thumbs).toBe("none");
	expect(s.hscroll).toBe(false);
	await page.locator('details[data-sec="paper"] > summary').click();
	// the sheet slides in: measured once its animation is over
	await page.evaluate(() => Promise.all(document.querySelector(".rv-print-pop").getAnimations().map((a) => a.finished)));
	s = await st();
	expect(s.menu.bottom).toBe(844);
	expect(s.menu.w).toBe(390);
	await page.keyboard.press("Escape");
	expect((await st()).menu).toBe(null);
	expect(problems).toEqual([]);
});


test("pages: the mouse wheel over a focused number field scrolls the panel, the value stays", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=tb&lang=ar&rv=${PAGES}`);
	await settle(page);
	await open_sections(page);
	const field = page.locator('input[data-box="page_m"][data-side="top"]');
	await field.scrollIntoViewIfNeeded();
	const before = await field.inputValue();
	await field.click();
	const box = await field.boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	expect(await field.evaluate((el) => el === document.activeElement)).toBe(true);
	await page.mouse.wheel(0, -120);
	await page.mouse.wheel(0, 240);
	await page.waitForTimeout(200);
	// the field let go of the focus at the first turn: a desktop browser steps only a
	// focused number field (headless Chromium does not step it at all)
	expect(await field.evaluate((el) => el === document.activeElement)).toBe(false);
	expect(await field.inputValue()).toBe(before);
	expect(await page.evaluate(() => window.rv_page.pages.settings.page_m.top)).toBe(Number(before));
	expect(problems).toEqual([]);
});


test("side panel: ticking a column keeps the columns list and the panel where they were", async ({ page }) => {
	const problems = watch_console(page);
	await page.setViewportSize({ width: 1280, height: 640 });
	await open(page, "report=gl&lang=ar");
	await settle(page);
	await page.locator('[data-side="columns"]').click();
	const where = () => page.evaluate(() => ({ list: document.querySelector(".rv-collist").scrollTop, bd: document.querySelector(".rv-panel-bd").scrollTop }));
	// down the list and the panel, then untick and tick the last column
	await page.evaluate(() => {
		const list = document.querySelector(".rv-collist");
		list.scrollTop = list.scrollHeight;
		const bd = document.querySelector(".rv-panel-bd");
		bd.scrollTop = 60;
	});
	const before = await where();
	expect(before.list).toBeGreaterThan(0);
	const last = page.locator(".rv-collist [data-col]:not([disabled])").last();
	const key = await last.getAttribute("data-col");
	await last.click();
	await settle(page);
	expect(await where()).toEqual(before);
	await page.locator(`.rv-collist [data-col="${key}"]`).click();
	await settle(page);
	expect(await where()).toEqual(before);
	expect(await page.evaluate(() => document.activeElement?.dataset?.col)).toBe(key);
	expect(problems).toEqual([]);
});


test("pages: in compact density the toolbar spans the pages, as in the comfortable one", async ({ page }) => {
	const problems = watch_console(page);
	for (const density of ["comfortable", "compact"]) {
		await open(page, `report=tb&lang=ar&density=${density}&rv=${PAGES}`);
		await settle(page);
		const w = await page.evaluate(() => {
			const r = (s) => Math.round(document.querySelector(s).getBoundingClientRect().width);
			return { compact: Boolean(document.querySelector(".rv.compact")), pages: r(".rv-pages"), toolbar: r(".rv-print-side") };
		});
		expect(w.compact).toBe(density === "compact");
		expect(w.toolbar).toBe(w.pages);
	}
	expect(problems).toEqual([]);
});


test("pages: on a phone the page readout and the pages kept follow the phone's gap and padding (far into a long report)", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=gl&lang=en&rows=10000&rv=${PAGES}${pages_settings({ orientation: "portrait" })}`, { width: 390, height: 844 });
	await settle(page);
	const read = (k) =>
		page.evaluate(async (k) => {
			const v = window.rv_page.pages;
			const cs = getComputedStyle(v.sheets);
			const sheet = v.sheets.children[k];
			// the stage scrolled so that page k stands in the middle of it
			const top = sheet.getBoundingClientRect().top - v.stage.getBoundingClientRect().top + v.stage.scrollTop;
			v.stage.scrollTop = top + sheet.getBoundingClientRect().height / 2 - v.stage.clientHeight / 2;
			v.update_position();
			return { gap: cs.rowGap, pad: cs.paddingBlockStart, metrics: v.sheet_metrics(), pages: v.pages.length, pos: document.querySelector(".rv-print-pos").textContent };
		}, k);
	const far = await read(140);
	expect(far.pages).toBeGreaterThan(150);
	expect(far.gap).toBe("12px");
	expect(far.metrics).toMatchObject({ gap: 12, pad: 12 });
	expect(far.pos).toBe(`Page 141 of ${far.pages.toLocaleString("en-US")}`);
	// the page in the middle is drawn once the stage has settled, and not given back
	await page.waitForFunction(() => window.rv_page.pages.filled.has(140));
	await page.evaluate(() => window.rv_page.pages.trim_filled());
	expect(await page.evaluate(() => [139, 140, 141].every((i) => window.rv_page.pages.filled.has(i)))).toBe(true);
	// back to a desktop width: the stylesheet's values there
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.waitForFunction(() => window.rv_page.pages.sheet_metrics().gap === 24);
	expect((await read(140)).pos).toBe(`Page 141 of ${far.pages.toLocaleString("en-US")}`);
	expect(problems).toEqual([]);
});
