// Pivot table on <regular-table> (docs/architecture.md §11.1 #67; design:
// reference/design/screens/pivot.png). Nothing is computed here. The virtual data model
// reads windows of the two views of a pivot (ReportSession.open_pivot): the split columns
// from the pivot view, the rows (path, count, currency) and the total columns from its
// totals view, which has the same rows in the same order. The grand total row is pinned
// below the body, from row 0 of both views. Column headers: one level per pivot column
// (the values of its column path), then the value's name when there are several values.
//
// Same techniques as views/grid_view.js (perf, bf42c36): cells keep their element and get
// text, header widths are read only when the columns on screen change, no inherited CSS
// variables on the table.

import { apply_rtl } from "./rtl_adapter.js";
import { perspective_type, KIND } from "../engine/schema.js";
import { CURRENCY_COUNT_PREFIX } from "../engine/view_config.js";
import { split_value } from "../engine/pivot_config.js";

const ROW_PATH = "__ROW_PATH__";
const CELL_HTML = new WeakMap();
const BARE_NUMBER = /^<bdi class="rv-n">([^<]*)<\/bdi>$/;
const CELL_CLASSES = ["num", "zero", "neg", "pv", "band-end", "tot"];
const CHEVRON =
	'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>';
// Design widths (Main.dc.html pivotModel): 156px a value column, 12px more for a total.
const VALUE_WIDTH = 156;
const TOTAL_WIDTH = 168;

export const AGG_TITLES = {
	sum: (t) => __("Sum of {0}", [t]),
	avg: (t) => __("Average of {0}", [t]),
	count: (t) => __("Count of {0}", [t]),
	min: (t) => __("Minimum of {0}", [t]),
	max: (t) => __("Maximum of {0}", [t]),
};

function esc(s) {
	return frappe.utils.escape_html(String(s ?? ""));
}

function css_int(el, name, fallback) {
	const v = parseInt(getComputedStyle(el).getPropertyValue(name), 10);
	return Number.isFinite(v) ? v : fallback;
}

function caret(open) {
	const label = open ? __("Collapse group") : __("Expand group");
	return `<button type="button" class="rv-caret${open ? " open" : ""}" aria-expanded="${open}" aria-label="${esc(label)}" title="${esc(label)}">${CHEVRON}</button>`;
}

// A group value as the report would carry it: Perspective returns dates as milliseconds.
function report_value(column, value) {
	if (value === null || value === undefined || !column) return value;
	const type = perspective_type(column.fieldtype);
	if (type === "date" && typeof value === "number") return new Date(value).toISOString().slice(0, 10);
	if (type === "boolean") return value ? 1 : 0;
	return value;
}

export class PivotView {
	/**
	 * @param {object} opts
	 * @param {HTMLElement} opts.parent
	 * @param {boolean} opts.rtl
	 * @param {(opened: object, change: object) => Promise<number>} opts.fold opens or closes rows in the engine
	 * @param {(cell: object) => void} opts.on_cell a value cell was pressed (drill-down)
	 */
	constructor({ parent, rtl, fold, on_cell }) {
		this.parent = parent;
		this.rtl = rtl;
		this.fold = fold;
		this.on_cell = on_cell || (() => {});
		this.rt = null;
		this.current = null;
		this.model = null;
		this.epoch = 0;
		this.windows = [];
		this.rendered = new WeakMap();
		this.listener = (x0, y0, x1, y1) => this.read(x0, y0, x1, y1);
		this.styler = () => this.style();
		this.on_click = (e) => this.click(e);
		this.on_scrolled = () => this.scrolled();
	}

	// ------------------------------------------------------------ model

