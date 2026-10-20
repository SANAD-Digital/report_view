// Small engine queries next to the main view (docs/architecture.md §8أ.4-§8أ.6): unique
// values, totals, counts, depth. Every temporary view is deleted in `finally`
// (EngineHandles.with_view). The pivot total column arrives with the pivot view.
//
// range_stats is the one named exception to "no calculation outside the engine": it
// summarises the cells of a selected range that are already on screen.

import { KIND, SORT_PREFIX, RID as RID_COL } from "./schema.js";
import { DEPTH, LEVELS } from "./tree_nodes.js";

export const MAX_UNIQUE_VALUES = 5000;
export const ROW_PATH = "__ROW_PATH__";

/**
 * Runs of neighbouring view columns that hold some named columns: what one to_columns()
 * call each reads. Names the view does not have are left out.
 * @param {object} index {column: index in the view} (post.index)
 * @returns {Array<[number, number]>} [start_col, end_col) pairs
 */
export function column_runs(index, names) {
	const at = [...new Set(names.map((name) => index[name]).filter((i) => Number.isInteger(i)))].sort((a, b) => a - b);
	const runs = [];
	for (const i of at) {
		const last = runs[runs.length - 1];
		if (last && last[1] === i) last[1] = i + 1;
		else runs.push([i, i + 1]);
	}
	return runs;
}

/**
 * Some named columns of a view, from `start_row` to `end_row` (the end of the view when
 * omitted), as one object {column: values}; a grouped view adds its __ROW_PATH__.
 */
export async function read_columns(view, index, names, start_row = 0, end_row = undefined) {
	const runs = column_runs(index, names);
	const window = (start_col, end_col) => (end_row === undefined ? { start_row, start_col, end_col } : { start_row, end_row, start_col, end_col });
	if (!runs.length) return view.to_columns(window(0, 0));
	const parts = await Promise.all(runs.map(([a, b]) => view.to_columns(window(a, b))));
	return Object.assign({}, ...parts);
}

/** Row 0 of a grouped view (its grand total) as {column: value}. */
export async function read_total_row(view) {
	const cols = await view.to_columns({ start_row: 0, end_row: 1 });
	const out = {};
	for (const [name, values] of Object.entries(cols)) {
		if (name !== ROW_PATH) out[name] = values[0] ?? null;
	}
	return out;
}

/** Totals of a table under a filter: a temporary grouped view, read at row 0. */
export function totals(handles, table, config) {
	return handles.with_view(table, config, read_total_row, "totals");
}

/** Number of rows of a table that pass a filter (and the expressions it refers to). */
export function count_rows(handles, table, filter, expressions = {}) {
	return handles.with_view(table, { columns: [KIND], filter, expressions }, (view) => view.num_rows(), "count");
}

/** Number of group rows of a grouping (all levels, without the grand total row). */
export function count_groups(handles, table, config) {
	return handles.with_view(table, config, async (view) => (await view.num_rows()) - 1, "groups");
}

/**
 * Value tuples of the groups at one depth of a grouping (the row paths of a temporary
 * grouped view, deleted in `finally`): what the pivot needs to read its column paths apart.
 * @returns {Promise<Array<Array>>}
 */
export function group_paths(handles, table, config, depth) {
	return handles.with_view(
		table,
		config,
		async (view) => {
			const cols = await view.to_columns({ start_row: 1, start_col: 0, end_col: 0 });
			return (cols[ROW_PATH] || []).filter((path) => path.length === depth);
		},
		"paths"
	);
}

/** Rows of the body: a grouped view carries its grand total as row 0, shown pinned instead. */
export async function body_rows(view, post) {
	return Math.max(0, (await view.num_rows()) - post.row_offset);
}

/**
 * In a tree of uneven depth a leaf fills its missing levels itself (N9): the first of those
 * rows stands for the leaf and stays closed, so the copies below it never show.
 */
async function close_filled_levels(view, post) {
	const first = post.index[LEVELS];
	const cols = await view.to_columns({ start_col: first, end_col: first + 1 });
	const paths = cols[ROW_PATH];
	const levels = cols[LEVELS];
	for (let i = paths.length - 1; i > 0; i--) {
		const depth = paths[i].length;
		const open = i + 1 < paths.length && paths[i + 1].length > depth;
		if (open && depth <= post.group_keys.length && depth === levels[i] + 1) await view.collapse(i);
	}
}

/** __ROW_PATH__ of the body rows of a grouped view (without its grand total row). */
async function body_paths(view) {
	const cols = await view.to_columns({ start_row: 1, start_col: 0, end_col: 0 });
	return cols[ROW_PATH] || [];
}

/**
 * Opens the listed groups of a grouped view that is closed down to its first level. A level
 * at a time, from the last row up, so that the row indices read for a level stay valid.
 * @param {(path: Array) => boolean} is_open
 */
async function open_groups(view, post, is_open) {
	for (let level = 1; level <= post.group_keys.length; level++) {
		const paths = await body_paths(view);
		const targets = [];
		for (let i = paths.length - 1; i >= 0; i--) {
			if (paths[i].length === level && is_open(paths[i])) targets.push(i + 1);
		}
		if (!targets.length) return;
		await Promise.all(targets.map((row) => view.expand(row)));
	}
}

/**
 * Folds a grouped view as the view state says: down to post.depth, or the listed groups
 * (group.expanded as paths; tree.expanded as the __rid of the open parents of a re-grouped
 * tree, found through `level_rids`).
 */
