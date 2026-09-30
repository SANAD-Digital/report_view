// View state v1 (docs/architecture.md §7.1), minimal subset used in phase 3:
// mode, columns, sort, group, tree, ui.density. Unknown keys are dropped (not rejected) in the browser.

export const VERSION = 1;
const MODES = ["grid", "pivot", "charts"];
const LIMIT_GROUP = 50;
const DENSITIES = ["comfortable", "compact"];

export function default_state(config = {}) {
	return {
		v: VERSION,
		mode: MODES.includes(config.default_mode) ? config.default_mode : "grid",
		report_filters: {},
		columns: { order: [], hidden: [], widths: {}, pinned: { start: [], end: [] } },
		sort: [],
		filters: [],
		group: { by: [], subtotals: true, expanded: "all" },
		tree: { depth: null, expanded: null },
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
	out.columns.hidden = str_list(cols.hidden);
	if (cols.widths && typeof cols.widths === "object") {
		for (const [k, w] of Object.entries(cols.widths)) {
			if (Number.isFinite(w) && w > 0) out.columns.widths[k] = Math.round(w);
		}
	}
	if (cols.pinned) {
		out.columns.pinned.start = str_list(cols.pinned.start);
		out.columns.pinned.end = str_list(cols.pinned.end);
	}
	if (Array.isArray(state.sort)) {
		out.sort = state.sort
			.filter((s) => s && typeof s.key === "string")
			.map((s) => ({ key: s.key, dir: s.dir === "desc" ? "desc" : "asc" }));
	}
	if (Array.isArray(state.filters)) out.filters = state.filters.slice(0, 200);
	const group = state.group || {};
	out.group.by = str_list(group.by, LIMIT_GROUP);
	if (typeof group.subtotals === "boolean") out.group.subtotals = group.subtotals;
	if (group.expanded === "all" || group.expanded === "none" || Array.isArray(group.expanded)) {
		out.group.expanded = group.expanded;
	}
	const tree = state.tree || {};
	if (Number.isInteger(tree.depth) && tree.depth >= 0) out.tree.depth = tree.depth;
	if (Array.isArray(tree.expanded)) out.tree.expanded = tree.expanded;
	if (DENSITIES.includes(state.ui?.density)) out.ui.density = state.ui.density;
	return out;
}

// Drops references to columns that no longer exist in the report (§7.3, silent in phase 3).
export function reconcile(state, columns) {
	const keys = new Set(columns.map((c) => c.key));
	const keep = (list) => list.filter((k) => keys.has(k));
	state.columns.order = keep(state.columns.order);
	state.columns.hidden = keep(state.columns.hidden);
	state.sort = state.sort.filter((s) => keys.has(s.key));
	state.group.by = keep(state.group.by);
	return state;
}
