// Pivot (analysis) mode (docs/architecture.md §7.1 `pivot`, §8أ.2, §11.1 #67-#68; phase 5b
// tasks 2, 3 and 5). Pure module: no frappe, no DOM, no Perspective.
//
// One pivot is two views of the facts, under the same browser filters as the grid:
// - the pivot view: group_by = pivot.rows, split_by = pivot.cols, the values aggregated;
//   its row 0 is the total of every split column;
// - the totals view: the same group_by and sort without split_by: the total column of every
//   row, its count of facts and its currency (row 0 = the grand total).
// Both have the same rows in the same order (same group_by, same sort), so row i of one is
// row i of the other. Nothing is added up outside Perspective.

import { RID, KIND, SORT_PREFIX, perspective_type } from "./schema.js";
import { PATH, LEVEL_PREFIX, tree_index } from "./tree_nodes.js";
import { to_filter, quick_filter_terms, ordered_columns, AGGREGATES, CURRENCY_COUNT_PREFIX } from "./view_config.js";

// Split columns one pivot shows (combinations of the pivot columns x values). Above it the
// pivot is drawn without its split, with a notice: a table thousands of columns wide is of
// no use and costs memory in the engine.
export const MAX_PIVOT_COLUMNS = 500;
// view_state limits (§7.2: 20 analysis dimensions).
export const MAX_PIVOT_DIMS = 20;
export const MAX_PIVOT_VALUES = 20;
export const PIVOT_AGGS = ["sum", "avg", "count", "min", "max"];
// Engine column of the i-th value: values may repeat a measure with another aggregate.
export const VALUE_PREFIX = "__pv";
const ROW_TYPES = new Set(["string", "date", "boolean"]);
const LINK_TYPES = new Set(["Link", "Dynamic Link"]);

