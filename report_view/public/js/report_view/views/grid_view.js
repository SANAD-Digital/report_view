// Grid view on <regular-table> (docs/architecture.md §11.1 #32, #35, #39, #45-#52; §11.2).
// Nothing is computed here. The virtual data model reads windows of the Perspective view
// (view.to_columns) through the row model shared with the pages (views/grid_rows.js): rows
// that are report rows are shown with the report's own values (fetched by __rid, §9.3),
// rows Perspective computed (groups, grand total) with the values of the view. Classes and
// content of every cell are set in the style listener. The plumbing of the element (mount,
// sizes, scroll range, header widths, column resize) is views/rt_base.js, shared with the
// pivot.
//
// Shapes of the view (engine/view_config.js): "tree" = the report tree as it came (nodes
// table, folded by an engine filter); "report" = the rows of a report as it came, its own
// opening / total / closing rows between the facts (rows table); "flat" = the facts;
// "levels" = a grouped view of the facts, opened and closed with view.expand / view.collapse;
// "group" = a view of the user's groups and a flat view of their facts, folded by
// engine/group_fold.js (placement only, no engine call).
//
// Rows of the body (engine/row_layout.js): the rows of the view, a subtotal row after every
// open group (the values of the group's own row), and spacer rows under the report rows that
// are pinned below the headers. Pinned above and below, outside the scrolling body: the
// report's own opening / closing rows and the grand total.

import { RtView, css_int } from "./rt_base.js";
import { GridRows } from "./grid_rows.js";
import { build_layout, expanded_from_paths } from "../engine/row_layout.js";
import { esc } from "../util.js";

const CELL_CLASSES = ["num", "dr", "cr", "band-end", "zero", "neg"];

export class GridView extends RtView {
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
		super({ parent, rtl });
		this.cells = cells;
		this.on_tree_toggle = on_tree_toggle || (() => {});
		this.on_fold_changed = on_fold_changed || (() => {});
		this.on_column_resized = on_column_resized || (() => {});
		this.layout = null;
		this.rows = new GridRows({ cells });
		this.refocus = null;
		this.cell_classes = CELL_CLASSES;
		this.host_class = "rv-rt";
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
		const model = this.rows.set({ report, state, config, post: opened.post, fmt, session, width: this.parent.clientWidth });
		const density = state.ui?.density;
		// What needs a new table: the columns and the density. Widths and rows do not.
		const signature = JSON.stringify({
			label: model.label.key,
			pinned: model.pinned.map((d) => d.column.key),
			cols: model.data.map((d) => [d.column.key, d.band]),
			density,
		});
		this.fmt = fmt;
		this.session = session;
		this.model = model;
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

	host_markup() {
		return (
			`<div class="rv-rt-scroll"><regular-table></regular-table><div class="rv-rt-top"></div><div class="rv-rt-edge pin-edge-s"></div></div>` +
			`<div class="rv-rt-bottom"></div>`
		);
	}

	header_rows() {
		return this.model.header_rows;
	}

	header_height_px(host) {
		return (this.model.levels === 2 ? css_int(host, "--bh", 30) : 0) + css_int(host, "--hh", 34) + css_int(host, "--fh", 38);
	}

	mounted() {
		this.top_el.style.top = `${this.header_height}px`;
	}

	size_widths() {
		const m = this.model;
		return [m.label_width, ...m.pinned.map((d) => d.width), ...m.data.map((d) => d.width)];
	}

	size_heads() {
		return this.model.heads;
	}

	cleared() {
		this.layout = null;
	}

	// ------------------------------------------------------------ data model

