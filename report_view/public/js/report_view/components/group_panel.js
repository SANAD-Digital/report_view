// Row-group panel above the grid (docs/architecture.md §11.1 #33; design: .rv-gp in
// reference/design/screens/main.png): the grouping columns as chips (drag to reorder, × to
// remove, an arrow between levels), a drop zone for column headers and the columns panel,
// and on the other side "Group subtotals", expand all and collapse all. The result is
// group.by of the view state, i.e. group_by of the Perspective view.

import { icons } from "./icons.js";
import { esc } from "../util.js";

// Data types of what is dragged around the page.
export const DRAG_COLUMN = "application/x-rv-column";
export const DRAG_GROUP = "application/x-rv-group";
// A chip of the pivot columns bar (components/pivot_bar.js), by its index.
export const DRAG_PIVOT = "application/x-rv-pivot";

/** The column key or group index a drag event carries (null for anything else). */
export function dragged(e) {
	const types = [...(e.dataTransfer?.types || [])];
	if (types.includes(DRAG_GROUP)) return { type: "group", index: Number(e.dataTransfer.getData(DRAG_GROUP)) };
	if (types.includes(DRAG_PIVOT)) return { type: "pivot", index: Number(e.dataTransfer.getData(DRAG_PIVOT)) };
	if (types.includes(DRAG_COLUMN)) return { type: "column", key: e.dataTransfer.getData(DRAG_COLUMN) };
	return null;
}

export function accepts(e) {
	const types = [...(e.dataTransfer?.types || [])];
	return types.includes(DRAG_GROUP) || types.includes(DRAG_COLUMN) || types.includes(DRAG_PIVOT);
}

export class GroupPanel {
	/**
	 * @param {object} o
	 * @param {HTMLElement} o.parent
	 * @param {(by: string[]) => void} o.on_change new grouping
	 * @param {(key: string) => boolean} o.groupable a column that may be a group level
	 * @param {(on: boolean) => void} o.on_subtotals
	 * @param {(open: boolean) => void} o.on_fold_all
	 * @param {() => void} o.on_column_groups opens the column groups dialog
	 */
	constructor({ parent, on_change, groupable, on_subtotals, on_fold_all, on_column_groups }) {
		this.on_change = on_change;
		this.groupable = groupable;
		const expand = esc(__("Expand all"));
		const collapse = esc(__("Collapse all"));
		const el = document.createElement("div");
		el.className = "rv-gp";
		el.innerHTML = `
			<span class="rv-gp-lbl">${icons.group()}<span data-title>${esc(__("Row groups"))}</span></span>
			<span class="rv-gp-chips"></span>
			<div class="rv-gp-tools">
				<button type="button" class="rv-btn sm" data-action="column-groups" data-grid>${icons.columns()}<span>${esc(__("Column groups"))}</span></button>
				<span class="rv-vsep" data-fold data-grid></span>
				<label class="rv-check sm" data-subtotals><input type="checkbox" data-action="subtotals"><span>${esc(__("Group subtotals"))}</span></label>
				<span class="rv-vsep" data-subtotals></span>
				<button type="button" class="rv-btn icon sm ghost" data-fold data-action="expand-all" aria-label="${expand}" title="${expand}">${icons.expand_all()}</button>
				<button type="button" class="rv-btn icon sm ghost" data-fold data-action="collapse-all" aria-label="${collapse}" title="${collapse}">${icons.collapse_all()}</button>
			</div>`;
		parent.appendChild(el);
		this.el = el;
		this.chips_el = el.querySelector(".rv-gp-chips");
		this.subtotals = el.querySelector('[data-action="subtotals"]');
		this.subtotals.addEventListener("change", () => on_subtotals(this.subtotals.checked));
		el.querySelector('[data-action="column-groups"]').addEventListener("click", () => on_column_groups());
		el.querySelector('[data-action="expand-all"]').addEventListener("click", () => on_fold_all(true));
		el.querySelector('[data-action="collapse-all"]').addEventListener("click", () => on_fold_all(false));
		this.by = [];
		el.addEventListener("dragover", (e) => {
			if (!accepts(e)) return;
			e.preventDefault();
			el.classList.add("drop");
		});
		el.addEventListener("dragleave", (e) => {
			if (!el.contains(e.relatedTarget)) el.classList.remove("drop");
		});
		el.addEventListener("drop", (e) => this.drop(e, null));
		this.set({ by: [], labels: {}, foldable: false, subtotals: true, hierarchical: false });
	}

