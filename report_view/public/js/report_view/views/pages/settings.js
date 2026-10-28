// The settings of the Pages view (ADR-014, views/pages_view.js): every constant of the pages,
// the user's print settings with their defaults, and their sanitising (a saved or sent value
// checked one by one). Pure: no DOM, no Frappe call (tests/js/pages_settings.test.mjs).

import { MARGINS, PAGE_SIZES, preset_margins } from "../../engine/page_layout.js";
import { font_info } from "../../fonts.js";
import { sanitize_variables } from "../../print_variables.js";

export const PRINT_MAX_PAGES = 600;

// Room kept under the rows of a page (px): what a page drawn at another zoom or font may add.
export const SAFETY_PX = 6;

// Pages around the viewport that carry content, and how many filled pages are kept.
export const NEAR_PAGES = 2;

export const KEEP_FILLED = 16;

export const FILL_PARALLEL = 1;

// Printing fills the pages in runs read from the view at once, a few runs side by side.
export const PRINT_RUN = 20;

export const PRINT_PARALLEL = 3;

// Kept per page view: languages (each a whole run of the report), letter heads, formats and
// headings or signatures (each rendered by the server for one set of filters).
export const KEEP_LANGS = 3;

export const KEEP_LETTERHEADS = 8;

export const KEEP_FORMATS = 4;

export const KEEP_PARTS = 8;

// A PDF job of the server (ADR-016): asked about every second; given up when the server has
// not started it, or has not finished it, within these times.
export const PDF_POLL_MS = 1000;

export const PDF_QUEUE_LIMIT_MIN = 5;

export const PDF_WAIT_LIMIT_MIN = 16;

export const ZOOM_STEPS = [0.4, 0.5, 0.67, 0.8, 1, 1.25, 1.5];

// A tool's menu: its width, the gap under its tool, the least height it is given and the room
// it leaves under it (px; components/popover.js place_near keeps it inside the window).
export const MENU_W = 360;

export const MENU_GAP = 6;

export const MENU_MIN_H = 220;

export const MENU_GAP_BELOW = 4;

// The list of a Link field: above the field when the room under it is less than this, and
// its height between these (px).
export const DROPDOWN_FLIP_UNDER = 220;

export const DROPDOWN_MIN_H = 120;

export const DROPDOWN_MAX_H = 320;

// A phone (rv_pages.css and rv_charts.css use the same width): a tool's menu is a sheet there.
export const MOBILE_QUERY = "(max-width: 900px), (pointer: coarse)";

// How long a print waits for the images of the measured pages (ms).
export const IMAGE_WAIT_MS = 2500;

// A browser whose print() returns before its dialog closes never fires afterprint: the
// sheets are put back after this (ms).
export const AFTERPRINT_FALLBACK_MS = 1000;

// The probe of a report print format gives up a page it cannot put right after so many tries.
export const FIT_GUARD = 400;

// Columns not in the view's order sort after every ordered one (by their own index).
export const UNORDERED = 1e6;

// The grey bars of the panel while its settings load: their widths (% of the panel).
export const SKELETON_BARS = [70, 100, 100, 60, 100, 100, 40, 100, 80];

// The gap between the sheets and the padding round them come from the stylesheet
// (rv_pages.css .rv-print-sheets: smaller on a phone), read by sheet_metrics(); these are
// its desktop values, used only before the styles are there.
export const PAGE_GAP = 24;

export const STAGE_PAD = 28;

// Keys of the report filters the title block already shows (the period and the company).
export const PERIOD_KEYS = new Set(["from_date", "to_date", "fiscal_year", "report_date", "date", "posting_date", "as_on_date", "period_start_date", "period_end_date"]);

