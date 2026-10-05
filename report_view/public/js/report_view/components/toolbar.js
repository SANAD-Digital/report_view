// Toolbar (docs/architecture.md §11.1 #25-#31; design: reference/design/screens/main.png):
// the view switcher (Table / Pivot analysis / Charts) and the search box with its options.
// The favourites button joins it with the saved views; nothing that does not work yet is shown.

import { icons } from "./icons.js";
import { SearchBox } from "./search.js";

function esc(s) {
	return frappe.utils.escape_html(String(s ?? ""));
}

const MODES = [
	{ mode: "grid", icon: () => icons.table(), label: () => __("Table") },
	{ mode: "pivot", icon: () => icons.pivot(), label: () => __("Pivot analysis") },
	{ mode: "charts", icon: () => icons.chart(), label: () => __("Charts") },
];

export class Toolbar {
	/**
	 * @param {object} opts
	 * @param {HTMLElement} opts.root the .rv element (popovers)
	 * @param {HTMLElement} opts.parent
	 * @param {object} opts.search host of the search box (components/search.js)
	 * @param {(mode: "grid"|"pivot"|"charts") => void} [opts.on_mode] a tab of the view switcher was chosen
	 */
	constructor({ root, parent, search, on_mode }) {
		const el = document.createElement("div");
		el.className = "rv-toolbar";
		el.innerHTML = `
			<div class="rv-seg rv-views" role="tablist" aria-label="${esc(__("View"))}">
				${MODES.map(
					(m) =>
						`<button type="button" role="tab" data-mode="${m.mode}" aria-selected="false">${m.icon()}<span>${esc(m.label())}</span></button>`
				).join("")}
			</div>
			<div class="rv-search-slot"></div>`;
		parent.appendChild(el);
		this.el = el;
		this.tabs = [...el.querySelectorAll(".rv-views [data-mode]")];
		for (const tab of this.tabs) tab.addEventListener("click", () => on_mode && on_mode(tab.dataset.mode));
		const slot = el.querySelector(".rv-search-slot");
		this.search = new SearchBox({ root, parent: slot, host: search });
		slot.replaceWith(this.search.el);
		this.set_mode("grid");
	}

	/** Marks the tab of the view shown (any mode without a tab of its own shows the table). */
	set_mode(mode) {
		const shown = MODES.some((m) => m.mode === mode) ? mode : "grid";
		for (const tab of this.tabs) {
			const on = tab.dataset.mode === shown;
			tab.classList.toggle("on", on);
			tab.setAttribute("aria-selected", on ? "true" : "false");
		}
	}
}
