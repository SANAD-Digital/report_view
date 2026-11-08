// @ts-check
// The trial layouts of the report page (ADR-025): A (report-view-a: a head of two rows, the
// filters as chips, the table in a card with its own toolbar) and C (report-view-c: the
// filters as a sentence, one dense toolbar, the saved views as tabs), and the Pages view's
// side column they both use. The standard page (report-view) keeps its own specs, untouched.
// Fails on any console error or warning (helpers.js watch_console).
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { rv, watch_console, open, settle, shots_dir, PAGES } = require("./helpers.js");

const OUT = shots_dir("layouts");
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const enc = (v) => encodeURIComponent(JSON.stringify(v));

for (const [lang, desk] of [["ar", "light"], ["en", "dark"]]) {
	for (const layout of ["a", "c"]) {
		test(`layout ${layout}: the table and the pages (${lang}, ${desk})`, async ({ page }) => {
			const problems = watch_console(page);
			await open(page, `report=gl&lang=${lang}&desk=${desk}&layout=${layout}&group=account`);
			await settle(page);
			await shot(page, `layout-${layout}-gl-grid-${lang}-${desk}`);
			await open(page, `report=tb&lang=${lang}&desk=${desk}&layout=${layout}&rv=${PAGES}`);
			await settle(page);
			await shot(page, `layout-${layout}-tb-pages-${lang}-${desk}`);
			expect(problems, "console errors/warnings").toEqual([]);
		});
	}
}


