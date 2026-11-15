// The level a report tree opens to, as Frappe's tree reports set it (query_report.js
// show_footer_message: a level typed and «Set Level», «Expand All», «Collapse All»): the
// roots, a level typed or stepped, every node. One control, the same wherever it stands: the
// table's tools (the standard page's row groups bar, the bars of A and C) and the Statement's
// head. Level 1 is the roots, as in Frappe; the view state keeps the depth (level - 1).

import { esc } from "../util.js";
import { tree_index } from "../engine/tree_nodes.js";

// the modes whose rows are the report's tree
const TREE_MODES = new Set(["grid", "statement"]);

export class TreeLevel {
	/**
	 * @param {object} page the ReportViewPage
	 * @param {string} [cls] the class of the place it stands in (its size there)
	 */
	constructor(page, cls = "") {
		this.page = page;
		const el = document.createElement("div");
		el.className = `rv-seg rv-tree-level ${cls}`.trim();
		el.dataset.action = "tree-level";
		el.setAttribute("role", "group");
		el.setAttribute("aria-label", __("Tree level"));
		const less = __("One level less");
		const more = __("One level more");
		el.innerHTML = `
			<button type="button" data-tl="roots">${esc(__("Roots"))}</button>
			<span class="rv-tl-step">
				<button type="button" data-tl="less" aria-label="${esc(less)}" title="${esc(less)}">−</button>
				<label><span>${esc(__("Level"))}</span><input type="number" min="1" step="1" inputmode="numeric" aria-label="${esc(__("Level"))}"></label>
				<button type="button" data-tl="more" aria-label="${esc(more)}" title="${esc(more)}">+</button>
			</span>
			<button type="button" data-tl="all">${esc(__("All"))}</button>`;
		this.el = el;
		this.input = el.querySelector("input");
		el.addEventListener("click", (e) => {
			const act = e.target.closest("[data-tl]")?.dataset.tl;
			const i = this.info();
			if (!act || !i) return;
			const at = i.depth ?? i.max;
			const depth = { roots: 0, all: i.max, less: at - 1, more: at + 1 }[act];
			this.set_depth(depth);
		});
		// a level typed: set when it is left or Enter is pressed (Frappe's «Set Level»)
		this.input.addEventListener("change", () => {
			const level = parseInt(this.input.value, 10);
			if (Number.isFinite(level)) this.set_depth(level - 1);
			else this.update();
		});
		this.input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") this.input.blur();
		});
		this.update();
	}

	/** The report's tree: its deepest level and the depth it opens to (null: opened by hand). */
	info() {
		const page = this.page;
		const report = page.report;
		const s = page.state;
		if (!report?.tree?.enabled || !s || !TREE_MODES.has(s.mode || "grid")) return null;
		const max = tree_index(report).max_depth;
		const depth = s.tree?.expanded ? null : Math.min(max, s.tree?.depth ?? report.tree.initial_depth ?? 2);
		return { max, depth };
	}

	set_depth(depth) {
		const i = this.info();
		if (!i) return;
		const page = this.page;
		page.state.tree = { depth: Math.max(0, Math.min(i.max, depth)), expanded: null };
		page.render();
		page.refresh_tree_levels?.();
	}

	/** Shown for a report tree in the table and the Statement; its level and its ends marked. */
	update() {
		const i = this.info();
		this.el.hidden = !i;
		if (!i) return;
		const { max, depth } = i;
		this.input.max = String(max + 1);
		// opened by hand (a node toggled): no one level; the field is empty
		if (document.activeElement !== this.input) this.input.value = depth === null ? "" : String(depth + 1);
		this.input.placeholder = "—";
		const mark = (act, on) => {
			const b = this.el.querySelector(`[data-tl="${act}"]`);
			b.classList.toggle("on", on);
			b.setAttribute("aria-pressed", on ? "true" : "false");
		};
		mark("roots", depth === 0);
		mark("all", depth === max);
		this.el.querySelector('[data-tl="less"]').disabled = depth === 0;
		this.el.querySelector('[data-tl="more"]').disabled = depth === max;
		this.el.querySelector(".rv-tl-step").classList.toggle("on", depth !== null && depth > 0 && depth < max);
	}
}
