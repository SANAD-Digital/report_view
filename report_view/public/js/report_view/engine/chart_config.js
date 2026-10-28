// Charts dashboard (docs/architecture.md §7.1 `charts`, §11.1 #69-73): which dimensions and
// measures a report offers, the default cards of a report, the filters of the dashboard
// (slicers, cross-filter) and the Perspective view config of one card. Pure module: no
// frappe, no DOM, no Perspective.
//
// A card reads one dedicated view: its measures aggregated by its dimension, under the page's
// browser filters plus the dashboard's own (slicers, the card's filter, the cross-filter of
// another card), sorted and cut by the engine (sort + the rows read). Its numbers are those
// of the grid for the same filters:
// - a level of a report tree with no filter at all: the tree rows of that depth with the
//   report's own values (nodes table), as the grid shows the tree "as is";
// - anything else: the facts grouped by the dimension, as the grid's groups add them up.

import { RID, KIND, SORT_PREFIX, perspective_type } from "./schema.js";
import { DEPTH, PATH, TOP, LEVEL_PREFIX, tree_index } from "./tree_nodes.js";
import { to_filter, quick_filter_terms, aggregate_of, ordered_columns, AGGREGATES, CURRENCY_COUNT_PREFIX } from "./view_config.js";
import { CARD_TYPES, sanitize_dashboard } from "../state/dashboard_state.js";
import { row_currency_key, has_value, is_empty } from "./columns_util.js";

export { CARD_TYPES };
// Categories one card shows at most, whatever its Top N.
export const CARD_LIMITS = { bar: 40, stacked: 40, line: 60, area: 60, hbar: 25, hstacked: 25, donut: 7, kpi: 0 };
// One colour token per series (--c1..--c7).
export const MAX_SERIES = 7;
export const PCT_PREFIX = "__pct__";
const SUM_SORT = "__sumsort__";
const LABEL_SORT = "__lblsort__";
const DIMENSION_TYPES = new Set(["string", "date", "datetime", "boolean"]);
const LINK_TYPES = new Set(["Link", "Dynamic Link"]);
const DATE_TYPES = new Set(["Date", "Datetime"]);
const STACKED = new Set(["stacked", "hstacked"]);
// Types whose categories are read largest first unless the user chose another order.
const BY_VALUE = new Set(["hbar", "hstacked", "donut"]);
const IN_TIME = new Set(["line", "area"]);

/** Level number of a tree level key ("level_2" -> 2), else null. */
export function level_of(key) {
	if (typeof key !== "string" || !key.startsWith(LEVEL_PREFIX)) return null;
	const n = Number(key.slice(LEVEL_PREFIX.length));
	return Number.isInteger(n) && n > 0 ? n : null;
}

/** Numeric columns a card may show: measures the engine can aggregate (not the report's hidden ones). */
export function chart_measures(normalized, view_state) {
	return ordered_columns(normalized)
		.filter((c) => !c.hidden && c.role === "measure" && perspective_type(c.fieldtype) === "float")
		.filter((c) => aggregate_of(c, view_state))
		.map((c) => c.key);
}

/**
 * Dimensions a card may group by: the levels of a report tree (top-level groups first), then
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

/** Dimensions a slicer may filter: text and check columns (values), and dates (a range). */
export function slicer_dimensions(normalized) {
	return chart_dimensions(normalized).map((d) => ({ ...d, kind: DATE_TYPES.has(d.fieldtype) ? "date" : "set" }));
}

// ------------------------------------------------------------------ default dashboard

/**
 * Default cards of a report: register.charts.cards, else 2-3 cards from its first dimensions
 * and measures (a tree: top-level groups, the next level as a donut, the top accounts; any
 * other report: the first linked dimension, another text dimension as a donut, a date in time).
 * @param {object} [register] report_view.register config ({charts: {cards: [...]}})
 * @param {string|null} [label_key] the grid's label column
 */
