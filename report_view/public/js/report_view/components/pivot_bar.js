// Pivot columns bar above the pivot table (docs/architecture.md §11.1 #34; design: .rv-gp.pv
// in reference/design/screens/pivot.png): the pivot columns as chips (drag to reorder, × to
// remove), a drop zone for columns of the columns panel and for row chips, and on the other
// side the values shown. The result is pivot.cols of the view state, i.e. split_by of the
// pivot view.

import { icons } from "./icons.js";
import { DRAG_PIVOT, accepts, dragged } from "./group_panel.js";
import { esc } from "../util.js";

export class PivotBar {
	/**
	 * @param {object} o
	 * @param {HTMLElement} o.parent
	 * @param {HTMLElement} [o.after] the bar goes right after this element
	 * @param {(cols: string[]) => void} o.on_change new pivot columns
	 * @param {(key: string) => boolean} o.allowed a dimension that may be a pivot column
	 * @param {(key: string) => void} o.on_row_moved a row of the pivot dropped here (index of pivot.rows)
	 */
	constructor({ parent, after, on_change, allowed, on_row_moved }) {
		this.on_change = on_change;
		this.allowed = allowed;
		this.on_row_moved = on_row_moved;
		this.cols = [];
		this.rows = [];
		const el = document.createElement("div");
		el.className = "rv-gp pv rv-pivotbar";
		el.innerHTML = `
			<span class="rv-gp-lbl">${icons.pivot_cols()}<span>${esc(__("Pivot columns"))}</span></span>
			<span class="rv-gp-chips"></span>
			<div class="rv-gp-tools"><span class="rv-gp-lbl rv-pv-values"></span></div>`;
		// In the page only in pivot mode (show()).
		this.parent = parent;
		this.after = after || null;
		this.el = el;
		this.chips_el = el.querySelector(".rv-gp-chips");
		this.values_el = el.querySelector(".rv-pv-values");
		el.addEventListener("dragover", (e) => {
			if (!accepts(e)) return;
			e.preventDefault();
			el.classList.add("drop");
		});
		el.addEventListener("dragleave", (e) => {
			if (!el.contains(e.relatedTarget)) el.classList.remove("drop");
		});
		el.addEventListener("drop", (e) => this.drop(e, null));
	}

	drop(e, at) {
		const d = dragged(e);
		this.el.classList.remove("drop");
		if (!d) return;
		e.preventDefault();
		e.stopPropagation();
		const cols = [...this.cols];
		const end = at === null ? cols.length : at;
		if (d.type === "pivot") {
			if (!Number.isInteger(d.index) || !cols[d.index]) return;
			const [moved] = cols.splice(d.index, 1);
			cols.splice(d.index < end ? end - 1 : end, 0, moved);
		} else if (d.type === "group") {
			const key = this.rows[d.index];
			if (!key) return;
			this.on_row_moved(key, end);
			return;
		} else {
			if (!d.key || cols.includes(d.key) || !this.allowed(d.key)) return;
			cols.splice(end, 0, d.key);
		}
		if (JSON.stringify(cols) !== JSON.stringify(this.cols)) this.on_change(cols);
	}

	/** The bar is in the page in pivot mode only. */
	show(on) {
		if (!on) {
			this.el.remove();
			return;
		}
		if (this.el.isConnected) return;
		if (this.after?.isConnected) this.after.after(this.el);
		else this.parent.appendChild(this.el);
	}

	/**
	 * @param {object} s {cols: string[], rows: string[], labels: {key: label}, values: string}
	 */
	set({ cols, rows, labels, values }) {
		this.cols = [...cols];
		this.rows = [...rows];
		const remove = esc(__("Remove", null, "Report View"));
		this.chips_el.innerHTML = cols.length
			? cols
					.map(
						(k, i) =>
							`<span class="rv-gchip pv" draggable="true" data-index="${i}"><span class="rv-grip">${icons.grip()}</span><span>${esc(labels[k] || k)}</span>` +
							`<button type="button" class="rv-chip-x" data-remove="${i}" aria-label="${remove}" title="${remove}">${icons.close()}</button></span>`
					)
					.join("")
			: `<span class="rv-gp-hint">${esc(__("Drag a column here to turn its values into columns"))}</span>`;
		for (const chip of this.chips_el.querySelectorAll(".rv-gchip")) {
			const i = Number(chip.dataset.index);
			chip.addEventListener("dragstart", (e) => {
				e.dataTransfer.setData(DRAG_PIVOT, String(i));
				e.dataTransfer.effectAllowed = "move";
			});
			chip.addEventListener("dragover", (e) => {
				if (accepts(e)) e.preventDefault();
			});
			chip.addEventListener("drop", (e) => this.drop(e, i));
		}
		for (const b of this.chips_el.querySelectorAll("[data-remove]")) {
			b.addEventListener("click", () => this.on_change(this.cols.filter((_, j) => j !== Number(b.dataset.remove))));
		}
		this.values_el.textContent = __("Value: {0}", [values || "—"]);
		this.values_el.title = this.values_el.textContent;
	}
}