	/**
	 * Columns of the table from the pivot: the split columns (pivot view, in its order), then
	 * one total column per value (totals view). Header parts are ids, unique per column path
	 * prefix, so that regular-table merges a band over its own columns only.
	 */
	build_model(opened, ctx) {
		const { post } = opened;
		const { controls, report } = ctx;
		const labels = new Map();
		const values = post.values.map((v) => ({ ...v, title: AGG_TITLES[v.agg](controls.full_title(v.key)), column: controls.column(v.key) }));
		const many = values.length > 1;
		const split = post.cols.length > 0;
		const levels = (split ? post.cols.length : 0) + (many || !split ? 1 : 0);
		const id = (parts) => `${parts.length}\u0001${parts.join("\u0002")}`;
		const cols = [];
		if (split) {
			for (const name of opened.column_paths) {
				const segs = name.split("|");
				const alias = segs.pop();
				const value = values.find((v) => v.name === alias);
				if (!value || segs.length !== post.cols.length) continue;
				const raw = segs.map((s, d) => split_value(post.dims[post.cols[d]], s));
				const parts = [];
				for (let d = 0; d < segs.length; d++) {
					const pid = id(segs.slice(0, d + 1));
					if (!labels.has(pid)) labels.set(pid, this.dim_text(post.cols[d], raw[d], ctx));
					parts.push(pid);
				}
				if (many) {
					const pid = id([...segs, alias]);
					labels.set(pid, value.title);
					parts.push(pid);
				}
				cols.push({ name, source: "pivot", value, col_values: raw, parts, total: false, width: VALUE_WIDTH });
			}
		}
		if (!split || post.totals.cols) {
			for (const value of values) {
				const parts = [];
				if (split) {
					const pid = id(["\u0003total"]);
					labels.set(pid, __("Total"));
					parts.push(pid);
					for (let d = 1; d < post.cols.length; d++) {
						const blank = id(["\u0003total", String(d)]);
						labels.set(blank, "");
						parts.push(blank);
					}
				}
				if (many || !split) {
					const pid = id(["\u0003total", value.name]);
					labels.set(pid, value.title);
					parts.push(pid);
				}
				cols.push({ name: value.name, source: "totals", value, col_values: [], parts, total: split, width: split ? TOTAL_WIDTH : VALUE_WIDTH });
			}
		}
		// The end of a band: a full-height line between the groups of the first pivot column.
		cols.forEach((c, i) => {
			const next = cols[i + 1];
			c.band_end = split && levels > 1 && (!next || next.parts[0] !== c.parts[0]);
		});
		// Label column: design width 300px, narrower on phones so numbers stay visible.
		const label_width = Math.round(Math.min(300, Math.max(150, this.parent.clientWidth * 0.45)));
		const tree_label = report.tree?.enabled ? report.tree.label_key : null;
		return {
			post,
			values,
			cols,
			split_count: cols.filter((c) => c.source === "pivot").length,
			levels,
			labels,
			label_width,
			label_title: post.rows.map((k) => this.dim_title(k, controls)).join(" › "),
			by_label: ctx.by_label,
			label_column: tree_label ? controls.column(tree_label) : null,
			parts: ctx.config.tree || null,
			headers: cols.map((c) => c.parts),
		};
	}

	dim_title(key, controls) {
		const level = /^level_(\d+)$/.exec(key);
		if (level) return Number(level[1]) === 1 ? __("Top-level groups") : __("Level {0}", [level[1]]);
		return controls.title(key);
	}

	/** Plain text of a value of a dimension (headers). */
	dim_text(key, value, ctx) {
		if (value === null || value === undefined || value === "") return __("Not Set");
		const dim = ctx.opened.post.dims[key];
		if (dim?.type === "boolean") return value ? __("Yes") : __("No");
		if (dim?.level) {
			const row = ctx.by_label?.get(String(value));
			const parts = ctx.config.tree || {};
			if (row && parts.name_key && row[parts.name_key]) {
				const no = parts.number_key ? row[parts.number_key] : null;
				return no ? `${no} - ${row[parts.name_key]}` : String(row[parts.name_key]);
			}
			return String(value);
		}
		return ctx.controls.value_text(key, report_value(ctx.controls.column(key), value)) || String(value);
	}

