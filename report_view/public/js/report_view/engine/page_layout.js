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
/** Base font size of a printed row in px, and the smallest scale the columns shrink it to. */
export const PAGE_FONT = { comfortable: 10, compact: 9 };
export const MIN_FONT_SCALE = 0.7;

/**
 * The box of a page in CSS px.
 * @param {{size?: string, orientation?: "portrait"|"landscape", margins?: string}} o
 */
export function page_box({ size = "A4", orientation = "portrait", margins = "normal" } = {}) {
	const paper = PAGE_SIZES[size] || PAGE_SIZES.A4;
	const landscape = orientation === "landscape";
	const w = Math.round((landscape ? paper.h : paper.w) * MM);
	const h = Math.round((landscape ? paper.w : paper.h) * MM);
	const margin = Math.round((MARGINS[margins] ?? MARGINS.normal) * MM);
	return {
		size: PAGE_SIZES[size] ? size : "A4",
		orientation: landscape ? "landscape" : "portrait",
		w,
		h,
		margin,
		inner_w: w - 2 * margin,
		inner_h: h - 2 * margin,
		// what the @page rule prints: the paper as chosen
		paper_w_mm: landscape ? paper.h : paper.w,
		paper_h_mm: landscape ? paper.w : paper.h,
	};
}

/**
 * Column widths scaled to the width of the page body: filled exactly when they are
 * narrower, shrunk (and the font with them, down to MIN_FONT_SCALE) when wider.
 * @param {number[]} widths nominal widths of the columns on screen
 * @param {number} inner_w width of the page inside its margins
 * @param {number} font base font size
 * @returns {{widths: number[], scale: number, font: number, overflow: boolean}} `overflow`:
 *   the columns are wider than the smallest font allows, cells will be cut
 */
export function fit_columns(widths, inner_w, font) {
	const total = widths.reduce((a, b) => a + b, 0);
	if (!total || !inner_w) return { widths: widths.slice(), scale: 1, font, overflow: false };
	const scale = inner_w / total;
	const out = widths.map((w) => (w * inner_w) / total);
	const font_scale = Math.max(MIN_FONT_SCALE, Math.min(1, scale));
	return { widths: out, scale, font: font * font_scale, overflow: scale < MIN_FONT_SCALE };
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
	for (let i = 0; i < 50000; i++) {
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
