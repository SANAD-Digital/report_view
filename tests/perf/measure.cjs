// Performance of the page on many rows (visual harness, no Frappe site needed):
//   node tests/visual/build.mjs && node tests/perf/measure.cjs [rows] [lang] [runs]
// For each interaction: wall time (without the fixed waits of the script: typing delays and
// the settle pause), script / layout / style time (Chrome metrics), layouts forced, and long
// tasks (> 50 ms, the user feels them as freezes). The sort and filter steps wait for the new
// view to be drawn, not a fixed time; a typed filter includes the 350 ms debounce of the
// floating filter (components/header_cells.js). With runs > 1 the median of every number is
// printed (the machine is shared: single runs swing by a third).
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

const ROWS = Number(process.argv[2] || 20000);
const LANG = process.argv[3] || "en";
const RUNS = Number(process.argv[4] || 1);
const PORT = 8797;
const SETTLE_MS = 250;
const TYPE_DELAY_MS = 60;

async function metrics(cdp) {
	const { metrics } = await cdp.send("Performance.getMetrics");
	return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

// The grid shows a view opened after `token` (a sort or a filter opened a new one).
const rendered = (page, token) =>
	page.waitForFunction(
		(t) => {
			const p = window.rv_page;
			return p.render_token > t && p.opened && p.grid.current === p.opened && p.grid.rt;
		},
		token,
		{ timeout: 30000 }
	);
const render_token = (page) => page.evaluate(() => window.rv_page.render_token);

async function measure(browser) {
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Performance.enable");
	await page.addInitScript(() => {
		window.__long = [];
		new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push([e.startTime, e.duration]))).observe({ type: "longtask", buffered: true });
	});
	const results = [];
	async function step(name, fn, fixed_ms = 0) {
		await page.evaluate(() => (window.__long = []));
		const a = await metrics(cdp);
		const t = Date.now();
		await fn();
		await page.waitForTimeout(SETTLE_MS);
		const b = await metrics(cdp);
		// The load counts the page's tasks only (from its mark), not the harness's own setup.
		const long = await page.evaluate(() => {
			const start = performance.getEntriesByName("rv:page:start")[0]?.startTime || 0;
			return window.__long.filter(([at]) => at >= start).map(([, d]) => d);
		});
		results.push({
			step: name,
			wall_ms: Date.now() - t - SETTLE_MS - fixed_ms,
			script_ms: Math.round((b.ScriptDuration - a.ScriptDuration) * 1000),
			layout_ms: Math.round((b.LayoutDuration - a.LayoutDuration) * 1000),
			style_ms: Math.round((b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000),
			layouts: b.LayoutCount - a.LayoutCount,
			long_tasks: long.length,
			longest_ms: Math.round(Math.max(0, ...long)),
		});
	}
	const grid = () => page.locator("regular-table").boundingBox();
	let page_ms = 0;
	await step("load", async () => {
		await page.goto(`http://127.0.0.1:${PORT}/harness.html?report=gl&lang=${LANG}&rows=${ROWS}`);
		await page.waitForSelector("regular-table tbody tr", { timeout: 60000 });
		// RV_PERF_CSS: CSS added to the page, to compare one rule's cost.
		if (process.env.RV_PERF_CSS) await page.addStyleTag({ content: process.env.RV_PERF_CSS });
		// Without the harness's own setup (fixture fetch, rows): from the page object to the first row.
		page_ms = await page.evaluate(() => Math.round(performance.now() - performance.getEntriesByName("rv:page:start")[0].startTime));
	});
	results[0].page_ms = page_ms;
	await step("scroll down x40", async () => {
		const b = await grid();
		await page.mouse.move(b.x + b.width / 2, b.y + 200);
		for (let i = 0; i < 40; i++) {
			await page.mouse.wheel(0, 120);
			await page.waitForTimeout(16);
		}
	});
	await step("scroll sideways x30", async () => {
		for (let i = 0; i < 30; i++) {
			await page.mouse.wheel(LANG === "ar" ? -40 : 40, 0);
			await page.waitForTimeout(16);
		}
	});
	await step(
		"type in a text filter",
		async () => {
			const token = await render_token(page);
			const input = page.locator("regular-table thead input.rv-ff-input").first();
			await input.click();
			await input.type("ACC", { delay: TYPE_DELAY_MS });
			await rendered(page, token);
			await page.evaluate(() => window.rv_settle());
		},
		3 * TYPE_DELAY_MS
	);
	await step("open the column menu", async () => {
		await page.locator("regular-table thead th.rv-hd").nth(3).hover();
		await page.locator(".rv-hmenu").nth(3).click({ force: true });
		await page.waitForSelector(".rv-pop");
		await page.keyboard.press("Escape");
	});
	await step("open the columns panel", async () => {
		await page.locator('[data-side="columns"], .rv-side-tab').first().click();
		await page.waitForTimeout(200);
	});
	await step("sort a column", async () => {
		const token = await render_token(page);
		await page.locator("regular-table thead th.rv-hd").nth(4).click();
		await rendered(page, token);
		await page.evaluate(() => window.rv_settle());
	});
	await page.close();
	return results;
}

function median(values) {
	const s = [...values].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

(async () => {
	const srv = spawn("node", [path.join(__dirname, "../visual/serve.mjs"), String(PORT)], { stdio: "ignore" });
	await new Promise((r) => setTimeout(r, 1500));
	const browser = await chromium.launch();
	const runs = [];
	for (let i = 0; i < RUNS; i++) runs.push(await measure(browser));
	const out = runs[0].map((row, i) => {
		const merged = { step: row.step };
		for (const key of Object.keys(row)) if (key !== "step") merged[key] = median(runs.map((r) => r[i][key] ?? 0));
		return merged;
	});
	if (RUNS > 1) console.log(`median of ${RUNS} runs`);
	console.table(out);
	await browser.close();
	srv.kill();
})();
