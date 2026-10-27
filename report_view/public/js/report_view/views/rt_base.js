// Shared plumbing of the views drawn on <regular-table> (views/grid_view.js, views/pivot_view.js):
// mounting and unmounting the element, column sizes, the scroll range, the sub-column shift,
// header widths as drawn, the cells' content, the pinned rows' widths and the column resize
// (drag and double click on the handle regular-table puts in a header cell). A subclass
// supplies the model, the data listener (read) and the style listener (style); nothing here
// computes a value: it is all placement and measurement. Same techniques as the perf commit
// bf42c36: cells keep their element and get text, header widths are read only when the
// columns on screen change, no forced layout while drawing.
//
// regular-table 0.9.1 internals used (the version is pinned, like rtl_adapter.js): `rt.e`
// (measured column widths), `rt.f` (the rule carrying the scroll variables), the
// `.rt-virtual-panel` of its shadow DOM and the `.rt-column-resize` span of a header cell.

import { apply_rtl } from "./rtl_adapter.js";
import { perspective_type } from "../engine/schema.js";
import { MIN_COLUMN_WIDTH } from "../state/view_state.js";
import { esc, frame_resize_observer } from "../util.js";

export const ROW_PATH = "__ROW_PATH__";
const MAX_AUTO_WIDTH = 640;
// Last content written in a cell's .rv-cc, and a number as format.js wraps it.
const CELL_HTML = new WeakMap();
const BARE_NUMBER = /^<bdi class="rv-n">([^<]*)<\/bdi>$/;
const CHEVRON =
	'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>';

/** The fold button of a group or a parent row. */
export function caret(open) {
	const label = open ? __("Collapse group") : __("Expand group");
	return `<button type="button" class="rv-caret${open ? " open" : ""}" aria-expanded="${open}" aria-label="${esc(label)}" title="${esc(label)}">${CHEVRON}</button>`;
}

/** An integer CSS variable of an element (the design tokens). */
export function css_int(el, name, fallback) {
	const v = parseInt(getComputedStyle(el).getPropertyValue(name), 10);
	return Number.isFinite(v) ? v : fallback;
}

/** A value of a group row as the report would carry it: Perspective returns dates as milliseconds. */
export function engine_value(column, value) {
	if (value === null || value === undefined || !column) return value;
	const type = perspective_type(column.fieldtype);
	if (type === "date" && typeof value === "number") return new Date(value).toISOString().slice(0, 10);
	if (type === "datetime" && typeof value === "number") {
		return new Date(value).toISOString().slice(0, 19).replace("T", " ");
	}
	if (type === "boolean") return value ? 1 : 0;
	return value;
}

/**
 * Base of a view on <regular-table>. The subclass implements:
 * - `read(x0, y0, x1, y1)`: the data listener; `style()`: the style listener; `click(event)`;
 * - `host_class`, `host_markup()`: the element around the table (.rv-rt-scroll > regular-table,
 *   an optional .rv-rt-top, the .rv-rt-edge; then .rv-rt-bottom);
 * - `size_widths()`: the nominal widths in regular-table's size-key order (row headers first);
 *   `size_heads()`: how many of them are row headers; `header_rows()`; `header_height_px()`;
 * - `cell_classes`: the classes a body cell may carry (style_cell);
 * - `render_pinned(shown)`: the rows outside the body;
 * - the resize hooks `resize_target(th)`, `width_of(target)`, `assign_width(target, width)`,
 *   `width_changed(target)`;
 * - optional `mounted()`, `unmounting()`, `resized()`, `cleared()`.
 */
export class RtView {
	constructor({ parent, rtl }) {
		this.parent = parent;
		this.rtl = rtl;
		this.rt = null;
		this.host = null;
		this.top_el = null;
		this.bottom_el = null;
		this.current = null;
		this.model = null;
		this.signature = null;
		this.epoch = 0;
		this.windows = [];
		this.rendered = new WeakMap();
		this.drawn = null;
		this.header_key = null;
		this.pinned_signature = null;
		this.pinned_shown = null;
		this.widths_version = 0;
		this.rt_width = 0;
		this.sub_x = undefined;
		this.listener = (x0, y0, x1, y1) => this.read(x0, y0, x1, y1);
		this.styler = () => this.style();
		this.on_click = (e) => this.click(e);
		this.on_press = (e) => this.press(e);
		this.on_dblclick = (e) => this.dblclick(e);
		this.on_scrolled = () => this.scrolled();
	}

	// ------------------------------------------------------------ mount / unmount

