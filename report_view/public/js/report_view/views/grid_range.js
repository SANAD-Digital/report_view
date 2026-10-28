// Cell range selection on the grid (phase 5c; docs/architecture.md §8أ.5): methods of GridView
// kept in their own module and installed on its prototype (views/grid_view.js), as the page
// does with host/*.js. The range is held in data coordinates (state/range.js: display row +
// column key + row identity), drawn by the style listener (paint_range: classes only), moved by
// the mouse (press and drag), the keyboard (Shift + arrows) and the touch (tap; a long press
// opens the context menu), and found again by the identity of its rows when the rows are laid
// out again (a fold, a sort, a filter).
//
// Its values (range_data) are read from the engine: the main view's window of the range for
// a view of report rows, the view's group rows for a grouped one, and a temporary view of the
// range's report rows (RID in …) where the grouped view does not hold them; never from the DOM.

import { RangeSelection, range_end, rect_cells, in_rect, step_cell, countable_rows } from "../state/range.js";
import { engine_value } from "./rt_base.js";
import { RID } from "../engine/schema.js";

const LONG_PRESS_MS = 500;
const TOUCH_SLOP = 8;
const EDGE_SCROLL = 28;
const SEL_CLASSES = ["rv-sel", "rv-sel-t", "rv-sel-b", "rv-sel-s", "rv-sel-e", "rv-cur"];
const in_field = (el) => Boolean(el?.closest?.("input,textarea,select,[contenteditable=''],[contenteditable=true]"));
// what a press on it does already (fold, details, resize, a link of the report)
const OWN_CONTROL = ".rv-caret,.rv-rd-btn,.rt-column-resize,button,input,select,textarea";

export class GridRange {
	/** Called from the constructor. */
	init_range() {
		this.range = new RangeSelection();
		// Report View Settings range_selection (ADR-023): off, the grid selects nothing
		this.range_enabled = true;
		this.on_range = () => {};
		this.on_range_menu = () => {};
		this.on_copy = () => {};
		this.range_painted = false;
		this.on_range_down = (e) => this.range_down(e);
		this.on_range_key = (e) => this.range_key(e);
		this.on_range_menu_event = (e) => this.range_contextmenu(e);
	}

	listen_range(rt, on) {
		const fn = on ? "addEventListener" : "removeEventListener";
		rt[fn]("pointerdown", this.on_range_down);
		rt[fn]("keydown", this.on_range_key);
		rt[fn]("contextmenu", this.on_range_menu_event);
		if (on) {
			// the body takes the keyboard for the range (its own controls keep theirs)
			rt.tabIndex = 0;
			rt.setAttribute("aria-multiselectable", "true");
		}
	}

	// ------------------------------------------------------------ columns and cells

	/** The grid's columns in range order: the label, the pinned ones, the data columns. */
	range_columns() {
		const m = this.model;
		if (!m) return [];
		return [{ column: m.label, numeric: false, totalled: false, title: m.label_title, head: 0 }, ...m.pinned.map((d, i) => ({ ...d, head: i + 1 })), ...m.data];
	}

	range_keys() {
		return this.range_columns().map((d) => d.column.key);
	}

	/** The rectangle of the range now, or null. */
	range_rect() {
		if (!this.range_enabled || !this.range.active || this.range_pending || !this.layout) return null;
		const r = this.range.rect(this.range_keys());
		if (!r || r.y1 >= this.body_rows) return null;
		return r;
	}

	/** The cell of the body a DOM element is in: {y, c, cell}, or null (header, pinned rows). */
	cell_of(el) {
		const cell = el?.closest?.("td,th");
		const rt = this.rt;
		if (!cell || !rt?.contains(cell) || !cell.closest("tbody")) return null;
		const meta = rt.getMeta(cell);
		if (!meta || meta.y === undefined) return null;
		const c = cell.tagName === "TH" ? meta.row_header_x || 0 : this.model.heads + meta.x;
		return { y: meta.y, c, cell };
	}

	/** The record of a display row when it is in a window read for the screen. */
	rec_at(y) {
		const win = this.windows.find((w) => w.epoch === this.epoch && w.recs.has(y));
		return win ? win.recs.get(y) : null;
	}

