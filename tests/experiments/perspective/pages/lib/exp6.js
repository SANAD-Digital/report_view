// Experiment 6: do Perspective group totals match the parent rows and the 'Total' row of Trial Balance?
import { fetch_fixture, build_facts, MEASURES } from "./tb.js";

const EPS = 0.005;

// raw query_report result -> rows with __rid/__parent/__is_leaf/__kind (the same shape the normalizer produces)
function normalize(raw) {
	const rows = raw.result.filter((r) => r && typeof r === "object" && !Array.isArray(r) && Object.keys(r).length);
	const total = rows.find((r) => r.account === "'Total'");
	const data = rows.filter((r) => r !== total);
	const id = new Map(data.map((r, i) => [r.account, i]));
	const has_child = new Set(data.map((r) => r.parent_account).filter(Boolean));
	const out = data.map((r, i) => Object.assign({}, r, { __rid: i, __parent: r.parent_account ? id.get(r.parent_account) : null, __is_leaf: !has_child.has(r.account), __kind: "data" }));
	return { rows: out, total };
}

function chain_of(rows, row) {
	const by = new Map(rows.map((r) => [r.__rid, r]));
	const chain = [row.account];
	for (let p = by.get(row.__parent); p; p = by.get(p.__parent)) chain.unshift(p.account);
	return chain;
}

function compare(expected_rows, got_by_path, fields, label) {
	const res = { label, parents: 0, matched: 0, mismatches: [] };
	for (const { path, row } of expected_rows) {
		res.parents++;
		const got = got_by_path.get(JSON.stringify(path));
		const diffs = {};
		for (const f of fields) {
			const g = got ? got[f] : undefined;
			if (g === undefined || Math.abs(g - row[f]) > EPS) diffs[f] = { report: row[f], engine: g };
		}
		if (Object.keys(diffs).length) res.mismatches.push({ account: path[path.length - 1], diffs });
		else res.matched++;
	}
	res.mismatch_count = res.mismatches.length;
	res.mismatches = res.mismatches.slice(0, 4);
	return res;
}

async function view_rows(table, config) {
	const view = await table.view(config);
	try {
		const cols = await view.to_columns();
		const names = Object.keys(cols).filter((k) => k !== "__ROW_PATH__");
		const map = new Map();
		cols.__ROW_PATH__.forEach((p, i) => {
			const o = {};
			for (const n of names) o[n] = cols[n][i];
			map.set(JSON.stringify(p), o);
		});
		return map;
	} finally {
		await view.delete();
	}
}

