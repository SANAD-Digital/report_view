// The document print page (ADR-017) on a real site, every part of it: the button on
// Frappe's print page, paper, formats, letter heads and footers, a long document split
// over pages (rows, head repeated, nothing over the footer), numbers, headings,
// signatures, border, watermark, language, zoom, the record fields, print and PDF.
// RV_PW=… RV_SHORT_DOC=<a Journal Entry> RV_LONG_DOC=<one of 80+ rows, e.g. ACC-JV-2026-00016 (300)> node tests/site/doc_print.cjs
// Every part of the document print page, on the site, as rv_accountant.
const fs = require("node:fs");
const { chromium } = require("playwright");
const BASE = process.env.RV_SITE || "https://acc.dev.sanad.digital";
const SHORT = process.env.RV_SHORT_DOC, LONG = process.env.RV_LONG_DOC;
const results = [];
const check = (name, ok, info = "") => { results.push([ok ? "PASS" : "FAIL", name, info]); };
(async () => {
	const browser = await chromium.launch();
	const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
	const page = await ctx.newPage();
	const problems = [];
	page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
	page.on("console", (m) => { if (m.type() === "error" && !/CORS|ERR_FAILED|dev-acc/.test(m.text())) problems.push(m.text()); });
	await page.request.post(`${BASE}/api/method/login`, { form: { usr: process.env.RV_USER || "rv_accountant@rv.test", pwd: process.env.RV_PW } });
	const V = "frappe.pages['rv-print'].rv_print.pages";
	const settle = async () => {
		await page.waitForFunction((g) => { try { const v = eval(g); return v.pages.length && v.filled.size && !v.el.classList.contains("is-busy"); } catch { return false; } }, V, { timeout: 60000 });
		await page.evaluate(async (g) => { const v = eval(g); await v.ready; await v.fill_all(); await new Promise((r) => setTimeout(r, 150)); }, V);
	};
	const set = async (patch) => { await page.evaluate(([g, p]) => eval(g).update(p), [V, patch]); await page.waitForTimeout(60); await settle(); };
	// the state of every page: what it carries and whether its content stays inside it
	const state = () => page.evaluate((g) => {
		const v = eval(g);
		return {
			box: v.box && { w: Math.round(v.box.w), h: Math.round(v.box.h) },
			note: document.querySelector(".rv-print-note").textContent,
			pages: [...v.sheets.querySelectorAll(".rv-page")].map((p) => {
				const r = p.getBoundingClientRect();
				const foot = p.querySelector(".rv-page-foot")?.getBoundingClientRect();
				const flow = p.querySelector(".rv-page-flow");
				const last = flow ? [...flow.querySelectorAll("*")].reduce((m, e) => Math.max(m, e.getBoundingClientRect().bottom), 0) : 0;
				return {
					lh: Boolean(p.querySelector(".rv-page-lh")), lhf: Boolean(p.querySelector(".rv-page-lhf")), heading: p.querySelector(".rv-page-heading .ht")?.textContent || null,
					num: p.querySelector(".rv-pnum")?.textContent || null, topnum: Boolean(p.querySelector(".rv-page-topnum .rv-pnum")),
					sig: Boolean(p.querySelector(".rv-page-sig")), sig_in_foot: Boolean(p.querySelector(".rv-page-foot .rv-page-sig")),
					wm: p.querySelector(".rv-page-wm")?.textContent || (p.querySelector(".rv-page-wm img") ? "IMG" : null), border: Boolean(p.querySelector(".rv-page-border")),
					rows: p.querySelectorAll(".rv-page-flow tbody tr").length, thead: Boolean(p.querySelector(".rv-page-flow thead")),
					foot_inside: !foot || foot.bottom <= r.bottom + 1, overlap: Boolean(foot && last > foot.top + 1),
				};
			}),
		};
	}, V);
	const open = async (name) => { await page.goto(`${BASE}/desk/rv-print/Journal%20Entry/${name}`); await settle(); await page.evaluate((g) => eval(g).reset(), V); await page.waitForTimeout(100); await settle(); };

	// 0. the button on Frappe's print page
	await page.goto(`${BASE}/desk/print/Journal%20Entry/${SHORT}`);
	const btn = page.locator(".page-actions button", { hasText: "الطباعة المتقدمة" });
	await btn.first().waitFor({ timeout: 30000 }).catch(() => {});
	check("Frappe print page has «الطباعة المتقدمة»", await btn.count() > 0);
	if (await btn.count()) { await btn.first().click(); await settle(); }
	check("the button opens rv-print of the document", await page.evaluate(() => frappe.get_route().join("/")) === `rv-print/Journal Entry/${SHORT}`);
	await page.evaluate((g) => eval(g).reset(), V); await settle();
	let s = await state();
	check("short document: one page, letter head, number", s.pages.length === 1 && s.pages[0].lh && Boolean(s.pages[0].num), JSON.stringify(s.pages[0]));
	check("no warning note", !s.note, s.note);

	// 1. paper and margins
	for (const size of ["A3", "A4", "Letter", "Legal"]) {
		await set({ size, orientation: "portrait" }); s = await state();
		const want = { A3: [297, 420], A4: [210, 297], Letter: [215.9, 279.4], Legal: [215.9, 355.6] }[size].map((mm) => Math.round((mm * 96) / 25.4));
		check(`paper ${size}`, Math.abs(s.box.w - want[0]) <= 1 && Math.abs(s.box.h - want[1]) <= 1, JSON.stringify(s.box));
	}
	await set({ size: "A4", orientation: "landscape" }); s = await state();
	check("landscape", s.box.w > s.box.h, JSON.stringify(s.box));
	await set({ orientation: "portrait", margins: "wide", page_m: { top: 18, bottom: 18, start: 18, end: 18 } });
	const pad = await page.evaluate(() => getComputedStyle(document.querySelector(".rv-print-sheets .rv-page")).paddingTop);
	check("margins wide = 18mm", Math.abs(parseFloat(pad) - (18 * 96) / 25.4) < 1, pad);
	await set({ margins: "normal", page_m: { top: 12, bottom: 12, start: 12, end: 12 } });

	// 2. every print format of the doctype
	const formats = await page.evaluate((g) => eval(g).options.print_formats, V);
	for (const f of ["", ...formats]) {
		await set({ template: f }); s = await state();
		check(`format «${f || "standard"}» renders`, s.pages.length >= 1 && !/could not|تعذّر/.test(s.note) && s.pages.every((p) => p.foot_inside && !p.overlap), `${s.pages.length} pages ${s.note}`);
		// the format's <style> blocks stand once beside the sheets, never in every page
		const styles = await page.evaluate((g) => { const v = eval(g); return { in_pages: v.sheets.querySelectorAll(":scope > .rv-page > style").length, shared: v.fmt_css.querySelectorAll("style").length }; }, V);
		check(`format «${f || "standard"}»: its styles once, not in every page`, styles.in_pages === 0, JSON.stringify(styles));
	}
	await set({ template: "" });

	// 3. letter heads, their pages, the footer
	const lhs = await page.evaluate((g) => eval(g).options.letter_heads.map((x) => x.name), V);
	for (const lh of lhs) { await set({ letter_head: lh }); s = await state(); check(`letter head «${lh}»`, s.pages[0].lh, ""); }
	await set({ letter_head: "SND Accounting" });
	const nofoot = await page.evaluate(() => document.querySelector('[data-sec="foot"] .sm')?.textContent || "");
	check("a letter head without footer says so", /غير موجود|Not in/.test(nofoot), nofoot);
	await set({ letter_head: "" }); s = await state();
	check("no letter head", !s.pages[0].lh);

	// 4. the long document: rows split, header repeated, nothing lost, footer on every page
	await open(LONG);
	await set({ letter_head: "SND Accounting 2", foot_pages: "all", lh_pages: "first" }); s = await state();
	const total = s.pages.reduce((n, p) => n + p.rows, 0);
	check("long document: several pages", s.pages.length >= 2, `${s.pages.length} pages`);
	const rows_of_doc = await page.evaluate((n) => frappe.xcall("frappe.client.get", { doctype: "Journal Entry", name: n }).then((d) => d.accounts.length), LONG);
	check(`long document: ${rows_of_doc} rows, none lost or doubled`, total === rows_of_doc, `rows ${total}`);
	// a signature on every page that leaves no room: it goes to the last page, never a page per row
	{
		const before = s.pages.length;
		await set({ signatures: true, signature: "", sig_pages: "all", sig_m: { top: 200, bottom: 0, start: 0, end: 0 } });
		const t = await state();
		const total_t = t.pages.reduce((n, p) => n + p.rows, 0);
		check("a signature with no room moves to the last page, rows stay together", t.pages.length <= before + 2 && total_t === rows_of_doc && t.pages.at(-1).sig && !t.pages[0].sig && /لا تبقى مساحة|no room/.test(t.note), `pages ${t.pages.length} (was ${before}), rows ${total_t}`);
		await set({ signatures: false, sig_pages: "last", sig_m: { top: 10, bottom: 0, start: 0, end: 0 } });
	}
	check("long document: the table head on every page with rows", s.pages.filter((p) => p.rows).every((p) => p.thead));
	check("long document: footer on every page, inside the page", s.pages.every((p) => p.lhf && p.foot_inside), JSON.stringify(s.pages.map((p) => [p.lhf, p.foot_inside])));
	check("long document: no content over the footer", s.pages.every((p) => !p.overlap), JSON.stringify(s.pages.map((p) => p.overlap)));
	check("long document: letter head on the first page only", s.pages[0].lh && s.pages.slice(1).every((p) => !p.lh));
	const nums = s.pages.map((p) => p.num);
	check("long document: page numbers 1..n", nums.every((n, i) => n && n.includes(String(i + 1)) && n.includes(String(s.pages.length))), JSON.stringify(nums));
	for (const [scope, want] of [["first", (i) => i === 0], ["rest", (i) => i > 0], ["last", (i, n) => i === n - 1]]) {
		await set({ foot_pages: scope }); s = await state();
		check(`footer on «${scope}»`, s.pages.every((p, i) => p.lhf === want(i, s.pages.length)), JSON.stringify(s.pages.map((p) => p.lhf)));
	}
	await set({ foot_pages: "all", lh_pages: "all" }); s = await state();
	check("letter head on every page", s.pages.every((p) => p.lh && p.foot_inside && !p.overlap));
	await set({ lh_pages: "first" });

	// 5. page numbers
	await set({ number_pos: "top-center" }); s = await state();
	check("number at the top", s.pages.every((p) => p.topnum));
	await set({ number_pos: "bottom-end", number_format: "short", number_start: 5 }); s = await state();
	check("number format 5 / n", /5\s*\/\s*\d/.test(s.pages[0].num), s.pages[0].num);
	await set({ number_format: "full", number_start: 1, page_numbers: false }); s = await state();
	check("numbers hidden", s.pages.every((p) => !p.num));
	await set({ page_numbers: true });

	// 6. print headings with the document
	const headings = await page.evaluate((g) => eval(g).options.print_headings, V);
	for (const h of headings) {
		await set({ heading: h, heading_pages: "first" }); s = await state();
		check(`heading «${h}»`, Boolean(s.pages[0].heading) && s.pages.slice(1).every((p) => !p.heading) && !/تعذّر|could not/.test(s.note), `${s.pages[0].heading} ${s.note}`);
	}
	await set({ heading_pages: "all" }); s = await state();
	check("heading on every page", s.pages.every((p) => p.heading) && s.pages.every((p) => !p.overlap));
	await set({ heading: "" });

	// 7. signatures
	const sigs = await page.evaluate((g) => eval(g).options.print_signatures.map((x) => x.name), V);
	for (const sg of ["", ...sigs]) {
		await set({ signatures: true, signature: sg, sig_pages: "last", sig_pos: "after" }); s = await state();
		check(`signature «${sg || "standard"}» on the last page only`, s.pages[s.pages.length - 1].sig && s.pages.slice(0, -1).every((p) => !p.sig) && !s.pages.some((p) => p.overlap), JSON.stringify(s.pages.map((p) => p.sig)));
	}
	await set({ sig_pages: "all" }); s = await state();
	check("signature on every page (in the foot)", s.pages.every((p) => p.sig_in_foot && p.foot_inside && !p.overlap));
	await set({ sig_pages: "last", sig_pos: "bottom" }); s = await state();
	check("signature at the bottom of the last page", s.pages[s.pages.length - 1].sig);
	// the short one: the signature with the content, one page
	await open(SHORT);
	await set({ signatures: true, signature: "", sig_pages: "last", sig_pos: "after" }); s = await state();
	check("short document + signature: still one page", s.pages.length === 1 && s.pages[0].sig, `${s.pages.length} pages`);

	// 8. border, watermark, language, zoom
	await set({ pb_on: true, wm_type: "text", wm_text: "سري", wm_pages: "all" }); s = await state();
	check("border and text watermark", s.pages.every((p) => p.border && p.wm === "سري"));
	await set({ wm_type: "image", wm_image: "/assets/frappe/images/frappe-framework-logo.svg" }); s = await state();
	check("image watermark", s.pages.every((p) => p.wm === "IMG"));
	await set({ pb_on: false, wm_type: "none", lang: "en" }); s = await state();
	const head = await page.evaluate(() => document.querySelector(".rv-page-flow .print-heading")?.textContent.trim().slice(0, 40));
	check("English: the format renders in English", /Journal Entry/.test(head || ""), head);
	await set({ lang: "" });
	const z0 = await page.evaluate((g) => eval(g).zoom_value(), V);
	await page.click('[data-zoom="in"]'); await page.waitForTimeout(200);
	check("zoom in", (await page.evaluate((g) => eval(g).zoom_value(), V)) > z0);
	await page.click('[data-zoom="fit"]');

	// 9. the Autocomplete fields: instant lists, a value from the list sets the pages
	await page.evaluate((g) => { const v = eval(g); v.open_secs = new Set(["tpl"]); v.render_panel(); }, V);
	let t = Date.now();
	const lhInput = page.locator('[data-link="letter_head"] input');
	await lhInput.click(); await lhInput.fill("2");
	await page.locator('[data-link="letter_head"] .awesomplete li').first().waitFor({ timeout: 5000 });
	const listed = Date.now() - t;
	await page.locator('[data-link="letter_head"] .awesomplete li').first().click(); await settle();
	check("field list opens fast and sets the letter head", listed < 600 && (await page.evaluate((g) => eval(g).settings.letter_head, V)) === "SND Accounting 2", `${listed} ms`);
	await lhInput.click(); await lhInput.fill("لا شيء من هذا"); await page.keyboard.press("Tab"); await page.waitForTimeout(400);
	check("a value not in the list is dropped", (await page.evaluate((g) => eval(g).settings.letter_head, V)) !== "لا شيء من هذا");

	// 10. print and PDF
	const pr = await page.evaluate(async (g) => { const v = eval(g); const restore = await v.prepare_print(); const n = document.querySelectorAll(".rv-print-root .rv-page").length; restore(); return n; }, V);
	s = await state();
	check("print: every sheet goes to the print root", pr === s.pages.length, `${pr}`);
	await open(LONG);
	await set({ letter_head: "SND Accounting 2", signatures: true });
	s = await state();
	const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.click('[data-action="pdf"]')]);
	const file = await dl.path();
	const pdf = fs.readFileSync(file);
	const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
	check("PDF of the long document: same page count", pages === s.pages.length, `pdf ${pages} vs ${s.pages.length}`);
	// more than 40 sheets: a background job, its progress, then the file
	await set({ margins: "custom", page_m: { top: 110, bottom: 110, start: 12, end: 12 } });
	s = await state();
	const [dl2] = await Promise.all([page.waitForEvent("download", { timeout: 300000 }), page.click('[data-action="pdf"]')]);
	const pdf2 = fs.readFileSync(await dl2.path());
	const pages2 = (pdf2.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
	check("PDF by a background job (over 40 pages): same page count", s.pages.length > 40 && pages2 === s.pages.length, `pdf ${pages2} vs ${s.pages.length}`);
	await page.evaluate((g) => eval(g).reset(), V); await page.waitForTimeout(1200);

	// 11. a user without print
	check("no console errors", problems.length === 0, JSON.stringify(problems.slice(0, 3)));
	for (const r of results) console.log(r.join(" | "));
	console.log(`${results.filter((r) => r[0] === "PASS").length}/${results.length} passed`);
	await browser.close();
})();
