// Experiment 7: the engine functions the UI needs. Every check records what the engine actually returned.
export default async function ({ client, perspective }) {
	const out = { engine_restarts: [] };
	let table = null;
	let n_attempt = 0;
	// A call that never settles means the engine (worker) died; record it, start a new worker and reload the base table.
	const attempt = async (fn) => {
		const label = `#${++n_attempt} ${fn.toString().replace(/\s+/g, " ").slice(0, 110)}`;
		console.log("STAGE " + label);
		let timer;
		try {
			return await Promise.race([
				fn(),
				new Promise((_, reject) => (timer = setTimeout(() => reject(new Error("TIMEOUT 8s: the call never settled")), 8000))),
			]);
		} catch (e) {
			const msg = String(e).slice(0, 220);
			if (/TIMEOUT/.test(msg)) {
				out.engine_restarts.push(label);
				client = await perspective.worker();
				table = await client.table(schema, { index: "id" });
				await table.update(rows);
			}
			return { ERROR: msg };
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

	// ---------- base table ----------
	const COL_AR = "اسم الحساب";
	const COL_AR2 = "المستودع - الرئيسي";
	const schema = { id: "integer", grp: "string", sub: "string", [COL_AR]: "string", [COL_AR2]: "string", currency: "string", amount: "float", qty: "integer", posted: "date", ts: "datetime", flag: "boolean" };
	const rows = [
		{ id: 1, grp: "A", sub: "x", [COL_AR]: "نقد", [COL_AR2]: "مخزن صنعاء - 1", currency: "YER", amount: 10.5, qty: 1, posted: "2026-01-15", ts: "2026-01-15 10:00:00", flag: true },
		{ id: 2, grp: "A", sub: "x", [COL_AR]: "نقد", [COL_AR2]: "مخزن صنعاء - 1", currency: "YER", amount: null, qty: 2, posted: "2026-02-01", ts: "2026-02-01 08:30:00", flag: false },
		{ id: 3, grp: "A", sub: "y", [COL_AR]: "مدينون", [COL_AR2]: "مخزن عدن - 2", currency: "USD", amount: 4.5, qty: null, posted: "2026-03-10", ts: null, flag: true },
		{ id: 4, grp: "B", sub: "y", [COL_AR]: "دائنون", [COL_AR2]: "مخزن عدن - 2", currency: "YER", amount: -3, qty: 4, posted: null, ts: "2026-03-10 23:59:59", flag: null },
		{ id: 5, grp: "B", sub: "z", [COL_AR]: null, [COL_AR2]: "مخزن صنعاء - 1", currency: "YER", amount: 0.1, qty: 5, posted: "2026-12-31", ts: "2026-12-31 00:00:00", flag: false },
		{ id: 6, grp: null, sub: "z", [COL_AR]: "مبيعات", [COL_AR2]: null, currency: null, amount: 0.2, qty: 6, posted: "2026-06-30", ts: "2026-06-30 12:00:00", flag: true },
	];
	table = await client.table(schema, { index: "id" });
	await table.update(rows);
	out.schema_returned = await table.schema();
	out.columns_returned = await table.columns();
	out.size = await table.size();

	// ---------- 1. aggregates ----------
	const numeric_aggs = ["sum", "sum abs", "abs sum", "sum not null", "avg", "mean", "median", "q1", "q3", "count", "distinct count", "unique", "dominant", "min", "max", "low", "high", "first", "last", "first by index", "last by index", "last minus first", "high minus low", "any", "stddev", "var", "pct sum parent", "pct sum grand total", "join", "distinct leaf", "and", "or"];
	out.aggregates_numeric = {};
	for (const a of numeric_aggs) {
		out.aggregates_numeric[a] = await attempt(() => with_view(table, { group_by: ["grp"], columns: ["amount"], aggregates: { amount: a } }, async (v) => {
			const c = await v.to_columns();
			return { total: c.amount[0], by_group: Object.fromEntries(c.__ROW_PATH__.slice(1).map((p, i) => [String(p[0]), c.amount[i + 1]])), type: (await v.schema()).amount };
		}));
	}
	out.aggregates_string = {};
	for (const a of ["count", "distinct count", "unique", "dominant", "first", "last", "any", "join", "distinct leaf", "min", "max", "sum"]) {
		out.aggregates_string[a] = await attempt(() => with_view(table, { group_by: ["grp"], columns: ["currency"], aggregates: { currency: a } }, async (v) => {
			const c = await v.to_columns();
			return { total: c.currency[0], by_group: Object.fromEntries(c.__ROW_PATH__.slice(1).map((p, i) => [String(p[0]), c.currency[i + 1]])), type: (await v.schema()).currency };
		}));
	}
	out.aggregate_weighted_mean = await attempt(() => with_view(table, { group_by: ["grp"], columns: ["amount"], aggregates: { amount: ["weighted mean", ["qty"]] } }, async (v) => (await v.to_columns()).amount));
	out.aggregate_default_when_omitted = await attempt(() => with_view(table, { group_by: ["grp"], columns: ["amount", "currency", "posted", "flag"] }, async (v) => ({ cfg: (await v.get_config()).aggregates, row0: (await v.to_json({ start_row: 0, end_row: 1 }))[0], schema: await v.schema() })));

	// ---------- 5. null behaviour ----------
	out.null_behaviour = await attempt(() => with_view(table, { group_by: ["grp"], columns: ["amount", "qty"], aggregates: { amount: "sum", qty: "avg" } }, async (v) => {
		const c = await v.to_columns();
		return { paths: c.__ROW_PATH__, amount_sum: c.amount, qty_avg: c.qty, note: "group A has amount [10.5, null, 4.5]; qty [1, 2, null]" };
	}));
	out.null_count_vs_rows = await attempt(() => with_view(table, { group_by: ["grp"], columns: ["amount", "id"], aggregates: { amount: "count", id: "count" } }, async (v) => await v.to_columns()));
	out.float_precision = await attempt(() => with_view(table, { group_by: ["sub"], columns: ["amount"], aggregates: { amount: "sum" }, filter: [["sub", "==", "z"]] }, async (v) => ({ sum_0_1_plus_0_2: (await v.to_columns()).amount[0] })));

	// ---------- 2. unique values with counts ----------
	out.unique_values = await attempt(() => with_view(table, { group_by: [COL_AR], columns: ["id"], aggregates: { id: "count" }, sort: [["id", "desc"]] }, async (v) => {
		const c = await v.to_columns({ start_row: 1 });
		return c.__ROW_PATH__.map((p, i) => [p[0], c.id[i]]);
	}));
	out.unique_values_with_other_filters = await attempt(() => with_view(table, { group_by: ["currency"], columns: ["id"], aggregates: { id: "count" }, filter: [["grp", "==", "A"]] }, async (v) => {
		const c = await v.to_columns({ start_row: 1 });
		return c.__ROW_PATH__.map((p, i) => [p[0], c.id[i]]);
	}));

	// ---------- 3. windows ----------
	out.windows = await attempt(() => with_view(table, { sort: [["id", "asc"]] }, async (v) => ({
		num_rows: await v.num_rows(),
		num_columns: await v.num_columns(),
		column_paths: await v.column_paths(),
		column_paths_window: await v.column_paths({ start_col: 1, end_col: 3 }),
		to_columns_rows_1_3_cols_0_2: await v.to_columns({ start_row: 1, end_row: 3, start_col: 0, end_col: 2 }),
		to_json_rows_4_6_cols_5_8: await v.to_json({ start_row: 4, end_row: 6, start_col: 5, end_col: 8 }),
		to_columns_with_index: await v.to_columns({ start_row: 0, end_row: 2, start_col: 0, end_col: 1, index: true }),
		to_columns_with_id: await v.to_columns({ start_row: 0, end_row: 2, start_col: 0, end_col: 1, id: true }),
		past_end: await v.to_columns({ start_row: 100, end_row: 120, start_col: 0, end_col: 1 }),
		date_and_datetime_representation: await v.to_columns({ start_row: 0, end_row: 1, start_col: 8, end_col: 10 }),
		to_csv_first_2: await v.to_csv({ start_row: 0, end_row: 2, start_col: 0, end_col: 4 }),
		dimensions: await v.dimensions(),
		min_max_amount: await v.get_min_max("amount"),
	})));
	out.windows_grouped = await attempt(() => with_view(table, { group_by: ["grp", "sub"], columns: ["amount", "qty"], aggregates: { amount: "sum", qty: "sum" } }, async (v) => ({
		num_rows: await v.num_rows(),
		rows_2_4_col_1: await v.to_columns({ start_row: 2, end_row: 4, start_col: 1, end_col: 2 }),
		leaves_only: (await v.to_columns({ leaves_only: true })).__ROW_PATH__,
		to_json_row: (await v.to_json({ start_row: 1, end_row: 2 }))[0],
	})));

	// ---------- 4. expand / collapse / set_depth ----------
	out.expand_collapse = await attempt(() => with_view(table, { group_by: ["grp", "sub"], columns: ["amount"], aggregates: { amount: "sum" } }, async (v) => {
		const steps = {};
		const paths = async () => (await v.to_columns()).__ROW_PATH__.map((p) => p.join("/") || "(root)");
		steps.initial = { num_rows: await v.num_rows(), paths: await paths() };
		await v.set_depth(0);
		steps.set_depth_0 = { num_rows: await v.num_rows(), paths: await paths() };
		await v.set_depth(1);
		steps.set_depth_1 = { num_rows: await v.num_rows(), paths: await paths() };
		steps.expand_row_1_returns = await v.expand(1);
		steps.after_expand_1 = { num_rows: await v.num_rows(), paths: await paths() };
		steps.collapse_row_1_returns = await v.collapse(1);
		steps.after_collapse_1 = { num_rows: await v.num_rows(), paths: await paths() };
		await v.set_depth(2);
		steps.set_depth_2 = { num_rows: await v.num_rows() };
		steps.collapse_root_returns = await v.collapse(0);
		steps.after_collapse_root = { num_rows: await v.num_rows(), paths: await paths() };
		return steps;
	}));
	out.group_by_depth_config = await attempt(() => with_view(table, { group_by: ["grp", "sub"], columns: ["amount"], aggregates: { amount: "sum" }, group_by_depth: 1 }, async (v) => ({ num_rows: await v.num_rows(), paths: (await v.to_columns()).__ROW_PATH__ })));

	// ---------- 6. non-ASCII column names ----------
	const N = {};
	N.group_by = await attempt(() => with_view(table, { group_by: [COL_AR2], columns: ["amount"], aggregates: { amount: "sum" } }, async (v) => await v.to_columns()));
	N.columns_select = await attempt(() => with_view(table, { columns: [COL_AR, COL_AR2] }, async (v) => await v.to_json({ start_row: 0, end_row: 1 })));
	N.filter_eq = await attempt(() => with_view(table, { filter: [[COL_AR, "==", "نقد"]] }, async (v) => await v.num_rows()));
	N.filter_contains = await attempt(() => with_view(table, { filter: [[COL_AR2, "contains", "صنعاء"]] }, async (v) => await v.num_rows()));
	N.filter_in = await attempt(() => with_view(table, { filter: [[COL_AR, "in", ["نقد", "مبيعات"]]] }, async (v) => await v.num_rows()));
	N.sort = await attempt(() => with_view(table, { columns: [COL_AR], sort: [[COL_AR, "asc"]] }, async (v) => (await v.to_columns())[COL_AR]));
	N.split_by = await attempt(() => with_view(table, { group_by: ["grp"], split_by: [COL_AR2], columns: ["amount"], aggregates: { amount: "sum" } }, async (v) => await v.column_paths()));
	N.expression_column_ref = await attempt(() => with_view(table, { columns: ["len"], expressions: { len: `length("${COL_AR2}")` } }, async (v) => (await v.to_columns()).len));
	N.expression_arabic_alias = await attempt(() => with_view(table, { columns: ["الصافي - محسوب"], expressions: { "الصافي - محسوب": '"amount" * 2' } }, async (v) => await v.to_columns()));
	N.expression_arabic_string_literal = await attempt(() => with_view(table, { columns: ["is_cash"], expressions: { is_cash: `"${COL_AR}" == 'نقد'` } }, async (v) => (await v.to_columns()).is_cash));
	N.expression_ascii_string_literal = await attempt(() => with_view(table, { columns: ["is_yer"], expressions: { is_yer: `"currency" == 'YER'` } }, async (v) => (await v.to_columns()).is_yer));
	N.validate_expressions = await attempt(() => table.validate_expressions({ a: `"${COL_AR}" == 'نقد'`, b: `"${COL_AR2}"`, c: `concat("${COL_AR}", ' - ', "currency")`, d: `upper("currency")` }));
	N.expression_concat = await attempt(() => with_view(table, { columns: ["c"], expressions: { c: `concat("${COL_AR}", ' - ', "currency")` } }, async (v) => (await v.to_columns()).c));
	// names containing characters that are special somewhere: pipe (split_by path separator), quotes
	N.special_names = await attempt(async () => {
		const t = await client.table({ 'a|b': "string", 'q"uote': "float", "it's": "float", g: "string" });
		try {
			await t.update([{ "a|b": "x|y", 'q"uote': 1, "it's": 2, g: "g1" }, { "a|b": "z", 'q"uote': 3, "it's": 4, g: "g1" }]);
			const r = {};
			r.split_paths_with_pipe_in_value = await attempt(() => with_view(t, { group_by: ["g"], split_by: ["a|b"], columns: ['q"uote'], aggregates: { 'q"uote': "sum" } }, async (v) => await v.column_paths()));
			r.expr_double_quote_in_name = await attempt(() => with_view(t, { columns: ["e"], expressions: { e: '"q"uote" + 1' } }, async (v) => (await v.to_columns()).e));
			r.expr_single_quote_in_name = await attempt(() => with_view(t, { columns: ["e"], expressions: { e: `"it's" + 1` } }, async (v) => (await v.to_columns()).e));
			r.filter_on_pipe_name = await attempt(() => with_view(t, { filter: [["a|b", "==", "x|y"]] }, async (v) => await v.num_rows()));
			return r;
		} finally {
			await t.delete();
		}
	});
	out.non_ascii = N;

	// expression semantics: "sum(...)" inside an expression is a per-row vararg function, not an aggregate
	out.expression_sum_is_per_row = await attempt(() => with_view(table, { columns: ["e"], expressions: { e: 'sum("amount", "qty")' } }, async (v) => (await v.to_columns()).e));
	out.expression_functions = await attempt(() => table.validate_expressions({
		if_else: 'if ("amount" > 0) "amount" else 0',
		max0: 'max("amount", 0)',
		abs: 'abs("amount")',
		bucket_month: `bucket("posted", 'M')`,
		year: `bucket("posted", 'Y')`,
		month_of_year: 'month_of_year("posted")',
		day_of_week: 'day_of_week("posted")',
		is_null: 'is_null("amount")',
		to_string: 'string("qty")',
		round: 'round("amount")',
		contains: `contains("currency", 'YE')`,
		pct: 'percent_of("amount", "qty")',
		coalesce_like: 'if (is_null("amount")) 0 else "amount"',
	}));

	// ---------- 7. Arabic ordering ----------
	const words = ["ياسر", "أحمد", "إبراهيم", "آدم", "ابتسام", "اسامة", "بكر", "ثامر", "تامر", "هند", "وليد", "ة", "ه", "ى", "ي", "ؤ", "ئ", "ء", "مُحمد", "محمد", "محمود", "١٠ بند", "٢ بند", "10 item", "2 item", "Zed", "apple", "Apple", "عبد الله", "عبدالله", "ـتطويل", "لا", "گچپژ"];
	const t_ar = await client.table({ w: "string", n: "integer" });
	try {
		await t_ar.update(words.map((w, n) => ({ w, n })));
		const engine_sort = await with_view(t_ar, { columns: ["w"], sort: [["w", "asc"]] }, async (v) => (await v.to_columns()).w);
		const engine_group = await with_view(t_ar, { group_by: ["w"], columns: ["n"], aggregates: { n: "count" } }, async (v) => (await v.to_columns({ start_row: 1 })).__ROW_PATH__.map((p) => p[0]));
		const collator = words.slice().sort(new Intl.Collator("ar").compare);
		const code_point = words.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); // UTF-16 code unit order
		const utf8 = words.slice().sort((a, b) => { const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b); for (let i = 0; i < Math.min(ea.length, eb.length); i++) if (ea[i] !== eb[i]) return ea[i] - eb[i]; return ea.length - eb.length; });
		const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
		out.arabic_order = {
			engine_sort, engine_group_by_default_order: engine_group, intl_collator_ar: collator, code_unit_order: code_point,
			sort_equals_collator: same(engine_sort, collator), sort_equals_code_unit: same(engine_sort, code_point), sort_equals_utf8_bytes: same(engine_sort, utf8),
			group_by_equals_sort: same(engine_group, engine_sort), group_by_equals_insertion: same(engine_group, words),
			first_difference_vs_collator: (() => { const i = engine_sort.findIndex((x, j) => x !== collator[j]); return i < 0 ? null : { index: i, engine: engine_sort[i], collator: collator[i] }; })(),
		};
		// workaround: sort key column generated by the adapter with Intl.Collator, sort/group ordered by it
		const rank = new Map(collator.map((w, i) => [w, i]));
		const t_key = await client.table({ w: "string", w_key: "integer" });
		try {
			await t_key.update(words.map((w) => ({ w, w_key: rank.get(w) })));
			const by_key = await with_view(t_key, { columns: ["w"], sort: [["w_key", "asc"]] }, async (v) => (await v.to_columns()).w);
			const grp_by_key = await with_view(t_key, { group_by: ["w"], columns: ["w_key"], aggregates: { w_key: "min" }, sort: [["w_key", "asc"]] }, async (v) => (await v.to_columns({ start_row: 1 })).__ROW_PATH__.map((p) => p[0]));
			out.arabic_order.sort_key_workaround = { flat_sorted_by_hidden_key_equals_collator: same(by_key, collator), group_by_sorted_by_key_equals_collator: same(grp_by_key, collator) };
		} finally {
			await t_key.delete();
		}
	} finally {
		await t_ar.delete();
	}

	// ---------- 8. filters ----------
	const F = {};
	const count = (filter, extra = {}) => attempt(() => with_view(table, Object.assign({ filter }, extra), async (v) => await v.num_rows()));
	F["in [A]"] = await count([["grp", "in", ["A"]]]);
	F["not in [A] (null grp row?)"] = await count([["grp", "not in", ["A"]]]);
	F["contains 'عدن'"] = await count([[COL_AR2, "contains", "عدن"]]);
	F["begins with 'مخزن'"] = await count([[COL_AR2, "begins with", "مخزن"]]);
	F["ends with '1'"] = await count([[COL_AR2, "ends with", "1"]]);
	F["== 'YER'"] = await count([["currency", "==", "YER"]]);
	F["!= 'YER' (null currency row?)"] = await count([["currency", "!=", "YER"]]);
	F["range amount >= 0.1 and <= 5"] = await count([["amount", ">=", 0.1], ["amount", "<=", 5]]);
	F["amount > 0 (null amount row?)"] = await count([["amount", ">", 0]]);
	F["amount < 100 (null amount row?)"] = await count([["amount", "<", 100]]);
	F["is null amount"] = await count([["amount", "is null", null]]);
	F["is not null amount"] = await count([["amount", "is not null", null]]);
	F["date >= '2026-02-01' and <= '2026-06-30'"] = await count([["posted", ">=", "2026-02-01"], ["posted", "<=", "2026-06-30"]]);
	F["date == '2026-03-10'"] = await count([["posted", "==", "2026-03-10"]]);
	F["date > '2026-06-30'"] = await count([["posted", ">", "2026-06-30"]]);
	F["datetime >= '2026-03-10 00:00:00'"] = await count([["ts", ">=", "2026-03-10 00:00:00"]]);
	F["datetime < '2026-03-11'"] = await count([["ts", "<", "2026-03-11"]]);
	F["boolean == true"] = await count([["flag", "==", true]]);
	F["filter_op or: grp==B or currency==USD"] = await count([["grp", "==", "B"], ["currency", "==", "USD"]], { filter_op: "or" });
	F["between (operator exists?)"] = await count([["amount", "between", [0, 5]]]);
	F["case-insensitive contains 'yer'"] = await count([["currency", "contains", "yer"]]);
	F["filter on grouped view keeps group totals consistent"] = await attempt(() => with_view(table, { group_by: ["grp"], columns: ["amount"], aggregates: { amount: "sum" }, filter: [["currency", "==", "YER"]] }, async (v) => await v.to_columns()));
	out.filters = F;

	// ---------- 9. total column with split_by ----------
	out.split_by_total = await attempt(() => with_view(table, { group_by: ["grp"], split_by: ["currency"], columns: ["amount", "qty"], aggregates: { amount: "sum", qty: "sum" } }, async (v) => {
		const paths = await v.column_paths();
		const c = await v.to_columns();
		return { column_paths: paths, has_total_column: paths.some((p) => /total/i.test(p) || p === "amount"), data: c, num_columns: await v.num_columns() };
	}));
	out.split_by_total_second_view = await attempt(() => with_view(table, { group_by: ["grp"], columns: ["amount", "qty"], aggregates: { amount: "sum", qty: "sum" } }, async (v) => await v.to_columns()));
	out.split_by_column_sort = await attempt(() => with_view(table, { group_by: ["grp"], split_by: ["currency"], columns: ["amount"], aggregates: { amount: "sum" }, sort: [["amount", "col desc"]] }, async (v) => await v.column_paths()));
	out.split_by_only_no_group = await attempt(() => with_view(table, { split_by: ["currency"], columns: ["amount"] }, async (v) => ({ paths: await v.column_paths(), rows: await v.num_rows() })));

	// ---------- 11. mixed currencies ----------
	out.mixed_currency = await attempt(() => with_view(table, { group_by: ["grp"], columns: ["amount", "currency", "cur_n"], expressions: { cur_n: '"currency"' }, aggregates: { amount: "sum", currency: "unique", cur_n: "distinct count" } }, async (v) => await v.to_columns()));

	// ---------- 10. update / replace / remove ----------
	out.update_replace = await attempt(async () => {
		const r = {};
		const v = await table.view({ group_by: ["grp"], columns: ["amount"], aggregates: { amount: "sum" } });
		let updates = 0;
		const sub = await v.on_update(() => updates++);
		try {
			r.before = (await v.to_columns()).amount;
			await table.update([{ id: 1, amount: 100 }]); // partial update by index
			r.after_partial_update_id_1 = (await v.to_columns()).amount;
			r.size_after_update = await table.size();
			await table.update([{ id: 7, grp: "C", amount: 7 }]);
			r.after_insert_id_7 = { size: await table.size(), paths: (await v.to_columns()).__ROW_PATH__ };
			await table.remove([7]);
			r.after_remove_7 = await table.size();
			await table.replace([{ id: 1, grp: "Z", amount: 1 }, { id: 2, grp: "Z", amount: 2 }]);
			r.after_replace = { size: await table.size(), view: await v.to_columns(), view_still_alive: true };
			await new Promise((res) => setTimeout(res, 50));
			r.on_update_calls = updates;
			await table.replace(rows);
			r.restored_size = await table.size();
			await table.clear();
			r.after_clear = { size: await table.size(), view_rows: await v.num_rows() };
			await table.update(rows);
		} finally {
			await v.remove_update(sub);
			await v.delete();
		}
		return r;
	});
	out.replace_with_different_columns = await attempt(async () => {
		await table.replace([{ id: 1, unknown_col: 5 }]);
		const s = await table.size();
		await table.replace(rows);
		return { size_after_replace_with_unknown_column: s };
	});
	out.delete_table_with_live_view = await attempt(async () => {
		const t = await client.table({ a: "integer" });
		const v = await t.view();
		let err = null;
		try {
			await t.delete();
		} catch (e) {
			err = String(e).slice(0, 160);
		}
		await v.delete();
		if (err) await t.delete();
		return { error_when_view_still_open: err };
	});
	out.schema_type_coercion = await attempt(async () => {
		const t = await client.table({ n: "float", i: "integer", d: "date", s: "string", b: "boolean" });
		try {
			await t.update([{ n: "12.50", i: "7", d: "2026-01-05", s: 123, b: 1 }, { n: "", i: 2.9, d: "05-01-2026", s: null, b: "true" }, { n: "abc", i: null, d: "", s: "", b: 0 }]);
			return await with_view(t, {}, async (v) => await v.to_columns());
		} finally {
			await t.delete();
		}
	});
	out.inferred_types_without_schema = await attempt(async () => {
		const t = await client.table([{ code: "0012", amount: "15", d: "2026-01-05", mixed: 1 }, { code: "0100", amount: "x", d: "n/a", mixed: "a" }]);
		try {
			return await t.schema();
		} finally {
			await t.delete();
		}
	});

	await table.delete();
	out.hosted_tables_left = await client.get_hosted_table_names();
	return out;
}