	/** Label of a row of the pivot: the value of its last row dimension. */
	row_label_html(key, value) {
		const m = this.model;
		const fmt = this.fmt;
		const dim = m.post.dims[key];
		if (value === null || value === undefined || value === "") return `<span class="rv-glabel"><span class="rv-muted">${esc(__("Not Set"))}</span></span>`;
		if (dim?.level) {
			const row = m.by_label.get(String(value));
			if (row && m.label_column) return fmt.group_title_html(m.label_column, row, m.parts);
			return `<span class="rv-glabel">${esc(value)}</span>`;
		}
		if (dim?.type === "boolean") return `<span class="rv-glabel">${esc(value ? __("Yes") : __("No"))}</span>`;
		const column = this.ctx.controls.column(key);
		return fmt.group_label_html({ __group_key: key, __group_value: report_value(column, value) });
	}

	// ------------------------------------------------------------ show / destroy

	/**
	 * Show an opened pivot (ReportSession.open_pivot). The caller deletes the previous one
	 * after this resolves.
	 * @param {object} p {opened, report, state, config, controls, fmt}
	 */
	async show({ opened, report, state, config, controls, fmt }) {
		// Values of tree levels are the labels of report rows: their "number - name" is read there.
		const by_label = new Map();
		const tree_label = report.tree?.enabled ? report.tree.label_key : null;
		if (tree_label) for (const r of report.rows) if (r[tree_label] !== null && r[tree_label] !== undefined) by_label.set(String(r[tree_label]), r);
		this.ctx = { report, state, config, controls, opened, by_label };
		this.current = opened;
		this.fmt = fmt;
		const model = this.build_model(opened, this.ctx);
		this.model = model;
		this.body_rows = opened.body_rows;
		this.column_totals = opened.view && opened.post.totals.rows ? await opened.view.to_columns({ start_row: 0, end_row: 1 }) : null;
		if (this.current !== opened) return;
		this.epoch += 1;
		this.windows = [];
		this.header_key = null;
		const signature = JSON.stringify({ c: model.cols.map((c) => c.name), l: model.levels, d: state.ui?.density, w: model.cols.map((c) => c.width), lw: model.label_width });
		if (!this.rt || this.signature !== signature) this.mount(signature);
		this.render_total();
		await this.rt.draw();
	}

	mount(signature) {
		this.unmount();
		this.signature = signature;
		const host = document.createElement("div");
		host.className = "rv-rt rv-pivot";
		host.innerHTML = `<div class="rv-rt-scroll"><regular-table></regular-table><div class="rv-rt-edge pin-edge-s"></div></div><div class="rv-rt-bottom"></div>`;
		this.parent.replaceChildren(host);
		this.host = host;
		this.bottom_el = host.querySelector(".rv-rt-bottom");
		const rt = host.querySelector("regular-table");
		this.rt = rt;
		this.row_height = css_int(host, "--rh", 36) + 1;
		const band = css_int(host, "--bh", 30);
		const head = css_int(host, "--hh", 34);
		this.header_height = (this.model.levels - 1) * band + head;
		this.row_trim = Math.max(0, this.model.levels * this.row_height - this.header_height) / this.row_height;
		rt.setDataListener(this.listener, { column_classes: true });
		if (this.rtl) apply_rtl(rt);
		const m = this.model;
		const sizes = { 0: m.label_width };
		m.cols.forEach((c, i) => (sizes[i + 1] = c.width));
		rt.restoreColumnSizes(sizes);
		host.style.setProperty("--rv-pin-w", `${m.label_width}px`);
		this.remove_styler = rt.addStyleListener(this.styler);
		rt.addEventListener("click", this.on_click);
		rt.addEventListener("regular-table-scroll", this.on_scrolled);
		this.bottom_el.addEventListener("click", this.on_click);
		this.rt_width = rt.clientWidth;
		this.resize_observer = new ResizeObserver(() => {
			if (this.rt !== rt || !this.current) return;
			this.rt_width = rt.clientWidth;
			rt.draw();
		});
		this.resize_observer.observe(rt);
		this.fit_scroll_range();
	}

