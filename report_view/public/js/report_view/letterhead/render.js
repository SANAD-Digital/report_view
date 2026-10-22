// A layout drawn as the HTML of the letter head (ADR-018, «عقد HTML»), with the company's
// real values instead of Jinja: the structure the server generates, so what the editor and
// the gallery show is what prints. No grid, no flex, no CSS variables, no transform: inline
// styles, absolute positions, mm and pt only (wkhtmltopdf's QtWebKit).
// In the editor (`opts.editor`) every element is also a focusable button of the canvas, and
// a field whose value is empty is drawn as a hint instead of disappearing.
// Pure: tested in node (tests/js/letterhead_render.test.mjs).

import { REF_W, SLOTS, LTR_TOKENS, MULTILINE_TOKENS, BOXED, TEXTUAL, LIMITS, CONTRACT, band_radius, css_num } from "./model.js";
import { font_stack, font_face_css, print_weights } from "../fonts.js";

export const FONT_INHERIT = ".rvlh[data-rv-lh] *{font-family:inherit}";
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
const lines = (s) => esc(s).replace(/\r?\n/g, "<br>");
// numbers as the server writes them (core/letterhead.py _n, _pct)
const pct = (mm) => `${css_num((mm / REF_W) * 100)}%`;
const mm = (v) => `${css_num(v)}mm`;

// Arabic, Hebrew, Syriac, Thaana… : the first strong character decides the direction
// (the character classes of letterhead_contract.json, as the server tests them).
const RTL_CHAR = new RegExp(`[${CONTRACT.rtl_chars}]`);
const LTR_CHAR = new RegExp(`[${CONTRACT.ltr_chars}]`);
export function is_rtl_text(s) {
	for (const ch of String(s ?? "")) {
		if (RTL_CHAR.test(ch)) return true;
		if (LTR_CHAR.test(ch)) return false;
	}
	return false;
}

