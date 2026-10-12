// Pages view (docs/architecture.md §11.1 #77, ADR-014; design: reference/design/screens/
// print.png): the report as it prints, page by page, next to the table. The pages are
// built in the browser from the same view the grid shows (views/grid_rows.js), cut by the
// arithmetic of engine/page_layout.js on measured heights; every page repeats the letter
// head, the title, the column titles and the footer with its number. The side panel holds
// the paper (size, orientation, margins), the template (the standard one or a report print
// format), the letter head, the language and the content; "Print" prints these very pages
// (window.print: the browser's dialog, paper or PDF).
// Only the pages near the viewport carry content (IntersectionObserver); the rest are empty
// boxes of the right size, so a report of a hundred thousand rows stays smooth. Printing
// fills them all first (up to PRINT_MAX_PAGES).
// Another language: the report runs again on the server with `_lang` (its column labels and
// captions come translated), the page's own words come from api.get_translations; the rows
// and their order stay those of the view.

import { GridRows } from "./grid_rows.js";
import { build_layout } from "../engine/row_layout.js";
import { page_box, fit_columns, paginate, PAGE_SIZES, MARGINS, PAGE_FONT, SCREEN_FONT } from "../engine/page_layout.js";
import { icons } from "../components/icons.js";
import { esc } from "../util.js";

export const PRINT_MAX_PAGES = 600;
// Pages around the viewport that carry content, and how many filled pages are kept.
const NEAR_PAGES = 2;
const KEEP_FILLED = 16;
const FILL_PARALLEL = 1;
const ZOOM_STEPS = [0.4, 0.5, 0.67, 0.8, 1, 1.25, 1.5];
const PAGE_GAP = 24;
const STAGE_PAD = 28;
// Keys of the report filters the title block already shows (the period and the company).
const PERIOD_KEYS = new Set(["from_date", "to_date", "fiscal_year", "report_date", "date", "posting_date", "as_on_date", "period_start_date", "period_end_date"]);
const RTL_LANGS = new Set(["ar", "he", "fa", "ps", "ur"]);

export const DEFAULT_SETTINGS = Object.freeze({
	size: "A4",
	orientation: "portrait",
	margins: "normal",
	template: "",
	letter_head: "",
	lang: "",
	include_filters: true,
	include_subtotals: true,
	include_total: true,
	signatures: false,
	page_numbers: true,
	printed_on: true,
	letterhead_all: false,
	// heights in mm of the letter head band and of its footer (0 = no footer)
	lh_height: 26,
	foot_height: 11,
	// where the page number stands and how it reads
	number_pos: "bottom-end",
	number_format: "full",
	hidden: [],
	zoom: "fit",
});
export const LH_HEIGHT = { min: 10, max: 70 };
export const FOOT_HEIGHT = { min: 0, max: 40 };
const NUMBER_POS = ["bottom-end", "bottom-center", "bottom-start", "top-end", "top-center", "top-start"];
const NUMBER_FORMATS = ["full", "short", "number"];
const BOOL_KEYS = ["include_filters", "include_subtotals", "include_total", "signatures", "page_numbers", "printed_on", "letterhead_all"];

// The page's own words, by msgid, for the translation pack of another language.
const PAGE_MESSAGES = [
	"Grand Total",
	"Total {0}",
	"Page {0} of {1}",
	"Printed on {0}",
	"Printed by {0}",
	"Applied filters",
	"Grouped by {0}",
	"{0} rows",
	"Accountant",
	"Finance Manager",
	"General Manager",
	"Name:Report View",
	"Signature:Report View",
	"Not Set",
	"Opening",
	"Closing (Opening + Total)",
	"Total",
	"For the period from {0} to {1}",
	"As on {0}",
	"Fiscal Year {0}",
	"Yes",
];

function format_msg(text, args) {
	return String(text).replace(/\{(\d+)\}/g, (m, i) => (args && args[i] !== undefined ? args[i] : m));
}

function strip_scripts(html) {
	if (!html) return "";
	const tpl = document.createElement("template");
	tpl.innerHTML = html;
	for (const s of tpl.content.querySelectorAll("script")) s.remove();
	return tpl.innerHTML;
}

function wait_images(el, timeout = 2500) {
	const imgs = [...el.querySelectorAll("img")].filter((img) => !img.complete);
	if (!imgs.length) return Promise.resolve();
	return Promise.all(
		imgs.map(
			(img) =>
				new Promise((resolve) => {
					const done = () => resolve();
					img.addEventListener("load", done, { once: true });
					img.addEventListener("error", done, { once: true });
					setTimeout(done, timeout);
				})
		)
	);
}

function sanitize_settings(raw) {
	const out = { ...DEFAULT_SETTINGS, hidden: [] };
	if (!raw || typeof raw !== "object") return out;
	if (PAGE_SIZES[raw.size]) out.size = raw.size;
	if (raw.orientation === "landscape" || raw.orientation === "portrait") out.orientation = raw.orientation;
	if (MARGINS[raw.margins] !== undefined) out.margins = raw.margins;
	for (const k of ["template", "letter_head", "lang"]) if (typeof raw[k] === "string") out[k] = raw[k];
	for (const k of BOOL_KEYS) if (typeof raw[k] === "boolean") out[k] = raw[k];
	const mm = (v, r) => (Number.isFinite(v) ? Math.max(r.min, Math.min(r.max, Math.round(v))) : null);
	if (mm(raw.lh_height, LH_HEIGHT) !== null) out.lh_height = mm(raw.lh_height, LH_HEIGHT);
	if (mm(raw.foot_height, FOOT_HEIGHT) !== null) out.foot_height = mm(raw.foot_height, FOOT_HEIGHT);
	if (NUMBER_POS.includes(raw.number_pos)) out.number_pos = raw.number_pos;
	if (NUMBER_FORMATS.includes(raw.number_format)) out.number_format = raw.number_format;
	if (Array.isArray(raw.hidden)) out.hidden = raw.hidden.filter((k) => typeof k === "string").slice(0, 500);
	if (raw.zoom === "fit" || (Number.isFinite(raw.zoom) && raw.zoom >= 0.3 && raw.zoom <= 2)) out.zoom = raw.zoom;
	return out;
}

export class PagesView {
	/**
	 * @param {object} o
	 * @param {HTMLElement} o.parent the .rv-pages element
	 * @param {HTMLElement} o.root the .rv element
	 * @param {boolean} o.rtl direction of the page (the session's)
	 * @param {object} o.host the page: pages_options(company), pages_letterhead(name),
	 *   pages_format(name), pages_translations(lang, messages), pages_run_lang(lang),
	 *   pages_settings_load(), pages_settings_save(settings), pages_context()
	 */
	constructor({ parent, root, rtl, host }) {
		this.root = root;
		this.rtl = rtl;
		this.host = host;
		this.rows = new GridRows();
		this.settings = { ...DEFAULT_SETTINGS, hidden: [] };
		this.settings_report = null;
		this.options = null;
		this.options_report = null;
		this.lang_packs = new Map();
		this.letterheads = new Map();
		this.formats = new Map();
		this.token = 0;
		this.pages = [];
		this.filled = new Map();
		this.filling = new Set();
		this.queue = [];
		this.observer = null;
		this.current = null;
		this.ready = null;
		this.printing = false;
		this.el = parent;
		this.make_dom();
	}

