// Toolbar (docs/architecture.md §11.1 #25-#31; design: reference/design/screens/main.png):
// the view switcher, the search box with its options, and the favourites button. Only the
// table view is available; Pivot and Charts are shown, disabled, until phases 5b and 5d.
// Saved views (favourites) need their DocType (phase 4): the button is shown, disabled.

import { icons } from "./icons.js";
import { SearchBox } from "./search.js";

function esc(s) {
	return frappe.utils.escape_html(String(s ?? ""));
}

export class Toolbar {
	/**
	 * @param {object} opts
	 * @param {HTMLElement} opts.root the .rv element (popovers)
	 * @param {HTMLElement} opts.parent
	 * @param {object} opts.search host of the search box (components/search.js)
	 */
	constructor({ root, parent, search }) {
		const soon = esc(__("Coming soon"));
		const saved = esc(__("Saved views arrive with the saved-view settings (coming soon)"));
		const el = document.createElement("div");
		el.className = "rv-toolbar";
		el.innerHTML = `
			<div class="rv-seg" role="tablist" aria-label="${esc(__("View"))}">
				<button type="button" role="tab" class="on" aria-selected="true">${icons.table()}<span>${esc(__("Table"))}</span></button>
				<button type="button" role="tab" aria-selected="false" aria-disabled="true" title="${soon}">${icons.pivot()}<span>${esc(__("Pivot analysis"))}</span></button>
				<button type="button" role="tab" aria-selected="false" aria-disabled="true" title="${soon}">${icons.chart()}<span>${esc(__("Charts"))}</span></button>
			</div>
			<div class="rv-search-slot"></div>
			<button type="button" class="rv-btn rv-fav-btn" aria-disabled="true" title="${saved}">
				${icons.star()}<span>${esc(__("Favorites"))}</span><span class="sub">${esc(__("Default view"))}</span>${icons.chevron_down()}
			</button>`;
		parent.appendChild(el);
		this.el = el;
		const slot = el.querySelector(".rv-search-slot");
		this.search = new SearchBox({ root, parent: slot, host: search });
		slot.replaceWith(this.search.el);
	}
}