export function default_cards(normalized, view_state, register = {}, label_key = null) {
	const types = register?.features?.chart_types;
	const cards = default_cards_of(normalized, view_state, register, label_key);
	if (!Array.isArray(types)) return cards;
	// Report View Settings limit the types (ADR-023): a default card of another type takes the
	// nearest allowed one (a number card stays a number card or goes)
	const out = cards.map((c) => (types.includes(c.type) ? c : { ...c, type: nearest_type(c.type, types) })).filter((c) => c.type);
	const measures = chart_measures(normalized, view_state);
	if (!out.length && types.includes("kpi") && measures.length) {
		return resolve_cards([{ type: "kpi", x: null, series: measures.slice(0, 4) }], normalized, view_state);
	}
	return out;
}

// The allowed type closest to a default card's: bars for bars, lines for lines, then any.
const NEAR = {
	bar: ["stacked", "hbar", "hstacked", "line", "area", "donut"],
	stacked: ["bar", "hstacked", "hbar", "area", "line", "donut"],
	hbar: ["hstacked", "bar", "stacked", "donut", "line", "area"],
	hstacked: ["hbar", "stacked", "bar", "donut", "area", "line"],
	line: ["area", "bar", "stacked", "hbar", "hstacked", "donut"],
	area: ["line", "stacked", "bar", "hbar", "hstacked", "donut"],
	donut: ["hbar", "bar", "stacked", "hstacked", "line", "area"],
	kpi: [],
};

function nearest_type(type, types) {
	return (NEAR[type] || []).find((t) => types.includes(t)) || null;
}

function default_cards_of(normalized, view_state, register = {}, label_key = null) {
	const own = register?.charts?.cards;
	if (Array.isArray(own) && own.length) {
		const strict = resolve_cards(own, normalized, view_state, { strict: true });
		if (strict.length) return strict;
	}
	const dims = chart_dimensions(normalized);
	const measures = chart_measures(normalized, view_state);
	if (!measures.length || !dims.length) return [];
	const two = measures.slice(0, 2);
	const cards = [];
	const has = (key) => dims.some((d) => d.key === key);
	if (normalized.tree?.enabled) {
		cards.push({ type: "bar", x: LEVEL_PREFIX + 1, series: two });
		if (has(LEVEL_PREFIX + 2)) cards.push({ type: "donut", x: LEVEL_PREFIX + 2, series: two.slice(0, 1) });
		const label = normalized.tree.label_key;
		if (label && has(label)) cards.push({ type: two.length > 1 ? "hstacked" : "hbar", x: label, series: two, top: 10, size: "full" });
	} else {
		const columns = dims.filter((d) => d.level === null && d.key !== label_key);
		const text = columns.filter((d) => !DATE_TYPES.has(d.fieldtype) && d.fieldtype !== "Check");
		const primary = text.find((d) => LINK_TYPES.has(d.fieldtype)) || text[0];
		const secondary = text.find((d) => d !== primary && !LINK_TYPES.has(d.fieldtype)) || text.find((d) => d !== primary);
		const date = dims.find((d) => DATE_TYPES.has(d.fieldtype));
		if (primary) cards.push({ type: "hbar", x: primary.key, series: two, top: 10 });
		if (secondary) cards.push({ type: "donut", x: secondary.key, series: two.slice(0, 1) });
		if (date) cards.push({ type: "area", x: date.key, series: two, sort: "label", size: "full" });
	}
	if (!cards.length) cards.push({ type: "kpi", x: null, series: measures.slice(0, 4) });
	return resolve_cards(cards, normalized, view_state);
}

function filterable(normalized) {
	return new Map(chart_dimensions(normalized).map((d) => [d.key, d]));
}

/**
 * Cards made valid for this report: a dimension it has (or none: the measures side by side),
 * measures it has (else its first ones). strict: a card whose own filter names a column the
 * report does not have is dropped (a default card must not show more than it says).
 */
