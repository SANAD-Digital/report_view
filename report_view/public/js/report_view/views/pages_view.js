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
// fills them all first (up to PRINT_MAX_PAGES, or the site's limit in Report View Global
// Settings).
// Another language: the report runs again on the server with `_lang` (its column labels and
// captions come translated), the page's own words come from api.get_translations; the rows
// and their order stay those of the view.

import { GridRows } from "./grid_rows.js";
import { page_box, fit_columns, SCREEN_FONT } from "../engine/page_layout.js";
import { icons } from "../components/icons.js";
import { outside_press } from "../components/popover.js";
import { esc, fmt_int, frame_resize_observer, session_lang } from "../util.js";
import { error_text } from "../api.js";
import { PresetControl } from "./print_presets.js";
import "../fonts_registry.js";
import { PagesChrome } from "./pages/chrome.js";
import { PagesLang } from "./pages/i18n.js";
import { PagesLayouts } from "./pages/layouts.js";
import { PagesOutput } from "./pages/output.js";
import { PagesPanel } from "./pages/panel.js";
import { DEFAULT_SETTINGS, KEEP_FORMATS, KEEP_LANGS, KEEP_LETTERHEADS, KEEP_PARTS, PAGE_GAP, PAINT_KEYS, PRINT_MAX_PAGES, SKELETON_BARS, STAGE_PAD, ZOOM_STEPS, sanitize_settings } from "./pages/settings.js";
import { Lru, strip_scripts } from "./pages/support.js";
import { PagesVirtual } from "./pages/virtual.js";

