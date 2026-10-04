// Entry button «Go to Advanced View» on the standard query-report page (ADR-007).
const { test, expect } = require("@playwright/test");
const users = require("./users");

const LABEL = /الانتقال إلى العرض المتقدم|Go to Advanced View/;

// RV_E2E_USER / RV_E2E_PASSWORD, else rv_accountant from users.js; skipped if neither logs in.
async function login(page) {
	const user = users.find((u) => u.username === "rv_accountant");
	const usr = process.env.RV_E2E_USER || user.email;
	const pwd = process.env.RV_E2E_PASSWORD || user.password;
	const res = await page.request.post("/api/method/login", { data: { usr, pwd } });
	test.skip(!res.ok(), `cannot log in as ${usr}`);
}

test("accountant sees the button and it opens Report View with the same filters", async ({ page }) => {
	const errors = [];
	page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
	await login(page);
	await page.goto("/app/query-report/Trial Balance");
	const button = page.locator(".page-actions button, .inner-toolbar button").filter({ hasText: LABEL });
	await expect(button.first()).toBeVisible({ timeout: 30_000 });
	const company = await page.evaluate(() => frappe.query_report.get_filter_value("company"));
	await button.first().click();
	await page.waitForURL(/report-view\/Trial(%20| )Balance/);
	expect(new URL(page.url()).searchParams.get("company")).toBe(company);
	expect(errors).toEqual([]);
});

test("button is added once after leaving and coming back", async ({ page }) => {
	await login(page);
	await page.goto("/app/query-report/Trial Balance");
	const button = page.locator(".inner-toolbar button").filter({ hasText: LABEL });
	await expect(button).toHaveCount(1, { timeout: 30_000 });
	await page.evaluate(() => frappe.set_route("query-report", "General Ledger"));
	await expect(button).toHaveCount(1, { timeout: 30_000 });
	await page.evaluate(() => frappe.set_route("query-report", "Trial Balance"));
	await page.waitForTimeout(1500);
	await expect(button).toHaveCount(1);
});
