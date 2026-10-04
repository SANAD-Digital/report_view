// View state -> Perspective view config (docs/architecture.md §8أ.2). Pure module.
// Panels and controls only edit the view state; this is the one place that turns it into
// group_by / columns / aggregates / filter / sort / expressions. `post` holds what the
// config cannot say and the data model applies without computing anything.

import { RID, KIND, SORT_PREFIX, perspective_type } from "./schema.js";
import { DEPTH, HAS_CHILDREN, LEAVES, PATH, TOP, LEVELS, ANC_PREFIX, LEVEL_PREFIX, tree_index } from "./tree_nodes.js";
import { edge_rows } from "./report_rows.js";

// max -> high: Perspective's "max" returns null and "low" returns 0 when a null is present.
export const AGGREGATES = {
	sum: "sum",
	avg: "avg",
	count: "count",
	count_distinct: "distinct count",
	min: "min",
	max: "high",
};
export const CURRENCY_COUNT_PREFIX = "__curn__";
// Boolean expression column of a quick filter (register.quick_filters).
export const QUICK_PREFIX = "__qf__";

const TEXT_OPS = { contains: "contains", equals: "==", starts_with: "begins with" };

function empty(v) {
	return v === null || v === undefined || v === "";
}

/**
 * Columns of the report in their default order: the report's own order, with the columns an
 * enrichment added (they arrive last) placed right after the column they describe, so that
 * "Account Type" stands next to "Account" as in the design.
 */
export function ordered_columns(normalized) {
	const added = new Map();
	const base = [];
	for (const c of normalized.columns) {
		const source = c.enriched?.source;
		if (source && normalized.columns.some((o) => o.key === source && !o.enriched)) {
			if (!added.has(source)) added.set(source, []);
			added.get(source).push(c);
		} else base.push(c);
	}
	return base.flatMap((c) => [c, ...(added.get(c.key) || [])]);
}

/** Visible columns in display order (view_state.columns). */
export function visible_columns(normalized, view_state) {
	const hidden = new Set(view_state?.columns?.hidden || []);
	let cols = ordered_columns(normalized).filter((c) => !c.hidden && !hidden.has(c.key));
	const order = view_state?.columns?.order || [];
	if (order.length) {
		const pos = new Map(order.map((k, i) => [k, i]));
		cols = [...cols].sort((a, b) => (pos.get(a.key) ?? 1e6) - (pos.get(b.key) ?? 1e6));
	}
	return cols;
}

/**
 * Active quick filters (view_state.quick_filters) as boolean expression columns of the engine
 * and the filter terms on them. Definitions come from register.quick_filters:
 * {id, label, expression} where expression is a Perspective expression on column keys.
 * @returns {{filter: Array, expressions: object, notices: Array}}
 */
export function quick_filter_terms(view_state, definitions = []) {
	const by_id = new Map((definitions || []).map((q) => [q.id, q]));
	const filter = [];
	const expressions = {};
	const notices = [];
	for (const id of view_state?.quick_filters || []) {
		const def = by_id.get(id);
		if (!def || typeof def.expression !== "string") {
			notices.push({ code: "QUICK_FILTER_UNKNOWN", detail: id });
			continue;
		}
		const name = QUICK_PREFIX + id;
		expressions[name] = def.expression;
		filter.push([name, "==", true]);
	}
	return { filter, expressions, notices };
}

function aggregate_of(column, view_state) {
	const chosen = (view_state?.values || []).find((v) => v.key === column.key)?.agg;
	const agg = chosen || column.agg;
	if (column.role !== "measure" || !agg || column.original?.disable_total) return null;
	return AGGREGATES[agg] || null;
}

function row_currency_key(column) {
	return column.currency?.kind === "row" ? column.currency.key : null;
}

/** Engine column that orders `key`: the collator sort key of a string column, else itself. */
function sort_column(key, by_key) {
	const column = by_key.get(key);
	if (!column) return null;
	return perspective_type(column.fieldtype) === "string" ? SORT_PREFIX + key : key;
}

