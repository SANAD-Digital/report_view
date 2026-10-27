// @ts-check
// Visual harness of Report View (no Frappe site needed):
//   node tests/visual/build.mjs && npx playwright test -c tests/visual
// Other browsers: RV_BROWSERS=firefox (or webkit, or a comma list).
const { defineConfig } = require("@playwright/test");
const { projects } = require("../browsers.js");

const PORT = Number(process.env.RV_HARNESS_PORT || 8791);

module.exports = defineConfig({
	testDir: ".",
	testMatch: /screens\.spec\.js$/,
	timeout: 60_000,
	fullyParallel: false,
	retries: 0,
	reporter: [["list"]],
	outputDir: "../../test-results/visual",
	// The clock and language of the machine the pictures and dates were checked on, so a
	// runner in another zone or locale (CI is UTC, en-US) sees the same periods and text.
	use: { baseURL: `http://127.0.0.1:${PORT}`, timezoneId: "Asia/Aden", locale: "en-US" },
	webServer: {
		command: `node ${__dirname}/serve.mjs ${PORT}`,
		url: `http://127.0.0.1:${PORT}/harness.html`,
		reuseExistingServer: false,
		stdout: "ignore",
		stderr: "ignore",
		timeout: 20_000,
	},
	// RV_BROWSERS=chromium,firefox,webkit (default chromium): see ../browsers.js
	projects: projects(),
});
