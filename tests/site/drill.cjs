// Configured drill (phase 5d) on a real site: Trial Balance -> General Ledger.
// As rv_accountant: the page of Trial Balance, a right click on an account row, «Drill to General
// Ledger»: a drawer with the General Ledger of that account and period as a compact grid, its
// numbers those of api.run for the same filters; closing it leaves no engine handle.
// As rv_restricted (User Permission on one company): the same drill forged with another company
// is refused and drawn as the server's refusal; through the API, another company, and its own
// company with another company's account (ADR-021, MultiSelectList values), are both refused.
//   set -a; . ~/.config/report_view/test-users.env; set +a
//   [RV_SHOTS=dir] node tests/site/drill.cjs
const { chromium, request } = require("playwright");
const password = require("./_password.cjs");
const BASE = require("./_site.cjs")();
const results = [];
const check = (name, ok, info = "") => results.push([ok ? "PASS" : "FAIL", name, info]);
const SHOTS = process.env.RV_SHOTS || "";
const TB = "Trial Balance";
const GL = "General Ledger";

async function api_client(user, pwd) {
	const ctx = await request.newContext({ baseURL: BASE, ignoreHTTPSErrors: true });
	const login = await ctx.post("/api/method/login", { form: { usr: user, pwd } });
	if (!login.ok()) throw new Error(`login of ${user} failed: ${login.status()}`);
	const csrf = await ctx.get("/app").then((r) => r.text()).then((t) => (/csrf_token\s*=\s*"([^"]+)"/.exec(t) || [])[1] || "");
	const run = async (report_name, filters, js_filters = []) => {
		const r = await ctx.post("/api/method/report_view.api.run", {
			form: { report_name, filters: JSON.stringify(filters), js_filters: JSON.stringify(js_filters) },
			headers: { "X-Frappe-CSRF-Token": csrf },
		});
		return { status: r.status(), body: await r.json().catch(() => ({})) };
	};
	const get = async (method, params) => (await ctx.get(`/api/method/${method}?${new URLSearchParams(params)}`)).json();
	return { ctx, run, get };
}

async function open_tb(browser, user, pwd) {
	const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
	const page = await ctx.newPage();
	const problems = [];
	page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
	page.on("console", (m) => {
		if (m.type() === "error" && !/status of 4\d\d|CORS|ERR_FAILED/.test(m.text())) problems.push(m.text());
	});
	await page.request.post(`${BASE}/api/method/login`, { form: { usr: user, pwd } });
	await page.goto(`${BASE}/desk/report-view/${encodeURIComponent(TB)}`);
	await page.waitForFunction(() => {
		const p = document.querySelector("#page-report-view")?.rv_page;
		return Boolean(p?.opened && p.grid.rt && document.querySelector(".rv regular-table tbody tr:not(.stale) td"));
	}, null, { timeout: 90000 });
	await page.waitForTimeout(800);
	return { ctx, page, problems };
}

// the page object of the report view (the page's wrapper keeps it)
const PAGE = "document.querySelector('#page-report-view').rv_page";