/** A colour of the element: one of the three of the layout, or its own #RRGGBB. */
export function resolve_color(layout, c) {
	return layout.colors[c] || (/^#[0-9a-fA-F]{6}$/.test(c) ? c : layout.colors.text);
}

/** The value of a company field, as text ("" when the company has none). */
export function field_value(ctx, token) {
	const v = ctx?.values?.[token];
	return v == null ? "" : String(v).trim();
}

/** The text of the page number: Arabic, English or both, around Frappe's page/topage spans. */
export function page_html(format, nums = null) {
	const p = `<span class="page">${nums ? esc(nums[0]) : ""}</span>`;
	const t = `<span class="topage">${nums ? esc(nums[1]) : ""}</span>`;
	// the words are part of the printed paper in a fixed language, not of the interface
	const ar = `<span dir="rtl">صفحة ${p} من ${t}</span>`;
	const en = `<span dir="ltr">Page ${p} of ${t}</span>`;
	return format === "ar" ? ar : format === "en" ? en : `${en} | ${ar}`;
}

function text_style(layout, el, extra = "") {
	const s = el.style;
	return `font-size:${css_num(s.size)}pt;font-weight:${s.weight};color:${resolve_color(layout, s.color)}${extra}`;
}

/** The direction of an element's own content (for the alignment of a free element). */
function content_dir(el, ctx) {
	if (el.type === "text") return el.props.dir === "auto" ? (is_rtl_text(el.props.text) ? "rtl" : "ltr") : el.props.dir;
	if (el.type === "field") {
		if (LTR_TOKENS.has(el.props.token)) return is_rtl_text(el.props.label) ? "rtl" : "ltr";
		return is_rtl_text(el.props.label || field_value(ctx, el.props.token)) ? "rtl" : "ltr";
	}
	if (el.type === "page") return el.props.format === "en" ? "ltr" : "rtl";
	return "ltr";
}

function physical_align(el, ctx) {
	const a = el.style.align;
	if (a === "center") return "center";
	const rtl = content_dir(el, ctx) === "rtl";
	return (a === "start") === rtl ? "right" : "left";
}

/** The printed order of a page number: Arabic alone reads right to left. */
const page_dir = (el) => (el.props.format === "ar" ? "rtl" : "ltr");

function qr_text(el, ctx) {
	return (el.props.source === "website" ? field_value(ctx, "website") : el.props.text).trim();
}

/** A QR code is square: the smaller side of its box (core/letterhead.py qr_size). */
const qr_size = (el) => (el.w && el.h ? Math.min(el.w, el.h) : el.h || el.w);

/** A double rule needs some thickness to show its two lines (the server prints the same). */
const line_thick = (p) => (p.style === "double" ? Math.max(p.thick, LIMITS.double_line_min) : p.thick);

const band_fill = (layout, p) => `background-color:${resolve_color(layout, p.fill)}${+p.radius ? `;border-radius:${band_radius(p)}` : ""}`;

/** An image within w × h mm, its proportions kept (QtWebKit has no object-fit); cover as a background. */
function img_html(src, el, free, fit = "contain") {
	const width = free ? "100%" : mm(el.w);
	if (fit === "cover")
		return `<div style="display:inline-block;vertical-align:top;width:${width};height:${mm(el.h)};background-image:url('${esc(src)}');background-position:center;background-repeat:no-repeat;-webkit-background-size:cover;background-size:cover"></div>`;
	return `<img src="${esc(src)}" alt="" style="display:inline-block;vertical-align:top;width:auto;height:auto;max-width:${width};max-height:${mm(el.h)}">`;
}

/** The inside of an element: text, a picture, a rule, a box. `free` = sized by its wrapper. */
function inner(layout, el, ctx, opts, free) {
	const p = el.props;
	switch (el.type) {
		case "text":
			return lines(p.text) || (opts.editor ? `<span class="rvlb-hint">${esc(opts.hint?.(el) ?? "")}</span>` : "");
		case "field": {
			const v = field_value(ctx, p.token);
			if (!v) return opts.editor ? `<span class="rvlb-hint">${esc(opts.hint?.(el) ?? "")}</span>` : p.hide_empty ? "" : esc(p.label);
			const text = MULTILINE_TOKENS.has(p.token) ? lines(v) : esc(v);
			const value = LTR_TOKENS.has(p.token) ? `<bdi dir="ltr">${text}</bdi>` : `<bdi>${text}</bdi>`;
			return `${p.label ? `${esc(p.label)} ` : ""}${value}`;
		}
		case "page":
			return page_html(p.format, opts.page);
		case "logo":
		case "image": {
			const raw = el.type === "logo" ? ctx?.logo || "" : p.src;
			// only a public file prints (the PDF engine cannot read a private one)
			const src = /^\/(files|assets)\//.test(raw) ? raw : "";
			if (!src) return opts.editor ? `<span class="rvlb-ph" style="display:inline-block;width:${free ? "100%" : mm(el.w)};height:${free ? "100%" : mm(el.h)}">${esc(opts.hint?.(el) ?? "")}</span>` : "";
			return img_html(src, el, free, el.type === "image" ? p.fit : "contain");
		}
		case "qr": {
			const svg = ctx?.qr?.[qr_text(el, ctx)];
			const box = `display:inline-block;vertical-align:top;width:${mm(qr_size(el))};height:${mm(qr_size(el))}`;
			if (svg) return `<span style="${box}">${svg}</span>`;
			return opts.editor ? `<span class="rvlb-ph" style="${box}">${esc(opts.qr_hint?.(el) ?? "QR")}</span>` : "";
		}
		case "line": {
			const c = resolve_color(layout, el.style.color);
			const width = free || !el.w ? "100%" : mm(el.w);
			return `<div style="display:inline-block;vertical-align:top;width:${width};height:0;border-top:${mm(line_thick(p))} ${p.style} ${c}"></div>`;
		}
		case "band":
			if (free) return "";
			return `<div style="display:inline-block;vertical-align:top;width:${el.w ? mm(el.w) : "100%"};height:${mm(el.h)};${band_fill(layout, p)}"></div>`;
		default:
			return "";
	}
}

function editor_attrs(el, opts) {
	if (!opts.editor) return "";
	const sel = opts.selected === el.id ? " is-selected" : "";
	const label = esc(opts.label?.(el) ?? el.type);
	return ` class="rvlb-el${sel}${el.slot ? "" : " is-free"}" data-type="${el.type}" tabindex="0" role="button" aria-label="${label}" aria-pressed="${opts.selected === el.id}"`;
}

/** The dir attribute of an element (the server writes the same): a text's own direction, a page number's order, a free field's content. */
function dir_attr(el, ctx, free) {
	if (el.type === "text") return ` dir="${free ? content_dir(el, ctx) : el.props.dir}"`;
	if (el.type === "page") return ` dir="${page_dir(el)}"`;
	if (el.type === "field" && free) return ` dir="${content_dir(el, ctx)}"`;
	return "";
}

/** One element inside a slot: it flows under the one before it. */
function slotted(layout, el, ctx, opts) {
	const body = inner(layout, el, ctx, opts, false);
	if (!body && !opts.editor) return "";
	const gap = `margin:0 0 ${mm(el.style.gap)}`;
	const style = TEXTUAL.has(el.type) ? text_style(layout, el, `;${gap}`) : `${gap};line-height:0`;
	return `<div data-el="${el.id}"${dir_attr(el, ctx, false)}${editor_attrs(el, opts)} style="${style}">${body}</div>`;
}

/** A free element: placed and sized in mm (x and w as percentages of the band). */
function free(layout, el, ctx, opts) {
	const body = inner(layout, el, ctx, opts, true);
	if (!body && el.type !== "band" && !opts.editor) return "";
	let style = `position:absolute;left:${pct(el.x)};top:${mm(el.y)};width:${pct(el.w)}`;
	if (el.type === "band") {
		style += `;height:${mm(el.h)};${band_fill(layout, el.props)}`;
	} else if (BOXED.has(el.type)) {
		style += `;height:${mm(el.h)};line-height:0`;
	} else if (el.type === "line") {
		style += ";line-height:0";
	} else {
		if (el.h) style += `;height:${mm(el.h)};overflow:hidden`;
		style += `;${text_style(layout, el)};text-align:${physical_align(el, ctx)}`;
	}
	return `<div data-el="${el.id}"${dir_attr(el, ctx, true)}${editor_attrs(el, opts)} style="${style}">${body}</div>`;
}

const SLOT_DIR = { right: "rtl", left: "ltr", center: "auto" };
function slot_style(band, slot) {
	const w = band.slots[slot];
	const place = slot === "right" ? "right:0" : slot === "left" ? "left:0" : `left:50%;margin-left:-${css_num(w / 2)}%`;
	const align = slot === "center" ? "center" : slot;
	// 1mm inside its edges, as the server writes it: a glyph past the slot is not cut by the band
	return `position:absolute;top:${mm(band.pad_top)};${place};width:${css_num(w)}%;padding:0 1mm;box-sizing:border-box;text-align:${align}`;
}

/**
 * The HTML of one band (header or footer) of a layout.
 * @param {object} layout clamped layout (model.clamp_layout)
 * @param {"header"|"footer"} name
 * @param {{values:object, logo?:string, qr?:object}} ctx the company's values, its logo, QR SVGs by text
 * @param {{editor?:boolean, selected?:string, page?:[any,any], label?:Function, hint?:Function, qr_hint?:Function, comment?:boolean, font_base?:string}} opts
 */
export function render_band(layout, name, ctx = {}, opts = {}) {
	const band = layout[name];
	if (!band.h && !opts.editor) return "";
	const font = font_stack(layout.font);
	const h = css_num(band.h);
	let html = opts.comment === false ? "" : `<!-- rv-lh v1 ${name} h=${h} -->`;
	// the <style> the server writes (core/letterhead.py font_style): the @font-face of its font
	// (absolute urls under `opts.font_base`) and the font kept on every element of the band
	if (opts.font_base) {
		const used = new Set([400]);
		for (const b of ["header", "footer"]) for (const el of layout[b].elements) used.add(el.style.weight);
		html += `<style>${font_face_css(layout.font, opts.font_base, print_weights(layout.font, used))}${FONT_INHERIT}</style>`;
	}
	html += `<div class="rvlh" data-rv-lh="${name}" data-h="${h}" dir="ltr" style="position:relative;width:100%;height:${mm(band.h)};overflow:hidden;box-sizing:border-box;font-family:${font};color:${layout.colors.text};line-height:1.35;-webkit-print-color-adjust:exact;print-color-adjust:exact">`;
	for (const slot of SLOTS) {
		if (!band.slots[slot]) continue;
		const items = band.elements.filter((e) => e.slot === slot).map((e) => slotted(layout, e, ctx, opts)).join("");
		if (!items && !opts.editor) continue;
		html += `<div data-slot="${slot}" dir="${SLOT_DIR[slot]}" style="${slot_style(band, slot)}">${items}</div>`;
	}
	for (const el of band.elements) if (el.slot === null) html += free(layout, el, ctx, opts);
	return `${html}</div>`;
}

/** The tokens a layout shows whose value the company does not have (to say so, not to fake it). */
export function missing_tokens(layout, ctx) {
	const out = new Set();
	for (const b of ["header", "footer"]) for (const el of layout[b].elements) if (el.type === "field" && !field_value(ctx, el.props.token)) out.add(el.props.token);
	return [...out];
}

/** Every QR text a layout needs (for qr_svg). */
export function qr_texts(layout, ctx) {
	const out = new Set();
	for (const b of ["header", "footer"]) for (const el of layout[b].elements) if (el.type === "qr") {
		const t = qr_text(el, ctx);
		if (t) out.add(t);
	}
	return [...out];
}
