// Rows of the grid body from the rows of a view (docs/architecture.md §8أ.2 `post`, §11.1
// #47). Pure module: nothing is computed here, rows are only placed.
// - a subtotal row ("foot") stands after the last visible descendant of every open group; it
//   shows the values of the group's own view row;
// - spacer rows at the top keep the room of the report rows pinned under the headers;
// - the open groups of a view, as group.expanded of the view state carries them.

/**
 * @param {ArrayLike<number>} depths depth of every body row of the view, in view order
 * @param {object} [opts]
 * @param {boolean} [opts.subtotals] add a foot row after every open group
 * @param {number} [opts.top] spacer rows before the first row
 * @returns {{size: number, top: number, count: number, open: Uint8Array, rows: Int32Array,
 *   foot: Uint8Array}} `rows[y - top]` is the view row shown at display row `y` (its group
 *   when `foot[y - top]` is set); `open[i]` tells that view row `i` has visible children.
 */
export function build_layout(depths, { subtotals = false, top = 0 } = {}) {
	const count = depths.length;
	const open = new Uint8Array(count);
	let feet = 0;
	for (let i = 0; i + 1 < count; i++) {
		if (depths[i + 1] > depths[i]) {
			open[i] = 1;
			feet += 1;
		}
	}
	const total = count + (subtotals ? feet : 0);
	const rows = new Int32Array(total);
	const foot = new Uint8Array(total);
	if (!subtotals) {
		for (let i = 0; i < count; i++) rows[i] = i;
		return { size: top + total, top, count, open, rows, foot };
	}
	const stack = [];
	let at = 0;
	const close_down_to = (depth) => {
		while (stack.length && depths[stack[stack.length - 1]] >= depth) {
			rows[at] = stack.pop();
			foot[at] = 1;
			at += 1;
		}
	};
	for (let i = 0; i < count; i++) {
		close_down_to(depths[i]);
		rows[at] = i;
		at += 1;
		if (open[i]) stack.push(i);
	}
	close_down_to(-Infinity);
	return { size: top + total, top, count, open, rows, foot };
}

/** What stands at display row `y`: a spacer, a view row, or the foot of a group's view row. */
export function entry_at(layout, y) {
	const i = y - layout.top;
	if (i < 0 || i >= layout.rows.length) return { kind: "spacer", row: -1 };
	return { kind: layout.foot[i] ? "foot" : "row", row: layout.rows[i] };
}

/**
 * group.expanded (§7.1) as the view shows it: "all" when no visible group is closed, "none"
 * when none is open, else the paths of the open groups.
 * @param {Array<Array>} paths __ROW_PATH__ of the body rows
 * @param {number} leaf_depth path length of a fact row
 */
export function expanded_from_paths(paths, leaf_depth) {
	const open = [];
	let closed = 0;
	for (let i = 0; i < paths.length; i++) {
		const path = paths[i];
		if (path.length >= leaf_depth) continue;
		if (i + 1 < paths.length && paths[i + 1].length > path.length) open.push(path);
		else closed += 1;
	}
	if (!closed) return "all";
	return open.length ? open : "none";
}
