// Print presets (ADR-020) on a real site, as rv_accountant: the API (list, save, a public
// preset refused to a user who may not publish, validation), then the print page of a
// document: the control in the head, «Save as new» through Frappe's dialog, the changed
// dot, «Save», the preset shown again after a reload, «Delete». A second user
// (RV_USER2/RV_PW2, e.g. rv_restricted) checks the privacy of the private preset.
// [RV_USER=… RV_PW=…] [RV_USER2=… RV_PW2=…] node tests/site/print_presets.cjs
const { chromium, request } = require("playwright");
const password = require("./_password.cjs");
const BASE = require("./_site.cjs")();
const results = [];
const check = (name, ok, info = "") => {
	results.push([ok ? "PASS" : "FAIL", name, info]);
	if (process.env.RV_VERBOSE) console.log(ok ? "PASS" : "FAIL", name, info);
};
const M = "report_view.api.print_presets";

async function api_client(user, pwd) {
	const ctx = await request.newContext({ baseURL: BASE, ignoreHTTPSErrors: true });
	const login = await ctx.post("/api/method/login", { form: { usr: user, pwd } });
	if (!login.ok()) throw new Error(`login of ${user} failed: ${login.status()}`);
	const csrf = await ctx.get("/app").then((r) => r.text()).then((t) => (/csrf_token\s*=\s*"([^"]+)"/.exec(t) || [])[1] || "");
	const get = async (fn, params) => {
		const r = await ctx.get(`/api/method/${M}.${fn}?${new URLSearchParams(params)}`);
		return { status: r.status(), body: await r.json().catch(() => ({})) };
	};
	const post = async (fn, form) => {
		const r = await ctx.post(`/api/method/${M}.${fn}`, { form, headers: { "X-Frappe-CSRF-Token": csrf } });
		return { status: r.status(), body: await r.json().catch(() => ({})) };
	};
	return { ctx, get, post };
}

