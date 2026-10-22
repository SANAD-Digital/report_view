const { test, expect } = require("@playwright/test");
const users = require("./users");

// rv_none has no role: it signs in, but Frappe does not open the Desk for it.
const NO_DESK = new Set(["rv_none"]);

for (const user of users) {
	test(`${user.username} can log in${NO_DESK.has(user.username) ? "" : " and open /app"}`, async ({ page }) => {
		await page.goto("/login");
		await page.fill("#login_email", user.email);
		await page.fill("#login_password", user.password);
		await page.click(".btn-login");
		// after login Frappe opens the user's home (/app, /desk or /home, by site and role)
		await page.waitForURL((url) => !url.pathname.startsWith("/login"));
		const logged = await page.request.get("/api/method/frappe.auth.get_logged_user");
		expect((await logged.json()).message).toBe(user.email);
		if (NO_DESK.has(user.username)) return;

		await page.goto("/app");
		await expect(page.locator(".navbar")).toBeVisible();
		const sessionUser = await page.evaluate(() => window.frappe && frappe.session.user);
		expect(sessionUser).toBe(user.email);
	});
}