	mount(signature) {
		this.unmount();
		this.signature = signature;
		const host = document.createElement("div");
		host.className = this.host_class;
		host.innerHTML = this.host_markup();
		this.parent.replaceChildren(host);
		this.host = host;
		this.top_el = host.querySelector(".rv-rt-top");
		this.bottom_el = host.querySelector(".rv-rt-bottom");
		const rt = host.querySelector("regular-table");
		this.rt = rt;
		// Body rows are --rh high plus their 1px line; header rows have their own heights.
		this.row_height = css_int(host, "--rh", 36) + 1;
		this.cell_padding = css_int(host, "--cp", 12);
		this.header_height = this.header_height_px(host);
		// regular-table sizes its scroll range as if a header row were as high as a body row
		// (panel = rows * h + levels * h; rows that fit = height / h - levels). The design's
		// header rows are lower, which left an empty strip of up to 10px under the last row at
		// the end of the scroll. Reporting the difference as a fraction of a row less makes
		// both formulas exact for the real header height (the data listener answers with one
		// row more than asked, so the bottom edge is always filled).
		this.row_trim = Math.max(0, this.header_rows() * this.row_height - this.header_height) / this.row_height;
		rt.setDataListener(this.listener, { column_classes: true });
		if (this.rtl) apply_rtl(rt);
		this.apply_sizes();
		this.remove_styler = rt.addStyleListener(this.styler);
		rt.addEventListener("click", this.on_click);
		rt.addEventListener("dblclick", this.on_dblclick);
		rt.addEventListener("regular-table-scroll", this.on_scrolled);
		// Capture: regular-table's own resize handler (it assumes LTR) must not see the press.
		rt.addEventListener("pointerdown", this.on_press, true);
		rt.addEventListener("mousedown", this.on_press, true);
		this.mounted();
		// The table's inner width, kept here: reading it while drawing forced a layout.
		this.rt_width = rt.clientWidth;
		this.resize_observer = frame_resize_observer(() => {
			if (this.rt !== rt || !this.current) return;
			this.rt_width = rt.clientWidth;
			this.resized();
			rt.draw();
		});
		this.resize_observer.observe(rt);
		this.fit_scroll_range();
	}

	mounted() {}

	unmounting() {}

	/** The table changed size: the rows pinned under the headers follow its width. */
	resized() {
		this.fit_top();
	}

	cleared() {}

	/**
	 * regular-table 0.9.1 ends its horizontal scroll on a column boundary: the range is
	 * longer than the columns, and the end of the scroll left an empty strip after the last
	 * column. With sub-column scrolling (rv_table.css --rv-sx) the range is exactly the
	 * width of the columns: the library's virtual panel is set to it whenever the library
	 * writes it (its shadow DOM, like rtl_adapter.js; the version is pinned).
	 */
	fit_scroll_range() {
		const rt = this.rt;
		const panel = rt.shadowRoot?.querySelector(".rt-virtual-panel");
		if (!panel) return;
		const fit = () => {
			if (!this.model || this.rt !== rt) return;
			const nominal = this.size_widths();
			// A column is never narrower than drawn (regular-table's measured widths).
			const measured = rt.e?.indices || [];
			const total = nominal.reduce((sum, w, i) => sum + Math.max(w, measured[i] || 0), 0);
			// The cached width: the library writes the panel on every draw, and reading the
			// element's width here forced a layout in the middle of each draw.
			if (total <= (this.rt_width || rt.clientWidth)) return;
			const want = `${Math.ceil(total)}px`;
			if (panel.style.width !== want) panel.style.width = want;
		};
		this.panel_observer = new MutationObserver(fit);
		this.panel_observer.observe(panel, { attributes: true, attributeFilter: ["style"] });
		fit();
	}

	/**
	 * Column widths are ours (design widths or the view state), not auto-sized: an override
	 * per column. Row headers come first in regular-table's size keys.
	 */
	apply_sizes() {
		// Header widths are read again on the next draw (style()).
		this.widths_version += 1;
		const widths = this.size_widths();
		const sizes = {};
		widths.forEach((w, i) => (sizes[i] = w));
		this.rt.restoreColumnSizes(sizes);
		const pin_width = widths.slice(0, this.size_heads()).reduce((a, b) => a + b, 0);
		this.host.style.setProperty("--rv-pin-w", `${pin_width}px`);
		this.pinned_signature = null;
	}

	// The rows pinned under the headers span the table, not its vertical scrollbar.
	fit_top() {
		if (this.top_el && this.rt && this.rt_width) this.top_el.style.width = `${this.rt_width}px`;
	}

