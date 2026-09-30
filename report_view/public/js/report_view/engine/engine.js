// Engine: applies a view state to a NormalizedReport and returns display rows for the
// grid plus the totals shown in the pinned total row (docs/architecture.md §4.3, §11.2).
// Pure module: no frappe, no DOM. Views only render what this returns.

import { aggregate, shared_currencies, row_currency_key } from "./aggregate.js";
import { filter_rows, has_filters } from "./filter.js";
import { sort_rows, make_compare } from "./sort.js";
import { group_rows, use_arquero } from "./group.js";

export { use_arquero };
import { build_tree, tree_roots } from "./tree_view.js";

const FLAT_KINDS = new Set(["data", "opening", "closing"]);

export function measure_columns(columns) {
	return columns.filter((c) => c.role === "measure");
}

function valid_group_keys(state, columns) {
	const keys = new Set(columns.map((c) => c.key));
	return (state.group?.by || []).filter((k) => keys.has(k));
}

export function resolve_mode(report, state) {
	if (valid_group_keys(state, report.columns).length) return "group";
	if (report.tree?.enabled && state.tree?.enabled !== false) return "tree";
	return "flat";
}

/**
 * Totals of the top level of the current view:
 * - tree: topmost report rows (their values already include their children);
 * - group / flat: the filtered facts.
 */
export function compute_totals(report, basis) {
	const measures = measure_columns(report.columns);
	const row = { __kind: "grand_total", __id: "total", __mixed: {}, ...shared_currencies(measures, basis) };
	const values = {};
	for (const c of measures) {
		const v = aggregate(c, basis);
		if (v && typeof v === "object" && v.mixed) {
			row[c.key] = null;
			row.__mixed[c.key] = true;
			values[c.key] = v;
		} else {
			row[c.key] = v;
			values[c.key] = v;
		}
	}
	return { row, values };
}

// Rows that have children (user groups or report tree parents), for the status bar.
export function count_parents(rows) {
	let n = 0;
	const walk = (list) => {
		for (const r of list) {
			if (r._children?.length) {
				n++;
				walk(r._children);
			}
		}
	};
	walk(rows);
	return n;
}

// The one currency shared by every measure of the total row, or null (header meta line).
function single_currency(columns, total_row) {
	const found = new Set();
	for (const c of measure_columns(columns)) {
		const key = row_currency_key(c);
		if (!key) continue;
		if (!total_row[key]) return null;
		found.add(total_row[key]);
	}
	return found.size === 1 ? [...found][0] : null;
}

export function create_engine(report, opts = {}) {
	const compare = make_compare(opts.locale);

	function apply(state = {}) {
		const columns = report.columns;
		const filters = state.filters || [];
		const facts = sort_rows(filter_rows(report.facts, filters, columns), state.sort, columns, compare);
		const mode = resolve_mode(report, state);
		const notices = [];
		let rows;
		let basis;

		if (mode === "group") {
			const keys = valid_group_keys(state, columns);
			const desc = {};
			for (const s of state.sort || []) if (keys.includes(s.key)) desc[s.key] = s.dir === "desc";
			rows = group_rows(facts, columns, keys, { compare, desc });
			basis = facts;
		} else if (mode === "tree") {
			const filtering = has_filters(filters);
			const keep = filtering ? new Set(facts.map((r) => r.__rid)) : null;
			const sorter = state.sort?.length ? (list) => sort_rows(list, state.sort, columns, compare) : null;
			rows = build_tree(report.rows, keep, sorter);
			if (filtering) {
				basis = facts;
				notices.push({ code: "TREE_TOTAL_FROM_FACTS" });
			} else {
				basis = tree_roots(report.rows);
			}
		} else {
			const filtering = has_filters(filters) || (state.sort && state.sort.length);
			rows = filtering
				? facts.map((r) => ({ ...r, __id: `r:${r.__rid}` }))
				: report.rows.filter((r) => FLAT_KINDS.has(r.__kind)).map((r) => ({ ...r, __id: `r:${r.__rid}` }));
			basis = facts;
		}

		const totals = compute_totals(report, basis);
		return {
			mode,
			rows,
			totals: totals.row,
			total_values: totals.values,
			row_count: facts.length,
			fact_count: report.facts.length,
			group_count: count_parents(rows),
			currency: single_currency(report.columns, totals.row),
			notices,
		};
	}

	// expected block of the export model (§4.1): numeric totals only.
	function expected(result) {
		const totals = {};
		for (const [k, v] of Object.entries(result.total_values)) {
			if (typeof v === "number") totals[k] = v;
		}
		return { row_count: result.row_count, totals };
	}

	return { apply, expected, report };
}
