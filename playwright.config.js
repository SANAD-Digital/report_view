// @ts-check
const { defineConfig, devices } = require("@playwright/test");

// Development site. Override with RV_BASE_URL=https://other.site npx playwright test
const baseURL = process.env.RV_BASE_URL || "https://acc.dev.sanad.digital";

module.exports = defineConfig({
	testDir: "./tests/e2e",
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
