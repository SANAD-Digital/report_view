// Page geometry and the cut of the rows into pages for the Pages view (views/pages_view.js;
// docs/architecture.md §11.1 #77, ADR-014). Pure module: nothing is read from the DOM, every
// height comes in measured, and the rows are only placed, never computed.

/** Paper sizes in mm (ISO 216 and North American). */
export const PAGE_SIZES = {
	A4: { w: 210, h: 297 },
	A3: { w: 297, h: 420 },
	Letter: { w: 215.9, h: 279.4 },
	Legal: { w: 215.9, h: 355.6 },
};
/** Page margins in mm. */
export const MARGINS = { narrow: 8, normal: 12, wide: 18 };
/** CSS pixels per millimetre (CSS inch = 96px). */
export const MM = 96 / 25.4;
/** Base font size of a printed row in px (9pt / 8.25pt), and the smallest scale the columns
 * shrink it to (about 7.2pt): below it the cells are cut, never the font. */
export const PAGE_FONT = { comfortable: 12, compact: 11 };
export const MIN_FONT_SCALE = 0.8;
// paginate() never cuts more pages than this (a guard against a row taller than the page).
const MAX_PAGINATE = 50000;
/** Font size of the grid the nominal column widths were made for. */
export const SCREEN_FONT = 13;
/** A text column gives up to this share of its width before every column shrinks. */
const TEXT_SHRINK = 0.45;

/** The page margins of a preset, the same on the four sides (mm). */
export function preset_margins(name) {
	const v = MARGINS[name] ?? MARGINS.normal;
	return { top: v, bottom: v, start: v, end: v };
}

/**
 * The box of a page in CSS px.
 * @param {{size?: string, orientation?: "portrait"|"landscape", margins?: string,
 *   page_m?: {top: number, bottom: number, start: number, end: number}}} o `page_m`: the
 *   four margins in mm (they win over the `margins` preset)
 */
export function page_box({ size = "A4", orientation = "portrait", margins = "normal", page_m = null } = {}) {
	const paper = PAGE_SIZES[size] || PAGE_SIZES.A4;
	const landscape = orientation === "landscape";
	const w = Math.round((landscape ? paper.h : paper.w) * MM);
	const h = Math.round((landscape ? paper.w : paper.h) * MM);
	const m = page_m || preset_margins(margins);
	const px = (v) => Math.round((Number(v) || 0) * MM);
	const pad = { top: px(m.top), bottom: px(m.bottom), start: px(m.start), end: px(m.end) };
	return {
		size: PAGE_SIZES[size] ? size : "A4",
		orientation: landscape ? "landscape" : "portrait",
		w,
		h,
		pad,
		// the smallest margin of the four
		margin: Math.min(pad.top, pad.bottom, pad.start, pad.end),
		inner_w: w - pad.start - pad.end,
		inner_h: h - pad.top - pad.bottom,
		// what the @page rule prints: the paper as chosen
		paper_w_mm: landscape ? paper.h : paper.w,
		paper_h_mm: landscape ? paper.w : paper.h,
	};
}

/**
 * Column widths fitted to the width of the page body. The nominal widths are the grid's
 * (made for its 13px font): they are first brought to the print font. Columns narrower than
 * the page give the spare room to their text columns; wider ones first narrow their text columns (`flex`) down
 * to TEXT_SHRINK of their width (numbers keep theirs), then shrink all together with the
 * font, down to MIN_FONT_SCALE.
 * @param {Array<number|{width: number, flex?: boolean, weight?: number}>} cols nominal widths;
 *   a number is a fixed (numeric) column; `weight` sets how much of the narrowing (and of the
 *   spare room) a text column takes
 * @param {number} inner_w width of the page inside its margins
 * @param {number} font base font size
 * @returns {{widths: number[], scale: number, font: number, overflow: boolean}} `scale`:
 *   the shrink after the text columns gave their room (1 = no shrink); `overflow`: the font
 *   reached its floor, cells will be cut
 */