/** Level number of a tree level key ("level_2" -> 2), else null. */
export function pivot_level(key) {
	if (typeof key !== "string" || !key.startsWith(LEVEL_PREFIX)) return null;
	const n = Number(key.slice(LEVEL_PREFIX.length));
	return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Dimensions a pivot may group or split by: the levels of a report tree (top-level groups
 * first), then the report's text, date and check columns (not its hidden ones).
 * @returns {Array<{key: string, level: number|null, fieldtype: string|null, type: string}>}
 */
export function pivot_dimensions(normalized) {
	const out = [];
	if (normalized.tree?.enabled) {
		const { max_depth } = tree_index(normalized);
		for (let level = 1; level <= max_depth; level++) out.push({ key: LEVEL_PREFIX + level, level, fieldtype: null, type: "string" });
	}
	for (const c of ordered_columns(normalized)) {
		const type = perspective_type(c.fieldtype);
		if (c.hidden || c.role === "measure" || !ROW_TYPES.has(type)) continue;
		if (c.key.includes('"')) continue;
		out.push({ key: c.key, level: null, fieldtype: c.fieldtype, type });
	}
	return out;
}

/** Numeric columns a pivot may show as values (not the report's hidden ones). */
export function pivot_measures(normalized) {
	return ordered_columns(normalized)
		.filter((c) => !c.hidden && c.role === "measure" && perspective_type(c.fieldtype) === "float" && !c.key.includes('"'))
		.map((c) => c.key);
}

function clean_values(values, measures) {
	const out = [];
	for (const v of Array.isArray(values) ? values : []) {
		if (!v || !measures.includes(v.key) || !PIVOT_AGGS.includes(v.agg)) continue;
		if (out.some((o) => o.key === v.key && o.agg === v.agg)) continue;
		out.push({ key: v.key, agg: v.agg });
	}
	return out.slice(0, MAX_PIVOT_VALUES);
}

function clean_dims(keys, dims, taken = []) {
	const out = [];
	for (const k of Array.isArray(keys) ? keys : []) {
		if (dims.includes(k) && !out.includes(k) && !taken.includes(k)) out.push(k);
	}
	return out.slice(0, MAX_PIVOT_DIMS);
}

/**
 * Default pivot of a report: register.pivot when it fits the report, else the top-level groups
 * of a tree report (or its first linked dimension that is not the label column) as rows, no
 * pivot columns until the user adds one, and the first measure as value.
 * @param {object} [register] report_view.register config ({pivot: {rows, cols, values}})
 * @param {string|null} [label_key] the grid's label column
 */
export function default_pivot(normalized, register = {}, label_key = null) {
	const dims = pivot_dimensions(normalized);
	const keys = dims.map((d) => d.key);
	const measures = pivot_measures(normalized);
	const by_key = new Map(normalized.columns.map((c) => [c.key, c]));
	const own = register?.pivot || {};
	let rows = clean_dims(own.rows, keys);
	if (!rows.length) {
		const columns = dims.filter((d) => d.level === null && d.key !== label_key);
		const text = columns.filter((d) => d.type === "string");
		const first =
			(normalized.tree?.enabled && keys.includes(LEVEL_PREFIX + 1) ? LEVEL_PREFIX + 1 : null) ??
			text.find((d) => LINK_TYPES.has(d.fieldtype))?.key ??
			text[0]?.key ??
			columns[0]?.key ??
			keys[0] ??
			null;
		rows = first ? [first] : [];
	}
	const cols = clean_dims(own.cols, keys, rows);
	let values = clean_values(own.values, measures);
	if (!values.length && measures.length) {
		const agg = by_key.get(measures[0])?.agg;
		values = [{ key: measures[0], agg: PIVOT_AGGS.includes(agg) ? agg : "sum" }];
	}
	return { rows, cols, values, totals: { rows: true, cols: true } };
}

/**
 * The pivot of the view state made valid for this report (unknown keys are dropped; no rows
 * or no values fall back to the default ones, as the design does).
 */
export function resolve_pivot(view_state, normalized, register = {}, label_key = null) {
	const base = default_pivot(normalized, register, label_key);
	const pivot = view_state?.pivot;
	if (!pivot || typeof pivot !== "object") return base;
	const keys = pivot_dimensions(normalized).map((d) => d.key);
	const rows = clean_dims(pivot.rows, keys);
	const out_rows = rows.length ? rows : base.rows;
	const values = clean_values(pivot.values, pivot_measures(normalized));
	return {
		rows: out_rows,
		cols: clean_dims(pivot.cols, keys, out_rows),
		values: values.length ? values : base.values,
		totals: {
			rows: pivot.totals?.rows !== false,
			cols: pivot.totals?.cols !== false,
		},
	};
}

/** Engine column that orders a dimension: report order for tree levels, the collator key of a text column, else itself. */
function order_column(dim) {
	if (dim.level !== null) return PATH;
	return dim.type === "string" ? SORT_PREFIX + dim.key : dim.key;
}

function row_currency_key(column) {
	return column?.currency?.kind === "row" ? column.currency.key : null;
}

/**
 * Perspective configs of a pivot.
 *
 * @param {object} view_state §7.1 (its browser filters and quick filters)
 * @param {object} normalized NormalizedReport
 * @param {{rows, cols, values, totals}} pivot a resolved pivot (resolve_pivot)
 * @param {object} [opts] {quick_filters: register.quick_filters, split_columns: number of
 *   split columns measured with `count` (null: not measured yet)}
 * @returns {{table: "facts", config: object, totals: object, count: Array<object>|null, post: object}}
 *   count: the configs whose row numbers give the combinations of the pivot columns
 *   (combinations = rows of the first - rows of the second).
 */
export function to_pivot_config(view_state, normalized, pivot, opts = {}) {
	const by_key = new Map(normalized.columns.map((c) => [c.key, c]));
	const dims = new Map(pivot_dimensions(normalized).map((d) => [d.key, d]));
	const rows = pivot.rows.filter((k) => dims.has(k));
	const wanted_cols = pivot.cols.filter((k) => dims.has(k) && !rows.includes(k));
	const values = pivot.values
		.filter((v) => by_key.has(v.key) && AGGREGATES[v.agg])
		.map((v, i) => ({ ...v, name: `${VALUE_PREFIX}${i}`, currency_key: row_currency_key(by_key.get(v.key)) }));
	const column_filter = to_filter(view_state?.filters, normalized.columns);
	const quick = quick_filter_terms(view_state, opts.quick_filters);
	const filter = [...column_filter.filter, ...quick.filter];
	const notices = [...column_filter.notices, ...quick.notices];
	const filter_expressions = { ...quick.expressions };

	const measured = Number.isFinite(opts.split_columns) ? opts.split_columns : null;
	const blocked = wanted_cols.length > 0 && measured !== null && measured > MAX_PIVOT_COLUMNS;
	const cols = blocked ? [] : wanted_cols;
	if (blocked) notices.push({ code: "PIVOT_TOO_MANY_COLUMNS", detail: measured, limit: MAX_PIVOT_COLUMNS });

	const value_expressions = Object.fromEntries(values.map((v) => [v.name, `"${v.key}"`]));
	const value_aggregates = Object.fromEntries(values.map((v) => [v.name, AGGREGATES[v.agg]]));
	const currency_keys = [...new Set(values.map((v) => v.currency_key).filter((k) => k && !k.includes('"')))];
	const currency_counts = currency_keys.map((k) => CURRENCY_COUNT_PREFIX + k);
	const currency_expressions = Object.fromEntries(currency_keys.map((k) => [CURRENCY_COUNT_PREFIX + k, `"${k}"`]));

	const row_sort = [];
	for (const k of rows) {
		const name = order_column(dims.get(k));
		if (!row_sort.some(([n]) => n === name)) row_sort.push([name, "asc"]);
	}
	const col_sort = [];
	for (const k of cols) {
		const name = order_column(dims.get(k));
		if (!row_sort.some(([n]) => n === name) && !col_sort.some(([n]) => n === name)) col_sort.push([name, "col asc"]);
	}
	const sort_aggregates = Object.fromEntries([...row_sort, ...col_sort].map(([n]) => [n, "min"]));
	const expressions = { ...filter_expressions, ...value_expressions };

	const config = {
		group_by: rows,
		split_by: cols,
		columns: values.map((v) => v.name),
		aggregates: { ...sort_aggregates, ...value_aggregates },
		filter,
		sort: [...row_sort, ...col_sort],
		expressions,
	};
	const totals = {
		group_by: rows,
		columns: [...values.map((v) => v.name), KIND, ...currency_keys, ...currency_counts],
		aggregates: {
			...Object.fromEntries(row_sort.map(([n]) => [n, "min"])),
			...value_aggregates,
			[KIND]: "count",
			...Object.fromEntries(currency_keys.map((k) => [k, "unique"])),
			...Object.fromEntries(currency_counts.map((k) => [k, "distinct count"])),
		},
		filter,
		sort: row_sort,
		expressions: { ...expressions, ...currency_expressions },
	};
	// Combinations of the pivot columns = group rows of all of them - group rows of all but
	// the last (the grand total row when there is one pivot column).
	const count_config = (keys) => ({
		group_by: keys,
		columns: [KIND],
		aggregates: { [KIND]: "count" },
		filter,
		expressions: filter_expressions,
	});
	const count = wanted_cols.length ? [count_config(wanted_cols), count_config(wanted_cols.slice(0, -1))] : null;

	return {
		table: "facts",
		config,
		totals,
		count,
		post: {
			rows,
			cols,
			wanted_cols,
			values,
			blocked,
			split_columns: measured,
			totals: { rows: pivot.totals?.rows !== false, cols: pivot.totals?.cols !== false },
			dims: Object.fromEntries([...rows, ...cols].map((k) => [k, dims.get(k)])),
			currency_keys,
			filter,
			filter_expressions,
			notices,
		},
	};
}

/** The value of a dimension as a filter value: Perspective returns dates of a row path as milliseconds. */
function filter_value(dim, value) {
	if (dim.type === "date" && typeof value === "number") return new Date(value).toISOString().slice(0, 10);
	return value;
}

/** A segment of a split column path ("x|y|__pv0") back to the value it stands for. */
export function split_value(dim, text) {
	if (text === "null") return null;
	if (dim.type === "boolean") return text === "true";
	return text;
}

/** A value of a dimension as Perspective writes it in a column path (a row path gives dates as milliseconds). */
function path_segment(dim, value) {
	if (value === null || value === undefined) return "null";
	if (dim.type === "date" && typeof value === "number") return new Date(value).toISOString().slice(0, 10);
	return String(value);
}

/**
 * The split columns of a pivot view from its column paths ("x|y|__pv0"). Perspective joins
 * the values of the pivot columns with "|", so a text value that contains "|" gives more
 * segments than there are pivot columns. With one pivot column the value is the whole path
 * before the value's name; with several, the exact combinations of the pivot columns'
 * values (`combos`, the row paths of a view grouped by them, queries.group_paths) tell the
 * values apart. The literal text "null" and a null value read alike (both "null").
 * @param {string[]} paths view.column_paths()
 * @param {object} post to_pivot_config().post
 * @param {Array<Array>|null} [combos] value tuples of the pivot columns, when known
 * @returns {{columns: Array<{name: string, alias: string, values: Array}>, unresolved: number,
 *   ambiguous: boolean}} ambiguous: some path needs `combos` to be read
 */
export function resolve_column_paths(paths, post, combos = null) {
	const n = post.cols.length;
	const dims = post.cols.map((k) => post.dims[k]);
	const by_key = new Map();
	for (const tuple of combos || []) by_key.set(tuple.map((v, d) => path_segment(dims[d], v)).join("|"), tuple);
	const columns = [];
	let unresolved = 0;
	let ambiguous = false;
	for (const name of paths) {
		const segs = name.split("|");
		const alias = segs.pop();
		if (!post.values.some((v) => v.name === alias)) continue;
		let values = null;
		if (segs.length === n) values = segs.map((s, d) => split_value(dims[d], s));
		else if (n === 1) values = [split_value(dims[0], segs.join("|"))];
		else {
			ambiguous = true;
			const tuple = by_key.get(segs.join("|"));
			if (tuple) values = tuple.map((v, d) => split_value(dims[d], path_segment(dims[d], v)));
		}
		if (!values) {
			unresolved += 1;
			continue;
		}
		columns.push({ name, alias, values });
	}
	return { columns, unresolved, ambiguous };
}

/**
 * Config of the temporary view behind one pivot cell (§11.1 #68): the facts of its row path
 * and its column path under the pivot's filters, largest first by the value, as the design
 * lists them.
 * @param {object} post to_pivot_config().post
 * @param {Array} row_path __ROW_PATH__ of the row (empty for the grand total row)
 * @param {Array} col_values values of the pivot columns (split_value), empty for a total column
 * @param {object} value one of post.values
 * @param {string|null} label_key the column that names a fact
 */
export function drill_config(post, row_path, col_values, value, label_key) {
	const terms = [];
	const add = (key, raw) => {
		const dim = post.dims[key];
		const v = filter_value(dim, raw);
		if (v === null || v === undefined || v === "") terms.push([key, "is null", null]);
		else terms.push([key, "==", v]);
	};
	post.rows.slice(0, row_path.length).forEach((k, i) => add(k, row_path[i]));
	post.cols.slice(0, col_values.length).forEach((k, i) => add(k, col_values[i]));
	const order = "__pvorder";
	return {
		columns: [...new Set([RID, ...(label_key ? [label_key] : []), value.key])],
		filter: [...post.filter, ...terms],
		sort: [[order, "desc"], [RID, "asc"]],
		expressions: { ...post.filter_expressions, [order]: `abs("${value.key}")` },
	};
}
