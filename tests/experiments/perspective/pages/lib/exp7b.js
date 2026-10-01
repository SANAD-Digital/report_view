// Experiment 7 (follow-ups): isolate the surprises found by exp7.js. Each probe runs on its own worker
// when it can kill the engine, so one failure does not hide the others.
import { fetch_fixture, build_facts, MEASURES } from "./tb.js";

export default async function ({ client, perspective }) {
	const out = {};
	const guarded = async (fn, ms = 8000) => {
		let timer;
		try {
			return await Promise.race([fn(), new Promise((_, rej) => (timer = setTimeout(() => rej(new Error(`TIMEOUT ${ms}ms: the call never settled`)), ms)))]);
		} catch (e) {
			return { ERROR: String(e).slice(0, 240) };
		} finally {
			clearTimeout(timer);
		}
	};
	const with_view = async (table, config, fn) => {
		const v = await table.view(config);
		try {
			return await fn(v);
		} finally {
			await v.delete();
		}
	};

	// ---- 1. filter_op ----
	{
		const t = await client.table({ id: "integer", grp: "string", currency: "string", amount: "float" });
		await t.update([{ id: 1, grp: "A", currency: "YER", amount: 1 }, { id: 2, grp: "A", currency: "USD", amount: 2 }, { id: 3, grp: "B", currency: "YER", amount: 3 }, { id: 4, grp: "C", currency: "EUR", amount: 4 }]);
		const ids = (cfg) => guarded(() => with_view(t, cfg, async (v) => ({ ids: (await v.to_columns()).id, config_echo: (await v.get_config()).filter_op })));
		out.filter_op = {
			"and (default)": await ids({ filter: [["grp", "==", "A"], ["currency", "==", "YER"]] }),
			"filter_op:'and'": await ids({ filter: [["grp", "==", "A"], ["currency", "==", "YER"]], filter_op: "and" }),
			"filter_op:'or' grp==B or currency==USD (expect 2,3)": await ids({ filter: [["grp", "==", "B"], ["currency", "==", "USD"]], filter_op: "or" }),
			"filter_op:'or' amount>3 or amount<2 (expect 1,4)": await ids({ filter: [["amount", ">", 3], ["amount", "<", 2]], filter_op: "or" }),
			"filter_op:'or' single term grp==B (expect 3)": await ids({ filter: [["grp", "==", "B"]], filter_op: "or" }),
			"or through 'in' on one column (expect 2,3,4)": await ids({ filter: [["grp", "in", ["B", "C"]]] , expressions: {} }),
			"or through boolean expression (expect 2,3)": await ids({ expressions: { keep: '("grp" == \'B\') or ("currency" == \'USD\')' }, filter: [["keep", "==", true]] }),
		};
		await t.delete();
	}

	// ---- 2. expression syntax ----
	{
		const t = await client.table({ amount: "float", name: "string", other: "string" });
		await t.update([{ amount: 5, name: "نقد", other: "نقد" }, { amount: -2, name: "مدينون", other: "نقد" }, { amount: null, name: "cash", other: "x" }]);
		const ev = (e) => guarded(() => with_view(t, { columns: ["e"], expressions: { e } }, async (v) => (await v.to_columns()).e));
		out.expressions = {
			"if (c, a, b)": await ev('if ("amount" > 0, "amount", 0)'),
			"c ? a : b": await ev('"amount" > 0 ? "amount" : 0'),
			"if (c) a; else b;": await ev('if ("amount" > 0) "amount"; else 0;'),
			"if (c) {a} else {b}": await ev('if ("amount" > 0) {"amount"} else {0}'),
			"max(x, 0)": await ev('max("amount", 0)'),
			"null arithmetic (amount + 1)": await ev('"amount" + 1'),
			"is_null -> 0": await ev('is_null("amount") ? 0 : "amount"'),
			"compare two string columns (Arabic values)": await ev('"name" == "other"'),
			"ASCII literal": await ev("\"name\" == 'cash'"),
			"Arabic literal": await ev("\"name\" == 'نقد'"),
			"Latin-1 literal 'é'": await ev("\"name\" == 'é'"),
			"escaped literal '\\u0646'": await ev("\"name\" == '\\u0646\\u0642\\u062f'"),
			"length of Arabic string (bytes or chars?)": await ev('length("name")'),
			"concat Arabic column + ASCII": await ev("concat(\"name\", ' / ', \"other\")"),
			"and / or keywords": await ev('("amount" > 0) and ("amount" < 10)'),
			"integer division / rounding": await ev('round("amount" / 3)'),
		};
		await t.delete();
	}

	// ---- 3. coercion on load, one value at a time (a failed update aborts the whole batch) ----
	{
		const probe = async (type, value) => {
			const t = await client.table({ k: "integer", v: type });
			try {
				const r = await guarded(async () => {
					await t.update([{ k: 1, v: value }]);
					return await with_view(t, {}, async (v) => (await v.to_columns()).v[0]);
				});
				return r;
			} finally {
				await guarded(() => t.delete());
			}
		};
		const cases = {
			float: ["12.50", "", "abc", null, "1,234.5", 1e20, "١٢"],
			integer: ["7", 2.9, "", 2147483647, 2147483648, 3000000000, -1, null],
			date: ["2026-01-05", "2026-01-05 10:20:30", "05-01-2026", "", null, 1767571200000, "2026-13-45"],
			datetime: ["2026-01-05 10:20:30", "2026-01-05 10:20:30.123456", "2026-01-05T10:20:30", "2026-01-05T10:20:30+03:00", "2026-01-05", "", null, 1767608430000],
			string: [123, 1.5, true, null, "", "نص عربي"],
			boolean: [1, 0, "true", "false", "Yes", "", null, true],
		};
		out.coercion = {};
		for (const [type, values] of Object.entries(cases)) {
			out.coercion[type] = {};
			for (const v of values) out.coercion[type][JSON.stringify(v)] = await probe(type, v);
		}
		// does one bad value abort the whole batch?
		const t = await client.table({ k: "integer", d: "date" });
		out.bad_value_in_batch = await guarded(async () => {
			let err = null;
			try {
				await t.update([{ k: 1, d: "2026-01-05" }, { k: 2, d: "not a date" }, { k: 3, d: "2026-01-07" }]);
			} catch (e) {
				err = String(e).slice(0, 120);
			}
			return { error: err, rows_loaded: await t.size() };
		});
		await guarded(() => t.delete());
	}

	// ---- 4. tree order + ragged levels on the real Trial Balance ----
	{
		const fx = await fetch_fixture();
		const rows = fx.expected.rows;
		const { schema, data, level_names } = build_facts(rows);
		const t = await client.table(schema);
		await t.update(data);
		const report_order = rows.filter((r) => r.__kind === "data").map((r) => r.account);
		const label = (p) => p[p.length - 1];
		out.tree = await guarded(async () => {
			const r = {};
			// default order of group nodes
			r.default_order_equals_report = await with_view(t, { group_by: [...level_names, "account"], columns: ["debit"], aggregates: { debit: "sum" } }, async (v) => {
				const paths = (await v.to_columns()).__ROW_PATH__.filter((p) => p.length && label(p) !== null).map(label);
				return { equal: JSON.stringify(paths) === JSON.stringify(report_order), engine_first_6: paths.slice(0, 6), report_first_6: report_order.slice(0, 6) };
			});
			// order by the report's own row order: aggregate min(rid), sort ascending
			r.sorted_by_min_rid_equals_report = await with_view(t, { group_by: [...level_names, "account"], columns: ["debit", "rid"], aggregates: { debit: "sum", rid: "min" }, sort: [["rid", "asc"]] }, async (v) => {
				const paths = (await v.to_columns()).__ROW_PATH__.filter((p) => p.length && label(p) !== null).map(label);
				return { equal: JSON.stringify(paths) === JSON.stringify(report_order), engine: paths.slice(0, 8) };
			});
			// ragged levels: hide the null pass-through nodes by collapsing their parent
			r.ragged = await with_view(t, { group_by: [...level_names, "account"], columns: ["debit", "rid"], aggregates: { debit: "sum", rid: "min" }, sort: [["rid", "asc"]] }, async (v) => {
				const before = (await v.to_columns()).__ROW_PATH__;
				const null_nodes = before.filter((p) => p.length && p[p.length - 1] === null).length;
				// option A: skip rows in the data model (needs an index map) -> count only
				const visible_if_skipped = before.filter((p) => !p.includes(null) || label(p) !== null).length;
				return { rows_before: before.length, null_pass_through_nodes: null_nodes, sample: before.filter((p) => p.includes(null)).slice(0, 4) };
			});
			// option B: fill missing levels so that no null exists: repeat the leaf at its own level and use '' below?
			return r;
		});
		// option: leaf promoted into the level columns (level_k = leaf, deeper = null), group_by levels only
		out.tree_leaf_in_levels = await guarded(async () => {
			const by_id = new Map(rows.map((r) => [r.__rid, r]));
			const leaves = rows.filter((r) => r.__kind === "data" && r.__is_leaf);
			let depth = 0;
			const chains = leaves.map((leaf) => { const c = [leaf.account]; for (let p = by_id.get(leaf.__parent); p; p = by_id.get(p.__parent)) c.unshift(p.account); depth = Math.max(depth, c.length); return { leaf, c }; });
			const sch = { rid: "integer", debit: "float" };
			for (let i = 1; i <= depth; i++) sch[`lv_${i}`] = "string";
			const t2 = await client.table(sch);
			try {
				await t2.update(chains.map(({ leaf, c }) => { const o = { rid: leaf.__rid, debit: leaf.debit }; for (let i = 1; i <= depth; i++) o[`lv_${i}`] = c[i - 1] === undefined ? null : c[i - 1]; return o; }));
				return await with_view(t2, { group_by: Array.from({ length: depth }, (_, i) => `lv_${i + 1}`), columns: ["debit", "rid"], aggregates: { debit: "sum", rid: "min" }, sort: [["rid", "asc"]] }, async (v) => {
					const paths = (await v.to_columns()).__ROW_PATH__;
					const real = paths.filter((p) => p.length && label(p) !== null).map(label);
					return { depth, rows: paths.length, null_rows: paths.filter((p) => p.length && label(p) === null).length, order_equals_report: JSON.stringify(real) === JSON.stringify(report_order), null_rows_are_always_last_child_of_a_leaf: paths.filter((p) => p.length && label(p) === null).every((p) => leaves.some((l) => l.account === p[p.length - 2])) };
				});
			} finally {
				await t2.delete();
			}
		});
		await t.delete();
	}

	// ---- 5. deleting a table that still has a view (own worker: this can kill the engine) ----
	{
		const c2 = await perspective.worker();
		const t = await c2.table({ a: "integer" });
		const v = await t.view();
		const r = {};
		r.table_delete_with_open_view = await guarded(async () => { await t.delete(); return "resolved"; }, 4000);
		r.engine_alive_after = await guarded(async () => { const x = await c2.table({ b: "integer" }); const n = await x.size(); await x.delete(); return `yes (new table size ${n})`; }, 4000);
		r.view_usable_after = await guarded(async () => await v.num_rows(), 4000);
		r.view_delete_after = await guarded(async () => { await v.delete(); return "resolved"; }, 4000);
		r.table_delete_retry = await guarded(async () => { await t.delete(); return "resolved"; }, 4000);
		r.hosted_tables = await guarded(async () => await c2.get_hosted_table_names(), 4000);
		out.delete_order = r;
		const c3 = await perspective.worker();
		const t3 = await c3.table({ a: "integer" });
		const v3 = await t3.view();
		const r3 = {};
		r3.lazy_delete = await guarded(async () => { await t3.delete({ lazy: true }); return "resolved"; }, 4000);
		r3.tables_while_view_open = await guarded(async () => await c3.get_hosted_table_names(), 4000);
		r3.view_delete = await guarded(async () => { await v3.delete(); return "resolved"; }, 4000);
		r3.tables_after_view_delete = await guarded(async () => await c3.get_hosted_table_names(), 4000);
		out.delete_order_lazy = r3;
		// double delete
		const c4 = await perspective.worker();
		const t4 = await c4.table({ a: "integer" });
		const v4 = await t4.view();
		const r4 = {};
		r4.first = await guarded(async () => { await v4.delete(); return "resolved"; }, 4000);
		r4.second_delete_same_view = await guarded(async () => { await v4.delete(); return "resolved"; }, 4000);
		r4.use_after_delete = await guarded(async () => await v4.num_rows(), 4000);
		r4.engine_alive = await guarded(async () => await t4.size(), 4000);
		await guarded(() => t4.delete(), 4000);
		out.double_delete = r4;
	}
	return out;
}