	// The horizontal scroll range is exactly the width of the columns (as in grid_view.js).
	fit_scroll_range() {
		const rt = this.rt;
		const panel = rt.shadowRoot?.querySelector(".rt-virtual-panel");
		if (!panel) return;
		const fit = () => {
			const m = this.model;
			if (!m || this.rt !== rt) return;
			const measured = rt.e?.indices || [];
			const nominal = [m.label_width, ...m.cols.map((c) => c.width)];
			const total = nominal.reduce((sum, w, i) => sum + Math.max(w, measured[i] || 0), 0);
			if (total <= rt.clientWidth) return;
			const want = `${Math.ceil(total)}px`;
			if (panel.style.width !== want) panel.style.width = want;
		};
		this.panel_observer = new MutationObserver(fit);
		this.panel_observer.observe(panel, { attributes: true, attributeFilter: ["style"] });
		fit();
	}

	unmount() {
		if (this.panel_observer) this.panel_observer.disconnect();
		this.panel_observer = null;
		if (this.resize_observer) this.resize_observer.disconnect();
		this.resize_observer = null;
		if (this.rt) {
			this.rt.removeEventListener("click", this.on_click);
			this.rt.removeEventListener("regular-table-scroll", this.on_scrolled);
			if (this.remove_styler) this.remove_styler();
		}
		if (this.bottom_el) this.bottom_el.removeEventListener("click", this.on_click);
		this.remove_styler = null;
		this.rt = null;
		this.host = null;
		this.bottom_el = null;
		this.signature = null;
		this.drawn = null;
	}

	/** Detach from the engine views (the caller deletes them) and remove the table. */
	destroy() {
		this.current = null;
		this.model = null;
		this.windows = [];
		this.column_totals = null;
		this.unmount();
		this.parent.replaceChildren();
	}

	// The total row follows the sub-column shift of the table (rv_table.css --rv-sx-out).
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

	scrolled() {
		this.sync_sub_x();
		this.host?.classList.toggle("scrolled-x", Math.abs(this.rt?.scrollLeft || 0) > 0);
	}

	// ------------------------------------------------------------ data model

	/** regular-table data listener: one window of the body. */
	async read(x0, y0, x1, y1) {
		const cur = this.current;
		const m = this.model;
		const base = {
			num_rows: this.body_rows ? this.body_rows - this.row_trim : 0,
			num_columns: m ? m.cols.length : 0,
			row_height: this.row_height,
			num_row_headers: 1,
			num_column_headers: m ? m.levels : 1,
			column_header_merge_depth: m ? m.levels - 1 : 0,
			merge_headers: "column",
		};
		if (!cur || !m) return { ...base, data: [], row_headers: [], column_headers: [] };
		const end = Math.min(x1, m.cols.length);
		if (end <= x0 && y1 <= y0) return { ...base, data: [], row_headers: [], column_headers: [] };
		const rows = Math.max(0, Math.min(y1 + 1, this.body_rows) - y0);
		let win = null;
		let cells = null;
		if (rows) {
			const epoch = this.epoch;
			const window = { start_row: 1 + y0, end_row: 1 + y0 + rows };
			const split_end = Math.min(end, m.split_count);
			const [t, p] = await Promise.all([
				cur.totals.to_columns(window),
				cur.view && split_end > x0 ? cur.view.to_columns({ ...window, start_col: x0, end_col: split_end }) : null,
			]);
			win = { epoch, y0, rows, t };
			cells = { t, p };
			if (this.current === cur && this.epoch === epoch) this.windows = [win, ...this.windows.filter((w) => w.y0 !== y0)].slice(0, 4);
		}
		const data = [];
		const metadata = [];
		for (let x = x0; x < end; x++) {
			const col = m.cols[x];
			const source = cells ? (col.source === "pivot" ? cells.p : cells.t) : null;
			const values = source?.[col.name] || [];
			data.push(Array.from({ length: rows }, () => ""));
			metadata.push(Array.from({ length: rows }, (_, i) => ({ v: values[i] ?? null })));
		}
		return {
			...base,
			data,
			metadata,
			row_headers: Array.from({ length: rows }, () => [""]),
			column_headers: m.headers.slice(x0, end),
		};
	}

