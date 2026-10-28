// @ts-check
// Saved views (ADR-010): the «Views» menu of the head (save as new, the changed dot, save over,
// apply, the standard view, edit and share with roles, the user's default, delete), a view
// shared by another user (applied, never written), the view a link or the default opens with
// (and the fallback when it is not there for the user), a view held to the report's settings,
// the link, Arabic and a phone. The server is views_stub.mjs (its privacy rules as the API's).
// Fails on any console error or warning (helpers.js watch_console).
const path = require("node:path");
const fs = require("node:fs");
const { test, expect } = require("@playwright/test");
const { watch_console, open, settle } = require("./helpers.js");

const OUT = process.env.RV_VIEW_SHOTS || path.resolve(__dirname, "../../test-results/screens/saved-views");
fs.mkdirSync(OUT, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

const OTHER = "sara@rv.test";
const SORTED = { v: 1, mode: "grid", sort: [{ key: "closing_debit", dir: "desc" }], columns: { hidden: ["opening_debit", "opening_credit"] } };
const enc = (v) => encodeURIComponent(JSON.stringify(v));

const views_state = (page) =>
	page.evaluate(() => {
		const btn = document.querySelector(".rv-views-btn");
		return {
			shown: !document.querySelector(".rv-views").hidden,
			name: btn?.querySelector(".nm").textContent,
			dot: !btn?.querySelector(".dot").hidden,
			menu: Boolean(document.querySelector(".rv-views-pop")),
			applied: window.rv_page.applied_view?.name || null,
			store: JSON.parse(JSON.stringify(window.RV_VIEWS)),
			user_default: window.RV_VIEW_DEFAULT,
			sort: JSON.parse(JSON.stringify(window.rv_page.state.sort)),
			mode: window.rv_page.state.mode,
			alerts: (window.rv_alerts || []).map((a) => a.message),
		};
	});

// the link the page wrote (history.replaceState, 300 ms after a change)
const link = async (page) => {
	await page.waitForTimeout(450);
	return page.evaluate(() => Object.fromEntries(new URLSearchParams(window.location.search)));
};

async function open_menu(page) {
	await page.click(".rv-views-btn");
	await expect(page.locator(".rv-views-pop")).toBeVisible();
	await expect(page.locator(".rv-views-pop .rv-views-loading")).toHaveCount(0);
}

async function apply(page, name) {
	await open_menu(page);
	await page.click(`.rv-views-pop [data-apply="${name}"]`);
	await expect(page.locator(".rv-views-pop")).toHaveCount(0);
	await page.waitForFunction((n) => (window.rv_page.applied_view?.name || "") === n, name);
	await page.waitForFunction(() => window.rv_page.opened && window.rv_page.grid.current === window.rv_page.opened && window.rv_page.grid.rt);
	await settle(page);
}

test("views: save as new, the changed dot, save over, the standard view, apply, share with roles, the default, delete", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=en");
	await settle(page);
	let st = await views_state(page);
	expect(st.shown).toBe(true);
	expect(st.name).toBe("Views");
	expect(st.dot).toBe(false);
	await open_menu(page);
	await expect(page.locator(".rv-views-pop .rv-preset-empty")).toHaveCount(2);
	await expect(page.locator('.rv-views-pop [data-act="save"]')).toBeDisabled();
	await expect(page.locator('.rv-views-pop [data-act="edit"]')).toBeDisabled();
	await shot(page, "views-menu-empty-light-ltr");
	// save what the report shows as a new, private view, with its filters
	await page.click('.rv-views-pop [data-act="save-new"]');
	const dlg = page.locator(".rv-test-dialog");
	await expect(dlg).toBeVisible();
	await expect(dlg.locator('[data-fieldname="visibility"] select')).toHaveValue("Private");
	await dlg.locator('[data-fieldname="title"] input').fill("Closing first");
	await shot(page, "views-save-new-dialog-light-ltr");
	await dlg.locator(".btn-modal-primary").click();
	await expect(dlg).toHaveCount(0);
	await expect(page.locator(".rv-views-btn .nm")).toHaveText("Closing first");
	st = await views_state(page);
	expect(st.store).toHaveLength(1);
	expect(st.store[0]).toMatchObject({ title: "Closing first", visibility: "Private", owner: "rv_admin@rv.test" });
	expect(st.store[0].state.ui).toBeUndefined();
	expect(st.store[0].state.report_filters.company).toBeTruthy();
	expect(st.dot).toBe(false);
	let q = await link(page);
	expect(q.view).toBe(st.store[0].name);
	expect(q.rv).toBeUndefined();
	// a change: the dot, and the link carries the changed state
	await page.evaluate(() => window.rv_page.controls.toggle_sort("closing_debit"));
	await settle(page);
	// the dot follows the link, written 300 ms after the view is drawn (later on a slow runner)
	await expect.poll(async () => (await views_state(page)).dot, { timeout: 10_000 }).toBe(true);
	q = await link(page);
	expect(q.view).toBe(st.store[0].name);
	expect(q.rv).toBeTruthy();
	await open_menu(page);
	await expect(page.locator('.rv-views-pop [data-act="save"]')).toBeEnabled();
	await shot(page, "views-menu-changed-light-ltr");
	await page.click('.rv-views-pop [data-act="save"]');
	await expect.poll(async () => (await views_state(page)).store[0].state.sort.length).toBe(1);
	await expect.poll(async () => (await views_state(page)).dot, { timeout: 10_000 }).toBe(false);
	const saved_sort = (await views_state(page)).store[0].state.sort;
	await page.keyboard.press("Escape");
	// the standard view: no view applied, nothing in the link
	await apply(page, "");
	st = await views_state(page);
	expect(st.name).toBe("Views");
	expect(st.sort).toEqual([]);
	expect((await link(page)).view).toBeUndefined();
	// applying the view brings its state back
	await apply(page, st.store[0].name);
	st = await views_state(page);
	expect(st.name).toBe("Closing first");
	expect(st.sort).toEqual(saved_sort);
	expect(st.dot).toBe(false);
	// edit: a new name, shared with a role of the user's
	await open_menu(page);
	await page.click('.rv-views-pop [data-act="edit"]');
	await expect(dlg).toBeVisible();
	await dlg.locator('[data-fieldname="title"] input').fill("Closing, for accounts");
	await dlg.locator('[data-fieldname="visibility"] select').selectOption("Roles");
	await page.evaluate(() => window.rv_dialog.fields_dict.roles.set_value(["Accounts User"]));
	await dlg.locator(".btn-modal-primary").click();
	await expect(dlg).toHaveCount(0);
	st = await views_state(page);
	expect(st.store[0]).toMatchObject({ title: "Closing, for accounts", visibility: "Roles", roles: ["Accounts User"] });
	expect(st.name).toBe("Closing, for accounts");
	// the star: the user's own default
	await open_menu(page);
	await page.click(`.rv-views-pop [data-star="${st.store[0].name}"]`);
	await expect.poll(async () => (await views_state(page)).user_default).toBe(st.store[0].name);
	await expect(page.locator(`.rv-views-pop [data-star="${st.store[0].name}"]`)).toHaveAttribute("aria-pressed", "true");
	await expect(page.locator(".rv-views-pop .rv-preset-badge").first()).toHaveText("Roles");
	await shot(page, "views-menu-default-light-ltr");
	// delete: the page keeps what it shows, no view is applied any more
	await page.click('.rv-views-pop [data-act="delete"]');
	await expect.poll(async () => (await views_state(page)).store.length).toBe(0);
	st = await views_state(page);
	expect(st.name).toBe("Views");
	expect(st.user_default).toBe(null);
	expect(st.sort).toEqual(saved_sort);
	expect((await link(page)).view).toBeUndefined();
	expect(problems).toEqual([]);
});

