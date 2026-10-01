// Experiment 3 (follow-up): peak WASM heap when 500k rows are loaded at once vs. in column-oriented chunks.
import { generate, SCHEMA } from "./exp3.js";
export default async function ({ client, params }) {
	const n = Number(params.n || 500000);
	const chunk = Number(params.chunk || 0);
	const format = params.format || "columns";
	const out = { n, chunk, format };
	const data = generate(n, "columns");
	const keys = Object.keys(data);
	const t0 = performance.now();
	const table = await client.table(SCHEMA);
	if (!chunk) {
		await table.update(data);
	} else {
		for (let i = 0; i < n; i += chunk) {
			let part;
			if (format === "rows") {
				part = [];
				for (let j = i; j < Math.min(n, i + chunk); j++) { const o = {}; for (const k of keys) o[k] = data[k][j]; part.push(o); }
			} else {
				part = {};
				for (const k of keys) part[k] = data[k].slice(i, i + chunk);
			}
			await table.update(part);
		}
	}
	out.load_ms = Math.round(performance.now() - t0);
	out.size = await table.size();
	const si = await client.system_info();
	out.wasm_heap_mb = Math.round(Number(si.heap_size) / 1048576);
	out.wasm_used_mb = Math.round(Number(si.used_size) / 1048576);
	const v = await table.view({ group_by: ["dim_a", "dim_b"], columns: ["m1"], aggregates: { m1: "sum" } });
	try {
		const t1 = performance.now();
		const c = await v.to_columns({ start_row: 0, end_row: 1 });
		out.total_m1 = c.m1[0];
	} finally {
		await v.delete();
	}
	await table.delete();
	return out;
}
