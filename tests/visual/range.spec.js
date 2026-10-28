// @ts-check
// Cell range selection (phase 5c): a range by the mouse (press, Shift+press, drag) and by
// Shift+arrows, held in data coordinates (it survives the virtual scroll, a fold above it and a
// sort), drawn by the style listener; the status bar's count, sum and average against a manual
// sum of the report's own numbers over ranges with folded and open groups (the documented rule:
// a group and its subtotal never count twice, a folded group counts with its value); the context
// menu (right click; a long press on touch); the clipboard as raw TSV and a plain HTML table
// (read back from the system clipboard); the export of the selection; the chart of a range (5d)
// and its view deleted on close; a Link column opening its document as link_open says (5d).
// Fails on any console error or warning.
const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { watch_console, open, settle } = require("./helpers.js");

// the screenshots of the phase: RV_RANGE_SHOTS, else test-results/screens/range
const OUT = process.env.RV_RANGE_SHOTS || path.resolve(__dirname, "../../test-results/screens/range");
fs.mkdirSync(OUT, { recursive: true });
const rvs = (o) => `&rvs=${encodeURIComponent(JSON.stringify(o))}`;

// ------------------------------------------------------------ page probes

/** Display row of a report row (by a column's value), or of its subtotal row. */
const find_y = (page, key, value, foot = false) =>
	page.evaluate(
		async ([key, value, foot]) => {
			const row = window.rv_page.report.rows.find((r) => r[key] === value);
			return row ? window.rv_page.grid.locate(`${foot ? "f:" : ""}r:${row.__rid}`) : null;
		},
		[key, value, foot]
	);

/** Display row of a group of the user's grouping (first level), or of its subtotal row. */
const group_y = (page, value, foot = false) =>
	page.evaluate(([value, foot]) => window.rv_page.grid.locate(`${foot ? "f:" : ""}g:${JSON.stringify([value])}`), [value, foot]);

/** The groups of the first level in the order the grid shows them. */
const groups_shown = (page) => page.evaluate(() => window.rv_page.grid.current.fold.paths.filter((p) => p.length === 1).map((p) => p[0]));

/** Opens or closes the group or parent at a display row (its caret). */
async function toggle_at(page, y) {
	await page.evaluate((y) => window.rv_page.grid.reveal(y, 0), y);
	await settle(page);
	const done = await page.evaluate((y) => {
		const g = window.rv_page.grid;
		for (const tr of g.rt.querySelectorAll("tbody tr:not(.stale)")) {
			if (g.rt.getMeta(tr.firstElementChild)?.y !== y) continue;
			tr.querySelector(".rv-caret").click();
			return true;
		}
		return false;
	}, y);
	expect(done, `the caret of row ${y}`).toBe(true);
}

/** The point of a body cell (display row y, column key), scrolled into view first. */
async function cell_point(page, y, key) {
	await page.evaluate(
		([y, key]) => {
			const g = window.rv_page.grid;
			// the table whole in the window (the harness page is taller than it: Desk's bars are not there)
			if (g.rt.getBoundingClientRect().bottom > window.innerHeight) document.querySelector(".rv-gridwrap").scrollIntoView({ block: "end" });
			g.reveal(y, g.range_keys().indexOf(key));
		},
		[y, key]
	);
	await settle(page);
	return page.evaluate(
		([y, key]) => {
			const g = window.rv_page.grid;
			const c = g.range_keys().indexOf(key);
			for (const tr of g.rt.querySelectorAll("tbody tr:not(.stale)")) {
				for (const cell of tr.children) {
					const at = g.cell_of(cell);
					if (at && at.y === y && at.c === c) {
						const b = cell.getBoundingClientRect();
						return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
					}
				}
			}
			return null;
		},
		[y, key]
	);
}

async function press(page, y, key, modifiers = []) {
	const p = await cell_point(page, y, key);
	expect(p, `cell ${y}/${key} on screen`).not.toBeNull();
	for (const m of modifiers) await page.keyboard.down(m);
	await page.mouse.click(p.x, p.y);
	for (const m of modifiers.reverse()) await page.keyboard.up(m);
}

