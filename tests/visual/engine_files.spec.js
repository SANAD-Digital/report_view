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