test("layout A: a head of two rows inside the page, the table in a card with its own toolbar; no rails, no criteria bar, no classic toolbar", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=gl&lang=en&layout=a");
	await settle(page);
	const st = await page.evaluate(() => {
		const shown = (s) => {
			const el = document.querySelector(s);
			return Boolean(el) && getComputedStyle(el).display !== "none" && el.getClientRects().length > 0;
		};
		const r = (s) => document.querySelector(s).getBoundingClientRect();
		return {
			root: [...document.querySelector(".rv").classList].slice(0, 2).join(" "),
			title: document.querySelector(".rv-ha .rv-h1").textContent,
			crumb: document.querySelector(".rv-ha .rv-crumb").textContent,
			modes: [...document.querySelectorAll(".rv-ha .rv-modes [data-mode]")].filter((b) => !b.hidden).map((b) => [b.dataset.mode, b.getAttribute("aria-selected")]),
			acts: [...document.querySelectorAll(".rv-ha-acts > [data-action], .rv-ha-acts .rv-views-btn")].filter((b) => !b.hidden).map((b) => b.dataset.action || "views"),
			chips: [...document.querySelectorAll(".rv-chips .rv-fchip")].filter((b) => !b.hidden).map((b) => b.dataset.filter || "add"),
			tools: [...document.querySelectorAll(".rv-ta > *")].filter((x) => !x.hidden).map((x) => x.dataset.action || x.className.split(" ")[0]),
			desk_head: shown(".page-head"),
			server: shown(".rv-server"),
			toolbar: shown(".rv-toolbar"),
			rails: shown(".rv-sidetabs"),
			status_in_card: Boolean(document.querySelector(".rv-gridwrap > .rv-status")),
			// the head over the card, both across the frame
			head_above: r(".rv-ha").bottom <= r(".rv-gridwrap").top,
			hscroll: document.documentElement.scrollWidth > innerWidth,
		};
	});
	expect(st.root).toBe("rv rv-layout-a");
	expect(st.title).toBe("General Ledger");
	expect(st.crumb).toBe("Accounts · Reports");
	expect(st.modes).toEqual([["statement", "false"], ["grid", "true"], ["pivot", "false"], ["charts", "false"], ["pages", "false"]]);
	expect(st.acts).toEqual(["layout", "views", "refresh", "export-menu", "more"]);
	expect(st.chips.slice(0, 2)).toEqual(["company", "__period"]);
	expect(st.chips.at(-1)).toBe("add");
	expect(st.tools).toEqual(["rv-search", "group-menu", "columns", "filter-row", "rv-ta-sp", "rv-ta-count", "rv-seg"]);
	// Frappe's scale: 28px controls, the row groups bar only while grouping, no row of column filters until asked
	const sizes = await page.evaluate(() => ({
		btn: Math.round(document.querySelector('.rv-ta [data-action="columns"]').getBoundingClientRect().height),
		chip: Math.round(document.querySelector(".rv-fchip").getBoundingClientRect().height),
		mode: Math.round(document.querySelector(".rv-modes").getBoundingClientRect().height),
		search: Math.round(document.querySelector(".rv-ta .rv-search").getBoundingClientRect().height),
		title: getComputedStyle(document.querySelector(".rv-ha .rv-h1")).fontSize,
		row: Math.round(document.querySelector("regular-table tbody tr:nth-child(3)").getBoundingClientRect().height),
		cell: getComputedStyle(document.querySelector("regular-table tbody td")).fontSize,
		head: getComputedStyle(document.querySelector("regular-table thead th.rv-hd")).fontSize,
		filter_row: document.querySelectorAll("regular-table thead th.rv-hf").length,
		groups_bar: getComputedStyle(document.querySelector(".rv-gp:not(.rv-pivotbar)")).display,
	}));
	expect(sizes).toEqual({ btn: 28, chip: 28, mode: 28, search: 28, title: "18px", row: 28, cell: "13px", head: "12px", filter_row: 0, groups_bar: "none" });
	await page.click('[data-action="filter-row"]');
	await settle(page);
	expect(await page.evaluate(() => document.querySelectorAll("regular-table thead th.rv-hf").length)).toBeGreaterThan(0);
	await page.click('[data-action="filter-row"]');
	await settle(page);
	expect(await page.evaluate(() => document.querySelectorAll("regular-table thead th.rv-hf").length)).toBe(0);
	expect(st.desk_head).toBe(false);
	expect(st.server).toBe(false);
	expect(st.toolbar).toBe(false);
	expect(st.rails).toBe(false);
	expect(st.status_in_card).toBe(true);
	expect(st.head_above).toBe(true);
	expect(st.hscroll).toBe(false);
	// the modes: the segmented control switches the view; the row groups bar in Table and Pivot only
	await page.click('.rv-modes [data-mode="pivot"]');
	await expect.poll(() => page.evaluate(() => window.rv_page.state.mode)).toBe("pivot");
	await expect(page.locator(".rv-gp:not(.rv-pivotbar)")).toBeVisible();
	await page.click('.rv-modes [data-mode="charts"]');
	await expect.poll(() => page.evaluate(() => window.rv_page.state.mode)).toBe("charts");
	await expect(page.locator(".rv-gp:not(.rv-pivotbar)")).toBeHidden();
	await expect(page.locator(".rv-ta")).toBeHidden();
	await page.click('.rv-modes [data-mode="grid"]');
	await expect.poll(() => page.evaluate(() => window.rv_page.state.mode)).toBe("grid");
	// Group by ▾ groups the table; Columns opens the side panel as a drawer over the table
	await page.click('[data-action="group-menu"]');
	await page.locator('.rv-pop [data-item="group:account"]').click();
	await expect.poll(() => page.evaluate(() => window.rv_page.state.group.by)).toEqual(["account"]);
	await settle(page);
	await expect(page.locator('[data-action="group-menu"]')).toContainText("Account");
	await expect(page.locator(".rv-gp:not(.rv-pivotbar)")).toBeVisible();
	// a group's sums stand on its own row (Grid.dc.html): subtotals off at first, the toolbar turns them on
	expect(await page.evaluate(() => window.rv_page.state.group.subtotals)).toBe(false);
	await page.click('[data-action="subtotals"]');
	await expect.poll(() => page.evaluate(() => window.rv_page.state.group.subtotals)).toBe(true);
	await page.click('[data-action="columns"]');
	const drawer = await page.evaluate(() => {
		const p = document.querySelector(".rv-panel");
		const b = document.querySelector(".rv-body").getBoundingClientRect();
		const r = p.getBoundingClientRect();
		return { shown: !p.hidden, position: getComputedStyle(p).position, end: document.dir === "rtl" ? Math.round(r.left - b.left) : Math.round(b.right - r.right) };
	});
	expect(drawer).toEqual({ shown: true, position: "absolute", end: 0 });
	await expect(page.locator('[data-action="columns"]')).toHaveAttribute("aria-expanded", "true");
	await page.click('[data-action="columns"]');
	await expect(page.locator(".rv-panel")).toBeHidden();
	// the density switch of the card
	await page.click('.rv-ta-density [data-density="compact"]');
	await expect(page.locator(".rv.compact")).toHaveCount(1);
	await page.click('.rv-ta-density [data-density="comfortable"]');
	expect(problems).toEqual([]);
});