test("views: a view shared by another user is applied, never written; «Save as new» makes a copy", async ({ page }) => {
	const problems = watch_console(page);
	const views = [
		{ title: "Board pack", owner: OTHER, visibility: "Public", state: SORTED, description: "Monthly" },
		{ title: "Sara's private", owner: OTHER, visibility: "Private", state: SORTED },
		{ title: "Auditors only", owner: OTHER, visibility: "Roles", roles: ["Auditor"], state: SORTED },
	];
	await open(page, `report=tb&lang=en&views=${enc(views)}`);
	await settle(page);
	await open_menu(page);
	// only the public one: the private one and the one for a role the user lacks are not listed
	await expect(page.locator(".rv-views-pop [data-apply]")).toHaveCount(2);
	await expect(page.locator(".rv-views-pop [data-apply='sv-0'] .meta")).toContainText("By sara");
	await page.click(".rv-views-pop [data-apply='sv-0']");
	await page.waitForFunction(() => window.rv_page.applied_view?.name === "sv-0");
	await settle(page);
	let st = await views_state(page);
	expect(st.sort).toEqual(SORTED.sort);
	await open_menu(page);
	for (const act of ["save", "edit", "delete"]) await expect(page.locator(`.rv-views-pop [data-act="${act}"]`)).toBeDisabled();
	await shot(page, "views-menu-shared-light-ltr");
	await page.click('.rv-views-pop [data-act="save-new"]');
	const dlg = page.locator(".rv-test-dialog");
	await expect(dlg.locator('[data-fieldname="title"] input')).toHaveValue("Board pack (copy)");
	await dlg.locator(".btn-modal-primary").click();
	await expect(dlg).toHaveCount(0);
	st = await views_state(page);
	expect(st.store.find((v) => v.title === "Board pack (copy)")).toMatchObject({ owner: "rv_admin@rv.test", visibility: "Private" });
	// the shared view itself is unchanged; a direct call to change it is refused by the "server"
	expect(st.store[0].title).toBe("Board pack");
	const refused = await page.evaluate(() =>
		new Promise((resolve) => frappe.call({ method: "report_view.api.views.save_view", type: "POST", args: { report_name: "Trial Balance", name: "sv-0", title: "Mine" }, error: (r) => resolve(r.exc_type), callback: () => resolve("saved") }))
	);
	expect(refused).toBe("RVNotOwner");
	expect(problems).toEqual([]);
});

