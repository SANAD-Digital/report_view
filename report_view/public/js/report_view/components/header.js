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

	get export_button() {
		return this.$('[data-action="export"]');
	}

	/** @param {object} r {can_export, can_print} */
	set_report({ can_export, can_print = false }) {
		this.export_button.hidden = !can_export;
		this.$('[data-action="print"]').hidden = !can_print;
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

	set_theme(dark) {
		this.el.classList.toggle("dark", dark);
		const b = this.$('[data-action="theme"]');
		const label = dark ? __("Switch to light mode") : __("Switch to dark mode");
		b.innerHTML = dark ? icons.sun() : icons.moon();
		b.setAttribute("aria-label", label);
		b.title = label;
	}
}
