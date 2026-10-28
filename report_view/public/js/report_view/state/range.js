// Cell range selection of the grid (phase 5c; docs/architecture.md §8أ.5): the selection model,
// which rows of a range enter its sum, and the clipboard text of a range. Pure module: no DOM,
// no frappe, no engine. The values arrive already read from the engine (view.to_columns of the
// range window, views/grid_view.js range_data); nothing here reads a cell of the page.
//
// Data coordinates: an end of the range is a display row of the body (`y`) and a column KEY,
// never a DOM cell, so it stays right while the table scrolls (only the rows on screen exist in
// the DOM). Each end also keeps the identity of its row (`id`: a report row by __rid, a group
// by its path, the subtotal row of either): when the rows are laid out again (a group folded,
// a sort, a filter) the grid finds the new display row of each end by its identity
// (GridView.relocate); an end whose row is no longer shown clears the selection.

/** A range end: {y: display row, key: column key, id: row identity (string) or null}. */
export function range_end(y, key, id = null) {
	return { y: Math.max(0, Math.trunc(Number(y) || 0)), key: String(key), id: id === null || id === undefined ? null : String(id) };
}

export class RangeSelection {
	constructor() {
		this.anchor = null;
		this.focus = null;
		// bumped on every change: a read of the engine for an older range is dropped
		this.version = 0;
	}

	get active() {
		return Boolean(this.anchor && this.focus);
	}

	/** A new range from `anchor` to `focus` (one cell when focus is left out). */
	set(anchor, focus = anchor) {
		this.anchor = { ...anchor };
		this.focus = { ...focus };
		this.version += 1;
	}

	/** Moves the focus end; the anchor stays. */
	extend(focus) {
		if (!this.anchor) return this.set(focus);
		this.focus = { ...focus };
		this.version += 1;
	}

	clear() {
		if (!this.anchor && !this.focus) return false;
		this.anchor = null;
		this.focus = null;
		this.version += 1;
		return true;
	}

	/**
	 * The rectangle of the range in display rows and column positions of `keys` (the grid's
	 * columns in order: the label, the pinned ones, the data columns), or null when there is
	 * no range or one of its columns is no longer shown.
	 * @param {string[]} keys
	 * @returns {{y0: number, y1: number, c0: number, c1: number}|null}
	 */
	rect(keys) {
		if (!this.active) return null;
		const a = keys.indexOf(this.anchor.key);
		const f = keys.indexOf(this.focus.key);
		if (a < 0 || f < 0) return null;
		return {
			y0: Math.min(this.anchor.y, this.focus.y),
			y1: Math.max(this.anchor.y, this.focus.y),
			c0: Math.min(a, f),
			c1: Math.max(a, f),
		};
	}
}

/** Cells of a rectangle. */
export function rect_cells(r) {
	return r ? (r.y1 - r.y0 + 1) * (r.c1 - r.c0 + 1) : 0;
}

/** Whether a cell is inside a rectangle. */
export function in_rect(r, y, c) {
	return Boolean(r) && y >= r.y0 && y <= r.y1 && c >= r.c0 && c <= r.c1;
}

/**
 * Where an arrow key, Home/End or PageUp/PageDown takes the focus end of a range.
 * Left and right follow the screen: in RTL the next column is on the left.
 * @param {{y: number, c: number}} at the focus end (row, column position)
 * @param {string} key the KeyboardEvent key
 * @param {object} o {rows: display rows, cols: columns, rtl, page: rows a page moves, ctrl: to the edge}
 * @returns {{y: number, c: number}|null} null for a key that does not move the focus
 */
export function step_cell(at, key, { rows, cols, rtl = false, page = 10, ctrl = false }) {
	const clamp = (v, n) => Math.max(0, Math.min(n - 1, v));
	let { y, c } = at;
	const fwd = rtl ? "ArrowLeft" : "ArrowRight";
	const back = rtl ? "ArrowRight" : "ArrowLeft";
	if (key === "ArrowDown") y = ctrl ? rows - 1 : y + 1;
	else if (key === "ArrowUp") y = ctrl ? 0 : y - 1;
	else if (key === fwd) c = ctrl ? cols - 1 : c + 1;
	else if (key === back) c = ctrl ? 0 : c - 1;
	else if (key === "PageDown") y += page;
	else if (key === "PageUp") y -= page;
	else if (key === "Home") {
		c = 0;
		if (ctrl) y = 0;
	} else if (key === "End") {
		c = cols - 1;
		if (ctrl) y = rows - 1;
	} else return null;
	return { y: clamp(y, rows), c: clamp(c, cols) };
}

