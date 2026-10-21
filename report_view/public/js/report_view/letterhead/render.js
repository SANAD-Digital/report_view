// A layout drawn as the HTML of the letter head (ADR-018, «عقد HTML»), with the company's
// real values instead of Jinja: the structure the server generates, so what the editor and
// the gallery show is what prints. No grid, no flex, no CSS variables, no transform: inline
// styles, absolute positions, mm and pt only (wkhtmltopdf's QtWebKit).
// In the editor (`opts.editor`) every element is also a focusable button of the canvas, and
// a field whose value is empty is drawn as a hint instead of disappearing.
// Pure: tested in node (tests/js/letterhead_render.test.mjs).

import { REF_W, SLOTS, LTR_TOKENS, BOXED, slot_box } from "./model.js";
import { font_stack, font_face_css, print_weights } from "../fonts.js";

export const FONT_INHERIT = ".rvlh[data-rv-lh] *{font-family:inherit}";
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
const lines = (s) => esc(s).replace(/\r?\n/g, "<br>");
const pct = (mm) => `${+((mm / REF_W) * 100).toFixed(3)}%`;
const mm = (v) => `${+(+v).toFixed(2)}mm`;

// Arabic, Hebrew, Syriac, Thaana… : the first strong character decides the direction.
const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const LTR_CHAR = /[A-Za-zÀ-ɏ]/;
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
	return `font-size:${s.size}pt;font-weight:${s.weight};color:${resolve_color(layout, s.color)}${extra}`;
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

function qr_text(el, ctx) {
	return el.props.source === "website" ? field_value(ctx, "website") : el.props.text;
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
			const value = LTR_TOKENS.has(p.token) ? `<bdi dir="ltr">${lines(v)}</bdi>` : lines(v);
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
			if (el.type === "image" && p.fit === "cover") {
				const box = free ? "width:100%;height:100%" : `width:${mm(el.w)};height:${mm(el.h)}`;
				return `<span style="display:inline-block;vertical-align:top;${box};background:url('${esc(src)}') center/cover no-repeat"></span>`;
			}
			return free
				? `<img src="${esc(src)}" alt="" style="max-width:100%;max-height:100%;vertical-align:top">`
				: `<img src="${esc(src)}" alt="" style="max-width:${mm(el.w)};max-height:${mm(el.h)};vertical-align:top">`;
		}
		case "qr": {
			const svg = ctx?.qr?.[qr_text(el, ctx)];
			const box = free ? "width:100%;height:100%" : `width:${mm(el.w)};height:${mm(el.h)}`;
			if (svg) return `<span style="display:inline-block;${box}">${svg}</span>`;
			return opts.editor ? `<span class="rvlb-ph" style="display:inline-block;${box}">QR</span>` : "";
		}
		case "line": {
			const c = resolve_color(layout, el.style.color);
			const width = free ? "100%" : el.w ? mm(el.w) : "100%";
			const t = p.style === "double" ? Math.max(p.thick, 0.8) : p.thick;
			return `<span style="display:inline-block;vertical-align:top;width:${width};height:0;border-top:${mm(t)} ${p.style} ${c}"></span>`;
		}
		case "band": {
			const fill = resolve_color(layout, p.fill);
			if (free) return "";
			return `<span style="display:inline-block;vertical-align:top;width:${el.w ? mm(el.w) : "100%"};height:${mm(el.h)};background:${fill};border-radius:${mm(p.radius)}"></span>`;
		}
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

/** One element inside a slot: it flows under the one before it. */
function slotted(layout, el, ctx, opts) {
	const body = inner(layout, el, ctx, opts, false);
	if (!body && !opts.editor) return "";
	const gap = `margin:0 0 ${mm(el.style.gap)}`;
	const style = el.type === "field" || el.type === "text" || el.type === "page" ? text_style(layout, el, `;${gap}`) : `${gap};line-height:0`;
	const dir = el.type === "text" && el.props.dir !== "auto" ? ` dir="${el.props.dir}"` : "";
	return `<div data-el="${el.id}"${dir}${editor_attrs(el, opts)} style="${style}">${body}</div>`;
}