export async function set_depth(view, post, level_rids = null) {
	const tree_open = post.shape === "levels" && Array.isArray(post.tree?.expanded) && level_rids ? post.tree.expanded : null;
	if (post.expanded) {
		const open = new Set(post.expanded.map((path) => JSON.stringify(path)));
		await view.set_depth(0);
		await open_groups(view, post, (path) => open.has(JSON.stringify(path)));
	} else if (tree_open) {
		// A leaf that fills a missing level is no parent: it is never in the list, so it stays closed.
		const open = new Set(tree_open.map(Number));
		await view.set_depth(0);
		await open_groups(view, post, (path) => open.has(level_rids.get(JSON.stringify(path))));
	} else {
		await view.set_depth(post.depth);
		if (post.shape === "levels") await close_filled_levels(view, post);
	}
}

/**
 * Depth of every body row, in view order, and the row paths of a grouped view: what the grid
 * needs to place the subtotal rows and to know which groups are open (engine/row_layout.js).
 * @returns {Promise<{depths: Array<number>, paths: Array<Array>|null}>}
 */
export async function row_depths(view, post) {
	if (post.row_offset) {
		const paths = await body_paths(view);
		return { depths: paths.map((path) => path.length), paths };
	}
	if (post.shape !== "tree") return { depths: null, paths: null };
	const at = post.index[DEPTH];
	const cols = await view.to_columns({ start_col: at, end_col: at + 1 });
	return { depths: cols[DEPTH] || [], paths: null };
}

/** Opens or closes the group at a view row; returns nothing, the caller re-reads the rows. */
export async function toggle_group(view, post, row, open) {
	if (open) await view.expand(row);
	else await view.collapse(row);
	if (open && post.shape === "levels") await close_filled_levels(view, post);
}

/**
 * Unique values of a column with their row count, under the other active filters (§8أ.4).
 * opts: {limit, string (false for a non-text column), search (contains), expressions (those
 * the other filters refer to)}.
 * @returns {Promise<{values: Array<{value: any, count: number}>, truncated: boolean}>}
 */
export function unique_values(handles, table, key, other_filters = [], opts = {}) {
	const limit = opts.limit || MAX_UNIQUE_VALUES;
	const sort_key = opts.string === false ? key : SORT_PREFIX + key;
	const filter = opts.search ? [...other_filters, [key, "contains", String(opts.search)]] : other_filters;
	const config = {
		group_by: [key],
		columns: [key, ...(sort_key === key ? [] : [sort_key])],
		aggregates: { [key]: "count", ...(sort_key === key ? {} : { [sort_key]: "min" }) },
		filter,
		sort: sort_key === key ? [] : [[sort_key, "asc"]],
		expressions: opts.expressions || {},
	};
	return handles.with_view(
		table,
		config,
		async (view) => {
			const total = (await view.num_rows()) - 1;
			const cols = await view.to_columns({ start_row: 1, end_row: 1 + limit, start_col: 0, end_col: 1 });
			const values = cols[ROW_PATH].map((path, i) => ({ value: path[0] ?? null, count: cols[key][i] }));
			return { values, truncated: total > limit };
		},
		"unique"
	);
}

/**
 * Count, sum, average, lowest and highest of the numeric cells of a view window (§8أ.5).
 * @param {object} window {start_row, end_row, start_col, end_col} in view coordinates
 */
export async function range_stats(view, window) {
	const cols = await view.to_columns(window);
	let count = 0;
	let sum = 0;
	let min = null;
	let max = null;
	for (const [name, values] of Object.entries(cols)) {
		if (name === ROW_PATH) continue;
		for (const v of values) {
			if (typeof v !== "number" || !Number.isFinite(v)) continue;
			count += 1;
			sum += v;
			min = min === null || v < min ? v : min;
			max = max === null || v > max ? v : max;
		}
	}
	return { count, sum, avg: count ? sum / count : null, min, max };
}

/**
 * Data of a card view (engine/chart_config.js to_card_config) as ECharts takes it: the
 * categories and one array per measure, read once from the view (§11.1 #69), within the
 * rows the card shows. Nothing is computed here: the values are the view's, a category that
 * mixes currencies keeps no value (as in the grid). Row 0 of the grouped view is its total.
 * @returns {Promise<{categories: Array, rids: Array|null, series: object, currencies: object,
 *   mixed: object, pct: object, total: object}>} currencies: {measure: [currency per category]}
 */
export async function card_columns(view, post) {
	const cols = await view.to_columns({ start_row: 0, end_row: post.row_offset + post.limit });
	const at = (values) => (values || []).slice(post.row_offset);
	const paths = at(cols[ROW_PATH]);
	let categories = [];
	if (post.route === "nodes") categories = at(post.label_key ? cols[post.label_key] : cols[RID_COL]);
	else if (post.route === "facts") categories = paths.map((p) => p[p.length - 1] ?? null);
	const series = {};
	const currencies = {};
	const mixed = {};
	const pct = {};
	const total = {};
	for (const key of post.series) {
		const ck = post.currency[key] || null;
		const count_col = ck ? post.currency_counts[ck] : null;
		const counts = count_col ? at(cols[count_col]) : null;
		mixed[key] = counts ? counts.map((n) => (n || 0) > 1) : categories.map(() => false);
		series[key] = at(cols[key]).map((v, i) => (mixed[key][i] || typeof v !== "number" || !Number.isFinite(v) ? null : v));
		currencies[key] = ck ? at(cols[ck]).map((c) => c || null) : categories.map(() => null);
		if (post.pct[key]) pct[key] = at(cols[post.pct[key]]).map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
		const many = count_col ? (cols[count_col]?.[0] || 0) > 1 : false;
		const v = cols[key]?.[0];
		total[key] = { value: many || typeof v !== "number" || !Number.isFinite(v) ? null : v, currency: ck ? cols[ck]?.[0] || null : null, mixed: many };
	}
	return { categories, rids: post.route === "totals" ? null : at(cols[RID_COL]), series, currencies, mixed, pct, total };
}
