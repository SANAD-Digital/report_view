// The six styles of the gallery (ADR-018, «ب — الأنماط»). A style is a layout (model.js),
// never HTML: it names company fields (tokens), so render.js draws it with the selected
// company's real values and an empty field disappears instead of showing made-up text.
// The first four live in the three slots; the last two add free elements (a colour shape,
// a framed logo) over them.
// The words of the labels below ("هاتف", "Tel") are part of the printed paper, Arabic in the
// right slot and English in the left one whatever the interface language: data, not UI.

import { clamp_layout, default_layout, DEFAULT_COLORS } from "./model.js";

const field = (token, patch = {}) => ({ type: "field", slot: patch.slot ?? null, ...patch, style: { size: 8, weight: 400, color: "muted", align: "start", gap: 0.6, ...(patch.style || {}) }, props: { token, label: "", hide_empty: true, ...(patch.props || {}) } });
const name_ar = (slot, size = 15, extra = {}) => field("company_name_ar", { slot, ...extra, style: { size, weight: 700, color: "primary", gap: 1.2, ...(extra.style || {}) } });
const name_en = (slot, size = 13, extra = {}) => field("company_name", { slot, ...extra, style: { size, weight: 600, color: "primary", gap: 1.2, ...(extra.style || {}) } });
const logo = (slot, w, h, extra = {}) => ({ type: "logo", slot, w, h, style: { gap: 1.5 }, ...extra });
const line = (patch) => ({ type: "line", slot: null, style: { color: "primary", ...(patch.style || {}) }, ...patch, props: { thick: 0.8, style: "solid", ...(patch.props || {}) } });
const band = (patch) => ({ type: "band", slot: null, ...patch, props: { fill: "primary", radius: 0, ...(patch.props || {}) } });
const page = (slot, format = "both", extra = {}) => ({ type: "page", slot, w: 60, ...extra, style: { size: 7.5, color: "muted", ...(extra.style || {}) }, props: { format } });

const BUILDERS = {
	// كلاسيكي بلغتين: Arabic right, the logo in the middle, English left, a rule under them
	classic: () => ({
		header: {
			h: 35,
			pad_top: 5,
			slots: { right: 36, center: 24, left: 36 },
			elements: [
				name_ar("right", 15),
				field("address_line1", { slot: "right" }),
				field("phone_no", { slot: "right", props: { label: "هاتف:" } }),
				field("tax_id", { slot: "right", props: { label: "الرقم الضريبي:" } }),
				logo("center", 26, 22),
				name_en("left", 13),
				field("email", { slot: "left" }),
				field("website", { slot: "left" }),
				field("registration_details", { slot: "left", props: { label: "CR:" } }),
				line({ x: 0, y: 31.5, w: 180, props: { thick: 0.8 } }),
			],
		},
		footer: {
			h: 14,
			pad_top: 4,
			slots: { right: 40, center: 20, left: 40 },
			elements: [line({ x: 0, y: 1, w: 180, style: { color: "muted" }, props: { thick: 0.2 } }), field("address_line1", { slot: "right", style: { size: 7.5 } }), page("center"), field("website", { slot: "left", style: { size: 7.5 } })],
		},
	}),
	// شريط علوي: a band of the brand colour with the names in white, the contacts under it
	band_top: () => ({
		header: {
			h: 34,
			pad_top: 24,
			slots: { right: 34, center: 30, left: 34 },
			elements: [
				band({ x: 0, y: 0, w: 180, h: 20, props: { radius: 1 } }),
				band({ x: 4, y: 2.5, w: 17, h: 15, props: { fill: "#FFFFFF", radius: 1.5 } }),
				logo(null, 15, 13, { x: 5, y: 3.5 }),
				name_ar(null, 16, { x: 60, y: 3.5, w: 116, style: { color: "#FFFFFF", align: "start" } }),
				name_en(null, 9, { x: 60, y: 11.5, w: 116, style: { color: "#FFFFFF", weight: 500, align: "end" } }),
				field("address_line1", { slot: "right" }),
				field("phone_no", { slot: "center", props: { label: "Tel" } }),
				field("email", { slot: "left" }),
			],
		},
		footer: {
			h: 12,
			pad_top: 4,
			slots: { right: 40, center: 20, left: 40 },
			elements: [band({ x: 0, y: 0, w: 180, h: 1.2 }), field("tax_id", { slot: "right", style: { size: 7.5 }, props: { label: "الرقم الضريبي:" } }), page("center"), field("website", { slot: "left", style: { size: 7.5 } })],
		},
	}),
	// شعار في الوسط: everything centred, a thin double rule under it
	center_logo: () => ({
		header: {
			h: 40,
			pad_top: 3,
			slots: { right: 0, center: 70, left: 0 },
			elements: [logo("center", 24, 17), name_ar("center", 14, { style: { gap: 0.4 } }), name_en("center", 9, { style: { color: "muted", weight: 500, gap: 0.4 } }), field("website", { slot: "center" }), line({ x: 0, y: 37, w: 180, props: { thick: 1.2, style: "double" } })],
		},
		footer: {
			h: 12,
			pad_top: 4,
			slots: { right: 0, center: 70, left: 0 },
			elements: [field("address_line1", { slot: "center", style: { size: 7.5 } }), page("center", "both", { style: { size: 7 } })],
		},
	}),
	// بسيط: the logo beside the names, the contacts in a column, no rules at all
	simple: () => ({
		header: {
			h: 28,
			pad_top: 6,
			slots: { right: 0, center: 0, left: 40 },
			elements: [
				logo(null, 20, 18, { x: 158, y: 5 }),
				name_ar(null, 14, { x: 70, y: 6, w: 84, style: { color: "text", align: "start" } }),
				name_en(null, 8.5, { x: 70, y: 13.5, w: 84, style: { color: "muted", weight: 400, align: "end" } }),
				field("phone_no", { slot: "left" }),
				field("email", { slot: "left" }),
				field("website", { slot: "left" }),
			],
		},
		footer: { h: 10, pad_top: 3, slots: { right: 40, center: 20, left: 40 }, elements: [page("center", "both", { style: { size: 7 } })] },
	}),
	// رسمي: a short gold rule, the name, one line of contacts, a double rule
	formal: () => ({
		header: {
			h: 34,
			pad_top: 7,
			slots: { right: 0, center: 70, left: 0 },
			elements: [
				line({ x: 60, y: 3, w: 60, style: { color: "#B8892E" }, props: { thick: 0.6 } }),
				name_ar("center", 16, { style: { color: "text", gap: 0.6 } }),
				field("address_line1", { slot: "center", style: { gap: 0.3 } }),
				field("phone_no", { slot: "center", style: { gap: 0.3 } }),
				field("email", { slot: "center" }),
				line({ x: 0, y: 30.5, w: 180, style: { color: "text" }, props: { thick: 1, style: "double" } }),
			],
		},
		footer: {
			h: 12,
			pad_top: 4,
			slots: { right: 40, center: 20, left: 40 },
			elements: [line({ x: 0, y: 1, w: 180, style: { color: "text" }, props: { thick: 0.2 } }), field("tax_id", { slot: "right", style: { size: 7.5 }, props: { label: "الرقم الضريبي:" } }), page("center", "ar"), field("website", { slot: "left", style: { size: 7.5 } })],
		},
	}),
	// زاوية لونية: a rounded shape of the brand colour in the left corner holding the logo
	corner: () => ({
		header: {
			h: 34,
			pad_top: 5,
			slots: { right: 56, center: 0, left: 0 },
			elements: [
				band({ x: 0, y: 0, w: 52, h: 24, props: { radius: 10 } }),
				band({ x: 8, y: 4, w: 20, h: 16, props: { fill: "#FFFFFF", radius: 2 } }),
				logo(null, 18, 14, { x: 9, y: 5 }),
				name_ar("right", 15),
				name_en("right", 9, { style: { color: "muted", weight: 500 } }),
				field("address_line1", { slot: "right" }),
				field("phone_no", { slot: "right", props: { label: "هاتف:" } }),
			],
		},
		footer: {
			h: 14,
			pad_top: 5,
			slots: { right: 40, center: 20, left: 40 },
			elements: [band({ x: 0, y: 0, w: 180, h: 2.5, props: { radius: 1 } }), field("email", { slot: "right", style: { size: 7.5 } }), page("center"), field("website", { slot: "left", style: { size: 7.5 } })],
		},
	}),
};