/** A range from one cell to another: a press, then Shift+press. */
async function select(page, a, b) {
	await press(page, a.y, a.key);
	await press(page, b.y, b.key, ["Shift"]);
	await stats_settled(page);
}

// the status bar shows the numbers of the range as it is now
const stats_settled = (page) =>
	page.waitForFunction(() => window.rv_page.range_stats_token === window.rv_page.range_token && !window.rv_page.grid.range_pending).then(() => page.waitForTimeout(100));

/** The numbers of the status bar as the page read them (and the text it shows). */
const status = (page) =>
	page.evaluate(() => {
		const el = document.querySelector(".rv-status-sel");
		const text = (k) => el.querySelector(`[data-k="${k}"] bdi, [data-k="${k}"] b`)?.textContent.trim() || null;
		return { stats: window.rv_page.range_stats, shown: !el.hidden, cells: text("cells"), count: text("count"), sum: text("sum"), avg: text("avg") };
	});

/** The report's own value of a column in a row (what the manual sum adds). */
const report_value = (page, key, value, column) =>
	page.evaluate(([key, value, column]) => window.rv_page.report.rows.find((r) => r[key] === value)?.[column] ?? null, [key, value, column]);

const near = (a, b) => expect(Math.abs((a ?? NaN) - (b ?? NaN))).toBeLessThan(0.005);

// ------------------------------------------------------------ the sum of the status bar

test.describe("status bar: count, sum and average over ranges of folded and open groups", () => {
	for (const lang of ["en", "ar"]) {
		test(`trial balance tree with subtotals (${lang})`, async ({ page }) => {
			const problems = watch_console(page);
			await open(page, `report=tb&lang=${lang}`);
			const acc = {
				cash: "1100 - النقدية الحاضرة - SA",
				cash1: "1110 - نقد - SA",
				cash2: "نقد دولار - SA",
				recv: "1300 - الحسابات المدينة - SA",
				current: "1100-1600 - أصول متداولة - SA",
			};
			const v = async (name) => (await report_value(page, "account", name, "debit")) + (await report_value(page, "account", name, "credit"));

			// 1. a whole open subtree, its header to its subtotal: the subtree's own numbers
			let a = await find_y(page, "account", acc.cash);
			let b = await find_y(page, "account", acc.cash, true);
			await select(page, { y: a, key: "debit" }, { y: b, key: "credit" });
			let s = await status(page);
			near(s.stats.sum, await v(acc.cash));
			// two leaves, two numeric columns: the header (numbers in its subtotal) and the subtotal left out
			expect(s.stats.count).toBe(4);
			near(s.stats.avg, s.stats.sum / 4);
			expect(s.shown).toBe(true);
			expect(s.cells).toBe(String((b - a + 1) * 2));
			await page.screenshot({ path: `${OUT}/tb-range-open-${lang}.png` });

			// 2. leaves and the subtotal under them: the leaves only
			a = await find_y(page, "account", acc.cash1);
			await select(page, { y: a, key: "debit" }, { y: b, key: "debit" });
			s = await status(page);
			near(s.stats.sum, (await report_value(page, "account", acc.cash1, "debit")) + (await report_value(page, "account", acc.cash2, "debit")));
			expect(s.stats.count).toBe(2);

			// 3. a group folded inside the range counts with its own value: the whole of "current
			//    assets" with 1300 folded is still the number of current assets
			await toggle_at(page, await find_y(page, "account", acc.recv));
			await page.waitForFunction((name) => {
				const row = window.rv_page.report.rows.find((r) => r.account === name);
				return !(window.rv_page.state.tree.expanded || []).includes(row.__rid) && window.rv_page.state.tree.expanded !== null;
			}, acc.recv);
			await settle(page);
			a = await find_y(page, "account", acc.current);
			b = await find_y(page, "account", acc.current, true);
			await select(page, { y: a, key: "debit" }, { y: b, key: "credit" });
			s = await status(page);
			near(s.stats.sum, await v(acc.current));
			await page.screenshot({ path: `${OUT}/tb-range-folded-${lang}.png` });

			// 4. a subtotal row and a folded group after it: both with their own numbers
			a = await find_y(page, "account", acc.cash, true);
			b = await find_y(page, "account", acc.recv);
			await select(page, { y: a, key: "debit" }, { y: b, key: "credit" });
			s = await status(page);
			near(s.stats.sum, (await v(acc.cash)) + (await v(acc.recv)));
			expect(s.stats.count).toBe(4);
			expect(problems).toEqual([]);
		});
	}

	test("a grouping of the user: groups folded and open, facts read through the engine", async ({ page }) => {
		const problems = watch_console(page);
		await open(page, "report=ar&lang=en&group=party");
		const parties = (await groups_shown(page)).slice(0, 3);
		const total = (party) => page.evaluate((party) => window.rv_page.report.facts.filter((f) => f.party === party).reduce((s, f) => s + (f.outstanding || 0), 0), party);
		// fold the second party
		await toggle_at(page, await group_y(page, parties[1]));
		await page.waitForFunction(() => Array.isArray(window.rv_page.state.group.expanded));
		await settle(page);
		// from the first party's header (open: its facts count) to the third party's subtotal
		const a = await group_y(page, parties[0]);
		const b = await group_y(page, parties[2], true);
		await select(page, { y: a, key: "outstanding" }, { y: b, key: "outstanding" });
		const s = await status(page);
		const want = (await total(parties[0])) + (await total(parties[1])) + (await total(parties[2]));
		near(s.stats.sum, want);
		// the facts of the first and third, the second folded as one
		const facts = await page.evaluate((p) => window.rv_page.report.facts.filter((f) => f.party === p[0] || f.party === p[2]).length, parties);
		expect(s.stats.count).toBe(facts + 1);
		await page.screenshot({ path: `${OUT}/ar-group-range-en.png` });
		expect(problems).toEqual([]);
	});
});

