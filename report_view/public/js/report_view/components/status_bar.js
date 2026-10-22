// Status bar under the grid (docs/architecture.md §11.1 #66; design: .rv-status in
// reference/design/screens/main.png): "<rows> N of M · Groups K", the filtered flag, and the
// hints of what the grid does. Counts come from the engine result. The design's hints name
// range selection, the context menu and the account statement, which come in later waves:
// the hints shown are those of what works now.

import { icons } from "./icons.js";
import { esc, fmt_int } from "../util.js";

function num(n) {
	return `<b>${esc(fmt_int(n))}</b>`;
}

export class StatusBar {
	constructor({ parent }) {
		const el = document.createElement("footer");
		el.className = "rv-status";
		el.innerHTML = `<div class="rv-status-grp"></div><div class="rv-status-grp"><span class="rv-status-hint">${esc(
			__("Click a title to sort · drag it to group · ≡ column menu")
		)}</span></div>`;
		parent.appendChild(el);
		this.el = el;
		this.clear();
	}

	clear() {
		this.el.firstElementChild.innerHTML = "";
		this.el.hidden = true;
	}

	/**
	 * @param {object} r {row_count, fact_count, group_count, filters (active filters), noun}
	 */
	update(r) {
		const noun = r.noun || __("Rows");
		const items = [`<span class="rv-status-item">${__("{0} {1} of {2}", [esc(noun), num(r.row_count), num(r.fact_count)])}</span>`];
		if (r.group_count) {
			items.push(`<span class="rv-status-item">${__("Groups {0}", [num(r.group_count)])}</span>`);
		}
		if (r.filters) {
			items.push(`<span class="rv-status-flag">${icons.funnel_solid(12)}${esc(__("Filtered ({0})", [r.filters]))}</span>`);
		}
		this.el.firstElementChild.innerHTML = items.join("");
		this.el.hidden = false;
	}
}
