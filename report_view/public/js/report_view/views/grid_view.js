// Grid view on <regular-table> (docs/architecture.md §11.1 #32, #35, #39, #45-#52; §11.2).
// Nothing is computed here. The virtual data model reads windows of the Perspective view
// (view.to_columns); rows that are report rows are shown with the report's own values
// (fetched by __rid, §9.3), rows Perspective computed (groups, grand total) with the
// values of the view. Classes and content of every cell are set in the style listener.
//
// Shapes of the view (engine/view_config.js): "tree" = the report tree as it came (nodes
// table, folded by an engine filter); "report" = the rows of a report as it came, its own
// opening / total / closing rows between the facts (rows table); "flat" = the facts;
// "group" / "levels" = a grouped view of the facts, opened and closed with view.expand /
// view.collapse.
//
// Rows of the body (engine/row_layout.js): the rows of the view, a subtotal row after every
// open group (the values of the group's own row), and spacer rows under the report rows that
// are pinned below the headers. Pinned above and below, outside the scrolling body: the
// report's own opening / closing rows and the grand total.

import { apply_rtl } from "./rtl_adapter.js";
import { perspective_type, RID, KIND } from "../engine/schema.js";
import { DEPTH, HAS_CHILDREN, LEAVES, LEVELS } from "../engine/tree_nodes.js";
import { CURRENCY_COUNT_PREFIX } from "../engine/view_config.js";
import { build_layout, entry_at, expanded_from_paths } from "../engine/row_layout.js";
import { MIN_COLUMN_WIDTH } from "../state/view_state.js";

const ROW_PATH = "__ROW_PATH__";
const CELL_CLASSES = ["num", "dr", "cr", "band-end", "zero", "neg"];
const MAX_AUTO_WIDTH = 640;
// Pinned columns next to the label need room: on a narrower grid only the label is pinned.
const MIN_WIDTH_FOR_PINS = 600;
// View rows this close are read in one window.
const RUN_GAP = 8;
// A column without a band: not the empty string, so that regular-table does not merge its
// band cell with the one of the pinned columns.
const NO_BAND = " ";
// Rows of the view that carry groups to fold (the others are plain lists of report rows).
const HIERARCHICAL = new Set(["tree", "levels", "group"]);
// Class of a summary row of the report, in the body and pinned: the design's subtotal row
// (.rv-row.foot) for a total and a closing, the opening row of its statement drawer
// (.rv-drow.op) for an opening.
const SUMMARY_CLASS = { opening: "opening", internal_total: "foot", closing: "foot closing", group_header: "group d0" };
const CHEVRON =
	'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>';

function esc(s) {
	return frappe.utils.escape_html(String(s ?? ""));
}

function empty(v) {
	return v === null || v === undefined || v === "";
}

function caret(open) {
	const label = open ? __("Collapse group") : __("Expand group");
	return `<button type="button" class="rv-caret${open ? " open" : ""}" aria-expanded="${open}" aria-label="${esc(label)}" title="${esc(label)}">${CHEVRON}</button>`;
}

function css_int(el, name, fallback) {
	const v = parseInt(getComputedStyle(el).getPropertyValue(name), 10);
	return Number.isFinite(v) ? v : fallback;
}

// A group value as the report would carry it: Perspective returns dates as milliseconds.
function group_value(column, value) {
	if (value === null || value === undefined || !column) return value;
	const type = perspective_type(column.fieldtype);
	if (type === "date" && typeof value === "number") return new Date(value).toISOString().slice(0, 10);
	if (type === "datetime" && typeof value === "number") {
		return new Date(value).toISOString().slice(0, 19).replace("T", " ");
	}
	if (type === "boolean") return value ? 1 : 0;
	return value;
}

export class GridView {
	/**
	 * @param {object} opts
	 * @param {HTMLElement} opts.parent
	 * @param {boolean} opts.rtl
	 * @param {(rid: number) => void} opts.on_tree_toggle a parent of the report tree was opened or closed
	 * @param {(expanded: "all"|"none"|Array) => void} opts.on_fold_changed a group was opened or closed
	 * @param {(key: string, width: number) => void} opts.on_column_resized a column got a new width
	 * @param {import("../components/header_cells.js").HeaderCells} opts.cells title and filter cells of the headers
	 */
	constructor({ parent, rtl, on_tree_toggle, on_fold_changed, on_column_resized, cells }) {
		this.parent = parent;
		this.rtl = rtl;
		this.cells = cells;
		this.on_tree_toggle = on_tree_toggle || (() => {});
		this.on_fold_changed = on_fold_changed || (() => {});
		this.on_column_resized = on_column_resized || (() => {});
		this.rt = null;
		this.current = null;
		this.model = null;
		this.layout = null;
		this.signature = null;
		this.epoch = 0;
		this.windows = [];
		this.rendered = new WeakMap();
		this.html_cache = new Map();
		this.captions = new Map();
		this.cache_owner = null;
		this.refocus = null;
		this.listener = (x0, y0, x1, y1) => this.read(x0, y0, x1, y1);
		this.styler = () => this.style();
		this.on_click = (e) => this.click(e);
		this.on_press = (e) => this.press(e);
		this.on_dblclick = (e) => this.dblclick(e);
	}