export class PagesView {
	/**
	 * @param {object} o
	 * @param {HTMLElement} o.parent the .rv-pages element
	 * @param {HTMLElement} o.root the .rv element
	 * @param {boolean} o.rtl direction of the page (the session's)
	 * @param {object} o.host the page: pages_options(company), pages_letterhead(name),
	 *   pages_format(name), pages_part(kind, name, lang), pages_translations(lang, messages), pages_run_lang(lang),
	 *   pages_settings_load(), pages_settings_save(settings), pages_context(),
	 *   pages_preset_target() → {context, target} of the print presets (optional, ADR-020)
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
		// bounded: a format or a language holds a whole run of the report; failures are not kept
		this.lang_packs = new Lru(KEEP_LANGS);
		this.letterheads = new Lru(KEEP_LETTERHEADS);
		this.formats = new Lru(KEEP_FORMATS);
		this.parts = new Lru(KEEP_PARTS);
		this.base = DEFAULT_SETTINGS;
		this.token = 0;
		this.pages = [];
		this.filled = new Map();
		this.filling = new Set();
		this.queue = [];
		// the fills of the pages near the viewport under way (print waits for them)
		this.inflight = new Set();
		this.observer = null;
		this.current = null;
		this.ready = null;
		this.printing = false;
		// the PDF job followed ({job, stop, reason}), or null
		this.pdf_job = null;
		this.el = parent;
		this.make_dom();
		// saved settings under a name (ADR-020), in the head of the toolbar
		this.presets = new PresetControl(this, { sanitize: sanitize_settings, defaults: DEFAULT_SETTINGS });
	}

	make_dom() {
		const el = this.el;
		el.innerHTML = `
			<aside class="rv-print-side" aria-label="${esc(__("Print settings"))}">
				<div class="rv-print-hd">
					<div class="rv-print-hd-t"><strong>${esc(__("Print setup"))}</strong><span class="rv-print-count"></span></div>
					<button type="button" class="rv-btn sm ghost" data-action="reset" title="${esc(__("Back to the default settings"))}">${icons.reset()}<span>${esc(__("Reset", null, "Report View"))}</span></button>
				</div>
				<div class="bd"></div>
				<div class="rv-print-ft">
					<span class="rv-print-note"></span>
					<div class="rv-print-acts">
						<button type="button" class="rv-btn primary rv-print-go" data-action="print" title="${esc(__("To keep a PDF file, choose «Save as PDF» in the print dialog."))}">${icons.print()}<span>${esc(__("Print", null, "Report View"))}</span></button>
						<button type="button" class="rv-btn rv-print-pdf" data-action="pdf" title="${esc(__("The same pages as a PDF file, made by the server"))}">${esc(__("PDF"))}</button>
					</div>
					<small class="rv-print-tip">${esc(__("To keep a PDF file, choose «Save as PDF» in the print dialog."))}</small>
				</div>
			</aside>
			<div class="rv-print-main">
			<nav class="rv-print-thumbs" aria-label="${esc(__("Pages", null, "Report View"))}"></nav>
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
				<div class="rv-print-busy" role="status" aria-live="polite" hidden><span class="rv-spin" aria-hidden="true"></span><span class="txt"></span><button type="button" class="rv-btn sm ghost" data-action="pdf-cancel" hidden>${esc(__("Cancel"))}</button></div>
				<div class="rv-print-fmt-css" hidden></div>
				<div class="rv-print-sheets" dir="${this.rtl ? "rtl" : "ltr"}"></div>
				<div class="rv-print-probe" aria-hidden="true"></div>
			</div>
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
		this.busy_el = el.querySelector(".rv-print-busy");
		this.fmt_css = el.querySelector(".rv-print-fmt-css");
		this.busy_el.querySelector('[data-action="pdf-cancel"]').addEventListener("click", () => this.pdf_job && this.stop_pdf_job(this.pdf_job, "cancel"));
		el.querySelector('[data-action="print"]').addEventListener("click", () => this.guard(() => this.print()));
		const pdf = el.querySelector('[data-action="pdf"]');
		if (this.host.pages_pdf_target) pdf.addEventListener("click", () => this.guard(() => this.pdf()));
		else pdf.remove();
		el.querySelector('[data-action="reset"]').addEventListener("click", () => this.guard(() => this.reset()));
		el.addEventListener("keydown", (e) => {
			if (e.key === "Escape" && this.open_secs?.size) this.close_menu();
		});
		// a tool's menu closes on a click elsewhere (lists of its own fields excepted) and
		// follows the window's size: listened to only while a menu is open (menu_listeners)
		this.outside = outside_press(
			(t) => this.bd.contains(t),
			() => {
				if (this.open_secs?.size && this.el.isConnected) this.close_menu();
			}
		);
		this.on_resize = () => this.place_menu();
		this.thumbs = el.querySelector(".rv-print-thumbs");
		this.thumbs.addEventListener("click", (e) => {
			const b = e.target.closest("[data-thumb]");
			if (b) this.go_to_page(Number(b.dataset.thumb));
		});
		for (const b of el.querySelectorAll("[data-zoom]")) b.addEventListener("click", () => this.zoom(b.dataset.zoom));
		this.stage.addEventListener("scroll", () => this.update_position(), { passive: true });
		// the wheel scrolls the panel; a focused number field would take it as a step up or
		// down and change its value under the pointer: it lets the field go first
		this.bd.addEventListener("wheel", (e) => {
			const t = e.target;
			if (t instanceof HTMLInputElement && t.type === "number" && t === document.activeElement) t.blur();
		}, { passive: true });
				// an open list of a Link field follows its field while the panel scrolls
		this.bd.addEventListener("scroll", () => {
			for (const input of this.bd.querySelectorAll(".rv-linkf input[aria-expanded='true']")) this.place_dropdown(input);
			this.place_menu();
		}, { passive: true, capture: true });
		this.resize_observer = frame_resize_observer(() => this.apply_zoom());
		this.resize_observer.observe(this.stage);
	}

	// ------------------------------------------------------------ loading

	/**
	 * Fetches, while the table is on screen, what the pages wait for: the user's settings,
	 * the print options and the letter head. Once per report; opening the Pages tab then
	 * finds them ready.
	 */
	prefetch() {
		const ctx = this.host.pages_context();
		if (this.prefetched === ctx.report_name) return;
		this.prefetched = ctx.report_name;
		const settings_p = this.host.pages_settings_load().catch(() => null);
		const options_p = this.host.pages_options(ctx.company);
		// the print presets of this target (null where there are none; never fails)
		const presets_p = this.presets.load();
		this.pending = { report: ctx.report_name, settings_p, options_p, presets_p };
		// the letter head the pages will show first (the saved one, else the company's)
		Promise.all([settings_p, options_p])
			.then(([saved, options]) => {
				const name = saved?.letter_head ?? options?.default_letter_head;
				if (name && options.letter_heads.some((lh) => lh.name === name)) {
					this.ctx = ctx;
					return this.load_letterhead(name);
				}
			})
			.catch(() => {});
		options_p.catch(() => {});
	}

