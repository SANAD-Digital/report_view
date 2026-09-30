// Trial Balance in Report View against the original query-report page (phase 3).
//
// Accounts:
//   RV_E2E_USER / RV_E2E_PASSWORD  a user allowed to run Trial Balance (totals check).
//   tests/e2e/users.js             the rv_* matrix; each test is skipped if that user cannot log in.
const { test, expect } = require("@playwright/test");
const users = require("./users");

const COMPANY = process.env.RV_E2E_COMPANY || "SND Accounting";
const FISCAL_YEAR = process.env.RV_E2E_FISCAL_YEAR || "2026";
const COLUMNS = ["opening_debit", "opening_credit", "debit", "credit", "closing_debit", "closing_credit"];
const TOLERANCE = 0.005;

const query = new URLSearchParams({ company: COMPANY, fiscal_year: FISCAL_YEAR }).toString();
const RV_URL = `/desk/report-view/Trial%20Balance?${query}`;
const QR_URL = `/desk/query-report/Trial%20Balance?${query}`;

async function login(page, usr, pwd) {
	const res = await page.request.post("/api/method/login", { data: { usr, pwd } });
	return res.ok();
}

function watch_console(page) {
	const problems = [];
	page.on("console", (msg) => {
		if (["error", "warning"].includes(msg.type())) problems.push(`${msg.type()}: ${msg.text()}`);
	});
	page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
	return problems;
}

async function report_view_totals(page) {
	await page.goto(RV_URL);
	const handle = await page.waitForFunction(
		() => {
			const w = document.querySelector("#page-report-view");
			const rv = w && w.rv_page;
			return rv && rv.debug_totals();
		},
		null,
		{ timeout: 45_000 }
	);
	return handle.jsonValue();
}

async function query_report_total_row(page) {
	await page.goto(QR_URL);
	const handle = await page.waitForFunction(
		() => {
			const data = window.frappe && frappe.query_report && frappe.query_report.data;
			if (!data || !data.length) return null;
			return data.find((r) => r && r.account === "'Total'") || null;
		},
		null,
		{ timeout: 45_000 }
	);
	return handle.jsonValue();
}

test.describe("Trial Balance totals", () => {
	test.skip(!process.env.RV_E2E_USER, "set RV_E2E_USER and RV_E2E_PASSWORD to run the totals check");

	test("six totals match query-report and the console is clean", async ({ page }) => {
		const problems = watch_console(page);
		expect(await login(page, process.env.RV_E2E_USER, process.env.RV_E2E_PASSWORD)).toBe(true);

		const ours = await report_view_totals(page);
		const reference = await query_report_total_row(page);

		for (const key of COLUMNS) {
			const a = Number(ours.totals[key] || 0);
			const b = Number(reference[key] || 0);
			expect(Math.abs(a - b), `${key}: report view ${a} vs query-report ${b}`).toBeLessThan(TOLERANCE);
		}

		// ADR-006: the original page keeps working after visiting ours.
		const is_original = await page.evaluate(
			() => frappe.query_report instanceof frappe.views.QueryReport
		);
		expect(is_original).toBe(true);
		expect(problems).toEqual([]);
	});
});

test.describe("Trial Balance per test user", () => {
	for (const user of users) {
		test(`${user.username}`, async ({ page }) => {
			const problems = watch_console(page);
			const ok = await login(page, user.email, user.password);
			test.skip(!ok, `${user.email} cannot log in (test users not created on this site)`);

			await page.goto(RV_URL);
			const state = page.locator("#page-report-view");

			if (user.username === "rv_none") {
				await expect(state.locator('.rv-state[data-state="error"]')).toBeVisible({ timeout: 45_000 });
				return;
			}

			await page.waitForFunction(
				() => {
					const w = document.querySelector("#page-report-view");
					return w && w.rv_page && w.rv_page.debug_totals();
				},
				null,
				{ timeout: 45_000 }
			);

			const export_btn = state.locator('[data-action="export"]');
			if (user.username === "rv_noexport") {
				await expect(export_btn).toBeHidden();
			} else {
				await expect(export_btn).toBeVisible();
			}
			expect(problems).toEqual([]);
		});
	}
});