// ------------------------------------------------------------ data coordinates

test("the range keeps its cells through the virtual scroll, a fold above it and a sort", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=ar&lang=en&group=party");
	const parties = await groups_shown(page);
	const last = parties[parties.length - 1];
	const a = await group_y(page, last);
	const b = await group_y(page, last, true);
	await select(page, { y: a, key: "invoiced" }, { y: b, key: "outstanding" });
	const before = await status(page);
	expect(before.stats.count).toBeGreaterThan(0);
	// scrolled away and back: the same numbers, the cells drawn as selected again
	await page.evaluate(() => (window.rv_page.grid.rt.scrollTop = 0));
	await settle(page);
	await page.evaluate((y) => window.rv_page.grid.reveal(y, window.rv_page.grid.range_keys().indexOf("invoiced")), a);
	await settle(page);
	expect(await page.locator("regular-table tbody td.rv-sel").count()).toBeGreaterThan(0);
	// a group above it folded: the range moves with its rows
	await toggle_at(page, await group_y(page, parties[0]));
	await page.waitForFunction((y0) => {
		const r = window.rv_page.grid.range_rect();
		return r && r.y0 < y0;
	}, a);
	await stats_settled(page);
	const moved = await page.evaluate(() => window.rv_page.grid.range_rect());
	expect(moved.y0).toBe(await group_y(page, last));
	near((await status(page)).stats.sum, before.stats.sum);
	// a sort: the ends follow their rows (the groups stay together)
	await page.evaluate(() => window.rv_page.controls.toggle_sort("outstanding"));
	await page.waitForFunction(() => window.rv_page.state.sort.length === 1 && window.rv_page.grid.range_rect());
	await stats_settled(page);
	const sorted = await page.evaluate(() => window.rv_page.grid.range_rect());
	expect(sorted.y0).toBe(await group_y(page, last));
	near((await status(page)).stats.sum, before.stats.sum);
	expect(problems).toEqual([]);
});

