// Toolbar (docs/architecture.md §11.1 #25-#31; design: reference/design/screens/main.png):
// the search box with its options. The view switcher (Pivot, Charts) and the favourites
// button join it when they work (phases 5b, 5d and the saved views); nothing that does not
// work yet is shown.

import { SearchBox } from "./search.js";

export class Toolbar {
	/**
	 * @param {object} opts
	 * @param {HTMLElement} opts.root the .rv element (popovers)
	 * @param {HTMLElement} opts.parent
	 * @param {object} opts.search host of the search box (components/search.js)
	 */
	constructor({ root, parent, search }) {
		const el = document.createElement("div");
		el.className = "rv-toolbar";
		el.innerHTML = `<div class="rv-search-slot"></div>`;
		parent.appendChild(el);
		this.el = el;
		const slot = el.querySelector(".rv-search-slot");
		this.search = new SearchBox({ root, parent: slot, host: search });
		slot.replaceWith(this.search.el);
	}
}
