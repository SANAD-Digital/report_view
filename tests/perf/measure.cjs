// Performance of the page on many rows (visual harness, no Frappe site needed):
//   node tests/visual/build.mjs && node tests/perf/measure.cjs [rows] [lang]
// For each interaction: wall time, script / layout / style time (Chrome metrics), layouts
// forced, and long tasks (> 50 ms, the user feels them as freezes).
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

const ROWS = Number(process.argv[2] || 20000);
const LANG = process.argv[3] || "en";
const PORT = 8797;

async function metrics(cdp) {
	const { metrics } = await cdp.send("Performance.getMetrics");
	return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

(async () => {
	const srv = spawn("node", [path.join(__dirname, "../visual/serve.mjs"), String(PORT)], { stdio: "ignore" });
	await new Promise((r) => setTimeout(r, 1500));
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Performance.enable");
	await page.addInitScript(() => {
		window.__long = [];
		new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(e.duration))).observe({ type: "longtask", buffered: true });
	});
	const results = [];
	async function step(name, fn) {
		await page.evaluate(() => (window.__long = []));
		const a = await metrics(cdp);
		const t = Date.now();
		await fn();
		await page.waitForTimeout(250);
		const b = await metrics(cdp);
		const long = await page.evaluate(() => window.__long);
		results.push({
			step: name,
			wall_ms: Date.now() - t - 250,
			script_ms: Math.round((b.ScriptDuration - a.ScriptDuration) * 1000),
			layout_ms: Math.round((b.LayoutDuration - a.LayoutDuration) * 1000),
			style_ms: Math.round((b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000),
			layouts: b.LayoutCount - a.LayoutCount,
			long_tasks: long.length,
			longest_ms: Math.round(Math.max(0, ...long)),
		});
	}
	const grid = () => page.locator("regular-table").boundingBox();
	await step("load", async () => {
		await page.goto(`http://127.0.0.1:${PORT}/harness.html?report=gl&lang=${LANG}&rows=${ROWS}`);
		await page.waitForSelector("regular-table tbody tr", { timeout: 60000 });
		// RV_PERF_CSS: CSS added to the page, to compare one rule's cost.
		if (process.env.RV_PERF_CSS) await page.addStyleTag({ content: process.env.RV_PERF_CSS });
	});
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
	await step("type in a text filter", async () => {
		const input = page.locator("regular-table thead input.rv-ff-input").first();
		await input.click();
		await input.type("ACC", { delay: 60 });
		await page.waitForTimeout(600);
	});
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
		await page.locator("regular-table thead th.rv-hd").nth(4).click();
		await page.waitForTimeout(600);
	});
	console.table(results);
	await browser.close();
	srv.kill();
})();
