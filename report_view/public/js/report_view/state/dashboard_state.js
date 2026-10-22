// Charts dashboard state (view_state.charts): the cards, the slicers and the cross-filter of
// the Charts view. Pure module: no frappe, no DOM. Display settings only; every number of a
// card comes from a Perspective view (engine/chart_config.js to_card_config).
//
// charts: null (the report's default dashboard) | {
//   cards: [{id, type, x, series, agg, sort, top, size, title, filter}],
//   slicers: [{key, type: "set", values: [v]|null} | {key, type: "date", from, to}],
//   cross: {card, key, value} | null   (a category clicked in a card filters the others)
// }

export const CARD_TYPES = ["bar", "stacked", "hbar", "hstacked", "line", "area", "donut", "kpi"];
// Value desc / asc, or the order of the categories (text A-Z, dates in time, report order).
const CARD_SORTS = ["desc", "asc", "label"];
// Top N categories (0 = all of them, up to the limit of the type).
export const CARD_TOPS = [5, 10, 20, 0];
export const CARD_AGGS = ["sum", "avg", "count", "min", "max"];
const CARD_SIZES = ["half", "full"];
export const LIMIT_CARDS = 12;
export const LIMIT_SLICERS = 8;
const LIMIT_SERIES = 7;
const LIMIT_VALUES = 200;
const LIMIT_CARD_FILTERS = 4;
const LIMIT_TITLE = 140;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,24}$/;

/** Strings of a list, each once (a card's series): unlike view_state's str_list, which keeps repeats. */
function unique_str_list(v, limit) {
	return Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string"))].slice(0, limit) : [];
}

/** A value of a category or a slicer: text, number, boolean or null (nothing else). */
function is_value(v) {
	return v === null || typeof v === "string" || typeof v === "boolean" || Number.isFinite(v);
}

function values_of(v) {
	return Array.isArray(v) ? v.filter(is_value).slice(0, LIMIT_VALUES) : null;
}

function sanitize_card(c, used) {
	if (!c || typeof c !== "object") return null;
	let id = typeof c.id === "string" && ID_RE.test(c.id) && !used.has(c.id) ? c.id : null;
	if (!id) {
		let n = used.size + 1;
		while (used.has(`c${n}`)) n += 1;
		id = `c${n}`;
	}
	used.add(id);
	const filter = Array.isArray(c.filter)
		? c.filter
				.filter((f) => f && typeof f.key === "string" && Array.isArray(f.values))
				.slice(0, LIMIT_CARD_FILTERS)
				.map((f) => ({ key: f.key, values: values_of(f.values) }))
		: [];
	const title = typeof c.title === "string" ? c.title.trim().slice(0, LIMIT_TITLE) : "";
	return {
		id,
		type: CARD_TYPES.includes(c.type) ? c.type : "bar",
		x: typeof c.x === "string" ? c.x : null,
		series: unique_str_list(c.series, LIMIT_SERIES),
		agg: CARD_AGGS.includes(c.agg) ? c.agg : null,
		sort: CARD_SORTS.includes(c.sort) ? c.sort : null,
		top: CARD_TOPS.includes(c.top) ? c.top : null,
		size: CARD_SIZES.includes(c.size) ? c.size : "half",
		title: title || null,
		filter,
	};
}

function sanitize_slicer(s) {
	if (!s || typeof s !== "object" || typeof s.key !== "string") return null;
	if (s.type === "date") {
		const d = (v) => (typeof v === "string" && DATE_RE.test(v) ? v : null);
		return { key: s.key, type: "date", from: d(s.from), to: d(s.to) };
	}
	return { key: s.key, type: "set", values: values_of(s.values) };
}

/**
 * A clean copy of a dashboard (from a URL, the user settings or the page). Never throws.
 * @returns {null|{cards: Array, slicers: Array, cross: object|null}}
 */
export function sanitize_dashboard(v) {
	if (!v || typeof v !== "object" || !Array.isArray(v.cards)) return null;
	const used = new Set();
	const cards = v.cards
		.slice(0, LIMIT_CARDS)
		.map((c) => sanitize_card(c, used))
		.filter(Boolean);
	const keys = new Set();
	const slicers = (Array.isArray(v.slicers) ? v.slicers : [])
		.map(sanitize_slicer)
		.filter((s) => s && !keys.has(s.key) && keys.add(s.key))
		.slice(0, LIMIT_SLICERS);
	const c = v.cross;
	const cross =
		c && typeof c === "object" && typeof c.card === "string" && typeof c.key === "string" && is_value(c.value)
			? { card: c.card, key: c.key, value: c.value }
			: null;
	return { cards, slicers, cross: cross && cards.some((k) => k.id === cross.card) ? cross : null };
}

/** A new card id that is not used yet. */
export function new_card_id(cards) {
	const used = new Set((cards || []).map((c) => c.id));
	let n = used.size + 1;
	while (used.has(`c${n}`)) n += 1;
	return `c${n}`;
}
