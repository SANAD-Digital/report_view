// Small engine queries next to the main view (docs/architecture.md §8أ.4-§8أ.6): unique
// values, totals, counts, depth. Every temporary view is deleted in `finally`
// (EngineHandles.with_view). The pivot total column arrives with the pivot view.
//
// range_stats is the one named exception to "no calculation outside the engine": it
// summarises the cells of a selected range that are already on screen.

import { KIND, SORT_PREFIX } from "./schema.js";
import { LEVELS } from "./tree_nodes.js";

export const MAX_UNIQUE_VALUES = 5000;
const ROW_PATH = "__ROW_PATH__";

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

/** Number of rows of a table that pass a filter. */
export function count_rows(handles, table, filter) {
	return handles.with_view(table, { columns: [KIND], filter }, (view) => view.num_rows(), "count");
}

/** Number of group rows of a grouping (all levels, without the grand total row). */
export function count_groups(handles, table, config) {
	return handles.with_view(table, config, async (view) => (await view.num_rows()) - 1, "groups");
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

/** Opens a grouped view down to post.depth. */
export async function set_depth(view, post) {
	await view.set_depth(post.depth);
	if (post.shape === "levels") await close_filled_levels(view, post);
}

/** Opens or closes the group at a view row; returns nothing, the caller re-reads the rows. */
export async function toggle_group(view, post, row, open) {
	if (open) await view.expand(row);
	else await view.collapse(row);
	if (open && post.shape === "levels") await close_filled_levels(view, post);
}

/**
 * Unique values of a column with their row count, under the other active filters (§8أ.4).
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
