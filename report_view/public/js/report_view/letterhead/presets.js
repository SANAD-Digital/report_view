// The styles of the gallery (ADR-018, «ب — الأنماط»; the library of ADR-030). A style is a layout (model.js),
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
			h: 33,
			pad_top: 5,
			slots: { right: 36, center: 24, left: 36 },
			elements: [
				name_ar("right", 15),
				field("address_ar", { slot: "right" }),
				field("cr_no", { slot: "right", props: { label: "س.ت:" } }),
				field("tax_id", { slot: "right", props: { label: "الرقم الضريبي:" } }),
				logo("center", 26, 22),
				name_en("left", 13),
				field("address_line1", { slot: "left" }),
				field("phone_no", { slot: "left", props: { label: "Tel:" } }),
				field("email", { slot: "left" }),
				field("tax_id", { slot: "left", props: { label: "VAT No.:" } }),
				line({ x: 0, y: 30, w: 180, props: { thick: 0.8 } }),
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
				logo(null, 15, 13, { x: 5, y: 3.5 }),
				name_ar(null, 16, { x: 60, y: 3.5, w: 116, style: { color: "#FFFFFF", align: "start" } }),
				name_en(null, 9, { x: 60, y: 11.5, w: 116, style: { color: "#FFFFFF", weight: 500, align: "end" } }),
				field("address_line1", { slot: "right" }),
				field("phone_no", { slot: "center", props: { label: "هاتف / Tel:" } }),
				field("email", { slot: "left" }),
			],
		},
		footer: {
			h: 12,
			pad_top: 4,
			slots: { right: 40, center: 20, left: 40 },
			elements: [band({ x: 0, y: 0, w: 180, h: 1.2 }), field("tax_id", { slot: "right", style: { size: 7.5 }, props: { label: "الرقم الضريبي:" } }), field("cr_no", { slot: "right", style: { size: 7.5 }, props: { label: "س.ت:" } }), page("center"), field("website", { slot: "left", style: { size: 7.5 } })],
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
			h: 18,
			pad_top: 3,
			slots: { right: 0, center: 70, left: 0 },
			elements: [
				field("address_line1", { slot: "center", style: { size: 7.5, gap: 0.3 } }),
				field("tax_id", { slot: "center", style: { size: 7, gap: 0.3 }, props: { label: "الرقم الضريبي / VAT No.:" } }),
				field("cr_no", { slot: "center", style: { size: 7, gap: 0.3 }, props: { label: "س.ت / C.R.:" } }),
				page("center", "both", { style: { size: 7 } }),
			],
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
				line({ x: 60, y: 3, w: 60, style: { color: "primary" }, props: { thick: 0.6 } }),
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
				// the corner of the page: square on the paper's edges, rounded towards the page
				band({ x: 0, y: 0, w: 52, h: 24, props: { radius: 10, corners: "br" } }),
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

	// ---------------------------------------------------------------- the library (2026-11-10)
	// researched from real letterheads of companies, ministries, banks and offices of Yemen,
	// Saudi Arabia and the Gulf; sources in docs/adr/030-letterhead-library.md

	// سجلّ بلغتين: Arabic block right, logo centre, English block left, each with its line of business, C.R. and VAT; a heavy rule over a hairline
	bilingual_registry: () => ({
		header: {
			h: 40,
			pad_top: 4,
			slots: { right: 38, center: 22, left: 38 },
			elements: [
				name_ar("right", 15, { style: { gap: 0.8 } }),
				field("activity_ar", { slot: "right", style: { size: 8.5, weight: 500, color: "text", gap: 1 } }),
				field("cr_no", { slot: "right", style: { size: 7.5, gap: 0.3 }, props: { label: "س.ت:" } }),
				field("unified_no", { slot: "right", style: { size: 7.5, gap: 0.3 }, props: { label: "الرقم الموحد:" } }),
				field("tax_id", { slot: "right", style: { size: 7.5, gap: 0 }, props: { label: "الرقم الضريبي:" } }),
				logo("center", 30, 24),
				name_en("left", 13, { style: { gap: 0.8 } }),
				field("activity_en", { slot: "left", style: { size: 8.5, weight: 500, color: "text", gap: 1 } }),
				field("cr_no", { slot: "left", style: { size: 7.5, gap: 0.3 }, props: { label: "C.R." } }),
				field("unified_no", { slot: "left", style: { size: 7.5, gap: 0.3 }, props: { label: "Unified No." } }),
				field("tax_id", { slot: "left", style: { size: 7.5, gap: 0 }, props: { label: "VAT No." } }),
				line({ x: 0, y: 36, w: 180, props: { thick: 1 } }),
				line({ x: 0, y: 38, w: 180, style: { color: "muted" }, props: { thick: 0.3 } }),
			],
		},
		footer: {
			h: 16,
			pad_top: 3.5,
			slots: { right: 40, center: 20, left: 40 },
			elements: [
				line({ x: 0, y: 0.8, w: 180, style: { color: "muted" }, props: { thick: 0.2 } }),
				field("address_ar", { slot: "right", style: { size: 7.5, gap: 0.3 } }),
				field("po_box", { slot: "right", style: { size: 7.5, gap: 0.3 }, props: { label: "ص.ب:" } }),
				field("phone_no", { slot: "right", style: { size: 7.5, gap: 0 }, props: { label: "هاتف:" } }),
				page("center", "both", { style: { size: 7 } }),
				field("address_line1", { slot: "left", style: { size: 7.5, gap: 0.3 } }),
				field("po_box", { slot: "left", style: { size: 7.5, gap: 0.3 }, props: { label: "P.O. Box" } }),
				field("email", { slot: "left", style: { size: 7.5, gap: 0 } }),
			],
		},
	}),

	// شعار يسار وأسماء يمين: the logo top-left, both names stacked on the right with the line of business, a rule across
	logo_left_names_right: () => ({
		header: {
			h: 34,
			pad_top: 5,
			slots: { right: 62, center: 0, left: 34 },
			elements: [
				logo("left", 40, 22),
				name_ar("right", 16, { style: { gap: 0.4 } }),
				name_en("right", 10, { style: { color: "text", gap: 1.6 } }),
				field("activity_ar", { slot: "right", style: { size: 8.5, gap: 0.3 } }),
				field("activity_en", { slot: "right", style: { size: 8, gap: 0 } }),
				line({ x: 0, y: 31.5, w: 180, props: { thick: 0.4 } }),
			],
		},
		footer: {
			h: 15,
			pad_top: 4,
			slots: { right: 40, center: 20, left: 40 },
			elements: [
				line({ x: 0, y: 0.8, w: 180, props: { thick: 0.6 } }),
				field("address_ar", { slot: "right", style: { size: 7.5, gap: 0.3 } }),
				field("phone_no", { slot: "right", style: { size: 7.5, gap: 0 }, props: { label: "هاتف:" } }),
				page("center", "both", { style: { size: 7 } }),
				field("email", { slot: "left", style: { size: 7.5, gap: 0.3 } }),
				field("website", { slot: "left", style: { size: 7.5, gap: 0 } }),
			],
		},
	}),

	// شريط تذييل: a quiet bilingual header, the contacts in white on a band of the brand colour at the foot of every page
	footer_band_contacts: () => ({
		header: {
			h: 32,
			pad_top: 3,
			slots: { right: 37, center: 22, left: 37 },
			elements: [
				name_ar("right", 15, { style: { gap: 0.6 } }),
				field("activity_ar", { slot: "right", style: { size: 8.5, weight: 500, color: "text", gap: 0.3 } }),
				field("address_ar", { slot: "right", style: { size: 7.5, gap: 0 } }),
				logo("center", 28, 22),
				name_en("left", 12.5, { style: { gap: 0.8 } }),
				field("activity_en", { slot: "left", style: { size: 8.5, weight: 500, color: "text", gap: 0.3 } }),
				field("address_line1", { slot: "left", style: { size: 7.5, gap: 0 } }),
				line({ x: 80, y: 28.5, w: 20, props: { thick: 1.2 } }),
			],
		},
		footer: {
			h: 18,
			pad_top: 1,
			slots: { right: 0, center: 40, left: 0 },
			elements: [
				page("center", "both", { style: { size: 7 } }),
				band({ x: 0, y: 7, w: 180, h: 10, props: { radius: 1.5 } }),
				field("phone_no", { x: 122, y: 10.2, w: 56, style: { size: 7.5, weight: 500, color: "#FFFFFF" }, props: { label: "هاتف:" } }),
				field("email", { x: 62, y: 10.2, w: 56, style: { size: 7.5, weight: 500, color: "#FFFFFF", align: "center" } }),
				field("website", { x: 2, y: 10.2, w: 56, style: { size: 7.5, weight: 500, color: "#FFFFFF" } }),
			],
		},
	}),

	// حكومي يمني: «الجمهورية اليمنية» over the ministry and its sector, the emblem in the centre, the English mirror, a double rule and the reference line
	gov_yemen: () => ({
		header: {
			h: 40,
			pad_top: 2,
			slots: { right: 38, center: 20, left: 38 },
			elements: [
				{ type: "text", slot: "right", style: { size: 12, weight: 700, color: "text", gap: 0.6 }, props: { text: "الجمهورية اليمنية", dir: "rtl" } },
				name_ar("right", 13, { style: { gap: 0.4 } }),
				field("activity_ar", { slot: "right", style: { size: 10, weight: 600, color: "text", gap: 0 } }),
				logo("center", 24, 24),
				{ type: "text", slot: "left", style: { size: 11, weight: 700, color: "text", gap: 0.6 }, props: { text: "Republic of Yemen", dir: "ltr" } },
				name_en("left", 11, { style: { gap: 0.4 } }),
				field("activity_en", { slot: "left", style: { size: 9.5, weight: 600, color: "text", gap: 0 } }),
				line({ x: 0, y: 29, w: 180, style: { color: "text" }, props: { thick: 1, style: "double" } }),
				{ type: "text", slot: null, x: 0, y: 32.5, w: 180, style: { size: 9, color: "text", align: "start" }, props: { text: "الرقم: ......................\u2003\u2003التاريخ: ....../....../......هـ\u2003\u2003الموافق: ....../....../......م\u2003\u2003المرفقات: ..........", dir: "rtl" } },
			],
		},
		footer: {
			h: 16,
			pad_top: 3.5,
			slots: { right: 40, center: 20, left: 40 },
			elements: [
				line({ x: 0, y: 1, w: 180, style: { color: "text" }, props: { thick: 0.3 } }),
				field("address_ar", { slot: "right", style: { size: 7.5, gap: 0.3 } }),
				field("phone_no", { slot: "right", style: { size: 7.5, gap: 0.3 }, props: { label: "هاتف:" } }),
				field("fax", { slot: "right", style: { size: 7.5, gap: 0 }, props: { label: "فاكس:" } }),
				page("center", "ar", { style: { size: 7.5 } }),
				field("email", { slot: "left", style: { size: 7.5, gap: 0.3 } }),
				field("website", { slot: "left", style: { size: 7.5, gap: 0 } }),
			],
		},
	}),

	// حكومي سعودي: «المملكة العربية السعودية» over the ministry and its department, the emblem in the centre, number · date · attachments on the left, a rule pair in the brand colour
	gov_saudi: () => ({
		header: {
			h: 36,
			pad_top: 2,
			slots: { right: 38, center: 24, left: 34 },
			elements: [
				{ type: "text", slot: "right", style: { size: 12, weight: 700, color: "text", gap: 0.6 }, props: { text: "المملكة العربية السعودية", dir: "rtl" } },
				name_ar("right", 13, { style: { gap: 0.4 } }),
				field("activity_ar", { slot: "right", style: { size: 10, weight: 600, color: "text", gap: 0 } }),
				logo("center", 30, 24),
				{ type: "text", slot: "left", style: { size: 9.5, color: "text", gap: 2.4 }, props: { text: "الرقم: ..............................", dir: "rtl" } },
				{ type: "text", slot: "left", style: { size: 9.5, color: "text", gap: 2.4 }, props: { text: "التاريخ: ......./......./.......هـ", dir: "rtl" } },
				{ type: "text", slot: "left", style: { size: 9.5, color: "text", gap: 0 }, props: { text: "المرفقات: ..........................", dir: "rtl" } },
				line({ x: 0, y: 31, w: 180, props: { thick: 0.8 } }),
				line({ x: 0, y: 32.8, w: 180, props: { thick: 0.3 } }),
			],
		},
		footer: {
			h: 16,
			pad_top: 3.5,
			slots: { right: 40, center: 20, left: 40 },
			elements: [
				line({ x: 0, y: 1, w: 180, props: { thick: 0.3 } }),
				field("address_ar", { slot: "right", style: { size: 7.5, gap: 0.3 } }),
				field("po_box", { slot: "right", style: { size: 7.5, gap: 0.3 }, props: { label: "ص.ب:" } }),
				field("phone_no", { slot: "right", style: { size: 7.5, gap: 0 }, props: { label: "هاتف:" } }),
				page("center", "ar", { style: { size: 7.5 } }),
				field("website", { slot: "left", style: { size: 7.5, gap: 0.3 } }),
				field("email", { slot: "left", style: { size: 7.5, gap: 0 } }),
			],
		},
	}),

	// جامعة أو مستشفى أو هيئة: the emblem centred over both names, the faculty or department at the sides, number and date in both languages
	institution_centered: () => ({
		header: {
			h: 43,
			pad_top: 2,
			slots: { right: 30, center: 38, left: 30 },
			elements: [
				field("activity_ar", { slot: "right", style: { size: 9.5, weight: 600, color: "text", gap: 0.6 } }),
				field("address_ar", { slot: "right", style: { size: 7.5, gap: 0 } }),
				logo("center", 28, 20, { style: { gap: 1.2 } }),
				name_ar("center", 13, { style: { gap: 0.3 } }),
				name_en("center", 9.5, { style: { color: "text", gap: 0 } }),
				field("activity_en", { slot: "left", style: { size: 9, weight: 600, color: "text", gap: 0.6 } }),
				field("address_line1", { slot: "left", style: { size: 7.5, gap: 0 } }),
				{ type: "text", slot: null, x: 124, y: 31, w: 56, style: { size: 8.5, color: "text", align: "start" }, props: { text: "الرقم: ..............................", dir: "rtl" } },
				{ type: "text", slot: null, x: 124, y: 35.5, w: 56, style: { size: 8.5, color: "text", align: "start" }, props: { text: "التاريخ: ......../......../........", dir: "rtl" } },
				{ type: "text", slot: null, x: 0, y: 31, w: 56, style: { size: 8.5, color: "text", align: "start" }, props: { text: "Ref.: ..............................", dir: "ltr" } },
				{ type: "text", slot: null, x: 0, y: 35.5, w: 56, style: { size: 8.5, color: "text", align: "start" }, props: { text: "Date: ......../......../........", dir: "ltr" } },
				line({ x: 0, y: 41.5, w: 180, props: { thick: 0.5 } }),
			],
		},
		footer: {
			h: 15,
			pad_top: 3.5,
			slots: { right: 40, center: 20, left: 40 },
			elements: [
				line({ x: 0, y: 1, w: 180, props: { thick: 0.3 } }),
				field("phone_no", { slot: "right", style: { size: 7.5, gap: 0.3 }, props: { label: "هاتف:" } }),
				field("fax", { slot: "right", style: { size: 7.5, gap: 0 }, props: { label: "فاكس:" } }),
				field("website", { slot: "center", style: { size: 7.5, gap: 0.3 } }),
				page("center", "both", { style: { size: 7 } }),
				field("phone_no", { slot: "left", style: { size: 7.5, gap: 0.3 }, props: { label: "Tel" } }),
				field("email", { slot: "left", style: { size: 7.5, gap: 0 } }),
			],
		},
	}),

	// مصرفي، تذييل نظامي: a light header, and the legal footer of banks and financial companies in both languages (legal form, C.R., unified number, P.O. Box, national address)
	bank_legal_footer: () => ({
		header: {
			h: 28,
			pad_top: 4,
			slots: { right: 50, center: 0, left: 46 },
			elements: [
				name_ar("right", 13, { style: { gap: 0.6 } }),
				field("activity_ar", { slot: "right", style: { size: 8, gap: 0 } }),
				logo("left", 42, 16, { style: { gap: 1.2 } }),
				name_en("left", 9, { style: { color: "muted", weight: 500, gap: 0 } }),
			],
		},
		footer: {
			h: 26,
			pad_top: 3.5,
			slots: { right: 40, center: 20, left: 40 },
			elements: [
				line({ x: 0, y: 0.8, w: 180, props: { thick: 0.5 } }),
				name_ar("right", 7.5, { style: { color: "text", gap: 0.3 } }),
				field("activity_ar", { slot: "right", style: { size: 6.5, gap: 0.2 } }),
				field("cr_no", { slot: "right", style: { size: 6.5, gap: 0.2 }, props: { label: "س.ت:" } }),
				field("unified_no", { slot: "right", style: { size: 6.5, gap: 0.2 }, props: { label: "الرقم الموحد:" } }),
				field("po_box", { slot: "right", style: { size: 6.5, gap: 0.2 }, props: { label: "ص.ب:" } }),
				field("address_ar", { slot: "right", style: { size: 6.5, gap: 0 } }),
				field("website", { slot: "center", style: { size: 7, gap: 0.6 } }),
				page("center", "both", { style: { size: 6.5 } }),
				name_en("left", 7.5, { style: { color: "text", weight: 700, gap: 0.3 } }),
				field("activity_en", { slot: "left", style: { size: 6.5, gap: 0.2 } }),
				field("cr_no", { slot: "left", style: { size: 6.5, gap: 0.2 }, props: { label: "C.R." } }),
				field("unified_no", { slot: "left", style: { size: 6.5, gap: 0.2 }, props: { label: "Unified No." } }),
				field("po_box", { slot: "left", style: { size: 6.5, gap: 0.2 }, props: { label: "P.O. Box" } }),
				field("address_line1", { slot: "left", style: { size: 6.5, gap: 0 } }),
			],
		},
	}),

	// الإدارة المالية: VAT and C.R. under both names, the bank and IBAN in the footer — statements of account, payment requests, quotations
	finance_bank_details: () => ({
		header: {
			h: 31,
			pad_top: 4,
			slots: { right: 38, center: 22, left: 38 },
			elements: [
				name_ar("right", 14, { style: { gap: 0.8 } }),
				field("tax_id", { slot: "right", style: { size: 8, color: "text", gap: 0.3 }, props: { label: "الرقم الضريبي:" } }),
				field("cr_no", { slot: "right", style: { size: 8, gap: 0 }, props: { label: "س.ت:" } }),
				logo("center", 28, 20),
				name_en("left", 12, { style: { gap: 0.8 } }),
				field("tax_id", { slot: "left", style: { size: 8, color: "text", gap: 0.3 }, props: { label: "VAT No." } }),
				field("cr_no", { slot: "left", style: { size: 8, gap: 0 }, props: { label: "C.R." } }),
				line({ x: 0, y: 28.5, w: 180, props: { thick: 0.6 } }),
			],
		},
		footer: {
			h: 20,
			pad_top: 3.5,
			slots: { right: 40, center: 20, left: 40 },
			elements: [
				line({ x: 0, y: 0.8, w: 180, style: { color: "muted" }, props: { thick: 0.3 } }),
				field("bank_name", { slot: "right", style: { size: 7.5, weight: 500, color: "text", gap: 0.3 }, props: { label: "البنك:" } }),
				field("iban", { slot: "right", style: { size: 7.5, weight: 500, color: "text", gap: 0.3 }, props: { label: "الآيبان (IBAN):" } }),
				field("address_ar", { slot: "right", style: { size: 7.5, gap: 0.3 } }),
				field("phone_no", { slot: "right", style: { size: 7.5, gap: 0 }, props: { label: "هاتف:" } }),
				page("center", "both", { style: { size: 7 } }),
				field("address_line1", { slot: "left", style: { size: 7.5, gap: 0.3 } }),
				field("phone_no", { slot: "left", style: { size: 7.5, gap: 0.3 }, props: { label: "Tel" } }),
				field("email", { slot: "left", style: { size: 7.5, gap: 0.3 } }),
				field("website", { slot: "left", style: { size: 7.5, gap: 0 } }),
			],
		},
	}),

	// مكتب محاماة: the names set centred like a nameplate, a short rule, the practice under it in both languages; no logo needed
	law_chambers: () => ({
		header: {
			h: 34,
			pad_top: 4,
			slots: { right: 0, center: 70, left: 0 },
			elements: [
				name_ar("center", 17, { style: { color: "text", gap: 0.6 } }),
				name_en("center", 10, { style: { color: "muted", weight: 500, gap: 1.6 } }),
				line({ slot: "center", w: 44, style: { gap: 1.6 }, props: { thick: 0.3 } }),
				field("activity_ar", { slot: "center", style: { size: 9.5, weight: 600, color: "primary", gap: 0.3 } }),
				field("activity_en", { slot: "center", style: { size: 8.5, gap: 0 } }),
			],
		},
		footer: {
			h: 16,
			pad_top: 4,
			slots: { right: 40, center: 20, left: 40 },
			elements: [
				line({ x: 0, y: 1, w: 180, style: { color: "text" }, props: { thick: 0.2 } }),
				field("address_ar", { slot: "right", style: { size: 7.5, gap: 0.3 } }),
				field("phone_no", { slot: "right", style: { size: 7.5, gap: 0.3 }, props: { label: "هاتف:" } }),
				field("cr_no", { slot: "right", style: { size: 7.5, gap: 0 }, props: { label: "س.ت:" } }),
				page("center", "both", { style: { size: 7 } }),
				field("address_line1", { slot: "left", style: { size: 7.5, gap: 0.3 } }),
				field("email", { slot: "left", style: { size: 7.5, gap: 0.3 } }),
				field("website", { slot: "left", style: { size: 7.5, gap: 0 } }),
			],
		},
	}),

	// مقاولات وهندسة: two bars of the brand colour bracket the page — one across the top of the header, one at the foot
	contractor_bars: () => ({
		header: {
			h: 33,
			pad_top: 7,
			slots: { right: 40, center: 18, left: 40 },
			elements: [
				band({ x: 0, y: 0, w: 180, h: 3 }),
				name_ar("right", 15, { style: { gap: 0.6 } }),
				field("activity_ar", { slot: "right", style: { size: 8.5, weight: 600, color: "text", gap: 0.4 } }),
				field("cr_no", { slot: "right", style: { size: 7.5, gap: 0 }, props: { label: "س.ت:" } }),
				logo("center", 26, 20),
				name_en("left", 12.5, { style: { weight: 700, gap: 0.8 } }),
				field("activity_en", { slot: "left", style: { size: 8.5, weight: 600, color: "text", gap: 0.4 } }),
				field("cr_no", { slot: "left", style: { size: 7.5, gap: 0 }, props: { label: "C.R." } }),
			],
		},
		footer: {
			h: 16,
			pad_top: 1.5,
			slots: { right: 40, center: 20, left: 40 },
			elements: [
				field("address_ar", { slot: "right", style: { size: 7.5, gap: 0.3 } }),
				field("phone_no", { slot: "right", style: { size: 7.5, gap: 0 }, props: { label: "هاتف:" } }),
				page("center", "both", { style: { size: 7 } }),
				field("email", { slot: "left", style: { size: 7.5, gap: 0.3 } }),
				field("website", { slot: "left", style: { size: 7.5, gap: 0 } }),
				band({ x: 0, y: 12, w: 180, h: 4 }),
			],
		},
	}),

	// اسم فقط: the two names as a wordmark, no logo, one hairline — consultants and small offices
	minimal_wordmark: () => ({
		header: {
			h: 24,
			pad_top: 5,
			slots: { right: 48, center: 0, left: 48 },
			elements: [
				name_ar("right", 13, { style: { color: "text", gap: 0.4 } }),
				field("activity_ar", { slot: "right", style: { size: 7.5, gap: 0 } }),
				name_en("left", 11, { style: { color: "text", gap: 0.4 } }),
				field("activity_en", { slot: "left", style: { size: 7.5, gap: 0 } }),
				line({ x: 0, y: 21.5, w: 180, style: { color: "muted" }, props: { thick: 0.2 } }),
			],
		},
		footer: {
			h: 10,
			pad_top: 3,
			slots: { right: 38, center: 24, left: 38 },
			elements: [field("address_ar", { slot: "right", style: { size: 7 } }), page("center", "both", { style: { size: 7 } }), field("website", { slot: "left", style: { size: 7 } })],
		},
	}),

	// شعار وعمود بيانات: the logo top-left, a small column of Arabic details top-right, no rules — the quiet international look
	minimal_details_column: () => ({
		header: {
			h: 30,
			pad_top: 4,
			slots: { right: 40, center: 0, left: 40 },
			elements: [
				logo("left", 36, 18, { style: { gap: 1 } }),
				name_en("left", 8, { style: { color: "text", gap: 0 } }),
				name_ar("right", 10, { style: { color: "text", gap: 0.8 } }),
				field("address_ar", { slot: "right", style: { size: 7.5, gap: 0.3 } }),
				field("phone_no", { slot: "right", style: { size: 7.5, gap: 0.3 }, props: { label: "هاتف:" } }),
				field("email", { slot: "right", style: { size: 7.5, gap: 0.3 } }),
				field("website", { slot: "right", style: { size: 7.5, gap: 0 } }),
			],
		},
		footer: { h: 10, pad_top: 3, slots: { right: 0, center: 40, left: 0 }, elements: [page("center", "both", { style: { size: 7 } })] },
	}),

	// شريط اتصال: the bilingual header with a light grey strip of phone · email · website under it
	contact_strip: () => ({
		header: {
			h: 36,
			pad_top: 3,
			slots: { right: 38, center: 22, left: 38 },
			elements: [
				name_ar("right", 15, { style: { gap: 0.6 } }),
				field("activity_ar", { slot: "right", style: { size: 8.5, weight: 500, color: "text", gap: 0 } }),
				logo("center", 26, 20),
				name_en("left", 12.5, { style: { gap: 0.6 } }),
				field("activity_en", { slot: "left", style: { size: 8.5, weight: 500, color: "text", gap: 0 } }),
				band({ x: 0, y: 27, w: 180, h: 7, props: { fill: "#F1F3F2", radius: 1 } }),
				field("phone_no", { x: 124, y: 28.7, w: 54, style: { size: 7.5, color: "text" }, props: { label: "هاتف:" } }),
				field("email", { x: 63, y: 28.7, w: 54, style: { size: 7.5, color: "text", align: "center" } }),
				field("website", { x: 2, y: 28.7, w: 54, style: { size: 7.5, color: "text" } }),
			],
		},
		footer: {
			h: 16,
			pad_top: 3.5,
			slots: { right: 40, center: 20, left: 40 },
			elements: [
				line({ x: 0, y: 1, w: 180, style: { color: "muted" }, props: { thick: 0.3 } }),
				field("address_ar", { slot: "right", style: { size: 7.5, gap: 0.3 } }),
				field("cr_no", { slot: "right", style: { size: 7.5, gap: 0.3 }, props: { label: "س.ت:" } }),
				field("tax_id", { slot: "right", style: { size: 7.5, gap: 0 }, props: { label: "الرقم الضريبي:" } }),
				page("center", "both", { style: { size: 7 } }),
				field("address_line1", { slot: "left", style: { size: 7.5, gap: 0.3 } }),
				field("cr_no", { slot: "left", style: { size: 7.5, gap: 0.3 }, props: { label: "C.R." } }),
				field("tax_id", { slot: "left", style: { size: 7.5, gap: 0 }, props: { label: "VAT No." } }),
			],
		},
	}),

	// لسان لوني: a tab of the brand colour in the top-right corner carrying the Arabic name in white; the logo and English name on the white paper to its left
	brand_tab: () => ({
		header: {
			h: 32,
			pad_top: 3,
			slots: { right: 0, center: 0, left: 40 },
			elements: [
				band({ x: 76, y: 0, w: 104, h: 24, props: { radius: 8, corners: "bl" } }),
				name_ar(null, 14, { x: 80, y: 4, w: 96, style: { color: "#FFFFFF" } }),
				field("activity_ar", { x: 80, y: 17.6, w: 96, style: { size: 8.5, weight: 500, color: "#FFFFFF" } }),
				logo("left", 36, 16, { style: { gap: 1.2 } }),
				name_en("left", 9.5, { style: { gap: 0.3 } }),
				field("activity_en", { slot: "left", style: { size: 7.5, gap: 0 } }),
				field("phone_no", { x: 128, y: 26.5, w: 50, style: { size: 7.5 }, props: { label: "هاتف:" } }),
				field("email", { x: 78, y: 26.5, w: 48, style: { size: 7.5 } }),
			],
		},
		footer: {
			h: 14,
			pad_top: 4,
			slots: { right: 40, center: 20, left: 40 },
			elements: [
				line({ x: 0, y: 1, w: 180, props: { thick: 0.8 } }),
				field("address_ar", { slot: "right", style: { size: 7.5 } }),
				page("center", "both", { style: { size: 7 } }),
				field("website", { slot: "left", style: { size: 7.5 } }),
			],
		},
	}),

	// رأس مختصر: a low header for long reports and statements — both names, a small logo, a hairline; the page number in the footer
	compact_running: () => ({
		header: {
			h: 18,
			pad_top: 3,
			slots: { right: 40, center: 16, left: 40 },
			elements: [
				name_ar("right", 11, { style: { gap: 0 } }),
				logo("center", 18, 10, { style: { gap: 0 } }),
				name_en("left", 10, { style: { gap: 0 } }),
				line({ x: 0, y: 15.5, w: 180, props: { thick: 0.4 } }),
			],
		},
		footer: { h: 9, pad_top: 2.5, slots: { right: 0, center: 40, left: 0 }, elements: [page("center", "both", { style: { size: 7 } })] },
	}),

	// سطر واحد: the names and the page number on one line over a hairline, no footer — the lowest head, for working papers and drafts
	running_line: () => ({
		header: {
			h: 13,
			pad_top: 3,
			slots: { right: 38, center: 24, left: 38 },
			elements: [
				name_ar("right", 10, { style: { color: "text", gap: 0 } }),
				page("center", "both", { style: { size: 7 } }),
				name_en("left", 9, { style: { color: "text", gap: 0 } }),
				line({ x: 0, y: 10.5, w: 180, style: { color: "muted" }, props: { thick: 0.3 } }),
			],
		},
		footer: { h: 0, pad_top: 0, slots: { right: 0, center: 0, left: 0 }, elements: [] },
	}),
};

