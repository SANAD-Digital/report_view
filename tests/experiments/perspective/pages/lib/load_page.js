// Experiment 1 page script (external file so the page also works under a strict CSP).
import { load_perspective, params } from "./load.js";
const out = document.getElementById("out");
const p = params();
const result = { ok: false, params: p, ua: navigator.userAgent };
try {
	const { client, timings } = await load_perspective({ mode: p.mode || "esm", worker: p.worker || "blob", bundle: p.bundle });
	result.timings = timings;
	const t0 = performance.now();
	const table = await client.table({ name: "string", amount: "float", posted: "date" });
	await table.update([
		{ name: "نقد", amount: 10.5, posted: "2026-01-01" },
		{ name: "نقد", amount: 4.5, posted: "2026-01-02" },
		{ name: "مدينون", amount: 3, posted: "2026-01-03" },
	]);
	const view = await table.view({ group_by: ["name"], columns: ["amount"], aggregates: { amount: "sum" } });
	let cols;
	try {
		cols = await view.to_columns();
	} finally {
		await view.delete();
	}
	const info = await client.system_info();
	await table.delete();
	result.first_query_ms = performance.now() - t0;
	result.total_ms = timings.engine_ready_ms + result.first_query_ms;
	result.cols = cols;
	result.system_info = JSON.parse(JSON.stringify(info, (k, v) => (typeof v === "bigint" ? Number(v) : v)));
	result.ok = cols.amount[0] === 18 && cols.amount.length === 3;
	result.resources = performance.getEntriesByType("resource").map((r) => ({
		name: r.name.replace(location.origin, ""),
		transfer: r.transferSize,
		encoded: r.encodedBodySize,
		decoded: r.decodedBodySize,
		duration: Math.round(r.duration),
	}));
} catch (e) {
	result.error = String(e && e.stack || e);
}
window.__result = result;
out.textContent = JSON.stringify(result, null, 2);
document.title = result.ok ? "OK" : "FAIL";
