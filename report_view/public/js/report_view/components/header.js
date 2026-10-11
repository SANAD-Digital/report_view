// Page actions (refresh, density, theme, Excel, Print), placed in Desk's own sticky page head so the
// report keeps the screen: the title is Desk's page title. Print opens the Pages view, where
// the pages are printed from (ADR-014); PDF from the server comes with phase 6.
// The element carries the .rv class itself: it lives outside the page root, and the design
// tokens (light / dark / compact) are defined on .rv.

import { icons } from "./icons.js";

function esc(s) {
	return frappe.utils.escape_html(String(s ?? ""));
}

export class Header {
	/**
	 * @param {object} opts {parent, dir, on_refresh(), on_density(d), on_theme(), on_export()}
	 */
	constructor({ parent, dir, on_refresh, on_density, on_theme, on_export, on_print }) {
		const refresh = esc(__("Refresh"));
		const el = document.createElement("div");
		el.className = "rv rv-headbar";
		el.dir = dir;
		el.innerHTML = `
			<div class="rv-actions">
				<button type="button" class="rv-btn icon ghost" data-action="refresh" title="${refresh}" aria-label="${refresh}">${icons.refresh()}</button>
				<div class="rv-seg" role="group" aria-label="${esc(__("Density"))}">
					<button type="button" data-density="comfortable">${esc(__("Comfortable"))}</button>
					<button type="button" data-density="compact">${esc(__("Compact"))}</button>
				</div>
				<button type="button" class="rv-btn icon ghost" data-action="theme"></button>
				<button type="button" class="rv-btn" data-action="export" hidden>${icons.sheet()}<span>${esc(__("Excel"))}</span></button>
				<button type="button" class="rv-btn" data-action="print" hidden>${icons.print()}<span>${esc(__("Print", null, "Report View"))}</span></button>
			</div>`;
		parent.prepend(el);
		this.el = el;
		this.$ = (sel) => el.querySelector(sel);
		for (const b of el.querySelectorAll("[data-density]")) {
			b.addEventListener("click", () => on_density(b.dataset.density));
		}
		this.$('[data-action="refresh"]').addEventListener("click", () => on_refresh());
		this.$('[data-action="theme"]').addEventListener("click", () => on_theme());
		this.$('[data-action="export"]').addEventListener("click", () => on_export());
		this.$('[data-action="print"]').addEventListener("click", () => on_print && on_print());
	}

	get export_button() {
		return this.$('[data-action="export"]');
	}

	/** @param {object} r {can_export, can_print} */
	set_report({ can_export, can_print = false }) {
		this.export_button.hidden = !can_export;
		this.$('[data-action="print"]').hidden = !can_print;
	}

	/** The Print action shows the current mode: pressed while the pages are on screen. */
	set_mode(mode) {
		this.$('[data-action="print"]').classList.toggle("on", mode === "pages");
	}

	set_density(density) {
		this.el.classList.toggle("compact", density === "compact");
		for (const b of this.el.querySelectorAll("[data-density]")) {
			const on = b.dataset.density === density;
			b.classList.toggle("on", on);
			b.setAttribute("aria-pressed", on ? "true" : "false");
		}
	}

	set_theme(dark) {
		this.el.classList.toggle("dark", dark);
		const b = this.$('[data-action="theme"]');
		const label = dark ? __("Switch to light mode") : __("Switch to dark mode");
		b.innerHTML = dark ? icons.sun() : icons.moon();
		b.setAttribute("aria-label", label);
		b.title = label;
	}
}
