// Variables of a print format (ADR-024) on a real site: rv_admin makes a document print
// format with variables through the API (a wrong definition refused), its form shows «Add
// variables» and the dialog lists them; rv_accountant prints a Journal Entry with it: the
// «Variables» tool, the defaults in the template, a switch and a list rendered again, a Link
// the user may not name refused by the server; the format is deleted at the end.
// [RV_ADMIN=… RV_ADMIN_PW=…] [RV_USER=… RV_PW=…] node tests/site/variables.cjs
const fs = require("node:fs");
const path = require("node:path");
const { chromium, request } = require("playwright");
const password = require("./_password.cjs");
const BASE = require("./_site.cjs")();
const SHOTS = process.env.RV_SHOTS || null;
const results = [];
const check = (name, ok, info = "") => results.push([ok ? "PASS" : "FAIL", name, info]);

async function api_client(user, pwd) {
	const ctx = await request.newContext({ baseURL: BASE, ignoreHTTPSErrors: true });
	const login = await ctx.post("/api/method/login", { form: { usr: user, pwd } });
	if (!login.ok()) throw new Error(`login of ${user} failed: ${login.status()}`);
	const csrf = await ctx.get("/app").then((r) => r.text()).then((t) => (/csrf_token\s*=\s*"([^"]+)"/.exec(t) || [])[1] || "");
	const headers = { "X-Frappe-CSRF-Token": csrf, Accept: "application/json" };
	const out = async (r) => ({ status: r.status(), body: await r.json().catch(() => ({})) });
	return {
		ctx,
		get: async (method, params) => out(await ctx.get(`/api/method/${method}?${new URLSearchParams(params)}`, { headers })),
		insert: async (doc) => out(await ctx.post(`/api/resource/${encodeURIComponent(doc.doctype)}`, { data: doc, headers })),
		remove: async (doctype, name) => out(await ctx.delete(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`, { headers })),
	};
}

const DEFS = [
	{ label: "Show the note", fieldname: "show_note", fieldtype: "Check", default: 1 },
	{ label: "Tone", fieldname: "tone", fieldtype: "Select", options: "Short\nLong", default: "Short" },
	{ label: "Company", fieldname: "pick_company", fieldtype: "Link", options: "Company" },
	{ label: "Copies", fieldname: "copies", fieldtype: "Int", default: 2 },
];
const HTML = '<div class="rv-var-out">S={{ variables.show_note }} T={{ variables.tone }} C={{ variables.pick_company }} N={{ variables.copies }}</div>{% if variables.show_note %}<p class="rv-var-note">{{ doc.name }}</p>{% endif %}';

(async () => {
	const admin = await api_client(process.env.RV_ADMIN || "rv_admin@rv.test", password("RV_ADMIN_PW", "RV_ADMIN_PASSWORD"));
	const user = process.env.RV_USER || "rv_accountant@rv.test";
	const acc = await api_client(user, password("RV_PW", "RV_ACCOUNTANT_PASSWORD"));
	const name = `RV Site Vars ${Date.now()}`;
	const base = { doctype: "Print Format", doc_type: "Journal Entry", custom_format: 1, print_format_type: "Jinja", standard: "No", module: "Report View", html: HTML };

	// 1. the definitions are checked on save
	const bad = await admin.insert({ ...base, name: `${name} bad`, rv_variables: JSON.stringify([{ label: "X", fieldname: "doc", fieldtype: "Check" }]) });
	check("a reserved variable name is refused on save", bad.status === 417, `HTTP ${bad.status}`);
	const made = await admin.insert({ ...base, name, rv_variables: JSON.stringify(DEFS) });
	check("rv_admin saves a format with four variables", made.status === 200 && JSON.parse(made.body.data?.rv_variables || "[]").length === 4, `HTTP ${made.status}`);
	if (made.status !== 200) {
		for (const [s, n, i] of results) console.log(s, n, i);
		process.exit(1);
	}

	const je = (await acc.get("frappe.client.get_list", { doctype: "Journal Entry", filters: JSON.stringify({ docstatus: 1 }), fields: JSON.stringify(["name", "company"]), limit_page_length: 1 })).body.message?.[0];
	const browser = await chromium.launch();
	try {
		// 2. the API: the options list the variables; a Link the user may not name is refused
		const opts = await acc.get("report_view.api.document.get_doc_print_options", { doctype: "Journal Entry", name: je.name });
		check("the options list the format's variables", (opts.body.message?.print_format_variables?.[name] || []).length === 4, `HTTP ${opts.status}`);
		const ok = await acc.get("report_view.api.document.render_doc_print", { doctype: "Journal Entry", name: je.name, print_format: name, variables: JSON.stringify({ pick_company: je.company, tone: "Long" }) });
		check("render: a company the user may read", ok.status === 200 && ok.body.message.html.includes(`T=Long C=${je.company}`), `HTTP ${ok.status}`);
		const refused = await acc.get("report_view.api.document.render_doc_print", { doctype: "Journal Entry", name: je.name, print_format: name, variables: JSON.stringify({ pick_company: "No Such Company RV" }) });
		check("render: a record the user may not read is refused", refused.status === 403, `HTTP ${refused.status}`);
		const wrong = await acc.get("report_view.api.document.render_doc_print", { doctype: "Journal Entry", name: je.name, print_format: name, variables: JSON.stringify({ tone: "Medium" }) });
		check("render: a Select value not of its options is refused", wrong.status === 417, `HTTP ${wrong.status}`);

		// 3. the print page as the accountant
		const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
		const page = await ctx.newPage();
		const problems = [];
		page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
		page.on("console", (m) => {
			if (m.type() === "error" && !/CORS|ERR_FAILED|dev-acc/.test(m.text())) problems.push(m.text());
		});
		await page.request.post(`${BASE}/api/method/login`, { form: { usr: user, pwd: password("RV_PW", "RV_ACCOUNTANT_PASSWORD") } });
		const V = "frappe.pages['rv-print'].rv_print.pages";
		const settle = async () => {
			await page.waitForFunction((g) => { try { const v = eval(g); return v.pages.length && !v.el.classList.contains("is-busy"); } catch { return false; } }, V, { timeout: 60000 });
			await page.evaluate(async (g) => { const v = eval(g); await v.ready; await new Promise((r) => setTimeout(r, 150)); }, V);
		};
		const out_text = () => page.locator(".rv-print-sheets .rv-var-out").first().textContent();
		await page.goto(`${BASE}/desk/rv-print/Journal%20Entry/${encodeURIComponent(je.name)}`);
		await settle();
		await page.evaluate(([g, n]) => eval(g).update({ template: n }), [V, name]);
		await page.waitForTimeout(80);
		await settle();
		check("the defaults reach the template", /S=1 T=Short C= N=2/.test((await out_text()) || ""), await out_text());
		const tool = page.locator('details[data-sec="vars"] > summary');
		check("the «Variables» tool is in the toolbar", (await tool.count()) === 1);
		await tool.click();
		const menu = page.locator(".rv-print-pop");
		check("a control per variable", (await menu.locator("[data-var-sw], select[data-var], [data-var-link], input[data-var-num]").count()) === 4);
		check("the Link is Frappe's Link control", (await menu.locator("[data-var-link] input").count()) === 1);
		if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "site-variables-menu.png") });
		await menu.locator("[data-var-sw=show_note]").click();
		await page.waitForFunction(() => /S=0/.test(document.querySelector(".rv-print-sheets .rv-var-out")?.textContent || ""), null, { timeout: 20000 }).catch(() => {});
		check("a switch renders the format again", /S=0 T=Short/.test((await out_text()) || "") && (await page.locator(".rv-print-sheets .rv-var-note").count()) === 0, await out_text());
		await menu.locator("select[data-var=tone]").selectOption("Long");
		await page.waitForFunction(() => /T=Long/.test(document.querySelector(".rv-print-sheets .rv-var-out")?.textContent || ""), null, { timeout: 20000 }).catch(() => {});
		check("a list renders the format again", /S=0 T=Long/.test((await out_text()) || ""), await out_text());
		if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "site-variables-changed.png") });
		const saved = await page.evaluate(([g, n]) => eval(g).settings.variables[n], [V, name]);
		check("the values are kept with the print settings", saved?.show_note === 0 && saved?.tone === "Long", JSON.stringify(saved));
		// back to the standard settings of this user
		await page.evaluate((g) => eval(g).reset(), V);
		await page.waitForTimeout(400);
		check("no errors in the browser console", problems.length === 0, problems.join(" | "));
		await ctx.close();

		// 4. the form of the format, as rv_admin: «Add variables» opens the table
		const actx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
		const apage = await actx.newPage();
		await apage.request.post(`${BASE}/api/method/login`, { form: { usr: process.env.RV_ADMIN || "rv_admin@rv.test", pwd: password("RV_ADMIN_PW", "RV_ADMIN_PASSWORD") } });
		// a site may gate the Print Format form in the browser (the site_quota app's route
		// blocker asks the server, then routes away): the test opens the form all the same
		await apage.route(/site_quota\.quota\.check_feature_permission/, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ message: { allowed: true } }) }));
		await apage.goto(`${BASE}/desk/print-format/${encodeURIComponent(name)}`);
		const btn = apage.locator(".page-head button:visible", { hasText: /إضافة متغيرات|Add variables/ });
		await btn.first().waitFor({ timeout: 30000 }).catch(() => {});
		check("the form has «Add variables»", (await btn.count()) > 0);
		if (await btn.count()) {
			await btn.first().click();
			const dialog = apage.locator(".modal.show");
			await dialog.locator(".grid-body .grid-row").first().waitFor({ timeout: 10000 }).catch(() => {});
			check("the dialog lists the four variables", (await dialog.locator(".grid-body .rows .grid-row").count()) === 4);
			if (SHOTS) await apage.screenshot({ path: path.join(SHOTS, "site-variables-dialog.png") });
			// a reserved name is refused in the dialog, as on the server
			// the variables dialog itself: another app's modal (site_quota) may have reset cur_dialog
			const vars_dialog = await apage.evaluateHandle(() => (frappe.ui.open_dialogs || []).find((d) => d.fields_dict && d.fields_dict.variables) || cur_dialog);
			await apage.evaluate((d) => {
				const f = d.fields_dict.variables;
				f.df.data.push({ label: "Doc", fieldname: "doc", fieldtype: "Check" });
				f.grid.refresh();
			}, vars_dialog);
			await apage.evaluate((d) => d.get_primary_btn().click(), vars_dialog);
			const msg = apage.locator(".modal.show .msgprint");
			await msg.first().waitFor({ timeout: 10000 }).catch(() => {});
			check("the dialog refuses a reserved name", /doc/.test((await msg.first().textContent().catch(() => "")) || ""));
			await apage.evaluate(() => frappe.msg_dialog?.hide());
			await apage.waitForTimeout(400);
			// without it: applied to the form, which is then saved (the server checks again)
			const applied = await apage.evaluate(async (d) => {
				d.fields_dict.variables.df.data.pop();
				d.fields_dict.variables.df.data[1].default = "Long";
				d.fields_dict.variables.grid.refresh();
				d.get_primary_btn().click();
				await new Promise((r) => setTimeout(r, 300));
				const dirty = cur_frm.is_dirty();
				await cur_frm.save();
				return { dirty, defs: JSON.parse(cur_frm.doc.rv_variables || "[]") };
			}, vars_dialog);
			check("Apply writes the field and the form saves it", applied.dirty && applied.defs.length === 4 && applied.defs[1].default === "Long", JSON.stringify(applied.defs.map((d) => d.default)));
		}
		await actx.close();
	} catch (e) {
		check("the run finished", false, String(e.message || e).split("\n")[0]);
	} finally {
		await browser.close();
		const del = await admin.remove("Print Format", name);
		check("the test format is deleted", del.status === 202 || del.status === 200, `HTTP ${del.status}`);
		await admin.ctx.dispose();
		await acc.ctx.dispose();
	}
	for (const [s, n, i] of results) console.log(s, n, i);
	process.exit(results.some((r) => r[0] === "FAIL") ? 1 : 0);
})();