test("keyboard: Shift+arrows extend the range, Escape clears it; RTL arrows follow the screen", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=ar");
	const y = await find_y(page, "account", "1110 - نقد - SA");
	await press(page, y, "debit");
	await page.keyboard.press("Shift+ArrowDown");
	// in RTL the next column is on the left
	await page.keyboard.press("Shift+ArrowLeft");
	await stats_settled(page);
	const r = await page.evaluate(() => window.rv_page.grid.range_rect());
	const keys = await page.evaluate(() => window.rv_page.grid.range_keys());
	expect(r.y1 - r.y0).toBe(1);
	expect(keys[r.c0]).toBe("debit");
	expect(keys[r.c1]).toBe("credit");
	const s = await status(page);
	near(
		s.stats.sum,
		(await report_value(page, "account", "1110 - نقد - SA", "debit")) +
			(await report_value(page, "account", "1110 - نقد - SA", "credit")) +
			(await report_value(page, "account", "نقد دولار - SA", "debit")) +
			(await report_value(page, "account", "نقد دولار - SA", "credit"))
	);
	await page.screenshot({ path: `${OUT}/tb-keyboard-range-ar.png` });
	await page.keyboard.press("Escape");
	await expect(page.locator("regular-table tbody .rv-sel")).toHaveCount(0);
	await expect(page.locator(".rv-status-sel")).toBeHidden();
	expect(problems).toEqual([]);
});

// ------------------------------------------------------------ clipboard, menu, export

test("copy: raw TSV and a plain HTML table on the system clipboard; with headers from the menu", async ({ page, context, browserName }) => {
	const problems = watch_console(page);
	if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await open(page, "report=tb&lang=en");
	const y0 = await find_y(page, "account", "1110 - نقد - SA");
	const y1 = await find_y(page, "account", "نقد دولار - SA");
	await select(page, { y: y0, key: "debit" }, { y: y1, key: "credit" });
	const mod = "ControlOrMeta";
	const expected = await page.evaluate(() => {
		const rows = window.rv_page.report.rows;
		const pick = (a) => rows.find((r) => r.account === a);
		return [pick("1110 - نقد - SA"), pick("نقد دولار - SA")].map((r) => `${r.debit}\t${r.credit}`).join("\r\n") + "\r\n";
	});
	// what the page wrote (the system clipboard read back below)
	const read_clipboard = async () => {
		if (browserName === "chromium") return page.evaluate(() => navigator.clipboard.readText());
		// Firefox and WebKit give the clipboard to a paste: into a field of the page
		await page.evaluate(() => {
			document.getElementById("rv-paste")?.remove();
			const t = document.createElement("textarea");
			t.id = "rv-paste";
			document.body.append(t);
		});
		await page.focus("#rv-paste");
		await page.keyboard.press(`${mod}+v`);
		const out = await page.evaluate(() => document.getElementById("rv-paste").value);
		await page.evaluate(() => document.getElementById("rv-paste").remove());
		await page.evaluate(() => window.rv_page.grid.rt.focus());
		return out;
	};
	await page.evaluate(() => window.rv_page.grid.rt.focus());
	await page.keyboard.press(`${mod}+c`);
	await page.waitForFunction(() => (window.rv_alerts || []).some((a) => /copied/.test(a.message)));
	const tsv = await page.evaluate(() => window.rv_page.last_copy.tsv);
	expect(tsv).toBe(expected);
	const got = (await read_clipboard()).replace(/\r\n/g, "\n");
	expect(got.replace(/\n$/, "")).toBe(expected.replace(/\r\n/g, "\n").replace(/\n$/, ""));
	// numbers raw: no grouping, no currency
	expect(got).not.toMatch(/,\d{3}/);
	if (browserName === "chromium") {
		const html = await page.evaluate(async () => {
			const [item] = await navigator.clipboard.read();
			return item.types.includes("text/html") ? (await item.getType("text/html")).text() : "";
		});
		expect(html).toContain("<table>");
		expect(html).toMatch(/<td x:num="539611">539611<\/td>/);
	}
	// the menu: copy with headers
	const p = await cell_point(page, y0, "debit");
	await page.mouse.click(p.x, p.y, { button: "right" });
	await expect(page.locator(".rv-ctx")).toBeVisible();
	await page.screenshot({ path: `${OUT}/tb-context-menu-en.png` });
	await page.locator('.rv-ctx [data-item="copy-headers"]').click();
	await page.waitForFunction(() => (window.rv_alerts || []).filter((a) => /copied/.test(a.message)).length >= 2);
	const with_headers = await page.evaluate(() => window.rv_page.last_copy.tsv);
	expect(with_headers.split("\r\n")[0]).toBe("Period Movement · Debit\tPeriod Movement · Credit");
	const pasted = (await read_clipboard()).replace(/\r\n/g, "\n");
	expect(pasted.split("\n")[0]).toBe("Period Movement · Debit\tPeriod Movement · Credit");
	expect(problems).toEqual([]);
});

