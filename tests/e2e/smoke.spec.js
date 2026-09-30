const { test, expect } = require("@playwright/test");

test("site answers and shows the login form", async ({ page }) => {
	const response = await page.goto("/login");
	expect(response.status()).toBe(200);
	await expect(page.locator("#login_email")).toBeVisible();
	await expect(page.locator("#login_password")).toBeVisible();
});
