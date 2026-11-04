// The saved views as sheet tabs (layout C, ADR-025; design: Sheet.dc.html of the approved
// canvas, the bottom bar): «Standard», the user's own views, then the ones shared with them;
// the tab of the view applied is selected (with the dot of a change), a star marks the user's
// default. A tab applies its view; «+» saves what the report shows as a new one. Saving over a
// view, editing, deleting and the default stay in the «Views» menu next to the tabs
// (components/views_menu.js). The list and its rules are the server's (host/saved_views_host.js).

import { esc } from "../util.js";

export class ViewsTabs {
	/**
	 * @param {object} o
	 * @param {HTMLElement} o.parent
	 * @param {object} o.on {apply(name|null), save_new()}
	 */
	constructor({ parent, on }) {
		this.on = on;
		const el = document.createElement("div");
		el.className = "rv-vtabs";
		el.innerHTML = `<div class="rv-vtabs-list" role="tablist" aria-label="${esc(__("Saved views"))}"></div>
			<button type="button" class="rv-vtab add" data-action="new-view" aria-label="${esc(__("Save as new…"))}" title="${esc(__("Save as new…"))}">+</button>`;
		parent.append(el);
		this.el = el;
		this.list_el = el.querySelector(".rv-vtabs-list");
		this.list_el.addEventListener("click", (e) => {
			const b = e.target.closest("[data-view]");
			if (b && b.getAttribute("aria-selected") !== "true") this.on.apply(b.dataset.view || null);
		});
		this.list_el.addEventListener("keydown", (e) => this.key(e));
		el.querySelector('[data-action="new-view"]').addEventListener("click", () => this.on.save_new());
		this.list = null;
		this.applied = null;
		this.modified = false;
		this.render();
	}

	/** ←/→ move between the tabs (the inline direction), Home/End to the ends. */
	key(e) {
		const tabs = [...this.list_el.querySelectorAll("[data-view]")];
		const i = tabs.indexOf(document.activeElement);
		if (i < 0) return;
		const rtl = getComputedStyle(this.el).direction === "rtl";
		const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key];
		let to = null;
		if (step) to = (i + step + tabs.length) % tabs.length;
		else if (e.key === "Home") to = 0;
		else if (e.key === "End") to = tabs.length - 1;
		if (to === null) return;
		e.preventDefault();
		tabs[to].focus();
	}

	/** @param {{mine: Array, shared: Array}|null} list */
	set_list(list) {
		this.list = list;
		this.render();
	}

	set_applied(applied, modified) {
		this.applied = applied || null;
		this.modified = Boolean(applied) && Boolean(modified);
		this.render();
	}

	render() {
		const l = this.list || { mine: [], shared: [] };
		const on = this.applied?.name || "";
		const rows = [{ name: "", title: __("Standard", null, "Saved view") }, ...(l.mine || []), ...(l.shared || [])];
		// a view applied before the list is read (a link's ?view=) has its tab too
		if (on && !rows.some((r) => r.name === on)) rows.push({ name: on, title: this.applied.title });
		const html = rows
			.map((r) => {
				const sel = r.name === on;
				const dot = sel && this.modified ? `<i class="dot" aria-hidden="true"></i>` : "";
				const star = r.is_user_default ? `<span class="star" aria-hidden="true">★</span>` : "";
				const title = sel && this.modified ? __("View: {0} (changed since it was applied)", [r.title]) : r.title;
				return `<button type="button" class="rv-vtab" role="tab" data-view="${esc(r.name)}" aria-selected="${sel}" tabindex="${sel ? 0 : -1}" title="${esc(title)}">${star}<span class="nm">${esc(r.title)}</span>${dot}</button>`;
			})
			.join("");
		if (html === this.html) return;
		const focused = this.list_el.contains(document.activeElement) ? document.activeElement.dataset.view : null;
		this.list_el.innerHTML = html;
		this.html = html;
		if (focused !== null && focused !== undefined) this.list_el.querySelector(`[data-view="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
	}
}