	/** What a body row is: its path, count and currencies, from the window it was read in. */
	record(y) {
		const win = this.windows.find((w) => w.epoch === this.epoch && y >= w.y0 && y < w.y0 + w.rows);
		if (!win) return null;
		const i = y - win.y0;
		const t = win.t;
		const path = t[ROW_PATH][i];
		const currencies = {};
		const mixed = {};
		for (const ck of this.model.post.currency_keys) {
			currencies[ck] = t[ck]?.[i] || null;
			mixed[ck] = !currencies[ck] && (t[CURRENCY_COUNT_PREFIX + ck]?.[i] || 0) > 1;
		}
		const depth = path.length - 1;
		const leaf = path.length >= this.model.post.rows.length;
		const next = win.t[ROW_PATH][i + 1];
		// open: the next row is a child (when the next row is out of the window, the last
		// state seen stays: rows below a group in one window are its children)
		const open = !leaf && (next ? next.length > path.length : true);
		return { y, path, depth, leaf, open, count: t[KIND]?.[i] ?? null, currencies, mixed };
	}

	// ------------------------------------------------------------ cells

	value_cell(col, rec, value) {
		const v = col.value;
		const column = v.column;
		if (value === null || value === undefined) return { html: "", sign: "" };
		if (v.agg === "count") {
			return { html: `<bdi class="rv-n">${esc(frappe.format(value, { fieldtype: "Int" }, { inline: true }))}</bdi>`, sign: value === 0 ? "zero" : "" };
		}
		const ck = column?.currency?.kind === "row" ? column.currency.key : null;
		const row = { __kind: "group", ...(rec?.currencies || {}), [column.key]: value, __mixed: { [column.key]: Boolean(ck && rec?.mixed[ck]) } };
		return { html: this.fmt.value_html(column, row), sign: this.fmt.sign_of(column, row) };
	}

	style_cell(cell, col, out) {
		const flags = { num: true, zero: out.sign === "zero", neg: out.sign === "neg", pv: out.html !== "", "band-end": col.band_end, tot: col.total };
		for (const name of CELL_CLASSES) cell.classList.toggle(name, Boolean(flags[name]));
		let cc = cell.firstElementChild;
		if (!cc || cell.childNodes.length !== 1 || !cc.classList.contains("rv-cc")) {
			cc = document.createElement("div");
			cc.className = "rv-cc";
			cell.replaceChildren(cc);
		}
		if (CELL_HTML.get(cc) === out.html) return;
		CELL_HTML.set(cc, out.html);
		const number = BARE_NUMBER.exec(out.html);
		const text = number ? number[1] : out.html;
		cc.classList.toggle("rv-n", Boolean(number));
		if (/[<&]/.test(text)) cc.innerHTML = text;
		else cc.textContent = text;
	}

	label_html(rec) {
		const m = this.model;
		const key = m.post.rows[rec.depth];
		const lead = rec.leaf ? '<span class="rv-caret-sp"></span>' : caret(rec.open);
		return `<div class="rv-lc" style="--lv:${rec.depth}">${lead}${this.row_label_html(key, rec.path[rec.depth])}${this.fmt.count_html(rec.count)}</div>`;
	}

