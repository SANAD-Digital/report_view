// The "Custom" print source (ADR-019) on a real site, as rv_accountant: report_view.print and
// print_table from any Desk page, the print page in custom mode (pages, letter head, format
// list of Custom formats only, another format on the same data, escaping, language), the
// data of a method (bookmarkable address), a token of nobody, document mode still there,
// and the PDF (RV_PDF=1, after the server restart that loads pages_pdf_custom).
// RV_PW=… [RV_SHORT_DOC=<a Journal Entry>] [RV_PDF=1] [RV_SKIP_INLINE=1] node tests/site/custom_print.cjs
// (RV_SKIP_INLINE: the server runs code without the sent template yet)
const { chromium } = require("playwright");
const BASE = process.env.RV_SITE || "https://acc.dev.sanad.digital";
const results = [];
const check = (name, ok, info = "") => { results.push([ok ? "PASS" : "FAIL", name, info]); if (process.env.RV_VERBOSE) console.log(ok ? "PASS" : "FAIL", name, info); };
(async () => {
	const browser = await chromium.launch();
	const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
	const page = await ctx.newPage();
	const problems = [];
	page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
	page.on("dialog", (d) => { problems.push(`dialog: ${d.message()}`); d.dismiss(); });
	page.on("console", (m) => { if (m.type() === "error" && !/CORS|ERR_FAILED|dev-acc|status of 4\d\d/.test(m.text())) problems.push(m.text()); });
	await page.request.post(`${BASE}/api/method/login`, { form: { usr: process.env.RV_USER || "rv_accountant@rv.test", pwd: process.env.RV_PW } });
	const V = "frappe.pages['rv-print'].rv_print.pages";
	const settle = async () => {
		await page.waitForFunction((g) => { try { const v = eval(g); return v.pages.length && v.filled.size && !v.el.classList.contains("is-busy"); } catch { return false; } }, V, { timeout: 60000 });
		await page.evaluate(async (g) => { const v = eval(g); await v.ready; await v.fill_all(); await new Promise((r) => setTimeout(r, 150)); }, V);
	};
	const state = () => page.evaluate((g) => {
		const v = eval(g);
		return {
			route: frappe.get_route().join("/"),
			url: location.pathname + location.search,
			title: frappe.pages["rv-print"].page.title,
			note: document.querySelector(".rv-print-note")?.textContent || "",
			pages: v.sheets.querySelectorAll(".rv-page").length,
			lh: Boolean(v.sheets.querySelector(".rv-page-lh")),
			rows: v.sheets.querySelectorAll(".rv-page-flow table.rvt tbody tr").length,
			tfoot: v.sheets.querySelector(".rv-page-flow table.rvt tfoot")?.textContent?.trim() || null,
			text: v.sheets.textContent,
			img: v.sheets.querySelectorAll(".rv-page-flow img").length,
			formats: v.options?.print_formats || [],
			doc_mode: v.doc_mode,
			kind: frappe.pages["rv-print"].rv_print.kind,
		};
	}, V);

	// 1. the API exists on any Desk page
	await page.goto(`${BASE}/desk/todo`);
	await page.waitForFunction(() => window.report_view?.print_table, null, { timeout: 30000 }).catch(() => {});
	check("report_view.print / print_table / open_print on every Desk page", await page.evaluate(() => ["print", "print_table", "print_url", "open_print"].every((k) => typeof window.report_view?.[k] === "function")));

	// 2. a table, no template work: 60 rows over pages, totals, letter head
	const rows = Array.from({ length: 60 }, (_, i) => ({ item: `Item ${i + 1}`, qty: i + 1, amount: (i + 1) * 10 }));
	rows[0].item = "<img src=x onerror=window.__xss=1>";
	await page.evaluate((r) => report_view.print_table({
		title: "RV custom table", subtitle: "October", totals: true,
		columns: [{ label: "Item", fieldname: "item" }, { label: "Qty", fieldname: "qty", fieldtype: "Int" }, { label: "Amount", fieldname: "amount", fieldtype: "Currency" }],
		rows: r,
	}), rows);
	await settle();
	let s = await state();
	check("print_table opens rv-print/Custom/<token>", /^rv-print\/Custom\/[a-f0-9]{24}$/.test(s.route) && s.kind === "custom", s.route);
	check("the title is the caller's", s.title === "RV custom table", s.title);
	check("all 60 rows printed, totals row", s.rows === 60 && /1,830|1830/.test(s.tfoot || "") && /18,300|18300/.test(s.tfoot || ""), `${s.rows} ${s.tfoot}`);
	check("a long table goes over pages, letter head on the first", s.pages >= 2 && s.lh, `${s.pages} pages`);
	check("text of the data prints escaped", s.img === 0 && s.text.includes("<img src=x") && !(await page.evaluate(() => window.__xss)));
	check("the format list holds Custom formats only", s.formats.includes("Report View Table") && s.formats.every((f) => !/Journal|Sales Invoice|Standard/.test(f)), s.formats.join(","));
	const css = await page.evaluate((g) => {
		const v = eval(g);
		const th = v.sheets.querySelector(".rv-page-flow table.rvt thead th");
		return { scoped: v.fmt_css.innerHTML.includes(".rv-page-flow{"), weight: th && getComputedStyle(th).fontWeight, collapse: th && getComputedStyle(th.closest("table")).borderCollapse };
	}, V);
	check("the format's CSS is scoped to the content and applies", css.scoped && css.weight === "700" && css.collapse === "collapse", JSON.stringify(css));
	const token_url = s.url;

	// 3. landscape and back: the same data laid out again
	await page.evaluate((g) => eval(g).update({ orientation: "landscape" }), V); await settle();
	const land = await state();
	check("landscape re-lays the same rows", land.rows === 60, `${land.pages} pages`);
	await page.evaluate((g) => eval(g).update({ orientation: "portrait" }), V); await settle();

	// 4. the language of the pages: the format rendered again in Arabic / English
	await page.evaluate((g) => eval(g).update({ lang: "en" }), V); await settle();
	const en = await state();
	check("another language renders the format again", en.rows === 60 && /Total/.test(en.tfoot || ""), en.tfoot);
	await page.evaluate((g) => eval(g).update({ lang: "" }), V); await settle();

	// 5. reload of the token address: the staged data comes back
	await page.goto(`${BASE}${token_url}`); await settle();
	s = await state();
	check("the token address reloads the same print", s.rows === 60 && s.title === "RV custom table", `${s.rows}`);

	// 6. inline data with a letter head choice off, a new window
	const popup_p = ctx.waitForEvent("page");
	await page.evaluate(() => report_view.print({ print_format: "Report View Table", data: { columns: [{ label: "A", fieldname: "a" }], rows: [{ a: "one" }] }, title: "In a tab", new_window: true }));
	const popup = await popup_p;
	await popup.waitForFunction(() => { try { return frappe.pages["rv-print"].rv_print.pages.pages.length > 0; } catch { return false; } }, null, { timeout: 60000 });
	check("new_window opens the print in a tab", /\/desk\/rv-print\/Custom\/[a-f0-9]{24}$/.test(popup.url()), popup.url());
	await popup.close();

	// 7. data from a method: called by the page (GET), the address keeps the method
	const args = JSON.stringify({ doctype: "Company", fields: ["name"], limit_page_length: 5 });
	await page.goto(`${BASE}/desk/rv-print/Custom/Report%20View%20Table?method=frappe.client.get_list&args=${encodeURIComponent(args)}&title=Companies`);
	await settle();
	s = await state();
	check("a method's data prints (a list: the table says it has no columns)", s.kind === "custom" && /No columns|لا أعمدة/.test(s.text) && s.title === "Companies", `${s.title} ${s.note}`);
	check("the address keeps the method and its args", s.url.includes("method=frappe.client.get_list") && s.url.includes("args="), s.url);
	await page.evaluate(() => report_view.print({ print_format: "Report View Table", method: "frappe.client.get_list", args: { doctype: "Company", fields: ["name"] }, title: "Again" }));
	await page.waitForFunction(() => frappe.pages["rv-print"]?.page?.title === "Again", null, { timeout: 30000 }).catch(() => {});
	await settle();
	s = await state();
	check("report_view.print with a method routes in-app with a bookmarkable address", s.title === "Again" && s.url.includes("method=frappe.client.get_list"), s.url);

	// 7b. a template sent with the data (html + css): sandboxed render, the picker's own
	// choice, a saved format on the same data and back, its PDF by its token
	if (!process.env.RV_SKIP_INLINE) {
		await page.evaluate(() => report_view.print({
			html: "<h4 class='inl'>{{ title }}</h4><table class='it'>{% for r in rows %}<tr><td>{{ r.name }}</td><td>{{ format_value(r.amount, 'Currency') }}</td></tr>{% endfor %}</table><p class='leak'>{{ frappe }}</p>",
			css: ".it td{font-weight:700} .inl{letter-spacing:1px}",
			data: { rows: [{ name: "<b>bold?</b>", amount: 12.5 }, { name: "Two", amount: 3 }] },
			title: "Sent one",
		}));
		await settle();
		s = await state();
		const inl = await page.evaluate((g) => {
			const v = eval(g);
			const td = v.sheets.querySelector(".rv-page-flow table.it td");
			const lh_td = v.sheets.querySelector(".rv-page-lh td");
			return {
				rows: v.sheets.querySelectorAll(".rv-page-flow table.it tr").length,
				bold: td && getComputedStyle(td).fontWeight,
				lh_bold: lh_td ? getComputedStyle(lh_td).fontWeight : null,
				escaped: v.sheets.querySelector(".rv-page-flow table.it td")?.textContent,
				leak: v.sheets.querySelector(".rv-page-flow .leak")?.textContent,
				placeholder: v.options?.default_print_format, inline: v.options?.inline,
			};
		}, V);
		check("a sent template prints its data, escaped, with its CSS kept to the content", s.kind === "custom" && inl.rows === 2 && inl.escaped === "<b>bold?</b>" && inl.bold === "700" && inl.lh_bold !== "700" && s.title === "Sent one", JSON.stringify(inl));
		check("the sandbox: no frappe in a sent template", inl.leak === "", inl.leak);
		check("the picker offers the sent template and the saved formats", inl.inline === true && Boolean(inl.placeholder) && s.formats.includes("Report View Table"), `${inl.placeholder} ${s.formats}`);
		await page.evaluate((g) => eval(g).update({ template: "Report View Table" }), V); await settle();
		s = await state();
		check("a saved format on the sent data", /No columns|لا أعمدة/.test(s.text), s.note);
		await page.evaluate((g) => eval(g).update({ template: "" }), V); await settle();
		check("back to the sent template", await page.evaluate((g) => eval(g).sheets.querySelectorAll(".rv-page-flow table.it tr").length, V) === 2);
		const both = await page.evaluate(() => report_view.print({ print_format: "Report View Table", html: "<p></p>", data: {} }).then(() => "ok", (e) => e.message));
		check("print_format and html together are refused", both !== "ok", both);
		if (process.env.RV_PDF) {
			const dl = page.waitForEvent("download", { timeout: 120000 });
			await page.evaluate((g) => eval(g).pdf(), V);
			const file = await dl.catch(() => null);
			check("PDF of a sent template (guard: its token)", Boolean(file), file?.suggestedFilename());
		}
	}

	// 8. a token nobody staged
	await page.goto(`${BASE}/desk/rv-print/Custom/${"0".repeat(24)}`);
	await page.waitForFunction(() => (document.querySelector(".rv-print-note")?.textContent || "").length > 0, null, { timeout: 30000 }).catch(() => {});
	s = await state();
	check("an unknown token tells it has expired", /expired|انتهت/.test(s.note) && s.pages === 0, s.note);
	const dlg = problems.findIndex((p) => p.startsWith("dialog") || /expired|انتهت/.test(p));
	if (dlg >= 0) problems.splice(dlg, 1);

	// 9. document mode is unchanged after a custom print
	if (process.env.RV_SHORT_DOC) {
		await page.goto(`${BASE}/desk/rv-print/Custom/${token_url.split("/").pop()}`); await settle();
		await page.evaluate((n) => frappe.set_route("rv-print", "Journal Entry", n), process.env.RV_SHORT_DOC);
		await settle();
		s = await state();
		check("document mode after a custom print", s.kind === "document" && s.doc_mode && s.pages >= 1 && s.formats.every((f) => f !== "Report View Table"), `${s.kind} ${s.pages}`);
	}

	// 10. PDF of a custom print (needs pages_pdf_custom loaded by the server)
	if (process.env.RV_PDF) {
		await page.goto(`${BASE}${token_url}`); await settle();
		const dl = page.waitForEvent("download", { timeout: 120000 });
		await page.evaluate((g) => eval(g).pdf(), V);
		const file = await dl.catch(() => null);
		check("PDF of the custom print", Boolean(file) && /\.pdf$/.test(file.suggestedFilename()), file?.suggestedFilename());
	}

	check("no errors in the console", problems.length === 0, problems.join(" | "));
	for (const [r, n, i] of results) console.log(`${r}  ${n}${i ? `  (${i})` : ""}`);
	console.log(`${results.filter((r) => r[0] === "PASS").length}/${results.length} passed`);
	await browser.close();
	process.exit(results.some((r) => r[0] === "FAIL") ? 1 : 0);
})();