test("layout A: a chip edits only its filter in a small popover (Apply, Clear); «+ Filter» lists the filters to add and «More options…»", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=gl&lang=en&layout=a");
	await settle(page);
	const runs = await page.evaluate(() => window.rv_page.run_token);
	await page.click('.rv-fchip[data-filter="company"]');
	const pop = page.locator(".rv-pop.rv-filter-pop");
	await expect(pop).toBeVisible();
	const box = await pop.evaluate((el) => {
		const r = el.getBoundingClientRect();
		const chip = document.querySelector('.rv-fchip[data-filter="company"]').getBoundingClientRect();
		return { w: Math.round(r.width), filters: el.querySelectorAll(".rv-filter").length, under: r.top >= chip.bottom - 1, acts: [...el.querySelectorAll("[data-act]")].map((b) => b.dataset.act) };
	});
	// one control; the company may not be emptied (required): Apply only
	expect(box).toEqual({ w: 280, filters: 1, under: true, acts: ["apply"] });
	await expect(pop.locator('.rv-filter[data-fieldname="company"] input')).toBeFocused();
	await pop.locator("input").fill("Other Company");
	await pop.locator("input").press("Tab");
	await expect.poll(() => page.evaluate(() => window.rv_page.run_token)).toBeGreaterThan(runs);
	await expect(page.locator('.rv-fchip[data-filter="company"]')).toContainText("Other Company");
	await pop.locator('[data-act="apply"]').click();
	await expect(pop).toHaveCount(0);
	// the control is back in the criteria bar, alive
	expect(await page.evaluate(() => Boolean(document.querySelector('.rv-server .rv-filter[data-fieldname="company"]')))).toBe(true);
	expect(await page.evaluate(() => window.rv_page.filters.get_filter_value("company"))).toBe("Other Company");
	// the period chip opens the period picker
	await page.click('.rv-fchip[data-filter="__period"]');
	await expect(page.locator(".rv-pop.dp")).toBeVisible();
	await page.keyboard.press("Escape");
	// «+ Filter»: the filters with no value yet, then the report's options
	await page.click(".rv-fchip.add");
	const items = await page.locator(".rv-pop .rv-mi").evaluateAll((l) => l.map((b) => b.dataset.item));
	expect(items).toEqual(["account", "__options"]);
	await page.locator('.rv-pop [data-item="account"]').click();
	await expect(page.locator('.rv-pop.rv-filter-pop .rv-filter[data-fieldname="account"]')).toBeVisible();
	expect(await page.locator(".rv-pop.rv-filter-pop [data-act]").evaluateAll((l) => l.map((b) => b.dataset.act))).toEqual(["clear", "apply"]);
	await page.keyboard.press("Escape");
	await page.click(".rv-fchip.add");
	await page.locator('.rv-pop [data-item="__options"]').click();
	const opts = await page.locator(".rv-pop.rv-filter-pop").evaluate((el) => ({ checks: el.querySelectorAll(".rv-filter-check").length, other: el.querySelectorAll(".rv-filter:not(.rv-filter-check)").length }));
	expect(opts).toEqual({ checks: 1, other: 0 });
	await page.keyboard.press("Escape");
	expect(await page.evaluate(() => document.querySelectorAll(".rv-server .rv-filter").length)).toBe(await page.evaluate(() => window.rv_page.filters.controls.length));
	expect(problems).toEqual([]);
});


