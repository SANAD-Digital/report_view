// Screenshots of the interactive prototype (reference/design/محرك عرض التقارير ... .html),
// offline, at 1440x1100. Output: reference/design/screens/<state>.png
//   node scripts/capture_prototype.cjs            all states
//   node scripts/capture_prototype.cjs pivot dark  only these
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const DESIGN = path.join(ROOT, "reference/design");
const OUT = path.join(DESIGN, "screens");
const PROTO = fs.readdirSync(DESIGN).find((f) => f.endsWith(".html") && f.includes("النموذج التفاعلي"));

const STEPS = {
	main: async () => {},
	dark: async (p) => p.click('button[aria-label="تبديل الوضع الداكن"]'),
	compact: async (p) => p.click("text=مضغوط"),
	fav: async (p) => p.click(".rv-fav-btn"),
	search: async (p) => p.click('button[aria-label="خيارات البحث"]'),
	date: async (p) => p.click('button[aria-label="اختيار الفترة"]'),
	colmenu: async (p) => p.locator('button[aria-label="قائمة العمود"]').nth(2).click({ force: true }),
	setfilter: async (p) => p.locator('[class*="set"]').first().click({ force: true }),
	sidecols: async (p) => p.click("text=الأعمدة"),
	sidefilters: async (p) => p.click("text=الفلاتر"),
	pivot: async (p) => p.click("text=تحليل Pivot"),
	charts: async (p) => p.click("text=رسوم"),
	drawer: async (p) => p.locator(".rv-acc").nth(2).click(),
	voucher: async (p) => {
		await p.locator(".rv-acc").nth(2).click();
		await p.waitForTimeout(600);
		await p.locator(".rv-vbtn").first().click();
	},
	print: async (p) => p.click('button:has-text("طباعة")'),
	pdf: async (p) => p.click('button:has-text("PDF")'),
	ctx: async (p) => p.locator(".rv-c.num").nth(5).click({ button: "right" }),
	range: async (p) => {
		const a = await p.locator(".rv-c.num").nth(4).boundingBox();
		const b = await p.locator(".rv-c.num").nth(20).boundingBox();
		await p.mouse.move(a.x + 5, a.y + 5);
		await p.mouse.down();
		await p.mouse.move(b.x + 5, b.y + 5, { steps: 5 });
		await p.mouse.up();
	},
};

(async () => {
	const only = process.argv.slice(2);
	const browser = await chromium.launch();
	fs.mkdirSync(OUT, { recursive: true });
	for (const [name, step] of Object.entries(STEPS)) {
		if (only.length && !only.includes(name)) continue;
		const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
		// The bundle is self-contained; block the network so the capture is reproducible.
		await page.route("**/*", (r) => (/^(file|blob|data):/.test(r.request().url()) ? r.continue() : r.abort()));
		await page.goto("file://" + path.join(DESIGN, PROTO));
		await page.waitForSelector(".rv-acc", { timeout: 15000 });
		await page.waitForTimeout(800);
		try {
			await step(page);
			await page.waitForTimeout(700);
			await page.screenshot({ path: path.join(OUT, `${name}.png`) });
			process.stdout.write(`ok ${name}\n`);
		} catch (e) {
			process.stdout.write(`FAIL ${name}: ${e.message.split("\n")[0]}\n`);
		}
		await page.close();
	}
	await browser.close();
})();
