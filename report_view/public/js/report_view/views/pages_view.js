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
import { build_layout } from "../engine/row_layout.js";
import { page_box, fit_columns, paginate, preset_margins, PAGE_SIZES, MARGINS, PAGE_FONT, SCREEN_FONT } from "../engine/page_layout.js";
import { icons } from "../components/icons.js";
import { esc } from "../util.js";

export const PRINT_MAX_PAGES = 600;
// Room kept under the rows of a page (px): what a page drawn at another zoom or font may add.
const SAFETY_PX = 6;
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

const BOX = (top, bottom, start, end) => Object.freeze({ top, bottom, start, end });
export const DEFAULT_SETTINGS = Object.freeze({
	size: "A4",
	orientation: "portrait",
	// a preset of the page margins, or "custom" once the four are typed (page_m, mm)
	margins: "normal",
	page_m: BOX(12, 12, 12, 12),
	template: "",
	// the look of Report View's own template (rv_pages.css .ps-<style>)
	style: "classic",
	letter_head: "",
	// a Print Heading (rendered by the server with the report and its filters): on which
	// pages, instead of the report's title or above it, alignment, size, margins, a rule
	heading: "",
	heading_pages: "first",
	heading_replace: false,
	heading_align: "center",
	heading_size: 13,
	heading_m: BOX(0, 2, 0, 0),
	heading_line_w: 0,
	heading_line_c: "#D9DFDB",
	heading_line_s: "solid",
	// a Print Signature of the report ("": Report View's standard boxes): on which pages,
	// after the table or at the bottom of the last page, font size, margins
	signature: "",
	sig_pages: "last",
	sig_pos: "after",
	sig_size: 9,
	sig_m: BOX(4, 0, 0, 0),
	lang: "",
	include_filters: true,
	include_subtotals: true,
	include_total: true,
	signatures: false,
	page_numbers: true,
	printed_on: true,
	// the letter head: on every page or the first only, height (mm), alignment, fit, margins
	// on which pages: "all", "first", "rest" (all but the first), and for the footer "last"
	lh_pages: "first",
	lh_height: 26,
	lh_align: "center",
	lh_fit: "contain",
	lh_m: BOX(0, 3, 0, 0),
	// the letter head's footer: on every page or the last only, height (mm, 0 = none)
	foot_pages: "all",
	foot_height: 11,
	foot_align: "center",
	foot_m: BOX(1.5, 1.5, 0, 0),
	// the page number: place, order against the footer, format, first number, size,
	// the report's name beside it, the space around it
	number_pos: "bottom-end",
	number_format: "full",
	number_start: 1,
	number_size: 8,
	number_caption: true,
	num_m: BOX(1.5, 0, 0, 0),
	// the three rules: under the letter head, above the footer, above (or under) the number
	head_line_w: 0.6,
	head_line_c: "#D9DFDB",
	head_line_s: "solid",
	foot_line_w: 0.6,
	foot_line_c: "#D9DFDB",
	foot_line_s: "solid",
	num_line_w: 0,
	num_line_c: "#9AA39E",
	num_line_s: "solid",
	// a border round the page: thickness (px), style, colour, distance from the paper's edge
	// (mm), rounded corners (mm), on every page or the first
	pb_on: false,
	pb_w: 1.5,
	pb_s: "solid",
	pb_c: "#1B1F1D",
	pb_offset: 6,
	pb_radius: 0,
	pb_pages: "all",
	// watermark: none, a text or an image, on every page or the first
	wm_type: "none",
	wm_text: "",
	wm_image: "",
	wm_size: 72,
	wm_scale: 50,
	wm_color: "#8A2D3B",
	wm_opacity: 10,
	wm_angle: -30,
	wm_pages: "all",
	hidden: [],
	zoom: "fit",
});
// Print styles of Report View's standard template: one layout, several looks (rv_pages.css).
export const PAGE_STYLES = [
	{ id: "classic", label: () => __("Classic") },
	{ id: "modern", label: () => __("Modern") },
	{ id: "ledger", label: () => __("Accounting grid") },
	{ id: "compact", label: () => __("Compact", null, "Print template") },
	{ id: "minimal", label: () => __("Ink saving") },
];
export const LH_HEIGHT = { min: 5, max: 90 };
export const FOOT_HEIGHT = { min: 0, max: 60 };
export const BOX_MM = { min: 0, max: 60 };
export const LINE_WIDTH = { min: 0, max: 6 };
const NUMBER_POS = ["bottom-end", "bottom-center", "bottom-start", "top-end", "top-center", "top-start"];
const NUMBER_FORMATS = ["full", "short", "number", "dash"];
// Settings drawn over the pages (the watermark, the border round the page): changed on
// the pages already cut, without cutting them again.
// the least share of a page left to the content before a repeated signature moves to the last page
const MIN_ROOM = 0.25;
// pages of a format drawn at once in the probe to be checked
const FIT_RUN = 30;
const PAINT_KEYS = new Set(["pb_on", "pb_w", "pb_s", "pb_c", "pb_offset", "pb_radius", "pb_pages", "wm_type", "wm_text", "wm_image", "wm_size", "wm_scale", "wm_color", "wm_opacity", "wm_angle", "wm_pages"]);
const BOOL_KEYS = ["include_filters", "include_subtotals", "include_total", "signatures", "page_numbers", "printed_on", "number_caption", "pb_on", "heading_replace"];
const PAGE_SCOPES = ["all", "first", "rest"];
const FOOT_SCOPES = ["all", "first", "rest", "last"];

/** Whether a part set to `scope` prints on page `n` of `total`. */
export function on_page(scope, n, total) {
	if (scope === "first") return n === 1;
	if (scope === "rest") return n > 1;
	if (scope === "last") return n === total;
	return true;
}
const ALIGN = ["start", "center", "end"];
const LH_FIT = ["contain", "wide"];
const LINE_STYLES = ["solid", "dashed", "dotted", "double"];
const COLOR = /^#[0-9a-fA-F]{6}$/;
// number settings: [min, max, step]
const NUMS = {
	lh_height: [LH_HEIGHT.min, LH_HEIGHT.max, 1],
	foot_height: [FOOT_HEIGHT.min, FOOT_HEIGHT.max, 1],
	number_start: [1, 9999, 1],
	number_size: [6, 16, 0.5],
	heading_size: [8, 28, 0.5],
	sig_size: [6, 14, 0.5],
	heading_line_w: [0, 6, 0.2],
	head_line_w: [0, 6, 0.2],
	foot_line_w: [0, 6, 0.2],
	num_line_w: [0, 6, 0.2],
	wm_size: [12, 240, 1],
	wm_scale: [5, 100, 1],
	wm_opacity: [2, 80, 1],
	wm_angle: [-90, 90, 1],
	pb_w: [0.5, 12, 0.5],
	pb_offset: [0, 40, 0.5],
	pb_radius: [0, 20, 0.5],
};
const BOXES = ["page_m", "lh_m", "heading_m", "foot_m", "num_m", "sig_m"];
const SIDES = ["top", "bottom", "start", "end"];

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

/** The words of an error: a thrown Error, or the answer of a failed frappe.call. */
function err_text(e) {
	if (typeof e === "string") return e;
	if (typeof e?.message === "string" && e.message) return e.message;
	// a failed request (jQuery's xhr) carries Frappe's answer
	if (e?.responseJSON) e = e.responseJSON;
	try {
		const first = JSON.parse(e?._server_messages || "[]")[0];
		if (first) return strip_tags(JSON.parse(first).message || first);
	} catch {
		// not Frappe's list of messages
	}
	if (typeof e?.exception === "string") return e.exception.replace(/^[\w.]+:\s*/, "");
	return __("Unknown error", null, "Report View");
}

const strip_tags = (html) => {
	const d = document.createElement("div");
	d.innerHTML = String(html);
	return d.textContent || "";
};

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

/**
 * The body of a PDF request (ADR-016): the pages gzipped as a file (``html_gz``), about a
 * tenth of their size; as a plain field where the browser cannot compress.
 */
