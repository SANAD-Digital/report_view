// @ts-check
const { defineConfig } = require("@playwright/test");
const { projects } = require("./browsers.js");

// End-to-end tests against a running site (tests/e2e). Tooling installed in tests/:
//   npm --prefix tests ci && npm --prefix tests run e2e
// The site: RV_BASE_URL=https://your.site (no default, so no server name is in the repository)
const baseURL = process.env.RV_BASE_URL || process.env.RV_SITE;
if (!baseURL) throw new Error("Set RV_BASE_URL (or RV_SITE) to the site the end-to-end tests run against.");

module.exports = defineConfig({
	testDir: "./e2e",
	outputDir: "../test-results/e2e",
	timeout: 60_000,
	fullyParallel: false,
	retries: 0,
	reporter: [["list"]],
	use: {
		baseURL,
		ignoreHTTPSErrors: true,
		screenshot: "only-on-failure",
		trace: "retain-on-failure",
	},
	// RV_BROWSERS=chromium,firefox,webkit (default chromium): see browsers.js
	projects: projects(),
});
