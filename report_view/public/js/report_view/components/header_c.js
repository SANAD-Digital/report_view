// The head of layout C (ADR-025; design: Sheet.dc.html of the approved canvas «Report screen —
// directions», direction C): the title with the filters written as one sentence
// (components/filter_sentence.js), then one dense toolbar: the view modes as pressed toggles,
// Group by ▾, Subtotals, Columns, Density ▾, the search box, and at the end Refresh, Export ▾,
// Print and ⋯. On a phone the table tools fold into ⋯ (rv_layouts.css). It stands in for
// components/header.js (the same methods); Desk's own page head is hidden on this page.

import { icons } from "./icons.js";
import { FilterSentence } from "./filter_sentence.js";
import { MODES } from "./header_a.js";
import { open_export_menu, open_more_menu } from "./head_menus.js";
import { esc } from "../util.js";

export class HeaderC {
	/**
	 * @param {object} o {page (the ReportViewPage), parent, on_refresh(), on_mode(mode), on_print()}
	 */
	constructor({ page, parent, on_refresh, on_mode, on_print }) {
		this.page = page;
		const el = document.createElement("header");
		el.className = "rv-hc";
		el.innerHTML = `<div class="rv-hc-line"><h1 class="rv-h1"></h1></div>`;
		const bar = document.createElement("div");
		bar.className = "rv-tc";
		bar.setAttribute("role", "toolbar");
		bar.setAttribute("aria-label", __("Report tools"));
		const more = esc(__("More"));
		bar.innerHTML = `
			<div class="rv-tc-modes" role="group" aria-label="${esc(__("View"))}">
				${MODES.map((m) => `<button type="button" class="rv-tb" data-mode="${m.mode}" aria-pressed="false" title="${esc(m.label())}">${m.icon()}<span>${esc(m.label())}</span></button>`).join("")}
			</div>
			<span class="rv-tsep" data-sep="modes" aria-hidden="true"></span>
			<div class="rv-tc-tools"></div>
			<span class="rv-tsep" data-sep="tools" aria-hidden="true"></span>
			<div class="rv-tc-search"></div>
			<span class="rv-tc-sp"></span>
			<button type="button" class="rv-tb" data-action="refresh">${icons.refresh()}<span>${esc(__("Refresh"))}</span></button>
			<button type="button" class="rv-tb" data-action="export-menu" aria-haspopup="menu" hidden><span>${esc(__("Export"))}</span>${icons.chevron_down(12)}</button>
			<div class="rv-xjob" role="status" aria-live="polite" hidden><span class="rv-xspin" aria-hidden="true"></span><span class="txt"></span><button type="button" class="rv-btn icon ghost" data-action="export-stop" aria-label="${esc(__("Stop waiting"))}" title="${esc(__("Stop waiting"))}">${icons.close()}</button></div>
			<button type="button" class="rv-tb" data-action="print" hidden>${icons.print()}<span>${esc(__("Print", null, "Report View"))}</span></button>
			<button type="button" class="rv-tb icon" data-action="more" aria-haspopup="menu" aria-label="${more}" title="${more}">${icons.more()}</button>`;
		parent.prepend(el, bar);
		this.el = el;
		this.bar = bar;
		this.$ = (sel) => el.querySelector(sel) || bar.querySelector(sel);
		this.tabs = [...bar.querySelectorAll(".rv-tc-modes [data-mode]")];
		for (const t of this.tabs) t.addEventListener("click", () => on_mode(t.dataset.mode));
		this.$('[data-action="refresh"]').addEventListener("click", () => on_refresh());
		this.$('[data-action="print"]').addEventListener("click", () => on_print());
		this.$('[data-action="export-menu"]').addEventListener("click", (e) => open_export_menu(page, e.currentTarget));
		this.$('[data-action="more"]').addEventListener("click", (e) => this.open_more(e.currentTarget));
		this.$('[data-action="export-stop"]').addEventListener("click", () => this.on_export_stop && this.on_export_stop());
		this.sentence = new FilterSentence({ root: page.root, parent: this.$(".rv-hc-line") });
		// the views menu lives in the bottom bar, next to the tabs (layouts/layout.js)
		this.slot = document.createElement("div");
		this.slot.className = "rv-views-slot";
		this.set_mode("grid");
	}

	/** Where the table tools go (layouts/layout.js). */
	get tools_slot() {
		return this.$(".rv-tc-tools");
	}

	get search_slot() {
		return this.$(".rv-tc-search");
	}

	/** ⋯: on a phone it also holds the table tools the bar folds away (layouts/layout.js). */
	open_more(anchor) {
		if (this.page.shell?.more_items && window.matchMedia("(max-width: 900px)").matches) {
			this.page.shell.open_phone_more(anchor);
			return;
		}
		open_more_menu(this.page, anchor, { print: false });
	}

	set_title(title) {
		this.$(".rv-h1").textContent = title || "";
	}

	set_meta() {}

	set_export_job(job) {
		const el = this.$(".rv-xjob");
		el.hidden = !job;
		this.on_export_stop = job?.on_stop || null;
		const txt = el.querySelector(".txt");
		if (txt.textContent !== (job?.text || "")) txt.textContent = job?.text || "";
	}

	get views_slot() {
		return this.slot;
	}

	get export_button() {
		return this.$('[data-action="export-menu"]');
	}

	set_report({ can_export, can_print = false, features = null }) {
		const excel = Boolean(can_export) && features?.excel !== false;
		const pages = Boolean(can_print) && features?.pages !== false;
		this.export_button.hidden = !excel && !pages;
		this.$('[data-action="print"]').hidden = !pages;
		const modes = this.page.modes();
		for (const t of this.tabs) t.hidden = !modes.includes(t.dataset.mode);
		const few = this.tabs.filter((t) => !t.hidden).length < 2;
		this.$(".rv-tc-modes").hidden = few;
		this.$('[data-sep="modes"]').hidden = few;
	}

	set_mode(mode) {
		this.mode = mode;
		const shown = MODES.some((m) => m.mode === mode) ? mode : "grid";
		for (const t of this.tabs) t.setAttribute("aria-pressed", t.dataset.mode === shown ? "true" : "false");
		this.$('[data-action="print"]').classList.toggle("on", mode === "pages");
	}

	set_exporting(on) {
		this.exporting = on;
	}

	set_density(density) {
		this.page.shell?.paint_density(density);
	}

	set_theme() {}
}
