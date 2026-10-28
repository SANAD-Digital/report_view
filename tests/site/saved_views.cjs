// Saved views (ADR-010) on a real site, as rv_accountant and rv_restricted: the API (save, list,
// a private view hidden from the other user through every door, a public one read but never
// written by them, the REST takeover {"owner": "<me>"} refused, the user's default reaching
// get_meta), then the report page: the «Views» menu, «Save as new» through Frappe's dialog, the
// changed dot, «Save», a reload with ?view= opening it again, «Delete». Everything it made is
// deleted at the end.
// [RV_USER=… RV_PW=…] [RV_USER2=… RV_PW2=…] node tests/site/saved_views.cjs
const { chromium, request } = require("playwright");
const password = require("./_password.cjs");
const BASE = require("./_site.cjs")();
const results = [];
const check = (name, ok, info = "") => {
	results.push([ok ? "PASS" : "FAIL", name, info]);
	if (process.env.RV_VERBOSE) console.log(ok ? "PASS" : "FAIL", name, info);
};
const M = "report_view.api.views";
const TB = "Trial Balance";
const DT = "Report View Saved View";
const STATE = JSON.stringify({ v: 1, mode: "grid", sort: [{ key: "closing_debit", dir: "desc" }], columns: { order: [], hidden: ["opening_debit"], widths: {}, pinned: { start: [], end: [] }, groups: null } });

async function api_client(user, pwd) {
	const ctx = await request.newContext({ baseURL: BASE, ignoreHTTPSErrors: true });
	const login = await ctx.post("/api/method/login", { form: { usr: user, pwd } });
	if (!login.ok()) throw new Error(`login of ${user} failed: ${login.status()}`);
	const csrf = await ctx.get("/app").then((r) => r.text()).then((t) => (/csrf_token\s*=\s*"([^"]+)"/.exec(t) || [])[1] || "");
	const answer = async (r) => ({ status: r.status(), body: await r.json().catch(() => ({})) });
	const headers = { "X-Frappe-CSRF-Token": csrf };
	return {
		ctx,
		get: async (fn, params) => answer(await ctx.get(`/api/method/${fn.includes(".") ? fn : `${M}.${fn}`}?${new URLSearchParams(params)}`)),
		post: async (fn, form) => answer(await ctx.post(`/api/method/${fn.includes(".") ? fn : `${M}.${fn}`}`, { form, headers })),
		rest: async (method, name, data) =>
			answer(await ctx.fetch(`/api/resource/${encodeURIComponent(DT)}${name ? `/${encodeURIComponent(name)}` : ""}`, { method, data, headers })),
	};
}

// what the script made is deleted even when it stops half way
let cleanup = async () => {};

