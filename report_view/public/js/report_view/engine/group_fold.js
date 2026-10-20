// Rows of a grouping of the user (view shape "group", engine/view_config.js): the groups come
// from a view of the groups only, the facts of each deepest group from a flat view of the
// facts sorted by the group keys first, so they stand in that view as one run per group, in
// the order of the groups. Pure module: nothing is computed but where a row stands (the run
// of a group starts where the runs of the groups before it end, from the engine's counts).
//
// The rows shown are "view rows" for the grid and the pages (engine/row_layout.js): a group
// (its index among the body rows of the group view) or a fact (its row in the flat view).
// Folding is placement only, with the rules of Perspective's own expand / collapse: closing a
// group closes the groups inside it; opening a group opens that one only.

export class GroupFold {
	/**
	 * @param {Array<Array>} paths __ROW_PATH__ of the body rows of the group view, every group
	 *   shown (the view as it opens), in view order
	 * @param {ArrayLike<number>} counts facts of every group (the view's __kind count)
	 * @param {number} levels the number of group keys
	 */
	constructor(paths, counts, levels) {
		const n = paths.length;
		this.paths = paths;
		this.counts = counts;
		this.levels = levels;
		this.size = n;
		this.level = new Uint8Array(n);
		// the index after the last group inside a group
		this.end = new Int32Array(n);
		// the row of the flat view where the facts of a deepest group start
		this.first_leaf = new Int32Array(n).fill(-1);
		// every group open, as the view opens; apply() gives the fold of a view state
		this.open = new Uint8Array(n).fill(1);
		const stack = [];
		let leaves = 0;
		for (let g = 0; g < n; g++) {
			const level = paths[g].length;
			this.level[g] = level;
			while (stack.length && this.level[stack[stack.length - 1]] >= level) this.end[stack.pop()] = g;
			stack.push(g);
			if (level === levels) {
				this.first_leaf[g] = leaves;
				leaves += Number(counts[g]) || 0;
			}
		}
		while (stack.length) this.end[stack.pop()] = n;
		this.leaf_count = leaves;
		this.layout();
	}

	/**
	 * The fold of the view state: down to post.depth (a group of level <= depth is open), or
	 * the listed groups (group.expanded) whose parents are open too, as the view opened them.
	 * @param {{depth: number|null, expanded: Array<Array>|null}} post
	 */
	apply(post) {
		this.open.fill(0);
		if (post.expanded) {
			const wanted = new Set(post.expanded.map((path) => JSON.stringify(path)));
			const shown = [];
			for (let g = 0; g < this.size; g++) {
				const level = this.level[g];
				shown.length = level - 1;
				const parent_open = level === 1 || shown[level - 2];
				const open = Boolean(parent_open && wanted.has(JSON.stringify(this.paths[g])));
				this.open[g] = open ? 1 : 0;
				shown[level - 1] = open;
			}
		} else {
			const depth = post.depth ?? this.levels;
			for (let g = 0; g < this.size; g++) this.open[g] = this.level[g] <= depth ? 1 : 0;
		}
		this.layout();
	}

	/** Opens or closes the group of a view row; closing closes the groups inside it. */
	toggle_row(row, open) {
		const g = this.group_at[row];
		if (g === undefined || g < 0) return false;
		if (open) this.open[g] = 1;
		else this.open.fill(0, g, this.end[g]);
		this.layout();
		return true;
	}

	/**
	 * The view rows shown: depths (path length; a fact is one deeper than its group), and for
	 * every row the group it is (group_at, else -1) or the row of the flat view (leaf_at, else -1).
	 */
	layout() {
		let total = 0;
		for (let g = 0; g < this.size; ) {
			total += 1;
			if (!this.open[g]) {
				g = this.end[g];
				continue;
			}
			if (this.level[g] === this.levels) total += Number(this.counts[g]) || 0;
			g += 1;
		}
		const depths = new Uint8Array(total);
		const group_at = new Int32Array(total);
		const leaf_at = new Int32Array(total);
		let at = 0;
		for (let g = 0; g < this.size; ) {
			depths[at] = this.level[g];
			group_at[at] = g;
			leaf_at[at] = -1;
			at += 1;
			if (!this.open[g]) {
				g = this.end[g];
				continue;
			}
			if (this.level[g] === this.levels) {
				const count = Number(this.counts[g]) || 0;
				const first = this.first_leaf[g];
				for (let i = 0; i < count; i++) {
					depths[at] = this.levels + 1;
					group_at[at] = -1;
					leaf_at[at] = first + i;
					at += 1;
				}
			}
			g += 1;
		}
		this.depths = depths;
		this.group_at = group_at;
		this.leaf_at = leaf_at;
	}

	/**
	 * group.expanded (§7.1) as the rows show it: "all" when no group shown is closed, "none"
	 * when none is open, else the paths of the open groups (as row_layout.expanded_from_paths).
	 */
	expanded() {
		const open = [];
		let closed = 0;
		for (let g = 0; g < this.size; ) {
			if (!this.open[g]) {
				closed += 1;
				g = this.end[g];
				continue;
			}
			open.push(this.paths[g]);
			g += 1;
		}
		if (!closed) return "all";
		return open.length ? open : "none";
	}
}