test("layout C: the filters as one sentence whose values open their editors; one dense toolbar; the views as tabs in the bottom bar", async ({ page }) => {
	const problems = watch_console(page);
	const views = [
		{ title: "Debit first", state: { v: 1, mode: "grid", sort: [{ key: "closing_debit", dir: "desc" }] } },
		{ title: "Shared view", owner: "someone@else.test", visibility: "Public", state: { v: 1, mode: "grid" } },
	];
	await open(page, `report=tb&lang=en&layout=c&views=${enc(views)}`);
	await settle(page);
	const st = await page.evaluate(() => ({
		root: [...document.querySelector(".rv").classList].slice(0, 2).join(" "),
		title: document.querySelector(".rv-hc .rv-h1").textContent,
		sentence: document.querySelector(".rv-sentence").textContent.replace(/\s+/g, " ").trim(),
		values: [...document.querySelectorAll(".rv-sentence button[data-q]")].map((b) => b.dataset.q),
		bar: [...document.querySelectorAll(".rv-tc > *")].filter((x) => !x.hidden && getComputedStyle(x).display !== "none").map((x) => x.dataset.action || x.className.split(" ")[0]),
		modes: [...document.querySelectorAll(".rv-tc-modes [data-mode]")].map((b) => [b.dataset.mode, b.getAttribute("aria-pressed")]),
		tools: [...document.querySelectorAll(".rv-tc-tools > *")].filter((x) => !x.hidden).map((x) => x.dataset.action),
		tabs: [...document.querySelectorAll(".rv-vtabs [data-view]")].map((b) => [b.textContent.trim(), b.getAttribute("aria-selected")]),
		foot_last: document.querySelector(".rv-cfoot").lastElementChild.className,
	}));
	expect(st.root).toBe("rv rv-layout-c");
	expect(st.title).toBe("Trial Balance");
	expect(st.sentence).toMatch(/^for .+ from .+ to .+\+ condition$/);
	expect(st.values).toEqual(["company", "__period", "__period", "__more"]);
	expect(st.bar).toEqual(["rv-tc-modes", "rv-tsep", "rv-tc-tools", "rv-tsep", "rv-tc-search", "rv-tc-sp", "refresh", "export-menu", "print", "layout", "more"]);
	expect(st.modes.slice(0, 2)).toEqual([["statement", "false"], ["grid", "true"]]);
	expect(st.tools).toEqual(["group-menu", "subtotals", "columns", "filter-row", "density-menu"]);
	expect(st.tabs).toEqual([["Standard", "true"], ["Debit first", "false"], ["Shared view", "false"]]);
	expect(st.foot_last).toBe("rv-status");
	// a value of the sentence opens its editor (the company's own control)
	await page.click('.rv-sentence button[data-q="company"]');
	await expect(page.locator('.rv-pop.rv-filter-pop .rv-filter[data-fieldname="company"]')).toBeVisible();
	await page.keyboard.press("Escape");
	await page.click('.rv-sentence button[data-q="__period"] >> nth=0');
	await expect(page.locator(".rv-pop.dp")).toBeVisible();
	await page.keyboard.press("Escape");
	// a tab applies its view; the tab follows, and the standard view comes back the same way
	await page.click('.rv-vtabs [data-view="sv-0"]');
	await expect.poll(() => page.evaluate(() => window.rv_page.applied_view?.name)).toBe("sv-0");
	await expect(page.locator('.rv-vtabs [data-view="sv-0"]')).toHaveAttribute("aria-selected", "true");
	expect(await page.evaluate(() => window.rv_page.state.sort)).toEqual([{ key: "closing_debit", dir: "desc" }]);
	// a change of the view shows its dot on the tab
	await page.click('[data-action="subtotals"]');
	await expect(page.locator('.rv-vtabs [data-view="sv-0"] .dot')).toHaveCount(1);
	await page.click('.rv-vtabs [data-view=""]');
	await expect.poll(() => page.evaluate(() => window.rv_page.applied_view)).toBe(null);
	await expect(page.locator('.rv-vtabs [data-view=""]')).toHaveAttribute("aria-selected", "true");
	// «+» saves a new view through Frappe's dialog
	await page.click('.rv-vtabs [data-action="new-view"]');
	await expect(page.locator(".rv-test-dialog")).toBeVisible();
	// the harness's dialog has no Escape: it is closed as Frappe's would be
	await page.evaluate(() => window.rv_dialog.hide());
	// Density ▾ and the pressed modes
	await page.click('[data-action="density-menu"]');
	await page.locator('.rv-pop [data-item="compact"]').click();
	await expect(page.locator(".rv.compact")).toHaveCount(1);
	await page.click('.rv-tc-modes [data-mode="pages"]');
	await expect(page.locator('.rv-tc-modes [data-mode="pages"]')).toHaveAttribute("aria-pressed", "true");
	await expect(page.locator(".rv-vtabs")).toBeVisible();
	expect(problems).toEqual([]);
});


