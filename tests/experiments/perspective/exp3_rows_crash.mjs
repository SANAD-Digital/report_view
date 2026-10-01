// Prints stage markers live so the stage at which the tab crashes is visible.
// Usage: node tests/experiments/perspective/exp3_rows_crash.mjs [n]
import { chromium } from "@playwright/test";
import { start } from "./serve.mjs";
const n = process.argv[2] || 500000;
const server = await start(0);
const browser = await chromium.launch({ args: ["--enable-precise-memory-info"] });
const page = await browser.newPage();
page.on("console", (m) => m.text().startsWith("STAGE") && process.stdout.write(m.text() + "\n"));
page.on("crash", () => process.stdout.write("PAGE CRASHED\n"));
await page.goto(`http://127.0.0.1:${server.address().port}/assets/report_view/experiments/run.html?exp=exp3_rows&n=${n}`);
try {
	await page.waitForFunction(() => window.__result, null, { timeout: 600000 });
	process.stdout.write(JSON.stringify(await page.evaluate(() => window.__result)) + "\n");
} catch (e) {
	process.stdout.write("ERROR " + e.message.split("\n")[0] + "\n");
}
await browser.close();
server.close();