	/** Drop at chip `at` (null: at the end). */
	drop(e, at) {
		const d = dragged(e);
		this.el.classList.remove("drop");
		// grouping turned off (Report View Settings): nothing is dropped outside the pivot
		if (!d || (!this.grouping && !this.pivot_cols)) return;
		e.preventDefault();
		e.stopPropagation();
		const by = [...this.by];
		const end = at === null ? by.length : at;
		if (d.type === "pivot") {
			// a pivot column moved to the rows (pivot mode)
			if (!this.on_pivot_column || !this.pivot_cols?.[d.index]) return;
			this.on_pivot_column(this.pivot_cols[d.index], end);
			return;
		} else if (d.type === "group") {
			if (!Number.isInteger(d.index) || !by[d.index]) return;
			const [moved] = by.splice(d.index, 1);
			by.splice(d.index < end ? end - 1 : end, 0, moved);
		} else {
			if (!d.key || by.includes(d.key) || !this.groupable(d.key)) return;
			by.splice(end, 0, d.key);
		}
		if (JSON.stringify(by) !== JSON.stringify(this.by)) this.on_change(by);
	}

	/**
	 * @param {object} s {by: string[], labels: {key: label}, foldable, subtotals, hierarchical,
	 *   pivot: null, or {cols, on_column(key, at)} in pivot mode}
	 */
	set({ by, labels, foldable, subtotals, hierarchical, pivot = null, features = null }) {
		this.by = [...by];
		// what the report's settings keep of the bar (ADR-023)
		const f = features || { grouping: true, column_groups: true, subtotals: true };
		this.grouping = f.grouping;
		// Pivot mode: the chips are the pivot's rows; subtotals and column groups belong to the table.
		this.pivot_cols = pivot?.cols || null;
		this.on_pivot_column = pivot?.on_column || null;
		this.el.querySelector("[data-title]").textContent = pivot ? __("Pivot rows") : __("Row groups");
		for (const x of this.el.querySelectorAll("[data-grid]")) x.hidden = Boolean(pivot) || !f.column_groups;
		const chips = Boolean(pivot) || f.grouping;
		this.el.querySelector(".rv-gp-lbl").hidden = !chips;
		this.chips_el.hidden = !chips;
		const remove = esc(__("Remove from the grouping"));
		this.chips_el.innerHTML = by.length
			? by
					.map(
						(k, i) =>
							`<span class="rv-gchip" draggable="true" data-index="${i}"><span class="rv-grip">${icons.grip()}</span><span>${esc(labels[k] || k)}</span>` +
							`<button type="button" class="rv-chip-x" data-remove="${i}" aria-label="${remove}" title="${remove}">${icons.close()}</button></span>` +
							(i < by.length - 1 ? `<span class="rv-gsep" aria-hidden="true">${icons.crumb()}</span>` : "")
					)
					.join("")
			: `<span class="rv-gp-hint">${esc(__("Drag a column here to group by it"))}</span>`;
		for (const chip of this.chips_el.querySelectorAll(".rv-gchip")) {
			const i = Number(chip.dataset.index);
			chip.addEventListener("dragstart", (e) => {
				e.dataTransfer.setData(DRAG_GROUP, String(i));
				e.dataTransfer.effectAllowed = "move";
			});
			chip.addEventListener("dragover", (e) => {
				if (accepts(e)) e.preventDefault();
			});
			chip.addEventListener("drop", (e) => this.drop(e, i));
		}
		for (const b of this.chips_el.querySelectorAll("[data-remove]")) {
			b.addEventListener("click", () => this.on_change(this.by.filter((_, j) => j !== Number(b.dataset.remove))));
		}
		this.subtotals.checked = Boolean(subtotals);
		for (const x of this.el.querySelectorAll("[data-subtotals]")) x.hidden = !hierarchical || Boolean(pivot) || !f.subtotals;
		// "Column groups" is always there in the table; folding only where rows fold.
		for (const x of this.el.querySelectorAll("[data-fold]")) x.hidden = !foldable || (x.classList.contains("rv-vsep") && (Boolean(pivot) || !f.column_groups));
		// nothing left to show: no bar
		this.el.hidden = !chips && ![...this.el.querySelectorAll(".rv-gp-tools > :not(.rv-vsep)")].some((x) => !x.hidden);
	}
}
