// Toolbar (docs/architecture.md §11.1 #25-#26): view switcher and the simple grouping of
// phase 3. Only the table view is available; Pivot and Charts are shown, disabled, with a
// "coming soon" hint (phases 5b and 5d).

import { icons } from "./icons.js";

function esc(s) {
	return frappe.utils.escape_html(String(s ?? ""));
}

export class Toolbar {
	constructor({ parent }) {
		const soon = esc(__("Coming soon"));
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
			</div>`;
		parent.appendChild(el);
		this.el = el;
		this.group_parent = el.querySelector(".rv-group");
	}
}