export const RTL_LANGS = new Set(["ar", "he", "fa", "ps", "ur"]);

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
	// the font of the pages: a family of the font library (report_view/fonts.json), "" = the template's
	font: "",
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
	// colours: "" is the paper's own (rv_tokens.css, COLOR_TOKENS), else a #rrggbb chosen
	heading_line_c: "",
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
	head_line_c: "",
	head_line_s: "solid",
	foot_line_w: 0.6,
	foot_line_c: "",
	foot_line_s: "solid",
	num_line_w: 0,
	num_line_c: "",
	num_line_s: "solid",
	// a border round the page: thickness (px), style, colour, distance from the paper's edge
	// (mm), rounded corners (mm), on every page or the first
	pb_on: false,
	pb_w: 1.5,
	pb_s: "solid",
	pb_c: "",
	pb_offset: 6,
	pb_radius: 0,
	pb_pages: "all",
	// watermark: none, a text or an image, on every page or the first
	wm_type: "none",
	wm_text: "",
	wm_image: "",
	wm_size: 72,
	wm_scale: 50,
	wm_color: "",
	wm_opacity: 10,
	wm_angle: -30,
	wm_pages: "all",
	hidden: [],
	// the values of a print format's variables (ADR-024): {format: {fieldname: value}}
	variables: {},
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

const LH_HEIGHT = { min: 5, max: 90 };

const FOOT_HEIGHT = { min: 0, max: 60 };

export const BOX_MM = { min: 0, max: 60 };

const NUMBER_POS = ["bottom-end", "bottom-center", "bottom-start", "top-end", "top-center", "top-start"];

const NUMBER_FORMATS = ["full", "short", "number", "dash"];

// Settings drawn over the pages (the watermark, the border round the page): changed on
// the pages already cut, without cutting them again.
// The toolbar above the pages (owner's choice, 2026-10-20): the panel's sections as tools
// in four groups; a tool opens its settings in one menu under it.
export const RIBBON = [
	{ id: "page", label: () => __("Page", null, "Report View"), secs: ["paper"] },
	{ id: "content", label: () => __("Content", null, "Report View"), secs: ["tpl", "vars", "content", "cols"] },
	{ id: "identity", label: () => __("Identity", null, "Report View"), secs: ["head", "heading", "foot", "sign"] },
	{ id: "marks", label: () => __("Marks", null, "Report View"), secs: ["num", "border", "wm"] },
];

// the least share of a page left to the content before a repeated signature moves to the last page
export const MIN_ROOM = 0.25;

// pages of a format drawn at once in the probe to be checked
export const FIT_RUN = 30;

export const PAINT_KEYS = new Set(["pb_on", "pb_w", "pb_s", "pb_c", "pb_offset", "pb_radius", "pb_pages", "wm_type", "wm_text", "wm_image", "wm_size", "wm_scale", "wm_color", "wm_opacity", "wm_angle", "wm_pages"]);

const BOOL_KEYS = ["include_filters", "include_subtotals", "include_total", "signatures", "page_numbers", "printed_on", "number_caption", "pb_on", "heading_replace"];

export const PAGE_SCOPES = ["all", "first", "rest"];

export const FOOT_SCOPES = ["all", "first", "rest", "last"];

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

export const COLOR = /^#[0-9a-fA-F]{6}$/;

// The paper's colour of a colour setting left empty (rv_tokens.css).
export const COLOR_TOKENS = {
	heading_line_c: "--pp-rule",
	head_line_c: "--pp-rule",
	foot_line_c: "--pp-rule",
	num_line_c: "--pp-rule-2",
	pb_c: "--pp-border",
	wm_color: "--pp-mark",
};

// number settings: [min, max, step]
export const NUMS = {
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

export const SIDES = ["top", "bottom", "start", "end"];

// The page's own words, by msgid, for the translation pack of another language.
export const PAGE_MESSAGES = [
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

export const clamp = (v, [min, max, step]) => {
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
	const out = { ...base, hidden: [...(base.hidden || [])], variables: sanitize_variables(base.variables) };
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
	if (raw.font === "" || (typeof raw.font === "string" && font_info(raw.font))) out.font = raw.font;
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
	if (raw.variables && typeof raw.variables === "object") out.variables = sanitize_variables(raw.variables);
	if (Array.isArray(raw.hidden)) out.hidden = raw.hidden.filter((k) => typeof k === "string").slice(0, 500);
	if (raw.zoom === "fit" || (Number.isFinite(raw.zoom) && raw.zoom >= 0.3 && raw.zoom <= 2)) out.zoom = raw.zoom;
	return out;
}