/** The styles in the order of the gallery; `label` is an English msgid (translated by the caller). */
export const PRESETS = Object.freeze([
	{ id: "classic", label: "Classic bilingual" },
	{ id: "band_top", label: "Top colour band" },
	{ id: "center_logo", label: "Centred logo" },
	{ id: "simple", label: "Simple, logo and contacts" },
	{ id: "formal", label: "Formal, double rule" },
	{ id: "corner", label: "Colour corner" },
]);

/**
 * The layout of a style with the colours of the company (the primary one taken from its
 * logo when known). Ids e1…en in order; the result is clamped like any layout.
 */
export function build_preset(id, { colors = {}, font } = {}) {
	const make = BUILDERS[id] || BUILDERS.classic;
	const parts = make();
	const base = default_layout();
	let seq = 0;
	const ids = (list) => list.map((e) => ({ x: 0, y: 0, w: 0, h: 0, ...e, id: `e${++seq}` }));
	return clamp_layout({
		...base,
		font: font || base.font,
		colors: { ...DEFAULT_COLORS, ...colors },
		header: { ...parts.header, elements: ids(parts.header.elements) },
		footer: { ...parts.footer, elements: ids(parts.footer.elements) },
	});
}

/** A page with nothing on it but the three slots. */
export function blank_layout({ colors = {}, font } = {}) {
	const base = default_layout();
	return clamp_layout({ ...base, font: font || base.font, colors: { ...DEFAULT_COLORS, ...colors } });
}

/** The colour a logo suggests, made dark enough to print text on white (or null). */
export function brand_from_rgb(r, g, b) {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	if (max - min < 40) return null; // grey: no brand colour in it
	// darken until the relative luminance is at most 0.16 (over 5:1 on white)
	const lum = (c) => {
		const l = (v) => {
			const s = v / 255;
			return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
		};
		return 0.2126 * l(c[0]) + 0.7152 * l(c[1]) + 0.0722 * l(c[2]);
	};
	let c = [r, g, b];
	for (let i = 0; i < 20 && lum(c) > 0.16; i++) c = c.map((v) => v * 0.9);
	return `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}