test("context menu (ar): right click, the row's verbs, Escape; a long press on touch opens it too", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=ar");
	const y = await find_y(page, "account", "1310 - مدينون - SA");
	const p = await cell_point(page, y, "credit");
	await page.mouse.click(p.x, p.y, { button: "right" });
	const menu = page.locator(".rv-ctx");
	await expect(menu).toBeVisible();
	const items = await menu.locator(".rv-mi").evaluateAll((els) => els.map((e) => e.dataset.item));
	expect(items).toEqual(["copy", "copy-headers", "export", "chart", "open-doc", "row-details"]);
	await page.screenshot({ path: `${OUT}/tb-context-menu-ar.png` });
	await page.keyboard.press("Escape");
	await expect(menu).toHaveCount(0);
	// a long press of a finger: the same menu, the cell selected
	await page.evaluate(([x, y]) => {
		const el = document.elementFromPoint(x, y);
		el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "touch", clientX: x, clientY: y, isPrimary: true }));
	}, [p.x, p.y + 40]);
	await expect(menu).toBeVisible({ timeout: 3000 });
	const r = await page.evaluate(() => window.rv_page.grid.range_rect());
	expect(r.y0).toBe(r.y1);
	await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch" })));
	await page.keyboard.press("Escape");
	expect(problems).toEqual([]);
});

test("export selection: a TSV file of the range with its headers (UTF-8, Arabic kept)", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, "report=tb&lang=ar");
	const y0 = await find_y(page, "account", "1110 - نقد - SA");
	await select(page, { y: y0, key: "account" }, { y: y0 + 1, key: "debit" });
	const p = await cell_point(page, y0, "debit");
	await page.mouse.click(p.x, p.y, { button: "right" });
	const [download] = await Promise.all([page.waitForEvent("download"), page.locator('.rv-ctx [data-item="export"]').click()]);
	expect(download.suggestedFilename()).toBe("Trial Balance - selection.tsv");
	const text = fs.readFileSync(await download.path(), "utf8");
	const lines = text.replace(/^\ufeff/, "").split("\r\n");
	expect(text.charCodeAt(0)).toBe(0xfeff);
	expect(lines[1].split("\t")[0]).toBe("1110 - نقد - SA");
	expect(lines[1].split("\t").length).toBe(lines[0].split("\t").length);
	expect(problems).toEqual([]);
});

test("range selection turned off in the settings: a press selects nothing, no menu", async ({ page }) => {
	const problems = watch_console(page);
	await open(page, `report=tb&lang=en${rvs({ features: { range_selection: false } })}`);
	const y = await find_y(page, "account", "1110 - نقد - SA");
	const p = await cell_point(page, y, "debit");
	await page.mouse.click(p.x, p.y);
	await page.mouse.click(p.x, p.y + 40, { modifiers: ["Shift"] });
	expect(await page.evaluate(() => window.rv_page.grid.range_rect())).toBeNull();
	await page.mouse.click(p.x, p.y, { button: "right" });
	await expect(page.locator(".rv-ctx")).toHaveCount(0);
	await page.keyboard.press("Escape");
	expect(problems).toEqual([]);
});

// ------------------------------------------------------------ chart from range (5d)

