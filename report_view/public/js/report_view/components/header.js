// Page header (docs/architecture.md §11.1 #3-#11): breadcrumbs, title with the report type
// tag, the info line (company, period, currency, last run) and the action bar (density,
// theme, Excel, PDF, Print). Display only: values come from the page. PDF and Print are
// shown to users who may print, disabled until the server side of phase 6 exists: they
// open nothing (no preview is faked).

import { icons } from "./icons.js";

function esc(s) {
	return frappe.utils.escape_html(String(s ?? ""));
}

function fmt_date(d) {
	return frappe.format(d, { fieldtype: "Date" }, { inline: true });
}

export class Header {
	/**
	 * @param {object} opts {parent, on_density(d), on_theme(), on_export()}
	 */
	constructor({ parent, on_density, on_theme, on_export }) {
		const soon = esc(__("PDF and printing arrive with the server export (coming soon)"));
		const el = document.createElement("header");
		el.className = "rv-top";
		el.innerHTML = `
			<div class="rv-top-main">
				<nav class="rv-crumbs" aria-label="${esc(__("Breadcrumbs"))}"></nav>
				<div class="rv-title-row">
					<h1 class="rv-title"></h1>
					<span class="rv-tag" hidden></span>
				</div>
				<div class="rv-meta"></div>
			</div>
			<div class="rv-actions">
				<div class="rv-seg" role="group" aria-label="${esc(__("Density"))}">
					<button type="button" data-density="comfortable">${esc(__("Comfortable"))}</button>
					<button type="button" data-density="compact">${esc(__("Compact"))}</button>
				</div>
				<button type="button" class="rv-btn icon ghost" data-action="theme"></button>
				<span class="rv-vsep" data-export-sep hidden></span>
				<button type="button" class="rv-btn" data-action="export" hidden>${icons.sheet()}<span>${esc(__("Excel"))}</span></button>
				<button type="button" class="rv-btn" data-action="pdf" aria-disabled="true" title="${soon}" hidden>${icons.pdf()}<span>${esc(__("PDF", null, "Report View"))}</span></button>
				<button type="button" class="rv-btn" data-action="print" aria-disabled="true" title="${soon}" hidden>${icons.print()}<span>${esc(__("Print"))}</span></button>
			</div>`;
		parent.appendChild(el);
		this.el = el;
		this.$ = (sel) => el.querySelector(sel);
		for (const b of el.querySelectorAll("[data-density]")) {
			b.addEventListener("click", () => on_density(b.dataset.density));
		}
		this.$('[data-action="theme"]').addEventListener("click", () => on_theme());
		this.$('[data-action="export"]').addEventListener("click", () => on_export());
	}

	get export_button() {
		return this.$('[data-action="export"]');
	}

	/** @param {object} r {name, module, report_type, can_export, can_print} */
	set_report({ name, module, report_type, can_export, can_print }) {
		const title = __(name);
		const parts = [module ? __(module) : null, __("Reports")].filter(Boolean);
		this.$(".rv-crumbs").innerHTML =
			parts.map((p) => `<span>${esc(p)}</span>${icons.crumb()}`).join("") + `<b>${esc(title)}</b>`;
		this.$(".rv-title").textContent = title;
		const tag = this.$(".rv-tag");
		tag.hidden = !report_type;
		tag.textContent = report_type ? __(report_type) : "";
		this.export_button.hidden = !can_export;
		this.$('[data-action="pdf"]').hidden = !can_print;
		this.$('[data-action="print"]').hidden = !can_print;
		this.$("[data-export-sep]").hidden = !can_export && !can_print;
	}

	/**
	 * Info line of the last run.
	 * @param {object} m {filters, currency, run_at, running}
	 */
	set_meta({ filters = {}, currency = null, run_at = null, running = false }) {
		const items = [];
		if (filters.company) items.push(`<span>${esc(filters.company)}</span>`);
		if (filters.from_date && filters.to_date) {
			items.push(
				`<span>${esc(__("Period"))} <bdi class="ltr">${fmt_date(filters.from_date)} – ${fmt_date(filters.to_date)}</bdi></span>`
			);
		} else if (filters.report_date) {
			items.push(`<span>${esc(__("As on"))} <bdi class="ltr">${fmt_date(filters.report_date)}</bdi></span>`);
		} else if (filters.fiscal_year) {
			items.push(`<span>${esc(__("Fiscal Year"))} <bdi class="ltr">${esc(filters.fiscal_year)}</bdi></span>`);
		}
		if (currency) items.push(`<span>${esc(__("Currency"))} <bdi class="ltr">${esc(currency)}</bdi></span>`);
		if (running) items.push(`<span>${esc(__("Running…"))}</span>`);
		else if (run_at) items.push(`<span>${__("Last run {0}", [`<bdi class="ltr">${esc(run_at)}</bdi>`])}</span>`);
		this.$(".rv-meta").innerHTML = items.join('<span class="dot"></span>');
	}

	set_density(density) {
		for (const b of this.el.querySelectorAll("[data-density]")) {
			const on = b.dataset.density === density;
			b.classList.toggle("on", on);
			b.setAttribute("aria-pressed", on ? "true" : "false");
		}
	}

	set_theme(dark) {
		const b = this.$('[data-action="theme"]');
		const label = dark ? __("Switch to light mode") : __("Switch to dark mode");
		b.innerHTML = dark ? icons.sun() : icons.moon();
		b.setAttribute("aria-label", label);
		b.title = label;
	}
}