	/** A line on the stage while the pages are prepared (null hides it). */
	busy(text) {
		this.busy_el.hidden = !text;
		this.busy_el.querySelector(".txt").textContent = text || "";
		this.el.classList.toggle("is-busy", Boolean(text));
	}

	// The panel and a page-sized sheet as grey bars until the first pages are there.
	skeleton(panel = true) {
		if (this.pages.length) return;
		const bar = (w) => `<span class="rv-skel" style="width:${w}%"></span>`;
		if (panel) this.bd.innerHTML = `<div class="rv-print-skel">${SKELETON_BARS.map(bar).join("")}</div>`;
		const box = page_box(this.settings);
		const rows = Array.from({ length: 18 }, (_, i) => bar(i % 5 === 0 ? 60 : 100)).join("");
		this.sheets.innerHTML = `<section class="rv-page rv-page-skel" style="width:${box.w}px;height:${box.h}px;padding-block:${box.pad.top}px ${box.pad.bottom}px;padding-inline:${box.pad.start}px ${box.pad.end}px">${bar(40)}${bar(25)}<div class="rv-page-skel-rows">${rows}</div></section>`;
		this.apply_zoom_box(box);
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
		this.resize_observer.observe(this.stage);
		if (!(await this.load_setup(token))) return;
		if (!opened.post.label_key) {
			this.clear_pages();
			return;
		}
		this.rows.set({ report, state, config, post: opened.post, fmt, session, width: 1200 });
		// No choice made yet for this report: a table too wide for a portrait page at the
		// smallest font opens in landscape, as Frappe prints reports by default.
		if (this.unsaved && !this.settings.template && !this.options?.defaults?.orientation) {
			const portrait = page_box({ size: this.settings.size, orientation: "portrait", page_m: this.settings.page_m });
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

	/**
	 * The user's settings and the print options, once per report (or document): the
	 * site's standard settings under the user's own, unknown saved choices dropped.
	 * False when another show came meanwhile.
	 */
	async load_setup(token) {
		const name = this.ctx.report_name;
		if (this.settings_report === name && this.options_report === name) return true;
		this.skeleton();
		this.busy(__("Loading the print settings…"));
		if (this.pending?.report !== name) this.prefetch();
		const { settings_p, options_p, presets_p } = this.pending;
		let saved = null;
		try {
			[saved, this.options] = await Promise.all([settings_p, options_p]);
		} catch (e) {
			this.options = { letter_heads: [], default_letter_head: null, print_formats: [], print_format_types: {}, print_headings: [], print_signatures: [], languages: [], lang: session_lang() };
			this.note(error_text(e), true);
		}
		const presets = await presets_p;
		if (token !== this.token) return false;
		// the site's standard settings (Report View Global Settings) under the user's own
		this.base = sanitize_settings(this.options.defaults || null);
		if (this.settings_report !== name) {
			this.settings = sanitize_settings(saved, this.base);
			this.unsaved = !saved;
			// the preset the settings were saved with; none saved: the default preset (ADR-020)
			const first = this.presets.setup(saved, presets);
			if (first) {
				this.settings = this.presets.settings_of(first);
				this.unsaved = false;
			}
		}
		this.settings_report = name;
		this.options_report = name;
		// Unknown choices of a saved setting fall back; the company's letter head is the
		// first choice when none was made.
		if (this.settings.letter_head && !this.options.letter_heads.some((lh) => lh.name === this.settings.letter_head)) this.settings.letter_head = "";
		if (this.settings.template && !this.options.print_formats.includes(this.settings.template)) this.settings.template = "";
		if (this.settings.lang && !this.options.languages.some((l) => l.name === this.settings.lang)) this.settings.lang = "";
		if (this.settings.heading && !(this.options.print_headings || []).includes(this.settings.heading)) this.settings.heading = "";
		if (this.settings.signature && !(this.options.print_signatures || []).some((x) => x.name === this.settings.signature)) this.settings.signature = "";
		if (!this.settings.letter_head && this.options.default_letter_head && this.settings.letter_head !== null) {
			this.settings.letter_head = this.options.default_letter_head;
		}
		this.presets.refresh();
		return true;
	}

	/**
	 * Shows a document (ADR-017): its print format, rendered by Frappe, in the pages of
	 * Report View. The host gives pages_format("" = the doctype's default), the letter head,
	 * the heading and the signature rendered with the document.
	 */
	async show_document() {
		const token = ++this.token;
		this.doc_mode = true;
		this.el.classList.add("rv-doc-mode");
		this.current = { doc: true };
		this.ctx = this.host.pages_context();
		this.resize_observer.observe(this.stage);
		if (!(await this.load_setup(token))) return;
		this.render_panel();
		this.ready = this.relayout(token);
		await this.ready;
	}

	destroy() {
		this.token += 1;
		// a typed value waiting to cut the pages again: there are no pages to cut
		clearTimeout(this._typed);
		// a PDF job followed for these pages: its file would never be fetched
		if (this.pdf_job) this.stop_pdf_job(this.pdf_job, "leave");
		this.busy(null);
		this.current = null;
		this.clear_pages();
		this.bd.replaceChildren();
		// nothing of the pages listens while they are not shown (show observes the stage again)
		this.open_secs = new Set();
		this.menu_listeners(false);
		this.presets.destroy();
		this.resize_observer.disconnect();
	}

	/** The view is dropped for good (doc_print switches its host): destroyed, the font picker's document listener gone. */
	release() {
		this.destroy();
		this.unbind_fonts?.();
		this.unbind_fonts = null;
	}

	clear_pages() {
		if (this.observer) this.observer.disconnect();
		this.observer = null;
		this.pages = [];
		this.filled.clear();
		this.filling.clear();
		this.queue = [];
		this.set_format_css("");
		this.sheets.replaceChildren();
		this.probe.replaceChildren();
		this.count_el.textContent = "";
		this.pos_el.textContent = "";
	}

	/**
	 * The <style> blocks of a print format, once for all its pages, beside the sheets (and
	 * printed with them); "" removes them.
	 */
	set_format_css(html) {
		if (this.fmt_css_html === html) return;
		this.fmt_css_html = html;
		this.fmt_css.innerHTML = html;
	}

	note(text, warn = false) {
		this.note_el.textContent = text || "";
		this.note_el.classList.toggle("warn", Boolean(warn));
	}

	/**
	 * Runs an action of the person (a click: print, PDF, reset, an image): a failure is said
	 * on the panel, never left as an unhandled rejection. Resolves with the action's value, or
	 * undefined when it failed.
	 */
	guard(fn) {
		try {
			return Promise.resolve(fn()).catch((e) => this.note(error_text(e), true));
		} catch (e) {
			this.note(error_text(e), true);
			return Promise.resolve();
		}
	}

	// ------------------------------------------------------------ settings

	/**
	 * @param {object} patch new values of the settings
	 * @param {{panel?: boolean, wait?: number}} [opts] panel: build the panel again (not while
	 *   a value is typed); wait: cut the pages again after this many ms of quiet
	 */
	update(patch, { panel = true, wait = 0 } = {}) {
		const changed = Object.keys(patch).filter((k) => JSON.stringify(this.settings[k]) !== JSON.stringify(patch[k]));
		Object.assign(this.settings, patch);
		this.unsaved = false;
		if (changed.length && changed.every((k) => PAINT_KEYS.has(k)) && this.pages.length && !this.el.classList.contains("is-busy")) {
			this.save_settings();
			if (panel) this.render_panel();
			this.apply_vars(this.settings);
			return;
		}
		if (!panel) {
			this.save_settings();
			this.apply_vars(this.settings);
			clearTimeout(this._typed);
			this._typed = setTimeout(() => {
				if (this.current) this.ready = this.relayout(++this.token);
			}, wait);
			return;
		}
		this.save_settings();
		this.render_panel();
		if (this.current) this.ready = this.relayout(++this.token);
	}

	/** The user's settings saved, with the print preset they come from (ADR-020). */
	save_settings() {
		this.host.pages_settings_save({ ...this.settings, preset: this.presets.name() });
		this.presets.refresh();
	}

	/** Pages printed at once: the site's limit (Report View Global Settings), else 600. */
	max_pages() {
		return Number(this.options?.limits?.print_max_pages) || PRINT_MAX_PAGES;
	}

	/** Back to the default settings of the pages (the zoom and the columns shown stay). */
	reset() {
		// the standard settings: no preset applied any more
		this.presets.clear();
		const keep = { zoom: this.settings.zoom };
		const fresh = sanitize_settings(null, this.base);
		if (this.options?.default_letter_head) fresh.letter_head = this.options.default_letter_head;
		this.settings = { ...fresh, ...keep };
		this.update({});
		frappe.show_alert?.({ message: __("Print settings are back to their defaults"), indicator: "green" });
	}

	go_to_page(i) {
		const sheet = this.sheets.children[i];
		if (!sheet) return;
		const top = sheet.getBoundingClientRect().top - this.stage.getBoundingClientRect().top + this.stage.scrollTop - 12;
		this.stage.scrollTo({ top, behavior: "smooth" });
	}

	// ------------------------------------------------------------ layout

	/**
	 * Cuts the pages again for the settings of `token`. Never rejects: a failure is said on the
	 * panel and kept (`layout_error`), so print and PDF refuse pages that were not laid out.
	 */
	async relayout(token) {
		try {
			this.layout_error = null;
			await this.layout_pages(token);
		} catch (e) {
			if (token !== this.token) return;
			this.layout_error = e;
			this.busy(null);
			this.note(__("The pages could not be laid out: {0}", [error_text(e)]), true);
		}
	}

	async layout_pages(token) {
		const cur = this.current;
		if (!cur) return;
		// The pages on screen stay (dimmed) until the new ones are mounted: no blank stage.
		if (this.observer) this.observer.disconnect();
		this.queue = [];
		this.note("");
		this.sig_fallback = false;
		const s = this.settings;
		const steps = [];
		if (s.lang && s.lang !== session_lang() && !this.lang_packs.has(this.lang_key(s.lang))) steps.push(__("Running the report in the chosen language…"));
		if (s.template || this.doc_mode) steps.push(__("Rendering the print format…"));
		this.busy(steps.length ? steps.join(" · ") : this.pages.length ? __("Updating the pages…") : __("Preparing the pages…"));
		// back on the tab: a page-sized sheet while the pages are prepared
		this.skeleton(false);
		// What the pages need before they are measured: the letter head, the pack of the
		// language, the custom template.
		let lang_entry = null;
		let letterhead = null;
		let format = null;
		let heading = null;
		let signature = null;
		try {
			[lang_entry, letterhead, format, heading, signature] = await Promise.all([
				this.load_lang(s.lang).catch((e) => {
					this.note(__("The language could not be loaded: {0}", [error_text(e)]), true);
					return null;
				}),
				this.load_letterhead(s.letter_head),
				this.load_format(s.template).then((f) => (f || !s.template || !this.doc_mode ? f : this.load_format(""))),
				this.load_part("heading", s.heading),
				this.load_part("signature", s.signatures ? s.signature : ""),
			]);
		} catch (e) {
			this.note(error_text(e), true);
		}
		if (token !== this.token || this.current !== cur) return;
		this.lang_entry = lang_entry;
		this.letterhead = letterhead;
		this.letterhead_name = s.letter_head;
		this.format = format;
		// the footer section learns whether this letter head has a footer
		if (this.panel_no_footer !== Boolean(s.letter_head && !letterhead?.footer) && !this.bd.contains(document.activeElement)) this.render_panel();
		this.heading = heading;
		this.signature = signature;
		if (lang_entry && lang_entry.report === null && s.lang && s.lang !== session_lang()) {
			this.note(__("The report could not run in the chosen language; labels stay in the session language."), true);
		}

		const box = page_box(s);
		this.box = box;
		const dir = this.lang_rtl() ? "rtl" : "ltr";
		this.sheets.dir = dir;
		this.sheets.lang = this.lang();
		this.apply_vars(s);
		this.root.style.setProperty("--pp-w", `${box.w}px`);
		this.root.style.setProperty("--pp-h", `${box.h}px`);

		this.busy(__("Laying out the pages…"));
		try {
			if (format) {
				await this.layout_custom(token, box, dir);
			} else if (this.doc_mode) {
				this.clear_pages();
			} else {
				await this.layout_standard(token, box, dir);
			}
		} finally {
			if (token === this.token) this.busy(null);
		}
		if (token !== this.token) return;
		if (this.sig_fallback) this.note(__("With the signature on these pages there is no room left for the content: it prints on the last page only. Make the letter head, footer or signature smaller to repeat it."), true);
		this.apply_zoom();
		this.update_position();
	}

	async load_letterhead(name) {
		if (!name) return null;
		const key = this.doc_mode ? `${name}|${this.ctx.report_name}` : `${name}|${this.ctx.company || ""}`;
		if (!this.letterheads.has(key)) {
			try {
				const r = await this.host.pages_letterhead(name);
				this.letterheads.set(key, { header: strip_scripts(r?.header), footer: strip_scripts(r?.footer) });
			} catch (e) {
				// not kept: the next layout asks again
				this.note(__("The letter head could not be loaded: {0}", [error_text(e)]), true);
				return null;
			}
		}
		return this.letterheads.get(key);
	}

	/**
	 * A print heading or a print signature, rendered by the server with the report, its
	 * criteria and the language of the pages: one per all three.
	 * @param {"heading"|"signature"} kind
	 */
	async load_part(kind, name) {
		if (!name) return null;
		const cols = this.view_columns();
		const key = `${kind}|${name}|${this.settings.lang || ""}|${JSON.stringify(this.ctx.filters || {})}|${JSON.stringify(cols)}`;
		if (!this.parts.has(key)) {
			try {
				const r = await this.host.pages_part(kind, name, this.settings.lang || null, cols);
				this.parts.set(key, r ? { ...r, html: strip_scripts(r.html) } : null);
			} catch (e) {
				const msg = kind === "heading" ? __("The print heading could not be loaded: {0}", [error_text(e)]) : __("The signature could not be loaded: {0}", [error_text(e)]);
				this.note(msg, true);
				return null;
			}
		}
		return this.parts.get(key);
	}

	async load_format(name) {
		// a document always has a format: "" is its doctype's default
		if (!name && !this.doc_mode) return null;
		// a Jinja format is rendered with the criteria and the language: one per both
		const cols = this.view_columns();
		const key = `${name}|${this.settings.lang || ""}|${JSON.stringify(this.ctx.filters || {})}|${JSON.stringify(cols)}`;
		if (!this.formats.has(key)) {
			try {
				this.formats.set(key, await this.host.pages_format(name, this.settings.lang || null, this.options?.print_format_types?.[name], cols));
			} catch (e) {
				this.note(__("The print format could not be loaded: {0}", [error_text(e)]), true);
				return null;
			}
		}
		return this.formats.get(key);
	}

	// ------------------------------------------------------------ zoom and position
	// (the layouts: pages/layouts.js; the furniture of a page: pages/chrome.js; the sheets and
	// their content: pages/virtual.js; print and PDF: pages/output.js; the panel: pages/panel.js;
	// the language: pages/i18n.js)

	zoom_value() {
		const z = this.settings.zoom;
		if (z === "fit") {
			// the sheets' own padding (smaller on a narrow screen), at the zoom it is drawn with
			const pad = this.sheet_metrics().pad_inline;
			const w = this.stage.clientWidth - 2 * pad;
			return Math.max(0.3, Math.min(1.25, w / (this.box?.w || 794)));
		}
		return z;
	}

	apply_zoom_box(box) {
		const keep = this.box;
		this.box = box;
		this.apply_zoom();
		this.box = keep || box;
	}

	/**
	 * The gap between the sheets and their padding (px, before the zoom), as rv_pages.css sets
	 * them for this width; read again after a change of the stage's size (apply_zoom).
	 */
	sheet_metrics() {
		if (!this._metrics) {
			const cs = getComputedStyle(this.sheets);
			const px = (v, fallback) => {
				const n = parseFloat(v);
				return Number.isFinite(n) ? n : fallback;
			};
			this._metrics = { gap: px(cs.rowGap, PAGE_GAP), pad: px(cs.paddingBlockStart, STAGE_PAD), pad_inline: px(cs.paddingInlineStart, STAGE_PAD) };
		}
		return this._metrics;
	}

	apply_zoom() {
		// the stage changed size (or the pages were cut again): the stylesheet's values may differ
		this._metrics = null;
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
		this.save_settings();
		this.apply_zoom();
	}

	update_position() {
		if (!this.pages.length || !this.box) return;
		const z = this.zoom_value();
		const { gap, pad } = this.sheet_metrics();
		const h = (this.box.h + gap) * z;
		const at = Math.min(this.pages.length, Math.floor((this.stage.scrollTop + this.stage.clientHeight / 2 - pad * z) / h) + 1);
		const num = fmt_int;
		this.pos_el.textContent = __("Page {0} of {1}", [num(Math.max(1, at)), num(this.pages.length)]);
		const cur = this.thumbs?.querySelector('[aria-current="page"]');
		const next = this.thumbs?.children[Math.max(1, at) - 1];
		if (cur !== next) {
			cur?.removeAttribute("aria-current");
			if (next) {
				next.setAttribute("aria-current", "page");
				if (next.offsetTop < this.thumbs.scrollTop || next.offsetTop + next.offsetHeight > this.thumbs.scrollTop + this.thumbs.clientHeight) next.scrollIntoView({ block: "nearest" });
			}
		}
	}
}

// The methods of PagesView live in views/pages/*.js, one module per concern; they are the
// class's own, installed on its prototype: one object and one `this`, so the hosts
// (index.js, doc_print.js) and the tests see the same interface as before the split.
const PARTS = [PagesPanel, PagesLayouts, PagesLang, PagesChrome, PagesVirtual, PagesOutput];
for (const part of PARTS) {
	for (const [name, d] of Object.entries(Object.getOwnPropertyDescriptors(part.prototype))) {
		if (name !== "constructor") Object.defineProperty(PagesView.prototype, name, d);
	}
}