/**
 * Browser filters -> Perspective filter terms. No `between` and no filter_op "or": a range
 * is two terms, "or" inside one column is `in`. What cannot be said is reported, not guessed.
 */
export function to_filter(filters, columns) {
	const by_key = new Map(columns.map((c) => [c.key, c]));
	const filter = [];
	const notices = [];
	const skip = (f, code) => notices.push({ code, detail: f.key });
	for (const f of filters || []) {
		if (!f || typeof f !== "object") continue;
		const column = by_key.get(f.key);
		if (!column) {
			skip(f, f.key === "*" ? "FILTER_SEARCH_UNSUPPORTED" : "FILTER_UNKNOWN_COLUMN");
			continue;
		}
		const type = perspective_type(column.fieldtype);
		if (f.type === "set") {
			if (type !== "string") {
				skip(f, "FILTER_TYPE_MISMATCH");
				continue;
			}
			const values = (f.values || []).filter((v) => !empty(v)).map(String);
			const with_null = (f.values || []).some(empty);
			if (f.exclude) {
				if (values.length) filter.push([f.key, "not in", values]);
				if (with_null) filter.push([f.key, "is not null", null]);
			} else if (with_null && !values.length) {
				filter.push([f.key, "is null", null]);
			} else {
				// "(empty) or values" needs an "or" Perspective cannot express.
				if (with_null) skip(f, "FILTER_EMPTY_WITH_VALUES");
				filter.push([f.key, "in", values]);
			}
		} else if (f.type === "range") {
			if (type !== "float") {
				skip(f, "FILTER_TYPE_MISMATCH");
				continue;
			}
			if (Number.isFinite(f.min)) filter.push([f.key, ">=", f.min]);
			if (Number.isFinite(f.max)) filter.push([f.key, "<=", f.max]);
		} else if (f.type === "date") {
			if (type !== "date" && type !== "datetime") {
				skip(f, "FILTER_TYPE_MISMATCH");
				continue;
			}
			if (f.from) filter.push([f.key, ">=", f.from]);
			if (f.to) filter.push([f.key, "<=", type === "datetime" ? `${f.to} 23:59:59.999` : f.to]);
		} else {
			const op = TEXT_OPS[f.op || "contains"];
			if (type !== "string") skip(f, "FILTER_TYPE_MISMATCH");
			else if (!op) skip(f, "FILTER_OP_UNSUPPORTED");
			else if (!empty(f.value)) filter.push([f.key, op, String(f.value)]);
		}
	}
	return { filter, notices };
}

/**
 * Columns pinned at the start after the label column (columns.pinned.start): visible
 * dimension or attribute columns only. A measure cannot be pinned: a pinned cell shows the
 * report's own value of a row, and a group row has none for it.
 */
export function pinned_columns(visible, view_state) {
	const wanted = view_state?.columns?.pinned?.start || [];
	const by_key = new Map(visible.slice(1).map((c) => [c.key, c]));
	const out = [];
	for (const key of wanted) {
		const column = by_key.get(key);
		if (column && column.role !== "measure" && !out.includes(column)) out.push(column);
	}
	return out;
}

/** Depth to which the "as is" tree opens: rows down to this depth are shown. */
export function tree_depth(view_state, normalized) {
	return view_state?.tree?.depth ?? normalized.tree?.initial_depth ?? 2;
}

function expanded_set(view_state) {
	const list = view_state?.tree?.expanded;
	return Array.isArray(list) ? new Set(list.map(Number).filter(Number.isFinite)) : null;
}

/**
 * tree.expanded after the user opens or closes one node. `null` means "by depth"; the first
 * toggle turns it into the explicit list of open parents.
 */