/**
 * Which rows of a range enter its count, sum and average (the documented rule, §8أ.5):
 * - a leaf row (a fact, a report row without children shown) always;
 * - a closed group or a closed parent of the tree with its own value (what Perspective or the
 *   report gives for the group);
 * - an open group or parent is left out when one of its children shown is in the range (its
 *   value is the sum of what is already counted), and when it shows no numbers at all (with
 *   subtotal rows its numbers stand in its subtotal row);
 * - a subtotal row likewise: left out when the rows above it in the range are its own;
 * - a summary row of the report between its facts (opening, total, closing) only when the
 *   range holds no fact row; a spacer row never.
 * @param {Array<{kind: "row"|"group"|"foot"|"summary"|"spacer", depth: number, open: boolean,
 *   blank: boolean}>} entries the rows of the range in display order; `open`: its children
 *   are shown below it; `blank`: its numbers are shown in its subtotal row instead
 * @returns {boolean[]} per entry, whether its numeric cells count
 */
export function countable_rows(entries) {
	const n = entries.length;
	const out = new Array(n).fill(false);
	const facts = entries.some((e) => e.kind === "row" || e.kind === "group");
	for (let i = 0; i < n; i++) {
		const e = entries[i];
		const depth = Number(e.depth) || 0;
		if (e.kind === "spacer") continue;
		if (e.kind === "summary") {
			out[i] = !facts;
			continue;
		}
		if (e.kind === "foot") {
			const prev = entries[i - 1];
			out[i] = !(prev && prev.kind !== "spacer" && (Number(prev.depth) || 0) > depth);
			continue;
		}
		if (e.open) {
			if (e.blank) continue;
			const next = entries[i + 1];
			out[i] = !(next && next.kind !== "spacer" && (Number(next.depth) || 0) > depth);
			continue;
		}
		out[i] = true;
	}
	return out;
}

/** A raw number as text: the float noise of a sum dropped (15 significant digits), no grouping. */
export function raw_number(v) {
	if (typeof v !== "number" || !Number.isFinite(v)) return "";
	const n = Number(v.toPrecision(15));
	return Object.is(n, -0) ? "0" : String(n);
}

/** A cell as text for the clipboard: numbers raw, lists joined, nothing for empty. */
export function raw_text(v) {
	if (v === null || v === undefined) return "";
	if (typeof v === "number") return raw_number(v);
	if (typeof v === "boolean") return v ? "1" : "0";
	if (Array.isArray(v)) return v.map(raw_text).join(", ");
	return String(v);
}

// A TSV field as Excel reads it back: quoted when it holds a tab, a line break or a quote.
function tsv_field(v) {
	const s = raw_text(v);
	return /[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Tab-separated text of rows of cells (Excel and Sheets paste it as columns and numbers).
 * @param {Array<Array>} rows
 * @param {string[]|null} [headers] a first row of column titles
 */
export function to_tsv(rows, headers = null) {
	const lines = (headers ? [headers, ...rows] : rows).map((r) => r.map(tsv_field).join("\t"));
	return `${lines.join("\r\n")}\r\n`;
}

const HTML_ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const html_esc = (s) => String(s).replace(/[&<>"']/g, (c) => HTML_ESC[c]);

/**
 * The same cells as a plain HTML table, for a rich paste (a word processor, mail): no styles,
 * raw values; numbers marked so a spreadsheet keeps them numbers.
 */
export function to_html_table(rows, headers = null) {
	const cell = (v, tag) => {
		const num = typeof v === "number" && Number.isFinite(v);
		return `<${tag}${num ? ' x:num="' + raw_number(v) + '"' : ""}>${html_esc(raw_text(v))}</${tag}>`;
	};
	const head = headers ? `<thead><tr>${headers.map((h) => cell(h, "th")).join("")}</tr></thead>` : "";
	const body = rows.map((r) => `<tr>${r.map((v) => cell(v, "td")).join("")}</tr>`).join("");
	return `<table>${head}<tbody>${body}</tbody></table>`;
}

/** A file name of the selection export: the report's name, no characters a file system refuses. */
export function export_file_name(report_name) {
	const base = String(report_name || "report").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim() || "report";
	return `${base} - selection.tsv`;
}