export function fit_columns(cols, inner_w, font) {
	const items = cols.map((c) =>
		typeof c === "number" ? { width: c, flex: false, weight: 1 } : { width: c.width, flex: Boolean(c.flex), weight: c.weight ?? 1 }
	);
	const ratio = font / SCREEN_FONT;
	const base = items.map((c) => c.width * ratio);
	const total = base.reduce((a, b) => a + b, 0);
	if (!total || !inner_w) return { widths: base, scale: 1, font, overflow: false };
	const share = (list, amount) => {
		// `amount` spread over the text columns by width x weight (all columns without any)
		const keys = base.map((w, i) => (items[i].flex ? w * items[i].weight : 0));
		const sum = keys.reduce((a, b) => a + b, 0);
		return list.map((w, i) => w + (sum ? (amount * keys[i]) / sum : (amount * w) / total));
	};
	if (total <= inner_w) {
		// the room left goes to the text columns (the label first, by its weight)
		return { widths: share(base, inner_w - total), scale: 1, font, overflow: false };
	}
	// narrow the text columns first, by weight, none below TEXT_SHRINK of its width
	let narrowed = base.slice();
	let need = total - inner_w;
	for (let pass = 0; pass < 4 && need > 0.5; pass++) {
		const keys = narrowed.map((w, i) => (items[i].flex && w > base[i] * TEXT_SHRINK + 0.5 ? base[i] * items[i].weight : 0));
		const sum = keys.reduce((a, b) => a + b, 0);
		if (!sum) break;
		let taken = 0;
		narrowed = narrowed.map((w, i) => {
			if (!keys[i]) return w;
			const cut = Math.min(w - base[i] * TEXT_SHRINK, (need * keys[i]) / sum);
			taken += cut;
			return w - cut;
		});
		need -= taken;
	}
	const after = narrowed.reduce((a, b) => a + b, 0);
	const scale = Math.min(1, inner_w / after);
	const widths = narrowed.map((w) => (w * inner_w) / after);
	return { widths, scale, font: font * Math.max(MIN_FONT_SCALE, scale), overflow: scale < MIN_FONT_SCALE };
}

/**
 * Cuts `count` body rows into pages. Every page carries the parts measured out of `body_h`
 * already (head, column titles, foot); the first page also carries `first_h` (the applied
 * filters and the rows pinned above the body); the last page `tail_h` (the rows pinned
 * below the body, the grand total, the signatures). The tail never stands alone on a page
 * while a row can go with it.
 * @param {{count: number, row_h: number, body_h: number, first_h?: number, tail_h?: number}} o
 * @returns {Array<{start: number, end: number, first: boolean, last: boolean}>} the display
 *   rows [start, end) of every page
 */
export function paginate({ count, row_h, body_h, first_h = 0, tail_h = 0 }) {
	const pages = [];
	const rows = Math.max(0, Math.floor(count) || 0);
	const rh = Math.max(1, row_h || 1);
	let at = 0;
	for (let i = 0; i < MAX_PAGINATE; i++) {
		const room = body_h - (i === 0 ? first_h : 0);
		const remaining = rows - at;
		// rows that leave room for the tail on this page
		const with_tail = Math.floor((room - tail_h) / rh);
		if (remaining <= with_tail) {
			pages.push({ start: at, end: rows, first: i === 0, last: true });
			break;
		}
		let n = Math.max(0, Math.floor(room / rh));
		if (remaining <= n) {
			// all the rows fit, the tail does not: keep rows for the page of the tail
			n = Math.max(0, Math.min(remaining - 1, with_tail));
		}
		// a head taller than the page (first page): the rows start on the next one; a row
		// taller than the page (never, rows are fixed) would otherwise loop forever
		if (n === 0 && i > 0 && remaining > 0 && room >= rh) n = 1;
		if (n === 0 && i > 0 && room < rh) n = Math.min(1, remaining);
		pages.push({ start: at, end: at + n, first: i === 0, last: false });
		at += n;
		if (at >= rows) {
			pages.push({ start: at, end: at, first: false, last: true });
			break;
		}
	}
	if (pages.length) pages[0].first = true;
	return pages;
}
