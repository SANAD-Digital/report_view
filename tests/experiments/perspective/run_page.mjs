// Generic runner: open an experiment page, wait for window.__result, print it.
// Usage: node tests/experiments/perspective/run_page.mjs <page.html?query> [--base URL] [--browser chromium] [--out file.json] [--shot file.png] [--timeout ms]
import { chromium, firefox, webkit } from "@playwright/test";
import fs from "node:fs";
import { start } from "./serve.mjs";

const [target, ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.join(" ").split("--").filter(Boolean).map((s) => s.trim().split(/\s+/)));
let base = args.base;
let server;
if (!base) {
	server = await start(0);
	base = `http://127.0.0.1:${server.address().port}`;
}
const launch = { args: ["--enable-precise-memory-info", "--js-flags=--expose-gc"] };
if (args.channel) launch.channel = args.channel;
const browser = await { chromium, firefox, webkit }[args.browser || "chromium"].launch(args.browser && args.browser !== "chromium" ? {} : launch);
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: Number(args.width || 1280), height: Number(args.height || 800) } });
const page = await context.newPage();
const logs = [];
page.on("console", (m) => {
	if (m.text().startsWith("STAGE")) {
		if (args.live) process.stderr.write(m.text() + "\n");
		return;
	}
	logs.push(`${m.type()}: ${m.text()}`);
});
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(`${base}/assets/report_view/experiments/${target}`);
await page.waitForFunction(() => window.__result, null, { timeout: Number(args.timeout || 600000), polling: 250 });
const result = await page.evaluate(() => window.__result);
if (args.shot) await page.screenshot({ path: args.shot });
await browser.close();
if (server) server.close();
const payload = { target, base, browser: args.browser || "chromium", result, console: logs };
if (args.out) fs.writeFileSync(args.out, JSON.stringify(payload, null, 1));
process.stdout.write(JSON.stringify(args.quiet ? { ok: result.ok, console: logs } : payload, null, 1) + "\n");
