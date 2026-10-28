// Status bar under the grid (docs/architecture.md §11.1 #66; design: .rv-status in
// reference/design/screens/main.png): "<rows> N of M · Groups K", the filtered flag, and the
// hints of what the grid does. Counts come from the engine result. A selected range of cells
// adds its count, sum and average (phase 5c; read by host/range_host.js from the engine's
// window of the range, §8أ.5).

import { icons } from "./icons.js";
import { esc, fmt_int } from "../util.js";

function num(n) {
	return `<b>${esc(fmt_int(n))}</b>`;
}

export class StatusBar {
	constructor({ parent }) {
		const el = document.createElement("footer");
		el.className = "rv-status";
		el.innerHTML = `<div class="rv-status-grp"></div><div class="rv-status-grp rv-status-sel" role="status" aria-live="polite"></div><div class="rv-status-grp"><span class="rv-status-hint"></span></div>`;
		parent.appendChild(el);
		this.el = el;
		this.sel = el.querySelector(".rv-status-sel");
		this.set_hint(true);
		this.clear();
	}

	/** The hint of what the grid does (a range is named only when the report offers it). */
	set_hint(range) {
		const text = range
			? __("Click a title to sort · drag it to group · drag over cells to select · right-click for actions")
			: __("Click a title to sort · drag it to group · ≡ column menu");
		this.el.querySelector(".rv-status-hint").textContent = text;
	}

	clear() {
		this.el.firstElementChild.innerHTML = "";
		this.set_range(null);
		this.el.hidden = true;
	}

	/**
	 * The selected range: its cells, and the count, sum and average of its numeric cells
	 * (already formatted), or null for none.
	 * @param {{cells: number, count: number, sum: string|null, avg: string|null}|null} r
	 */
	set_range(r) {
		if (!r) {
			this.sel.innerHTML = "";
			this.sel.hidden = true;
			return;
		}
		const items = [`<span class="rv-status-item" data-k="cells">${__("Cells {0}", [num(r.cells)])}</span>`];
		if (r.count) {
			items.push(`<span class="rv-status-item" data-k="count">${__("Count {0}", [num(r.count)])}</span>`);
			items.push(`<span class="rv-status-item" data-k="sum">${__("Sum {0}", [`<b><bdi>${esc(r.sum)}</bdi></b>`])}</span>`);
			items.push(`<span class="rv-status-item" data-k="avg">${__("Average {0}", [`<b><bdi>${esc(r.avg)}</bdi></b>`])}</span>`);
		}
		this.sel.innerHTML = items.join("");
		this.sel.hidden = false;
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