	// ------------------------------------------------------------ model

	build_model(report, state, config, post) {
		const by_key = new Map(report.columns.map((c) => [c.key, c]));
		const col_conf = config.columns || {};
		const bands = new Map((config.bands || []).map((b) => [b.id, b]));
		const translate_label = report.__report_type === "Query Report";
		const title = (c) => col_conf[c.fieldname]?.label || (translate_label ? __(c.label) : c.label);
		const totalled = new Set(post.measures);
		const widths = state.columns.widths;
		const label = by_key.get(post.label_key);
		// Label column: design width 320px, narrower on phones so numbers stay visible.
		const label_width =
			widths[label.key] || Math.round(Math.min(320, Math.max(170, this.parent.clientWidth * 0.5)));

		const describe = (key) => {
			const column = by_key.get(key);
			const conf = col_conf[column.fieldname] || {};
			const numeric = column.role === "measure";
			return {
				column,
				title: title(column),
				numeric,
				side: conf.side === "dr" || conf.side === "cr" ? conf.side : null,
				band: conf.band && bands.get(conf.band) ? conf.band : null,
				band_end: false,
				totalled: totalled.has(key),
				currency_key: column.currency?.kind === "row" ? column.currency.key : null,
				index: post.index[key],
				width: widths[key] || conf.width || (numeric ? Math.max(column.width || 0, 138) : column.width || 140),
			};
		};
		// columns.pinned.start: row headers of regular-table next to the label column.
		const roomy = this.parent.clientWidth >= MIN_WIDTH_FOR_PINS;
		const pinned = roomy ? post.pinned_keys.map(describe) : [];
		const data = (roomy ? post.data_keys : [...post.pinned_keys, ...post.data_keys]).map(describe);
		for (const p of pinned) p.band = null;
		data.forEach((d, i) => {
			d.band_end = Boolean(d.band) && data[i + 1]?.band !== d.band;
		});
		const levels = data.some((d) => d.band) ? 2 : 1;
		// Header rows: the bands (when any), the titles, then the floating filters. Title and
		// filter cells are elements of components/header_cells.js, the same ones every draw.
		const head = (d) => [this.cells.leaf(d.column.key, d.title, d.numeric), this.cells.filter(d.column.key, d.title)];
		return {
			shape: post.shape,
			hierarchical: HIERARCHICAL.has(post.shape),
			subtotals: post.subtotals && HIERARCHICAL.has(post.shape),
			label,
			label_title: title(label),
			label_width,
			// "number + name" label (register tree.number_key / tree.name_key) of the tree column.
			parts: config.tree?.name_key && (config.tree.label_key || report.tree?.label_key) === label.key ? config.tree : null,
			pinned,
			heads: 1 + pinned.length,
			data,
			levels,
			header_rows: levels + 1,
			headers: data.map((d) => (levels === 2 ? [d.band ? bands.get(d.band).label : NO_BAND, ...head(d)] : head(d))),
			by_key,
		};
	}

	// ------------------------------------------------------------ show / destroy

	/**
	 * Show an opened view (ReportSession.open). The view is swapped into the data model
	 * before the caller deletes the previous one.
	 * @param {object} p {report, opened, session, state, config, fmt}
	 */
	async show({ report, opened, session, state, config, fmt }) {
		if (!opened.post.label_key) {
			this.destroy();
			return;
		}
		const model = this.build_model(report, state, config, opened.post);
		const density = state.ui?.density;
		// What needs a new table: the columns and the density. Widths and rows do not.
		const signature = JSON.stringify({
			label: model.label.key,
			pinned: model.pinned.map((d) => d.column.key),
			cols: model.data.map((d) => [d.column.key, d.band]),
			density,
		});
		if (this.cache_owner !== report || this.fmt !== fmt) {
			this.html_cache.clear();
			this.cache_owner = report;
		}
		this.fmt = fmt;
		this.session = session;
		this.model = model;
		// Captions depend on the columns shown, not only on the report.
		this.captions.clear();
		this.current = opened;
		this.counts = { ...opened.counts };
		this.set_layout(opened);
		if (!this.rt || this.signature !== signature) this.mount(signature);
		else this.apply_sizes();
		this.render_pinned();
		await this.rt.draw();
		this.restore_focus();
	}