(async () => {
	const user = process.env.RV_USER || "rv_accountant@rv.test";
	const pwd = password("RV_PW", "RV_ACCOUNTANT_PASSWORD");
	const user2 = process.env.RV_USER2 || "rv_restricted@rv.test";
	const pwd2 = password("RV_PW2", "RV_RESTRICTED_PASSWORD");
	const a = await api_client(user, pwd);
	const b = await api_client(user2, pwd2);
	const created = [];
	const stamp = Date.now();
	cleanup = async () => {
		for (const n of created) await a.post("delete_view", { report_name: TB, name: n }).catch(() => {});
		await b.post("set_default", { report_name: TB }).catch(() => {});
	};

	// 1. the API is live (a server restart loads report_view/api/views.py)
	const first = await a.get("list_views", { report_name: TB });
	check("list_views answers for a report the user may open", first.status === 200 && Array.isArray(first.body.message), `HTTP ${first.status}`);
	if (first.status !== 200) {
		for (const [s, n, i] of results) console.log(s, n, i);
		console.log("The API is not live yet: restart the server (it loads report_view/api/views.py), then run again.");
		process.exit(1);
	}
	const mine = await a.post("save_view", { report_name: TB, title: `RV private ${stamp}`, state: STATE });
	check("save_view: a private view", mine.status === 200 && Boolean(mine.body.message?.name), `HTTP ${mine.status}`);
	const priv = mine.body.message?.name;
	if (priv) created.push(priv);
	const pub = await a.post("save_view", { report_name: TB, title: `RV public ${stamp}`, state: STATE, visibility: "Public" });
	const shared = pub.body.message?.name;
	if (shared) created.push(shared);
	check("save_view: a public view", pub.status === 200 && Boolean(shared), `HTTP ${pub.status}`);
	const bad = await a.post("save_view", { report_name: TB, title: `RV bad ${stamp}`, state: JSON.stringify({ mode: "grid", evil: 1 }) });
	check("save_view: an invalid state is refused", bad.status === 417 && /RVInvalidViewState/.test(JSON.stringify(bad.body)), `HTTP ${bad.status}`);
	const listed = (await a.get("list_views", { report_name: TB })).body.message || [];
	check("list_views: both are the owner's", [priv, shared].every((n) => listed.some((r) => r.name === n && r.is_owner)));

	// 2. the private view: nothing of it for the other user, through any door
	const other_list = (await b.get("list_views", { report_name: TB })).body.message || [];
	check("another user does not list the private view", !other_list.some((r) => r.name === priv));
	const got = await b.get("get_view", { report_name: TB, name: priv });
	check("another user cannot open it (not found)", got.status === 404 && /RVViewNotFound/.test(JSON.stringify(got.body)), `HTTP ${got.status}`);
	const edit = await b.post("save_view", { report_name: TB, name: priv, title: "taken" });
	check("another user cannot edit it (not found)", edit.status === 404, `HTTP ${edit.status}`);
	const del = await b.post("delete_view", { report_name: TB, name: priv });
	check("another user cannot delete it (not found)", del.status === 404, `HTTP ${del.status}`);
	const rest_read = await b.rest("GET", priv);
	check("nor read it through REST", rest_read.status === 403, `HTTP ${rest_read.status}`);
	const rest_list = await b.get("frappe.client.get_list", { doctype: DT, fields: JSON.stringify(["name"]), limit_page_length: 0 });
	check("nor list it through frappe.client.get_list", rest_list.status === 200 && !(rest_list.body.message || []).some((r) => r.name === priv), `HTTP ${rest_list.status}`);

	// 3. the public view: read by the other user, written by its owner only
	const seen = await b.get("get_view", { report_name: TB, name: shared });
	check("another user opens the public view", seen.status === 200 && seen.body.message?.is_owner === false, `HTTP ${seen.status}`);
	const not_owner = await b.post("save_view", { report_name: TB, name: shared, title: "taken" });
	check("but cannot change it (RVNotOwner)", not_owner.status === 403 && /RVNotOwner/.test(JSON.stringify(not_owner.body)), `HTTP ${not_owner.status}`);
	const takeover = await b.rest("PUT", shared, { owner: user2, title: "taken" });
	check("REST: PUT {owner: <me>} is refused", takeover.status === 403, `HTTP ${takeover.status}`);
	const rest_del = await b.rest("DELETE", shared);
	check("REST: DELETE by another user is refused", rest_del.status === 403, `HTTP ${rest_del.status}`);
	const still = await a.get("get_view", { report_name: TB, name: shared });
	check("the public view is unchanged and still the owner's", still.body.message?.is_owner === true && still.body.message?.title === `RV public ${stamp}`);

	// 4. the user's default reaches get_meta (theirs only)
	const def = await b.post("set_default", { report_name: TB, name: shared });
	check("set_default: a visible view", def.status === 200, `HTTP ${def.status}`);
	const meta = await b.get("report_view.api.get_meta", { report_name: TB });
	check("get_meta opens with the user's default", meta.body.message?.defaults?.saved_view === shared && meta.body.message?.defaults?.source === "user", JSON.stringify(meta.body.message?.defaults));
	const meta_a = await a.get("report_view.api.get_meta", { report_name: TB });
	check("another user's default is not the owner's", meta_a.body.message?.defaults?.saved_view !== shared);
	const def_priv = await b.post("set_default", { report_name: TB, name: priv });
	check("set_default: a view the user may not see is refused", def_priv.status === 404, `HTTP ${def_priv.status}`);
	await b.post("set_default", { report_name: TB });

	// 5. the report page
	const browser = await chromium.launch();
	const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
	const page = await ctx.newPage();
	const problems = [];
	page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
	page.on("console", (m) => {
		if (m.type() === "error" && !/CORS|ERR_FAILED|status of 4\d\d/.test(m.text())) problems.push(m.text());
	});
	await page.request.post(`${BASE}/api/method/login`, { form: { usr: user, pwd } });
	const ready = () =>
		page.waitForFunction(
			() => {
				const rv = document.querySelector("#page-report-view")?.rv_page;
				return rv && rv.opened && rv.grid.current === rv.opened && rv.debug_totals();
			},
			null,
			{ timeout: 60000 }
		);
	const st = () =>
		page.evaluate(() => {
			const rv = document.querySelector("#page-report-view").rv_page;
			return {
				shown: !document.querySelector(".rv-views")?.hidden,
				name: document.querySelector(".rv-views-btn .nm")?.textContent,
				dot: !document.querySelector(".rv-views-btn .dot")?.hidden,
				applied: rv.applied_view?.name || null,
				view: new URLSearchParams(location.search).get("view"),
			};
		});
	const title = `RV page ${stamp}`;
	await page.goto(`${BASE}/desk/report-view/Trial%20Balance`, { waitUntil: "domcontentloaded", timeout: 90000 });
	await ready();
	let s = await st();
	check("the «Views» control is in the head", s.shown, JSON.stringify(s));
	await page.click(".rv-views-btn");
	await page.locator(".rv-views-pop .rv-preset-grp").first().waitFor();
	check("the menu lists the user's views", (await page.locator(`.rv-views-pop [data-apply="${priv}"]`).count()) === 1);
	await page.click('.rv-views-pop [data-act="save-new"]');
	const modal = page.locator(".modal.show");
	await modal.locator('[data-fieldname="title"] input').fill(title);
	await modal.locator(".btn-modal-primary").click();
	await page.waitForFunction((n) => document.querySelector(".rv-views-btn .nm")?.textContent === n, title, { timeout: 15000 }).catch(() => {});
	await page.waitForTimeout(600);
	s = await st();
	check("«Save as new» applies the new view, and the link names it", s.name === title && !s.dot && Boolean(s.view), JSON.stringify(s));
	const made = s.applied;
	if (made) created.push(made);
	await page.evaluate(() => document.querySelector("#page-report-view").rv_page.controls.toggle_sort("closing_credit"));
	await ready();
	await page.waitForTimeout(600);
	check("a change shows the dot", (await st()).dot);
	await page.click(".rv-views-btn");
	await page.click('.rv-views-pop [data-act="save"]');
	await page.waitForFunction(() => document.querySelector(".rv-views-btn .dot")?.hidden, null, { timeout: 15000 }).catch(() => {});
	check("«Save» writes the change into the view", !(await st()).dot);
	await page.goto(`${BASE}/desk/report-view/Trial%20Balance?view=${encodeURIComponent(made)}`, { waitUntil: "domcontentloaded", timeout: 90000 });
	await ready();
	await page.waitForTimeout(600);
	s = await st();
	check("a link with ?view= opens it again", s.applied === made && s.name === title && !s.dot, JSON.stringify(s));
	await page.click(".rv-views-btn");
	await page.locator('.rv-views-pop [data-act="delete"]:not([disabled])').waitFor({ timeout: 15000 });
	await page.click('.rv-views-pop [data-act="delete"]');
	await page.locator(".modal.show .btn-modal-primary").last().click({ timeout: 15000 });
	await page.waitForFunction(() => !document.querySelector("#page-report-view").rv_page.applied_view, null, { timeout: 15000 }).catch(() => {});
	const after = (await a.get("list_views", { report_name: TB })).body.message || [];
	check("«Delete» removes it", !after.some((r) => r.name === made));
	// a link to another user's private view: the page opens without it and says so
	const page2 = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
	await page2.request.post(`${BASE}/api/method/login`, { form: { usr: user2, pwd: pwd2 } });
	await page2.goto(`${BASE}/desk/report-view/Trial%20Balance?view=${encodeURIComponent(priv)}`, { waitUntil: "domcontentloaded", timeout: 90000 });
	await page2.waitForFunction(() => document.querySelector("#page-report-view")?.rv_page?.state, null, { timeout: 60000 });
	await page2.waitForTimeout(1500);
	const p2 = await page2.evaluate(() => ({ applied: document.querySelector("#page-report-view").rv_page.applied_view?.name || null, alert: document.querySelector(".desk-alert, .alert-message")?.textContent || "" }));
	check("another user's link to a private view opens the report without it", p2.applied === null, JSON.stringify(p2));
	check("no errors in the console", problems.length === 0, problems.join(" | "));

	await cleanup();
	await browser.close();
	await a.ctx.dispose();
	await b.ctx.dispose();
	for (const [r, n, i] of results) console.log(r, n, i);
	const failed = results.filter((r) => r[0] === "FAIL").length;
	console.log(`${results.length - failed}/${results.length} passed`);
	process.exit(failed ? 1 : 0);
})().catch(async (e) => {
	console.error(e);
	for (const [r, n, i] of results) console.log(r, n, i);
	await cleanup();
	process.exit(1);
});