	/** The path of a group of a grouped view, by its view row. */
	path_of(view_row) {
		const cur = this.current;
		if (!cur) return null;
		if (cur.fold) {
			const g = cur.fold.group_at[view_row];
			return g >= 0 ? cur.fold.paths[g] : null;
		}
		return cur.paths?.[view_row] || null;
	}

	/** The identity of a record: a report row by __rid, a group by its path, a subtotal by its group. */
	id_of(rec, y) {
		if (!rec) return null;
		if (rec.type === "spacer") return `s:${y}`;
		if (rec.type === "foot") {
			const of = this.id_of({ ...rec.of, view_row: rec.view_row }, y);
			return of ? `f:${of}` : null;
		}
		if (rec.type === "row") return `r:${rec.row.__rid}`;
		const path = this.path_of(rec.view_row);
		return path ? `g:${JSON.stringify(path)}` : null;
	}

	async identify(y) {
		const known = this.rec_at(y);
		if (known) return this.id_of(known, y);
		const cur = this.current;
		const plan = this.rows.plan(this.layout, y, 1);
		const recs = await this.rows.read_records(cur, plan, this.layout);
		return this.current === cur ? this.id_of(recs.get(y), y) : null;
	}

	// ------------------------------------------------------------ changing the range

	/** Sets (or extends) the range to a cell and tells the page. */
	select_cell(y, c, extend = false) {
		const keys = this.range_keys();
		if (!keys.length || !this.body_rows) return;
		y = Math.max(0, Math.min(this.body_rows - 1, y));
		c = Math.max(0, Math.min(keys.length - 1, c));
		const end = range_end(y, keys[c], this.rec_at(y) ? this.id_of(this.rec_at(y), y) : null);
		if (extend && this.range.active) this.range.extend(end);
		else this.range.set(end);
		this.range_changed();
	}

	/** Every cell of the body. */
	select_all() {
		const keys = this.range_keys();
		if (!keys.length || !this.body_rows) return;
		this.range.set(range_end(0, keys[0]), range_end(this.body_rows - 1, keys[keys.length - 1]));
		this.range_changed();
	}

	clear_range() {
		if (this.range.clear()) this.range_changed();
	}

	range_changed() {
		this.paint_range();
		this.fill_ids();
		this.on_range(this.range_rect());
	}

	// The identity of each end, read when its row was not on screen (a keyboard move, select all).
	async fill_ids() {
		const sel = this.range;
		const version = sel.version;
		for (const end of [sel.anchor, sel.focus]) {
			if (!end || end.id) continue;
			let id = null;
			try {
				id = await this.identify(end.y);
			} catch {
				id = null;
			}
			if (sel.version !== version) return;
			end.id = id;
		}
	}

	// ------------------------------------------------------------ after a new layout

	/**
	 * The rows were laid out again (set_layout): each end of the range is found again by its
	 * row's identity. An end whose row is no longer shown (folded away, filtered out) clears the
	 * range; the page is told either way.
	 */
	relayout_range() {
		if (!this.range.active) return;
		const sel = this.range;
		const version = sel.version;
		const ids = [sel.anchor.id, sel.focus.id];
		if (!ids[0] || !ids[1]) {
			sel.clear();
			this.range_changed();
			return;
		}
		this.range_pending = true;
		const epoch = this.epoch;
		Promise.all(ids.map((id) => this.locate(id)))
			.catch(() => [null, null])
			.then(([a, f]) => {
				if (sel.version !== version || this.epoch !== epoch) return;
				this.range_pending = false;
				if (a === null || f === null) sel.clear();
				else {
					sel.anchor.y = a;
					sel.focus.y = f;
					sel.version += 1;
				}
				this.range_changed();
			});
	}

