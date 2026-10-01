// Experiment 1/4/5: load Perspective in a real browser, from the site origin or the local server.
// Usage: node tests/experiments/perspective/exp1_load.mjs [--throttle 10,40] [--base https://acc.dev.sanad.digital] [--browser chromium|firefox|webkit] [--out file.json]
import { chromium, firefox, webkit } from "@playwright/test";
import fs from "node:fs";
import { start } from "./serve.mjs";

const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean).map((s) => s.trim().split(/\s+/)));
const browserName = args.browser || "chromium";
let base = args.base;
let server;
if (!base) {
	server = await start(0);
	base = `http://127.0.0.1:${server.address().port}`;
}
const bundle = args.bundle || "";
const variants = [
	{ mode: "esm", worker: "blob" },
	{ mode: "esm", worker: "url" },
	{ mode: "cdn", worker: "blob" },
	{ mode: "inline", worker: "blob" },
];
if (bundle) variants.push({ mode: "bundle", worker: "blob", bundle }, { mode: "bundle", worker: "url", bundle });

const browser = await { chromium, firefox, webkit }[browserName].launch();
const results = [];
for (const v of variants) {
	// cold = fresh context (empty HTTP cache); warm = reload in the same context
	const context = await browser.newContext({ ignoreHTTPSErrors: true });
	const page = await context.newPage();
	if (args.throttle) {
		// --throttle <mbit>,<latency_ms> : Chromium-only network emulation (the test machine is the server itself)
		const [mbit, latency] = args.throttle.split(",").map(Number);
		const cdp = await context.newCDPSession(page);
		await cdp.send("Network.enable");
		await cdp.send("Network.emulateNetworkConditions", { offline: false, latency, downloadThroughput: (mbit * 1e6) / 8, uploadThroughput: (mbit * 1e6) / 8 });
	}
	const logs = [];
	page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
	page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
	const qs = new URLSearchParams(v).toString();
	const runs = [];
	for (const label of ["cold", "warm", "warm2"]) {
		const responses = [];
		const on_response = async (r) => {
			const h = r.headers();
			responses.push({ url: r.url().replace(base, ""), status: r.status(), type: h["content-type"], encoding: h["content-encoding"] || "", length: h["content-length"] || "", from_cache: r.fromServiceWorker() ? "sw" : "" });
		};
		page.on("response", on_response);
		const t0 = Date.now();
		await page.goto(`${base}/assets/report_view/experiments/load.html?${qs}`, { waitUntil: "load" });
		await page.waitForFunction(() => window.__result, null, { timeout: 60000 });
		const r = await page.evaluate(() => window.__result);
		page.off("response", on_response);
		runs.push({ label, wall_ms: Date.now() - t0, ok: r.ok, error: r.error, timings: r.timings, first_query_ms: r.first_query_ms, total_ms: r.total_ms, system_info: r.system_info, resources: r.resources, responses });
	}
	results.push({ variant: v, browser: browserName, version: browser.version(), base, runs, logs });
	await context.close();
	const s = runs.map((r) => `${r.label}: ok=${r.ok} ready=${r.timings ? r.timings.engine_ready_ms.toFixed(0) : "-"}ms total=${r.total_ms ? r.total_ms.toFixed(0) : "-"}ms${r.error ? " ERR " + r.error.split("\n")[0] : ""}`).join(" | ");
	process.stdout.write(`[${browserName}] ${v.mode}/${v.worker}: ${s}\n`);
	if (logs.length) process.stdout.write(`   console: ${JSON.stringify(logs).slice(0, 600)}\n`);
}
await browser.close();
if (server) server.close();
if (args.out) fs.writeFileSync(args.out, JSON.stringify(results, null, 1));
