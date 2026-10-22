// The letter head builder (ADR-018) on a real site, as a System Manager: the gallery drawn
// with the company's data (an empty field said to be empty, never faked), a field dragged
// into a slot, an element freed by dragging and moved with the keys, a resize, undo/redo,
// save, then the saved letter head in Frappe's print view and in the rv-print page; the
// phone layout (tap to add, no horizontal scroll). The test letter head is deleted at the end.
// [RV_USER=… RV_PW=…] [RV_SHOTS=<dir>] node tests/site/letterhead.cjs
const { chromium } = require("playwright");
const password = require("./_password.cjs");
const BASE = process.env.RV_SITE || "https://acc.dev.sanad.digital";
const USER = process.env.RV_USER || "rv_admin@rv.test";
const SHOTS = process.env.RV_SHOTS || "";
const results = [];
const check = (name, ok, info = "") => results.push([ok ? "PASS" : "FAIL", name, info]);

(async () => {
	const browser = await chromium.launch();
	const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
	const page = await ctx.newPage();
	const problems = [];
	page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
	page.on("console", (m) => {
		// the probes for a printable document may be refused (403): not a fault of the builder
		if (m.type() === "error" && !/CORS|ERR_FAILED|dev-acc|403|PermissionError/.test(m.text())) problems.push(m.text());
	});
	await page.request.post(`${BASE}/api/method/login`, { form: { usr: USER, pwd: password("RV_PW", "RV_ADMIN_PASSWORD") } });
	const H = "frappe.pages['rv-letterhead'].rv_letterhead";
	const layout = () => page.evaluate((h) => eval(h).store.layout, H);
	const find = (l, id) => [...l.header.elements, ...l.footer.elements].find((e) => e.id === id);
	const shot = (n) => SHOTS && page.screenshot({ path: `${SHOTS}/${n}.png` });
	const center = async (loc) => {
		const b = await loc.boundingBox();
		return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
	};
	const drag = async (from, to, steps = 14) => {
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
		await page.waitForTimeout(80);
		await page.mouse.up();
		await page.waitForTimeout(150);
	};
	const stamp = Date.now().toString(36);
	const NAME = `RV LH Test ${stamp}`;
	let saved = null;

	try {
		// 0. the button on the Letter Head form
		const any_lh = await page.evaluate(async () => (await frappe.xcall("frappe.client.get_list", { doctype: "Letter Head", limit_page_length: 1 }))?.[0]?.name).catch(() => null);
		await page.goto(`${BASE}/desk/letter-head/${encodeURIComponent(any_lh || "new")}`, { waitUntil: "domcontentloaded" });
		const btn = page.locator(".page-actions button, .form-inner-toolbar button, .custom-actions button", { hasText: /تصميم بالمنشئ|Design with the builder/ });
		await btn.first().waitFor({ timeout: 30000 }).catch(() => {});
		check("Letter Head form has «Design with the builder»", (await btn.count()) > 0);

		// 1. the gallery: six styles with the company's real data
		await page.goto(`${BASE}/desk/rv-letterhead`, { waitUntil: "domcontentloaded" });
		await page.waitForSelector(".rvlb-gallery:not([hidden]) .rvlb-card", { timeout: 40000 });
		await page.waitForTimeout(500);
		const ctxdata = await page.evaluate((h) => eval(h).render_ctx(), H);
		const g = await page.evaluate(() => ({
			cards: document.querySelectorAll(".rvlb-card").length,
			text: [...document.querySelectorAll(".rvlb-card .rvlb-thumb")].map((t) => t.textContent),
			empties: [...document.querySelectorAll(".rvlb-vals b.is-empty")].length,
			warn: document.querySelector(".rvlb-warn")?.textContent || "",
		}));
		check("gallery: six styles", g.cards === 6, String(g.cards));
		const name_en = ctxdata.values.company_name;
		check("gallery: every style shows the company's name", g.text.every((t) => t.includes(name_en) || t.includes(ctxdata.values.company_name_ar)), name_en);
		const phone = ctxdata.values.phone_no;
		if (phone) check("gallery: real phone number in the styles", g.text.some((t) => t.includes(phone)), phone);
		const empty_tokens = ["tax_id", "registration_details"].filter((t) => !ctxdata.values[t]);
		check("gallery: empty fields are said to be empty, never faked", empty_tokens.length === 0 || (g.empties >= empty_tokens.length && g.warn.length > 0 && !g.text.some((t) => /الرقم الضريبي|CR:/.test(t))), `${g.empties} empty`);
		await shot("site-01-gallery");

		// 2. start with the classic style
		await page.click(".rvlb-card[data-preset=classic]");
		await page.click("[data-act=start]");
		await page.waitForSelector(".rvlb-editor:not([hidden]) .rvlb-el", { timeout: 20000 });
		await page.waitForTimeout(600);
		let L = await layout();
		check("editor: the classic layout", L.header.elements.some((e) => e.slot === "center" && e.type === "logo") && L.header.slots.right > 0);
		check("editor: the whole page with header and footer", (await page.locator(".rvlb-zone[data-band=header] .rvlh").count()) === 1 && (await page.locator(".rvlb-zone[data-band=footer] .rvlh").count()) === 1);

		// 3. drag a company field from the library into the centre slot, under the logo
		const src = await center(page.locator(".rvlb-item[data-token=country]"));
		const slot = await center(page.locator(".rvlb-zone[data-band=header] .rvlb-paper [data-slot=center]"));
		await drag(src, { x: slot.x, y: slot.b.y + slot.b.height + 2 });
		L = await layout();
		const centre = L.header.elements.filter((e) => e.slot === "center");
		check("drag a field into a slot: it lands in the slot, after the logo", centre.length === 2 && centre[1].props.token === "country", JSON.stringify(centre.map((e) => e.type + ":" + (e.props.token || ""))));
		const country_id = centre[1]?.id;
		await shot("site-02-dropped");

		// 4. drag the slotted email out of its slot onto empty paper: it becomes free
		const email = L.header.elements.find((e) => e.props.token === "email");
		const node = page.locator(`.rvlb-zone[data-band=header] [data-el="${email.id}"]`);
		const ec = await center(node);
		const zone = (await page.locator(".rvlb-zone[data-band=header]").boundingBox());
		await drag(ec, { x: zone.x + zone.width * 0.42, y: zone.y + zone.height * 0.86 });
		L = await layout();
		let em = find(L, email.id);
		check("drag out of a slot: the element is free", em && em.slot === null, JSON.stringify(em && { slot: em.slot, x: em.x, y: em.y }));

		// 5. move it with the keys: 1mm, Shift = 5mm
		const before = { x: em.x, y: em.y };
		await page.locator(`.rvlb-sheet [data-el="${email.id}"]`).focus();
		await page.keyboard.press("ArrowLeft");
		await page.keyboard.press("ArrowLeft");
		await page.keyboard.press("Shift+ArrowUp");
		L = await layout();
		em = find(L, email.id);
		check("keys: ←← = -2mm, Shift+↑ = -5mm", Math.abs(em.x - (before.x - 2)) < 0.01 && Math.abs(em.y - Math.max(0, before.y - 5)) < 0.01, JSON.stringify({ before, after: { x: em.x, y: em.y } }));

		// 6. resize from the end handle
		const w0 = em.w;
		const handle = await center(page.locator(".rvlb-zone[data-band=header] .rvlb-sel .rvlb-h[data-h=e]"));
		await drag(handle, { x: handle.x + 40, y: handle.y }, 8);
		L = await layout();
		const w1 = find(L, email.id).w;
		check("resize: the end handle widens it on the 1mm grid", w1 > w0 && Number.isInteger(Math.round(w1 * 10) / 10), `${w0} → ${w1}`);
		await shot("site-03-free-resized");

		// 7. undo / redo
		await page.locator(`.rvlb-sheet [data-el="${email.id}"]`).focus();
		await page.keyboard.press("Control+z");
		L = await layout();
		check("undo: the width is back", Math.abs(find(L, email.id).w - w0) < 0.01, String(find(L, email.id).w));
		await page.keyboard.press("Control+y");
		L = await layout();
		check("redo: the new width again", Math.abs(find(L, email.id).w - w1) < 0.01, String(find(L, email.id).w));

		// 8. drop the free element back on a slot: it is docked
		await drag(await center(page.locator(`.rvlb-sheet [data-el="${email.id}"]`)), await center(page.locator(".rvlb-zone[data-band=header] .rvlb-paper [data-slot=left] .rvlb-el").first()));
		L = await layout();
		check("drop a free element on a slot: docked", find(L, email.id)?.slot === "left", String(find(L, email.id)?.slot));

		// 9. band height by its inner edge
		const h0 = L.header.h;
		const edge = await center(page.locator(".rvlb-zone[data-band=header] .rvlb-edge"));
		await drag(edge, { x: edge.x, y: edge.y + 12 }, 6);
		L = await layout();
		check("header height by dragging its edge", L.header.h > h0, `${h0} → ${L.header.h}`);

		// 10. real preview from the server, with the margin line
		await page.click("[data-act=preview]");
		await page.waitForSelector(".rvlb-pv-head [data-rv-lh=header]", { timeout: 30000 });
		const pv = await page.evaluate(() => ({ head: document.querySelector(".rvlb-pv-head").textContent, css: document.querySelector(".rvlb-code code")?.textContent || "" }));
		check("real preview: the server's HTML with the company", pv.head.includes(name_en), pv.head.slice(0, 80));
		check("real preview: the wkhtmltopdf margin line", /\.print-format\s*\{\s*margin-top/.test(pv.css), pv.css);
		await shot("site-04-preview");
		await page.keyboard.press("Escape");
		await page.waitForTimeout(400);

		// 11. save as a new letter head
		await page.click("[data-act=save]");
		const dlg = page.locator(".modal.show");
		await dlg.locator("input[data-fieldname=name]").fill(NAME);
		await dlg.locator(".btn-primary").click();
		await page.waitForFunction((n) => frappe.get_route().join("/") === `rv-letterhead/${n}`, NAME, { timeout: 30000 }).catch(() => {});
		saved = await page.evaluate((n) => frappe.xcall("frappe.client.get", { doctype: "Letter Head", name: n }).catch(() => null), NAME);
		check("save: a new Letter Head with the generated HTML", saved && saved.source === "HTML" && /data-rv-lh="header"/.test(saved.content || "") && /data-rv-lh="footer"/.test(saved.footer || ""), saved ? saved.source : "missing");
		check("save: the route is the saved letter head, nothing left unsaved", (await page.evaluate((h) => eval(h).store.dirty, H)) === false);
		// a reload opens it in the editor, with the same layout
		await page.reload({ waitUntil: "domcontentloaded" });
		await page.waitForSelector(".rvlb-editor:not([hidden]) .rvlb-el", { timeout: 40000 });
		const L2 = await layout();
		check("reload: the saved layout opens in the editor", find(L2, country_id)?.slot === "center" && L2.header.h === L.header.h, `${L2.header.h}`);

		// 12. the saved letter head in Frappe's print view
		// a document to print: RV_PRINT_DOCTYPE/RV_PRINT_DOC, else the first the user may read
		const target = await page.evaluate(async ([dt, dn]) => {
			if (dt && dn) return [dt, dn];
			for (const d of ["Journal Entry", "Sales Invoice", "Company"]) {
				const r = await frappe.xcall("frappe.client.get_list", { doctype: d, limit_page_length: 1 }).catch(() => null);
				if (r?.length) return [d, r[0].name];
			}
			return null;
		}, [process.env.RV_PRINT_DOCTYPE, process.env.RV_PRINT_DOC]);
		const [DT, je] = target || [];
		if (je) {
			await page.goto(`${BASE}/printview?doctype=${encodeURIComponent(DT)}&name=${encodeURIComponent(je)}&format=Standard&no_letterhead=0&letterhead=${encodeURIComponent(NAME)}&settings=%7B%7D&_lang=ar`, { waitUntil: "domcontentloaded" });
			await page.waitForTimeout(800);
			const pvw = await page.evaluate(() => ({ lh: Boolean(document.querySelector("[data-rv-lh=header]")), text: document.querySelector("[data-rv-lh=header]")?.textContent || "" }));
			check("Frappe's print view shows the letter head", pvw.lh && pvw.text.includes(name_en), pvw.text.slice(0, 60));
			await shot("site-05-printview");
			// 13. and in Report View's rv-print page
			await page.goto(`${BASE}/desk/rv-print/${encodeURIComponent(DT)}/${encodeURIComponent(je)}`, { waitUntil: "domcontentloaded" });
			const V = "frappe.pages['rv-print'].rv_print.pages";
			await page.waitForFunction((v) => { try { const p = eval(v); return p.pages.length && !p.el.classList.contains("is-busy"); } catch { return false; } }, V, { timeout: 60000 });
			await page.evaluate(([v, n]) => eval(v).update({ letter_head: n }), [V, NAME]);
			await page.waitForSelector(".rv-page-lh [data-rv-lh=header]", { timeout: 30000 }).catch(() => {});
			const rvp = await page.evaluate(() => document.querySelector(".rv-page-lh [data-rv-lh=header]")?.textContent || "");
			check("rv-print shows the letter head", rvp.includes(name_en), rvp.slice(0, 60));
			await shot("site-06-rvprint");
			await page.evaluate((v) => eval(v).reset?.(), V).catch(() => {});
		} else check("a document to print", false, "none");

		// 14. phone: tap to add, no horizontal scroll
		const ph = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true });
		const pp = await ph.newPage();
		pp.on("pageerror", (e) => problems.push(`phone pageerror: ${e.message}`));
		await pp.request.post(`${BASE}/api/method/login`, { form: { usr: USER, pwd: password("RV_PW", "RV_ADMIN_PASSWORD") } });
		await pp.goto(`${BASE}/desk/rv-letterhead/${encodeURIComponent(NAME)}`, { waitUntil: "domcontentloaded" });
		await pp.waitForSelector(".rvlb-editor:not([hidden]) .rvlb-el", { timeout: 40000 });
		const n0 = await pp.evaluate((h) => eval(h).store.layout.header.elements.length, H);
		await pp.tap("[data-pane-btn=lib]");
		await pp.tap(".rvlb-item[data-token=fax]");
		await pp.waitForTimeout(300);
		const n1 = await pp.evaluate((h) => eval(h).store.layout.header.elements.length, H);
		check("phone: tap a field to add it", n1 === n0 + 1, `${n0} → ${n1}`);
		const sw = await pp.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
		check("phone: no horizontal page scroll", sw[0] <= sw[1], JSON.stringify(sw));
		if (SHOTS) await pp.screenshot({ path: `${SHOTS}/site-07-phone.png` });
		await ph.close();
	} catch (e) {
		check("the run finished", false, e.message.split("\n")[0]);
	} finally {
		// the test letter head and its layout are removed
		if (saved || NAME) {
			await page.evaluate(async (n) => {
				for (const dt of ["Letter Head Layout", "Letter Head"]) await frappe.xcall("frappe.client.delete", { doctype: dt, name: n }).catch(() => {});
			}, NAME).catch(() => {});
		}
	}
	check("no console errors", problems.length === 0, JSON.stringify(problems.slice(0, 3)));
	for (const r of results) console.log(r.join(" | "));
	console.log(`${results.filter((r) => r[0] === "PASS").length}/${results.length} passed`);
	await browser.close();
	process.exitCode = results.every((r) => r[0] === "PASS") ? 0 : 1;
})();