export function toggle_tree_node(view_state, normalized, rid) {
	const { info } = tree_index(normalized);
	let open = expanded_set(view_state);
	if (!open) {
		const depth = tree_depth(view_state, normalized);
		open = new Set();
		for (const [id, node] of info) if (node.has_children && node.depth < depth) open.add(id);
	}
	if (open.has(rid)) open.delete(rid);
	else open.add(rid);
	return [...open].filter((id) => info.get(id)?.has_children).sort((a, b) => a - b);
}

/**
 * "Expand all" / "collapse all" (§11.1 #33) as a change of the view state: group.expanded of
 * a grouped view, else the depth of the report tree (short in the URL, whatever its size).
 * @returns {object|null} the keys of the view state to replace, null when nothing folds
 */
export function fold_all(view_state, normalized, open) {
	const by_key = new Set(normalized.columns.map((c) => c.key));
	if ((view_state?.group?.by || []).some((k) => by_key.has(k))) {
		return { group: { ...view_state.group, expanded: open ? "all" : "none" } };
	}
	if (!normalized.tree?.enabled) return null;
	return { tree: { depth: open ? tree_index(normalized).max_depth : 0, expanded: null } };
}

// Collapse of the "as is" tree, inside the engine: by depth while nothing was toggled, else
// `not in` on the ancestor columns for the closed parents whose own ancestors are all open.
function tree_filter(view_state, normalized) {
	const open = expanded_set(view_state);
	if (!open) return [[DEPTH, "<=", tree_depth(view_state, normalized)]];
	const { info } = tree_index(normalized);
	const closed = new Map();
	for (const [rid, node] of info) {
		if (!node.has_children || open.has(rid)) continue;
		if (!node.ancestors.every((a) => open.has(a))) continue;
		const level = node.depth + 1;
		if (!closed.has(level)) closed.set(level, []);
		closed.get(level).push(rid);
	}
	return [...closed.keys()].sort((a, b) => a - b).map((level) => [ANC_PREFIX + level, "not in", closed.get(level)]);
}

function unique(list) {
	return [...new Set(list)];
}

/**
 * @param {object} view_state §7.1
 * @param {object} normalized NormalizedReport
 * @param {"grid"|"pivot"|"charts"} [mode]
 * @param {object} [opts] {quick_filters: register.quick_filters}
 * @returns {{table: "nodes"|"rows"|"facts", config: object, post: object}}
 */
