// N9: the two tables of a tree report (docs/architecture.md §3.2أ). Pure module.
// - nodes: every tree row of the report as it came (parents and leaves, in report order),
//   used for the "as is" tree. Their values are the report's own values.
// - facts: the leaves only, with level columns from the parent chain, used for everything
//   Perspective computes (user grouping, filters, pivot, charts).
import { has_value } from "./columns_util.js";

export const DEPTH = "__depth";
export const HAS_CHILDREN = "__has_children";
export const LEAVES = "__leaves";
export const PATH = "__path";
export const TOP = "__top";
export const LEVELS = "__levels";
export const ANC_PREFIX = "__anc_";
export const LEVEL_PREFIX = "level_";

const NODE_KINDS = new Set(["data", "group_header"]);

/** Text that names a tree row: its label column, else its first dimension with a value. */
export function row_label(row, label_key, columns) {
	if (label_key && has_value(row[label_key])) return String(row[label_key]);
	for (const c of columns) {
		if (c.role === "dimension" && has_value(row[c.key])) return String(row[c.key]);
	}
	return null;
}

/**
 * Structure of the report tree, from __parent (N4.3).
 * @returns {{rows: Array, info: Map<number, object>, max_depth: number}} info per __rid:
 *   {index, kind, depth, parent, ancestors: [rid...] top-down, has_children, leaves, top}
 */
export function tree_index(normalized) {
	const rows = normalized.rows.filter((r) => NODE_KINDS.has(r.__kind));
	const info = new Map();
	let max_depth = 0;
	rows.forEach((row, index) => {
		const up = row.__parent === null || row.__parent === undefined ? null : info.get(row.__parent);
		const ancestors = up ? [...up.ancestors, row.__parent] : [];
		// A group header carries no values: the data rows right below it are still "topmost".
		const data_above = up ? up.kind === "data" || up.data_above : false;
		info.set(row.__rid, {
			index,
			kind: row.__kind,
			depth: ancestors.length,
			parent: up ? row.__parent : null,
			ancestors,
			has_children: false,
			leaves: 0,
			data_above,
			top: row.__kind === "data" && !data_above,
		});
		if (up) up.has_children = true;
		max_depth = Math.max(max_depth, ancestors.length);
	});
	for (const node of info.values()) {
		if (node.has_children) continue;
		for (const rid of node.ancestors) info.get(rid).leaves += 1;
	}
	return { rows, info, max_depth };
}

/**
 * Nodes table input: the tree rows and their technical columns
 * (__depth, __has_children, __leaves, __path, __top, __anc_1..n).
 */
export function build_nodes(normalized) {
	const { rows, info, max_depth } = tree_index(normalized);
	const of = (row) => info.get(row.__rid);
	const extras = [
		{ name: DEPTH, type: "float", values: rows.map((r) => of(r).depth) },
		{ name: HAS_CHILDREN, type: "boolean", values: rows.map((r) => of(r).has_children) },
		{ name: LEAVES, type: "float", values: rows.map((r) => of(r).leaves) },
		{ name: PATH, type: "float", values: rows.map((r) => of(r).index) },
		{ name: TOP, type: "boolean", values: rows.map((r) => of(r).top) },
	];
	for (let level = 1; level <= max_depth; level++) {
		extras.push({
			name: ANC_PREFIX + level,
			type: "float",
			values: rows.map((r) => of(r).ancestors[level - 1] ?? null),
		});
	}
	return { rows, extras, max_depth, info };
}

/**
 * Facts table input of a tree report: the leaves with level_1..n (labels of the ancestors,
 * top-down). In a tree of uneven depth the missing levels take the label of the leaf itself,
 * so that no null node appears; __levels tells how many levels are real ancestors.
 *
 * @returns {{rows, extras, level_names, level_rids: Map<string, number>}} level_rids maps
 *   JSON.stringify(path of labels) to the __rid of the report row of that node.
 */
export function build_facts(normalized) {
	const { info, max_depth } = tree_index(normalized);
	const label_key = normalized.tree?.label_key || null;
	const by_rid = new Map(normalized.rows.map((r) => [r.__rid, r]));
	const label_of = (rid) => row_label(by_rid.get(rid), label_key, normalized.columns);
	const rows = normalized.facts.filter((r) => info.has(r.__rid));
	const level_names = Array.from({ length: max_depth }, (_, i) => LEVEL_PREFIX + (i + 1));
	const level_rids = new Map();
	const chains = rows.map((row) => {
		const node = info.get(row.__rid);
		const labels = node.ancestors.map(label_of);
		node.ancestors.forEach((rid, i) => level_rids.set(JSON.stringify(labels.slice(0, i + 1)), rid));
		const own = label_of(row.__rid);
		const padded = [...labels];
		while (padded.length < max_depth) {
			padded.push(own);
			level_rids.set(JSON.stringify(padded), row.__rid);
		}
		return { padded, real: labels.length, index: node.index };
	});
	const extras = level_names.map((name, i) => ({
		name,
		type: "string",
		values: chains.map((c) => c.padded[i]),
	}));
	extras.push({ name: PATH, type: "float", values: chains.map((c) => c.index) });
	extras.push({ name: LEVELS, type: "float", values: chains.map((c) => c.real) });
	return { rows, extras, level_names, level_rids };
}
