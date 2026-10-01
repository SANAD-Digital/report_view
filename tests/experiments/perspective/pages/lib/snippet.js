// Checks the recommended lifecycle: own same-origin Worker (so it can be terminated), versioned URLs, re-creation after dispose.
import { WORKER_JS } from "./load.js";
export default async function ({ perspective }) {
	const out = { rounds: [] };
	const VERSION = "3.8.0";
	let engine = null;
	const get_engine = () => {
		if (!engine) {
			const worker = new Worker(`${WORKER_JS}?v=${VERSION}`, { type: "module" });
			engine = perspective.worker(Promise.resolve(worker)).then((client) => ({ client, worker }));
		}
		return engine;
	};
	const dispose_engine = async () => {
		if (!engine) return;
		const { client, worker } = await engine;
		engine = null;
		client.terminate();
		worker.terminate();
	};
	for (let i = 0; i < 3; i++) {
		const t0 = performance.now();
		const { client } = await get_engine();
		const table = await client.table({ a: "string", x: "float" });
		await table.update({ a: ["نقد", "نقد", "بنك"], x: [1, 2, 3] });
		const view = await table.view({ group_by: ["a"], columns: ["x"], aggregates: { x: "sum" } });
		let total;
		try {
			total = (await view.to_columns()).x[0];
		} finally {
			await view.delete();
		}
		await table.delete();
		await dispose_engine();
		out.rounds.push({ round: i + 1, total, ms: Math.round(performance.now() - t0) });
	}
	out.ok = out.rounds.every((r) => r.total === 6);
	return out;
}
