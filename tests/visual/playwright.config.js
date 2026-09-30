// @ts-check
// Visual harness of Report View (no Frappe site needed):
//   node tests/visual/build.mjs && npx playwright test -c tests/visual
const { defineConfig, devices } = require("@playwright/test");

const PORT = Number(process.env.RV_HARNESS_PORT || 8791);

module.exports = defineConfig({
	testDir: ".",
	testMatch: /screens\.spec\.js$/,
	timeout: 60_000,
	fullyParallel: false,
	retries: 0,
	reporter: [["list"]],
	outputDir: "../../test-results/visual",
	use: { baseURL: `http://127.0.0.1:${PORT}` },
	webServer: {
		command: `python3 -m http.server ${PORT} --bind 127.0.0.1 --directory ${__dirname}`,
		url: `http://127.0.0.1:${PORT}/harness.html`,
		reuseExistingServer: false,
		stdout: "ignore",
		stderr: "ignore",
		timeout: 20_000,
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
