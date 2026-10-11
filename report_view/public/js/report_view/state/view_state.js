// View state v1 (docs/architecture.md §7.1), the subset used so far: mode (grid, pivot, charts, pages), columns (order,
// hidden, widths, pinned, groups), sort, filters, quick_filters, group (by, subtotals, expanded),
// tree (depth, expanded), values, charts (cards, slicers, cross), pivot (rows, cols, values), ui (density, side_panel). Unknown
// keys are dropped (not rejected) in the browser.

import { sanitize_groups } from "./column_groups.js";
import { sanitize_dashboard } from "./dashboard_state.js";

export const VERSION = 1;
const MODES = ["grid", "pivot", "charts", "pages"];
const LIMIT_GROUP = 50;
const DENSITIES = ["comfortable", "compact"];
const LIMIT_EXPANDED = 5000;
const AGGS = ["sum", "avg", "count", "count_distinct", "min", "max"];
const SIDE_PANELS = ["columns", "filters"];
export const MIN_COLUMN_WIDTH = 72;

// A group path: the values of the group keys, top-down (strings, numbers, booleans or null).
function is_path(path, depth) {
	return (
		Array.isArray(path) &&
		path.length > 0 &&
		path.length <= depth &&
		path.every((v) => v === null || ["string", "boolean"].includes(typeof v) || Number.isFinite(v))
	);
}

// The default view of a report: register.default_hidden hides columns the report shows
// (a column that repeats the tree, an enrichment field of less interest).
export function default_state(config = {}) {
	return {
		v: VERSION,
		mode: MODES.includes(config.default_mode) ? config.default_mode : "grid",
		report_filters: {},
		// groups: null = the report's own header groups (register bands)
		columns: { order: [], hidden: str_list(config.default_hidden), widths: {}, pinned: { start: [], end: [] }, groups: null },
		sort: [],
		filters: [],
		quick_filters: [],
		group: { by: [], subtotals: true, expanded: "all" },
		tree: { depth: null, expanded: null },
		values: [],
		// null = the report's default dashboard (engine/chart_config.js default_cards)
		charts: null,
		// null = the report's default pivot (engine/pivot_config.js default_pivot)
		pivot: null,
		ui: { density: "comfortable", side_panel: null },
	};
}

function str_list(v, limit = 500) {
	return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, limit) : [];
}

// Returns a clean copy of `state` on top of the defaults. Never throws.
export function sanitize(state, config = {}) {
	const base = default_state(config);
	if (!state || typeof state !== "object") return base;
	if (typeof state.v === "number" && state.v > VERSION) return { ...base, __newer: true };

	const out = base;
	if (MODES.includes(state.mode)) out.mode = state.mode;
	if (state.report_filters && typeof state.report_filters === "object") {
		out.report_filters = { ...state.report_filters };
	}
	const cols = state.columns || {};
	out.columns.order = str_list(cols.order);
	if (Array.isArray(cols.hidden)) out.columns.hidden = str_list(cols.hidden);
	if (cols.widths && typeof cols.widths === "object") {
		for (const [k, w] of Object.entries(cols.widths)) {
			if (Number.isFinite(w) && w > 0) out.columns.widths[k] = Math.max(MIN_COLUMN_WIDTH, Math.round(w));
		}
	}
	if (cols.pinned) {
		out.columns.pinned.start = str_list(cols.pinned.start);
		out.columns.pinned.end = str_list(cols.pinned.end);
	}
	out.columns.groups = sanitize_groups(cols.groups);
	if (Array.isArray(state.sort)) {
		out.sort = state.sort
			.filter((s) => s && typeof s.key === "string")
			.map((s) => ({ key: s.key, dir: s.dir === "desc" ? "desc" : "asc" }));
	}
	if (Array.isArray(state.filters)) out.filters = state.filters.filter((f) => f && typeof f.key === "string").slice(0, 200);
	out.quick_filters = str_list(state.quick_filters, 50);
	if (Array.isArray(state.values)) {
		out.values = state.values
			.filter((v) => v && typeof v.key === "string" && AGGS.includes(v.agg))
			.map((v) => ({ key: v.key, agg: v.agg }));
	}
	const group = state.group || {};
	out.group.by = str_list(group.by, LIMIT_GROUP);
	if (typeof group.subtotals === "boolean") out.group.subtotals = group.subtotals;
	if (group.expanded === "all" || group.expanded === "none") out.group.expanded = group.expanded;
	else if (Array.isArray(group.expanded)) {
		out.group.expanded = group.expanded.filter((p) => is_path(p, LIMIT_GROUP)).slice(0, LIMIT_EXPANDED);
	}
	const tree = state.tree || {};
	if (Number.isInteger(tree.depth) && tree.depth >= 0) out.tree.depth = tree.depth;
	if (Array.isArray(tree.expanded)) {
		out.tree.expanded = tree.expanded.filter((rid) => Number.isInteger(rid) && rid >= 0).slice(0, LIMIT_EXPANDED);
	}
	out.charts = sanitize_dashboard(state.charts);
	out.pivot = sanitize_pivot(state.pivot);
	if (DENSITIES.includes(state.ui?.density)) out.ui.density = state.ui.density;
	if (SIDE_PANELS.includes(state.ui?.side_panel)) out.ui.side_panel = state.ui.side_panel;
	return out;
}

const PIVOT_AGGS = ["sum", "avg", "count", "min", "max"];
const LIMIT_PIVOT = 20;

// pivot: {rows: [key], cols: [key], values: [{key, agg}], totals: {rows, cols}} (§7.1), or
// null for the report's default one. Keys are checked against the report later
// (engine/pivot_config.js resolve_pivot): tree levels are not report columns.
function sanitize_pivot(pivot) {
	if (!pivot || typeof pivot !== "object") return null;
	const values = Array.isArray(pivot.values)
		? pivot.values
				.filter((v) => v && typeof v.key === "string" && PIVOT_AGGS.includes(v.agg))
				.map((v) => ({ key: v.key, agg: v.agg }))
				.slice(0, LIMIT_PIVOT)
		: [];
	return {
		rows: str_list(pivot.rows, LIMIT_PIVOT),
		cols: str_list(pivot.cols, LIMIT_PIVOT),
		values,
		totals: { rows: pivot.totals?.rows !== false, cols: pivot.totals?.cols !== false },
	};
}

// Drops references to columns that no longer exist in the report (§7.3, silent in phase 3).
export function reconcile(state, columns) {
	const keys = new Set(columns.map((c) => c.key));
	const keep = (list) => list.filter((k) => keys.has(k));
	state.columns.order = keep(state.columns.order);
	state.columns.hidden = keep(state.columns.hidden);
	state.columns.pinned.start = keep(state.columns.pinned.start);
	state.columns.pinned.end = keep(state.columns.pinned.end);
	state.columns.widths = Object.fromEntries(Object.entries(state.columns.widths).filter(([k]) => keys.has(k)));
	state.sort = state.sort.filter((s) => keys.has(s.key));
	state.group.by = keep(state.group.by);
	state.values = (state.values || []).filter((v) => keys.has(v.key));
	return state;
}