test("trial layouts: the first column holds a report row's details button and its number; the link of a drill keeps the page", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=gl&lang=ar&layout=a");
	await settle(page);
	const first = await page.evaluate(() => {
		const rows = [...document.querySelectorAll("regular-table tbody tr")].filter((tr) => tr.querySelector("th .rv-rd-btn"));
		const lc = rows[0].querySelector("th .rv-lc");
		return { buttons: rows.length, numbers: rows.slice(0, 3).map((tr) => tr.querySelector(".rv-rown").textContent), order: [...lc.children].slice(0, 2).map((c) => c.className.split(" ")[0]) };
	});
	expect(first.buttons).toBeGreaterThan(3);
	expect(first.numbers).toEqual(["1", "2", "3"]);
	expect(first.order).toEqual(["rv-rd-btn", "rv-rown"]);
	await page.locator("regular-table tbody th .rv-rd-btn").first().click();
	await expect(page.locator(".rv-rd")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.locator(".rv-rd")).toHaveCount(0);
	expect(await page.evaluate(() => window.rv_page.page_route)).toBe("report-view-a");
	expect(problems).toEqual([]);
});


test("pages in the trial layouts: the side column holds every section in four groups at the inline start; a section folds in place", async ({ page }) => {
	const problems = watch_console(page);
	for (const [lang, layout] of [["ar", "a"], ["en", "c"]]) {
		await open(page, `report=tb&lang=${lang}&layout=${layout}&rv=${PAGES}`);
		await settle(page);
		const st = await page.evaluate(() => {
			const side = document.querySelector(".rv-print-side").getBoundingClientRect();
			const stage = document.querySelector(".rv-print-stage").getBoundingClientRect();
			const thumbs = document.querySelector(".rv-print-thumbs").getBoundingClientRect();
			const rtl = getComputedStyle(document.querySelector(".rv-print-side")).direction === "rtl";
			return {
				sidecol: document.querySelector(".rv-pages").classList.contains("rv-print-sidecol"),
				groups: [...document.querySelectorAll(".rv-print-side details.rv-pgrp")].map((g) => [g.dataset.group, g.querySelectorAll(".rv-psub-t").length, [...g.querySelectorAll(".rv-psub[data-sec]")].map((d) => d.dataset.sec)]),
				open: [...document.querySelectorAll(".rv-print-side details.rv-pgrp[open]")].map((d) => d.dataset.group),
				controls: [...document.querySelectorAll(".rv-print-side details[open] .rv-input, .rv-print-side details[open] .rv-print-seg")].filter((x) => x.offsetParent).map((x) => Math.round(x.getBoundingClientRect().height)),
				box4: getComputedStyle(document.querySelector(".rv-print-side .rv-box4")).gridTemplateColumns.split(" ").length,
				bar: Math.round(document.querySelector(".rv-print-bar").getBoundingClientRect().height),
				width: Math.round(side.width),
				start: rtl ? side.left >= stage.right - 1 : side.right <= stage.left + 1,
				thumbs_end: rtl ? thumbs.right <= stage.left + 1 : thumbs.left >= stage.right - 1,
				ribbon: document.querySelectorAll(".rv-rg, .rv-print-pop").length,
				head: [...document.querySelectorAll(".rv-print-bar [data-action]")].map((b) => b.dataset.action),
			};
		});
		expect(st.sidecol).toBe(true);
		// one heading per group: a group of one part has no second title
		expect(st.groups).toEqual([
			["page", 0, ["paper"]],
			["content", 3, ["tpl", "content", "cols"]],
			["identity", 4, ["head", "heading", "foot", "sign"]],
			["marks", 3, ["num", "border", "wm"]],
		]);
		expect(st.open).toEqual(["page", "content"]);
		expect([...new Set(st.controls)]).toEqual([28]);
		expect(st.box4).toBe(4);
		expect(st.bar).toBeLessThanOrEqual(45);
		expect(st.width).toBe(288);
		expect(st.start).toBe(true);
		expect(st.thumbs_end).toBe(true);
		expect(st.ribbon).toBe(0);
		expect(st.head).toEqual(["reset", "print-settings", "pdf", "print"]);
	}
	const grp = () => page.locator('.rv-print-side details[data-group="identity"]');
	expect(await grp().evaluate((d) => d.open)).toBe(false);
	await grp().locator("summary").click();
	expect(await grp().evaluate((d) => d.open)).toBe(true);
	await expect.poll(() => page.evaluate(() => window.rv_page.pages.open_secs.has("identity"))).toBe(true);
	await page.click('.rv-print-side [data-sw="signatures"]');
	await settle(page);
	expect(await page.evaluate(() => window.rv_page.pages.settings.signatures)).toBe(true);
	expect(await grp().evaluate((d) => d.open)).toBe(true);
	// Escape folds nothing; the same summary folds the group again
	await page.keyboard.press("Escape");
	expect(await grp().evaluate((d) => d.open)).toBe(true);
	await grp().locator("summary").click();
	await expect.poll(() => page.evaluate(() => window.rv_page.pages.open_secs.has("identity"))).toBe(false);
	expect(problems).toEqual([]);
});