for (const theme of ["light", "dark"]) {
	for (const lang of ["ar", "en"]) {
		test(`chart from range (${lang}, ${theme}): a dialog with its type switch; its view deleted on close`, async ({ page }) => {
			const problems = watch_console(page);
			await open(page, `report=tb&lang=${lang}&desk=${theme}`);
			const handles = () => page.evaluate(() => window.rv_page.debug_handles().length);
			const before = await handles();
			const a = await find_y(page, "account", "1100 - النقدية الحاضرة - SA");
			const b = await find_y(page, "account", "1400 - اصول المخزون - SA", true);
			await select(page, { y: a, key: "debit" }, { y: b, key: "credit" });
			const p = await cell_point(page, a, "debit");
			await page.mouse.click(p.x, p.y, { button: "right" });
			await page.locator('.rv-ctx [data-item="chart"]').click();
			const dialog = page.locator(".rv-rchart");
			await expect(dialog.locator(".rv-rc-plot svg")).toBeVisible({ timeout: 15000 });
			// its own view of the range is open while the dialog is
			expect(await handles()).toBe(before + 1);
			// the categories are the rows the sum counts: leaves and the folded, never a group with its rows
			const n = await page.evaluate(() => window.rv_page.range_chart.data.labels.length);
			const counted = await page.evaluate(async () => {
				const d = await window.rv_page.grid.range_data(window.rv_page.grid.range_rect());
				return d.countable.filter(Boolean).length;
			});
			expect(n).toBe(counted);
			// numbers as the table's: the first series is the debit of those rows
			const sum = await page.evaluate(() => window.rv_page.range_chart.data.series[0].values.reduce((s, v) => s + (v || 0), 0));
			near(sum, await page.evaluate(() => window.rv_page.report.rows.find((r) => r.account === "1100-1600 - أصول متداولة - SA").debit));
			await page.waitForTimeout(400);
			await page.screenshot({ path: `${OUT}/chart-from-range-bar-${lang}-${theme}.png` });
			await dialog.locator('[data-type="line"]').click();
			await expect(dialog.locator('[data-type="line"]')).toHaveAttribute("aria-checked", "true");
			await page.waitForTimeout(400);
			await page.screenshot({ path: `${OUT}/chart-from-range-line-${lang}-${theme}.png` });
			await page.keyboard.press("Escape");
			await expect(dialog).toHaveCount(0);
			await page.waitForFunction((n) => window.rv_page.debug_handles().length === n, before);
			expect(problems).toEqual([]);
		});
	}
}

// ------------------------------------------------------------ links (5d)

for (const how of ["new_tab", "same_tab", "drawer"]) {
	test(`a Link column opens its document: ${how}`, async ({ page }) => {
		const problems = watch_console(page);
		await open(page, `report=gl&lang=en${how === "new_tab" ? "" : rvs({ link_open: how })}`);
		await page.evaluate(() => {
			window.rv_opened = [];
			window.open = (url, target) => (window.rv_opened.push({ url, target }), null);
			frappe.set_route = (...args) => window.rv_opened.push({ route: args });
			frappe.db.get_doc = (doctype, name) => Promise.resolve({ doctype, name, account_name: "Cash", account_type: "Cash", company: "SND Accounting" });
			frappe.model.with_doctype = (doctype, fn) => fn();
			frappe.get_meta = () => ({ fields: [{ fieldname: "account_name", label: "Account Name", fieldtype: "Data" }, { fieldname: "account_type", label: "Account Type", fieldtype: "Select" }, { fieldname: "company", label: "Company", fieldtype: "Link", options: "Company" }] });
		});
		const link = page.locator('regular-table tbody td a[href*="/desk/account/"]').first();
		await expect(link).toBeVisible();
		const name = await link.evaluate((a) => decodeURIComponent(a.getAttribute("href").split("/").pop()));
		await link.click();
		if (how === "drawer") {
			const drawer = page.locator(".rv-docdrawer");
			await expect(drawer).toBeVisible();
			await expect(drawer.locator(".rv-rd-title")).toHaveText(name);
			await expect(drawer.locator(".rv-rd-fields dt")).toHaveCount(3);
			await page.screenshot({ path: `${OUT}/gl-link-drawer-en.png` });
			await page.keyboard.press("Escape");
			await expect(drawer).toHaveCount(0);
			expect(await page.evaluate(() => window.rv_opened)).toEqual([]);
		} else {
			const opened = await page.evaluate(() => window.rv_opened);
			if (how === "new_tab") expect(opened).toEqual([{ url: `/app/Account/${encodeURIComponent(name)}`, target: "_blank" }]);
			else expect(opened).toEqual([{ route: ["Form", "Account", name] }]);
		}
		// the page itself did not navigate
		expect(page.url()).toContain("harness.html");
		expect(problems).toEqual([]);
	});
}