/** The styles in the order of the gallery; `label` is an English msgid (translated by the caller). */
export const PRESETS = Object.freeze([
	{ id: "classic", label: "Classic bilingual", family: "bilingual" },
	{ id: "bilingual_registry", label: "Bilingual with registration numbers", family: "bilingual" },
	{ id: "contact_strip", label: "Bilingual with a contact strip", family: "bilingual" },
	{ id: "gov_yemen", label: "Government, Republic of Yemen", family: "government" },
	{ id: "gov_saudi", label: "Government, Kingdom of Saudi Arabia", family: "government" },
	{ id: "institution_centered", label: "Institution, centred emblem", family: "government" },
	{ id: "logo_left_names_right", label: "Logo left, names right", family: "corporate" },
	{ id: "finance_bank_details", label: "Finance, bank and IBAN", family: "corporate" },
	{ id: "simple", label: "Simple, logo and contacts", family: "corporate" },
	{ id: "center_logo", label: "Centred logo", family: "formal" },
	{ id: "formal", label: "Formal, double rule", family: "formal" },
	{ id: "bank_legal_footer", label: "Bank, legal footer", family: "formal" },
	{ id: "law_chambers", label: "Law office nameplate", family: "formal" },
	{ id: "band_top", label: "Top colour band", family: "banded" },
	{ id: "corner", label: "Colour corner", family: "banded" },
	{ id: "footer_band_contacts", label: "Contacts on a footer band", family: "banded" },
	{ id: "contractor_bars", label: "Contracting, top and bottom bars", family: "banded" },
	{ id: "brand_tab", label: "Colour tab with the Arabic name", family: "banded" },
	{ id: "minimal_wordmark", label: "Names only, no logo", family: "minimal" },
	{ id: "minimal_details_column", label: "Logo and a details column", family: "minimal" },
	{ id: "compact_running", label: "Compact head for long reports", family: "continuation" },
	{ id: "running_line", label: "One-line running head", family: "continuation" },
]);

/** The families of the library, in the order of the gallery's filter; English msgids. */
export const FAMILIES = Object.freeze([
	{ id: "bilingual", label: "Bilingual" },
	{ id: "government", label: "Government" },
	{ id: "corporate", label: "Companies" },
	{ id: "formal", label: "Formal" },
	{ id: "banded", label: "Colour bands" },
	{ id: "minimal", label: "Minimal" },
	{ id: "continuation", label: "Following pages" },
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