	/** regular-table style listener: classes and content of the cells on screen. */
	style() {
		const rt = this.rt;
		const m = this.model;
		if (!rt || !m) return;
		this.sync_sub_x();
		const last = m.levels - 1;
		const leaves = [];
		const shown = [];
		for (const th of rt.querySelectorAll("thead th")) {
			const meta = rt.getMeta(th);
			if (!meta) continue;
			const y = meta.column_header_y;
			const leaf = y === last;
			const corner = meta.type === "corner";
			const col = !corner && meta.x !== undefined ? m.cols[meta.x] : null;
			const text = corner ? (leaf ? m.label_title : "") : m.labels.get(meta.value) ?? "";
			if (th.textContent !== text) th.textContent = text;
			th.classList.toggle("rv-hd", leaf);
			th.classList.toggle("rv-hb", !leaf);
			th.classList.toggle("empty", !leaf && !text);
			th.classList.toggle("num", leaf && Boolean(col));
			th.classList.toggle("band-end", Boolean(col?.band_end));
			th.classList.toggle("tot", Boolean(col?.total));
			if (leaf) {
				leaves.push({ th, text, col, x: meta.x, corner });
				if (col) shown.push(meta.x);
			}
		}
		const header_key = `${this.epoch}:${shown.join(",")}:${this.rt_width}`;
		if (header_key !== this.header_key || !this.drawn) {
			this.header_key = header_key;
			const drawn = { label: null, data: new Map() };
			for (const { th, text, col, x, corner } of leaves) {
				const w = th.getBoundingClientRect().width;
				if (col) drawn.data.set(x, w);
				else if (corner) drawn.label = w;
				if (th.scrollWidth > th.clientWidth) th.title = text;
				else th.removeAttribute("title");
			}
			this.drawn = drawn;
			if (drawn.label) this.host.style.setProperty("--rv-pin-w", `${drawn.label.toFixed(2)}px`);
		}
		for (const tr of rt.querySelectorAll("tbody tr")) {
			const lead = tr.firstElementChild;
			const meta = lead && rt.getMeta(lead);
			const rec = meta ? this.record(meta.y) : null;
			if (!rec) {
				tr.className = "rv-tr stale";
				continue;
			}
			tr.className = rec.leaf ? `rv-tr group pvleaf d${Math.min(rec.depth, 2)}` : `rv-tr group d${Math.min(rec.depth, 2)}`;
			const stamp = `${this.epoch}:${meta.y}:${rec.open ? 1 : 0}`;
			for (let cell = lead; cell; cell = cell.nextElementSibling) {
				const cm = cell === lead ? meta : rt.getMeta(cell);
				if (!cm) continue;
				const head = cell.tagName === "TH";
				const cell_stamp = `${stamp}:${head ? "h" : cm.x}`;
				if (this.rendered.get(cell) === cell_stamp && cell.firstElementChild) continue;
				if (head) cell.innerHTML = this.label_html(rec);
				else {
					const col = m.cols[cm.x];
					if (!col) continue;
					this.style_cell(cell, col, this.value_cell(col, rec, cm.user?.v));
				}
				this.rendered.set(cell, cell_stamp);
			}
		}
		this.render_total(shown);
	}

	// ------------------------------------------------------------ grand total row

	render_total(shown = null) {
		const cur = this.current;
		const m = this.model;
		if (!cur || !m || !this.bottom_el) return;
		if (!cur.post.totals.rows) {
			this.bottom_el.replaceChildren();
			return;
		}
		const xs = shown || this.total_shown || [];
		const d = this.drawn;
		const width = (x, nominal) => {
			const w = d && (x === null ? d.label : d.data.get(x));
			return w ? `${w.toFixed(2)}px` : `${nominal}px`;
		};
		const signature = `${this.epoch}:${xs.join(",")}:${xs.map((x) => Math.round(d?.data.get(x) || 0)).join(",")}:${Math.round(d?.label || 0)}`;
		if (signature === this.total_signature && this.bottom_el.firstChild) return;
		this.total_signature = signature;
		this.total_shown = xs;
		const t = cur.total;
		const rec = { currencies: {}, mixed: {} };
		for (const ck of m.post.currency_keys) {
			rec.currencies[ck] = t[ck] || null;
			rec.mixed[ck] = !rec.currencies[ck] && (t[CURRENCY_COUNT_PREFIX + ck] || 0) > 1;
		}
		const cells = xs.map((x) => {
			const col = m.cols[x];
			if (!col) return "";
			const v = col.source === "pivot" ? this.column_totals?.[col.name]?.[0] : t[col.name];
			const out = this.value_cell(col, rec, v ?? null);
			const cls = ["rv-c", "num", out.sign, out.html ? "pv" : "", col.band_end ? "band-end" : ""].filter(Boolean).join(" ");
			return `<div class="${cls}" data-x="${x}" style="width:${width(x, col.width)}">${out.html}</div>`;
		});
		const label = `<span class="rv-glabel">${esc(__("Grand Total"))}</span>${this.fmt.count_html(t[KIND])}`;
		this.bottom_el.innerHTML = `<div class="rv-row total rv-rt-total"><div class="rv-c pinned pin-edge-s rv-pin-label" style="width:${width(null, m.label_width)}">${label}</div>${cells.join("")}</div>`;
	}

