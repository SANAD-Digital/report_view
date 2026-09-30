// User grouping over facts with per-group subtotals (Arquero rollups). Pure module.
// Produces dataTree nodes: group rows carry the aggregated measures; leaves are fact rows.

// Arquero is injected, not imported: its source depends on BigInt literals that Frappe's
// es2017 esbuild target cannot compile. The browser loads node_modules/arquero/dist/arquero.min.js
// with frappe.require (see page/report_view/report_view.js); node tests pass the npm module.
let aq_table = null;

/** @param {{table: Function}} aq  the Arquero namespace */
export function use_arquero(aq) {
	aq_table = aq.table;
}
import { flt, cint, clean, row_currency_key } from "./aggregate.js";

const AGG_OP = { sum: "sum", avg: "mean", min: "min", max: "max", count: "count" };

function measure_plan(columns) {
	return columns
		.filter((c) => c.role === "measure" && c.agg && !c.original?.disable_total)
		.map((c, i) => ({ column: c, alias: `m${i}`, currency: row_currency_key(c) }));
}

function to_table(facts, keys, plan, currency_keys) {
	const data = {};
	keys.forEach((k, i) => {
		data[`g${i}`] = facts.map((r) => {
			const v = r[k];
			return v === undefined || v === "" ? null : v;
		});
	});
	for (const p of plan) {
		const c = p.column;
		data[p.alias] = facts.map((r) => {
			const v = r[c.key];
			if (c.agg === "min" || c.agg === "max") {
				return v === null || v === undefined || v === "" ? null : flt(v);
			}
			return c.fieldtype === "Int" ? cint(v) : flt(v);
		});
	}
	currency_keys.forEach((ck, i) => {
		data[`c${i}`] = facts.map((r) => r[ck] || null);
	});
	data.__idx = facts.map((_, i) => i);
	if (!aq_table && globalThis.aq) {
		aq_table = globalThis.aq.table;
	}
	if (!aq_table) {
		throw new Error("report_view: Arquero is not loaded");
	}
	return aq_table(data);
}

function rollup_spec(plan, currency_keys) {
	const spec = { __count: "d => op.count()" };
	for (const p of plan) {
		spec[p.alias] = `d => op.${AGG_OP[p.column.agg] || "sum"}(d.${p.alias})`;
	}
	currency_keys.forEach((_, i) => {
		spec[`c${i}`] = `d => op.array_agg_distinct(d.c${i})`;
	});
	return spec;
}

function path_id(values) {
	return JSON.stringify(values);
}

/**
 * @param {Array} facts  filtered + sorted fact rows
 * @param {Array} columns  NormalizedReport.columns
 * @param {Array<string>} keys  group-by column keys (one or more levels)
 * @param {object} opts  {compare(a, b) for group values, desc: {key: bool}}
 * @returns {Array} tree of group nodes with _children
 */
export function group_rows(facts, columns, keys, opts = {}) {
	const plan = measure_plan(columns);
	const currency_keys = [...new Set(plan.map((p) => p.currency).filter(Boolean))];
	const table = to_table(facts, keys, plan, currency_keys);
	const spec = rollup_spec(plan, currency_keys);

	// One rollup per level: level L groups by the first L keys.
	const levels = keys.map((_, level) => {
		const by = keys.slice(0, level + 1).map((__, i) => `g${i}`);
		const rolled = table.groupby(by).rollup(spec).objects();
		const map = new Map();
		for (const r of rolled) map.set(path_id(by.map((g) => r[g])), r);
		return map;
	});

	const compare = opts.compare || ((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	const root = { children: new Map(), order: [] };
	const gcols = table.array("__idx");
	const gvals = keys.map((_, i) => table.array(`g${i}`));

	for (let i = 0; i < gcols.length; i++) {
		let node = root;
		const path = [];
		keys.forEach((k, level) => {
			const v = gvals[level][i];
			path.push(v);
			const id = path_id(path);
			if (!node.children.has(id)) {
				const child = { id, level, key: k, value: v, path: [...path], children: new Map(), order: [], leaves: [] };
				node.children.set(id, child);
				node.order.push(child);
			}
			node = node.children.get(id);
		});
		node.leaves.push(facts[gcols[i]]);
	}

	const build = (node) => {
		const stats = levels[node.level].get(node.id);
		const out = {
			__id: `g:${node.id}`,
			__kind: "group",
			__depth: node.level,
			__group_key: node.key,
			__group_value: node.value,
			__count: stats.__count,
			__mixed: {},
		};
		const shared = {};
		currency_keys.forEach((ck, i) => {
			const list = (stats[`c${i}`] || []).filter(Boolean);
			shared[ck] = list.length === 1 ? list[0] : null;
			out[ck] = shared[ck];
		});
		for (const p of plan) {
			if (p.currency && p.column.agg !== "count") {
				const list = (stats[`c${currency_keys.indexOf(p.currency)}`] || []).filter(Boolean);
				if (list.length > 1) {
					out[p.column.key] = null;
					out.__mixed[p.column.key] = true;
					continue;
				}
			}
			const v = stats[p.alias];
			out[p.column.key] = v === undefined ? null : clean(v);
		}
		const kids = [...node.order];
		const desc = opts.desc?.[node.key] === true;
		kids.sort((a, b) => {
			if (a.value === null && b.value !== null) return 1;
			if (b.value === null && a.value !== null) return -1;
			const r = compare(a.value, b.value);
			return desc ? -r : r;
		});
		out._children = kids.length
			? kids.map(build)
			: node.leaves.map((r) => ({ ...r, __id: `r:${r.__rid}` }));
		return out;
	};

	const tops = [...root.order];
	const desc0 = opts.desc?.[keys[0]] === true;
	tops.sort((a, b) => {
		if (a.value === null && b.value !== null) return 1;
		if (b.value === null && a.value !== null) return -1;
		const r = compare(a.value, b.value);
		return desc0 ? -r : r;
	});
	return tops.map(build);
}