	/** The display row of a row identity in the current layout, or null when it is not shown. */
	async locate(id) {
		const cur = this.current;
		const layout = this.layout;
		if (!cur || !layout) return null;
		const kind = id.slice(0, 2);
		if (kind === "s:") {
			const y = Number(id.slice(2));
			return y < layout.top ? y : null;
		}
		const foot = kind === "f:";
		const inner = foot ? id.slice(2) : id;
		const view_row = await this.view_row_of(inner.slice(0, 2), inner.slice(2));
		if (view_row === null || this.current !== cur || this.layout !== layout) return null;
		for (let i = 0; i < layout.rows.length; i++) {
			if (layout.rows[i] === view_row && Boolean(layout.foot[i]) === foot) return layout.top + i;
		}
		return null;
	}

	// The view row of a report row (by __rid) or of a group (by its path), read from the view.
	async view_row_of(kind, key) {
		const cur = this.current;
		const post = cur.post;
		if (kind === "g:") {
			const path = key;
			if (cur.fold) {
				const g = cur.fold.paths.findIndex((p) => JSON.stringify(p) === path);
				if (g < 0) return null;
				const row = cur.fold.group_at.indexOf(g);
				return row < 0 ? null : row;
			}
			const row = (cur.paths || []).findIndex((p) => JSON.stringify(p) === path);
			return row < 0 ? null : row;
		}
		const rid = Number(key);
		if (cur.fold) {
			const at = post.leaves.index[RID];
			const cols = await cur.leaves.to_columns({ start_col: at, end_col: at + 1 });
			const f = (cols[RID] || []).indexOf(rid);
			if (f < 0) return null;
			const row = cur.fold.leaf_at.indexOf(f);
			return row < 0 ? null : row;
		}
		if (post.row_offset) {
			const row = (cur.paths || []).findIndex((p) => p.length === post.leaf_depth && p[p.length - 1] === rid);
			return row < 0 ? null : row;
		}
		const at = post.index[RID];
		const cols = await cur.view.to_columns({ start_col: at, end_col: at + 1 });
		const row = (cols[RID] || []).indexOf(rid);
		return row < 0 ? null : row;
	}

	// ------------------------------------------------------------ drawing

	/** Classes of the cells on screen inside the range (style listener; no layout read). */
	paint_range() {
		const rt = this.rt;
		if (!rt) return;
		const r = this.range_rect();
		if (!r && !this.range_painted) return;
		this.range_painted = Boolean(r);
		const focus = r ? { y: this.range.focus.y, c: this.range_keys().indexOf(this.range.focus.key) } : null;
		const heads = this.model.heads;
		for (const tr of rt.querySelectorAll("tbody tr")) {
			const lead = tr.firstElementChild;
			const meta = lead && rt.getMeta(lead);
			const y = meta?.y;
			const row_in = r && y !== undefined && y >= r.y0 && y <= r.y1;
			for (let cell = lead; cell; cell = cell.nextElementSibling) {
				if (!row_in) {
					if (cell.classList.contains("rv-sel")) for (const k of SEL_CLASSES) cell.classList.remove(k);
					continue;
				}
				const cm = cell === lead ? meta : rt.getMeta(cell);
				if (!cm) continue;
				const c = cell.tagName === "TH" ? cm.row_header_x || 0 : heads + cm.x;
				const on = in_rect(r, y, c);
				cell.classList.toggle("rv-sel", on);
				cell.classList.toggle("rv-sel-t", on && y === r.y0);
				cell.classList.toggle("rv-sel-b", on && y === r.y1);
				cell.classList.toggle("rv-sel-s", on && c === r.c0);
				cell.classList.toggle("rv-sel-e", on && c === r.c1);
				cell.classList.toggle("rv-cur", on && y === focus.y && c === focus.c && rect_cells(r) > 1);
				if (on) cell.setAttribute("aria-selected", "true");
				else cell.removeAttribute("aria-selected");
			}
		}
	}