(async () => {
	const user = process.env.RV_USER || "rv_accountant@rv.test";
	const a = await api_client(user, password("RV_PW", "RV_ACCOUNTANT_PASSWORD"));
	const created = [];
	// 1. the API is live (a server restart loads report_view.api.print_presets)
	const first = await a.get("list", { context: "Report", target: "Trial Balance" });
	check("list answers for a report the user may print", first.status === 200 && Array.isArray(first.body.message?.mine), `HTTP ${first.status}`);
	if (first.status !== 200) {
		for (const [s, n, i] of results) console.log(s, n, i);
		console.log("The API is not live yet: restart the server (it loads report_view/api/print_presets.py), then run again.");
		process.exit(1);
	}
	check("a user who may not publish is told so", first.body.message.can_publish === false);
	const settings = JSON.stringify({ size: "A4", orientation: "landscape", page_numbers: true });
	const mine = await a.post("save", { context: "Report", target: "Trial Balance", preset_name: `RV site ${Date.now()}`, settings });
	check("save: a private preset", mine.status === 200 && mine.body.message?.public === false && mine.body.message?.can_edit === true, `HTTP ${mine.status}`);
	if (mine.body.message) created.push(mine.body.message.name);
	const pub = await a.post("save", { context: "Report", target: "Trial Balance", preset_name: `RV public ${Date.now()}`, settings, public: 1 });
	check("save: public refused to a user who is not System Manager or Report Manager", pub.status === 403, `HTTP ${pub.status}`);
	const bad = await a.post("save", { context: "Report", target: "Trial Balance", preset_name: "RV bad", settings: JSON.stringify({ size: "A4", evil: 1 }) });
	check("save: an unknown setting is refused", bad.status === 417 && /evil/.test(JSON.stringify(bad.body)), `HTTP ${bad.status}`);
	const big = await a.post("save", { context: "Report", target: "Trial Balance", preset_name: "RV big", settings: JSON.stringify({ wm_text: "x".repeat(40000) }) });
	check("save: settings over 32 KB are refused", big.status === 417, `HTTP ${big.status}`);
	const again = await a.get("list", { context: "Report", target: "Trial Balance" });
	check("list: the private preset is the user's", again.body.message?.mine.some((r) => r.name === mine.body.message?.name));

	// 2. privacy: another user neither sees nor edits it
	if (process.env.RV_USER2 && process.env.RV_PW2) {
		const b = await api_client(process.env.RV_USER2, process.env.RV_PW2);
		const other = await b.get("list", { context: "Report", target: "Trial Balance" });
		const names = [...(other.body.message?.mine || []), ...(other.body.message?.public || [])].map((r) => r.name);
		check("another user does not see the private preset", other.status === 200 && !names.includes(mine.body.message.name), `HTTP ${other.status}`);
		const edit = await b.post("save", { context: "Report", target: "Trial Balance", name: mine.body.message.name, preset_name: "taken" });
		check("another user cannot edit it", edit.status === 403, `HTTP ${edit.status}`);
		const del = await b.post("delete", { name: mine.body.message.name });
		check("another user cannot delete it", del.status === 403, `HTTP ${del.status}`);
		const rest = await b.ctx.get(`/api/resource/Print Preset/${mine.body.message.name}`);
		check("nor read it through REST", rest.status() === 403, `HTTP ${rest.status()}`);
		await b.ctx.dispose();
	} else {
		check("privacy across users (RV_USER2/RV_PW2 not given: skipped)", true);
	}

	// 3. the print page of a document
	const je = await a.ctx.get(`/api/method/frappe.client.get_list?${new URLSearchParams({ doctype: "Journal Entry", filters: JSON.stringify({ docstatus: 1 }), fields: JSON.stringify(["name"]), limit_page_length: 1 })}`).then((r) => r.json());
	const doc = je.message?.[0]?.name;
	const browser = await chromium.launch();
	const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
	const page = await ctx.newPage();
	const problems = [];
	page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
	page.on("console", (m) => {
		if (m.type() === "error" && !/CORS|ERR_FAILED|dev-acc|status of 4\d\d/.test(m.text())) problems.push(m.text());
	});
	await page.request.post(`${BASE}/api/method/login`, { form: { usr: user, pwd: password("RV_PW", "RV_ACCOUNTANT_PASSWORD") } });
	const V = "frappe.pages['rv-print'].rv_print.pages";
	const settle = async () => {
		await page.waitForFunction((g) => { try { const v = eval(g); return v.pages.length && v.filled.size && !v.el.classList.contains("is-busy"); } catch { return false; } }, V, { timeout: 60000 });
		await page.evaluate(async (g) => { await eval(g).ready; await new Promise((r) => setTimeout(r, 300)); }, V);
	};
	const state = () => page.evaluate(() => ({
		shown: !document.querySelector(".rv-preset")?.hidden,
		name: document.querySelector(".rv-preset-btn .nm")?.textContent,
		dot: !document.querySelector(".rv-preset-btn .dot")?.hidden,
	}));
	const name = `RV doc ${Date.now()}`;
	if (!doc) check("a submitted Journal Entry to print", false);
	else {
		await page.goto(`${BASE}/desk/rv-print/Journal%20Entry/${encodeURIComponent(doc)}`);
		await settle();
		let s = await state();
		check("the preset control is in the head of the print toolbar", s.shown, JSON.stringify(s));
		await page.click(".rv-preset-btn");
		await page.click('.rv-preset-pop [data-act="save-new"]');
		const modal = page.locator(".modal.show");
		await modal.locator('[data-fieldname="preset_name"] input').fill(name);
		check("a user who may not publish has no «Who sees it»", (await modal.locator('[data-fieldname="visibility"]').count()) === 0);
		await modal.locator(".btn-modal-primary").click();
		await page.waitForFunction((n) => document.querySelector(".rv-preset-btn .nm")?.textContent === n, name, { timeout: 15000 }).catch(() => {});
		s = await state();
		check("«Save as new» applies the new preset", s.name === name && !s.dot, JSON.stringify(s));
		await page.evaluate((g) => eval(g).update({ orientation: eval(g).settings.orientation === "landscape" ? "portrait" : "landscape" }), V);
		await settle();
		check("a change shows the dot", (await state()).dot);
		if (!(await page.locator(".rv-preset-pop").count())) await page.click(".rv-preset-btn");
		await page.click('.rv-preset-pop [data-act="save"]');
		await page.waitForFunction(() => document.querySelector(".rv-preset-btn .dot")?.hidden, null, { timeout: 15000 }).catch(() => {});
		check("«Save» writes the change into the preset", !(await state()).dot);
		// the user's settings remember the preset: after a reload it is shown again
		await page.waitForTimeout(1500);
		await page.reload();
		await settle();
		s = await state();
		check("after a reload the preset is shown again", s.name === name && !s.dot, JSON.stringify(s));
		const listed = await a.get("list", { context: "Document", target: "Journal Entry" });
		const row = listed.body.message?.mine.find((r) => r.preset_name === name);
		check("the preset is the document type's own", row?.specific === true && row?.target === "Journal Entry");
		if (row) created.push(row.name);
		// delete through the menu (Frappe's confirm)
		await page.click(".rv-preset-btn");
		await page.click('.rv-preset-pop [data-act="delete"]');
		await page.locator(".modal.show .btn-primary").last().click();
		await page.waitForFunction((n) => document.querySelector(".rv-preset-btn .nm")?.textContent !== n, name, { timeout: 15000 }).catch(() => {});
		const after = await a.get("list", { context: "Document", target: "Journal Entry" });
		check("«Delete» removes it", !after.body.message?.mine.some((r) => r.preset_name === name));
	}
	check("no errors in the console", problems.length === 0, problems.join(" | "));
	for (const n of created) await a.post("delete", { name: n });
	await browser.close();
	await a.ctx.dispose();
	for (const [s, n, i] of results) console.log(s, n, i);
	const failed = results.filter((r) => r[0] === "FAIL").length;
	console.log(`${results.length - failed}/${results.length} passed`);
	process.exit(failed ? 1 : 0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
