// Experiment 4 (CSP part): serve the load page locally with several Content-Security-Policy headers
// and record which loading variants survive. Frappe 16.28.0 / nginx on the site send no CSP today.
// Usage: node tests/experiments/perspective/exp4_csp.mjs [--browser chromium|firefox|webkit] [--out file.json]
import { chromium, firefox, webkit } from "@playwright/test";
import fs from "node:fs";
import { start } from "./serve.mjs";

const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean).map((s) => s.trim().split(/\s+/)));
const browserName = args.browser || "chromium";
const policies = [
	["none", ""],
	["script-src 'self'", "default-src 'self'; script-src 'self'"],
	["+wasm-unsafe-eval", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'"],
	["+wasm-unsafe-eval +worker-src 'self'", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'"],
	["+wasm-unsafe-eval +worker-src 'self' blob:", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:"],
	["+unsafe-eval +worker-src 'self' blob:", "default-src 'self'; script-src 'self' 'unsafe-eval'; worker-src 'self' blob:"],
];
const variants = [
	{ mode: "esm", worker: "blob" },
	{ mode: "esm", worker: "url" },
	{ mode: "inline", worker: "blob" },
];
const browser = await { chromium, firefox, webkit }[browserName].launch();
const results = [];
for (const [label, csp] of policies) {
	const server = await start(0, { csp });
	const base = `http://127.0.0.1:${server.address().port}`;
	for (const v of variants) {
		const context = await browser.newContext();
		const page = await context.newPage();
		const logs = [];
		page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
		page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
		await page.goto(`${base}/assets/report_view/experiments/load.html?${new URLSearchParams(v)}`);
		let r = null;
		try {
			await page.waitForFunction(() => window.__result, null, { timeout: 15000 });
			r = await page.evaluate(() => window.__result);
		} catch (e) {
			r = { ok: false, error: "timeout (engine never became ready)" };
		}
		results.push({ browser: browserName, csp: label, header: csp, variant: v, ok: r.ok, error: r.error ? r.error.split("\n")[0] : null, logs });
		process.stdout.write(`[${browserName}] CSP{${label}} ${v.mode}/${v.worker}: ${r.ok ? "OK" : "FAIL"}${r.error ? " — " + r.error.split("\n")[0] : ""}\n`);
		for (const l of logs.filter((x) => /Content Security|CSP|Refused|violat/i.test(x))) process.stdout.write(`     ${l.slice(0, 260)}\n`);
		await context.close();
	}
	server.close();
}
await browser.close();
if (args.out) fs.writeFileSync(args.out, JSON.stringify(results, null, 1));