function resolve_cards(cards, normalized, view_state, { strict = false } = {}) {
	const clean = sanitize_dashboard({ cards })?.cards || [];
	const dims = filterable(normalized);
	const measures = chart_measures(normalized, view_state);
	const first = dims.keys().next().value ?? null;
	const out = [];
	for (const card of clean) {
		if (strict && card.filter.some((f) => !dims.has(f.key))) continue;
		let x = card.x !== null && dims.has(card.x) ? card.x : null;
		// Lines need categories in order; a KPI has none.
		if (card.type === "kpi") x = null;
		else if (x === null && (IN_TIME.has(card.type) || (card.x !== null && !dims.has(card.x)))) x = first;
		const series = card.series.filter((k) => measures.includes(k));
		out.push({
			...card,
			x,
			series: (series.length ? series : measures.slice(0, card.type === "donut" ? 1 : 2)).slice(0, MAX_SERIES),
			filter: card.filter.filter((f) => dims.has(f.key)),
		});
	}
	return out;
}

/**
 * The dashboard of the view state made valid for this report (unknown keys are dropped).
 * @returns {{cards: Array, slicers: Array, cross: object|null, own: boolean}} own: the user's
 *   dashboard (else the report's default)
 */
export function resolve_dashboard(view_state, normalized, register = {}, label_key = null) {
	const saved = sanitize_dashboard(view_state?.charts);
	const dims = filterable(normalized);
	if (!saved) return { cards: default_cards(normalized, view_state, register, label_key), slicers: [], cross: null, own: false };
	const types = register?.features?.chart_types;
	// a saved card of a type the report's settings turned off is dropped (ADR-023)
	const cards = resolve_cards(Array.isArray(types) ? saved.cards.filter((c) => types.includes(c.type)) : saved.cards, normalized, view_state);
	const slicers = saved.slicers.filter((s) => {
		const d = dims.get(s.key);
		return d && (s.type === "date") === DATE_TYPES.has(d.fieldtype);
	});
	const cross = saved.cross && dims.has(saved.cross.key) && cards.some((c) => c.id === saved.cross.card) ? saved.cross : null;
	return { cards, slicers, cross, own: true };
}

// ------------------------------------------------------------------ filters of the dashboard

function column_type(key, by_key) {
	if (level_of(key) !== null) return "string";
	const c = by_key.get(key);
	return c ? perspective_type(c.fieldtype) : null;
}

/** "YYYY-MM-DD" of a date value as the engine returns it (ms since the epoch, UTC). */
export function date_text(value) {
	if (typeof value === "string") return value.slice(0, 10);
	if (!Number.isFinite(value)) return null;
	return new Date(value).toISOString().slice(0, 10);
}

/** Filter terms of "the column is one of these values" (a set slicer, a card's filter). */
function set_terms(key, values, by_key) {
	const type = column_type(key, by_key);
	if (!type || !Array.isArray(values)) return [];
	const with_null = values.some(is_empty);
	const plain = values.filter(has_value);
	if (type === "string") {
		if (with_null && !plain.length) return [[key, "is null", null]];
		// "(empty) or values" needs an "or": the values only (the slicer's list says so).
		return [[key, "in", plain.map(String)]];
	}
	// A date or check column: one value is "==", several cannot be said without an "or".
	if (with_null && !plain.length) return [[key, "is null", null]];
	if (!plain.length) return [[key, "in", []]];
	return [value_term(key, plain[0], by_key)];
}

/** Filter term of one category value (the cross-filter). */
function value_term(key, value, by_key) {
	if (value === null || value === undefined || value === "") return [key, "is null", null];
	const type = column_type(key, by_key);
	if (type === "date") return [key, "==", date_text(value)];
	if (type === "string") return [key, "==", String(value)];
	return [key, "==", value];
}

/**
 * Filter terms the dashboard adds to one card: the slicers, the card's own filter, and the
 * cross-filter of another card (the card that was clicked keeps all its categories).
 * @returns {Array} Perspective filter terms
 */