	// The rows of the body from the rows of the view (no calculation: placement only).
	set_layout(opened) {
		const depths = opened.depths || new Uint8Array(opened.body_rows);
		this.layout = build_layout(depths, {
			subtotals: this.model.subtotals,
			top: opened.post.pinned_rows.top.length,
		});
		this.body_rows = this.layout.size;
		this.epoch += 1;
		this.windows = [];
	}

	mount(signature) {
		this.unmount();
		this.signature = signature;
		const host = document.createElement("div");
		host.className = "rv-rt";
		host.innerHTML =
			`<div class="rv-rt-scroll"><regular-table></regular-table><div class="rv-rt-top"></div><div class="rv-rt-edge pin-edge-s"></div></div>` +
			`<div class="rv-rt-bottom"></div>`;
		this.parent.replaceChildren(host);
		this.host = host;
		this.top_el = host.querySelector(".rv-rt-top");
		this.bottom_el = host.querySelector(".rv-rt-bottom");
		const rt = host.querySelector("regular-table");
		this.rt = rt;
		// Body rows are --rh high plus their 1px line; header rows have their own heights.
		this.row_height = css_int(host, "--rh", 36) + 1;
		this.header_height =
			(this.model.levels === 2 ? css_int(host, "--bh", 30) : 0) + css_int(host, "--hh", 34) + css_int(host, "--fh", 38);
		this.cell_padding = css_int(host, "--cp", 12);
		this.top_el.style.top = `${this.header_height}px`;
		// regular-table sizes its scroll range as if a header row were as high as a body row
		// (panel = rows * h + levels * h; rows that fit = height / h - levels). The design's
		// header rows are lower, which left an empty strip of up to 10px under the last row at
		// the end of the scroll. Reporting the difference as a fraction of a row less makes
		// both formulas exact for the real header height (the data listener answers with one
		// row more than asked, so the bottom edge is always filled).
		this.row_trim = Math.max(0, this.model.header_rows * this.row_height - this.header_height) / this.row_height;
		rt.setDataListener(this.listener, { column_classes: true });
		if (this.rtl) apply_rtl(rt);
		this.apply_sizes();
		this.remove_styler = rt.addStyleListener(this.styler);
		rt.addEventListener("click", this.on_click);
		rt.addEventListener("dblclick", this.on_dblclick);
		// Capture: regular-table's own resize handler (it assumes LTR) must not see the press.
		rt.addEventListener("pointerdown", this.on_press, true);
		rt.addEventListener("mousedown", this.on_press, true);
		this.resize_observer = new ResizeObserver(() => {
			if (this.rt !== rt || !this.current) return;
			this.fit_top();
			rt.draw();
		});
		this.resize_observer.observe(rt);
	}

	/**
	 * Column widths are ours (design widths or the view state), not auto-sized: an override
	 * per column. Row headers come first in regular-table's size keys.
	 */
	apply_sizes() {
		const m = this.model;
		const widths = [m.label_width, ...m.pinned.map((d) => d.width), ...m.data.map((d) => d.width)];
		const sizes = {};
		widths.forEach((w, i) => (sizes[i] = w));
		this.rt.restoreColumnSizes(sizes);
		const pin_width = widths.slice(0, m.heads).reduce((a, b) => a + b, 0);
		this.host.style.setProperty("--rv-pin-w", `${pin_width}px`);
		this.pinned_signature = null;
	}

	// The rows pinned under the headers span the table, not its vertical scrollbar.
	fit_top() {
		if (this.top_el && this.rt) this.top_el.style.width = `${this.rt.clientWidth}px`;
	}

