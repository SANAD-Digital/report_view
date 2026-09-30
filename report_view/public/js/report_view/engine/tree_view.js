// "As is" tree built from NormalizedReport.rows (the report's own hierarchy). Pure module.
// Values are the report's values; nothing is recomputed.

const TREE_KINDS = new Set(["data", "group_header"]);

/**
 * @param {Array} rows  NormalizedReport.rows
 * @param {Set<number>|null} keep  rids to keep (null = all); ancestors of kept rows are kept too
 * @param {Function|null} sort_siblings  (array) => sorted array
 */
export function build_tree(rows, keep = null, sort_siblings = null) {
	const nodes = new Map();
	const tops = [];
	const by_rid = new Map(rows.map((r) => [r.__rid, r]));

	let visible = null;
	if (keep) {
		visible = new Set();
		for (const rid of keep) {
			let cur = by_rid.get(rid);
			while (cur && !visible.has(cur.__rid)) {
				visible.add(cur.__rid);
				cur = cur.__parent === null ? null : by_rid.get(cur.__parent);
			}
		}
	}

	for (const r of rows) {
		if (!TREE_KINDS.has(r.__kind)) continue;
		if (visible && !visible.has(r.__rid)) continue;
		const node = { ...r, __id: `r:${r.__rid}` };
		nodes.set(r.__rid, node);
		const parent = r.__parent === null ? null : nodes.get(r.__parent);
		if (parent) (parent._children ||= []).push(node);
		else tops.push(node);
	}

	if (sort_siblings) {
		const walk = (list) => {
			const sorted = sort_siblings(list);
			for (const n of sorted) if (n._children) n._children = walk(n._children);
			return sorted;
		};
		return walk(tops);
	}
	return tops;
}

// Topmost data rows of the report hierarchy (no data-row ancestor; group headers carry no
// values): the basis of the tree grand total, as in Frappe's add_total_row for trees.
export function tree_roots(rows) {
	const by_rid = new Map(rows.map((r) => [r.__rid, r]));
	return rows.filter((r) => {
		if (r.__kind !== "data") return false;
		let p = r.__parent === null ? null : by_rid.get(r.__parent);
		while (p) {
			if (p.__kind === "data") return false;
			p = p.__parent === null ? null : by_rid.get(p.__parent);
		}
		return true;
	});
}
