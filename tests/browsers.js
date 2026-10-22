// @ts-check
// The browsers a Playwright run uses: RV_BROWSERS, a comma list of chromium, firefox and
// webkit (Safari's engine). Default chromium only, so a local run stays as it was; CI sets
// one per matrix entry. Firefox and WebKit need their system libraries once (root):
//   cd apps/report_view/tests && sudo npx playwright install-deps firefox webkit
const { devices } = require("@playwright/test");

const DEVICES = {
	chromium: devices["Desktop Chrome"],
	firefox: devices["Desktop Firefox"],
	webkit: devices["Desktop Safari"],
};

function projects() {
	const names = (process.env.RV_BROWSERS || "chromium")
		.split(",")
		.map((n) => n.trim().toLowerCase())
		.filter(Boolean);
	for (const name of names) {
		if (!DEVICES[name]) throw new Error(`RV_BROWSERS: unknown browser "${name}" (chromium, firefox, webkit)`);
	}
	return [...new Set(names)].map((name) => ({ name, use: { ...DEVICES[name] } }));
}

module.exports = { projects };