export function dashboard_terms(dashboard, card, normalized) {
	const by_key = new Map(normalized.columns.map((c) => [c.key, c]));
	const out = [];
	for (const s of dashboard?.slicers || []) {
		if (s.type === "date") {
			const type = column_type(s.key, by_key);
			if (s.from) out.push([s.key, ">=", s.from]);
			if (s.to) out.push([s.key, "<=", type === "datetime" ? `${s.to} 23:59:59.999` : s.to]);
		} else if (Array.isArray(s.values)) {
			out.push(...set_terms(s.key, s.values, by_key));
		}
	}
	for (const f of card?.filter || []) out.push(...set_terms(f.key, f.values, by_key));
	const cross = dashboard?.cross;
	if (cross && card && cross.card !== card.id) out.push(value_term(cross.key, cross.value, by_key));
	return out;
}

// ------------------------------------------------------------------ view config of a card

/** The order of a card: the user's, else largest first for a Top N or a ranking type. */
export function card_sort(card) {
	if (card.sort) return card.sort;
	if (card.top || BY_VALUE.has(card.type)) return "desc";
	return "label";
}

/** Categories a card shows at most: its Top N, never more than its type draws. */
export function card_limit(card) {
	const max = CARD_LIMITS[card.type] ?? CARD_LIMITS.bar;
	return card.top ? Math.min(card.top, max) : max;
}

/**
 * Perspective config of a card. Called twice: first without `categories` (only `count` is
 * used: how many categories there are), then with that number.
 *
 * @param {object} view_state §7.1
 * @param {object} normalized NormalizedReport
 * @param {object} card a resolved card (resolve_dashboard)
 * @param {object} [opts] {quick_filters: register.quick_filters, dashboard, categories: number}
 * @returns {{route: "nodes"|"facts"|"totals", table: string, count: object|null, config: object, post: object}}
 */
