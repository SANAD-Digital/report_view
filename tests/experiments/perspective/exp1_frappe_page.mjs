// Experiment 1 (Frappe page part): load the engine from inside a page rendered by Frappe itself.
// No test account exists, so the only Frappe-rendered pages reachable are guest pages (/login).
// It is the same origin, the same nginx/Frappe response headers and the same asset URLs as Desk.
// Usage: node tests/experiments/perspective/exp1_frappe_page.mjs [--base https://acc.dev.sanad.digital] [--bundle /assets/...js] [--out file.json] [--channel chromium]
import { chromium } from "@playwright/test";
import fs from "node:fs";

const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean).map((s) => s.trim().split(/\s+/)));
const base = args.base || "https://acc.dev.sanad.digital";
const browser = await chromium.launch(args.channel ? { channel: args.channel } : {});
const out = [];
for (const v of [
	{ mode: "esm", worker: "blob" },
	{ mode: "esm", worker: "url" },
	...(args.bundle ? [{ mode: "bundle", worker: "blob", bundle: args.bundle }, { mode: "bundle", worker: "url", bundle: args.bundle }] : []),
]) {
	const context = await browser.newContext({ ignoreHTTPSErrors: true });
	const page = await context.newPage();
	const logs = [];
	page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
	page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
	const resp = await page.goto(`${base}/login`, { waitUntil: "load" });
	const headers = resp.headers();
	const r = await page.evaluate(async (v) => {
		const has_frappe = typeof window.frappe === "object";
		const has_chrome = typeof window.chrome !== "undefined";
		try {
			const { load_perspective } = await import("/assets/report_view/experiments/lib/load.js");
			const { client, timings } = await load_perspective(v);
			const table = await client.table({ a: "string", x: "float" });
			await table.update([{ a: "نقد", x: 1.5 }, { a: "نقد", x: 2.5 }]);
			const view = await table.view({ group_by: ["a"], columns: ["x"], aggregates: { x: "sum" } });
			let cols;
			try {
				cols = await view.to_columns();
			} finally {
				await view.delete();
			}
			await table.delete();
			return { ok: cols.x[0] === 4, timings, has_frappe, has_chrome, boot_lang: document.documentElement.lang, dir: document.documentElement.dir };
		} catch (e) {
			return { ok: false, error: String((e && e.stack) || e), has_frappe, has_chrome };
		}
	}, v);
	out.push({ variant: v, page: "/login", csp: headers["content-security-policy"] || null, x_content_type_options: headers["x-content-type-options"] || null, result: r, logs });
	process.stdout.write(`/login ${v.mode}/${v.worker}: ok=${r.ok} frappe=${r.has_frappe} window.chrome=${r.has_chrome} ready=${r.timings ? r.timings.engine_ready_ms.toFixed(0) : "-"}ms csp=${headers["content-security-policy"] || "none"} ${r.error || ""}\n`);
	process.stdout.write(`   console: ${JSON.stringify(logs).slice(0, 500)}\n`);
	await context.close();
}
await browser.close();
if (args.out) fs.writeFileSync(args.out, JSON.stringify(out, null, 1));