(async () => {
	const acc_user = process.env.RV_USER || "rv_accountant@rv.test";
	const res_user = process.env.RV_USER2 || "rv_restricted@rv.test";
	const acc_pw = password("RV_PW", "RV_ACCOUNTANT_PASSWORD");
	const res_pw = password("RV_PW2", "RV_RESTRICTED_PASSWORD");
	const a = await api_client(acc_user, acc_pw);
	const r = await api_client(res_user, res_pw);

	// 1. the rule reaches get_meta
	const meta = await a.get("report_view.api.get_meta", { report_name: TB });
	const rule = (meta.message?.settings?.drilldowns || []).find((x) => x.report === GL);
	check("get_meta carries the shipped Trial Balance -> General Ledger rule", Boolean(rule), JSON.stringify(rule || {}));

	const browser = await chromium.launch();
	try {
		// 2. rv_accountant: the drill from the context menu
		const { ctx, page, problems } = await open_tb(browser, acc_user, acc_pw);
		const found = await page.evaluate(async (P) => {
			const p = eval(P);
			if (!p) return { error: "no page object" };
			const g = p.grid;
			const row = p.report.rows.find((x) => x.account && !x.is_group_account && ((x.debit || 0) || (x.credit || 0)));
			if (!row) return { error: "no account with a movement" };
			const y = await g.locate(`r:${row.__rid}`);
			g.reveal(y, g.range_keys().indexOf("debit"));
			return { y, account: row.account, debit: row.debit, credit: row.credit, filters: p.last_filters };
		}, PAGE);
		check("the page shows an account with a movement", !found.error, found.error || found.account);
		if (!found.error) {
			await page.waitForTimeout(500);
			const pt = await page.evaluate(([P, y]) => {
				const g = eval(P).grid;
				const c = g.range_keys().indexOf("debit");
				for (const tr of g.rt.querySelectorAll("tbody tr:not(.stale)")) for (const cell of tr.children) {
					const at = g.cell_of(cell);
					if (at && at.y === y && at.c === c) {
						const b = cell.getBoundingClientRect();
						return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
					}
				}
				return null;
			}, [PAGE, found.y]);
			const handles_before = await page.evaluate(([P]) => eval(P).debug_handles().length, [PAGE]);
			await page.mouse.click(pt.x, pt.y, { button: "right" });
			const item = page.locator('.rv-ctx [data-item="drill"]');
			check("the context menu offers «Drill to General Ledger»", (await item.count()) === 1);
			await item.click();
			await page.waitForFunction(() => ["ready", "error", "empty"].includes(document.querySelector(".rv-drill")?.dataset.state), null, { timeout: 90000 });
			const state = await page.evaluate(() => document.querySelector(".rv-drill").dataset.state);
			check("the drawer shows the General Ledger as a grid", state === "ready", state);
			const rows = await page.locator(".rv-drill regular-table tbody tr:not(.stale)").count();
			check("the grid has rows", rows > 0, String(rows));
			if (SHOTS) await page.screenshot({ path: `${SHOTS}/site-drill-tb-gl.png` });
			// the same run through the API: the entries of that account only, the TB's movement
			const filters = await page.evaluate(([P]) => eval(P).drill.filters, [PAGE]);
			check("the drill maps the account and the period", JSON.stringify(filters.account) === JSON.stringify([found.account]) && filters.from_date === found.filters.from_date && filters.to_date === found.filters.to_date && filters.company === found.filters.company, JSON.stringify(filters));
			const gl = await a.run(GL, filters, [{ fieldname: "account", fieldtype: "MultiSelectList", options: "Account" }]);
			const entries = (gl.body.message?.raw?.result || []).filter((x) => x && x.voucher_no);
			const debit = entries.reduce((s, x) => s + (x.debit || 0), 0);
			check("its entries are the account's, its debit the Trial Balance's", entries.every((x) => x.account === found.account) && Math.abs(debit - (found.debit || 0)) < 0.01, `${entries.length} entries, ${debit} vs ${found.debit}`);
			const before = await page.evaluate(() => document.querySelectorAll(".rv-drill").length);
			await page.keyboard.press("Escape");
			await page.waitForTimeout(500);
			const after = await page.evaluate(([P]) => eval(P).debug_handles().length, [PAGE]);
			check("Escape closes the drawer and its engine views and tables are gone", before === 1 && (await page.locator(".rv-drill").count()) === 0 && after === handles_before, `${handles_before} -> ${after}`);
		}
		check("no errors in the accountant's console", problems.length === 0, problems.join(" | "));
		await ctx.close();

		// 3. rv_restricted: the drill forged with another company is refused, nothing drawn
		const own = await r.get("frappe.client.get_list", { doctype: "Company", fields: JSON.stringify(["name"]), limit_page_length: 10 });
		const own_company = own.message?.[0]?.name;
		const other = own_company === "SND Accounting" ? "SND Accounting 2" : "SND Accounting";
		const rp = await open_tb(browser, res_user, res_pw);
		const forged = await rp.page.evaluate(async ([P, other]) => {
			const p = eval(P);
			const row = p.report.rows.find((x) => x.account && !x.is_group_account);
			const rule = p.drill_rules[0];
			p.last_filters = { ...p.last_filters, company: other };
			const d = p.open_drill(rule, row);
			await d.ready;
			return { state: document.querySelector(".rv-drill")?.dataset.state, text: document.querySelector(".rv-drill .rv-rd-state")?.textContent || "", grid: Boolean(document.querySelector(".rv-drill regular-table")) };
		}, [PAGE, other]);
		check("rv_restricted: a drill into another company is refused and shown as such", forged.state === "error" && !forged.grid, JSON.stringify(forged));
		if (SHOTS) await rp.page.screenshot({ path: `${SHOTS}/site-drill-refused.png` });
		await rp.ctx.close();
	} finally {
		await browser.close();
	}

	// 4. the API as rv_restricted: another company; its own company with another company's account
	const acc_rows = await a.get("frappe.client.get_list", {
		doctype: "Account",
		filters: JSON.stringify({ company: "SND Accounting 2", is_group: 0 }),
		fields: JSON.stringify(["name"]),
		limit_page_length: 1,
	});
	const own_rows = await r.get("frappe.client.get_list", { doctype: "Account", filters: JSON.stringify({ is_group: 0 }), fields: JSON.stringify(["name", "company"]), limit_page_length: 1 });
	const mine = own_rows.message?.[0];
	const foreign = acc_rows.message?.[0]?.name;
	const base = { from_date: "2026-01-01", to_date: "2026-12-31", categorize_by: "Categorize by Voucher (Consolidated)" };
	if (mine && foreign) {
		const other_co = await r.run(GL, { ...base, company: "SND Accounting 2", account: [foreign] });
		check("API: rv_restricted is refused another company", other_co.status === 403 || other_co.status === 417, `HTTP ${other_co.status}`);
		const mixed = await r.run(GL, { ...base, company: mine.company, account: [foreign] });
		check("API: rv_restricted is refused another company's account with its own company (ADR-021)", mixed.status === 403, `HTTP ${mixed.status} ${mixed.body.exc_type || ""}`);
		const ok = await r.run(GL, { ...base, company: mine.company, account: [mine.name] });
		check("API: rv_restricted runs its own account", ok.status === 200, `HTTP ${ok.status}`);
	} else check("accounts of both companies to test with", false, JSON.stringify({ mine, foreign }));

	await a.ctx.dispose();
	await r.ctx.dispose();
	for (const [s, n, i] of results) console.log(s, n, i);
	process.exit(results.some(([s]) => s === "FAIL") ? 1 : 0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