	unmount() {
		if (this.panel_observer) this.panel_observer.disconnect();
		this.panel_observer = null;
		if (this.resize_observer) this.resize_observer.disconnect();
		this.resize_observer = null;
		if (this.stop_resize) this.stop_resize();
		if (this.rt) {
			this.unmounting();
			this.rt.removeEventListener("click", this.on_click);
			this.rt.removeEventListener("dblclick", this.on_dblclick);
			this.rt.removeEventListener("regular-table-scroll", this.on_scrolled);
			this.rt.removeEventListener("pointerdown", this.on_press, true);
			this.rt.removeEventListener("mousedown", this.on_press, true);
			if (this.remove_styler) this.remove_styler();
		}
		this.remove_styler = null;
		this.rt = null;
		this.host = null;
		this.top_el = null;
		this.bottom_el = null;
		this.signature = null;
		this.pinned_signature = null;
		this.drawn = null;
		this.header_key = null;
	}

	/** Detach from the engine view(s) (the caller deletes them) and remove the table. */
	destroy() {
		this.current = null;
		this.model = null;
		this.windows = [];
		this.cleared();
		this.unmount();
		this.parent.replaceChildren();
	}

	// ------------------------------------------------------------ scroll

	// The rows pinned outside the table follow its sub-column shift (rv_table.css --rv-sx).
	// The value is read from the rule regular-table writes it to (its `f` field in 0.9.1,
	// pinned like rtl_adapter.js), not from computed style, which forced a style pass per
	// frame. A scroll inside one column redraws nothing, so this also runs after a scroll.
	sync_sub_x() {
		const rt = this.rt;
		if (!rt || !this.host) return;
		const raw = parseFloat(rt.f?.style?.getPropertyValue("--regular-table--transform-x")) || 0;
		const x = this.rtl ? -raw : raw;
		if (x !== this.sub_x) {
			this.sub_x = x;
			this.host.style.setProperty("--rv-sx-out", `${x}px`);
		}
	}

	// After a scroll: layout is settled, reading the scroll position costs nothing more.
	scrolled() {
		this.sync_sub_x();
		this.host?.classList.toggle("scrolled-x", Math.abs(this.rt?.scrollLeft || 0) > 0);
	}

	// ------------------------------------------------------------ headers as drawn

	/**
	 * Widths of the header cells as drawn (a cell never gets narrower than its content, so
	 * the pinned rows copy the header cells, not the nominal widths), and a tooltip for a
	 * title cut by its column. Read from layout only when the columns on screen changed: a
	 * vertical scroll draws the same header, and reading layout after writing the cells
	 * forced a layout on every frame.
	 * @param {Array<{th: Element, text: string, col: object|null, head: number, x: number}>} leaves
	 *   the cells of the title row: `col` a data column, else `head` = 0 the label, > 0 a
	 *   pinned column (regular-table row headers)
	 * @param {number[]} shown the data columns on screen
	 * @returns {boolean} whether the widths were read again
	 */
	measure_headers(leaves, shown) {
		const header_key = `${this.epoch}:${this.widths_version}:${shown.join(",")}:${this.rt_width}`;
		if (header_key === this.header_key && this.drawn) return false;
		this.header_key = header_key;
		const drawn = { label: null, pinned: [], data: new Map() };
		for (const { th, text, col, head, x } of leaves) {
			const w = th.getBoundingClientRect().width;
			if (col) drawn.data.set(x, w);
			else if (head === 0) drawn.label = w;
			else if (head > 0) drawn.pinned[head - 1] = w;
			if (th.scrollWidth > th.clientWidth) th.title = text;
			else th.removeAttribute("title");
		}
		this.drawn = drawn;
		// The edge line of the pinned columns follows them as drawn, not their nominal widths.
		if (drawn.label) {
			const pin_w = drawn.label + drawn.pinned.reduce((a, w) => a + (w || 0), 0);
			this.host.style.setProperty("--rv-pin-w", `${pin_w.toFixed(2)}px`);
		}
		return true;
	}

	// Width of a column in the pinned rows: as drawn in the header, else the nominal one.
	drawn_width(kind, key, nominal) {
		const d = this.drawn;
		const w = !d ? null : kind === "label" ? d.label : kind === "pinned" ? d.pinned[key] : d.data.get(key);
		return w ? `${w.toFixed(2)}px` : `${nominal}px`;
	}

	// ------------------------------------------------------------ cells

