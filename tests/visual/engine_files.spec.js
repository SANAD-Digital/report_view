// @ts-check
// The table engine's files (engine/assets.js) missing on a server (its node_modules not
// installed): the page names the file and what to run, never «WebAssembly.instantiate():
// BufferSource argument is empty» (production, 2026-11-16).
const { test, expect } = require("@playwright/test");

test("a missing engine file is named with what to run, not a WebAssembly error", async ({ page }) => {
	// the server's answer for a file it does not have: a 404, empty
	await page.route("**/perspective-server.wasm*", (route) => route.fulfill({ status: 404, body: "" }));
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/harness.html?report=gl&lang=en");
	await page.waitForFunction(() => document.body.dataset.ready || document.body.dataset.error || document.querySelector(".rv-stateov"), null, { timeout: 30_000 });
	await page.waitForTimeout(500);
	const text = await page.evaluate(() => `${document.body.dataset.error || ""} ${document.querySelector(".rv-stateov")?.textContent || ""}`);
	expect(text).toContain("perspective-server.wasm");
	expect(text).toContain("bench setup requirements --node report_view");
	expect(text).not.toContain("BufferSource");
});

test("an engine file served under another type than application/wasm (nginx in containers) still runs the table", async ({ page }) => {
	const fs = require("fs");
	const path = require("path");
	const { watch_console, settle } = require("./helpers.js");
	const problems = watch_console(page);
	// the same bytes, sent as nginx sends a type it does not know
	for (const file of ["perspective-server.wasm", "perspective-js.wasm"]) {
		const body = fs.readFileSync(path.resolve(__dirname, "../../report_view/public/vendor/perspective", file));
		await page.route(`**/${file}*`, (route) => route.fulfill({ status: 200, body, contentType: "application/octet-stream" }));
	}
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/harness.html?report=tb&lang=en");
	await page.waitForFunction(() => document.body.dataset.ready || document.body.dataset.error, null, { timeout: 30_000 });
	expect(await page.evaluate(() => document.body.dataset.error || null)).toBeNull();
	await settle(page);
	expect(await page.locator("regular-table tbody tr").count()).toBeGreaterThan(5);
	expect(problems, "console errors/warnings").toEqual([]);
});
