// Search box of the toolbar (docs/architecture.md §11.1 #27-#29; design:
// reference/design/screens/search.png): the active filters as facets, a text input, and a
// dropdown with the quick filters, values of a dimension, and "Group by". Text + Enter is a
// "contains" filter on the label column (a Perspective filter, through the view state);
// with text, the dropdown offers the same search in the other text columns. Display and
// events only: the page owns the view state.

import { icons } from "./icons.js";
import { open_popover, close_popover } from "./popover.js";
import { esc } from "../util.js";

export class SearchBox {
	/**
	 * @param {object} o
	 * @param {HTMLElement} o.root the .rv element (popovers)
	 * @param {HTMLElement} o.parent
	 * @param {object} o.host {chips(), placeholder(), suggestions(text), options(), search(text)}
	 */
	constructor({ root, parent, host }) {
		this.root = root;
		this.host = host;
		const el = document.createElement("div");
		el.className = "rv-search";
		el.innerHTML = `${icons.search()}<span class="rv-facets"></span>
			<input type="text" aria-label="${esc(__("Search and filter"))}" autocomplete="off">
			<button type="button" class="rv-btn icon sm ghost" data-action="options" aria-haspopup="dialog" aria-label="${esc(__("Search options"))}" title="${esc(__("Search options"))}">${icons.chevron_down(15)}</button>`;
		parent.appendChild(el);
		this.el = el;
		this.input = el.querySelector("input");
		this.facets = el.querySelector(".rv-facets");
		el.addEventListener("mousedown", (e) => {
			if (e.target === el || e.target === this.facets) {
				e.preventDefault();
				this.input.focus();
			}
		});
		this.input.addEventListener("focus", () => this.open());
		this.input.addEventListener("input", () => (this.popover ? this.fill() : this.open()));
		this.input.addEventListener("keydown", (e) => this.key(e));
		el.querySelector('[data-action="options"]').addEventListener("click", () => (this.popover ? close_popover() : this.open()));
		this.refresh();
	}

	key(e) {
		const text = this.input.value.trim();
		if (e.key === "Enter" && text) {
			e.preventDefault();
			this.input.value = "";
			close_popover();
			this.host.search(text);
		} else if (e.key === "Backspace" && !this.input.value) {
			const chips = this.host.chips();
			if (chips.length) chips[chips.length - 1].remove();
		} else if (e.key === "Escape") {
			close_popover();
		} else if (e.key === "ArrowDown" && this.popover) {
			e.preventDefault();
			this.popover.el.querySelector(".rv-mi")?.focus();
		}
	}

	/** Facets and placeholder from the view state; the open dropdown follows. */
	refresh() {
		const chips = this.host.chips();
		this.facets.innerHTML = chips
			.map(
				(c, i) => `<span class="rv-facet"><span class="rv-facet-k">${esc(c.k)}</span><span class="rv-facet-v" title="${esc(c.v)}">${esc(c.v)}</span>` +
					`<button type="button" class="rv-facet-x" data-chip="${i}" aria-label="${esc(__("Remove the filter"))}">${icons.x_sm()}</button></span>`
			)
			.join("");
		for (const b of this.facets.querySelectorAll("[data-chip]")) {
			b.addEventListener("click", () => chips[Number(b.dataset.chip)].remove());
		}
		this.input.placeholder = chips.length ? __("Add a filter…") : this.host.placeholder();
		if (this.popover) this.fill();
	}

	open() {
		if (this.popover) return;
		const content = document.createElement("div");
		this.content = content;
		this.popover = open_popover({
			root: this.root,
			anchor: this.el,
			content,
			cls: "rv-search-pop",
			width: Math.max(this.el.offsetWidth, 560),
			label: __("Search options"),
			on_close: () => {
				this.popover = null;
			},
		});
		this.fill();
	}

	async fill() {
		const content = this.content;
		const text = this.input.value.trim();
		if (text) {
			content.innerHTML = "";
			for (const s of this.host.suggestions(text)) {
				const b = document.createElement("button");
				b.type = "button";
				b.className = "rv-mi rv-sugg";
				b.innerHTML = `<span class="rv-mi-ic">${icons.search(15)}</span><span class="rv-mi-lbl">${__("Search {0} for: «{1}»", [`<b>${esc(s.column)}</b>`, esc(text)])}</span><span class="rv-mi-hint">${esc(s.hint || "")}</span>`;
				b.addEventListener("click", () => {
					this.input.value = "";
					close_popover();
					s.act(text);
				});
				content.appendChild(b);
			}
			this.popover?.place();
			return;
		}
		const token = (this.fill_token = (this.fill_token || 0) + 1);
		const o = await this.host.options();
		if (token !== this.fill_token || !this.popover || this.input.value.trim()) return;
		const item = (it, hint = "") => {
			const b = document.createElement("button");
			b.type = "button";
			b.className = "rv-mi";
			b.setAttribute("aria-pressed", it.on ? "true" : "false");
			b.innerHTML = `<span class="rv-mi-check">${it.on ? icons.check_sm() : ""}</span><span class="rv-mi-lbl">${esc(it.label)}</span><span class="rv-mi-hint">${esc(hint)}</span>`;
			b.addEventListener("click", () => it.toggle());
			return b;
		};
		const col = (title_icon, title, groups) => {
			const c = document.createElement("div");
			c.className = "rv-sdrop-col";
			c.innerHTML = title ? `<div class="rv-sdrop-t">${title_icon}${esc(title)}</div>` : "";
			groups.forEach((g, i) => {
				if (!g.length) return;
				if (i && c.querySelector(".rv-mi")) c.insertAdjacentHTML("beforeend", '<div class="rv-msep"></div>');
				for (const el of g) c.appendChild(el);
			});
			return c;
		};
		const wrap = document.createElement("div");
		wrap.className = "rv-sdrop";
		const filters = [o.quick.map((it) => item(it)), o.facets.map((it) => item(it))];
		if (filters.some((g) => g.length)) wrap.appendChild(col(icons.funnel(), __("Filters", null, "Report View"), filters));
		// no "Group by" where the report's settings turned grouping off (ADR-023): the hint stays
		const groups = o.groups.length
			? col(icons.group(), __("Group by"), [o.groups.map((it) => item(it, it.order ? String(it.order) : ""))])
			: wrap.lastElementChild || col("", "", []);
		groups.insertAdjacentHTML("beforeend", `<div class="rv-msep"></div><div class="rv-zone-empty rv-sdrop-hint">${esc(o.hint)}</div>`);
		if (groups.parentNode !== wrap) wrap.appendChild(groups);
		wrap.classList.toggle("one", wrap.children.length === 1);
		content.replaceChildren(wrap);
		this.popover?.place();
	}
}