test("trial layouts on a phone: the heads wrap, the chips scroll sideways, C's tools fold into ⋯, the print column is a sheet", async ({ page }) => {
	const problems = watch_console(page);
	const phone = { width: 390, height: 844 };
	await open(page, "report=gl&lang=ar&layout=a", phone);
	await settle(page);
	const a = await page.evaluate(() => {
		const chips = document.querySelector(".rv-chips");
		return { hscroll: document.documentElement.scrollWidth > innerWidth, chips_scroll: getComputedStyle(chips).overflowX, nowrap: getComputedStyle(chips).flexWrap, table_in_box: getComputedStyle(document.querySelector("regular-table")).overflow };
	});
	expect(a).toEqual({ hscroll: false, chips_scroll: "auto", nowrap: "nowrap", table_in_box: "auto" });
	await shot(page, "layout-a-gl-phone");
	await open(page, "report=tb&lang=ar&layout=c", phone);
	await settle(page);
	const c = await page.evaluate(() => ({
		hscroll: document.documentElement.scrollWidth > innerWidth,
		tools: getComputedStyle(document.querySelector(".rv-tc-tools")).display,
		more: getComputedStyle(document.querySelector('.rv-tc [data-action="more"]')).display,
	}));
	expect(c.hscroll).toBe(false);
	expect(c.tools).toBe("none");
	expect(c.more).not.toBe("none");
	await page.click('.rv-tc [data-action="more"]');
	const items = await page.locator(".rv-pop .rv-mi").evaluateAll((l) => l.map((b) => b.dataset.item));
	expect(items.slice(0, 3)).toEqual(["group", "subtotals", "columns"]);
	await page.keyboard.press("Escape");
	await shot(page, "layout-c-tb-phone");
	// the print column: hidden, «Print settings» opens it as a sheet from the bottom
	await open(page, `report=tb&lang=ar&layout=c&rv=${PAGES}`, phone);
	await settle(page);
	await expect(page.locator(".rv-print-side")).toBeHidden();
	await page.locator('[data-action="print-settings"]').click();
	await page.evaluate(() => Promise.all(document.querySelector(".rv-print-side").getAnimations().map((x) => x.finished)));
	const sheet = await page.evaluate(() => {
		const r = document.querySelector(".rv-print-side").getBoundingClientRect();
		return { bottom: Math.round(r.bottom), w: Math.round(r.width), groups: document.querySelectorAll(".rv-print-side details.rv-pgrp").length };
	});
	expect(sheet).toEqual({ bottom: 844, w: 390, groups: 4 });
	await shot(page, "layout-c-tb-pages-phone-sheet");
	await page.keyboard.press("Escape");
	await expect(page.locator(".rv-print-side")).toBeHidden();
	expect(problems).toEqual([]);
});