	make_dom() {
		const el = this.el;
		el.innerHTML = `
			<aside class="rv-print-side" aria-label="${esc(__("Print settings"))}">
				<div class="rv-panel-hd"><strong>${esc(__("Print pages"))}</strong><span class="sp"></span><span class="rv-print-count"></span></div>
				<div class="bd"></div>
				<div class="rv-print-ft">
					<button type="button" class="rv-btn primary" data-action="print">${icons.print()}<span>${esc(__("Print", null, "Report View"))}</span></button>
					<span class="rv-print-note"></span>
				</div>
			</aside>
			<div class="rv-print-stage" tabindex="0">
				<div class="rv-print-tools">
					<div class="rv-seg rv-zoom" role="group" aria-label="${esc(__("Zoom"))}">
						<button type="button" data-zoom="out" aria-label="${esc(__("Zoom out"))}" title="${esc(__("Zoom out"))}">−</button>
						<button type="button" data-zoom="fit">${esc(__("Fit", null, "Report View"))}</button>
						<button type="button" data-zoom="in" aria-label="${esc(__("Zoom in"))}" title="${esc(__("Zoom in"))}">+</button>
					</div>
					<span class="rv-print-zoom-lbl"></span>
					<span class="sp"></span>
					<span class="rv-print-pos"></span>
				</div>
				<div class="rv-print-sheets" dir="${this.rtl ? "rtl" : "ltr"}"></div>
				<div class="rv-print-probe" aria-hidden="true"></div>
			</div>`;
		this.side = el.querySelector(".rv-print-side");
		this.bd = el.querySelector(".rv-print-side .bd");
		this.stage = el.querySelector(".rv-print-stage");
		this.sheets = el.querySelector(".rv-print-sheets");
		this.probe = el.querySelector(".rv-print-probe");
		this.count_el = el.querySelector(".rv-print-count");
		this.note_el = el.querySelector(".rv-print-note");
		this.pos_el = el.querySelector(".rv-print-pos");
		this.zoom_lbl = el.querySelector(".rv-print-zoom-lbl");
		el.querySelector('[data-action="print"]').addEventListener("click", () => this.print());
		for (const b of el.querySelectorAll("[data-zoom]")) b.addEventListener("click", () => this.zoom(b.dataset.zoom));
		this.stage.addEventListener("scroll", () => this.update_position(), { passive: true });
		this.resize_observer = new ResizeObserver(() => this.apply_zoom());
		this.resize_observer.observe(this.stage);
	}

	// ------------------------------------------------------------ show / destroy

	/**
	 * Shows the pages of an opened view (the one the grid would show).
	 * @param {object} p {report, opened, session, state, config, fmt}
	 */
	async show({ report, opened, session, state, config, fmt }) {
		const token = ++this.token;
		this.report = report;
		this.state = state;
		this.config = config;
		this.fmt = fmt;
		this.session = session;
		this.current = opened;
		this.ctx = this.host.pages_context();
		if (this.settings_report !== this.ctx.report_name) {
			const saved = await this.host.pages_settings_load();
			this.settings = sanitize_settings(saved);
			this.settings_report = this.ctx.report_name;
			this.unsaved = !saved;
			if (token !== this.token) return;
		}
		if (this.options_report !== this.ctx.report_name) {
			try {
				this.options = await this.host.pages_options(this.ctx.company);
			} catch (e) {
				this.options = { letter_heads: [], default_letter_head: null, print_formats: [], languages: [], lang: frappe.boot.lang };
				this.note(e.message || String(e), true);
			}
			if (token !== this.token) return;
			this.options_report = this.ctx.report_name;
			// Unknown choices of a saved setting fall back; the company's letter head is the
			// first choice when none was made.
			if (this.settings.letter_head && !this.options.letter_heads.some((lh) => lh.name === this.settings.letter_head)) this.settings.letter_head = "";
			if (this.settings.template && !this.options.print_formats.includes(this.settings.template)) this.settings.template = "";
			if (this.settings.lang && !this.options.languages.some((l) => l.name === this.settings.lang)) this.settings.lang = "";
			if (!this.settings.letter_head && this.options.default_letter_head && this.settings.letter_head !== null) {
				this.settings.letter_head = this.options.default_letter_head;
			}
		}
		if (!opened.post.label_key) {
			this.clear_pages();
			return;
		}
		this.rows.set({ report, state, config, post: opened.post, fmt, session, width: 1200 });
		// No choice made yet for this report: a table too wide for a portrait page at the
		// smallest font opens in landscape, as Frappe prints reports by default.
		if (this.unsaved && !this.settings.template) {
			const portrait = page_box({ size: this.settings.size, orientation: "portrait", margins: this.settings.margins });
			// Portrait when the columns fit without shrinking and the label keeps most of its
			// width; else landscape.
			const input = this.fit_input();
			const fit = fit_columns(input, portrait.inner_w, this.base_font());
			const label_kept = fit.widths[0] / ((input[0].width * this.base_font()) / SCREEN_FONT);
			this.settings.orientation = fit.scale >= 1 && label_kept >= 0.75 ? "portrait" : "landscape";
		}
		this.render_panel();
		this.ready = this.relayout(token);
		await this.ready;
	}

	destroy() {
		this.token += 1;
		this.current = null;
		this.clear_pages();
		this.bd.replaceChildren();
	}

	clear_pages() {
		if (this.observer) this.observer.disconnect();
		this.observer = null;
		this.pages = [];
		this.filled.clear();
		this.filling.clear();
		this.queue = [];
		this.sheets.replaceChildren();
		this.probe.replaceChildren();
		this.count_el.textContent = "";
		this.pos_el.textContent = "";
	}

	note(text, warn = false) {
		this.note_el.textContent = text || "";
		this.note_el.classList.toggle("warn", Boolean(warn));
	}

	// ------------------------------------------------------------ settings

	update(patch) {
		Object.assign(this.settings, patch);
		this.unsaved = false;
		this.host.pages_settings_save({ ...this.settings });
		this.render_panel();
		if (this.current) this.ready = this.relayout(++this.token);
	}

	lang() {
		return this.settings.lang || this.options?.lang || frappe.boot.lang;
	}

	lang_rtl() {
		return RTL_LANGS.has(String(this.lang()).split("-")[0]);
	}

	// The translation of the pages' own words: the session's, or the pack of the language.
	t(msgid, args, context = null) {
		const lang = this.settings.lang;
		if (!lang || lang === frappe.boot.lang) return __(msgid, args, context);
		const pack = this.lang_packs.get(lang)?.pack;
		const text = (context && pack?.[`${msgid}:${context}`]) || pack?.[msgid] || msgid;
		return format_msg(text, args);
	}

	// The msgid of a text the session translated (the register's labels are translated at
	// load): what the pack of another language is asked for.
	msgid_of(text) {
		if (!this._reverse) {
			this._reverse = new Map();
			for (const [k, v] of Object.entries(frappe._messages || {})) if (typeof v === "string" && !this._reverse.has(v)) this._reverse.set(v, k.split(":")[0]);
		}
		return this._reverse.get(text) || text;
	}

	// Translation pack and report of another language, once per language.
	async load_lang(lang) {
		if (!lang || lang === frappe.boot.lang) return null;
		if (this.lang_packs.has(lang)) return this.lang_packs.get(lang);
		const model = this.rows.model;
		const labels = [...model.pinned, ...model.data, { title: model.label_title }].map((d) => this.msgid_of(d.title));
		const bands = [...(model.bands?.values() || [])].map((b) => this.msgid_of(b.label));
		const filters = (this.ctx.defs || []).map((df) => df.label && this.msgid_of(df.label)).filter(Boolean);
		const signatures = this.signature_labels().map((s) => this.msgid_of(s));
		const messages = [...new Set([...PAGE_MESSAGES, this.ctx.report_name, ...labels, ...bands, ...filters, ...signatures])];
		// The pack is fetched while the report runs again; the run's classification waits
		// for it (the captions it recognises are the language's).
		const pack_p = this.host.pages_translations(lang, messages).then((p) => p || {});
		const [pack, report] = await Promise.all([pack_p, this.host.pages_run_lang(lang, pack_p)]);
		const entry = { pack, report };
		this.lang_packs.set(lang, entry);
		return entry;
	}

