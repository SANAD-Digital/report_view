// The report's filters as compact chips (layout A, ADR-025; design: Main.dc.html of the
// approved canvas, the second row of the head): «Company: SND Accounting», «Period: …», one
// chip per filter that holds a value, and «+ Filter» for the ones behind «More options». A chip
// opens its filter's own control in a popover (filters/filter_summary.js). The chips are kept
// and updated in place, so an open editor keeps its anchor while the values change.

import { icons } from "./icons.js";
import { filter_items, has_more, item_value_html, open_filter_editor } from "../filters/filter_summary.js";
import { esc } from "../util.js";

export class FilterChips {
	/**
	 * @param {object} o
	 * @param {HTMLElement} o.root the .rv element (popovers)
	 * @param {HTMLElement} o.parent
	 */
	constructor({ root, parent }) {
		this.root = root;
		this.criteria = null;
		const el = document.createElement("div");
		el.className = "rv-chips";
		el.setAttribute("role", "group");
		el.setAttribute("aria-label", __("Report criteria"));
		parent.append(el);
		this.el = el;
		this.chips = new Map();
		this.add = document.createElement("button");
		this.add.type = "button";
		this.add.className = "rv-fchip add";
		this.add.setAttribute("aria-haspopup", "dialog");
		this.add.innerHTML = `<span aria-hidden="true">+</span><span>${esc(__("Filter", null, "Report View"))}</span>`;
		this.add.addEventListener("click", () => open_filter_editor({ root: this.root, criteria: this.criteria, item: null, anchor: this.add }));
		el.append(this.add);
		this.add.hidden = true;
	}

	/** A new report: its criteria bar (null while it loads). */
	set_criteria(criteria) {
		this.criteria = criteria;
		for (const b of this.chips.values()) b.remove();
		this.chips.clear();
		this.refresh();
	}

	refresh() {
		const items = filter_items(this.criteria);
		const keep = new Set(items.map((it) => it.key));
		for (const [key, b] of this.chips) {
			if (!keep.has(key)) {
				b.remove();
				this.chips.delete(key);
			}
		}
		let before = this.el.firstChild;
		for (const it of items) {
			let b = this.chips.get(it.key);
			if (!b) {
				b = document.createElement("button");
				b.type = "button";
				b.className = "rv-fchip";
				b.dataset.filter = it.key;
				b.setAttribute("aria-haspopup", "dialog");
				b.addEventListener("click", () => {
					const now = filter_items(this.criteria).find((x) => x.key === it.key);
					if (now) open_filter_editor({ root: this.root, criteria: this.criteria, item: now, anchor: b });
				});
				this.chips.set(it.key, b);
			}
			const html = `<span class="k">${esc(it.label)}:</span> <b>${item_value_html(it)}</b>${icons.chevron_down(12)}`;
			if (b.dataset.html !== html) {
				b.innerHTML = html;
				b.dataset.html = html;
			}
			b.classList.toggle("unset", !it.text);
			b.classList.toggle("wanted", Boolean(it.primary) && !it.text);
			b.title = it.text ? `${it.label}: ${it.text}` : it.label;
			if (b !== before) this.el.insertBefore(b, before);
			before = b.nextSibling;
		}
		this.el.append(this.add);
		this.add.hidden = !has_more(this.criteria);
	}
}