export function to_card_config(view_state, normalized, card, opts = {}) {
	const by_key = new Map(normalized.columns.map((c) => [c.key, c]));
	const series = (card.series || []).filter((k) => by_key.has(k));
	const level = level_of(card.x);
	const column_filter = to_filter(view_state?.filters, normalized.columns);
	const quick = quick_filter_terms(view_state, opts.quick_filters);
	const filter = [...column_filter.filter, ...quick.filter, ...dashboard_terms(opts.dashboard, card, normalized)];
	const expressions = { ...quick.expressions };
	const is_tree = Boolean(normalized.tree?.enabled);
	const agg_of = (k) => (card.agg ? AGGREGATES[card.agg] : aggregate_of(by_key.get(k), view_state)) || "sum";
	const currency_keys = [...new Set(series.map((k) => row_currency_key(by_key.get(k))).filter(Boolean))];
	const counts = currency_keys.filter((k) => !k.includes('"'));
	const sort = card_sort(card);
	const limit = card_limit(card);
	const categories = Number.isFinite(opts.categories) ? opts.categories : null;
	const post = {
		route: "facts",
		type: card.type,
		x: card.x,
		level,
		series,
		limit,
		sort,
		top: categories !== null && categories > limit,
		categories,
		row_offset: 1,
		label_key: null,
		currency: Object.fromEntries(series.map((k) => [k, row_currency_key(by_key.get(k))]).filter(([, v]) => v)),
		currency_counts: Object.fromEntries(counts.map((k) => [k, CURRENCY_COUNT_PREFIX + k])),
		pct: {},
		notices: [...column_filter.notices, ...quick.notices],
	};
	for (const k of counts) expressions[CURRENCY_COUNT_PREFIX + k] = `"${k}"`;
	const aggregates = {};
	for (const k of series) aggregates[k] = agg_of(k);
	for (const k of currency_keys) aggregates[k] = "unique";
	for (const k of counts) aggregates[CURRENCY_COUNT_PREFIX + k] = "distinct count";
	const base_columns = [...series, ...currency_keys, ...counts.map((k) => CURRENCY_COUNT_PREFIX + k)];

	// A KPI, or no dimension (the measures side by side): the totals of the view, one row.
	if (card.type === "kpi" || card.x === null) {
		const nodes = is_tree && !filter.length && !card.agg;
		post.route = "totals";
		post.limit = 0;
		post.top = false;
		post.categories = series.length;
		return {
			route: "totals",
			table: nodes ? "nodes" : "facts",
			count: null,
			config: {
				group_by: [KIND],
				columns: base_columns,
				aggregates,
				// The tree "as is": its top-level rows add up to the report.
				filter: nodes ? [[TOP, "==", true]] : filter,
				expressions: nodes ? Object.fromEntries(counts.map((k) => [CURRENCY_COUNT_PREFIX + k, `"${k}"`])) : expressions,
			},
			post,
		};
	}

	// The share of every category in the whole (a donut's list), computed by the engine.
	if (card.type === "donut" && series.length) {
		const name = PCT_PREFIX + series[0];
		if (!series[0].includes('"')) {
			expressions[name] = `"${series[0]}"`;
			aggregates[name] = "pct sum grand total";
			post.pct[series[0]] = name;
		}
	}
	const pct_columns = Object.values(post.pct);

	// Order of the categories, by the engine: a value (the sum of the stacked measures when they
	// all add up), or the category itself (text by the language's rules, dates in time, tree
	// levels and check columns in report order).
	const stacked_sum = STACKED.has(card.type) && series.length > 1 && series.every((k) => aggregates[k] === "sum") && !series.some((k) => k.includes('"'));
	let value_key = series[0];
	if (stacked_sum) {
		value_key = SUM_SORT;
		expressions[SUM_SORT] = series.map((k) => `"${k}"`).join(" + ");
		aggregates[SUM_SORT] = "sum";
	}
	const route = is_tree && level !== null && !filter.length && !card.agg ? "nodes" : "facts";
	post.route = route;

	if (route === "nodes") {
		// Rows of one depth of the tree, each its own group (__path), with the report's values.
		const label_key = normalized.tree?.label_key && by_key.has(normalized.tree.label_key) ? normalized.tree.label_key : null;
		post.label_key = label_key;
		const node_filter = [[DEPTH, "==", level - 1]];
		for (const k of series) aggregates[k] = "sum";
		if (label_key) aggregates[label_key] = "unique";
		aggregates[RID] = "min";
		const order =
			sort === "label" || !series.length
				? [[RID, "asc"]]
				: [[value_key, sort === "asc" ? "asc" : "desc"], [RID, "asc"]];
		const columns = [...new Set([...base_columns, ...(label_key ? [label_key] : []), ...pct_columns, ...(stacked_sum ? [SUM_SORT] : []), RID])];
		return {
			route,
			table: "nodes",
			count: { table: "nodes", config: { columns: [KIND], filter: node_filter }, grouped: false },
			config: { group_by: [PATH], columns, aggregates, filter: node_filter, expressions: { ...expressions }, sort: order },
			post,
		};
	}

	const x = card.x;
	const x_type = column_type(x, by_key);
	let label_order = [[RID, "asc"]];
	if (sort === "label" && level === null) {
		if (x_type === "string" && by_key.has(x)) {
			aggregates[SORT_PREFIX + x] = "min";
			label_order = [[SORT_PREFIX + x, "asc"], [RID, "asc"]];
		} else if (x_type === "date" || x_type === "datetime") {
			expressions[LABEL_SORT] = `"${x}"`;
			aggregates[LABEL_SORT] = "min";
			label_order = [[LABEL_SORT, "asc"], [RID, "asc"]];
		}
	}
	aggregates[RID] = "min";
	const order = sort === "label" || !series.length ? label_order : [[value_key, sort === "asc" ? "asc" : "desc"], [RID, "asc"]];
	// Perspective mis-windows a grouped view whose sort column is hidden: every sort column is a view column.
	const columns = [...new Set([...base_columns, ...pct_columns, ...order.map(([k]) => k), RID])];
	return {
		route,
		table: "facts",
		count: {
			table: "facts",
			config: { group_by: [x], columns: [KIND], aggregates: { [KIND]: "count" }, filter, expressions: { ...quick.expressions } },
			grouped: true,
		},
		config: { group_by: [x], columns, aggregates, filter, expressions, sort: order },
		post,
	};
}