test("views: the default opens; a link opens its view; a view not there for the user falls back with a message", async ({ page }) => {
	const problems = watch_console(page);
	const views = [
		{ title: "My default", state: SORTED },
		{ title: "Sara's private", owner: OTHER, visibility: "Private", state: { v: 1, mode: "pivot" } },
		{ title: "Team", owner: OTHER, visibility: "Public", state: { v: 1, mode: "grid", sort: [{ key: "account", dir: "asc" }] } },
	];
	// the user's default
	await open(page, `report=tb&lang=en&views=${enc(views)}&vdefault=sv-0`);
	await settle(page);
	let st = await views_state(page);
	expect(st.applied).toBe("sv-0");
	expect(st.name).toBe("My default");
	expect(st.sort).toEqual(SORTED.sort);
	expect((await link(page)).view).toBe("sv-0");
	// a link's view wins over the default
	await open(page, `report=tb&lang=en&views=${enc(views)}&vdefault=sv-0&view=sv-2`);
	await settle(page);
	st = await views_state(page);
	expect(st.applied).toBe("sv-2");
	expect(st.sort).toEqual([{ key: "account", dir: "asc" }]);
	// a link to another user's private view: said, and the default opens
	await open(page, `report=tb&lang=en&views=${enc(views)}&vdefault=sv-0&view=sv-1`);
	await settle(page);
	st = await views_state(page);
	expect(st.applied).toBe("sv-0");
	expect(st.mode).toBe("grid");
	expect(st.alerts.some((m) => /not available to you/.test(m))).toBe(true);
	// the report's default (Report View Settings) when the user has none
	await open(page, `report=tb&lang=en&views=${enc(views)}&gdefault=sv-2`);
	await settle(page);
	expect((await views_state(page)).applied).toBe("sv-2");
	// a link with its own state (rv) and a view: the state is the link's, the view shown changed
	const rv = Buffer.from(JSON.stringify({ v: 1, sort: [{ key: "debit", dir: "asc" }] })).toString("base64url");
	await open(page, `report=tb&lang=en&views=${enc(views)}&view=sv-0&rv=${rv}`);
	await settle(page);
	await expect.poll(async () => (await views_state(page)).dot, { timeout: 10_000 }).toBe(true);
	st = await views_state(page);
	expect(st.applied).toBe("sv-0");
	expect(st.sort).toEqual([{ key: "debit", dir: "asc" }]);
	expect(problems).toEqual([]);
});

