// Chart of the Charts view (docs/architecture.md §7.1 `chart`, §11.1 #69-73): which dimensions
// and measures a report offers, the default chart of a report, and the Perspective view config
// of a chart. Pure module: no frappe, no DOM, no Perspective.
//
// A chart reads one dedicated view: the measures aggregated by the dimension, under the same
// browser filters as the grid. Its numbers are those of the grid for the same filters:
// - a level of a report tree while the grid shows the tree "as is" (no browser filter): the
//   tree rows of that depth with the report's own values (nodes table), as the grid shows them;
// - anything else: the facts grouped by the dimension, as the grid's groups add them up.

import { RID, KIND, perspective_type } from "./schema.js";
import { DEPTH, PATH, LEVEL_PREFIX, tree_index } from "./tree_nodes.js";
import { to_filter, quick_filter_terms, aggregate_of, ordered_columns, CURRENCY_COUNT_PREFIX } from "./view_config.js";

export const CHART_TYPES = ["bar", "stacked", "hbar", "line", "donut"];
// Categories one chart shows. Above it the chart shows the largest ones by its first measure.
export const CHART_LIMITS = { bar: 40, stacked: 40, line: 60, hbar: 25, donut: 7 };
// One colour token per series (--c1..--c7).
export const MAX_SERIES = 7;
const DEFAULT_SERIES = 2;
const DIMENSION_TYPES = new Set(["string", "date", "datetime", "boolean"]);
const LINK_TYPES = new Set(["Link", "Dynamic Link"]);

/** Level number of a tree level key ("level_2" -> 2), else null. */
export function level_of(key) {
	if (typeof key !== "string" || !key.startsWith(LEVEL_PREFIX)) return null;
	const n = Number(key.slice(LEVEL_PREFIX.length));
	return Number.isInteger(n) && n > 0 ? n : null;
}

/** Numeric columns a chart may show: measures the engine can aggregate (not the report's hidden ones). */
export function chart_measures(normalized, view_state) {
	return ordered_columns(normalized)
		.filter((c) => !c.hidden && c.role === "measure" && perspective_type(c.fieldtype) === "float")
		.filter((c) => aggregate_of(c, view_state))
		.map((c) => c.key);
}

/**
 * Dimensions a chart may group by: the levels of a report tree (top-level groups first), then
 * the report's text, date and check columns (not the report's hidden ones).
 * @returns {Array<{key: string, level: number|null, fieldtype: string|null}>}
 */
export function chart_dimensions(normalized) {
	const out = [];
	if (normalized.tree?.enabled) {
		const { max_depth } = tree_index(normalized);
		for (let level = 1; level <= max_depth; level++) out.push({ key: LEVEL_PREFIX + level, level, fieldtype: null });
	}
	for (const c of ordered_columns(normalized)) {
		if (c.hidden || c.role === "measure" || !DIMENSION_TYPES.has(perspective_type(c.fieldtype))) continue;
		out.push({ key: c.key, level: null, fieldtype: c.fieldtype });
	}
	return out;
}

/**
 * Default chart of a report: register.chart when it fits the report, else the top-level groups
 * of a tree report (or its first linked dimension that is not the label column) and its first
 * measures, as grouped columns.
 * @param {object} [register] report_view.register config ({chart: {type, x, series}})
 * @param {string|null} [label_key] the grid's label column (not a grouping of its own)
 */
export function default_chart(normalized, view_state, register = {}, label_key = null) {
	const dims = chart_dimensions(normalized).map((d) => d.key);
	const measures = chart_measures(normalized, view_state);
	const own = register?.chart || {};
	const type = CHART_TYPES.includes(own.type) ? own.type : "bar";
	let x = dims.includes(own.x) ? own.x : null;
	if (!x) {
		const columns = chart_dimensions(normalized).filter((d) => d.level === null && d.key !== label_key);
		const text = columns.filter((d) => !["Date", "Datetime"].includes(d.fieldtype));
		x =
			(normalized.tree?.enabled && dims.includes(LEVEL_PREFIX + 1) ? LEVEL_PREFIX + 1 : null) ??
			text.find((d) => LINK_TYPES.has(d.fieldtype))?.key ??
			text[0]?.key ??
			columns[0]?.key ??
			dims[0] ??
			null;
	}
	const wanted = Array.isArray(own.series) ? own.series.filter((k) => measures.includes(k)) : [];
	const series = (wanted.length ? wanted : measures.slice(0, DEFAULT_SERIES)).slice(0, MAX_SERIES);
	return { type, x, series };
}

/** The chart of the view state made valid for this report (unknown keys fall back to the default). */
export function resolve_chart(view_state, normalized, register = {}, label_key = null) {
	const base = default_chart(normalized, view_state, register, label_key);
	const chart = view_state?.chart;
	if (!chart || typeof chart !== "object") return base;
	const dims = chart_dimensions(normalized).map((d) => d.key);
	const measures = chart_measures(normalized, view_state);
	const series = Array.isArray(chart.series) ? [...new Set(chart.series.filter((k) => measures.includes(k)))] : [];
	return {
		type: CHART_TYPES.includes(chart.type) ? chart.type : base.type,
		x: dims.includes(chart.x) ? chart.x : base.x,
		series: (series.length ? series : base.series).slice(0, MAX_SERIES),
	};
}

