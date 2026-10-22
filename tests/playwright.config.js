// @ts-check
const { defineConfig, devices } = require("@playwright/test");

// End-to-end tests against a running site (tests/e2e). Tooling installed in tests/:
//   npm --prefix tests ci && npm --prefix tests run e2e
// Development site. Override with RV_BASE_URL=https://other.site
const baseURL = process.env.RV_BASE_URL || "https://acc.dev.sanad.digital";

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
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