	signature_labels() {
		const own = this.config?.signatures;
		return Array.isArray(own) && own.length ? own.map(String) : [__("Accountant"), __("Finance Manager"), __("General Manager")];
	}

	render_panel() {
		const s = this.settings;
		const o = this.options || { letter_heads: [], print_formats: [], languages: [] };
		const model = this.rows.model;
		const check = (key, label) =>
			`<label class="rv-setitem"><span class="rv-check"><input type="checkbox" data-set="${key}" ${s[key] ? "checked" : ""}><span>${esc(label)}</span></span></label>`;
		const option = (value, label, on) => `<option value="${esc(value)}" ${on ? "selected" : ""}>${esc(label)}</option>`;
		const columns = model ? [...model.pinned, ...model.data] : [];
		const hidden = new Set(s.hidden);
		this.bd.innerHTML = `
			<div>
				<h4>${esc(__("Paper"))}</h4>
				<div class="rv-print-row">
					<select class="rv-input" data-set="size" aria-label="${esc(__("Paper size"))}">${Object.keys(PAGE_SIZES)
						.map((k) => option(k, k, s.size === k))
						.join("")}</select>
					<select class="rv-input" data-set="margins" aria-label="${esc(__("Margins"))}">
						${option("narrow", __("Narrow margins"), s.margins === "narrow")}${option("normal", __("Normal margins"), s.margins === "normal")}${option("wide", __("Wide margins"), s.margins === "wide")}
					</select>
				</div>
				<div class="rv-orient" role="group" aria-label="${esc(__("Orientation"))}">
					<button type="button" data-orient="portrait" class="${s.orientation === "portrait" ? "on" : ""}" aria-pressed="${s.orientation === "portrait"}"><i style="width:22px;height:30px"></i>${esc(__("Portrait", null, "Report View"))}</button>
					<button type="button" data-orient="landscape" class="${s.orientation === "landscape" ? "on" : ""}" aria-pressed="${s.orientation === "landscape"}"><i style="width:30px;height:22px"></i>${esc(__("Landscape", null, "Report View"))}</button>
				</div>
			</div>
			<div>
				<h4>${esc(__("Template and letter head"))}</h4>
				<div class="rv-print-fields">
					<label class="rv-field"><span>${esc(__("Print template"))}</span>
						<select class="rv-input" data-set="template">${option("", __("Report View (standard)"), !s.template)}${o.print_formats.map((n) => option(n, n, s.template === n)).join("")}</select></label>
					<label class="rv-field"><span>${esc(__("Letter Head", null, "Report View"))}</span>
						<select class="rv-input" data-set="letter_head">${option("", __("No letter head"), !s.letter_head)}${o.letter_heads.map((lh) => option(lh.name, lh.name, s.letter_head === lh.name)).join("")}</select></label>
					<label class="rv-field"><span>${esc(__("Language", null, "Report View"))}</span>
						<select class="rv-input" data-set="lang">${option("", __("Session language ({0})", [o.lang || frappe.boot.lang]), !s.lang)}${o.languages
							.map((l) => option(l.name, l.label, s.lang === l.name))
							.join("")}</select></label>
				</div>
			</div>
			<div>
				<h4>${esc(__("Header, footer and numbering"))}</h4>
				<div class="rv-print-fields">
					<label class="rv-field rv-range-field"><span>${esc(__("Letter head height"))}<b class="rv-pnum" data-out="lh_height">${s.lh_height} ${esc(__("mm"))}</b></span>
						<input type="range" data-mm="lh_height" min="${LH_HEIGHT.min}" max="${LH_HEIGHT.max}" step="1" value="${s.lh_height}" ${s.letter_head ? "" : "disabled"}></label>
					<label class="rv-field rv-range-field"><span>${esc(__("Footer height"))}<b class="rv-pnum" data-out="foot_height">${s.foot_height ? `${s.foot_height} ${esc(__("mm"))}` : esc(__("Hidden"))}</b></span>
						<input type="range" data-mm="foot_height" min="${FOOT_HEIGHT.min}" max="${FOOT_HEIGHT.max}" step="1" value="${s.foot_height}" ${s.letter_head ? "" : "disabled"}></label>
					<div class="rv-print-row">
						<label class="rv-field"><span>${esc(__("Page number position"))}</span>
							<select class="rv-input" data-set="number_pos" ${s.page_numbers ? "" : "disabled"}>
								${option("bottom-end", __("Bottom, at the end"), s.number_pos === "bottom-end")}${option("bottom-center", __("Bottom, centred"), s.number_pos === "bottom-center")}${option("bottom-start", __("Bottom, at the start"), s.number_pos === "bottom-start")}
								${option("top-end", __("Top, at the end"), s.number_pos === "top-end")}${option("top-center", __("Top, centred"), s.number_pos === "top-center")}${option("top-start", __("Top, at the start"), s.number_pos === "top-start")}
							</select></label>
						<label class="rv-field"><span>${esc(__("Number format"))}</span>
							<select class="rv-input" data-set="number_format" ${s.page_numbers ? "" : "disabled"}>
								${option("full", __("Page 1 of 3"), s.number_format === "full")}${option("short", "1 / 3", s.number_format === "short")}${option("number", "1", s.number_format === "number")}
							</select></label>
					</div>
				</div>
			</div>
			<div>
				<h4>${esc(__("Content", null, "Report View"))}</h4>
				<div class="rv-setlist tall">
					${check("include_filters", __("Applied filters"))}
					${model?.hierarchical ? check("include_subtotals", __("Group subtotals")) : ""}
					${check("include_total", __("Grand Total"))}
					${check("signatures", __("Signature boxes"))}
					${check("page_numbers", __("Page numbers"))}
					${check("printed_on", __("Print date and user"))}
					${s.letter_head ? check("letterhead_all", __("Letter head on every page")) : ""}
				</div>
			</div>
			${
				s.template
					? ""
					: `<div>
				<h4>${esc(__("Printed columns"))}</h4>
				<div class="rv-setlist tall">
					<label class="rv-setitem"><span class="rv-check"><input type="checkbox" checked disabled><span>${esc(model?.label_title || "")}</span></span></label>
					${columns
						.map(
							(d) =>
								`<label class="rv-setitem"><span class="rv-check"><input type="checkbox" data-col="${esc(d.column.key)}" ${hidden.has(d.column.key) ? "" : "checked"}><span>${esc(d.title)}</span></span></label>`
						)
						.join("")}
				</div>
			</div>`
			}
			<p class="rv-zone-empty">${esc(__("The pages show the table as it is: the same filters, grouping and folded groups."))}</p>`;
		for (const sel of this.bd.querySelectorAll("select[data-set]")) {
			sel.addEventListener("change", () => this.update({ [sel.dataset.set]: sel.value }));
		}
		for (const b of this.bd.querySelectorAll("[data-orient]")) {
			b.addEventListener("click", () => this.update({ orientation: b.dataset.orient }));
		}
		// heights: the band follows the slider at once, the pages are cut again when it stops
		for (const r of this.bd.querySelectorAll("input[data-mm]")) {
			const key = r.dataset.mm;
			const out = this.bd.querySelector(`[data-out="${key}"]`);
			r.addEventListener("input", () => {
				const v = Number(r.value);
				out.textContent = key === "foot_height" && !v ? __("Hidden") : `${v} ${__("mm")}`;
				this.apply_heights({ ...this.settings, [key]: v });
			});
			r.addEventListener("change", () => this.update({ [key]: Number(r.value) }));
		}
		for (const c of this.bd.querySelectorAll("input[data-set]")) {
			c.addEventListener("change", () => this.update({ [c.dataset.set]: c.checked }));
		}
		for (const c of this.bd.querySelectorAll("input[data-col]")) {
			c.addEventListener("change", () => {
				const key = c.dataset.col;
				const next = this.settings.hidden.filter((k) => k !== key);
				if (!c.checked) next.push(key);
				this.update({ hidden: next });
			});
		}
	}