function row_currency_key(column) {
	return column?.currency?.kind === "row" ? column.currency.key : null;
}

/**
 * Perspective config of a chart. Called twice: first without `categories` (only `count` is
 * used: how many categories there are), then with that number, which decides the order.
 *
 * @param {object} view_state §7.1
 * @param {object} normalized NormalizedReport
 * @param {{type, x, series}} chart a resolved chart (resolve_chart)
 * @param {object} [opts] {quick_filters: register.quick_filters, categories: number}
 * @returns {{route: "nodes"|"facts", table: string, count: {table, config, grouped: boolean},
 *   config: object, post: object}}
 */
export function to_chart_config(view_state, normalized, chart, opts = {}) {
	const by_key = new Map(normalized.columns.map((c) => [c.key, c]));
	const series = (chart.series || []).filter((k) => by_key.has(k));
	const level = level_of(chart.x);
	const column_filter = to_filter(view_state?.filters, normalized.columns);
	const quick = quick_filter_terms(view_state, opts.quick_filters);
	const filter = [...column_filter.filter, ...quick.filter];
	const expressions = { ...quick.expressions };
	const is_tree = Boolean(normalized.tree?.enabled);
	// The grid shows the tree "as is" (the report's own values) only without a browser filter.
	const route = is_tree && level !== null && !filter.length ? "nodes" : "facts";
	const limit = CHART_LIMITS[chart.type] || CHART_LIMITS.bar;
	const categories = Number.isFinite(opts.categories) ? opts.categories : null;
	const top = categories !== null && categories > limit;
	// Largest first: horizontal bars and donut always (as in the design); any type when there
	// are more categories than it shows. Else the report's own order.
	const by_value = series.length > 0 && (top || chart.type === "hbar" || chart.type === "donut");

	const currency_keys = [...new Set(series.map((k) => row_currency_key(by_key.get(k))).filter(Boolean))];
	const post = {
		route,
		x: chart.x,
		level,
		series,
		limit,
		top,
		categories,
		order: by_value ? "value" : "report",
		row_offset: 0,
		label_key: null,
		currency: Object.fromEntries(series.map((k) => [k, row_currency_key(by_key.get(k))]).filter(([, v]) => v)),
		currency_counts: {},
		has_total: false,
		notices: [...column_filter.notices, ...quick.notices],
	};

	if (route === "nodes") {
		const label_key = normalized.tree?.label_key && by_key.has(normalized.tree.label_key) ? normalized.tree.label_key : null;
		post.label_key = label_key;
		const node_filter = [[DEPTH, "==", level - 1]];
		const columns = [...new Set([...(label_key ? [label_key] : []), ...series, ...currency_keys, RID, PATH])];
		return {
			route,
			table: "nodes",
			count: { table: "nodes", config: { columns: [KIND], filter: node_filter }, grouped: false },
			config: {
				columns,
				filter: node_filter,
				sort: by_value ? [[series[0], "desc"], [PATH, "asc"]] : [[PATH, "asc"]],
			},
			post,
		};
	}

	const x = chart.x;
	// A row currency per category: "unique" is the currency when all its rows share one; the
	// distinct count tells a category that mixes currencies (no total, as in the grid).
	const counts = currency_keys.filter((k) => !k.includes('"'));
	post.currency_counts = Object.fromEntries(counts.map((k) => [k, CURRENCY_COUNT_PREFIX + k]));
	for (const k of counts) expressions[CURRENCY_COUNT_PREFIX + k] = `"${k}"`;
	const aggregates = {};
	for (const k of series) aggregates[k] = aggregate_of(by_key.get(k), view_state) || "sum";
	for (const k of currency_keys) aggregates[k] = "unique";
	for (const k of counts) aggregates[CURRENCY_COUNT_PREFIX + k] = "distinct count";
	aggregates[RID] = "min";
	const columns = [...new Set([...series, ...currency_keys, ...counts.map((k) => CURRENCY_COUNT_PREFIX + k), RID])];
	post.row_offset = 1;
	post.has_total = true;
	return {
		route,
		table: "facts",
		count: {
			table: "facts",
			config: { group_by: [x], columns: [KIND], aggregates: { [KIND]: "count" }, filter, expressions: quick.expressions },
			grouped: true,
		},
		config: {
			group_by: [x],
			columns,
			aggregates,
			filter,
			expressions,
			// Report order = the first fact of each category; ties keep it too.
			sort: by_value ? [[series[0], "desc"], [RID, "asc"]] : [[RID, "asc"]],
		},
		post,
	};
}