/** A free element: placed and sized in mm (x and w as percentages of the band). */
function free(layout, el, ctx, opts) {
	const body = inner(layout, el, ctx, opts, true);
	if (!body && el.type !== "band" && !opts.editor) return "";
	let style = `position:absolute;left:${pct(el.x)};top:${mm(el.y)};width:${pct(el.w)}`;
	if (el.type === "band") {
		style += `;height:${mm(el.h)};background:${resolve_color(layout, el.props.fill)};border-radius:${mm(el.props.radius)}`;
	} else if (BOXED.has(el.type)) {
		style += `;height:${mm(el.h)}`;
	} else if (el.type === "line") {
		style += ";line-height:0";
	} else {
		if (el.h) style += `;height:${mm(el.h)};overflow:hidden`;
		style += `;${text_style(layout, el)};text-align:${physical_align(el, ctx)}`;
	}
	const dir = el.type === "text" && el.props.dir !== "auto" ? ` dir="${el.props.dir}"` : el.type === "field" || el.type === "text" ? ` dir="${content_dir(el, ctx)}"` : "";
	return `<div data-el="${el.id}"${dir}${editor_attrs(el, opts)} style="${style}">${body}</div>`;
}

const SLOT_DIR = { right: "rtl", left: "ltr", center: "auto" };
function slot_style(band, slot) {
	const w = band.slots[slot];
	const place = slot === "right" ? "right:0" : slot === "left" ? "left:0" : `left:50%;margin-left:-${+(w / 2).toFixed(2)}%`;
	const align = slot === "center" ? "center" : slot;
	// 1mm inside its edges, as the server writes it: a glyph past the slot is not cut by the band
	return `position:absolute;top:${mm(band.pad_top)};${place};width:${w}%;padding:0 1mm;box-sizing:border-box;text-align:${align}`;
}

/**
 * The HTML of one band (header or footer) of a layout.
 * @param {object} layout clamped layout (model.clamp_layout)
 * @param {"header"|"footer"} name
 * @param {{values:object, logo?:string, qr?:object}} ctx the company's values, its logo, QR SVGs by text
 * @param {{editor?:boolean, selected?:string, page?:[any,any], label?:Function, hint?:Function, comment?:boolean, font_base?:string}} opts
 */
export function render_band(layout, name, ctx = {}, opts = {}) {
	const band = layout[name];
	if (!band.h && !opts.editor) return "";
	const font = font_stack(layout.font);
	let html = opts.comment === false ? "" : `<!-- rv-lh v1 ${name} h=${band.h} -->`;
	// the <style> the server writes (core/letterhead.py font_style): the @font-face of its font
	// (absolute urls under `opts.font_base`) and the font kept on every element of the band
	if (opts.font_base) {
		const used = new Set([400]);
		for (const b of ["header", "footer"]) for (const el of layout[b].elements) used.add(el.style.weight);
		html += `<style>${font_face_css(layout.font, opts.font_base, print_weights(layout.font, used))}${FONT_INHERIT}</style>`;
	}
	html += `<div class="rvlh" data-rv-lh="${name}" data-h="${band.h}" dir="ltr" style="position:relative;width:100%;height:${mm(band.h)};overflow:hidden;box-sizing:border-box;font-family:${font};color:${layout.colors.text};line-height:1.35;-webkit-print-color-adjust:exact;print-color-adjust:exact">`;
	for (const slot of SLOTS) {
		if (!band.slots[slot]) continue;
		const items = band.elements.filter((e) => e.slot === slot).map((e) => slotted(layout, e, ctx, opts)).join("");
		if (!items && !opts.editor) continue;
		html += `<div data-slot="${slot}" dir="${SLOT_DIR[slot]}" style="${slot_style(band, slot)}">${items}</div>`;
	}
	for (const el of band.elements) if (el.slot === null) html += free(layout, el, ctx, opts);
	return `${html}</div>`;
}

/** Both bands. */
export function render_letterhead(layout, ctx, opts = {}) {
	return { header: render_band(layout, "header", ctx, opts), footer: render_band(layout, "footer", ctx, opts) };
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

export { slot_box };
