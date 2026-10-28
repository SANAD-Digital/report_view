// What a report shows (Report View Settings, ADR-023): the `features` object of the server's
// settings (get_meta.settings.features), made complete and valid here, and the view state
// held to it. Pure module: no frappe, no DOM. Every flag is on by default, so a report
// without settings looks as before; a flag that is off hides its control (the page), and
// the view state never asks for what is off (a link, the user settings), so the engine never
// builds it (no pivot view, no chart of a type turned off).

import { CARD_TYPES } from "./dashboard_state.js";

export const FEATURES = [
	"grouping",
	"subtotals",
	"quick_search",
	"column_filters",
	"set_filters",
	"filters_panel",
	"quick_filters",
	"period_picker",
	"side_panel",
	"columns_panel",
	"pinning",
	"column_groups",
	"pivot",
	"charts",
	"pages",
	"excel",
	"density",
];

const MODES = ["grid", "pivot", "charts", "pages"];
// the feature each view needs (the table is always there)
const MODE_FEATURE = { pivot: "pivot", charts: "charts", pages: "pages" };

/** A complete features object: unknown keys dropped, a missing or non-boolean flag on. */
export function sanitize_features(raw) {
	const src = raw && typeof raw === "object" ? raw : {};
	const out = {};
	for (const k of FEATURES) out[k] = src[k] !== false && src[k] !== 0;
	out.chart_types = Array.isArray(src.chart_types) ? CARD_TYPES.filter((t) => src.chart_types.includes(t)) : [...CARD_TYPES];
	// charts with no type left to draw: no charts
	if (!out.chart_types.length) out.charts = false;
	// a side panel without any of its tabs is no side panel, and the other way round
	if (!out.columns_panel && !out.filters_panel) out.side_panel = false;
	if (!out.side_panel) {
		out.columns_panel = false;
		out.filters_panel = false;
	}
	return out;
}

/** The views a report offers: the table always, the others as their flags (Pages also needs print). */
export function allowed_modes(features, can_print = true) {
	return MODES.filter((m) => !MODE_FEATURE[m] || (features[MODE_FEATURE[m]] && (m !== "pages" || can_print)));
}

function keys(v) {
	return Array.isArray(v) ? v.filter((k) => typeof k === "string" && k) : [];
}

/**
 * The page's configuration: report_view.register's, with the server's default view over it
 * (Report View Settings wins over register, docs/architecture.md §5.3) and the features.
 * A default the features turn off is not a default.
 */
export function server_config(register, settings, features, can_print = true) {
	const config = { ...(register || {}) };
	const view = settings?.default_view || {};
	const modes = allowed_modes(features, can_print);
	const mode = MODES.includes(settings?.default_mode) ? settings.default_mode : config.default_mode;
	config.default_mode = modes.includes(mode) ? mode : "grid";
	if (keys(view.hidden).length) config.default_hidden = keys(view.hidden);
	config.default_group_by = features.grouping ? keys(view.group_by) : [];
	config.default_pinned = features.pinning ? keys(view.pinned) : [];
	if (!features.quick_filters) config.quick_filters = [];
	if (!features.period_picker) config.period = false;
	if (!features.set_filters) config.search_facet = null;
	config.features = features;
	return config;
}

/** The cards of a dashboard whose type is allowed (a saved card of another type is dropped). */
export function allowed_cards(cards, types) {
	return (cards || []).filter((c) => types.includes(c.type));
}

/**
 * Holds a (sanitized) view state to the features, in place: a view that is off falls back to
 * the default one, and what an off control would have set is cleared.
 * @returns {object} the same state
 */
export function restrict_state(state, features, { can_print = true, default_mode = "grid" } = {}) {
	if (!state) return state;
	const modes = allowed_modes(features, can_print);
	if (!modes.includes(state.mode)) state.mode = modes.includes(default_mode) ? default_mode : "grid";
	if (!features.pivot) state.pivot = null;
	if (!features.charts) state.charts = null;
	else if (state.charts) {
		state.charts.cards = allowed_cards(state.charts.cards, features.chart_types);
		if (state.charts.cross && !state.charts.cards.some((c) => c.id === state.charts.cross.card)) state.charts.cross = null;
	}
	if (!features.grouping) {
		state.group.by = [];
		state.group.expanded = "all";
	}
	if (!features.subtotals) state.group.subtotals = false;
	if (!features.pinning) state.columns.pinned = { start: [], end: [] };
	if (!features.column_groups) state.columns.groups = null;
	if (!features.quick_filters) state.quick_filters = [];
	// the browser filters come from the column filters, the filters panel and the search
	if (!features.column_filters && !features.filters_panel && !features.quick_search) state.filters = [];
	else if (!features.set_filters) state.filters = state.filters.filter((f) => f.type !== "set");
	const side = state.ui?.side_panel;
	if (side && (!features.side_panel || (side === "columns" && !features.columns_panel) || (side === "filters" && !features.filters_panel))) {
		state.ui.side_panel = null;
	}
	if (!features.density && state.ui) state.ui.density = "comfortable";
	return state;
}
