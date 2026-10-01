// Experiment 3: performance and memory. run.html?exp=exp3&n=100000[&format=columns|rows][&cycles=20]
import { NM } from "./load.js";

const DIMS = { dim_a: 12, dim_b: 50, dim_c: 500, dim_d: 5000 };
const MEAS = ["m1", "m2", "m3", "m4", "m5", "m6"];
export const SCHEMA = { id: "integer", dim_a: "string", dim_b: "string", dim_c: "string", dim_d: "string", posted: "date", m1: "float", m2: "float", m3: "float", m4: "float", m5: "float", m6: "float" };

function rng(seed) {
	let s = seed >>> 0;
	return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export function generate(n, format = "columns") {
	const r = rng(42);
	const names = {};
	for (const [d, k] of Object.entries(DIMS)) names[d] = Array.from({ length: k }, (_, i) => `${d === "dim_a" ? "مركز" : d === "dim_b" ? "فرع" : d === "dim_c" ? "عميل" : "حساب"} ${String(i + 1).padStart(4, "0")}`);
	const day0 = Date.UTC(2026, 0, 1);
	const cols = { id: new Array(n), dim_a: new Array(n), dim_b: new Array(n), dim_c: new Array(n), dim_d: new Array(n), posted: new Array(n) };
	for (const m of MEAS) cols[m] = new Array(n);
	for (let i = 0; i < n; i++) {
		cols.id[i] = i;
		for (const d in DIMS) cols[d][i] = names[d][(r() * DIMS[d]) | 0];
		cols.posted[i] = new Date(day0 + ((r() * 365) | 0) * 86400000).toISOString().slice(0, 10);
		for (const m of MEAS) cols[m][i] = Math.round(r() * 1e7) / 100;
	}
	if (format === "columns") return cols;
	const keys = Object.keys(cols);
	const rows = new Array(n);
	for (let i = 0; i < n; i++) {
		const o = {};
		for (const k of keys) o[k] = cols[k][i];
		rows[i] = o;
	}
	return rows;
}

const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
const round = (x) => Math.round(x * 10) / 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function ({ client, params }) {
	const n = Number(params.n || 10000);
	const format = params.format || "columns";
	const cycles = Number(params.cycles || 20);
	const out = { n, format, timings_ms: {}, raw: {}, memory: [] };
	const mem = async (label) => {
		if (window.gc) { window.gc(); await sleep(50); }
		const si = await client.system_info();
		const rec = {
			label,
			js_heap_used_mb: performance.memory ? round(performance.memory.usedJSHeapSize / 1048576) : null,
			js_heap_total_mb: performance.memory ? round(performance.memory.totalJSHeapSize / 1048576) : null,
			wasm_heap_size_mb: round(Number(si.heap_size) / 1048576),
			wasm_used_size_mb: round(Number(si.used_size) / 1048576),
		};
		out.memory.push(rec);
		return rec;
	};
	const time3 = async (name, fn, cleanup) => {
		const samples = [];
		for (let i = 0; i < 3; i++) {
			const t0 = performance.now();
			const handle = await fn();
			samples.push(performance.now() - t0);
			if (cleanup) await cleanup(handle);
		}
		out.raw[name] = samples.map(round);
		out.timings_ms[name] = round(median(samples));
	};

	try {
		out.measureUserAgentSpecificMemory = performance.measureUserAgentSpecificMemory ? (crossOriginIsolated ? "available" : "present but page is not crossOriginIsolated") : "not available";
	} catch (e) {
		out.measureUserAgentSpecificMemory = String(e);
	}
	await mem("before data");
	const tg = performance.now();
	const data = generate(n, format);
	out.generate_ms = round(performance.now() - tg);
	await mem("data generated in JS (not yet in engine)");

	// 1. table load (schema first, then update) — 3 runs, median
	await time3("table_load", async () => {
		const t = await client.table(SCHEMA);
		await t.update(data);
		return t;
	}, async (t) => t.delete());

	const table = await client.table(SCHEMA);
	await table.update(data);
	out.table_size = await table.size();
	out.table_schema = await table.schema();
	await mem("table loaded");

	const aggs = Object.fromEntries(MEAS.map((m) => [m, "sum"]));
	const win = { start_row: 0, end_row: 100 };
	const del = async (v) => v.delete();

	// 2. group_by on two levels + first 100 rows
	await time3("group_by_2_levels_view+to_columns_100", async () => {
		const v = await table.view({ group_by: ["dim_a", "dim_b"], columns: MEAS, aggregates: aggs });
		const c = await v.to_columns(win);
		out.group_by_rows = await v.num_rows();
		return v;
	}, del);
	// deeper / higher cardinality grouping
	await time3("group_by_3_levels_highcard_view+to_columns_100", async () => {
		const v = await table.view({ group_by: ["dim_a", "dim_c", "dim_d"], columns: MEAS, aggregates: aggs, group_by_depth: 1 });
		await v.to_columns(win);
		return v;
	}, del);
	// 3. split_by (12 values) with group_by
	await time3("split_by_12+group_by_view+to_columns_100", async () => {
		const v = await table.view({ group_by: ["dim_b"], split_by: ["dim_a"], columns: MEAS, aggregates: aggs });
		await v.to_columns(win);
		out.split_by_columns = (await v.column_paths()).length;
		return v;
	}, del);
	// 4. flat view: filter + sort
	await time3("flat_view+to_columns_100", async () => {
		const v = await table.view({});
		await v.to_columns(win);
		return v;
	}, del);
	await time3("filter+sort_flat_view+to_columns_100", async () => {
		const v = await table.view({ filter: [["dim_a", "in", ["مركز 0001", "مركز 0002", "مركز 0003"]], ["m1", ">", 50000]], sort: [["m2", "desc"]] });
		await v.to_columns(win);
		out.filtered_rows = await v.num_rows();
		return v;
	}, del);
	await time3("filter+sort_grouped_view+to_columns_100", async () => {
		const v = await table.view({ group_by: ["dim_a", "dim_b"], columns: MEAS, aggregates: aggs, filter: [["dim_c", "contains", "001"]], sort: [["m1", "desc"]] });
		await v.to_columns(win);
		return v;
	}, del);
	// unique values of one column with counts (filter panel)
	await time3("unique_values_with_count_dim_d", async () => {
		const v = await table.view({ group_by: ["dim_d"], columns: ["id"], aggregates: { id: "count" } });
		const c = await v.to_columns();
		out.unique_dim_d = c.__ROW_PATH__.length - 1;
		return v;
	}, del);
	// expression column + group
	await time3("expression+group_by_view+to_columns_100", async () => {
		const v = await table.view({ group_by: ["dim_a", "dim_b"], columns: ["net"], expressions: { net: '"m1" - "m2"' }, aggregates: { net: "sum" } });
		await v.to_columns(win);
		return v;
	}, del);
	// scrolling window on an existing view (what regular-table does while scrolling)
	{
		const v = await table.view({ sort: [["m2", "desc"]] });
		try {
			const samples = [];
			for (let i = 0; i < 9; i++) {
				const start = Math.floor(((i + 1) / 10) * n);
				const t0 = performance.now();
				await v.to_columns({ start_row: start, end_row: start + 50 });
				samples.push(performance.now() - t0);
			}
			out.timings_ms["window_50_rows_on_sorted_view"] = round(median(samples));
		} finally {
			await v.delete();
		}
	}
	// 5. delete timings
	{
		const v = await table.view({ group_by: ["dim_a", "dim_b"], columns: MEAS, aggregates: aggs });
		await v.to_columns(win);
		await mem("table + one grouped view");
		const t0 = performance.now();
		await v.delete();
		out.timings_ms["view_delete"] = round(performance.now() - t0);
	}

	// 6. first display with regular-table (flat view, data already in JS memory)
	await import(`${NM}/regular-table/dist/esm/regular-table.js`);
	{
		const host = document.createElement("div");
		host.style.cssText = "position:relative;width:1200px;height:600px";
		document.body.appendChild(host);
		const samples = [];
		for (let i = 0; i < 3; i++) {
			const rt = document.createElement("regular-table");
			host.appendChild(rt);
			const t0 = performance.now();
			const t = await client.table(SCHEMA);
			await t.update(data);
			const v = await t.view({ group_by: ["dim_a", "dim_b"], columns: MEAS, aggregates: aggs });
			const paths = await v.column_paths();
			const num_rows = await v.num_rows();
			rt.setDataListener(async (x0, y0, x1, y1) => {
				const c = await v.to_columns({ start_row: y0, end_row: y1, start_col: x0, end_col: x1 });
				const names = paths.slice(x0, x1);
				return { num_rows, num_columns: paths.length, row_headers: c.__ROW_PATH__.map((p) => [p.join(" / ")]), column_headers: names.map((x) => [x]), data: names.map((x) => c[x]) };
			});
			await rt.draw();
			await new Promise(requestAnimationFrame);
			samples.push(performance.now() - t0);
			out.first_display_cells = rt.querySelectorAll("td").length;
			rt.remove();
			await v.delete();
			await t.delete();
		}
		out.raw["first_display_table+grouped_view+regular_table_draw"] = samples.map(round);
		out.timings_ms["first_display_table+grouped_view+regular_table_draw"] = round(median(samples));
		host.remove();
	}

	const t0 = performance.now();
	await table.delete();
	out.timings_ms["table_delete"] = round(performance.now() - t0);
	await mem("after table.delete()");

	// 7. leak check: N cycles of table + 2 views + delete
	out.cycles = [];
	for (let i = 0; i < cycles; i++) {
		const t = await client.table(SCHEMA);
		await t.update(data);
		const v1 = await t.view({ group_by: ["dim_a", "dim_b"], columns: MEAS, aggregates: aggs });
		const v2 = await t.view({ group_by: ["dim_b"], split_by: ["dim_a"], columns: MEAS, aggregates: aggs });
		try {
			await v1.to_columns(win);
			await v2.to_columns(win);
		} finally {
			await v2.delete();
			await v1.delete();
		}
		await t.delete();
		if (i === 0 || i === 4 || i === 9 || i === 14 || i === cycles - 1) out.cycles.push(Object.assign({ cycle: i + 1 }, await mem(`after cycle ${i + 1}`)));
	}
	out.tables_left = await client.get_hosted_table_names();
	return out;
}