	/** The focus end on screen: the rows by the row height, the columns by their widths. */
	reveal(y, c) {
		const rt = this.rt;
		if (!rt) return;
		const rh = this.row_height;
		// the part of the table in the window (a page taller than the window scrolls it out)
		const seen = Math.min(rt.clientHeight, window.innerHeight - rt.getBoundingClientRect().top);
		const fit = Math.max(1, Math.floor((seen - this.header_height) / rh) - 1);
		const top = rt.scrollTop / rh;
		if (y < top) rt.scrollTop = y * rh;
		else if (y > top + fit - 1) rt.scrollTop = (y - fit + 1) * rh;
		const m = this.model;
		const x = c - m.heads;
		if (x < 0) return;
		const measured = rt.e?.indices || [];
		const width = (i) => Math.max(m.data[i].width, measured[m.heads + i] || 0);
		let start = 0;
		for (let i = 0; i < x; i++) start += width(i);
		const pin = m.label_width + m.pinned.reduce((a, d) => a + d.width, 0);
		const room = Math.max(0, (this.rt_width || rt.clientWidth) - pin);
		const left = rt.scrollLeft;
		if (start < left) rt.scrollLeft = start;
		else if (start + width(x) > left + room) rt.scrollLeft = start + width(x) - room;
	}

	// ------------------------------------------------------------ mouse, touch, keyboard

	range_down(e) {
		if (!this.range_enabled || e.button > 0) return;
		const at = this.cell_of(e.target);
		if (!at) return;
		if (e.pointerType === "touch") {
			this.touch_press(e, at);
			return;
		}
		if (e.target.closest?.(OWN_CONTROL)) return;
		// the press selects; text is not selected while dragging
		e.preventDefault();
		this.rt.focus({ preventScroll: true });
		this.select_cell(at.y, at.c, e.shiftKey);
		this.drag_range(e);
	}

	// Drag: the focus end follows the pointer; near the edges the table scrolls.
	drag_range(e) {
		const rt = this.rt;
		let last = { x: e.clientX, y: e.clientY };
		let frame = 0;
		const follow = () => {
			const el = document.elementFromPoint(last.x, last.y);
			const at = el && this.cell_of(el);
			if (at) {
				const focus = this.range.focus;
				const key = this.range_keys()[at.c];
				if (!focus || focus.y !== at.y || focus.key !== key) this.select_cell(at.y, at.c, true);
			}
		};
		const tick = () => {
			frame = 0;
			const box = rt.getBoundingClientRect();
			const top = box.top + this.header_height;
			let dy = 0;
			if (last.y > box.bottom - EDGE_SCROLL) dy = this.row_height;
			else if (last.y < top + 4) dy = -this.row_height;
			if (dy) {
				rt.scrollTop += dy;
				frame = requestAnimationFrame(tick);
			}
			follow();
		};
		const move = (ev) => {
			last = { x: ev.clientX, y: ev.clientY };
			if (!frame) frame = requestAnimationFrame(tick);
		};
		const stop = () => {
			window.removeEventListener("pointermove", move, true);
			window.removeEventListener("pointerup", stop, true);
			window.removeEventListener("pointercancel", stop, true);
			if (frame) cancelAnimationFrame(frame);
			this.stop_drag = null;
		};
		this.stop_drag = stop;
		window.addEventListener("pointermove", move, true);
		window.addEventListener("pointerup", stop, true);
		window.addEventListener("pointercancel", stop, true);
	}