	unmount() {
		if (this.resize_observer) this.resize_observer.disconnect();
		this.resize_observer = null;
		if (this.stop_resize) this.stop_resize();
		if (this.rt) {
			this.rt.removeEventListener("click", this.on_click);
			this.rt.removeEventListener("dblclick", this.on_dblclick);
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
	}

	/** Detach from the engine view (the caller deletes it) and remove the table. */
	destroy() {
		this.current = null;
		this.model = null;
		this.layout = null;
		this.windows = [];
		this.unmount();
		this.parent.replaceChildren();
	}

	// ------------------------------------------------------------ data model

	empty_response() {
		return { num_rows: 0, num_columns: 0, data: [], row_headers: [], column_headers: [] };
	}

	/**
	 * What a window of the body needs from the view: the entry of every display row and the
	 * runs of view rows to read (the group of a subtotal row may be far above its window).
	 */
	plan(layout, y0, rows) {
		const entries = [];
		const needed = new Set();
		for (let i = 0; i < rows; i++) {
			const entry = entry_at(layout, y0 + i);
			entries.push(entry);
			if (entry.row >= 0) needed.add(entry.row);
		}
		const runs = [];
		const slot = new Map();
		for (const row of [...needed].sort((a, b) => a - b)) {
			const last = runs[runs.length - 1];
			if (last && row - last[1] < RUN_GAP) last[1] = row + 1;
			else runs.push([row, row + 1]);
			slot.set(row, runs.length - 1);
		}
		return { y0, entries, runs, slot };
	}

	// One read of the view per run of rows, for a range of its columns.
	read_runs(cur, plan, start_col, end_col) {
		const off = cur.post.row_offset;
		return Promise.all(
			plan.runs.map(([a, b]) => cur.view.to_columns({ start_row: off + a, end_row: off + b, start_col, end_col }))
		);
	}

	/** regular-table data listener: one window of the body. */
	async read(x0, y0, x1, y1) {
		const cur = this.current;
		const m = this.model;
		const layout = this.layout;
		if (!cur || !m || !layout) return this.empty_response();
		const base = {
			num_rows: layout.size ? layout.size - this.row_trim : 0,
			num_columns: m.data.length,
			row_height: this.row_height,
			num_row_headers: m.heads,
			num_column_headers: m.header_rows,
			// The bands merge across their columns; titles and filters are one cell per column.
			column_header_merge_depth: m.levels - 1,
			merge_headers: "column",
		};
		const end = Math.min(x1, m.data.length);
		// The size request of regular-table (0, 0, 0, 0) needs the dimensions only.
		if (end <= x0 && y1 <= y0) return { ...base, data: [], row_headers: [], column_headers: [] };
		const rows = Math.max(0, Math.min(y1 + 1, layout.size) - y0);

		let plan = null;
		let values = null;
		if (rows) {
			const key = `${this.epoch}:${y0}:${y0 + rows}`;
			const cached = this.windows.find((w) => w.key === key);
			plan = cached ? cached.plan : this.plan(layout, y0, rows);
			// Only the rows Perspective computed take their numbers from the view.
			const first = m.data[x0]?.index;
			const grouped = cur.post.row_offset === 1 && end > x0;
			const [win, cells] = await Promise.all([
				cached || this.read_records(cur, key, plan, layout),
				grouped ? this.read_runs(cur, plan, first, first + (end - x0)) : null,
			]);
			// A scroll may read the next window before this one is drawn: keep the last few.
			if (this.current === cur) this.windows = [win, ...this.windows.filter((w) => w.key !== key)].slice(0, 4);
			values = cells;
		}

		const data = [];
		const metadata = [];
		for (let x = x0; x < end; x++) {
			const name = m.data[x].column.key;
			data.push(Array.from({ length: rows }, () => ""));
			metadata.push(
				Array.from({ length: rows }, (_, i) => {
					const row = plan.entries[i].row;
					if (!values || row < 0) return { v: null };
					const run = plan.slot.get(row);
					return { v: values[run][name]?.[row - plan.runs[run][0]] ?? null };
				})
			);
		}
		return {
			...base,
			data,
			metadata,
			row_headers: Array.from({ length: rows }, () => Array.from({ length: m.heads }, () => "")),
			column_headers: m.headers.slice(x0, end),
		};
	}

	/** What each row of a window is: a report row (by __rid), a group Perspective computed, its subtotal. */
	async read_records(cur, key, plan, layout) {
		const { post } = cur;
		const grouped = post.row_offset === 1;
		// The technical columns, and the currency columns when they are visible ones: read as
		// runs of neighbouring view columns.
		const wanted = [...new Set([...post.technical, ...(grouped ? post.currency_keys : [])])]
			.map((name) => post.index[name])
			.sort((a, b) => a - b);
		const col_runs = [];
		for (const index of wanted) {
			const last = col_runs[col_runs.length - 1];
			if (last && last[1] === index) last[1] = index + 1;
			else col_runs.push([index, index + 1]);
		}
		const parts = await Promise.all(col_runs.map(([start, stop]) => this.read_runs(cur, plan, start, stop)));
		const by_run = plan.runs.map((_, r) => Object.assign({}, ...parts.map((part) => part[r])));
		const by_rid = this.session.rows_by_rid;

		const of_row = new Map();
		for (const [row, run] of plan.slot) {
			const cols = by_run[run];
			const i = row - plan.runs[run][0];
			const open = Boolean(layout.open[row]);
			let rec;
			if (!grouped) {
				const parent = Boolean(cols[HAS_CHILDREN]?.[i]);
				rec = { type: "row", row: by_rid.get(cols[RID][i]), depth: cols[DEPTH]?.[i] ?? 0, parent, count: cols[LEAVES]?.[i] ?? null, open };
			} else {
				const path = cols[ROW_PATH][i];
				const depth = path.length - 1;
				const filled = post.shape === "levels" && path.length <= post.group_keys.length && cols[LEVELS][i] < path.length;
				if (path.length === post.leaf_depth) {
					rec = { type: "row", row: by_rid.get(path[depth]), depth, parent: false };
				} else if (filled) {
					// A leaf of a shallower branch, standing in its own filled level (N9).
					rec = { type: "row", row: by_rid.get(cols[RID][i]), depth, parent: false };
				} else {
					const currencies = {};
					const mixed = {};
					for (const ck of post.currency_keys) {
						currencies[ck] = cols[ck][i] || null;
						mixed[ck] = !currencies[ck] && (cols[CURRENCY_COUNT_PREFIX + ck]?.[i] || 0) > 1;
					}
					rec = {
						type: "group",
						depth,
						open,
						count: cols[KIND][i],
						key: post.group_keys[depth],
						value: path[depth],
						node: post.shape === "levels" ? by_rid.get(this.session.level_rids.get(JSON.stringify(path))) : null,
						currencies,
						mixed,
					};
				}
			}
			if (rec.type === "row" && !rec.row) continue;
			of_row.set(row, rec);
		}

		const recs = new Map();
		plan.entries.forEach((entry, i) => {
			if (entry.kind === "spacer") {
				recs.set(plan.y0 + i, { type: "spacer" });
				return;
			}
			const rec = of_row.get(entry.row);
			if (!rec) return;
			recs.set(plan.y0 + i, entry.kind === "foot" ? { type: "foot", of: rec, depth: rec.depth, view_row: entry.row } : { ...rec, view_row: entry.row });
		});
		return { key, epoch: this.epoch, y0: plan.y0, plan, recs };
	}

	// ------------------------------------------------------------ interaction

	record_at(cell) {
		const meta = cell && this.rt.getMeta(cell);
		const win = meta && this.windows.find((w) => w.epoch === this.epoch && w.recs.has(meta.y));
		return win ? { y: meta.y, rec: win.recs.get(meta.y) } : null;
	}

	// A caret is a <button>: Enter and Space arrive here as clicks.
	click(event) {
		const button = event.target.closest?.(".rv-caret");
		if (!button || !this.rt?.contains(button)) return;
		event.preventDefault();
		const at = this.record_at(button.closest("th"));
		if (!at || !this.current) return;
		const { rec } = at;
		this.refocus = document.activeElement === button ? at.y : null;
		// The report tree folds through the view state (an engine filter, or the open parents
		// of the re-grouped tree); a user group through the view itself.
		if (rec.type === "row") this.on_tree_toggle(rec.row.__rid);
		else if (rec.node) this.on_tree_toggle(rec.node.__rid);
		else this.toggle_group(rec.view_row, !rec.open);
	}

	async toggle_group(view_row, open) {
		const cur = this.current;
		let structure;
		try {
			structure = await this.session.toggle_group(cur, cur.post.row_offset + view_row, open);
		} catch (e) {
			// The view was replaced and deleted while the group was being opened.
			if (this.current !== cur) return;
			throw e;
		}
		if (this.current !== cur) return;
		cur.depths = structure.depths;
		cur.paths = structure.paths;
		this.set_layout(cur);
		await this.rt.draw();
		this.restore_focus();
		this.on_fold_changed(expanded_from_paths(structure.paths, cur.post.leaf_depth));
	}

	// After a fold from the keyboard the focus goes back to the caret of the same row.
	restore_focus() {
		const y = this.refocus;
		this.refocus = null;
		if (y === null || y === undefined || !this.rt) return;
		for (const th of this.rt.querySelectorAll("tbody tr > th:first-child")) {
			if (this.rt.getMeta(th)?.y !== y) continue;
			th.querySelector(".rv-caret")?.focus();
			return;
		}
	}

	// ------------------------------------------------------------ column widths (#39)

	// The column a header cell stands for: {size_key, column description or null for the label}.
	resize_target(th) {
		const meta = th && this.rt.getMeta(th);
		const m = this.model;
		if (!meta || !m || meta.column_header_y !== m.levels - 1) return null;
		if (meta.type === "corner") {
			const j = meta.row_header_x || 0;
			return { size_key: j, head: j, col: j ? m.pinned[j - 1] : null, key: j ? m.pinned[j - 1].column.key : m.label.key };
		}
		const col = m.data[meta.x];
		return col ? { size_key: m.heads + meta.x, x: meta.x, col, key: col.column.key } : null;
	}

	width_of(target) {
		return target.col ? target.col.width : this.model.label_width;
	}

	set_width(target, width) {
		const w = Math.max(MIN_COLUMN_WIDTH, Math.round(width));
		if (w === this.width_of(target)) return false;
		if (target.col) target.col.width = w;
		else this.model.label_width = w;
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
			if (changed) this.on_column_resized(target.key, this.width_of(target));
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
		if (this.set_width(target, this.content_width(th, target))) {
			this.on_column_resized(target.key, this.width_of(target));
		}
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
		// The title cell (components/header_cells.js) is as wide as its column: its label is
		// measured, plus the room of the column-menu button.
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

	// ------------------------------------------------------------ rendering

	foot_text(rec) {
		const m = this.model;
		if (rec.type === "row") return this.fmt.node_text(m.label, rec.row, m.parts);
		if (rec.node) return this.fmt.node_text(m.label, rec.node, m.parts);
		return this.fmt.group_text({ __group_key: rec.key, __group_value: group_value(m.by_key.get(rec.key), rec.value) });
	}

	label_html(rec) {
		const m = this.model;
		const fmt = this.fmt;
		let inner;
		if (rec.type === "foot") {
			inner = `<span class="rv-caret-sp"></span>${fmt.foot_label_html(this.foot_text(rec.of))}`;
		} else if (rec.type === "group") {
			const label = rec.node
				? fmt.group_title_html(m.label, rec.node, m.parts)
				: fmt.group_label_html({
						__group_key: rec.key,
						__group_value: group_value(m.by_key.get(rec.key), rec.value),
				  });
			inner = `${caret(rec.open)}${label}${fmt.count_html(rec.count)}`;
		} else if (this.is_summary(rec)) {
			inner = `<span class="rv-glabel">${this.caption_of(rec.row).html}</span>`;
		} else {
			const lead = !m.hierarchical ? "" : rec.parent ? caret(rec.open) : '<span class="rv-caret-sp"></span>';
			const label =
				rec.parent && m.parts
					? fmt.group_title_html(m.label, rec.row, m.parts)
					: m.parts
					? fmt.label_html(m.label, rec.row, m.parts)
					: fmt.value_html(m.label, rec.row);
			inner = `${lead}${label}${rec.parent ? fmt.count_html(rec.count) : ""}`;
		}
		return `<div class="rv-lc" style="--lv:${Number(rec.depth) || 0}">${inner}</div>`;
	}

	// A summary row of the report standing in the body among the facts (shape "report").
	is_summary(rec) {
		return rec.type === "row" && this.model.shape === "report" && rec.row.__kind !== "data";
	}

	/**
	 * Where the caption of a summary row is shown: in the label column, which stays on screen,
	 * instead of the column the report wrote it in (General Ledger writes 'Opening' in the
	 * account column while the label column is the date).
	 * @returns {{key: string, html: string}} the column the caption comes from, and its markup
	 */
	caption_of(row) {
		let out = this.captions.get(row.__rid);
		if (out) return out;
		const m = this.model;
		const fmt = this.fmt;
		out = { key: m.label.key, html: fmt.caption_html(m.label, row) };
		if (empty(row[m.label.key])) {
			const from = [...m.pinned, ...m.data].find((d) => !d.numeric && typeof row[d.column.key] === "string" && row[d.column.key]);
			if (from) out = { key: from.column.key, html: fmt.caption_html(from.column, row) };
		}
		this.captions.set(row.__rid, out);
		return out;
	}

	// A cell of a summary row of the report, as the report returned it (no link is built).
	summary_cell(col, row) {
		if (col.column.key === this.caption_of(row).key) return { html: "", sign: "" };
		return { html: this.fmt.caption_html(col.column, row), sign: this.fmt.sign_of(col.column, row) };
	}

	report_cell(col, row) {
		const key = `${row.__rid}|${col.column.key}`;
		let out = this.html_cache.get(key);
		if (!out) {
			out = { html: this.fmt.value_html(col.column, row), sign: this.fmt.sign_of(col.column, row) };
			this.html_cache.set(key, out);
		}
		return out;
	}

	// A group row carries what Perspective aggregated; other columns stay empty.
	group_cell(rec, col, value) {
		if (!col.totalled) return { html: "", sign: "" };
		const k = col.column.key;
		const row = { __kind: "group", ...rec.currencies, [k]: value, __mixed: { [k]: Boolean(rec.mixed[col.currency_key]) } };
		return { html: this.fmt.value_html(col.column, row), sign: this.fmt.sign_of(col.column, row) };
	}

	// {html, sign} of a body cell.
	cell(rec, col, value) {
		const blank = { html: "", sign: "" };
		if (rec.type === "spacer") return blank;
		// With subtotal rows, the header of an open group keeps its title and count only: its
		// numbers stand in its subtotal row (design #46, #47).
		const moved = this.model.subtotals && rec.open;
		if (this.is_summary(rec)) return this.summary_cell(col, rec.row);
		if (rec.type === "row") return moved && rec.parent && col.numeric ? blank : this.report_cell(col, rec.row);
		if (rec.type === "group") return moved ? blank : this.group_cell(rec, col, value);
		const of = rec.of;
		if (of.type === "group") return this.group_cell(of, col, value);
		return col.numeric ? this.report_cell(col, of.row) : blank;
	}

	row_class(rec) {
		if (rec.type === "spacer") return "rv-tr spacer";
		if (rec.type === "foot") return "rv-tr foot";
		if (rec.type === "group" || rec.parent) return `rv-tr group d${Math.min(Number(rec.depth) || 0, 2)}`;
		if (this.is_summary(rec)) return `rv-tr ${SUMMARY_CLASS[rec.row.__kind] || "foot"}`;
		return rec.row.__bold ? "rv-tr bold" : "rv-tr";
	}

	style_cell(cell, col, out) {
		const flags = {
			num: col.numeric,
			dr: col.side === "dr",
			cr: col.side === "cr",
			"band-end": col.band_end,
			zero: out.sign === "zero",
			neg: out.sign === "neg",
		};
		for (const name of CELL_CLASSES) cell.classList.toggle(name, Boolean(flags[name]));
		cell.innerHTML = `<div class="rv-cc">${out.html}</div>`;
	}

	/** regular-table style listener: classes and content of the cells on screen. */
	style() {
		const rt = this.rt;
		const m = this.model;
		if (!rt || !m) return;
		const shown = [];
		for (const th of rt.querySelectorAll("thead th")) {
			const meta = rt.getMeta(th);
			if (!meta) continue;
			const y = meta.column_header_y;
			const leaf = y === m.levels - 1;
			const filter = y === m.levels;
			const corner = meta.type === "corner";
			const col = (leaf || filter) && !corner ? m.data[meta.x] : null;
			const head = (leaf || filter) && corner ? meta.row_header_x || 0 : -1;
			// The label and pinned columns are row headers of regular-table: their header cells
			// get the title and filter elements here (it leaves them in place afterwards).
			if (head >= 0 && th.firstElementChild) {
				const d = head === 0 ? { key: m.label.key, title: m.label_title, numeric: false } : m.pinned[head - 1] && { key: m.pinned[head - 1].column.key, title: m.pinned[head - 1].title, numeric: false };
				const want = d && (leaf ? this.cells.leaf(d.key, d.title, d.numeric) : this.cells.filter(d.key, d.title));
				if (want && th.firstElementChild.firstChild !== want) th.firstElementChild.replaceChildren(want);
			}
			const text = leaf ? (head === 0 ? m.label_title : head > 0 ? m.pinned[head - 1]?.title || "" : col?.title || "") : String(meta.value ?? "").trim();
			th.classList.toggle("rv-hd", leaf);
			th.classList.toggle("rv-hf", filter);
			th.classList.toggle("rv-hb", !leaf && !filter);
			th.classList.toggle("empty", !leaf && !filter && !text);
			th.classList.toggle("num", Boolean(col?.numeric));
			th.classList.toggle("band-end", Boolean(col?.band_end));
			if (leaf) th.title = text;
			else th.removeAttribute("title");
			if (col && leaf) shown.push(meta.x);
		}

		// The window that was drawn: the one that starts at the first row on screen.
		const trs = rt.querySelectorAll("tbody tr");
		const first = trs.length ? rt.getMeta(trs[0].firstElementChild) : null;
		const win = first ? this.windows.find((w) => w.epoch === this.epoch && w.y0 === first.y) : null;
		if (win) {
			for (let i = 0; i < trs.length; i++) {
				const tr = trs[i];
				const lead = tr.firstElementChild;
				const meta = lead && rt.getMeta(lead);
				const rec = meta && meta.y === win.y0 + i ? win.recs.get(meta.y) : null;
				if (!rec) {
					// regular-table keeps a spare row below the last one at the end of the scroll.
					tr.className = "rv-tr stale";
					continue;
				}
				tr.className = this.row_class(rec);
				const stamp = `${this.epoch}:${meta.y}`;
				for (let cell = lead; cell; cell = cell.nextElementSibling) {
					const cm = cell === lead ? meta : rt.getMeta(cell);
					if (!cm) continue;
					const head = cell.tagName === "TH" ? cm.row_header_x || 0 : -1;
					const cell_stamp = `${stamp}:${head >= 0 ? `h${head}` : cm.x}`;
					if (this.rendered.get(cell) === cell_stamp && cell.firstElementChild) continue;
					if (head === 0) {
						cell.innerHTML = rec.type === "spacer" ? "" : this.label_html(rec);
					} else {
						const col = head > 0 ? m.pinned[head - 1] : m.data[cm.x];
						if (!col) continue;
						this.style_cell(cell, col, this.cell(rec, col, cm.user?.v));
					}
					this.rendered.set(cell, cell_stamp);
				}
			}
		}
		this.render_pinned(shown);
	}

	// ------------------------------------------------------------ pinned rows

	// One pinned row: the label cell, the pinned columns, then the data columns on screen.
	pinned_row_html(cls, label_html, cell_of, xs) {
		const m = this.model;
		const cell = (d) => {
			const out = cell_of(d);
			const classes = ["rv-c", d.numeric && "num", d.side, d.band_end && "band-end", out.sign].filter(Boolean).join(" ");
			return { classes, html: out.html };
		};
		const heads = m.pinned.map((d, i) => {
			const c = cell(d);
			const edge = i === m.pinned.length - 1 ? " pin-edge-s" : "";
			return `<div class="${c.classes} pinned${edge}" data-col="${esc(d.column.key)}" style="width:${d.width}px">${c.html}</div>`;
		});
		const cells = xs.map((x) => {
			const d = m.data[x];
			if (!d) return "";
			const c = cell(d);
			return `<div class="${c.classes}" data-col="${esc(d.column.key)}" style="width:${d.width}px">${c.html}</div>`;
		});
		const edge = m.pinned.length ? "" : " pin-edge-s";
		return (
			`<div class="rv-row ${cls}"><div class="rv-c pinned${edge} rv-pin-label" data-col="${esc(m.label.key)}" style="width:${m.label_width}px">${label_html}</div>` +
			`${heads.join("")}${cells.join("")}</div>`
		);
	}

	// A summary row of the whole report, pinned, as the report returned it.
	report_row_html(cls, row, xs) {
		const label = `<span class="rv-glabel">${this.caption_of(row).html}</span>`;
		return this.pinned_row_html(cls, label, (d) => this.summary_cell(d, row), xs);
	}

	/**
	 * Rows outside the scrolling body, aligned with the columns on screen: the report's
	 * opening rows under the headers; its closing rows and the grand total (the engine's
	 * total row, or the report's reference row) below.
	 */
	render_pinned(shown = null) {
		const cur = this.current;
		const m = this.model;
		if (!cur || !m || !this.bottom_el) return;
		const xs = shown || this.pinned_shown || [];
		const signature = `${this.epoch}:${xs.join(",")}`;
		if (this.pinned_signature === signature) return;
		this.pinned_signature = signature;
		this.pinned_shown = xs;
		const fmt = this.fmt;
		const by_rid = this.session.rows_by_rid;
		const rows_of = (rids) => rids.map((rid) => by_rid.get(rid)).filter(Boolean);

		this.top_el.innerHTML = rows_of(cur.post.pinned_rows.top)
			.map((row) => this.report_row_html("rv-rt-opening", row, xs))
			.join("");
		this.fit_top();

		const { values, currencies, mixed } = cur.totals;
		const total = { __kind: "grand_total", ...currencies, ...values, __mixed: {} };
		for (const d of m.data) total.__mixed[d.column.key] = Boolean(mixed[d.column.key]);
		const total_cell = (d) =>
			d.totalled ? { html: fmt.value_html(d.column, total), sign: fmt.sign_of(d.column, total) } : { html: "", sign: "" };
		const total_label = `<span class="rv-glabel">${esc(__("Grand Total"))}</span>${fmt.count_html(this.counts.facts)}`;
		this.bottom_el.innerHTML =
			rows_of(cur.post.pinned_rows.bottom)
				.map((row) => this.report_row_html("foot rv-rt-closing", row, xs))
				.join("") + this.pinned_row_html("total rv-rt-total", total_label, total_cell, xs);
	}
}
