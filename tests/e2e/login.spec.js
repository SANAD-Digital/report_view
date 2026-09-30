const { test, expect } = require("@playwright/test");
const users = require("./users");

for (const user of users) {
	test(`${user.username} can log in and open /app`, async ({ page }) => {
		await page.goto("/login");
		await page.fill("#login_email", user.email);
		await page.fill("#login_password", user.password);
		await page.click(".btn-login");
		await page.waitForURL(/\/app/);

		await page.goto("/app");
		await expect(page.locator(".navbar")).toBeVisible();
		const sessionUser = await page.evaluate(() => window.frappe && frappe.session.user);
		expect(sessionUser).toBe(user.email);
	});
}
