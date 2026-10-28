// Page actions (refresh, density, theme, Excel, Print), placed in Desk's own sticky page head so the
// report keeps the screen: the title is Desk's page title. Print opens the Pages view, where
// the pages are printed from (ADR-014); PDF from the server comes with phase 6.
// The element carries the .rv class itself: it lives outside the page root, and the design
// tokens (made of Frappe's variables, ADR-022; compact) are defined on .rv.

import { icons } from "./icons.js";
import { esc } from "../util.js";

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
				<div class="rv-views-slot"></div>
				<button type="button" class="rv-btn icon ghost" data-action="refresh" title="${refresh}" aria-label="${refresh}">${icons.refresh()}</button>
				<div class="rv-seg" role="group" aria-label="${esc(__("Density"))}">
					<button type="button" data-density="comfortable">${esc(__("Comfortable"))}</button>
					<button type="button" data-density="compact">${esc(__("Compact"))}</button>
				</div>
				<button type="button" class="rv-btn icon ghost" data-action="theme"></button>
				<button type="button" class="rv-btn" data-action="export" hidden>${icons.sheet()}<span>${esc(__("Excel"))}</span></button>
				<div class="rv-xjob" role="status" aria-live="polite" hidden><span class="rv-xspin" aria-hidden="true"></span><span class="txt"></span><button type="button" class="rv-btn icon ghost" data-action="export-stop" aria-label="${esc(__("Stop waiting"))}" title="${esc(__("Stop waiting"))}">${icons.close()}</button></div>
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
		this.$('[data-action="export-stop"]').addEventListener("click", () => this.on_export_stop && this.on_export_stop());
	}

	/**
	 * The state of an Excel file the server prepares in the background, next to the button;
	 * null hides it.
	 * @param {{text: string, on_stop: () => void}|null} job
	 */
	set_export_job(job) {
		const el = this.$(".rv-xjob");
		el.hidden = !job;
		this.on_export_stop = job?.on_stop || null;
		const txt = el.querySelector(".txt");
		if (txt.textContent !== (job?.text || "")) txt.textContent = job?.text || "";
	}

	/** Where the «Views» menu goes (components/views_menu.js, ADR-010). */
	get views_slot() {
		return this.$(".rv-views-slot");
	}

	get export_button() {
		return this.$('[data-action="export"]');
	}

	/** @param {object} r {can_export, can_print, features (Report View Settings, ADR-023)} */
	set_report({ can_export, can_print = false, features = null }) {
		this.export_button.hidden = !can_export || features?.excel === false;
		this.$('[data-action="print"]').hidden = !can_print || features?.pages === false;
		this.$(".rv-seg").hidden = features?.density === false;
	}

	/**
	 * The Print action shows the current mode: pressed while the pages are on screen. The
	 * Excel file is the table's (the server exports the grid view only): in the other views
	 * the button is disabled and says so.
	 */
	set_mode(mode) {
		this.$('[data-action="print"]').classList.toggle("on", mode === "pages");
		this.mode = mode;
		this.paint_export();
	}

	/** An export in progress keeps the button disabled. */
	set_exporting(on) {
		this.exporting = on;
		this.paint_export();
	}

	paint_export() {
		const b = this.export_button;
		const table = !this.mode || this.mode === "grid";
		b.disabled = Boolean(this.exporting) || !table;
		const note = table ? "" : __("Excel export is available in the Table view");
		b.title = note;
		if (note) b.setAttribute("aria-description", note);
		else b.removeAttribute("aria-description");
	}

	set_density(density) {
		this.el.classList.toggle("compact", density === "compact");
		for (const b of this.el.querySelectorAll("[data-density]")) {
			const on = b.dataset.density === density;
			b.classList.toggle("on", on);
			b.setAttribute("aria-pressed", on ? "true" : "false");
		}
	}

	/** The theme button shows Desk's theme (the page has none of its own, ADR-022). */
	set_theme(dark) {
		const b = this.$('[data-action="theme"]');
		const label = dark ? __("Switch to light mode") : __("Switch to dark mode");
		b.innerHTML = dark ? icons.sun() : icons.moon();
		b.setAttribute("aria-label", label);
		b.title = label;
	}
}