	// ------------------------------------------------------------ interaction

	click(event) {
		const cur = this.current;
		const m = this.model;
		if (!cur || !m) return;
		const button = event.target.closest?.(".rv-caret");
		if (button && this.rt?.contains(button)) {
			event.preventDefault();
			const meta = this.rt.getMeta(button.closest("th"));
			const rec = meta && this.record(meta.y);
			if (rec) this.toggle(rec, document.activeElement === button);
			return;
		}
		const total = event.target.closest?.(".rv-rt-total .rv-c.pv");
		if (total && this.bottom_el?.contains(total)) {
			const col = m.cols[Number(total.dataset.x)];
			if (col) this.on_cell(this.cell_info(col, null, total));
			return;
		}
		const td = event.target.closest?.("td.pv");
		if (!td || !this.rt?.contains(td)) return;
		const meta = this.rt.getMeta(td);
		const rec = meta && this.record(meta.y);
		const col = meta && m.cols[meta.x];
		if (rec && col) this.on_cell(this.cell_info(col, rec, td));
	}

	cell_info(col, rec, anchor) {
		const m = this.model;
		const row_text = rec
			? rec.path.map((v, d) => frappe.utils.html2text(this.row_label_html(m.post.rows[d], v)).trim()).join(" › ")
			: __("Grand Total");
		const col_text = col.col_values.length
			? col.col_values.map((v, d) => this.dim_text(m.post.cols[d], v, this.ctx)).join(" › ")
			: m.post.cols.length
			? __("Total")
			: "";
		const html = anchor.querySelector(".rv-cc")?.innerHTML ?? anchor.innerHTML;
		return {
			opened: this.current,
			row_path: rec ? rec.path : [],
			col_values: col.col_values,
			value: col.value,
			title: col_text ? `${row_text} · ${col_text}` : row_text,
			value_title: col.value.title,
			total_html: html,
			anchor,
		};
	}

	async toggle(rec, refocus) {
		const cur = this.current;
		let rows;
		try {
			rows = await this.fold(cur, { row: 1 + rec.y, open: !rec.open });
		} catch (e) {
			if (this.current !== cur) return;
			throw e;
		}
		if (this.current !== cur) return;
		this.body_rows = rows;
		this.epoch += 1;
		this.windows = [];
		await this.rt.draw();
		if (refocus) {
			for (const th of this.rt.querySelectorAll("tbody tr > th:first-child")) {
				if (this.rt.getMeta(th)?.y === rec.y) th.querySelector(".rv-caret")?.focus();
			}
		}
	}

	/** Expand all / collapse all. */
	async fold_all(open) {
		const cur = this.current;
		if (!cur || !this.model) return;
		const depth = open ? Math.max(0, this.model.post.rows.length - 1) : 0;
		const rows = await this.fold(cur, { depth });
		if (this.current !== cur) return;
		this.body_rows = rows;
		this.epoch += 1;
		this.windows = [];
		await this.rt.draw();
	}
}