test("views: a view that asks for what the report turned off is held to its settings, and says so", async ({ page }) => {
	const problems = watch_console(page);
	const views = [{ title: "Pivot board", state: { v: 1, mode: "pivot", group: { by: ["account"] }, sort: [{ key: "closing_debit", dir: "desc" }] } }];
	const rvs = { features: { pivot: false, grouping: false } };
	await open(page, `report=tb&lang=en&views=${enc(views)}&vdefault=sv-0&rvs=${enc(rvs)}`);
	await settle(page);
	const st = await views_state(page);
	expect(st.applied).toBe("sv-0");
	expect(st.mode).toBe("grid");
	expect(await page.evaluate(() => window.rv_page.state.group.by)).toEqual([]);
	expect(st.sort).toEqual([{ key: "closing_debit", dir: "desc" }]);
	expect(st.alerts.some((m) => /turned off/.test(m))).toBe(true);
	// held to the settings, it is the view as the report shows it: no dot
	await page.waitForTimeout(450);
	expect((await views_state(page)).dot).toBe(false);
	expect(problems).toEqual([]);
});

test("views: Arabic (RTL, dark) and a phone (the menu is a sheet from the bottom)", async ({ page }) => {
	const problems = watch_console(page);
	const views = [
		{ title: "الأرصدة الختامية", state: SORTED, visibility: "Public" },
		{ title: "مجلس الإدارة", owner: OTHER, visibility: "Public", state: SORTED, description: "شهري" },
	];
	await open(page, `report=tb&lang=ar&desk=dark&views=${enc(views)}&vdefault=sv-0`);
	await settle(page);
	await expect(page.locator(".rv-views-btn .nm")).toHaveText("الأرصدة الختامية");
	await open_menu(page);
	const box = await page.locator(".rv-views-pop").boundingBox();
	const btn = await page.locator(".rv-views-btn").boundingBox();
	// RTL: the menu's inline-end (left) edge on the button's
	expect(Math.abs(box.x - btn.x)).toBeLessThan(2);
	await shot(page, "views-menu-dark-rtl");
	await page.keyboard.press("Escape");
	await expect(page.locator(".rv-views-pop")).toHaveCount(0);

	await open(page, `report=tb&lang=ar&views=${enc(views)}&vdefault=sv-0`, { width: 390, height: 844 });
	await settle(page);
	await page.click(".rv-views-btn");
	const sheet = page.locator(".rv-views-pop");
	await expect(sheet).toBeVisible();
	// after its slide in (rv-sheet-in)
	await page.waitForTimeout(400);
	const b = await sheet.boundingBox();
	expect(Math.round(b.x)).toBe(0);
	expect(Math.round(b.width)).toBe(390);
	expect(Math.round(b.y + b.height)).toBe(844);
	await expect(page.locator(".rv-views .rv-print-scrim")).toBeVisible();
	await shot(page, "views-sheet-phone-rtl");
	await page.locator(".rv-views .rv-print-scrim").click({ position: { x: 20, y: 20 } });
	await expect(sheet).toHaveCount(0);
	expect(problems).toEqual([]);
});