test("the standard page keeps its own shell: no trial class, Desk's head with its actions, the print ribbon", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=tb&lang=en&rv=${PAGES}`);
	await settle(page);
	const st = await page.evaluate(() => ({
		root: document.querySelector(".rv-shell").parentElement.className,
		head: Boolean(document.querySelector(".page-head .rv-headbar")),
		ribbon: document.querySelectorAll(".rv-print-side .rv-rg").length,
		sidecol: document.querySelectorAll(".rv-print-sidecol, .rv-ha, .rv-hc, .rv-ta, .rv-cfoot, .rv-rd-rail").length,
		route: window.rv_page.page_route,
	}));
	expect(st).toEqual({ root: "rv rv-mode-pages", head: true, ribbon: 4, sidecol: 0, route: "report-view" });
	void rv;
	expect(problems).toEqual([]);
});

for (const layout of ["a", "c"]) {
	test(`layout ${layout}: the Statement draws the table as a statement: its head, the numbers only, the level of detail (ADR-026)`, async ({ page }) => {
		const problems = watch_console(page);
		await open(page, `report=tb&lang=ar&layout=${layout}`);
		await settle(page);
		await page.locator('[data-mode="statement"]:visible').first().click();
		await settle(page);
		const read = () =>
			page.evaluate(() => {
				const head = document.querySelector(".rv-stmt-head");
				const row = [...document.querySelectorAll("regular-table tbody tr")].find((tr) => tr.querySelector("td"));
				return {
					mode: document.querySelector(".rv").classList.contains("rv-mode-statement"),
					head: Boolean(head) && getComputedStyle(head).display !== "none",
					title: head?.querySelector(".t")?.textContent || "",
					levels: [...document.querySelectorAll(".rv-stmt-levels [data-level]")].map((b) => [b.dataset.level, b.getAttribute("aria-pressed")]),
					numbers_only: Boolean(row) && [...row.querySelectorAll("td")].every((td) => td.classList.contains("num")),
					rows: document.querySelectorAll("regular-table tbody tr").length,
				};
			});
		const st = await read();
		expect(st.mode).toBe(true);
		expect(st.head).toBe(true);
		expect(st.title.length).toBeGreaterThan(0);
		expect(st.levels.map((l) => l[0])).toEqual(["roots", "groups", "all"]);
		expect(st.numbers_only).toBe(true);
		await shot(page, `layout-${layout}-tb-statement-ar`);
		await page.locator('.rv-stmt-levels [data-level="roots"]').click();
		await settle(page);
		const roots = await read();
		expect(roots.levels.find((l) => l[0] === "roots")[1]).toBe("true");
		expect(roots.rows).toBeLessThan(st.rows);
		expect(problems, "console errors/warnings").toEqual([]);
	});
}

test("a ledger on a trial layout opens on its reader's columns, the numbers last; its Statement keeps what tells the rows apart", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=gl&lang=en&layout=a");
	await settle(page);
	const titles = () => page.evaluate(() => window.rv_page.grid.model.data.map((d) => d.column.fieldname));
	const table = await titles();
	expect(table.slice(-3)).toEqual(["debit", "credit", "balance"]);
	expect(table).toContain("voucher_no");
	expect(table).not.toContain("voucher_subtype");
	// the others come back from Columns: they are hidden, not gone
	expect(await page.evaluate(() => window.rv_page.state.columns.hidden)).toContain("voucher_subtype");
	await page.locator('.rv-modes [data-mode="statement"]').click();
	await settle(page);
	const statement = await titles();
	expect(statement).toContain("voucher_no");
	expect(statement).toContain("balance");
	// entries of more than one account: the Statement names each row's (ADR-026, 2026-11-08)
	expect(statement).toContain("account");
	expect(problems, "console errors/warnings").toEqual([]);
});

test("the Statement on a phone: the closing balance in a bar, a card per row, a tap opens its details", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=gl&lang=ar&layout=a", { width: 390, height: 844 });
	await settle(page);
	await page.locator('[data-mode="statement"]:visible').first().click();
	await settle(page);
	await expect(page.locator(".rv-card").first()).toBeVisible();
	const st = await page.evaluate(() => ({
		// a card per entry; the report's opening, total and closing as cards of their own
		cards: document.querySelectorAll(".rv-card:not(.sum)").length,
		sums: document.querySelectorAll(".rv-card.sum").length,
		facts: window.rv_page.opened.counts.shown,
		table: getComputedStyle(document.querySelector(".rv-body")).display,
		hscroll: document.documentElement.scrollWidth > innerWidth,
	}));
	expect(st.cards).toBe(st.facts);
	expect(st.sums).toBeGreaterThan(0);
	expect(st.table).toBe("none");
	expect(st.hscroll).toBe(false);
	await page.locator(".rv-card:not(.sum)").first().click();
	await expect(page.locator(".rv-rd")).toBeVisible();
	expect(problems, "console errors/warnings").toEqual([]);
});