async function run_variant(client, suffix) {
	const net1 = normalize(await fetch_fixture(`tb_net1${suffix}.json`));
	const net0 = normalize(await fetch_fixture(`tb_net0${suffix}.json`));
	const out = { report_total_net1: pick(net1.total), report_total_net0: pick(net0.total) };
	const sum = Object.fromEntries(MEASURES.map((m) => [m, "sum"]));

	for (const [name, src] of [["net1", net1], ["net0", net0]]) {
		const { schema, data, level_names } = build_facts(src.rows);
		const table = await client.table(schema);
		await table.update(data);
		const parents = src.rows.filter((r) => !r.__is_leaf).map((r) => ({ path: chain_of(src.rows, r), row: r }));
		const total_expected = [{ path: [], row: src.total }];
		try {
			// A/B: plain group_by + sum of the six columns exactly as loaded
			const plain = await view_rows(table, { group_by: level_names, columns: MEASURES, aggregates: sum });
			out[`${name}: A plain sum -> parents`] = compare(parents, plain, MEASURES, "group_by + sum");
			out[`${name}: A plain sum -> Total`] = compare(total_expected, plain, MEASURES, "root row");
			out[`${name}: engine root row`] = pick(plain.get("[]"));

			// D: an expression is evaluated per input row BEFORE aggregation
			const expr = {
				cd_max: 'max("closing_debit" - "closing_credit", 0)',
				cc_max: 'max("closing_credit" - "closing_debit", 0)',
				od_max: 'max("opening_debit" - "opening_credit", 0)',
				oc_max: 'max("opening_credit" - "opening_debit", 0)',
			};
			const pre = await view_rows(table, { group_by: level_names, columns: Object.keys(expr), expressions: expr, aggregates: Object.fromEntries(Object.keys(expr).map((k) => [k, "sum"])) });
			const renamed = new Map([...pre].map(([k, v]) => [k, { closing_debit: v.cd_max, closing_credit: v.cc_max, opening_debit: v.od_max, opening_credit: v.oc_max }]));
			out[`${name}: D expression max(dr-cr,0) then sum -> net1 parents`] = compare(net1.rows.filter((r) => !r.__is_leaf).map((r) => ({ path: chain_of(net1.rows, r), row: r })), renamed, ["opening_debit", "opening_credit", "closing_debit", "closing_credit"], "pre-aggregation expression");

			// C (alternative i): signed net per row in the engine (expression), summed by the engine; the display layer only splits the sign
			const nexpr = { net_open: '"opening_debit" - "opening_credit"', net_close: '"closing_debit" - "closing_credit"' };
			const nets = await view_rows(table, { group_by: level_names, columns: ["net_open", "debit", "credit", "net_close"], expressions: nexpr, aggregates: { net_open: "sum", net_close: "sum", debit: "sum", credit: "sum" } });
			const split = new Map([...nets].map(([k, v]) => [k, {
				opening_debit: Math.max(v.net_open, 0), opening_credit: Math.max(-v.net_open, 0),
				debit: v.debit, credit: v.credit,
				closing_debit: Math.max(v.net_close, 0), closing_credit: Math.max(-v.net_close, 0),
			}]));
			const net1_parents = net1.rows.filter((r) => !r.__is_leaf).map((r) => ({ path: chain_of(net1.rows, r), row: r }));
			out[`${name}: C(i) engine net sum + sign split in display -> net1 parents`] = compare(net1_parents, split, MEASURES, "alternative i");
			// Total = sum over ROOT rows of the split values (the report sums root rows after netting each)
			const roots = [...split].filter(([k]) => JSON.parse(k).length === 1).map(([, v]) => v);
			const total_i = Object.fromEntries(MEASURES.map((m) => [m, roots.reduce((a, r) => a + r[m], 0)]));
			out[`${name}: C(i) Total (sum of root rows)`] = { engine: total_i, report_net1: pick(net1.total), match: MEASURES.every((m) => Math.abs(total_i[m] - net1.total[m]) <= EPS) };
			out[`${name}: C(i) engine root row of net columns`] = nets.get("[]");
			// leaves too: split(net) of a single leaf must equal the netted leaf in the net1 response
			const leaf_split = new Map(data.map((d) => [d.account, { od: Math.max(d.opening_debit - d.opening_credit, 0), oc: Math.max(d.opening_credit - d.opening_debit, 0), cd: Math.max(d.closing_debit - d.closing_credit, 0), cc: Math.max(d.closing_credit - d.closing_debit, 0) }]));
			out[`${name}: leaves split(net) == net1 leaves`] = net1.rows.filter((r) => r.__is_leaf).every((r) => { const s = leaf_split.get(r.account); return s && Math.abs(s.od - r.opening_debit) <= EPS && Math.abs(s.oc - r.opening_credit) <= EPS && Math.abs(s.cd - r.closing_debit) <= EPS && Math.abs(s.cc - r.closing_credit) <= EPS; });

			// "abs sum" aggregate on the signed net: |sum(net)| == debit side + credit side of the netted parent
			const abs = await view_rows(table, { group_by: level_names, columns: ["net_close"], expressions: { net_close: nexpr.net_close }, aggregates: { net_close: "abs sum" } });
			out[`${name}: aggregate 'abs sum' of net == parent dr+cr`] = net1_parents.every(({ path, row }) => Math.abs(abs.get(JSON.stringify(path)).net_close - (row.closing_debit + row.closing_credit)) <= EPS);

			// iii: second, pre-aggregated table. JS only ferries the engine's own aggregates into it; all arithmetic stays in the engine.
			const t2 = await client.table({ path: "string", depth: "integer", debit: "float", credit: "float", net_open: "float", net_close: "float" });
			try {
				await t2.update([...nets].map(([k, v]) => ({ path: k, depth: JSON.parse(k).length, debit: v.debit, credit: v.credit, net_open: v.net_open, net_close: v.net_close })));
				const e2 = {
					opening_debit: 'max("net_open", 0)', opening_credit: 'max(0 - "net_open", 0)',
					closing_debit: 'max("net_close", 0)', closing_credit: 'max(0 - "net_close", 0)',
				};
				const v2 = await t2.view({ columns: ["path", ...MEASURES], expressions: e2 });
				let iii;
				try {
					const c = await v2.to_columns();
					iii = new Map(c.path.map((p, i) => [p, Object.fromEntries(MEASURES.map((m) => [m, c[m][i]]))]));
				} finally {
					await v2.delete();
				}
				out[`${name}: iii second table -> net1 parents`] = compare(net1_parents, iii, MEASURES, "alternative iii");
				const v3 = await t2.view({ group_by: ["depth"], columns: MEASURES, expressions: e2, aggregates: sum, filter: [["depth", "==", 1]] });
				try {
					const c = await v3.to_columns();
					const tot = Object.fromEntries(MEASURES.map((m) => [m, c[m][0]]));
					out[`${name}: iii Total (engine, roots only)`] = { engine: tot, match: MEASURES.every((m) => Math.abs(tot[m] - net1.total[m]) <= EPS) };
				} finally {
					await v3.delete();
				}
			} finally {
				await t2.delete();
			}
		} finally {
			await table.delete();
		}
	}

	// ii: load every row exactly as the report returned it (parents included); no group_by at all
	{
		const rows = net1.rows;
		const depth = Math.max(...rows.map((r) => chain_of(rows, r).length));
		const schema = { rid: "integer", account: "string", depth: "integer", is_leaf: "boolean" };
		for (let i = 1; i < depth; i++) schema[`anc_${i}`] = "string";
		for (const m of MEASURES) schema[m] = "float";
		const table = await client.table(schema, { index: "rid" });
		try {
			await table.update(rows.map((r) => {
				const chain = chain_of(rows, r);
				const o = { rid: r.__rid, account: r.account, depth: chain.length, is_leaf: r.__is_leaf };
				for (let i = 1; i < depth; i++) o[`anc_${i}`] = i < chain.length ? chain[i - 1] : null; // ancestor at level i, excluding the row itself
				for (const m of MEASURES) o[m] = r[m];
				return o;
			}));
			const flat = await table.view({ sort: [["rid", "asc"]] });
			try {
				const c = await flat.to_columns();
				const map = new Map(c.account.map((a, i) => [a, Object.fromEntries(MEASURES.map((m) => [m, c[m][i]]))]));
				const res = { rows: rows.length, matched: 0 };
				for (const r of rows) if (MEASURES.every((m) => Math.abs(map.get(r.account)[m] - r[m]) <= EPS)) res.matched++;
				res.order_preserved = c.rid.every((v, i) => v === i);
				out["net1: ii rows as returned (parents + leaves), flat view"] = res;
			} finally {
				await flat.delete();
			}
			// collapse = engine filter on the ancestor columns
			const collapsed_l1 = rows.find((r) => r.__parent === null).account; // first root
			const second_level = rows.find((r) => r.__parent !== null && !r.__is_leaf && chain_of(rows, r).length === 2 && chain_of(rows, r)[0] !== collapsed_l1);
			const filt = [["anc_1", "not in", [collapsed_l1]]];
			if (second_level) filt.push(["anc_2", "not in", [second_level.account]]);
			const cv = await table.view({ sort: [["rid", "asc"]], filter: filt });
			try {
				const n = await cv.num_rows();
				const expect = rows.filter((r) => { const ch = chain_of(rows, r); return !(ch.length > 1 && ch[0] === collapsed_l1) && !(second_level && ch.length > 2 && ch[1] === second_level.account); }).length;
				out["net1: ii collapse through filter 'not in' on ancestor columns"] = { filter: filt, engine_rows: n, expected_rows: expect, ok: n === expect };
			} finally {
				await cv.delete();
			}
			// same with an expression-based visibility flag (null-safe alternative)
			const vis = `if ("anc_1" == '${collapsed_l1.replace(/'/g, "\\'")}') false else true`;
			try {
				const ev = await table.view({ sort: [["rid", "asc"]], expressions: { visible: vis }, filter: [["visible", "==", true]] });
				try {
					out["net1: ii collapse through boolean expression"] = { expression: vis, engine_rows: await ev.num_rows() };
				} finally {
					await ev.delete();
				}
			} catch (e) {
				out["net1: ii collapse through boolean expression"] = { expression: vis, error: String(e) };
			}
		} finally {
			await table.delete();
		}
	}
	return out;
}

const pick = (r) => (r ? Object.fromEntries(MEASURES.map((m) => [m, r[m]])) : null);

export default async function ({ client }) {
	const out = {};
	// can an expression reference an aggregate? (post-aggregation expression)
	const probe = await client.table({ g: "string", d: "float", c: "float" });
	try {
		const candidates = {
			agg_fn_sum: 'sum("d") - sum("c")',
			nested_max_of_columns: 'max("d" - "c", 0)',
			vector_sum: 'var v[2] := {"d", "c"}; sum(v)',
		};
		out.validate_expressions = await probe.validate_expressions(candidates);
	} catch (e) {
		out.validate_expressions = { error: String(e) };
	} finally {
		await probe.delete();
	}
	out.fy = await run_variant(client, "");
	out.mid = await run_variant(client, "_mid");
	return out;
}