	// ------------------------------------------------------------ layout

	base_font() {
		return PAGE_FONT[this.state?.ui?.density === "compact" ? "compact" : "comfortable"];
	}

	/**
	 * Widths for fit_columns. A number column is as wide as its widest value needs (the grand
	 * total's, or its title's longest word), not the grid's width; text columns may narrow, the
	 * label less than the others and it takes the spare room.
	 */
	fit_input() {
		const cur = this.current;
		const total = cur ? this.rows.total_row(cur, cur.counts) : null;
		const chars = (html) => frappe.utils.html2text(String(html || "")).trim().length;
		return this.print_columns().map((d) => {
			if (d.label) return { width: d.width, flex: true, weight: 0.5 };
			if (!d.numeric) return { width: d.width, flex: true, weight: 1 };
			const longest = Math.max(10, chars(total?.cell(d).html), ...String(this.title_of(d)).split(/\s+/).map((w) => w.length));
			// tabular digits are about 0.6em; the padding of a cell is 1.1em (rv_pages.css)
			return { width: Math.min(d.width, Math.ceil((longest * 0.6 + 1.6) * 13)), flex: false };
		});
	}

	/** The columns printed: the label, then the pinned and data columns not hidden for print. */
	print_columns() {
		const m = this.rows.model;
		const hidden = new Set(this.settings.hidden);
		const label = { column: m.label, title: m.label_title, numeric: false, side: null, band: null, totalled: false, width: m.label_width, label: true };
		return [label, ...m.pinned.filter((d) => !hidden.has(d.column.key)), ...m.data.filter((d) => !hidden.has(d.column.key))];
	}

	async relayout(token) {
		const cur = this.current;
		if (!cur) return;
		this.clear_pages();
		this.note("");
		const s = this.settings;
		// What the pages need before they are measured: the letter head, the pack of the
		// language, the custom template.
		let lang_entry = null;
		let letterhead = null;
		let format = null;
		try {
			[lang_entry, letterhead, format] = await Promise.all([
				this.load_lang(s.lang).catch((e) => {
					this.note(__("The language could not be loaded: {0}", [e.message || e]), true);
					return null;
				}),
				this.load_letterhead(s.letter_head),
				this.load_format(s.template),
			]);
		} catch (e) {
			this.note(e.message || String(e), true);
		}
		if (token !== this.token || this.current !== cur) return;
		this.lang_entry = lang_entry;
		this.letterhead = letterhead;
		this.format = format;
		if (lang_entry && lang_entry.report === null && s.lang && s.lang !== frappe.boot.lang) {
			this.note(__("The report could not run in the chosen language; labels stay in the session language."), true);
		}

		const box = page_box(s);
		this.box = box;
		const dir = this.lang_rtl() ? "rtl" : "ltr";
		this.sheets.dir = dir;
		this.sheets.lang = this.lang();
		this.apply_heights(s);
		this.root.style.setProperty("--pp-w", `${box.w}px`);
		this.root.style.setProperty("--pp-h", `${box.h}px`);

		if (format) {
			await this.layout_custom(token, box, dir);
		} else {
			await this.layout_standard(token, box, dir);
		}
		if (token !== this.token) return;
		this.apply_zoom();
		this.update_position();
	}

	/** Heights of the letter head band and its footer, as CSS variables of the pages. */
	apply_heights(s) {
		this.root.style.setProperty("--pp-lh-h", `${s.lh_height}mm`);
		this.root.style.setProperty("--pp-lhf-h", `${s.foot_height}mm`);
	}

	async load_letterhead(name) {
		if (!name) return null;
		const key = `${name}|${this.ctx.company || ""}`;
		if (!this.letterheads.has(key)) {
			try {
				const r = await this.host.pages_letterhead(name);
				this.letterheads.set(key, { header: strip_scripts(r?.header), footer: strip_scripts(r?.footer) });
			} catch (e) {
				this.note(__("The letter head could not be loaded: {0}", [e.message || e]), true);
				this.letterheads.set(key, null);
			}
		}
		return this.letterheads.get(key);
	}

	async load_format(name) {
		if (!name) return null;
		if (!this.formats.has(name)) {
			try {
				this.formats.set(name, await this.host.pages_format(name));
			} catch (e) {
				this.note(__("The print format could not be loaded: {0}", [e.message || e]), true);
				this.formats.set(name, null);
			}
		}
		return this.formats.get(name);
	}

	// ------------------------------------------------------------ the standard template

	// A word of the session's language in the language of the pages: the pack's text for
	// its msgid, else the msgid itself (English, the language of the msgids).
	in_lang(text) {
		const pack = this.lang_entry?.pack;
		if (!pack) return text;
		const msgid = this.msgid_of(text);
		return pack[msgid] || msgid;
	}

	// Titles in the language of the pages: the register's through the pack, the report's
	// own from the re-run.
	title_of(d) {
		const entry = this.lang_entry;
		if (!entry) return d.title;
		const own = this.config?.columns?.[d.column.fieldname]?.label;
		if (own && d.title === own) return this.in_lang(d.title);
		const col = entry.report?.columns?.find((c) => c.key === d.column.key);
		return col?.label || this.in_lang(d.title);
	}

	band_title(id) {
		return this.in_lang(this.rows.model.bands.get(id)?.label || "");
	}

	// A summary row of the report in the language of the pages: the row of the re-run with
	// the same __rid (the rows and their order are the view's).
	lang_row(row) {
		const report = this.lang_entry?.report;
		if (!report || !row) return row;
		const other = report.rows[row.__rid];
		return other && other.__kind === row.__kind ? other : row;
	}

	/**
	 * Head of a page. The first page: the letter head, the title block (company, report,
	 * period), a line of print details, the applied filters. The others: the letter head
	 * only when asked for every page, else one slim line naming the report.
	 */
	head_html(first, letterhead) {
		const s = this.settings;
		const t = (m, a) => this.t(m, a);
		const ctx = this.ctx;
		const company = ctx.company || "";
		const title = t(ctx.report_name);
		const period = this.period_text();
		const lh = letterhead?.header && (first || s.letterhead_all) ? `<div class="rv-page-lh">${letterhead.header}</div>` : "";
		if (!first) {
			const parts = [`<b>${esc(title)}</b>`, company ? esc(company) : "", period].filter(Boolean);
			return `${lh}<div class="rv-page-cont">${parts.join('<span class="sep">·</span>')}</div>`;
		}
		const details = [];
		if (s.printed_on) {
			details.push(esc(t("Printed on {0}", [frappe.datetime.str_to_user(frappe.datetime.now_datetime())])));
			if (frappe.session?.user_fullname) details.push(esc(t("Printed by {0}", [frappe.session.user_fullname])));
		}
		const facts = [];
		if (ctx.group_labels?.length) facts.push(esc(t("Grouped by {0}", [ctx.group_labels.map((l) => this.in_lang(l)).join(" › ")])));
		facts.push(esc(t("{0} rows", [frappe.format(this.current.counts.shown, { fieldtype: "Int" }, { inline: true })])));
		let out = `${lh}<div class="rv-page-hd">${company && !letterhead?.header ? `<div class="co">${esc(company)}</div>` : ""}<div class="ti">${esc(title)}</div>${
			period ? `<div class="pe">${period}</div>` : ""
		}</div><div class="rv-page-meta"><span>${details.join('<span class="sep">·</span>')}</span><span>${facts.join('<span class="sep">·</span>')}</span></div>`;
		if (s.include_filters) {
			const text = this.filters_html();
			if (text) out += `<div class="rv-page-filt"><b>${esc(t("Applied filters"))}:</b> ${text}</div>`;
		}
		return out;
	}