	/**
	 * Classes and content of a body cell.
	 * @param {Element} cell
	 * @param {object} flags {class: boolean} over `this.cell_classes`
	 * @param {{html: string, sign: string}} out
	 */
	style_cell(cell, flags, out) {
		for (const name of this.cell_classes) cell.classList.toggle(name, Boolean(flags[name]));
		// The cell keeps its one .rv-cc element: a new element per cell and frame made the
		// browser compute the style of every cell again on each scroll step.
		let cc = cell.firstElementChild;
		if (!cc || cell.childNodes.length !== 1 || !cc.classList.contains("rv-cc")) {
			cc = document.createElement("div");
			cc.className = "rv-cc";
			cell.replaceChildren(cc);
		}
		if (CELL_HTML.get(cc) === out.html) return;
		CELL_HTML.set(cc, out.html);
		// A bare number (<bdi class="rv-n">…</bdi>) or plain text goes in as text: no element.
		const number = BARE_NUMBER.exec(out.html);
		const text = number ? number[1] : out.html;
		cc.classList.toggle("rv-n", Boolean(number));
		if (/[<&]/.test(text)) cc.innerHTML = text;
		else cc.textContent = text;
	}

	// ------------------------------------------------------------ column widths (#39)

	set_width(target, width) {
		const w = Math.max(MIN_COLUMN_WIDTH, Math.round(width));
		if (w === this.width_of(target)) return false;
		this.assign_width(target, w);
		this.apply_sizes();
		this.render_pinned();
		this.rt.draw();
		return true;
	}

	// Drag of our handle at the end edge of a header cell (the span regular-table puts there).
	press(event) {
		const handle = event.target.closest?.(".rt-column-resize");
		if (!handle || !this.rt?.contains(handle)) return;
		event.stopPropagation();
		if (event.type !== "pointerdown" || event.button !== 0) return;
		const target = this.resize_target(handle.closest("th"));
		if (!target) return;
		event.preventDefault();
		const start = { x: event.clientX, width: this.width_of(target) };
		const direction = this.rtl ? -1 : 1;
		let changed = false;
		const move = (e) => {
			changed = this.set_width(target, start.width + direction * (e.clientX - start.x)) || changed;
		};
		const stop = () => {
			window.removeEventListener("pointermove", move, true);
			window.removeEventListener("pointerup", stop, true);
			window.removeEventListener("pointercancel", stop, true);
			this.host?.classList.remove("resizing");
			this.stop_resize = null;
			if (changed) this.width_changed(target);
		};
		this.stop_resize = stop;
		this.host.classList.add("resizing");
		window.addEventListener("pointermove", move, true);
		window.addEventListener("pointerup", stop, true);
		window.addEventListener("pointercancel", stop, true);
	}

	// Double click on the handle: the width of the content on screen.
	dblclick(event) {
		const handle = event.target.closest?.(".rt-column-resize");
		if (!handle || !this.rt?.contains(handle)) return;
		event.preventDefault();
		const th = handle.closest("th");
		const target = this.resize_target(th);
		if (!target) return;
		if (this.set_width(target, this.content_width(th, target))) this.width_changed(target);
	}

	// Widest content of a column among the cells on screen (header, body, pinned rows). The
	// boxes are as wide as their column: the content itself is measured.
	content_width(th, target) {
		const rt = this.rt;
		const pad = 2 * this.cell_padding + 2;
		const range = document.createRange();
		const natural = (el) => {
			range.selectNodeContents(el);
			return Math.ceil(range.getBoundingClientRect().width);
		};
		const table = rt.querySelector("table");
		table.classList.add("rv-measure");
		// The title cell (components/header_cells.js, or regular-table's own span) is as wide
		// as its column: its label is measured, plus the room of the column-menu button.
		const title = th.querySelector(".rv-hlabel") || th.firstElementChild;
		let width = natural(title) + pad + 8 + (th.querySelector(".rv-hmenu") ? 26 : 0);
		const selector = target.head === undefined ? "tbody td" : "tbody th";
		for (const cell of rt.querySelectorAll(selector)) {
			const meta = rt.getMeta(cell);
			const same = target.head === undefined ? meta?.x === target.x : (meta?.row_header_x || 0) === target.head;
			const inner = same && cell.firstElementChild;
			if (!inner) continue;
			const indent = parseFloat(getComputedStyle(inner).paddingInlineStart) || 0;
			width = Math.max(width, natural(inner) + indent + pad);
		}
		table.classList.remove("rv-measure");
		for (const cell of this.host.querySelectorAll(`.rv-row [data-col="${CSS.escape(target.key)}"]`)) {
			width = Math.max(width, natural(cell) + pad);
		}
		return Math.min(MAX_AUTO_WIDTH, width);
	}
}