	empty_response() {
		return { num_rows: 0, num_columns: 0, data: [], row_headers: [], column_headers: [] };
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
			plan = cached ? cached.plan : this.rows.plan(layout, y0, rows);
			// Only the rows Perspective computed take their numbers from the view.
			const [win, cells] = await Promise.all([
				cached || this.read_records(cur, key, plan, layout),
				this.rows.read_values(cur, plan, x0, end),
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
				Array.from({ length: rows }, (_, i) => ({ v: this.rows.value_of(values, plan, plan.entries[i].row, name) }))
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

	/** A window of records, kept with the key and epoch it was read for. */
	async read_records(cur, key, plan, layout) {
		const recs = await this.rows.read_records(cur, plan, layout);
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
		this.on_fold_changed(structure.expanded ?? expanded_from_paths(structure.paths, cur.post.leaf_depth));
	}

	// After a fold from the keyboard the focus goes back to the caret of the same row; after
	// a sort from the keyboard, to the title of the column.
	restore_focus() {
		this.cells?.restore_focus();
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

	assign_width(target, width) {
		if (target.col) target.col.width = width;
		else this.model.label_width = width;
	}

	width_changed(target) {
		this.on_column_resized(target.key, this.width_of(target));
	}

	// ------------------------------------------------------------ rendering

	row_class(rec) {
		return `rv-tr ${this.rows.row_kind(rec)}`.trim();
	}

	/** regular-table style listener: classes and content of the cells on screen. */
	style() {
		const rt = this.rt;
		const m = this.model;
		if (!rt || !m) return;
		this.sync_sub_x();
		const shown = [];
		const leaves = [];
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
			if (col && leaf) shown.push(meta.x);
			if (leaf) {
				leaves.push({ th, text, col, head, x: meta.x });
				// the sort of the column, for assistive technology
				const key = col ? col.column.key : head === 0 ? m.label.key : m.pinned[head - 1]?.column.key;
				const sort = key ? this.cells.aria_sort(key) : null;
				if (sort) th.setAttribute("aria-sort", sort);
				else th.removeAttribute("aria-sort");
			}
		}
		this.measure_headers(leaves, shown);

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
						cell.innerHTML = rec.type === "spacer" ? "" : this.rows.label_html(rec);
					} else {
						const col = head > 0 ? m.pinned[head - 1] : m.data[cm.x];
						if (!col) continue;
						const out = this.rows.cell(rec, col, cm.user?.v);
						this.style_cell(
							cell,
							{
								num: col.numeric,
								dr: col.side === "dr",
								cr: col.side === "cr",
								"band-end": col.band_end,
								zero: out.sign === "zero",
								neg: out.sign === "neg",
							},
							out
						);
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
			return `<div class="${c.classes} pinned${edge}" data-col="${esc(d.column.key)}" style="width:${this.drawn_width("pinned", i, d.width)}">${c.html}</div>`;
		});
		const cells = xs.map((x) => {
			const d = m.data[x];
			if (!d) return "";
			const c = cell(d);
			return `<div class="${c.classes}" data-col="${esc(d.column.key)}" style="width:${this.drawn_width("data", x, d.width)}">${c.html}</div>`;
		});
		const edge = m.pinned.length ? "" : " pin-edge-s";
		return (
			`<div class="rv-row ${cls}"><div class="rv-c pinned${edge} rv-pin-label" data-col="${esc(m.label.key)}" style="width:${this.drawn_width("label", 0, m.label_width)}">${label_html}</div>` +
			`${heads.join("")}${cells.join("")}</div>`
		);
	}

	// A summary row of the whole report, pinned, as the report returned it.
	report_row_html(cls, row, xs) {
		const label = `<span class="rv-glabel">${this.rows.caption_of(row).html}</span>`;
		return this.pinned_row_html(cls, label, (d) => this.rows.summary_cell(d, row), xs);
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
		const drawn = this.drawn;
		const widths = drawn ? [drawn.label, ...drawn.pinned, ...xs.map((x) => drawn.data.get(x))].map((w) => Math.round(w || 0)).join(",") : "";
		const signature = `${this.epoch}:${xs.join(",")}:${widths}`;
		if (this.pinned_signature === signature) return;
		this.pinned_signature = signature;
		this.pinned_shown = xs;
		const fmt = this.fmt;
		const report_rows = this.rows.report_rows(cur);

		this.top_el.innerHTML = report_rows.top.map((row) => this.report_row_html("rv-rt-opening", row, xs)).join("");
		this.fit_top();

		const total = this.rows.total_row(cur, this.counts);
		const total_label = `<span class="rv-glabel">${esc(__("Grand Total"))}</span>${fmt.count_html(total.count)}`;
		this.bottom_el.innerHTML =
			report_rows.bottom.map((row) => this.report_row_html("foot rv-rt-closing", row, xs)).join("") +
			this.pinned_row_html("total rv-rt-total", total_label, total.cell, xs);
	}
}