export function to_view_config(view_state, normalized, mode = "grid", opts = {}) {
	if (mode !== "grid") throw new Error(`report_view: view mode "${mode}" is not available yet`);
	const state = view_state || {};
	const by_key = new Map(normalized.columns.map((c) => [c.key, c]));
	const shown = visible_columns(normalized, state);
	// The label column, the pinned columns, then the others: the data columns of the grid are
	// neighbours in the view, so one window of the view is one window of the grid.
	const pinned = pinned_columns(shown, state);
	const visible = [...shown.slice(0, 1), ...pinned, ...shown.slice(1).filter((c) => !pinned.includes(c))];
	const keys = visible.map((c) => c.key);
	const group_keys = (state.group?.by || []).filter((k) => by_key.has(k));
	const column_filter = to_filter(state.filters, normalized.columns);
	const quick = quick_filter_terms(state, opts.quick_filters);
	const browser_filter = [...column_filter.filter, ...quick.filter];
	const notices = [...column_filter.notices, ...quick.notices];
	// Expressions the filter refers to: every view that applies the filter carries them.
	const filter_expressions = quick.expressions;
	const is_tree = Boolean(normalized.tree?.enabled);
	const user_sort = (state.sort || [])
		.filter((s) => by_key.has(s.key) && !group_keys.includes(s.key))
		.map((s) => [sort_column(s.key, by_key), s.dir === "desc" ? "desc" : "asc"]);
	// The report's own summary rows (a report without a tree): those of the whole report,
	// and the number of those of its own groups, between the facts.
	const edges = edge_rows(normalized);

	// "report" = the rows as the report returned them (rows table), the default view of a
	// report that has summary rows between its facts. A browser filter, a grouping or a sort
	// of the user reads the facts instead: the rows between them no longer stand for what is
	// shown (a sort breaks the groups they close).
	let shape = "flat";
	if (group_keys.length) shape = "group";
	else if (is_tree) shape = browser_filter.length ? "levels" : "tree";
	else if (edges.inner && !browser_filter.length && !user_sort.length) shape = "report";
	const totalled = visible.filter((c) => aggregate_of(c, state));
	const currency_keys = unique(totalled.map(row_currency_key).filter(Boolean));
	const currency_counts = currency_keys.filter((k) => !k.includes('"')).map((k) => CURRENCY_COUNT_PREFIX + k);
	const currency_expressions = Object.fromEntries(
		currency_keys.filter((k) => !k.includes('"')).map((k) => [CURRENCY_COUNT_PREFIX + k, `"${k}"`])
	);

	const config = { group_by: [], split_by: [], columns: [], aggregates: {}, filter: [], sort: [], expressions: {} };
	const post = {
		shape,
		keys,
		label_key: keys[0] ?? null,
		pinned_keys: pinned.map((c) => c.key),
		data_keys: keys.slice(1 + pinned.length),
		technical: [],
		row_offset: 0,
		group_keys: [],
		leaf_depth: null,
		depth: null,
		tree: null,
		level_names: [],
		measures: totalled.map((c) => c.key),
		currency_keys,
		subtotals: state.group?.subtotals !== false,
		expanded: null,
		pinned_rows: { top: [], bottom: [] },
		total: null,
		fact_filter: shape === "tree" ? [] : browser_filter,
		filter_expressions: shape === "tree" ? {} : filter_expressions,
		groups: null,
		notices,
	};

	const grouped_aggregates = () => {
		const out = {};
		for (const c of visible) out[c.key] = aggregate_of(c, state) || "unique";
		for (const k of currency_keys) if (!Object.hasOwn(out, k)) out[k] = "unique";
		for (const k of currency_counts) out[k] = "distinct count";
		return out;
	};
	const totals_view = (table, filter) => ({
		table,
		config: {
			group_by: [KIND],
			columns: unique([...post.measures, ...currency_keys, ...currency_counts]),
			aggregates: {
				...Object.fromEntries(totalled.map((c) => [c.key, aggregate_of(c, state)])),
				...Object.fromEntries(currency_keys.map((k) => [k, "unique"])),
				...Object.fromEntries(currency_counts.map((k) => [k, "distinct count"])),
			},
			filter,
			expressions: { ...currency_expressions, ...(filter.length ? filter_expressions : {}) },
		},
	});

	if (shape === "tree") {
		config.filter = tree_filter(state, normalized);
		config.sort = [[PATH, "asc"], ...user_sort];
		post.technical = [RID, DEPTH, HAS_CHILDREN, LEAVES];
		post.tree = { depth: tree_depth(state, normalized), expanded: state.tree?.expanded ?? null };
		const reference = normalized.report_totals?.internal?.at(-1) || null;
		if (reference) post.total = { source: "row", rid: reference.__rid };
		else if (normalized.report_totals?.frappe_total) post.total = { source: "frappe_total" };
		else post.total = { source: "view", view: totals_view("nodes", [[TOP, "==", true]]) };
		post.groups = { table: "nodes", filter: [[HAS_CHILDREN, "==", true]] };
	} else if (shape === "report") {
		// Every row of the report in its place, with the report's own values. The rows of the
		// whole report are pinned outside the body, so the view leaves them out.
		const pinned_rids = [...edges.top, ...edges.bottom, ...(edges.reference === null ? [] : [edges.reference])];
		config.filter = pinned_rids.length ? [[RID, "not in", pinned_rids]] : [];
		post.technical = [RID];
		post.pinned_rows = { top: edges.top, bottom: edges.bottom };
		post.total =
			edges.reference !== null ? { source: "row", rid: edges.reference } : { source: "view", view: totals_view("facts", []) };
	} else if (shape === "flat") {
		config.filter = browser_filter;
		config.expressions = { ...filter_expressions };
		config.sort = user_sort.length ? [...user_sort, [RID, "asc"]] : [];
		post.technical = [RID];
		post.total = { source: "view", view: totals_view("facts", browser_filter) };
		// The report's own summary rows stand for the whole report: with a browser filter
		// they no longer describe what is shown, so they leave the screen (as in the export)
		// and the grand total is the engine's. Without one (also under a sort: they stay
		// outside the sorted body), the report's reference row is the grand total shown
		// (ADR-008).
		if (!browser_filter.length) {
			post.pinned_rows = { top: edges.top, bottom: edges.bottom };
			if (edges.reference !== null) post.total = { source: "row", rid: edges.reference };
		}
		// A filter or a sort took the view off the rows as reported: said, not done in silence.
		if (edges.inner) notices.push({ code: "REPORT_ROWS_HIDDEN", detail: edges.inner });
	} else {
		// Fact rows are the last level (their __rid), so groups open down to the report rows.
		const levels = shape === "levels" ? tree_index(normalized).max_depth : 0;
		post.level_names = Array.from({ length: levels }, (_, i) => LEVEL_PREFIX + (i + 1));
		post.group_keys = shape === "levels" ? post.level_names : group_keys;
		config.group_by = [...post.group_keys, RID];
		config.filter = browser_filter;
		config.aggregates = grouped_aggregates();
		config.aggregates[KIND] = "count";
		config.expressions = { ...currency_expressions, ...filter_expressions };
		post.technical = [KIND, ...currency_keys, ...currency_counts];
		post.row_offset = 1;
		post.leaf_depth = post.group_keys.length + 1;
		post.total = { source: "row0" };
		if (shape === "levels") {
			// Report order: every node sorts by the first of its leaves.
			config.sort = [[PATH, "asc"], ...user_sort];
			config.aggregates[RID] = "min";
			config.aggregates[LEVELS] = "min";
			post.technical.push(RID, LEVELS);
			post.depth = Math.min(tree_depth(state, normalized), post.group_keys.length);
			// The same fold as the "as is" tree: the open parents by __rid, once the user
			// opened or closed one.
			post.tree = { depth: tree_depth(state, normalized), expanded: state.tree?.expanded ?? null };
		} else {
			const dir = new Map((state.sort || []).map((s) => [s.key, s.dir === "desc" ? "desc" : "asc"]));
			// Groups in the order of their key, then the user's sort; report order breaks ties.
			config.sort = [
				...group_keys.map((k) => [sort_column(k, by_key), dir.get(k) || "asc"]),
				...user_sort,
				[RID, "asc"],
			];
			const expanded = state.group?.expanded;
			post.expanded = Array.isArray(expanded) ? expanded.filter(Array.isArray) : null;
			post.depth = expanded === "none" || post.expanded ? 0 : post.group_keys.length;
			post.groups = {
				table: "facts",
				config: {
					group_by: group_keys,
					columns: [KIND],
					aggregates: { [KIND]: "count" },
					filter: browser_filter,
					expressions: filter_expressions,
				},
			};
			if (edges.inner) notices.push({ code: "REPORT_ROWS_HIDDEN", detail: edges.inner });
		}
	}

	// Perspective mis-windows a grouped view whose sort column is hidden: every sort column
	// is also a (technical) view column.
	const sort_columns = config.sort.map(([name]) => name);
	post.technical = unique([...post.technical, ...sort_columns]).filter((name) => !keys.includes(name));
	config.columns = [...keys, ...post.technical];
	if (config.group_by.length) {
		for (const name of sort_columns) if (!Object.hasOwn(config.aggregates, name)) config.aggregates[name] = "min";
	}
	post.index = Object.fromEntries(config.columns.map((name, i) => [name, i]));
	return { table: { tree: "nodes", report: "rows" }[shape] || "facts", config, post };
}
