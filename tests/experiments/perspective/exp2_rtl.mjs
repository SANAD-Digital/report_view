// Experiment 2: screenshots + geometric probes of regular-table in RTL/LTR, for each workaround variant.
// Usage: node tests/experiments/perspective/exp2_rtl.mjs [--browser chromium] [--only native,shim]
import { chromium, firefox, webkit } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { start } from "./serve.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.resolve(here, "../../../docs/research/artifacts/perspective");
const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean).map((s) => s.trim().split(/\s+/)));
const browserName = args.browser || "chromium";
const server = await start(0);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await { chromium, firefox, webkit }[browserName].launch();

const cases = [
	{ name: "ltr-en", q: { v: "native", dir: "ltr", lang: "en" } },
	{ name: "ltr-en-split", q: { v: "native", dir: "ltr", lang: "en", split: 1 } },
	{ name: "rtl-native", q: { v: "native", dir: "rtl" } },
	{ name: "rtl-native-split", q: { v: "native", dir: "rtl", split: 1 } },
	{ name: "rtl-shim", q: { v: "shim", dir: "rtl" } },
	{ name: "rtl-shim-split", q: { v: "shim", dir: "rtl", split: 1 } },
	{ name: "rtl-shim2", q: { v: "shim2", dir: "rtl" } },
	{ name: "rtl-shim2-split", q: { v: "shim2", dir: "rtl", split: 1 } },
	{ name: "rtl-shim2-split-path", q: { v: "shim2", dir: "rtl", split: 1, rh: "path" } },
	{ name: "rtl-shim2-split-pinend", q: { v: "shim2", dir: "rtl", split: 1, pinend: 1 } },
	{ name: "rtl-shim2-split-dark", q: { v: "shim2", dir: "rtl", split: 1, theme: "dark" } },
	{ name: "ltr-en-split-pinend", q: { v: "native", dir: "ltr", lang: "en", split: 1, pinend: 1 } },
	{ name: "rtl-reverse-split", q: { v: "reverse", dir: "rtl", split: 1 } },
	{ name: "rtl-flip-split", q: { v: "flip", dir: "rtl", split: 1 } },
	{ name: "rtl-shim2-split-390", q: { v: "shim2", dir: "rtl", split: 1 }, width: 390, height: 700 },
	{ name: "rtl-flip-split-390", q: { v: "flip", dir: "rtl", split: 1 }, width: 390, height: 700 },
].filter((c) => !args.only || args.only.split(",").some((o) => c.name.includes(o)));

const report = [];
for (const c of cases) {
	const context = await browser.newContext({ viewport: { width: c.width || 1100, height: c.height || 560 } });
	const page = await context.newPage();
	const logs = [];
	page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
	page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
	await page.goto(`${base}/assets/report_view/experiments/rtl.html?${new URLSearchParams(c.q)}`);
	await page.waitForFunction(() => window.__result, null, { timeout: 60000 });
	const entry = { name: c.name, browser: browserName, steps: {}, logs };
	const shot = async (step) => page.screenshot({ path: path.join(outdir, `exp2-${browserName}-${c.name}-${step}.png`) });
	entry.steps.initial = await page.evaluate(() => window.__probe());
	await shot("0-initial");
	entry.steps.scroll_x_half = await page.evaluate(() => window.__scroll(0.5, 0));
	await shot("1-x50");
	entry.steps.scroll_x_end = await page.evaluate(() => window.__scroll(1, 0));
	await shot("2-x100");
	entry.steps.scroll_xy = await page.evaluate(() => window.__scroll(0.5, 1));
	await shot("3-x50-y100");
	// real user input: mouse wheel to the logical "end" side
	await page.evaluate(() => window.__scroll(0, 0));
	const box = await page.locator("#wrap").boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	const rtl_native = c.q.dir === "rtl" && ["native", "shim", "shim2"].includes(c.q.v);
	await page.mouse.wheel(rtl_native ? -400 : c.q.v === "reverse" ? -400 : 400, 0);
	await page.waitForTimeout(500);
	entry.steps.wheel = await page.evaluate(() => window.__probe());
	await shot("4-wheel");
	await page.evaluate(() => window.__cleanup());
	report.push(entry);
	const s = (k) => { const x = entry.steps[k]; return `${k}: rh[left=${x.row_header && x.row_header.left},right=${x.row_header && x.row_header.right}] win=${JSON.stringify(x.window)} x=${JSON.stringify(x.first_row_x.slice(0, 4))} sl=${x.native_scrollLeft} last_col=${x.last_column_visible}`; };
	process.stdout.write(`\n[${browserName}] ${c.name}\n  ${["initial", "scroll_x_half", "scroll_x_end", "scroll_xy", "wheel"].map(s).join("\n  ")}\n  console=${JSON.stringify(logs.filter((l) => !/Unknown browser/.test(l))).slice(0, 300)}\n`);
	await context.close();
}
await browser.close();
server.close();
fs.writeFileSync(path.join(outdir, `exp2-${browserName}-probes.json`), JSON.stringify(report, null, 1));
