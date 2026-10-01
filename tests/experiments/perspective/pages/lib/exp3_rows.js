// Experiment 3 (follow-up): where does the 500k "rows format" (array of objects) run die? Logs a marker before each stage.
import { generate, SCHEMA } from "./exp3.js";
export default async function ({ client, params }) {
	const n = Number(params.n || 500000);
	const out = { n, stages: [] };
	const mark = async (s) => {
		const si = await client.system_info();
		const rec = `${s} | js_heap=${Math.round(performance.memory.usedJSHeapSize / 1048576)}MB wasm_heap=${Math.round(Number(si.heap_size) / 1048576)}MB wasm_used=${Math.round(Number(si.used_size) / 1048576)}MB`;
		out.stages.push(rec);
		console.log("STAGE " + rec);
	};
	await mark("start");
	const data = generate(n, "rows");
	await mark("rows generated");
	const t0 = performance.now();
	const table = await client.table(SCHEMA);
	await table.update(data);
	out.load_ms = Math.round(performance.now() - t0);
	await mark("table loaded (1st)");
	await table.delete();
	await mark("table deleted");
	for (let i = 2; i <= 4; i++) {
		const t = await client.table(SCHEMA);
		await t.update(data);
		await mark(`table loaded (${i})`);
		await t.delete();
	}
	return out;
}