	period_text() {
		const f = this.ctx.filters || {};
		const t = (m, a) => this.t(m, a);
		const d = (v) => `<bdi class="rv-pnum">${esc(frappe.datetime.str_to_user(v))}</bdi>`;
		if (f.from_date && f.to_date) return t("For the period from {0} to {1}", [d(f.from_date), d(f.to_date)]);
		if (f.period_start_date && f.period_end_date) return t("For the period from {0} to {1}", [d(f.period_start_date), d(f.period_end_date)]);
		const single = f.report_date || f.as_on_date || f.date || f.posting_date || f.to_date;
		if (single) return t("As on {0}", [d(single)]);
		if (f.fiscal_year) return t("Fiscal Year {0}", [esc(f.fiscal_year)]);
		return "";
	}

	filters_html() {
		const f = this.ctx.filters || {};
		const defs = new Map((this.ctx.defs || []).map((df) => [df.fieldname, df]));
		const parts = [];
		for (const [key, value] of Object.entries(f)) {
			if (key === "company" || PERIOD_KEYS.has(key)) continue;
			if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) continue;
			const df = defs.get(key);
			if (df?.fieldtype === "Check" && !Number(value)) continue;
			const label = df?.label ? this.in_lang(df.label) : frappe.unscrub(key);
			let text;
			if (df?.fieldtype === "Check") text = this.t("Yes");
			else if (Array.isArray(value)) text = value.map(String).join(", ");
			else if (df?.fieldtype === "Date") text = frappe.datetime.str_to_user(value);
			else text = String(value);
			parts.push(`<span class="rv-page-filter"><span>${esc(label)}:</span> <b>${esc(text)}</b></span>`);
		}
		return parts.join(" · ");
	}

	/** The page number as the settings write it, or "" when hidden. */
	number_html(n, total) {
		const s = this.settings;
		if (!s.page_numbers) return "";
		const num = (v) => frappe.format(v, { fieldtype: "Int" }, { inline: true });
		const text = s.number_format === "number" ? num(n) : s.number_format === "short" ? `${num(n)} / ${num(total)}` : this.t("Page {0} of {1}", [num(n), num(total)]);
		return `<span class="rv-pnum">${esc(text)}</span>`;
	}

	foot_html(n, total, letterhead) {
		const s = this.settings;
		const ctx = this.ctx;
		const t = (m, a) => this.t(m, a);
		const name = `<span class="nm">${[esc(t(ctx.report_name)), ctx.company ? esc(ctx.company) : ""].filter(Boolean).join(" · ")}</span>`;
		const [where, side] = s.number_pos.split("-");
		const number = where === "bottom" ? this.number_html(n, total) : "";
		// three slots: the report's name at the start unless the number takes it
		const slots = { start: "", center: "", end: "" };
		if (number) slots[side] = number;
		if (!slots.start) slots.start = name;
		else slots.end = slots.end || name;
		const line = `<div class="rv-page-foot-line"><span class="st">${slots.start}</span><span class="ce">${slots.center}</span><span class="en">${slots.end}</span></div>`;
		const lhf = letterhead?.footer && s.foot_height ? `<div class="rv-page-lhf">${letterhead.footer}</div>` : "";
		const top = where === "top" && s.page_numbers ? `<div class="rv-page-topnum ${side}">${this.number_html(n, total)}</div>` : "";
		return `${top}${lhf}${line}`;
	}

	table_head(cols, widths, font) {
		const m = this.rows.model;
		const colgroup = `<colgroup>${widths.map((w) => `<col style="width:${w.toFixed(2)}px">`).join("")}</colgroup>`;
		let bands = "";
		if (m.levels === 2) {
			const cells = [];
			for (let i = 0; i < cols.length; ) {
				const d = cols[i];
				if (!d.band) {
					cells.push(`<th class="rv-pt-nb ${d.numeric ? "num" : ""} be" rowspan="2">${esc(this.title_of(d))}</th>`);
					i += 1;
					continue;
				}
				let span = 1;
				while (i + span < cols.length && cols[i + span].band === d.band) span += 1;
				cells.push(`<th class="rv-pt-band be" colspan="${span}">${esc(this.band_title(d.band))}</th>`);
				i += span;
			}
			bands = `<tr>${cells.join("")}</tr>`;
		}
		const titles = cols
			.map((d) => (m.levels === 2 && !d.band ? "" : `<th class="${[d.numeric ? "num" : "", d.band_end || m.levels === 1 ? "be" : ""].filter(Boolean).join(" ")}">${esc(this.title_of(d))}</th>`))
			.join("");
		return `${colgroup}<thead>${bands}<tr>${titles}</tr></thead>`;
	}

	body_row(rec, cols, values, plan) {
		const rows = this.rows;
		const kind = rows.row_kind(rec);
		if (kind === "spacer") return "";
		const t = (m, a) => this.t(m, a);
		const cells = cols.map((d, i) => {
			if (i === 0) {
				let label;
				if (rec.type === "foot") label = rows.label_html(rec, { foot_label: (text) => `<span class="rv-glabel">${esc(t("Total {0}", [text]))}</span>` });
				else if (rows.is_summary(rec)) label = `<div class="rv-lc" style="--lv:${Number(rec.depth) || 0}"><span class="rv-glabel">${rows.caption_of(this.lang_row(rec.row)).html}</span></div>`;
				else label = rows.label_html(rec);
				return `<th class="lc">${label}</th>`;
			}
			const value = rec.type === "spacer" ? null : rows.value_of(values, plan, rec.view_row ?? -1, d.column.key);
			const out = rows.cell(rec, d, value);
			const cls = [d.numeric ? "num" : "", d.band_end ? "be" : "", out.sign].filter(Boolean).join(" ");
			return `<td class="${cls}">${out.html}</td>`;
		});
		return `<tr class="${kind}">${cells.join("")}</tr>`;
	}

	report_row(cls, row, cols) {
		const rows = this.rows;
		const shown = this.lang_row(row);
		const cells = cols.map((d, i) => {
			if (i === 0) return `<th class="lc"><div class="rv-lc"><span class="rv-glabel">${rows.caption_of(shown).html}</span></div></th>`;
			const out = rows.summary_cell(d, shown);
			const cls2 = [d.numeric ? "num" : "", d.band_end ? "be" : "", out.sign].filter(Boolean).join(" ");
			return `<td class="${cls2}">${out.html}</td>`;
		});
		return `<tr class="${cls}">${cells.join("")}</tr>`;
	}

	total_rows_html(cols) {
		const rows = this.rows;
		const cur = this.current;
		const t = (m, a) => this.t(m, a);
		const bottom = rows.report_rows(cur).bottom.map((row) => this.report_row("foot closing", row, cols)).join("");
		if (!this.settings.include_total) return bottom;
		const total = rows.total_row(cur, cur.counts);
		const cells = cols.map((d, i) => {
			if (i === 0) return `<th class="lc"><div class="rv-lc"><span class="rv-glabel">${esc(t("Grand Total"))}</span></div></th>`;
			const out = total.cell(d);
			const cls = [d.numeric ? "num" : "", d.band_end ? "be" : "", out.sign].filter(Boolean).join(" ");
			return `<td class="${cls}">${out.html}</td>`;
		});
		return `${bottom}<tr class="total">${cells.join("")}</tr>`;
	}

	signatures_html() {
		if (!this.settings.signatures) return "";
		const t = (m, a) => this.t(m, a);
		const dots = "................................";
		return `<div class="rv-page-sign">${this.signature_labels()
			.map((l) => `<div>${esc(this.in_lang(l))}<span>${esc(t("Name", null, "Report View"))}: ${dots}</span><span>${esc(t("Signature", null, "Report View"))}: ${dots}</span></div>`)
			.join("")}</div>`;
	}

	page_shell(i, box, dir, inner) {
		return `<section class="rv-page" dir="${dir}" data-page="${i}" style="width:${box.w}px;height:${box.h}px;padding:${box.margin}px;--pp-m:${box.margin}px">${inner}</section>`;
	}

	async layout_standard(token, box, dir) {
		const m = this.rows.model;
		const cur = this.current;
		const s = this.settings;
		const cols = this.print_columns();
		const fit = fit_columns(this.fit_input(), box.inner_w, this.base_font());
		this.fit = fit;
		this.cols = cols;
		this.root.style.setProperty("--pp-fs", `${fit.font.toFixed(2)}px`);
		if (fit.overflow) this.note(__("The columns are wider than the page: try landscape, or hide some columns."), true);

		// Rows of the body: the view's, with a subtotal row after every open group when
		// asked; the report's own opening rows stand first, its closing rows and the grand
		// total last (not spacers: the pages have nothing pinned).
		const depths = cur.depths || new Uint8Array(cur.body_rows);
		this.layout = build_layout(depths, { subtotals: s.include_subtotals && m.subtotals, top: 0 });
		const report_rows = this.rows.report_rows(cur);
		const table_head = this.table_head(cols, fit.widths, fit.font);
		this.table_head_html = table_head;

		// Measure: the head of the first page and of the others, the column titles, a body
		// row, the tail (closing rows, grand total, signatures) and the foot.
		const probe_rows = report_rows.top.map((row) => this.report_row("opening", row, cols)).join("") + `<tr><th class="lc"><div class="rv-lc">x</div></th>${cols.slice(1).map(() => "<td>0</td>").join("")}</tr>`;
		this.probe.innerHTML = this.page_shell(
			1,
			box,
			dir,
			`<header class="rv-page-top rv-page-top-next">${this.head_html(false, this.letterhead)}</header>`
		) + this.page_shell(
			0,
			box,
			dir,
			`<header class="rv-page-top rv-page-top-first">${this.head_html(true, this.letterhead)}</header>
			<table class="rv-pt" style="width:${box.inner_w}px">${table_head}<tbody>${probe_rows}</tbody></table>
			<div class="rv-page-tail"><table class="rv-pt" style="width:${box.inner_w}px">${table_head.replace(/<thead>.*<\/thead>/s, "")}<tbody>${this.total_rows_html(cols)}</tbody></table>${this.signatures_html()}</div>
			<footer class="rv-page-foot">${this.foot_html(1, 1, this.letterhead)}</footer>`
		);
		await wait_images(this.probe);
		if (token !== this.token) return;
		const q = (sel) => this.probe.querySelector(sel);
		const h = (el) => (el ? el.getBoundingClientRect().height : 0);
		const head_h = h(q(".rv-page-top-first"));
		const next_h = h(q(".rv-page-top-next"));
		const thead_h = h(q(".rv-pt thead"));
		const row_h = h(q(".rv-pt tbody tr:last-child")) || fit.font * 2;
		const top_h = report_rows.top.length * row_h;
		const tail_h = h(q(".rv-page-tail"));
		const foot_h = h(q(".rv-page-foot"));
		// the body of a continuation page; the first page gives up the difference of its head
		const body_h = box.inner_h - next_h - thead_h - foot_h;
		const filt_h = Math.max(0, head_h - next_h);
		this.measure = { head_h, next_h, filt_h, thead_h, row_h, top_h, tail_h, foot_h, body_h };
		this.probe.replaceChildren();
		if (body_h < row_h * 2) {
			this.note(__("The letter head and the margins leave no room for rows on this paper."), true);
		}
		this.pages = paginate({ count: this.layout.size, row_h, body_h: Math.max(body_h, row_h), first_h: filt_h + top_h, tail_h });
		this.mount_pages(box, dir);
	}

	mount_pages(box, dir) {
		const n = this.pages.length;
		const num = (v) => frappe.format(v, { fieldtype: "Int" }, { inline: true });
		this.sheets.innerHTML = this.pages.map((p, i) => this.page_shell(i, box, dir, `<span class="rv-page-ph">${esc(num(i + 1))}</span>`)).join("");
		this.count_el.textContent = __("{0} pages", [num(n)]);
		this.el.classList.toggle("many", n > PRINT_MAX_PAGES);
		this.observer = new IntersectionObserver((entries) => this.on_intersect(entries), {
			root: this.stage,
			rootMargin: `${Math.round(box.h * NEAR_PAGES)}px 0px`,
			threshold: 0,
		});
		for (const el of this.sheets.children) this.observer.observe(el);
	}

	on_intersect(entries) {
		for (const e of entries) {
			const i = Number(e.target.dataset.page);
			if (e.isIntersecting) this.request_fill(i);
		}
		this.trim_filled();
	}

	request_fill(i) {
		if (this.filled.has(i) || this.filling.has(i) || this.queue.includes(i)) return;
		this.queue.push(i);
		this.pump();
	}

	pump() {
		while (this.filling.size < FILL_PARALLEL && this.queue.length) {
			const i = this.queue.shift();
			this.filling.add(i);
			this.fill(i)
				.catch(() => {})
				.finally(() => {
					this.filling.delete(i);
					this.pump();
				});
		}
	}

	// Far pages give their content back, so a long report keeps a bounded DOM.
	trim_filled() {
		if (this.filled.size <= KEEP_FILLED) return;
		const top = this.stage.scrollTop;
		const h = this.box.h + PAGE_GAP;
		const z = this.zoom_value();
		const at = Math.floor(top / (h * z));
		const far = [...this.filled.keys()].filter((i) => Math.abs(i - at) > NEAR_PAGES + 2).sort((a, b) => Math.abs(b - at) - Math.abs(a - at));
		for (const i of far.slice(0, this.filled.size - KEEP_FILLED)) {
			const el = this.sheets.children[i];
			if (el) el.innerHTML = `<span class="rv-page-ph">${esc(frappe.format(i + 1, { fieldtype: "Int" }, { inline: true }))}</span>`;
			this.filled.delete(i);
		}
	}

	async fill(i) {
		const token = this.token;
		const cur = this.current;
		const page = this.pages[i];
		const el = this.sheets.children[i];
		if (!page || !el || !cur) return;
		let html;
		if (this.format) {
			html = this.custom_page_html(i);
		} else {
			const plan = this.rows.plan(this.layout, page.start, page.end - page.start);
			const [recs, values] = await Promise.all([
				this.rows.read_records(cur, plan, this.layout),
				this.rows.read_values(cur, plan, 0, this.rows.model.data.length),
			]);
			if (token !== this.token || this.current !== cur) return;
			html = this.standard_page_html(i, page, plan, recs, values);
		}
		if (token !== this.token) return;
		el.innerHTML = html;
		this.filled.set(i, true);
	}

	standard_page_html(i, page, plan, recs, values) {
		const cols = this.cols;
		const box = this.box;
		const n = this.pages.length;
		let body = "";
		if (page.first) body += this.rows.report_rows(this.current).top.map((row) => this.report_row("opening", row, cols)).join("");
		for (let y = page.start; y < page.end; y++) {
			const rec = recs.get(y);
			if (rec) body += this.body_row(rec, cols, values, plan);
		}
		let tail = "";
		if (page.last) tail = `<div class="rv-page-tail"><table class="rv-pt" style="width:${box.inner_w}px">${this.table_head_html.replace(/<thead>.*<\/thead>/s, "")}<tbody>${this.total_rows_html(cols)}</tbody></table>${this.signatures_html()}</div>`;
		return `<header class="rv-page-top">${this.head_html(page.first, this.letterhead)}</header>
			<table class="rv-pt" style="width:${box.inner_w}px">${this.table_head_html}<tbody>${body}</tbody></table>${tail}
			<footer class="rv-page-foot">${this.foot_html(i + 1, n, this.letterhead)}</footer>`;
	}

	// ------------------------------------------------------------ a report print format

	/**
	 * A report print format (JS, as the query-report dialog offers them) renders the
	 * whole report as one flow with query-report's context; the flow is cut into pages by
	 * measuring its blocks (a table by its rows, its header repeated).
	 */
	async layout_custom(token, box, dir) {
		const ctx = this.ctx;
		const { columns, data, report } = this.query_report_facade();
		let html = "";
		try {
			html = frappe.render_template(`<style>${this.format.css || ""}</style>${this.format.html}`, {
				title: this.t(ctx.report_name),
				subtitle: this.settings.include_filters ? this.filters_html() : null,
				filters: ctx.filters || {},
				data,
				original_data: data,
				columns,
				report,
				print_settings: { letter_head: this.letterhead, orientation: this.settings.orientation, include_filters: this.settings.include_filters },
				can_use_smaller_font: 1,
			});
		} catch (e) {
			this.note(__("The print format could not be rendered: {0}", [e.message || e]), true);
			html = "";
		}
		// The format's own @page rules (paper and margins of a whole-document print) would
		// fight the pages' paper: the pages are the paper here.
		html = strip_scripts(html).replace(/@page\s*\{[^}]*\}/g, "");
		// Flow the HTML at the width of the page body and measure its blocks.
		this.custom_styles = "";
		// The pages carry the letter head as the standard template does: in full on the first
		// page, a slim line naming the report on the others (or the letter head on every page).
		this.probe.innerHTML =
			this.page_shell(1, box, dir, `<header class="rv-page-top rv-page-top-next">${this.custom_head(false)}</header>`) +
			this.page_shell(
				0,
				box,
				dir,
				`<header class="rv-page-top rv-page-top-first">${this.custom_head(true)}</header><div class="rv-page-flow">${html}</div><footer class="rv-page-foot">${this.foot_html(1, 1, this.letterhead)}</footer>`
			);
		await wait_images(this.probe);
		if (token !== this.token) return;
		const q = (sel) => this.probe.querySelector(sel);
		const h = (el) => (el ? el.getBoundingClientRect().height : 0);
		const first_h = h(q(".rv-page-top-first"));
		const next_h = h(q(".rv-page-top-next"));
		const foot_h = h(q(".rv-page-foot"));
		const body_h = Math.max(40, box.inner_h - next_h - foot_h);
		const first_body_h = Math.max(40, box.inner_h - first_h - foot_h);
		const flow = q(".rv-page-flow");
		if (flow.scrollWidth > box.inner_w + 1 || [...flow.querySelectorAll("td, th")].some((c) => c.getBoundingClientRect().width < 1)) {
			this.note(__("The print format is wider than the page: try landscape or a larger paper."), true);
		}
		const units = this.flow_units(flow, body_h);
		// Pack the units into pages.
		const pages = [];
		let page = { units: [], used: 0 };
		const room = () => (pages.length ? body_h : first_body_h);
		for (const u of units) {
			if (u.style) {
				this.custom_styles += u.node.outerHTML;
				continue;
			}
			// a table's head is repeated on every page its rows reach
			const extra = u.table && page.units[page.units.length - 1]?.table !== u.table ? u.table.head_h : 0;
			if (page.units.length && page.used + extra + u.h > room()) {
				pages.push(page);
				page = { units: [], used: 0 };
			}
			page.used += (u.table && page.units[page.units.length - 1]?.table !== u.table ? u.table.head_h : 0) + u.h;
			page.units.push(u);
		}
		pages.push(page);
		this.custom_pages = pages;
		this.pages = pages.map((p, i) => ({ start: 0, end: 0, first: i === 0, last: i === pages.length - 1 }));
		this.probe.replaceChildren();
		this.mount_pages(box, dir);
	}

	/**
	 * What a report print format reads from query-report's context (print_grid.html and the
	 * standard financial formats): the columns as the datatable describes them, the rows as
	 * the report returned them (Frappe's total row last, `is_total_row`), and the parts of
	 * the query-report object the formats call. Labels come in the language of the pages.
	 */
	query_report_facade() {
		const ctx = this.ctx;
		const source = this.lang_entry?.report || this.report;
		// The report's own columns (not the enrichment's), hidden as on screen: what
		// query-report's get_visible_columns gives a format.
		const hidden = new Set([...(this.state?.columns?.hidden || []), ...this.settings.hidden]);
		const columns = source.columns
			.filter((c) => !c.enriched)
			.map((c, i) => {
				const docfield = { ...(c.original || {}), fieldname: c.fieldname, fieldtype: c.fieldtype, label: c.label, options: c.original?.options };
				return {
					id: c.fieldname,
					name: c.label,
					label: c.label,
					fieldname: c.fieldname,
					fieldtype: c.fieldtype,
					options: docfield.options,
					width: c.width,
					hidden: Boolean(c.hidden) || hidden.has(c.key),
					_index: i,
					docfield,
				};
			});
		const data = source.rows.map((r, i) => ({ ...r, _index: i }));
		const total = source.report_totals?.frappe_total;
		if (total) data.push({ ...total, _index: data.length, is_total_row: true });
		const filters = ctx.filters || {};
		const report = {
			report_name: ctx.report_name,
			report_doc: { name: ctx.report_name },
			report_settings: ctx.report_settings,
			columns,
			data,
			raw_data: ctx.raw,
			get_filter_values: () => filters,
			get_filter_value: (key) => filters[key],
			get_visible_columns: () => columns.filter((c) => !c.hidden),
			get_columns_for_print: () => columns.filter((c) => !c.hidden),
			get_data_for_print: () => data,
			get_filters_html_for_print: () => this.filters_html(),
		};
		return { columns, data, report };
	}

	// Atomic blocks of a flow with their heights: a table by its rows (with the table and
	// its header kept to repeat them), a block taller than a page by its children.
	flow_units(container, body_h) {
		const units = [];
		// `path`: shallow copies of the elements between the flow and a block (a format styles
		// its table through a wrapper such as .report-table: the pages rebuild it)
		const walk = (el, path) => {
			for (const child of el.children) {
				const hh = child.getBoundingClientRect().height;
				if (child.tagName === "STYLE") {
					units.push({ node: child.cloneNode(true), h: 0, table: null, style: true, path });
					continue;
				}
				if (child.tagName === "SCRIPT") continue;
				if (child.tagName === "TABLE") {
					const head = child.tHead;
					const table = {
						shell: child.cloneNode(false),
						head: head ? head.cloneNode(true) : null,
						head_h: head ? head.getBoundingClientRect().height : 0,
						colgroups: [...child.querySelectorAll(":scope > colgroup")].map((c) => c.cloneNode(true)),
						path,
					};
					for (const body of child.tBodies) {
						const tbody = body.cloneNode(false);
						for (const tr of body.rows) units.push({ node: tr.cloneNode(true), h: tr.getBoundingClientRect().height, table, tbody, path });
					}
					if (child.tFoot) {
						const tbody = child.tFoot.cloneNode(false);
						for (const tr of child.tFoot.rows) units.push({ node: tr.cloneNode(true), h: tr.getBoundingClientRect().height, table, tbody, path });
					}
					continue;
				}
				if (hh > body_h && child.children.length) {
					walk(child, [...path, child.cloneNode(false)]);
					continue;
				}
				units.push({ node: child.cloneNode(true), h: hh, table: null, path });
			}
		};
		walk(container, []);
		return units;
	}

	/** The head of a page of a report print format: the letter head, or a slim line. */
	custom_head(first) {
		const lh = this.letterhead?.header;
		if (lh && (first || this.settings.letterhead_all)) return `<div class="rv-page-lh">${lh}</div>`;
		return first ? "" : this.head_html(false, this.letterhead);
	}

	custom_page_html(i) {
		const page = this.custom_pages[i];
		const n = this.pages.length;
		const flow = document.createElement("div");
		flow.className = "rv-page-flow";
		// the open wrappers (by the path they copy), then the open table and tbody
		let stack = [];
		let table = null;
		let tbody = null;
		let tbody_src = null;
		const parent_for = (path) => {
			let k = 0;
			while (k < stack.length && k < path.length && stack[k].src === path[k]) k += 1;
			stack = stack.slice(0, k);
			let parent = k ? stack[k - 1].el : flow;
			for (let j = k; j < path.length; j++) {
				const el = path[j].cloneNode(false);
				parent.appendChild(el);
				stack.push({ src: path[j], el });
				parent = el;
			}
			return parent;
		};
		for (const u of page.units) {
			const before = stack.length;
			const parent = parent_for(u.path);
			if (stack.length !== before || (table && table.parentNode !== parent)) table = null;
			if (u.table) {
				if (!table || table.__src !== u.table) {
					table = u.table.shell.cloneNode(false);
					table.__src = u.table;
					for (const c of u.table.colgroups) table.appendChild(c.cloneNode(true));
					if (u.table.head) table.appendChild(u.table.head.cloneNode(true));
					parent.appendChild(table);
					tbody = null;
				}
				if (!tbody || tbody_src !== u.tbody) {
					tbody = u.tbody.cloneNode(false);
					tbody_src = u.tbody;
					table.appendChild(tbody);
				}
				tbody.appendChild(u.node.cloneNode(true));
			} else {
				table = null;
				parent.appendChild(u.node.cloneNode(true));
			}
		}
		return `<header class="rv-page-top">${this.custom_head(i === 0)}</header>${this.custom_styles}${flow.outerHTML}<footer class="rv-page-foot">${this.foot_html(i + 1, n, this.letterhead)}</footer>`;
	}

	// ------------------------------------------------------------ zoom and position

	zoom_value() {
		const z = this.settings.zoom;
		if (z === "fit") {
			const w = this.stage.clientWidth - 2 * STAGE_PAD;
			return Math.max(0.3, Math.min(1.25, w / (this.box?.w || 794)));
		}
		return z;
	}

	apply_zoom() {
		if (!this.box) return;
		const z = this.zoom_value();
		this.sheets.style.setProperty("--pp-zoom", String(z));
		this.zoom_lbl.textContent = `${Math.round(z * 100)}%`;
		for (const b of this.el.querySelectorAll("[data-zoom=fit]")) b.classList.toggle("on", this.settings.zoom === "fit");
	}

	zoom(how) {
		if (how === "fit") {
			this.settings.zoom = "fit";
		} else {
			const z = this.zoom_value();
			const steps = ZOOM_STEPS;
			let next = z;
			if (how === "in") next = steps.find((v) => v > z + 0.01) ?? steps[steps.length - 1];
			else next = [...steps].reverse().find((v) => v < z - 0.01) ?? steps[0];
			this.settings.zoom = next;
		}
		this.host.pages_settings_save({ ...this.settings });
		this.apply_zoom();
	}

	update_position() {
		if (!this.pages.length || !this.box) return;
		const z = this.zoom_value();
		const h = (this.box.h + PAGE_GAP) * z;
		const at = Math.min(this.pages.length, Math.floor((this.stage.scrollTop + this.stage.clientHeight / 2 - STAGE_PAD * z) / h) + 1);
		const num = (v) => frappe.format(v, { fieldtype: "Int" }, { inline: true });
		this.pos_el.textContent = __("Page {0} of {1}", [num(Math.max(1, at)), num(this.pages.length)]);
	}

	// ------------------------------------------------------------ print

	async fill_all() {
		for (let i = 0; i < this.pages.length; i++) this.request_fill(i);
		while (this.queue.length || this.filling.size) await new Promise((r) => setTimeout(r, 20));
	}

	/** Prints the pages: every page is filled, the sheets stand alone in the document, the browser's dialog opens. */
	async print() {
		if (!this.pages.length || this.printing) return;
		if (this.pages.length > PRINT_MAX_PAGES) {
			frappe.msgprint({
				title: __("Too many pages to print"),
				message: esc(__("{0} pages are more than the browser prints at once ({1}). Narrow the filters, fold groups or export to Excel.", [this.pages.length, PRINT_MAX_PAGES])),
				indicator: "orange",
			});
			return;
		}
		const restore = await this.prepare_print();
		if (!restore) return;
		window.addEventListener("afterprint", restore);
		await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		window.print();
		// Browsers that return before the dialog closes fire afterprint; the others are done here.
		setTimeout(restore, 1000);
	}

	/**
	 * Fills every page and moves the sheets to a root of their own in the document, with the
	 * @page rule of the paper, as the print needs them. Resolves with the function that puts
	 * them back (also run on afterprint); null when nothing is shown.
	 */
	async prepare_print() {
		if (!this.pages.length || this.printing) return null;
		this.printing = true;
		const button = this.el.querySelector('[data-action="print"]');
		button.disabled = true;
		try {
			await this.ready;
			await this.fill_all();
		} catch (e) {
			this.printing = false;
			button.disabled = false;
			throw e;
		}
		const root = document.createElement("div");
		root.className = `rv rv-print-root ${this.root.classList.contains("compact") ? "compact" : ""}`;
		root.dir = this.sheets.dir;
		root.lang = this.sheets.lang;
		const style = document.createElement("style");
		style.textContent = this.print_css();
		const sheets = this.sheets;
		// the paper's rules last in the document: after any style a format carries
		root.append(sheets, style);
		document.body.appendChild(root);
		const restore = () => {
			window.removeEventListener("afterprint", restore);
			if (root.isConnected) {
				this.stage.insertBefore(sheets, this.probe);
				root.remove();
			}
			// the pages are observed from their stage again
			if (this.observer) {
				this.observer.disconnect();
				for (const el of this.sheets.children) this.observer.observe(el);
			}
			this.printing = false;
			button.disabled = false;
		};
		return restore;
	}

	print_css() {
		const b = this.box;
		return `@page{size:${b.paper_w_mm}mm ${b.paper_h_mm}mm;margin:0}
@media print{
html,body{width:${b.paper_w_mm}mm!important;min-width:0!important;height:auto!important;margin:0!important;padding:0!important;background:#fff!important;overflow:visible!important}
body>*:not(.rv-print-root){display:none!important}
.rv-print-root{display:block!important;position:static!important;background:transparent!important}
.rv-print-root .rv-print-sheets{display:block!important;padding:0!important;gap:0!important;zoom:1!important}
.rv-print-root .rv-page{box-shadow:none!important;margin:0!important;break-after:page;page-break-after:always;break-inside:avoid}
.rv-print-root .rv-page:last-child{break-after:auto;page-break-after:auto}
}`;
	}
}