	// Touch: a tap selects the cell (the page scrolls as usual); a long press opens the menu.
	touch_press(e, at) {
		const start = { x: e.clientX, y: e.clientY };
		let timer = 0;
		const done = () => {
			clearTimeout(timer);
			window.removeEventListener("pointermove", move, true);
			window.removeEventListener("pointerup", up, true);
			window.removeEventListener("pointercancel", done, true);
		};
		const move = (ev) => {
			if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > TOUCH_SLOP) done();
		};
		const up = () => {
			done();
			if (!e.target.closest?.(OWN_CONTROL)) this.select_cell(at.y, at.c, false);
		};
		timer = setTimeout(() => {
			done();
			this.long_pressed = Date.now();
			const r = this.range_rect();
			if (!in_rect(r, at.y, at.c)) this.select_cell(at.y, at.c, false);
			this.on_range_menu({ x: start.x, y: start.y, y_row: at.y, c: at.c, cell: at.cell });
		}, LONG_PRESS_MS);
		window.addEventListener("pointermove", move, true);
		window.addEventListener("pointerup", up, true);
		window.addEventListener("pointercancel", done, true);
	}

	range_contextmenu(e) {
		if (!this.range_enabled) return;
		const at = this.cell_of(e.target);
		if (!at) return;
		e.preventDefault();
		// the long press opened it already (Android fires contextmenu too)
		if (this.long_pressed && Date.now() - this.long_pressed < 1000) return;
		if (!in_rect(this.range_rect(), at.y, at.c)) this.select_cell(at.y, at.c, false);
		this.on_range_menu({ x: e.clientX, y: e.clientY, y_row: at.y, c: at.c, cell: at.cell });
	}

	range_key(e) {
		if (!this.range_enabled || in_field(e.target)) return;
		// keys of the table body only: its own buttons (fold, details) keep Enter and Space
		const mod = e.ctrlKey || e.metaKey;
		const k = e.key;
		if (mod && (k === "a" || k === "A")) {
			e.preventDefault();
			this.select_all();
			return;
		}
		if (!this.range.active) {
			if (k.startsWith("Arrow") && e.target === this.rt) {
				e.preventDefault();
				this.select_cell(0, 0);
			}
			return;
		}
		if (k === "Escape") {
			if (this.clear_range_on_escape()) e.preventDefault();
			return;
		}
		if (mod && (k === "c" || k === "C")) {
			e.preventDefault();
			this.on_copy({ headers: e.shiftKey });
			return;
		}
		if (k === "ContextMenu" || (e.shiftKey && k === "F10")) {
			e.preventDefault();
			this.menu_at_focus();
			return;
		}
		const focus = this.range.focus;
		const keys = this.range_keys();
		const c = keys.indexOf(focus.key);
		const page = Math.max(1, Math.floor((this.rt.clientHeight - this.header_height) / this.row_height) - 1);
		const to = step_cell({ y: focus.y, c }, k, { rows: this.body_rows, cols: keys.length, rtl: this.rtl, page, ctrl: mod });
		if (!to) return;
		e.preventDefault();
		this.select_cell(to.y, to.c, e.shiftKey);
		this.reveal(to.y, to.c);
	}

	clear_range_on_escape() {
		return this.range.clear() ? (this.range_changed(), true) : false;
	}

	// The context menu from the keyboard: at the focus cell, or the table's corner when it is not drawn.
	menu_at_focus() {
		const r = this.range_rect();
		if (!r) return;
		const focus = this.range.focus;
		const c = this.range_keys().indexOf(focus.key);
		let box = null;
		for (const tr of this.rt.querySelectorAll("tbody tr")) {
			if (this.rt.getMeta(tr.firstElementChild)?.y !== focus.y) continue;
			for (const cell of tr.children) {
				const at = this.cell_of(cell);
				if (at && at.c === c) box = cell.getBoundingClientRect();
			}
		}
		const rt_box = this.rt.getBoundingClientRect();
		const x = box ? (this.rtl ? box.right - 4 : box.left + 4) : rt_box.left + 24;
		const y = box ? box.bottom : rt_box.top + this.header_height + 8;
		this.on_range_menu({ x, y, y_row: focus.y, c, cell: null });
	}

	// ------------------------------------------------------------ the values of the range

	/**
	 * The rows and cells of a range, read from the engine. Each row: its record and display
	 * row; each cell the value as the engine holds it (dates as text of the report), null where
	 * the grid shows no value (a group's column it does not total, the header of a group whose
	 * numbers stand in its subtotal row, a mixed-currency group). Spacer rows are left out.
	 * @param {{y0, y1, c0, c1}} r
	 * @param {object} [o] {own_view: keep the temporary view of the report rows open and
	 *   return it (the range chart reads it again and deletes it on close)}
	 * @returns {Promise<{columns: Array, rows: Array<{y, rec, cells: Array}>, countable: boolean[], view: object|null}|null>}
	 *   null when the view was replaced while it was read
	 */
	async range_data(r, { own_view = false } = {}) {
		const cur = this.current;
		const layout = this.layout;
		const session = this.session;
		const m = this.model;
		if (!cur || !layout || !m) return null;
		const columns = this.range_columns().slice(r.c0, r.c1 + 1);
		const n = r.y1 - r.y0 + 1;
		const plan = this.rows.plan(layout, r.y0, n);
		const recs = await this.rows.read_records(cur, plan, layout);
		if (this.current !== cur) return null;
		const post = cur.post;
		const grouped = post.row_offset === 1;
		const keys = columns.map((d) => d.column.key);

		// The report rows of a grouped view are not part of it (it holds the groups), nor are
		// the report rows of a tree's columns the totals leave out: a temporary view of the
		// range's report rows on the facts. With own_view, also for a view of report rows.
		const rids = [];
		for (const rec of recs.values()) if (rec.type === "row") rids.push(rec.row.__rid);
		const by_rid = new Map();
		let view = null;
		const want_rid_view = rids.length && (grouped || own_view);
		if (want_rid_view) {
			const table = session.tables[grouped ? "facts" : cur.spec.table];
			const config = { columns: [RID, ...keys.filter((k) => k !== RID)], filter: [[RID, "in", rids]] };
			const read = async (v) => {
				const cols = await v.to_columns();
				const ids = cols[RID] || [];
				for (let i = 0; i < ids.length; i++) by_rid.set(ids[i], i);
				return cols;
			};
			let rid_cols;
			if (own_view) {
				view = await session.handles.view(table, config, "range");
				try {
					rid_cols = await read(view);
				} catch (e) {
					await session.handles.delete(view);
					throw e;
				}
			} else rid_cols = await session.handles.with_view(table, config, read, "range");
			by_rid.cols = rid_cols;
		}
		const close = async () => {
			if (view && session.handles.is_alive(view)) await session.handles.delete(view);
		};
		if (this.current !== cur) {
			await close();
			return null;
		}
		// The view's own window: every column of a view of report rows; the totalled data
		// columns of a grouped one (its group rows).
		let named = null;
		let totals = null;
		try {
			if (!grouped && !own_view) named = await this.rows.read_named(cur, plan, keys);
			else if (grouped) {
				const x0 = Math.max(0, r.c0 - m.heads);
				const x1 = Math.max(0, r.c1 - m.heads + 1);
				totals = await this.rows.read_values(cur, plan, x0, x1);
			}
		} catch (e) {
			await close();
			if (this.current !== cur) return null;
			throw e;
		}
		if (this.current !== cur) {
			await close();
			return null;
		}

		const rid_value = (rid, key) => {
			const i = by_rid.get(rid);
			return i === undefined ? null : by_rid.cols[key]?.[i] ?? null;
		};
		const rows = [];
		const entries = [];
		plan.entries.forEach((entry, i) => {
			const y = r.y0 + i;
			const rec = recs.get(y);
			if (!rec || rec.type === "spacer") return;
			const group = rec.type === "foot" ? rec.of : rec;
			const open = rec.type !== "foot" && Boolean(rec.open) && (rec.type === "group" || rec.parent);
			const blank = Boolean(m.subtotals && open);
			const view_row = entry.row;
			const cells = columns.map((d) => {
				const key = d.column.key;
				const numeric = d.numeric;
				// the label of a group and of a subtotal row: what the row is called
				if (d.head === 0 && rec.type !== "row") {
					if (rec.type === "foot" || group.node) return this.rows.foot_text(group);
					return engine_value(m.by_key.get(group.key), group.value ?? null);
				}
				if (group.type === "group") {
					if (!numeric || !d.totalled || blank) return null;
					if (group.mixed?.[d.currency_key]) return null;
					return this.rows.value_of(totals, plan, view_row, key);
				}
				// a report row, or the subtotal row of a tree parent (its own values)
				if (rec.type === "foot" && !numeric) return null;
				if (rec.type === "row" && blank && numeric) return null;
				const raw = grouped || own_view ? rid_value(group.row.__rid, key) : this.rows.value_of(named, plan, view_row, key);
				return engine_value(d.column, raw);
			});
			rows.push({ y, rec, cells });
			entries.push({
				kind: rec.type === "row" && this.rows.is_summary(rec) ? "summary" : rec.type === "row" ? "row" : rec.type,
				depth: rec.type === "foot" ? group.depth : rec.depth,
				open,
				blank,
			});
		});
		return { columns, rows, countable: countable_rows(entries), view };
	}
}
