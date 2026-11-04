// The head of layout A (ADR-025; design: Main.dc.html of the approved canvas «Report screen —
// directions», direction A): two rows inside the page. Row 1: the breadcrumb and the report's
// title; the view modes as a segmented control; Views ▾, refresh, Export ▾ and ⋯. Row 2: the
// report's filters as chips (components/filter_chips.js). It stands in for components/header.js
// (the same methods: the page calls either the same way), and Desk's own page head is hidden
// on this page (rv_layouts.css).

import { icons } from "./icons.js";
import { FilterChips } from "./filter_chips.js";
import { open_export_menu, open_more_menu } from "./head_menus.js";
import { esc } from "../util.js";

export const MODES = [
	{ mode: "statement", icon: () => icons.pages(), label: () => __("Statement", null, "Report View mode") },
	{ mode: "grid", icon: () => icons.table(), label: () => __("Table") },
	{ mode: "pivot", icon: () => icons.pivot(), label: () => __("Pivot analysis") },
	{ mode: "charts", icon: () => icons.chart(), label: () => __("Charts") },
	{ mode: "pages", icon: () => icons.pages(), label: () => __("Pages") },
];

export class HeaderA {
	/**
	 * @param {object} o {page (the ReportViewPage), parent, on_refresh(), on_mode(mode)}
	 */
	constructor({ page, parent, on_refresh, on_mode }) {
		this.page = page;
		const refresh = esc(__("Refresh"));
		const more = esc(__("More"));
		const el = document.createElement("header");
		el.className = "rv-ha";
		el.innerHTML = `
			<div class="rv-ha-r1">
				<div class="rv-ha-title">
					<div class="rv-crumb"></div>
					<h1 class="rv-h1"></h1>
				</div>
				<div class="rv-modes" role="tablist" aria-label="${esc(__("View"))}">
					${MODES.map((m) => `<button type="button" role="tab" data-mode="${m.mode}" aria-selected="false">${esc(m.label())}</button>`).join("")}
				</div>
				<div class="rv-ha-acts">
					<div class="rv-views-slot"></div>
					<button type="button" class="btn btn-default btn-sm icon-btn" data-action="refresh" title="${refresh}" aria-label="${refresh}">${icons.refresh()}</button>
					<button type="button" class="btn btn-default btn-sm" data-action="export-menu" aria-haspopup="menu" hidden><span>${esc(__("Export"))}</span>${icons.chevron_down(12)}</button>
					<div class="rv-xjob" role="status" aria-live="polite" hidden><span class="rv-xspin" aria-hidden="true"></span><span class="txt"></span><button type="button" class="rv-btn icon ghost" data-action="export-stop" aria-label="${esc(__("Stop waiting"))}" title="${esc(__("Stop waiting"))}">${icons.close()}</button></div>
					<button type="button" class="btn btn-default btn-sm icon-btn" data-action="more" aria-haspopup="menu" aria-label="${more}" title="${more}">${icons.more()}</button>
				</div>
			</div>
			<div class="rv-ha-r2"></div>`;
		parent.prepend(el);
		this.el = el;
		this.$ = (sel) => el.querySelector(sel);
		this.tabs = [...el.querySelectorAll(".rv-modes [data-mode]")];
		for (const t of this.tabs) t.addEventListener("click", () => on_mode(t.dataset.mode));
		this.$('[data-action="refresh"]').addEventListener("click", () => on_refresh());
		this.$('[data-action="export-menu"]').addEventListener("click", (e) => open_export_menu(page, e.currentTarget));
		this.$('[data-action="more"]').addEventListener("click", (e) => open_more_menu(page, e.currentTarget, { print: false }));
		this.$('[data-action="export-stop"]').addEventListener("click", () => this.on_export_stop && this.on_export_stop());
		this.chips = new FilterChips({ root: page.root, parent: this.$(".rv-ha-r2") });
		this.set_mode("grid");
	}

	/** The breadcrumb (the report's module) and the title. */
	set_title(title, module) {
		this.$(".rv-h1").textContent = title || "";
		this.$(".rv-crumb").textContent = module ? `${__(module)} · ${__("Reports")}` : __("Reports");
	}

	/** The rows and «last updated» are the table toolbar's (layouts/layout.js). */
	set_meta() {}

	set_export_job(job) {
		const el = this.$(".rv-xjob");
		el.hidden = !job;
		this.on_export_stop = job?.on_stop || null;
		const txt = el.querySelector(".txt");
		if (txt.textContent !== (job?.text || "")) txt.textContent = job?.text || "";
	}

	get views_slot() {
		return this.$(".rv-views-slot");
	}

	get export_button() {
		return this.$('[data-action="export-menu"]');
	}

	/** @param {object} r {can_export, can_print, features, modes} */
	set_report({ can_export, can_print = false, features = null }) {
		const excel = Boolean(can_export) && features?.excel !== false;
		const pages = Boolean(can_print) && features?.pages !== false;
		this.export_button.hidden = !excel && !pages;
		this.set_modes(this.page.modes());
	}

	/** The tabs a report offers (its settings and the print permission); one left: no switcher. */
	set_modes(modes) {
		for (const t of this.tabs) t.hidden = !modes.includes(t.dataset.mode);
		this.$(".rv-modes").hidden = this.tabs.filter((t) => !t.hidden).length < 2;
	}

	set_mode(mode) {
		this.mode = mode;
		const shown = MODES.some((m) => m.mode === mode) ? mode : "grid";
		for (const t of this.tabs) {
			const on = t.dataset.mode === shown;
			t.classList.toggle("on", on);
			t.setAttribute("aria-selected", on ? "true" : "false");
		}
		// Export is the table's and the pages' (the mockup's Pages mode leaves it to the print column)
		this.export_button.classList.toggle("rv-off-pages", mode === "pages");
	}

	set_exporting(on) {
		this.exporting = on;
	}

	set_density(density) {
		this.page.shell?.paint_density(density);
	}

	set_theme() {}
}
