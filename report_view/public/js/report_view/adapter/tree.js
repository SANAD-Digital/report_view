// N4: tree detection and parent/leaf resolution (docs/architecture.md §3.2). Pure module.
// Twin of report_view/core/normalize.py (_tree_enabled, _label_key, _build_tree).

import { has_value, num } from "./classify.js";

const SKIP = new Set(["internal_total", "opening", "closing", "separator"]);

export function detect_tree(rows, register) {
	const forced = register?.tree?.enabled;
	if (forced === false) return false;
	if (forced === true) return true;
	return rows.some((r) => Object.hasOwn(r, "indent"));
}

export function resolve_label_key(columns, report_settings, register) {
	const keys = new Set(columns.map((c) => c.key));
	for (const candidate of [register?.tree?.label_key, report_settings?.name_field]) {
		if (candidate && keys.has(candidate)) return candidate;
	}
	const first = columns.find((c) => c.role === "dimension" && !c.hidden);
	return first ? first.key : null;
}

/** Set __indent, __parent and __is_leaf on every row (N4.3-N4.4). */
export function link_tree(rows, { enabled, report_settings, notices }) {
	if (!enabled) {
		for (const row of rows) {
			row.__indent = null;
			row.__parent = null;
			row.__is_leaf = true;
		}
		return;
	}
	const stack = [];
	const tree_rows = [];
	for (const row of rows) {
		row.__indent = has_value(row.indent) ? row.indent : null;
		row.__parent = null;
		row.__is_leaf = true;
		if (SKIP.has(row.__kind)) continue;
		const level = has_value(row.indent) ? num(row.indent) : 0;
		while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
		row.__parent = stack.length ? stack[stack.length - 1].rid : null;
		stack.push({ level, rid: row.__rid });
		tree_rows.push(row);
	}
	tree_rows.forEach((row, i) => {
		const next = tree_rows[i + 1];
		row.__is_leaf = !next || num(next.indent) <= num(row.indent);
	});

	const name_field = report_settings?.name_field;
	const parent_field = report_settings?.parent_field;
	if (name_field && parent_field) {
		const by_rid = new Map(rows.map((r) => [r.__rid, r]));
		for (const row of tree_rows) {
			const parent = row.__parent === null ? null : by_rid.get(row.__parent);
			const expected = (parent ? parent[name_field] : null) || null;
			const actual = row[parent_field] || null;
			if (expected !== actual) notices.push({ code: "TREE_PARENT_MISMATCH", detail: row.__rid });
		}
	}
}
