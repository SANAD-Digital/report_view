// Toolbar (docs/architecture.md §11.1 #25-#26, and the tools of #33): view switcher, the
// simple grouping of phase 3, and the fold tools of the design's group panel (group
// subtotals, expand all, collapse all). Only the table view is available; Pivot and Charts
// are shown, disabled, with a "coming soon" hint (phases 5b and 5d).

import { icons } from "./icons.js";

function esc(s) {
	return frappe.utils.escape_html(String(s ?? ""));
}

export class Toolbar {
	/**
	 * @param {object} opts
	 * @param {HTMLElement} opts.parent
	 * @param {(on: boolean) => void} opts.on_subtotals "group subtotals" was switched
	 * @param {(open: boolean) => void} opts.on_fold_all "expand all" / "collapse all"
	 */
	constructor({ parent, on_subtotals, on_fold_all }) {
		const soon = esc(__("Coming soon"));
		const expand = esc(__("Expand all"));
		const collapse = esc(__("Collapse all"));
		const el = document.createElement("div");
		el.className = "rv-toolbar";
		el.innerHTML = `
			<div class="rv-seg" role="tablist" aria-label="${esc(__("View"))}">
				<button type="button" role="tab" class="on" aria-selected="true">${icons.table()}<span>${esc(__("Table"))}</span></button>
				<button type="button" role="tab" aria-selected="false" aria-disabled="true" title="${soon}">${icons.pivot()}<span>${esc(__("Pivot"))}</span></button>
				<button type="button" role="tab" aria-selected="false" aria-disabled="true" title="${soon}">${icons.chart()}<span>${esc(__("Charts"))}</span></button>
			</div>
			<div class="rv-tb-group">
				<span class="rv-gp-lbl">${icons.group()}<span>${esc(__("Group by"))}</span></span>
				<div class="rv-group"></div>
			</div>
			<div class="rv-gp-tools" hidden>
				<label class="rv-check sm"><input type="checkbox" data-action="subtotals"><span>${esc(__("Group subtotals"))}</span></label>
				<span class="rv-vsep"></span>
				<button type="button" class="rv-btn icon sm ghost" data-action="expand-all" aria-label="${expand}" title="${expand}">${icons.expand_all()}</button>
				<button type="button" class="rv-btn icon sm ghost" data-action="collapse-all" aria-label="${collapse}" title="${collapse}">${icons.collapse_all()}</button>
			</div>`;
		parent.appendChild(el);
		this.el = el;
		this.group_parent = el.querySelector(".rv-group");
		this.tools = el.querySelector(".rv-gp-tools");
		this.subtotals = el.querySelector('[data-action="subtotals"]');
		this.subtotals.addEventListener("change", () => on_subtotals(this.subtotals.checked));
		el.querySelector('[data-action="expand-all"]').addEventListener("click", () => on_fold_all(true));
		el.querySelector('[data-action="collapse-all"]').addEventListener("click", () => on_fold_all(false));
	}

	/**
	 * The fold tools show for a view that has groups (a grouped view or a report tree).
	 * @param {{foldable: boolean, subtotals: boolean}} s
	 */
	set_fold({ foldable, subtotals }) {
		this.tools.hidden = !foldable;
		this.subtotals.checked = Boolean(subtotals);
	}
}