async function pdf_body(args, html) {
	const form = new FormData();
	for (const [k, v] of Object.entries(args)) if (v != null) form.append(k, v);
	if (typeof CompressionStream === "undefined") {
		form.append("html", html);
		return form;
	}
	const gz = await new Response(new Blob([html]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
	form.append("html_gz", gz, "pages.html.gz");
	return form;
}

// The room a page's foot takes: its box and the top margin of its first part (a signature's
// space above it), which falls outside the box.
function foot_height(foot) {
	if (!foot) return 0;
	const first = foot.firstElementChild;
	return foot.getBoundingClientRect().height + (first ? Math.max(0, parseFloat(getComputedStyle(first).marginTop) || 0) : 0);
}

// A turn of the browser between two pieces of long work: the window stays responsive, a
// newer change of the settings can take over.
const breathe = () => new Promise((r) => setTimeout(r, 0));

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

const clamp = (v, [min, max, step]) => {
	const n = Number(v);
	if (!Number.isFinite(n)) return null;
	const q = Math.round(Math.max(min, Math.min(max, n)) / step) * step;
	return Math.round(q * 100) / 100;
};

function sanitize_box(raw, fallback) {
	if (!raw || typeof raw !== "object") return { ...fallback };
	const out = {};
	for (const side of SIDES) out[side] = clamp(raw[side], [BOX_MM.min, BOX_MM.max, 0.5]) ?? fallback[side];
	return out;
}

/**
 * Settings from what was saved (or sent by the server), every value checked; a value
 * missing or wrong takes `base`'s (the site's standard settings, else DEFAULT_SETTINGS).
 */
export function sanitize_settings(raw, base = DEFAULT_SETTINGS) {
	const out = { ...base, hidden: [...(base.hidden || [])] };
	for (const k of BOXES) out[k] = { ...base[k] };
	if (!raw || typeof raw !== "object") return out;
	if (PAGE_SIZES[raw.size]) out.size = raw.size;
	if (raw.orientation === "landscape" || raw.orientation === "portrait") out.orientation = raw.orientation;
	if (MARGINS[raw.margins] !== undefined) {
		out.margins = raw.margins;
		out.page_m = preset_margins(raw.margins);
	}
	for (const k of BOXES) if (raw[k]) out[k] = sanitize_box(raw[k], out[k]);
	if (raw.margins === "custom" && raw.page_m) out.margins = "custom";
	for (const k of ["template", "letter_head", "lang", "heading", "signature"]) if (typeof raw[k] === "string") out[k] = raw[k];
	for (const k of BOOL_KEYS) if (typeof raw[k] === "boolean") out[k] = raw[k];
	// the setting of the first version: the letter head on every page
	// the switches of earlier versions: the letter head on every page, the footer on every page
	const was = (v) => (typeof v === "boolean" ? v : null);
	const lh_all = was(raw.lh_repeat) ?? was(raw.letterhead_all);
	if (lh_all !== null) out.lh_pages = lh_all ? "all" : "first";
	if (was(raw.foot_repeat) !== null) out.foot_pages = raw.foot_repeat ? "all" : "last";
	if (PAGE_SCOPES.includes(raw.lh_pages)) out.lh_pages = raw.lh_pages;
	if (FOOT_SCOPES.includes(raw.foot_pages)) out.foot_pages = raw.foot_pages;
	if (PAGE_SCOPES.includes(raw.heading_pages)) out.heading_pages = raw.heading_pages;
	if (ALIGN.includes(raw.heading_align)) out.heading_align = raw.heading_align;
	if (FOOT_SCOPES.includes(raw.sig_pages)) out.sig_pages = raw.sig_pages;
	if (["after", "bottom"].includes(raw.sig_pos)) out.sig_pos = raw.sig_pos;
	for (const [k, r] of Object.entries(NUMS)) {
		const v = clamp(raw[k], r);
		if (v !== null) out[k] = v;
	}
	if (PAGE_STYLES.some((st) => st.id === raw.style)) out.style = raw.style;
	if (NUMBER_POS.includes(raw.number_pos)) out.number_pos = raw.number_pos;
	if (NUMBER_FORMATS.includes(raw.number_format)) out.number_format = raw.number_format;
	if (ALIGN.includes(raw.lh_align)) out.lh_align = raw.lh_align;
	if (ALIGN.includes(raw.foot_align)) out.foot_align = raw.foot_align;
	if (LH_FIT.includes(raw.lh_fit)) out.lh_fit = raw.lh_fit;
	for (const k of ["head_line", "heading_line", "foot_line", "num_line"]) {
		if (typeof raw[`${k}_c`] === "string" && COLOR.test(raw[`${k}_c`])) out[`${k}_c`] = raw[`${k}_c`];
		if (LINE_STYLES.includes(raw[`${k}_s`])) out[`${k}_s`] = raw[`${k}_s`];
	}
	if (LINE_STYLES.includes(raw.pb_s)) out.pb_s = raw.pb_s;
	if (typeof raw.pb_c === "string" && COLOR.test(raw.pb_c)) out.pb_c = raw.pb_c;
	if (PAGE_SCOPES.includes(raw.pb_pages)) out.pb_pages = raw.pb_pages;
	if (["none", "text", "image"].includes(raw.wm_type)) out.wm_type = raw.wm_type;
	if (typeof raw.wm_text === "string") out.wm_text = raw.wm_text.slice(0, 120);
	// an image of the site (a file URL) or of the web, never a script
	if (typeof raw.wm_image === "string" && /^(\/|https?:\/\/)/.test(raw.wm_image)) out.wm_image = raw.wm_image.slice(0, 500);
	if (typeof raw.wm_color === "string" && COLOR.test(raw.wm_color)) out.wm_color = raw.wm_color;
	if (PAGE_SCOPES.includes(raw.wm_pages)) out.wm_pages = raw.wm_pages;
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
	 *   pages_format(name), pages_part(kind, name, lang), pages_translations(lang, messages), pages_run_lang(lang),
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
		this.parts = new Map();
		this.base = DEFAULT_SETTINGS;
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
				<div class="rv-print-hd">
					<div class="rv-print-hd-t"><strong>${esc(__("Print setup"))}</strong><span class="rv-print-count"></span></div>
					<button type="button" class="rv-btn sm ghost" data-action="reset" title="${esc(__("Back to the default settings"))}">${icons.reset()}<span>${esc(__("Reset", null, "Report View"))}</span></button>
				</div>
				<div class="bd"></div>
				<div class="rv-print-ft">
					<span class="rv-print-note"></span>
					<div class="rv-print-acts">
						<button type="button" class="rv-btn rv-print-sheet-btn" data-action="sheet" aria-expanded="false">${icons.sliders()}<span>${esc(__("Settings", null, "Report View"))}</span></button>
						<button type="button" class="rv-btn primary rv-print-go" data-action="print">${icons.print()}<span>${esc(__("Print", null, "Report View"))}</span></button>
						<button type="button" class="rv-btn rv-print-pdf" data-action="pdf" title="${esc(__("The same pages as a PDF file, made by the server"))}">PDF</button>
					</div>
					<small class="rv-print-tip">${esc(__("To keep a PDF file, choose «Save as PDF» in the print dialog."))}</small>
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
				<div class="rv-print-busy" role="status" aria-live="polite" hidden><span class="rv-spin" aria-hidden="true"></span><span class="txt"></span></div>
				<div class="rv-print-sheets" dir="${this.rtl ? "rtl" : "ltr"}"></div>
				<div class="rv-print-probe" aria-hidden="true"></div>
			</div>
			<div class="rv-print-scrim" aria-hidden="true"></div>`;
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
		el.querySelector('[data-action="print"]').addEventListener("click", () => this.print());
		const pdf = el.querySelector('[data-action="pdf"]');
		if (this.host.pages_pdf_target) pdf.addEventListener("click", () => this.pdf());
		else pdf.remove();
		el.querySelector('[data-action="reset"]').addEventListener("click", () => this.reset());
		// a narrow screen: the settings are a sheet over the pages, opened from the bar
		el.querySelector('[data-action="sheet"]').addEventListener("click", () => this.toggle_sheet());
		el.querySelector(".rv-print-scrim").addEventListener("click", () => this.toggle_sheet(false));
		el.addEventListener("keydown", (e) => {
			if (e.key === "Escape" && el.classList.contains("sheet-open")) this.toggle_sheet(false);
		});
		for (const b of el.querySelectorAll("[data-zoom]")) b.addEventListener("click", () => this.zoom(b.dataset.zoom));
		this.stage.addEventListener("scroll", () => this.update_position(), { passive: true });
		// an open list of a Link field follows its field while the panel scrolls
		this.bd.addEventListener("scroll", () => {
			for (const input of this.bd.querySelectorAll(".rv-linkf input[aria-expanded='true']")) this.place_dropdown(input);
		}, { passive: true });
		this.resize_observer = new ResizeObserver(() => this.apply_zoom());
		this.resize_observer.observe(this.stage);
	}

	toggle_sheet(open = !this.el.classList.contains("sheet-open")) {
		this.el.classList.toggle("sheet-open", open);
		this.el.querySelector('[data-action="sheet"]').setAttribute("aria-expanded", String(open));
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
		this.pending = { report: ctx.report_name, settings_p, options_p };
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
		if (panel) this.bd.innerHTML = `<div class="rv-print-skel">${[70, 100, 100, 60, 100, 100, 40, 100, 80].map(bar).join("")}</div>`;
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
		const { settings_p, options_p } = this.pending;
		let saved = null;
		try {
			[saved, this.options] = await Promise.all([settings_p, options_p]);
		} catch (e) {
			this.options = { letter_heads: [], default_letter_head: null, print_formats: [], print_format_types: {}, print_headings: [], print_signatures: [], languages: [], lang: frappe.boot.lang };
			this.note(e.message || String(e), true);
		}
		if (token !== this.token) return false;
		// the site's standard settings (Report View Global Settings) under the user's own
		this.base = sanitize_settings(this.options.defaults || null);
		if (this.settings_report !== name) {
			this.settings = sanitize_settings(saved, this.base);
			this.unsaved = !saved;
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
		if (!(await this.load_setup(token))) return;
		this.render_panel();
		this.ready = this.relayout(token);
		await this.ready;
	}

	destroy() {
		this.token += 1;
		this.busy(null);
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
			this.host.pages_settings_save({ ...this.settings });
			if (panel) this.render_panel();
			this.apply_vars(this.settings);
			return;
		}
		if (!panel) {
			this.host.pages_settings_save({ ...this.settings });
			this.apply_vars(this.settings);
			clearTimeout(this._typed);
			this._typed = setTimeout(() => {
				if (this.current) this.ready = this.relayout(++this.token);
			}, wait);
			return;
		}
		this.host.pages_settings_save({ ...this.settings });
		this.render_panel();
		if (this.current) this.ready = this.relayout(++this.token);
	}

	/** Pages printed at once: the site's limit (Report View Global Settings), else 600. */
	max_pages() {
		return Number(this.options?.limits?.print_max_pages) || PRINT_MAX_PAGES;
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
		if (this.doc_mode) {
			// a document is rendered by the server in the language; the page's own words here
			const pack = (await this.host.pages_translations(lang, [...PAGE_MESSAGES, ...this.signature_labels().map((x) => this.msgid_of(x))])) || {};
			const entry = { pack, report: undefined };
			this.lang_packs.set(lang, entry);
			return entry;
		}
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

	/** Back to the default settings of the pages (the zoom and the columns shown stay). */
	reset() {
		const keep = { zoom: this.settings.zoom };
		const fresh = sanitize_settings(null, this.base);
		if (this.options?.default_letter_head) fresh.letter_head = this.options.default_letter_head;
		this.settings = { ...fresh, ...keep };
		this.update({});
		frappe.show_alert?.({ message: __("Print settings are back to their defaults"), indicator: "green" });
	}

	/**
	 * The settings panel: sections that fold (paper, template, letter head, footer, page
	 * numbers, watermark, content, columns), each with a line that sums it up. Numbers are
	 * typed or stepped (mm, px, pt); the page follows a change at once.
	 */
	render_panel() {
		const s = this.settings;
		const o = this.options || { letter_heads: [], print_formats: [], languages: [] };
		const model = this.rows.model;
		const scroll = this.bd.scrollTop;
		if (!this.open_secs) this.open_secs = new Set(["paper"]);
		const mm = __("mm");
		const option = (value, label, on) => `<option value="${esc(value)}" ${on ? "selected" : ""}>${esc(label)}</option>`;
		const check = (key, label) =>
			`<label class="rv-setitem"><span class="rv-check"><input type="checkbox" data-set="${key}" ${s[key] ? "checked" : ""}><span>${esc(label)}</span></span></label>`;
		const sw = (key, label) =>
			`<label class="rv-print-sw"><span>${esc(label)}</span><button type="button" class="rv-switch${s[key] ? " on" : ""}" role="switch" aria-checked="${s[key]}" data-sw="${key}" aria-label="${esc(label)}"></button></label>`;
		const seg = (key, label, opts) =>
			`<div class="rv-field"><span>${esc(label)}</span><div class="rv-seg rv-print-seg" role="group" aria-label="${esc(label)}">${opts
				.map(([v, l]) => `<button type="button" data-seg="${key}" data-value="${v}" class="${s[key] === v ? "on" : ""}" aria-pressed="${s[key] === v}">${esc(l)}</button>`)
				.join("")}</div></div>`;
		const num = (key, label, unit) => {
			const [min, max, step] = NUMS[key];
			return `<label class="rv-field rv-num-field"><span>${esc(label)}</span><span class="rv-num"><input type="number" class="rv-input" data-num="${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}"><i>${esc(unit)}</i></span></label>`;
		};
		const select = (key, label, opts) =>
			`<label class="rv-field"><span>${esc(label)}</span><select class="rv-input" data-set="${key}">${opts.map(([v, l]) => option(v, l, String(s[key]) === String(v))).join("")}</select></label>`;
		// the little page between the four fields draws them: wider margins, a smaller body
		const box_preview = (b) => SIDES.map((side) => `--m-${side}:${Math.min(38, Number(b[side]) * 1.6)}%`).join(";");
		// four margins as Word draws them: top and bottom, the two sides, a page between
		const box = (key, label) => {
			const v = s[key];
			const field = (side, title) =>
				`<label class="rv-box4-${side}" title="${esc(title)}"><input type="number" class="rv-input" data-box="${key}" data-side="${side}" min="${BOX_MM.min}" max="${BOX_MM.max}" step="0.5" value="${v[side]}" aria-label="${esc(`${label}: ${title}`)}"></label>`;
			return `<div class="rv-field"><span>${esc(label)} <i class="rv-unit">(${esc(mm)})</i><button type="button" class="rv-link" data-box-all="${key}" title="${esc(__("Use the top value on every side"))}">${esc(__("Same on all sides"))}</button></span>
				<div class="rv-box4" data-preview="${key}">${field("top", __("Top", null, "Report View"))}${field("start", __("Start", null, "Report View"))}<span class="rv-box4-page" aria-hidden="true" style="${box_preview(v)}"><i></i></span>${field("end", __("End", null, "Report View"))}${field("bottom", __("Bottom", null, "Report View"))}</div></div>`;
		};
		const rule = (key, label) =>
			`<div class="rv-field rv-rule-field"><span>${esc(label)}</span><div class="rv-rule-ctl">
				<span class="rv-num"><input type="number" class="rv-input" data-num="${key}_w" min="0" max="6" step="0.2" value="${s[`${key}_w`]}" aria-label="${esc(__("Thickness"))}"><i>px</i></span>
				<select class="rv-input" data-set="${key}_s" aria-label="${esc(__("Line style"))}">${[
					["solid", __("Solid")],
					["dashed", __("Dashed")],
					["dotted", __("Dotted")],
					["double", __("Double")],
				]
					.map(([v, l]) => option(v, l, s[`${key}_s`] === v))
					.join("")}</select>
				<input type="color" data-color="${key}_c" value="${s[`${key}_c`]}" aria-label="${esc(__("Colour"))}" title="${esc(__("Colour"))}"></div></div>`;
		const section = (id, icon, title, summary, body, extra = "") =>
			`<details class="rv-psec" data-sec="${id}" ${this.open_secs.has(id) ? "open" : ""}><summary><span class="ic">${icon}</span><span class="tx"><span class="tt">${esc(title)}</span>${summary ? `<span class="sm">${esc(summary)}</span>` : ""}</span>${extra}</summary><div class="rv-psec-bd">${body}</div></details>`;
		const align3 = [["start", __("Start", null, "Report View")], ["center", __("Centre")], ["end", __("End", null, "Report View")]];
		const pm = s.page_m;
		const columns = model ? [...model.pinned, ...model.data] : [];
		const hidden = new Set(s.hidden);
		const no_lh = `<p class="rv-zone-empty">${esc(__("Choose a letter head in «Template and language» to set its size, place and pages."))}</p>`;
		const pos_label = {
			"bottom-end": __("Bottom, at the end"),
			"bottom-center": __("Bottom, centred"),
			"bottom-start": __("Bottom, at the start"),
			"top-end": __("Top, at the end"),
			"top-center": __("Top, centred"),
			"top-start": __("Top, at the start"),
		};
		const ic = (d) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
		const I = {
			paper: ic('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>'),
			tpl: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>'),
			head: ic('<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M4 8h16"/>'),
			heading: ic('<path d="M6 4v16M18 4v16M6 12h12"/>'),
			sign: ic('<path d="M3 17c3-1 4-8 6-8s1 7 3 7 2-4 4-4 1 3 5 3"/><path d="M3 21h18"/>'),
			foot: ic('<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M4 16h16"/>'),
			num: ic('<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>'),
			wm: ic('<path d="M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z"/>'),
			border: ic('<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="10" height="10" rx="1" stroke-dasharray="2 2"/>'),
			content: ic('<path d="M4 6h16M4 12h16M4 18h10"/>'),
			cols: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>'),
		};
		const paper_sum = `${s.size} · ${s.orientation === "landscape" ? __("Landscape", null, "Report View") : __("Portrait", null, "Report View")} · ${[pm.top, pm.end, pm.bottom, pm.start].join("/")} ${mm}`;
		const tpl_sum = [s.template || PAGE_STYLES.find((x) => x.id === s.style)?.label(), s.lang ? o.languages.find((l) => l.name === s.lang)?.label : ""].filter(Boolean).join(" · ");
		const scope_label = { all: __("Every page"), first: __("First page"), rest: __("All but the first"), last: __("Last page") };
		// four choices do not fit one line: two by two
		const scopes = (key, list) => seg(key, __("Apply to"), list.map((v) => [v, scope_label[v]])).replace("rv-print-seg", `rv-print-seg${list.length > 3 ? " grid2" : ""}`);
		const lh_sum = s.letter_head ? `${s.letter_head} · ${scope_label[s.lh_pages]}` : __("None", null, "Report View");
		const sig_sum = s.signatures ? `${s.signature ? __(s.signature) : __("Standard boxes")} · ${scope_label[s.sig_pages]}` : __("None", null, "Report View");
		const hdg_sum = s.heading ? `${__(s.heading)} · ${scope_label[s.heading_pages]}` : __("None", null, "Report View");
		const headings = o.print_headings || [];
		// a record of the site: a Link field (Frappe's search, with the user's permissions)
		const link = (key, label) => `<div class="rv-field"><span>${esc(label)}</span><div class="rv-linkf" data-link="${key}" data-label="${esc(label)}"></div></div>`;
		// the letter head is known once loaded: one without a footer says so
		const no_footer = Boolean(s.letter_head && this.letterhead_name === s.letter_head && !this.letterhead?.footer);
		this.panel_no_footer = no_footer;
		const foot_sum = no_footer ? __("Not in this letter head") : !s.letter_head || !s.foot_height ? __("None", null, "Report View") : scope_label[s.foot_pages];
		const num_sum = s.page_numbers ? pos_label[s.number_pos] : __("Hidden");
		const pb_sum = s.pb_on ? `${s.pb_w} px · ${{ solid: __("Solid"), dashed: __("Dashed"), dotted: __("Dotted"), double: __("Double") }[s.pb_s]}` : __("None", null, "Report View");
		const wm_sum = s.wm_type === "text" ? s.wm_text || __("Text", null, "Report View") : s.wm_type === "image" ? __("Image", null, "Report View") : __("None", null, "Report View");

		this.bd.innerHTML = [
			section(
				"paper",
				I.paper,
				__("Paper and margins"),
				paper_sum,
				`<div class="rv-print-row rv-paper-row">${select("size", __("Paper size"), Object.keys(PAGE_SIZES).map((k) => [k, k]))}
					<div class="rv-field"><span>${esc(__("Orientation"))}</span><div class="rv-seg rv-print-seg rv-orient-seg" role="group" aria-label="${esc(__("Orientation"))}">
						<button type="button" data-orient="portrait" class="${s.orientation === "portrait" ? "on" : ""}" aria-pressed="${s.orientation === "portrait"}" title="${esc(__("Portrait", null, "Report View"))}"><i class="pg p"></i><span>${esc(__("Portrait", null, "Report View"))}</span></button>
						<button type="button" data-orient="landscape" class="${s.orientation === "landscape" ? "on" : ""}" aria-pressed="${s.orientation === "landscape"}" title="${esc(__("Landscape", null, "Report View"))}"><i class="pg l"></i><span>${esc(__("Landscape", null, "Report View"))}</span></button>
					</div></div></div>
				${seg("margins", __("Margins"), [["narrow", __("Narrow")], ["normal", __("Normal", null, "Report View")], ["wide", __("Wide")], ["custom", __("Custom", null, "Report View")]])}
				${box("page_m", __("Page margins"))}`
			),
			section(
				"tpl",
				I.tpl,
				__("Template and language"),
				tpl_sum,
				`${link("template", __("Print template"))}
				${select("style", __("Print style"), PAGE_STYLES.map((st) => [st.id, st.label()]))}
				${link("letter_head", __("Letter Head", null, "Report View"))}
				${link("heading", __("Print Heading", null, "Report View"))}
				${link("lang", __("Language", null, "Report View"))}`
			),
			section(
				"head",
				I.head,
				__("Letter Head", null, "Report View"),
				lh_sum,
				s.letter_head
					? `${scopes("lh_pages", PAGE_SCOPES)}
					<div class="rv-print-row">${num("lh_height", __("Height", null, "Report View"), mm)}${seg("lh_fit", __("Shape"), [["contain", __("As designed")], ["wide", __("Page width")]])}</div>
					${seg("lh_align", __("Alignment"), align3)}
					${box("lh_m", __("Letter head margins"))}
					${rule("head_line", __("Rule under the letter head"))}`
					: no_lh
			),
			section(
				"heading",
				I.heading,
				__("Print Heading", null, "Report View"),
				hdg_sum,
				s.heading
					? `${scopes("heading_pages", PAGE_SCOPES)}
					${sw("heading_replace", __("Instead of the report title"))}
					<div class="rv-print-row">${num("heading_size", __("Font size"), "pt")}</div>
					${seg("heading_align", __("Alignment"), align3)}
					${box("heading_m", __("Heading margins"))}
					${rule("heading_line", __("Rule under the heading"))}
					<p class="rv-zone-empty">${esc(__("The heading is rendered with the report's name and its filters (Jinja: {{ title }}, {{ filters.company.value }}, {{ doc.from_date }})."))}</p>`
					: `<p class="rv-zone-empty">${esc(
							headings.length ? __("Choose a print heading in «Template and language» to set its pages, size and place.") : __("No print heading yet: add one in Print Heading.")
					  )}</p>`
			),
			section(
				"foot",
				I.foot,
				__("Footer", null, "Report View"),
				foot_sum,
				s.letter_head
					? `${no_footer ? `<p class="rv-zone-empty warn">${esc(__("The letter head «{0}» has no footer. Write one in its Footer field (Letter Head), or choose another letter head.", [s.letter_head]))}</p>` : ""}${scopes("foot_pages", FOOT_SCOPES)}
					<div class="rv-print-row">${num("foot_height", __("Height", null, "Report View"), mm)}</div>
					${seg("foot_align", __("Alignment"), align3)}
					${box("foot_m", __("Footer margins"))}
					${rule("foot_line", __("Rule above the footer"))}`
					: no_lh
			),
			section(
				"num",
				I.num,
				__("Page numbers"),
				num_sum,
				`${sw("page_numbers", __("Show page numbers"))}
				${
					s.page_numbers
						? `${select("number_pos", __("Page number position"), Object.entries(pos_label))}
					<div class="rv-print-row">${select("number_format", __("Number format"), [["full", __("Page 1 of 3")], ["short", "1 / 3"], ["dash", "— 1 —"], ["number", "1"]])}${num("number_start", __("Start at"), "")}</div>
					<div class="rv-print-row">${num("number_size", __("Font size"), "pt")}<div class="rv-field rv-sw-field">${sw("number_caption", __("Report name beside it"))}</div></div>
					${box("num_m", __("Space around the number"))}
					${rule("num_line", __("Rule of the number band"))}`
						: ""
				}`
			),
			section(
				"sign",
				I.sign,
				__("Signatures"),
				sig_sum,
				`${sw("signatures", __("Print signatures"))}
				${
					s.signatures
						? `${link("signature", __("Signature", null, "Report View"))}
					${scopes("sig_pages", FOOT_SCOPES)}
					${
						s.sig_pages === "last"
							? seg("sig_pos", __("Place", null, "Report View"), [["after", __("After the table")], ["bottom", __("Bottom of the page")]])
							: `<p class="rv-zone-empty">${esc(__("On these pages the signature stands at the bottom, above the footer."))}</p>`
					}
					<div class="rv-print-row">${num("sig_size", __("Font size"), "pt")}</div>
					${box("sig_m", __("Signature margins"))}`
						: ""
				}`
			),
			section(
				"border",
				I.border,
				__("Page border"),
				pb_sum,
				`${sw("pb_on", __("Border round the page"))}
				${
					s.pb_on
						? `<div class="rv-print-row">${num("pb_w", __("Thickness"), "px")}<label class="rv-field"><span>${esc(__("Line style"))}</span><select class="rv-input" data-set="pb_s">${[
								["solid", __("Solid")],
								["dashed", __("Dashed")],
								["dotted", __("Dotted")],
								["double", __("Double")],
						  ]
								.map(([v, l]) => option(v, l, s.pb_s === v))
								.join("")}</select></label></div>
					<div class="rv-print-row">${num("pb_offset", __("From the edge of the paper"), mm)}${num("pb_radius", __("Rounded corners"), mm)}</div>
					<div class="rv-print-row"><label class="rv-field"><span>${esc(__("Colour"))}</span><input type="color" class="rv-color-wide" data-color="pb_c" value="${s.pb_c}"></label></div>
					${scopes("pb_pages", PAGE_SCOPES)}`
						: ""
				}`
			),
			section(
				"wm",
				I.wm,
				__("Watermark"),
				wm_sum,
				`${seg("wm_type", __("Watermark"), [["none", __("None", null, "Report View")], ["text", __("Text", null, "Report View")], ["image", __("Image", null, "Report View")]])}
				${
					s.wm_type === "text"
						? `<label class="rv-field"><span>${esc(__("Text", null, "Report View"))}</span><input type="text" class="rv-input" data-text="wm_text" maxlength="120" value="${esc(s.wm_text)}" placeholder="${esc(__("e.g. DRAFT, CONFIDENTIAL"))}"></label>
						<div class="rv-print-row">${num("wm_size", __("Font size"), "pt")}<label class="rv-field"><span>${esc(__("Colour"))}</span><input type="color" class="rv-color-wide" data-color="wm_color" value="${s.wm_color}"></label></div>`
						: ""
				}
				${
					s.wm_type === "image"
						? `<div class="rv-field"><span>${esc(__("Image", null, "Report View"))}</span><div class="rv-wm-img">${
								s.wm_image ? `<img src="${esc(s.wm_image)}" alt="">` : `<span class="rv-zone-empty">${esc(__("No image yet"))}</span>`
						  }<button type="button" class="rv-btn sm" data-action="wm-upload">${esc(__("Choose an image"))}</button></div>
						<input type="text" class="rv-input" data-text="wm_image" value="${esc(s.wm_image)}" placeholder="/files/logo.png" aria-label="${esc(__("Image address"))}"></div>
						${num("wm_scale", __("Width of the page"), "%")}`
						: ""
				}
				${
					s.wm_type !== "none"
						? `<div class="rv-print-row">${num("wm_opacity", __("Opacity"), "%")}${num("wm_angle", __("Angle"), "°")}</div>
						${scopes("wm_pages", PAGE_SCOPES)}`
						: ""
				}`
			),
			this.doc_mode
				? ""
				: section(
				"content",
				I.content,
				__("Content", null, "Report View"),
				"",
				`<div class="rv-setlist tall">${check("include_filters", __("Applied filters"))}${model?.hierarchical ? check("include_subtotals", __("Group subtotals")) : ""}${check(
					"include_total",
					__("Grand Total")
				)}${check("printed_on", __("Print date and user"))}</div>`
			),
			s.template || this.doc_mode
				? ""
				: section(
						"cols",
						I.cols,
						__("Printed columns"),
						hidden.size ? __("{0} hidden", [hidden.size]) : "",
						`<div class="rv-setlist tall"><label class="rv-setitem"><span class="rv-check"><input type="checkbox" checked disabled><span>${esc(model?.label_title || "")}</span></span></label>${columns
							.map(
								(d) =>
									`<label class="rv-setitem"><span class="rv-check"><input type="checkbox" data-col="${esc(d.column.key)}" ${hidden.has(d.column.key) ? "" : "checked"}><span>${esc(d.title)}</span></span></label>`
							)
							.join("")}</div>`
				  ),
			`<p class="rv-zone-empty">${esc(__("The pages show the table as it is: the same filters, grouping and folded groups."))}</p>`,
		].join("");
		this.bd.scrollTop = scroll;
		this.bind_panel();
	}

	/**
	 * The record fields of the panel (print format, letter head, print heading, signature,
	 * language): Frappe's Autocomplete over the lists the server read with the user's
	 * permissions (frappe.get_list, in get_print_options / get_doc_print_options). The list
	 * opens at once and filters as one types, with no request; a value not in it is dropped,
	 * and the server checks every choice again when it renders it. Empty is the standard choice.
	 */
	link_defs() {
		const o = this.options || {};
		const items = (names, label = (n) => n) => (names || []).map((n) => ({ value: n, label: label(n) }));
		return {
			template: {
				placeholder: this.doc_mode ? o.default_print_format || __("Standard") : __("Report View (standard)"),
				items: items(o.print_formats),
			},
			letter_head: { placeholder: __("No letter head"), items: items((o.letter_heads || []).map((lh) => lh.name)) },
			heading: { placeholder: __("No print heading"), items: items(o.print_headings, (n) => __(n)) },
			signature: {
				placeholder: __("Report View (standard)"),
				items: (o.print_signatures || []).map((x) => ({ value: x.name, label: __(x.name), description: __(x.content_type) })),
			},
			lang: {
				placeholder: __("Session language ({0})", [o.lang || frappe.boot.lang]),
				items: (o.languages || []).map((l) => ({ value: l.name, label: l.label, description: l.name })),
			},
		};
	}

	mount_links() {
		if (!frappe.ui?.form?.make_control) return;
		const defs = this.link_defs();
		for (const el of this.bd.querySelectorAll("[data-link]")) {
			const key = el.dataset.link;
			const def = defs[key];
			const f = frappe.ui.form.make_control({
				df: {
					fieldtype: "Autocomplete",
					fieldname: `rv_print_${key}`,
					options: def.items,
					placeholder: def.placeholder,
					onchange: () => {
						const v = f.get_value() || "";
						if (v !== (this.settings[key] || "")) this.update({ [key]: v });
					},
				},
				parent: el,
				only_input: true,
			});
			f.refresh();
			if (!f.$input) f.make_input();
			f.$input.attr("aria-label", el.dataset.label);
			f.$input.on("awesomplete-open input focus", () => requestAnimationFrame(() => this.place_dropdown(f.$input.get(0))));
			f.$input.attr("placeholder", def.placeholder);
			f.set_input(this.settings[key] || "");
		}
	}

	/**
	 * The list of a Link field stands over the page (fixed), under the field or above it
	 * when the room below is short: the panel and its sections would cut it.
	 */
	place_dropdown(input) {
		const ul = input?.parentElement?.querySelector(":scope > ul");
		if (!ul || ul.hidden) return;
		const r = input.getBoundingClientRect();
		const below = window.innerHeight - r.bottom - 8;
		const above = r.top - 8;
		const up = below < 220 && above > below;
		Object.assign(ul.style, {
			position: "fixed",
			left: `${r.left}px`,
			width: `${r.width}px`,
			// Frappe gives the list min-width:100%, which, fixed, is the whole window
			minWidth: "0",
			right: "auto",
			top: up ? "auto" : `${r.bottom + 4}px`,
			bottom: up ? `${window.innerHeight - r.top + 4}px` : "auto",
			maxHeight: `${Math.max(120, Math.min(320, (up ? above : below) - 4))}px`,
			overflowY: "auto",
			zIndex: "1050",
			margin: "0",
		});
	}

	bind_panel() {
		const bd = this.bd;
		this.mount_links();
		for (const d of bd.querySelectorAll("details[data-sec]")) {
			d.addEventListener("toggle", () => (d.open ? this.open_secs.add(d.dataset.sec) : this.open_secs.delete(d.dataset.sec)));
		}
		for (const sel of bd.querySelectorAll("select[data-set]")) {
			sel.addEventListener("change", () => this.update({ [sel.dataset.set]: sel.value }));
		}
		for (const b of bd.querySelectorAll("[data-orient]")) b.addEventListener("click", () => this.update({ orientation: b.dataset.orient }));
		for (const b of bd.querySelectorAll("[data-sw]")) b.addEventListener("click", () => this.update({ [b.dataset.sw]: !this.settings[b.dataset.sw] }));
		for (const b of bd.querySelectorAll("[data-seg]")) {
			b.addEventListener("click", () => {
				const key = b.dataset.seg;
				const value = b.dataset.value;
				// a margin preset writes the four page margins
				if (key === "margins" && value !== "custom") this.update({ margins: value, page_m: preset_margins(value) });
				else this.update({ [key]: value });
			});
		}
		for (const c of bd.querySelectorAll("input[data-set]")) c.addEventListener("change", () => this.update({ [c.dataset.set]: c.checked }));
		for (const c of bd.querySelectorAll("input[data-col]")) {
			c.addEventListener("change", () => {
				const key = c.dataset.col;
				const next = this.settings.hidden.filter((k) => k !== key);
				if (!c.checked) next.push(key);
				this.update({ hidden: next });
			});
		}
		// typed values: the page follows while typing (no new panel, the focus stays)
		const typed = (patch) => this.update(patch, { panel: false, wait: 350 });
		for (const i of bd.querySelectorAll("input[data-num]")) {
			i.addEventListener("input", () => {
				const v = clamp(i.value, NUMS[i.dataset.num]);
				if (v !== null && i.value !== "") typed({ [i.dataset.num]: v });
			});
			i.addEventListener("change", () => {
				const v = clamp(i.value, NUMS[i.dataset.num]) ?? this.settings[i.dataset.num];
				i.value = v;
				this.update({ [i.dataset.num]: v });
			});
		}
		for (const i of bd.querySelectorAll("input[data-box]")) {
			const key = i.dataset.box;
			i.addEventListener("input", () => {
				const v = clamp(i.value, [BOX_MM.min, BOX_MM.max, 0.5]);
				if (v === null || i.value === "") return;
				typed({ [key]: { ...this.settings[key], [i.dataset.side]: v }, ...(key === "page_m" ? { margins: "custom" } : {}) });
				const page = bd.querySelector(`[data-preview="${key}"] .rv-box4-page`);
				if (page) page.style.setProperty(`--m-${i.dataset.side}`, `${Math.min(38, v * 1.6)}%`);
			});
			i.addEventListener("change", () => {
				const v = clamp(i.value, [BOX_MM.min, BOX_MM.max, 0.5]) ?? this.settings[key][i.dataset.side];
				i.value = v;
				this.update({ [key]: { ...this.settings[key], [i.dataset.side]: v }, ...(key === "page_m" ? { margins: "custom" } : {}) });
			});
		}
		for (const b of bd.querySelectorAll("[data-box-all]")) {
			b.addEventListener("click", () => {
				const key = b.dataset.boxAll;
				const v = this.settings[key].top;
				this.update({ [key]: { top: v, bottom: v, start: v, end: v }, ...(key === "page_m" ? { margins: "custom" } : {}) });
			});
		}
		for (const i of bd.querySelectorAll("input[data-text]")) {
			i.addEventListener("input", () => {
				const key = i.dataset.text;
				if (key === "wm_image" && i.value && !/^(\/|https?:\/\/)/.test(i.value)) return;
				typed({ [key]: i.value });
			});
		}
		for (const c of bd.querySelectorAll("input[data-color]")) {
			const key = c.dataset.color;
			c.addEventListener("input", () => this.apply_vars({ ...this.settings, [key]: c.value }));
			c.addEventListener("change", () => this.update({ [key]: c.value }));
		}
		bd.querySelector('[data-action="wm-upload"]')?.addEventListener("click", () => this.pick_watermark());
	}

	// An image for the watermark: Frappe's file uploader (an image of the site's files).
	pick_watermark() {
		if (!frappe.ui?.FileUploader) return;
		new frappe.ui.FileUploader({
			allow_multiple: false,
			restrictions: { allowed_file_types: ["image/*"] },
			on_success: (file) => {
				if (file?.file_url) this.update({ wm_image: file.file_url });
			},
		});
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
		// The pages on screen stay (dimmed) until the new ones are mounted: no blank stage.
		if (this.observer) this.observer.disconnect();
		this.queue = [];
		this.note("");
		this.sig_fallback = false;
		const s = this.settings;
		const steps = [];
		if (s.lang && s.lang !== frappe.boot.lang && !this.lang_packs.has(s.lang)) steps.push(__("Running the report in the chosen language…"));
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
					this.note(__("The language could not be loaded: {0}", [err_text(e)]), true);
					return null;
				}),
				this.load_letterhead(s.letter_head),
				this.load_format(s.template).then((f) => (f || !s.template || !this.doc_mode ? f : this.load_format(""))),
				this.load_part("heading", s.heading),
				this.load_part("signature", s.signatures ? s.signature : ""),
			]);
		} catch (e) {
			this.note(e.message || String(e), true);
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
		if (lang_entry && lang_entry.report === null && s.lang && s.lang !== frappe.boot.lang) {
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

	/** The sizes, places and rules of the letter head, footer and number, as CSS variables of the pages. */
	apply_vars(s) {
		const set = (k, v) => this.root.style.setProperty(k, v);
		const block = (b) => `${b.top}mm ${b.bottom}mm`;
		const inline = (b) => `${b.start}mm ${b.end}mm`;
		const flex = { start: "flex-start", center: "center", end: "flex-end" };
		set("--pp-lh-h", `${s.lh_height}mm`);
		set("--pp-lhf-h", `${s.foot_height}mm`);
		set("--pp-lh-align", flex[s.lh_align] || "center");
		set("--pp-lhf-align", flex[s.foot_align] || "center");
		for (const k of ["lh", "foot", "num"]) {
			set(`--pp-${k}-mb`, block(s[`${k}_m`]));
			set(`--pp-${k}-mi`, inline(s[`${k}_m`]));
		}
		set("--pp-num-fs", `${s.number_size}pt`);
		set("--pp-hdg-fs", `${s.heading_size}pt`);
		set("--pp-sig-fs", `${s.sig_size}pt`);
		set("--pp-sig-mb", block(s.sig_m));
		set("--pp-sig-mi", inline(s.sig_m));
		set("--pp-hdg-align", s.heading_align);
		set("--pp-hdg-mb", block(s.heading_m));
		set("--pp-hdg-mi", inline(s.heading_m));
		for (const k of ["head_line", "heading_line", "foot_line", "num_line"]) {
			const w = s[`${k}_w`];
			// a double rule needs three pixels to show its two lines
			const width = s[`${k}_s`] === "double" ? Math.max(3, w) : w;
			set(`--pp-${k.replace("_", "-")}`, w ? `${width}px ${s[`${k}_s`]} ${s[`${k}_c`]}` : "0 solid transparent");
		}
		set("--pp-wm-color", s.wm_color);
		set("--pp-wm-size", `${s.wm_size}pt`);
		set("--pp-wm-op", String(s.wm_opacity / 100));
		set("--pp-wm-angle", `${s.wm_angle}deg`);
		set("--pp-wm-w", `${s.wm_scale}%`);
		// a watermark follows its settings on the pages already drawn
		for (const page of this.sheets.querySelectorAll(".rv-page[data-page]")) {
			for (const el of page.querySelectorAll(":scope > .rv-page-wm, :scope > .rv-page-border")) el.remove();
			page.insertAdjacentHTML("beforeend", this.watermark_html(Number(page.dataset.page)));
		}
		set("--pp-pb", `${s.pb_s === "double" ? Math.max(3, s.pb_w) : s.pb_w}px ${s.pb_s} ${s.pb_c}`);
		set("--pp-pb-off", `${s.pb_offset}mm`);
		set("--pp-pb-r", `${s.pb_radius}mm`);
	}

	/** The watermark of a page: a text or an image over the page, never in the way of a click. */
	watermark_html(i) {
		const s = this.settings;
		const total = this.pages.length || 1;
		const border = s.pb_on && on_page(s.pb_pages, i + 1, total) ? '<div class="rv-page-border" aria-hidden="true"></div>' : "";
		return border + this.mark_html(i);
	}

	mark_html(i) {
		const s = this.settings;
		if (s.wm_type === "none" || !on_page(s.wm_pages, i + 1, this.pages.length || 1)) return "";
		if (s.wm_type === "text" && s.wm_text.trim()) return `<div class="rv-page-wm" aria-hidden="true"><span>${esc(s.wm_text)}</span></div>`;
		if (s.wm_type === "image" && s.wm_image) return `<div class="rv-page-wm" aria-hidden="true"><img src="${esc(s.wm_image)}" alt=""></div>`;
		return "";
	}

	async load_letterhead(name) {
		if (!name) return null;
		const key = this.doc_mode ? `${name}|${this.ctx.report_name}` : `${name}|${this.ctx.company || ""}`;
		if (!this.letterheads.has(key)) {
			try {
				const r = await this.host.pages_letterhead(name);
				this.letterheads.set(key, { header: strip_scripts(r?.header), footer: strip_scripts(r?.footer) });
			} catch (e) {
				this.note(__("The letter head could not be loaded: {0}", [err_text(e)]), true);
				this.letterheads.set(key, null);
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
		const key = `${kind}|${name}|${this.settings.lang || ""}|${JSON.stringify(this.ctx.filters || {})}`;
		if (!this.parts.has(key)) {
			try {
				const r = await this.host.pages_part(kind, name, this.settings.lang || null);
				this.parts.set(key, r ? { ...r, html: strip_scripts(r.html) } : null);
			} catch (e) {
				const msg = kind === "heading" ? __("The print heading could not be loaded: {0}", [err_text(e)]) : __("The signature could not be loaded: {0}", [err_text(e)]);
				this.note(msg, true);
				this.parts.set(key, null);
			}
		}
		return this.parts.get(key);
	}

	async load_format(name) {
		// a document always has a format: "" is its doctype's default
		if (!name && !this.doc_mode) return null;
		// a Jinja format is rendered with the criteria and the language: one per both
		const key = `${name}|${this.settings.lang || ""}|${JSON.stringify(this.ctx.filters || {})}`;
		if (!this.formats.has(key)) {
			try {
				this.formats.set(key, await this.host.pages_format(name, this.settings.lang || null, this.options?.print_format_types?.[name]));
			} catch (e) {
				this.note(__("The print format could not be loaded: {0}", [err_text(e)]), true);
				this.formats.set(key, null);
			}
		}
		return this.formats.get(key);
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
	head_html(first, letterhead, n = 1, total = 1) {
		const s = this.settings;
		const t = (m, a) => this.t(m, a);
		const ctx = this.ctx;
		const company = ctx.company || "";
		const title = t(ctx.report_name);
		const period = this.period_text();
		const lh = this.top_number(n, total) + (letterhead?.header && on_page(s.lh_pages, n, total) ? `<div class="rv-page-lh fit-${s.lh_fit}">${letterhead.header}</div>` : "");
		// the print heading under the letter head; "instead of the title" drops the title
		// block of the first page and the slim line of the others
		const heading = this.heading_html(n, total);
		const replace = heading && s.heading_replace;
		if (!first) {
			const parts = [`<b>${esc(title)}</b>`, company ? esc(company) : "", period].filter(Boolean);
			return `${lh}${heading}${replace ? "" : `<div class="rv-page-cont">${parts.join('<span class="sep">·</span>')}</div>`}`;
		}
		const details = [];
		if (s.printed_on) {
			details.push(esc(t("Printed on {0}", [frappe.datetime.str_to_user(frappe.datetime.now_datetime())])));
			if (frappe.session?.user_fullname) details.push(esc(t("Printed by {0}", [frappe.session.user_fullname])));
		}
		const facts = [];
		if (ctx.group_labels?.length) facts.push(esc(t("Grouped by {0}", [ctx.group_labels.map((l) => this.in_lang(l)).join(" › ")])));
		facts.push(esc(t("{0} rows", [frappe.format(this.current.counts.shown, { fieldtype: "Int" }, { inline: true })])));
		const title_block = replace
			? ""
			: `<div class="rv-page-hd">${company && !letterhead?.header ? `<div class="co">${esc(company)}</div>` : ""}<div class="ti">${esc(title)}</div>${period ? `<div class="pe">${period}</div>` : ""}</div>`;
		let out = `${lh}${heading}${title_block}<div class="rv-page-meta"><span>${details.join('<span class="sep">·</span>')}</span><span>${facts.join('<span class="sep">·</span>')}</span></div>`;
		if (s.include_filters) {
			const text = this.filters_html();
			if (text) out += `<div class="rv-page-filt"><b>${esc(t("Applied filters"))}:</b> ${text}</div>`;
		}
		return out;
	}

	/** The print heading of page `n`, or "" (none chosen, or not on this page). */
	heading_html(n, total) {
		const h = this.heading;
		if (!h || !this.settings.heading || !on_page(this.settings.heading_pages, n, total)) return "";
		return `<div class="rv-page-heading">${h.title ? `<div class="ht">${esc(h.title)}</div>` : ""}${h.html ? `<div class="hd">${h.html}</div>` : ""}</div>`;
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

	/** The block margins of an element (a measured height leaves them out). */
	outer_margins(el) {
		const cs = getComputedStyle(el);
		return (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
	}

	/** The page number as the settings write it, or "" when hidden. */
	number_html(n, total) {
		const s = this.settings;
		if (!s.page_numbers) return "";
		const num = (v) => frappe.format(v, { fieldtype: "Int" }, { inline: true });
		const at = n + s.number_start - 1;
		const last = total + s.number_start - 1;
		const text =
			s.number_format === "number"
				? num(at)
				: s.number_format === "short"
				? `${num(at)} / ${num(last)}`
				: s.number_format === "dash"
				? `— ${num(at)} —`
				: this.t("Page {0} of {1}", [num(at), num(last)]);
		return `<span class="rv-pnum">${esc(text)}</span>`;
	}

	/**
	 * The foot of a page: the letter head's footer and the number band, in the order chosen
	 * (the number under the footer, or above it). The footer prints on every page or the
	 * last; the band carries the number and, beside it, the report's name.
	 */
	foot_html(n, total, letterhead, measure = false) {
		const s = this.settings;
		const ctx = this.ctx;
		const t = (m, a) => this.t(m, a);
		const [where, side] = s.number_pos.split("-");
		const number = where === "bottom" ? this.number_html(n, total) : "";
		const name = s.number_caption ? `<span class="nm">${[esc(t(ctx.report_name)), ctx.company ? esc(ctx.company) : ""].filter(Boolean).join(" · ")}</span>` : "";
		const slots = { start: "", center: "", end: "" };
		if (number) slots[side] = number;
		if (name) {
			if (!slots.start) slots.start = name;
			else if (!slots.end) slots.end = name;
		}
		const band = number || name ? `<div class="rv-page-foot-line${number ? " has-num" : ""}"><span class="st">${slots.start}</span><span class="ce">${slots.center}</span><span class="en">${slots.end}</span></div>` : "";
		// `measure`: the probe page takes the footer wherever it may print (the tallest foot)
		const lhf = letterhead?.footer && s.foot_height && (measure || on_page(s.foot_pages, n, total)) ? `<div class="rv-page-lhf">${letterhead.footer}</div>` : "";
		// a signature on pages other than the last only: above the footer
		const sig = s.signatures && !this.sig_in_tail() && (measure || on_page(this.sig_pages(), n, total)) ? this.signatures_html() : "";
		// the number closes the page: under the footer (whose rule stands above it)
		return sig + lhf + band;
	}

	/** The page number at the top: a band of its own above the head (or nothing). */
	top_number(n, total) {
		const s = this.settings;
		const [where, side] = s.number_pos.split("-");
		return where === "top" && s.page_numbers ? `<div class="rv-page-topnum ${side}">${this.number_html(n, total)}</div>` : "";
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

	/**
	 * The signature block: a Print Signature (its HTML, its CSS nested in .rv-signature,
	 * rendered by the server) or Report View's standard boxes. On the last page only it
	 * closes the content (after the table, or pushed to the bottom of the page); on other
	 * pages it stands in the foot, above the footer (foot_html).
	 */
	signatures_html(bottom = false) {
		if (!this.settings.signatures) return "";
		const own = this.settings.signature && this.signature;
		let inner;
		if (own) inner = `<div class="rv-signature">${own.css ? `<style>${own.css.replace(/<\/style/gi, "")}</style>` : ""}${own.html}</div>`;
		else {
			const t = (m, a) => this.t(m, a);
			const dots = "................................";
			const labels = this.signature_labels();
			inner = `<div class="rv-page-sign" style="grid-template-columns:repeat(${labels.length},minmax(0,1fr))">${labels
				.map((l) => `<div>${esc(this.in_lang(l))}<span>${esc(t("Name", null, "Report View"))}: ${dots}</span><span>${esc(t("Signature", null, "Report View"))}: ${dots}</span></div>`)
				.join("")}</div>`;
		}
		return `<div class="rv-page-sig${bottom ? " at-bottom" : ""}">${inner}</div>`;
	}

	/** Whether the signature closes the content of the last page (else it is in the foot). */
	sig_in_tail() {
		return this.settings.signatures && this.sig_pages() === "last";
	}

	/** The pages of the signature: as chosen, or the last only when repeating it left no room. */
	sig_pages() {
		return this.sig_fallback ? "last" : this.settings.sig_pages;
	}

	/**
	 * A signature repeated in the foot of the pages that leaves less than MIN_ROOM of the page
	 * to the content: it moves to the last page (and the panel says why), rather than a page
	 * for every row with nothing else on it. True when the pages are to be laid out again.
	 */
	sig_leaves_no_room(body_h, box) {
		if (this.sig_fallback || !this.settings.signatures || this.sig_in_tail() || body_h >= box.inner_h * MIN_ROOM) return false;
		this.sig_fallback = true;
		return true;
	}

	page_shell(i, box, dir, inner) {
		const look = `ps-${this.settings.style}${this.settings.template ? " ps-format" : ""}`;
		const p = box.pad;
		return `<section class="rv-page ${look}" dir="${dir}" data-page="${i}" style="width:${box.w}px;height:${box.h}px;padding-block:${p.top}px ${p.bottom}px;padding-inline:${p.start}px ${p.end}px;--pp-m:${box.margin}px">${inner}${this.watermark_html(i)}</section>`;
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
			`<header class="rv-page-top rv-page-top-next">${this.head_html(false, this.letterhead, 2, 3)}</header>`
		) + this.page_shell(
			0,
			box,
			dir,
			`<header class="rv-page-top rv-page-top-first">${this.head_html(true, this.letterhead)}</header>
			<table class="rv-pt" style="width:${box.inner_w}px">${table_head}<tbody>${probe_rows}</tbody></table>
			<div class="rv-page-tail"><table class="rv-pt" style="width:${box.inner_w}px">${table_head.replace(/<thead>.*<\/thead>/s, "")}<tbody>${this.total_rows_html(cols)}</tbody></table>${this.sig_in_tail() ? this.signatures_html() : ""}</div>
			<footer class="rv-page-foot">${this.foot_html(1, 1, this.letterhead, true)}</footer>`
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
		const foot_h = foot_height(q(".rv-page-foot"));
		// the body of a continuation page; the first page gives up the difference of its head
		const body_h = box.inner_h - next_h - thead_h - foot_h - SAFETY_PX;
		if (this.sig_leaves_no_room(body_h, box)) return this.layout_standard(token, box, dir);
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
		if (this.observer) this.observer.disconnect();
		this.filled.clear();
		this.filling.clear();
		this.queue = [];
		const n = this.pages.length;
		const num = (v) => frappe.format(v, { fieldtype: "Int" }, { inline: true });
		this.sheets.innerHTML = this.pages.map((p, i) => this.page_shell(i, box, dir, `<span class="rv-page-ph">${esc(num(i + 1))}</span>`)).join("");
		this.count_el.textContent = __("{0} pages", [num(n)]);
		this.el.classList.toggle("many", n > this.max_pages());
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
		// never while printing: the sheets leave the stage, and every one of them must print
		if (this.printing || this.filled.size <= KEEP_FILLED) return;
		const top = this.stage.scrollTop;
		const h = this.box.h + PAGE_GAP;
		const z = this.zoom_value();
		const at = Math.floor(top / (h * z));
		const far = [...this.filled.keys()].filter((i) => Math.abs(i - at) > NEAR_PAGES + 2).sort((a, b) => Math.abs(b - at) - Math.abs(a - at));
		for (const i of far.slice(0, this.filled.size - KEEP_FILLED)) {
			const el = this.sheets.children[i];
			if (el) el.innerHTML = `<span class="rv-page-ph">${esc(frappe.format(i + 1, { fieldtype: "Int" }, { inline: true }))}</span>${this.watermark_html(i)}`;
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
		// the watermark goes with the content of the page
		el.innerHTML = html + this.watermark_html(i);
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
		if (page.last) {
			tail = `<div class="rv-page-tail"><table class="rv-pt" style="width:${box.inner_w}px">${this.table_head_html.replace(/<thead>.*<\/thead>/s, "")}<tbody>${this.total_rows_html(cols)}</tbody></table></div>`;
			if (this.sig_in_tail()) tail += this.signatures_html(this.settings.sig_pos === "bottom");
		}
		return `<header class="rv-page-top">${this.head_html(page.first, this.letterhead, i + 1, n)}</header>
			<div class="rv-page-body"><table class="rv-pt" style="width:${box.inner_w}px">${this.table_head_html}<tbody>${body}</tbody></table>${tail}</div>
			<footer class="rv-page-foot">${this.foot_html(i + 1, n, this.letterhead)}</footer>`;
	}

	// ------------------------------------------------------------ a report print format

	/**
	 * A report print format (JS, as the query-report dialog offers them) renders the
	 * whole report as one flow with query-report's context; the flow is cut into pages by
	 * measuring its blocks (a table by its rows, its header repeated).
	 */
	async layout_custom(token, box, dir, remeasure = false) {
		if (remeasure) this.flow_cache = null;
		const ctx = this.ctx;
		let html = "";
		try {
			// a Jinja format (and a document's) comes rendered by the server; a JS one reads
			// query-report's context
			if (this.format.type === "Jinja") html = `<style>${this.format.css || ""}</style>${this.format.html}`;
			else {
				const { columns, data, report } = this.query_report_facade();
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
			}
		} catch (e) {
			this.note(__("The print format could not be rendered: {0}", [err_text(e)]), true);
			html = "";
		}
		// The format's own @page rules (paper and margins of a whole-document print) would
		// fight the pages' paper: the pages are the paper here.
		html = strip_scripts(html).replace(/@page\s*\{[^}]*\}/g, "");
		// the signature closes the format's flow, as it closes the standard template
		if (this.sig_in_tail()) html += this.signatures_html();
		// Flow the HTML at the width of the page body and measure its blocks: once for a format,
		// width, language and look. A change of the head, the foot, the signature in the foot or
		// the margins above and below keeps the blocks measured, only the room changes.
		this.custom_styles = "";
		const flow_key = `${box.inner_w}|${dir}|${this.settings.style}|${html}`;
		const known = this.flow_cache?.key === flow_key ? this.flow_cache : null;
		// The pages carry the letter head as the standard template does: in full on the first
		// page, a slim line naming the report on the others (or the letter head on every page).
		this.probe.innerHTML =
			this.page_shell(1, box, dir, `<header class="rv-page-top rv-page-top-next">${this.custom_head(false, 2, 3)}</header>`) +
			this.page_shell(
				0,
				box,
				dir,
				`<header class="rv-page-top rv-page-top-first">${this.custom_head(true)}</header><div class="rv-page-flow">${known ? "" : html}</div><footer class="rv-page-foot">${this.foot_html(1, 1, this.letterhead, true)}</footer>`
			);
		await wait_images(this.probe);
		if (token !== this.token) return;
		const q = (sel) => this.probe.querySelector(sel);
		const h = (el) => (el ? el.getBoundingClientRect().height : 0);
		const first_h = h(q(".rv-page-top-first"));
		const next_h = h(q(".rv-page-top-next"));
		const foot_h = foot_height(q(".rv-page-foot"));
		const body_h = Math.max(40, box.inner_h - next_h - foot_h - SAFETY_PX);
		const first_body_h = Math.max(40, box.inner_h - first_h - foot_h - SAFETY_PX);
		if (this.sig_leaves_no_room(box.inner_h - next_h - foot_h - SAFETY_PX, box)) return this.layout_custom(token, box, dir);
		let units;
		let wide;
		// blocks measured before stand, unless one taller than the new room was kept whole
		if (known && !known.units.some((u) => u.h > body_h && u.node?.children?.length)) {
			({ units, wide } = known);
		} else {
			if (known) return this.layout_custom(token, box, dir, true);
			const flow = q(".rv-page-flow");
			wide = flow.scrollWidth > box.inner_w + 1 || [...flow.querySelectorAll("td, th")].some((c) => c.getBoundingClientRect().width < 1);
			units = this.flow_units(flow, body_h);
			this.flow_cache = { key: flow_key, units, wide };
		}
		if (wide) this.note(__("The print format is wider than the page: try landscape or a larger paper."), true);
		this.custom_styles = units.filter((u) => u.style).map((u) => u.node.outerHTML).join("");
		this.custom_room = body_h;
		const pages = this.pack_units(units.filter((u) => !u.style), first_body_h, body_h);
		this.custom_pages = pages;
		this.pages = pages.map((p, i) => ({ start: 0, end: 0, first: i === 0, last: i === pages.length - 1 }));
		await this.fit_custom_pages(token, box, dir);
		if (token !== this.token) return;
		if (this.foot_overflow) this.note(__("The footer, the page number and the signature are taller than the room under the content: make them smaller or show them on fewer pages."), true);
		this.probe.replaceChildren();
		this.mount_pages(box, dir);
	}

	/**
	 * The blocks of a format packed into pages by their measured places: a page holds from
	 * its first block to its last (a page opening with a table's row repeats the table's
	 * head). A break of the format starts a page (`forced`) at the next block of content: the
	 * signature after the format's last page stays on that page.
	 */
	pack_units(units, first_room, room) {
		const pages = [];
		let page = { units: [], used: 0 };
		const cap = () => (pages.length ? room : first_room);
		let brk = false;
		for (const u of units) {
			if (u.brk) {
				brk = true;
				continue;
			}
			if (brk && !u.sig && page.units.length) {
				pages.push(page);
				page = { units: [], used: 0, forced: true };
			}
			if (!u.sig) brk = false;
			const height = (first) => u.bottom - first.top + (first.table ? first.table.head_h : 0);
			if (page.units.length && height(page.units[0]) > cap()) {
				pages.push(page);
				page = { units: [], used: 0 };
			}
			page.units.push(u);
			page.used = height(page.units[0]);
		}
		if (page.units.length || !pages.length) pages.push(page);
		return pages;
	}

	/**
	 * The pages of a format as they will be drawn, checked in the probe: a run of pages is
	 * drawn at once and the first page whose content reaches its foot is put right alone (its
	 * last blocks move on: the wrappers of a format, its paddings and margins, can take more
	 * than the measured blocks). What that page gave up tells how much the packing over-counts:
	 * the rest of its run is packed again with that much less room, so it is right at once.
	 */
	async fit_custom_pages(token, box, dir) {
		const pages = this.custom_pages;
		const sync = () => (this.pages = pages.map((p, i) => ({ start: 0, end: 0, first: i === 0, last: i === pages.length - 1 })));
		// the format's styles once, beside the pages measured: a <style> put in again for every
		// page would make the browser restyle the whole window each time
		this.probe.innerHTML = `${this.custom_styles}<div></div>`;
		const holder = this.probe.lastElementChild;
		this.foot_overflow = false;
		const measure = (sheet) => {
			const foot = sheet.querySelector(".rv-page-foot").getBoundingClientRect();
			// a foot (footer, number, signature) beyond the paper: the content cannot push it
			// (the body clips), so moving rows would not help; the panel says so
			if (foot.bottom > sheet.getBoundingClientRect().bottom + 1) this.foot_overflow = true;
			// the content ends where the body ends (it clips), which is above the foot by the
			// margin of the foot's first part (a signature's space above it)
			const body = sheet.querySelector(".rv-page-body").getBoundingClientRect();
			const limit = Math.min(foot.top, body.bottom);
			// the probe may stand above the window (the pages scrolled): places can be negative
			let bottom = -Infinity;
			for (const el of sheet.querySelectorAll(".rv-page-body *")) bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
			return { limit, over: bottom > limit + 1, room: limit - body.top };
		};
		const limit = () => Math.min(pages.length, this.max_pages());
		let images = true;
		let from = 0;
		while (from < limit()) {
			if (token !== this.token) return;
			sync();
			const upto = Math.min(limit(), from + FIT_RUN);
			let html = "";
			for (let i = from; i < upto; i++) html += this.page_shell(i, box, dir, this.custom_page_html(i, true));
			holder.innerHTML = html;
			if (images) await wait_images(holder);
			images = false;
			await breathe();
			if (token !== this.token) return;
			let bad = -1;
			for (const [k, sheet] of [...holder.children].entries()) {
				if (measure(sheet).over && pages[from + k].units.length > 1) {
					bad = from + k;
					break;
				}
			}
			if (bad < 0) {
				from = upto;
				continue;
			}
			const moved = await this.fit_page(token, bad, box, dir, holder, measure);
			if (moved === null) return;
			// the rest of the run (to the next break of the format) packed with less room
			if (moved.length) {
				const cut = moved.at(-1).bottom - moved[0].top;
				let end = bad + 1;
				while (end < pages.length && !pages[end].forced) end += 1;
				const rest = pages.slice(bad + 1, end).flatMap((p) => p.units);
				const room = Math.max(40, this.custom_room - cut);
				const packed = this.pack_units(rest, room, room);
				if (pages[bad + 1]?.forced) packed[0].forced = true;
				pages.splice(bad + 1, end - bad - 1, ...packed);
			}
			from = bad + 1;
		}
		sync();
	}

	/** One page put right in the probe; the blocks it gave up, or null when superseded. */
	async fit_page(token, i, box, dir, holder, measure) {
		const pages = this.custom_pages;
		const start = pages[i].units.slice();
		let room = 0;
		for (let guard = 0; guard < 400; guard++) {
			this.pages = pages.map((p, k) => ({ start: 0, end: 0, first: k === 0, last: k === pages.length - 1 }));
			holder.innerHTML = this.page_shell(i, box, dir, this.custom_page_html(i, true));
			await breathe();
			if (token !== this.token) return null;
			const sheet = holder.firstElementChild;
			const m = measure(sheet);
			room = m.room;
			if (!m.over || pages[i].units.length <= 1) break;
			// the blocks that reach the foot (rows, a signature, a section) move on together;
			// else (a wrapper's padding or margin) the last block alone
			let from = pages[i].units.length - 1;
			for (const el of sheet.querySelectorAll("[data-rv-unit]")) {
				if (el.getBoundingClientRect().bottom > m.limit + 1) {
					from = Math.max(1, Math.min(from, Number(el.dataset.rvUnit)));
					break;
				}
			}
			if (!pages[i + 1] || pages[i + 1].forced) pages.splice(i + 1, 0, { units: [], used: 0 });
			pages[i + 1].units.unshift(...pages[i].units.splice(from));
		}
		// A page left with one short block although the packing gave it several: what
		// overflowed was not its content (a measure gone wrong), and moving on would put one
		// block on every page. The page keeps its blocks.
		const kept = pages[i].units;
		if (start.length > 1 && kept.length === 1 && (kept[0].h || 0) < room / 2) {
			pages[i + 1].units.splice(0, start.length - 1);
			if (!pages[i + 1].units.length) pages.splice(i + 1, 1);
			pages[i].units = start;
			return [];
		}
		return start.slice(kept.length);
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
		// where a block stands in the flow, its top margin included: what a page holds is the
		// distance from its first block to its last, with every margin and gap between them
		const span = (el) => {
			const r = el.getBoundingClientRect();
			return { top: r.top - (parseFloat(getComputedStyle(el).marginTop) || 0), bottom: r.bottom };
		};
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
				// Frappe's .page-break: a page of the format (a wrapper of its blocks, or an empty
				// marker); what follows starts a new page
				if (child.classList?.contains("page-break")) {
					if (child.children.length) walk(child, [...path, child.cloneNode(false)]);
					units.push({ brk: true, h: 0, table: null, path });
					continue;
				}
				// the signature closes the content: it follows the last page of the format
				if (child.classList?.contains("rv-page-sig")) {
					units.push({ node: child.cloneNode(true), h: child.getBoundingClientRect().height + this.outer_margins(child), ...span(child), table: null, path, sig: true });
					continue;
				}
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
						for (const tr of body.rows) units.push({ node: tr.cloneNode(true), h: tr.getBoundingClientRect().height, ...span(tr), table, tbody, path });
					}
					if (child.tFoot) {
						const tbody = child.tFoot.cloneNode(false);
						for (const tr of child.tFoot.rows) units.push({ node: tr.cloneNode(true), h: tr.getBoundingClientRect().height, ...span(tr), table, tbody, path });
					}
					continue;
				}
				if (hh > body_h && child.children.length) {
					walk(child, [...path, child.cloneNode(false)]);
					continue;
				}
				units.push({ node: child.cloneNode(true), h: hh, ...span(child), table: null, path });
			}
		};
		walk(container, []);
		return units;
	}

	/** The head of a page of a report print format: the letter head, or a slim line. */
	custom_head(first, n = 1, total = 1) {
		const lh = this.letterhead?.header;
		const heading = this.heading_html(n, total);
		if (lh && on_page(this.settings.lh_pages, n, total)) return `${this.top_number(n, total)}<div class="rv-page-lh fit-${this.settings.lh_fit}">${lh}</div>${heading}`;
		return first ? this.top_number(n, total) + heading : this.head_html(false, null, n, total);
	}

	/** @param {boolean} [mark] measuring: each block carries its place (data-rv-unit); the styles are already in the probe */
	custom_page_html(i, mark = false) {
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
		for (const [k, u] of page.units.entries()) {
			const node = u.node.cloneNode(true);
			if (mark && node.nodeType === 1) node.setAttribute("data-rv-unit", k);
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
				tbody.appendChild(node);
			} else {
				table = null;
				parent.appendChild(node);
			}
		}
		return `<header class="rv-page-top">${this.custom_head(i === 0, i + 1, n)}</header>${mark ? "" : this.custom_styles}<div class="rv-page-body">${flow.outerHTML}</div><footer class="rv-page-foot">${this.foot_html(i + 1, n, this.letterhead)}</footer>`;
	}

	// ------------------------------------------------------------ zoom and position

	zoom_value() {
		const z = this.settings.zoom;
		if (z === "fit") {
			// the sheets' own padding (smaller on a narrow screen), at the zoom it is drawn with
			const pad = parseFloat(getComputedStyle(this.sheets).paddingInlineStart) || STAGE_PAD;
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
		if (this.pages.length > this.max_pages()) {
			frappe.msgprint({
				title: __("Too many pages to print"),
				message: esc(__("{0} pages are more than the browser prints at once ({1}). Narrow the filters, fold groups or export to Excel.", [this.pages.length, this.max_pages()])),
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
		// the sheets leave the stage: its observer would take them for far pages and empty them
		if (this.observer) this.observer.disconnect();
		await this.fill_all();
		const root = document.createElement("div");
		root.className = `rv rv-print-root ${this.root.classList.contains("compact") ? "compact" : ""}`;
		// the variables of the pages (rules, colours, heights, margins, watermark) live on the
		// page's root: the sheets printed apart keep them
		for (const name of this.root.style) if (name.startsWith("--")) root.style.setProperty(name, this.root.style.getPropertyValue(name));
		root.dir = this.sheets.dir;
		root.lang = this.sheets.lang;
		const style = document.createElement("style");
		style.textContent = this.print_css();
		const sheets = this.sheets;
		// the paper's rules last in the document: after any style a format carries
		root.append(sheets, style);
		document.body.appendChild(root);
		this.print_root = root;
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

	/**
	 * The PDF of these pages (ADR-016): the sheets as printed (prepare_print), in a document
	 * of their own with the page's styles and the images inlined, are sent to the server's
	 * engine (Chromium), which prints them as this browser would: the same pages.
	 */
	async pdf() {
		if (!this.pages.length || this.printing) return;
		if (this.pages.length > this.max_pages()) return this.print();
		const target = this.host.pages_pdf_target();
		const button = this.el.querySelector('[data-action="pdf"]');
		const restore = await this.prepare_print();
		if (!restore) return;
		button.disabled = true;
		this.busy(__("Making the PDF…"));
		let html;
		try {
			html = await this.print_document(this.print_root);
		} finally {
			restore();
		}
		const title = `${this.ctx.report_name}`.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 120);
		try {
			const r = await fetch(`/api/method/${target.method}`, {
				method: "POST",
				headers: { "X-Frappe-CSRF-Token": frappe.csrf_token, Accept: "application/pdf, application/json" },
				body: await pdf_body({ ...target.args, title }, html),
			});
			if ((r.headers.get("Content-Type") || "").includes("pdf") && r.ok) return this.save_pdf(await r.blob(), title);
			const j = await r.json().catch(() => ({}));
			// many pages: a background job prints them; its progress, then the file
			if (r.ok && j.message?.job) return await this.wait_pdf_job(j.message.job, j.message.total, title);
			this.pdf_error(j);
		} catch (e) {
			this.pdf_error({ exception: e.message || String(e) });
		} finally {
			button.disabled = false;
			this.busy(null);
		}
	}

	/** Follows a PDF job of the server (ADR-016) until its file is ready, then downloads it. */
	async wait_pdf_job(job, total, title) {
		const num = (v) => frappe.format(v, { fieldtype: "Int" }, { inline: true });
		this.busy(__("Making the PDF: {0} of {1} pages…", [num(0), num(total)]));
		for (;;) {
			await new Promise((r) => setTimeout(r, 1000));
			const st = await frappe.xcall("report_view.api.pdf.pages_pdf_status", { job }, "GET");
			if (st.state === "failed") return this.pdf_error({ exception: st.error });
			if (st.state === "done") break;
			this.busy(__("Making the PDF: {0} of {1} pages…", [num(st.done || 0), num(st.total || total)]));
		}
		const r = await fetch(`/api/method/report_view.api.pdf.pages_pdf_download?${new URLSearchParams({ job })}`, {
			headers: { "X-Frappe-CSRF-Token": frappe.csrf_token },
		});
		if (!r.ok) return this.pdf_error(await r.json().catch(() => ({})));
		this.save_pdf(await r.blob(), title);
	}

	save_pdf(blob, title) {
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `${title}.pdf`;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 30000);
	}

	pdf_error(j) {
		let message = __("The PDF could not be made");
		try {
			const msgs = j?._server_messages ? JSON.parse(j._server_messages).map((m) => JSON.parse(m).message) : [];
			message = msgs.join("<br>") || j?.exception || message;
		} catch {
			// keep the general message
		}
		frappe.msgprint({ title: __("PDF"), message, indicator: "red" });
	}

	/**
	 * The HTML document of the printed sheets for the server's engine (ADR-016). What the
	 * engine reads from the site's public files itself (/assets, /files: from disk) goes as a
	 * link, in the order of the page: the stylesheets, the public images, the fonts. Only
	 * what it may not read is inlined: the page's own <style> blocks and private images (as
	 * data: URIs, once each). The attributes of <html> and <body> go as they are.
	 */
	async print_document(root) {
		const PUBLIC = /^\/(assets|files)\//;
		const used = this.css_in_use(root);
		const head = [];
		for (const sheet of document.styleSheets) {
			let rules;
			try {
				rules = sheet.cssRules;
			} catch {
				continue;
			}
			if (!rules) continue;
			const base = sheet.href || location.href;
			const text = used(rules);
			if (!text) continue;
			// url() of a stylesheet resolve against its own address
			const fixed = text.replace(/url\((['"]?)(?!data:|https?:|\/)([^'")]+)\1\)/g, (m, q, u) => `url(${q}${new URL(u, base).pathname}${q})`);
			head.push(`<style>${fixed.replace(/<\/style/gi, "<\\/style")}</style>`);
		}
		const clone = root.cloneNode(true);
		const cache = new Map();
		const inline = async (src) => {
			if (!src || src.startsWith("data:")) return src;
			const url = new URL(src, location.href);
			if (url.origin !== location.origin) return src;
			if (PUBLIC.test(url.pathname)) return url.pathname + url.search;
			if (!cache.has(url.href)) {
				cache.set(
					url.href,
					fetch(url.href, { credentials: "same-origin" })
						.then((r) => (r.ok ? r.blob() : Promise.reject()))
						.then(
							(b) =>
								new Promise((resolve) => {
									const fr = new FileReader();
									fr.onload = () => resolve(fr.result);
									fr.onerror = () => resolve(src);
									fr.readAsDataURL(b);
								})
						)
						.catch(() => src)
				);
			}
			return cache.get(url.href);
		};
		// a private image repeated on every page (a letter head) is inlined once, as a CSS
		// variable the pages' images read
		const images = [...clone.querySelectorAll("img")];
		const sources = await Promise.all(images.map((img) => inline(img.getAttribute("src"))));
		const ids = new Map();
		images.forEach((img, i) => {
			const src = sources[i];
			if (!src?.startsWith("data:")) return img.setAttribute("src", src || "");
			if (!ids.has(src)) ids.set(src, `--rv-img-${ids.size}`);
			img.setAttribute("src", "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==");
			img.style.setProperty("content", `var(${ids.get(src)})`);
		});
		if (ids.size) head.push(`<style>:root{${[...ids].map(([src, id]) => `${id}:url("${src}")`).join(";")}}</style>`);
		for (const el of clone.querySelectorAll("script")) el.remove();
		const attrs = (el) => [...el.attributes].map((x) => `${x.name}="${esc(x.value)}"`).join(" ");
		return `<!doctype html><html ${attrs(document.documentElement)}><head><meta charset="utf-8"><base href="${esc(location.origin)}/"><title>${esc(this.ctx.report_name)}</title>${head.join("")}</head><body ${attrs(document.body)}>${clone.outerHTML}</body></html>`;
	}

	/**
	 * The style rules the printed sheets use, as CSS text: a rule is kept when its selector
	 * matches an element of a sample of the sheets (the first, the last and some between),
	 * <html> or <body>; @font-face and anything that cannot be tested are kept, @media and
	 * the like keep what they hold that is used. Desk carries some twelve thousand rules the
	 * pages never use: sent with them, they slow the server's engine down.
	 * @returns {(rules: CSSRuleList) => string}
	 */
	css_in_use(root) {
		const sheets = [...root.querySelectorAll(".rv-page")];
		const pick = new Set([0, 1, sheets.length - 1]);
		for (let k = 1; k < 6; k++) pick.add(Math.floor((sheets.length * k) / 6));
		const sample = document.createElement("div");
		sample.className = root.className;
		for (const i of pick) if (sheets[i]) sample.appendChild(sheets[i].cloneNode(true));
		const wrap = document.createElement("div");
		wrap.className = "rv-print-sheets";
		wrap.append(...sample.childNodes);
		sample.appendChild(wrap);
		const html = document.documentElement;
		const body = document.body;
		// what never matches in a static page, and pseudo-elements (their element is tested)
		const PSEUDO = /::?(before|after|first-letter|first-line|marker|placeholder|selection|backdrop|file-selector-button|-webkit-[\w-]+|-moz-[\w-]+|-ms-[\w-]+)(\([^)]*\))?/gi;
		const DYNAMIC = /:(hover|focus|focus-visible|focus-within|active|visited|target)\b/i;
		const matches = (selector) => {
			if (DYNAMIC.test(selector)) return false;
			const sel = selector.replace(PSEUDO, "").trim() || "*";
			try {
				return Boolean(html.matches(sel) || body.matches(sel) || sample.matches(sel) || sample.querySelector(sel));
			} catch {
				// a selector the browser cannot test here: kept
				return true;
			}
		};
		const keep = (rules) => {
			let out = "";
			for (const rule of rules) {
				if (rule instanceof CSSStyleRule) {
					if (rule.selectorText.split(",").some((part) => matches(part))) out += rule.cssText + "\n";
				} else if (rule instanceof CSSMediaRule || (window.CSSSupportsRule && rule instanceof CSSSupportsRule) || (window.CSSContainerRule && rule instanceof CSSContainerRule) || (window.CSSLayerBlockRule && rule instanceof CSSLayerBlockRule)) {
					const inner = keep(rule.cssRules);
					if (inner) out += `${rule.cssText.slice(0, rule.cssText.indexOf("{"))}{\n${inner}}\n`;
				} else if (window.CSSKeyframesRule && rule instanceof CSSKeyframesRule) {
					// animations do not print
				} else {
					out += rule.cssText + "\n";
				}
			}
			return out;
		};
		return keep;
	}

	print_css() {
		const b = this.box;
		return `@page{size:${b.paper_w_mm}mm ${b.paper_h_mm}mm;margin:0}
@media print{
html,body{width:${b.paper_w_mm}mm!important;min-width:0!important;height:auto!important;margin:0!important;padding:0!important;background:#fff!important;overflow:visible!important}
body>*:not(.rv-print-root){display:none!important}
.rv-print-root{display:block!important;position:static!important;background:transparent!important}
.rv-print-root .rv-print-sheets{display:block!important;padding:0!important;gap:0!important;zoom:1!important}
.rv-print-root .rv-page{box-shadow:none!important;margin:0!important;break-after:page;page-break-after:always;break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.rv-print-root .rv-page *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.rv-print-root .rv-page:last-child{break-after:auto;page-break-after:auto}
}`;
	}
}
