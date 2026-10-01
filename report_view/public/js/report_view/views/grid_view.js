// Grid view on <regular-table> (docs/architecture.md §11.1 #32, #35, #45-#52; §11.2).
// Nothing is computed here. The virtual data model reads windows of the Perspective view
// (view.to_columns); rows that are report rows are shown with the report's own values
// (fetched by __rid, §9.3), rows Perspective computed (groups, grand total) with the
// values of the view. Classes and content of every cell are set in the style listener.
//
// Shapes of the view (engine/view_config.js): "tree" = the report tree as it came (nodes
// table, folded by an engine filter); "flat" = the facts; "group" / "levels" = a grouped
// view of the facts, opened and closed with view.expand / view.collapse.

import { apply_rtl } from "./rtl_adapter.js";
import { perspective_type, RID, KIND } from "../engine/schema.js";
import { DEPTH, HAS_CHILDREN, LEAVES, LEVELS } from "../engine/tree_nodes.js";
import { CURRENCY_COUNT_PREFIX } from "../engine/view_config.js";

const ROW_PATH = "__ROW_PATH__";
const CELL_CLASSES = ["num", "dr", "cr", "band-end", "zero", "neg"];
const CHEVRON =
	'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>';

function esc(s) {
	return frappe.utils.escape_html(String(s ?? ""));
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
	 * @param {(counts: object) => void} opts.on_rows_changed a group was opened or closed (rows on screen changed)
	 */
	constructor({ parent, rtl, on_tree_toggle, on_rows_changed }) {
		this.parent = parent;
		this.rtl = rtl;
		this.on_tree_toggle = on_tree_toggle || (() => {});
		this.on_rows_changed = on_rows_changed || (() => {});
		this.rt = null;
		this.current = null;
		this.model = null;
		this.signature = null;
		this.epoch = 0;
		this.windows = [];
		this.rendered = new WeakMap();
		this.html_cache = new Map();
		this.cache_owner = null;
		this.listener = (x0, y0, x1, y1) => this.read(x0, y0, x1, y1);
		this.styler = () => this.style();
		this.on_click = (e) => this.click(e);
	}

	// ------------------------------------------------------------ model

	build_model(report, state, config, post) {
		const by_key = new Map(report.columns.map((c) => [c.key, c]));
		const col_conf = config.columns || {};
		const bands = new Map((config.bands || []).map((b) => [b.id, b]));
		const translate_label = report.__report_type === "Query Report";
		const title = (c) => col_conf[c.fieldname]?.label || (translate_label ? __(c.label) : c.label);
		const totalled = new Set(post.measures);
		const label = by_key.get(post.label_key);
		// Label column: design width 320px, narrower on phones so numbers stay visible.
		const label_width =
			state.columns.widths[label.key] ||
			Math.round(Math.min(320, Math.max(170, this.parent.clientWidth * 0.5)));

		const data = post.data_keys.map((key) => {
			const column = by_key.get(key);
			const conf = col_conf[column.fieldname] || {};
			const numeric = column.role === "measure";
			const band = conf.band && bands.get(conf.band) ? conf.band : null;
			return {
				column,
				title: title(column),
				numeric,
				side: conf.side === "dr" || conf.side === "cr" ? conf.side : null,
				band,
				band_end: false,
				totalled: totalled.has(key),
				currency_key: column.currency?.kind === "row" ? column.currency.key : null,
				index: post.index[key],
				width:
					state.columns.widths[key] ||
					conf.width ||
					(numeric ? Math.max(column.width || 0, 138) : column.width || 140),
			};
		});
		data.forEach((d, i) => {
			d.band_end = Boolean(d.band) && data[i + 1]?.band !== d.band;
		});
		const levels = data.some((d) => d.band) ? 2 : 1;
		return {
			shape: post.shape,
			hierarchical: post.shape !== "flat",
			label,
			label_title: title(label),
			label_width,
			// "number + name" label (register tree.number_key / tree.name_key) of the tree column.
			parts: config.tree?.name_key && (config.tree.label_key || report.tree?.label_key) === label.key ? config.tree : null,
			data,
			levels,
			headers: data.map((d) => (levels === 2 ? [d.band ? bands.get(d.band).label : "", d.title] : [d.title])),
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
		const open = opened.post.tree?.expanded;
		this.tree_open = Array.isArray(open) ? new Set(open.map(Number)) : null;
		const density = state.ui?.density;
		const signature = JSON.stringify({
			shape: model.shape,
			label: [model.label.key, model.label_width],
			cols: model.data.map((d) => [d.column.key, d.width, d.band]),
			density,
		});
		if (this.cache_owner !== report || this.fmt !== fmt) {
			this.html_cache.clear();
			this.cache_owner = report;
		}
		this.fmt = fmt;
		this.session = session;
		this.model = model;
		this.current = opened;
		this.body_rows = opened.body_rows;
		this.counts = { ...opened.counts };
		this.epoch += 1;
		this.windows = [];
		if (!this.rt || this.signature !== signature) this.mount(signature);
		this.render_total();
		await this.rt.draw();
	}

	mount(signature) {
		this.unmount();
		this.signature = signature;
		const m = this.model;
		const host = document.createElement("div");
		host.className = "rv-rt";
		host.innerHTML = `<div class="rv-rt-scroll"><regular-table></regular-table><div class="rv-rt-edge pin-edge-s"></div></div><div class="rv-row total rv-rt-total"></div>`;
		host.style.setProperty("--rv-label-w", `${m.label_width}px`);
		this.parent.replaceChildren(host);
		this.host = host;
		this.total_el = host.querySelector(".rv-rt-total");
		const rt = host.querySelector("regular-table");
		this.rt = rt;
		// Body rows are --rh high plus their 1px line.
		this.row_height = css_int(host, "--rh", 36) + 1;
		rt.setDataListener(this.listener, { column_classes: true });
		if (this.rtl) apply_rtl(rt);
		// Column widths are ours (design widths or the view state), not auto-sized: an
		// override per column, and the same width as the "measured" one so that the scroll
		// range is right before a column was ever drawn.
		const sizes = { 0: m.label_width };
		m.data.forEach((d, i) => (sizes[i + 1] = d.width));
		rt.restoreColumnSizes(sizes);
		if (Array.isArray(rt._column_sizes?.indices)) {
			for (const [key, width] of Object.entries(sizes)) rt._column_sizes.indices[key] = width;
		}
		this.remove_styler = rt.addStyleListener(this.styler);
		rt.addEventListener("click", this.on_click);
		this.resize_observer = new ResizeObserver(() => {
			if (this.rt === rt && this.current) rt.draw();
		});
		this.resize_observer.observe(rt);
	}

	unmount() {
		if (this.resize_observer) this.resize_observer.disconnect();
		this.resize_observer = null;
		if (this.rt) {
			this.rt.removeEventListener("click", this.on_click);
			if (this.remove_styler) this.remove_styler();
		}
		this.remove_styler = null;
		this.rt = null;
		this.host = null;
		this.total_el = null;
		this.signature = null;
		this.total_signature = null;
	}

	/** Detach from the engine view (the caller deletes it) and remove the table. */
	destroy() {
		this.current = null;
		this.model = null;
		this.windows = [];
		this.unmount();
		this.parent.replaceChildren();
	}

	// ------------------------------------------------------------ data model

	empty_response() {
		return { num_rows: 0, num_columns: 0, data: [], row_headers: [], column_headers: [] };
	}

	/** regular-table data listener: one window of the view. */
	async read(x0, y0, x1, y1) {
		const cur = this.current;
		const m = this.model;
		if (!cur || !m) return this.empty_response();
		const base = {
			num_rows: this.body_rows,
			num_columns: m.data.length,
			row_height: this.row_height,
			num_row_headers: 1,
			num_column_headers: m.levels,
			merge_headers: "column",
		};
		const rows = Math.max(0, Math.min(y1, this.body_rows) - y0);
		const end = Math.min(x1, m.data.length);
		// The size request of regular-table (0, 0, 0, 0) needs the dimensions only.
		if (end <= x0 && !rows) return { ...base, data: [], row_headers: [], column_headers: [] };

		const off = cur.post.row_offset;
		const key = `${this.epoch}:${y0}:${y0 + rows}`;
		let cells = {};
		if (rows) {
			const recs_ready = this.windows.find((w) => w.key === key) || this.read_records(cur, key, y0, rows);
			const first = m.data[x0]?.index;
			const cells_ready =
				end > x0
					? cur.view.to_columns({
							start_row: off + y0,
							end_row: off + y0 + rows,
							start_col: first,
							end_col: first + (end - x0),
					  })
					: {};
			const [win, values] = await Promise.all([recs_ready, cells_ready]);
			// A scroll may read the next window before this one is drawn: keep the last few.
			if (this.current === cur) this.windows = [win, ...this.windows.filter((w) => w.key !== key)].slice(0, 4);
			cells = values;
		}

		const data = [];
		const metadata = [];
		for (let x = x0; x < end; x++) {
			const values = cells[m.data[x].column.key] || [];
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

	/** What each row of a window is: a report row (by __rid) or a group Perspective computed. */
	async read_records(cur, key, y0, rows) {
		const { post, view } = cur;
		const off = post.row_offset;
		const grouped = post.row_offset === 1;
		// The technical columns, and the currency columns when they are visible ones: read as
		// runs of neighbouring view columns. A grouped row is open when the next row is deeper,
		// so one row more is read.
		const wanted = [...new Set([...post.technical, ...(grouped ? post.currency_keys : [])])]
			.map((name) => post.index[name])
			.sort((a, b) => a - b);
		const runs = [];
		for (const index of wanted) {
			const last = runs[runs.length - 1];
			if (last && last[1] === index) last[1] = index + 1;
			else runs.push([index, index + 1]);
		}
		const parts = await Promise.all(
			runs.map(([start_col, end_col]) =>
				view.to_columns({ start_row: off + y0, end_row: off + y0 + rows + (grouped ? 1 : 0), start_col, end_col })
			)
		);
		const cols = Object.assign({}, ...parts);
		const win = { key, epoch: this.epoch, y0, rows, recs: new Map() };
		const by_rid = this.session.rows_by_rid;
		const { recs } = win;
		for (let i = 0; i < rows; i++) {
			let rec;
			if (!grouped) {
				const row = by_rid.get(cols[RID][i]);
				const depth = cols[DEPTH]?.[i] ?? 0;
				const parent = Boolean(cols[HAS_CHILDREN]?.[i]);
				rec = { type: "row", row, depth, parent, count: cols[LEAVES]?.[i] ?? null };
				if (parent) rec.open = this.tree_open ? this.tree_open.has(cols[RID][i]) : depth < post.tree.depth;
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
					const next = cols[ROW_PATH][i + 1];
					const currencies = {};
					const mixed = {};
					for (const ck of post.currency_keys) {
						currencies[ck] = cols[ck][i] || null;
						mixed[ck] = !currencies[ck] && (cols[CURRENCY_COUNT_PREFIX + ck]?.[i] || 0) > 1;
					}
					rec = {
						type: "group",
						depth,
						open: Boolean(next) && next.length > path.length,
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
			recs.set(y0 + i, rec);
		}
		return win;
	}

	// ------------------------------------------------------------ interaction

	click(event) {
		const button = event.target.closest?.(".rv-caret");
		if (!button || !this.rt?.contains(button)) return;
		event.preventDefault();
		const meta = this.rt.getMeta(button.closest("th"));
		const win = meta && this.windows.find((w) => w.epoch === this.epoch && w.recs.has(meta.y));
		const rec = win && win.recs.get(meta.y);
		if (!rec || !this.current) return;
		if (rec.type === "row") this.on_tree_toggle(rec.row.__rid);
		else this.toggle_group(meta.y, !rec.open);
	}

	async toggle_group(y, open) {
		const cur = this.current;
		let rows;
		try {
			rows = await this.session.toggle_group(cur, cur.post.row_offset + y, open);
		} catch (e) {
			// The view was replaced and deleted while the group was being opened.
			if (this.current !== cur) return;
			throw e;
		}
		if (this.current !== cur) return;
		this.body_rows = rows;
		this.epoch += 1;
		this.windows = [];
		await this.rt.draw();
		this.on_rows_changed({ ...this.counts });
	}

	// ------------------------------------------------------------ rendering

	label_html(rec) {
		const m = this.model;
		const fmt = this.fmt;
		let inner;
		if (rec.type === "group") {
			const label = rec.node
				? fmt.node_label_html(m.label, rec.node, m.parts)
				: fmt.group_label_html({
						__group_key: rec.key,
						__group_value: group_value(m.by_key.get(rec.key), rec.value),
				  });
			inner = `${caret(rec.open)}${label}${fmt.count_html(rec.count)}`;
		} else {
			const lead = !m.hierarchical ? "" : rec.parent ? caret(rec.open) : '<span class="rv-caret-sp"></span>';
			const label = m.parts ? fmt.label_html(m.label, rec.row, m.parts) : fmt.value_html(m.label, rec.row);
			inner = `${lead}${label}${rec.parent ? fmt.count_html(rec.count) : ""}`;
		}
		return `<div class="rv-lc" style="--lv:${Number(rec.depth) || 0}">${inner}</div>`;
	}

	// {html, sign} of a body cell.
	cell(rec, col, value) {
		const fmt = this.fmt;
		if (rec.type === "row") {
			const key = `${rec.row.__rid}|${col.column.key}`;
			let out = this.html_cache.get(key);
			if (!out) {
				out = { html: fmt.value_html(col.column, rec.row), sign: fmt.sign_of(col.column, rec.row) };
				this.html_cache.set(key, out);
			}
			return out;
		}
		// A group row carries what Perspective aggregated; other columns stay empty.
		if (!col.totalled) return { html: "", sign: "" };
		const k = col.column.key;
		const row = { __kind: "group", ...rec.currencies, [k]: value, __mixed: { [k]: Boolean(rec.mixed[col.currency_key]) } };
		return { html: fmt.value_html(col.column, row), sign: fmt.sign_of(col.column, row) };
	}

	row_class(rec) {
		if (rec.type === "group" || rec.parent) return `rv-tr group d${Math.min(Number(rec.depth) || 0, 2)}`;
		return rec.row.__bold ? "rv-tr bold" : "rv-tr";
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
			const leaf = meta.column_header_y === m.levels - 1;
			const col = leaf && meta.type === "column_header" ? m.data[meta.x] : null;
			const corner = leaf && meta.type === "corner";
			const text = corner ? m.label_title : String(meta.value ?? "");
			if (corner && th.firstElementChild && th.firstElementChild.textContent !== text) {
				th.firstElementChild.textContent = text;
			}
			th.classList.toggle("rv-hd", leaf);
			th.classList.toggle("rv-hb", !leaf);
			th.classList.toggle("empty", !leaf && !text);
			th.classList.toggle("num", Boolean(col?.numeric));
			th.classList.toggle("band-end", Boolean(col?.band_end));
			if (leaf) th.title = text;
			else th.removeAttribute("title");
			if (col) shown.push(meta.x);
		}

		// The window that was drawn: the one that starts at the first row on screen.
		const trs = rt.querySelectorAll("tbody tr");
		const first = trs.length ? rt.getMeta(trs[0].firstElementChild) : null;
		const win = first ? this.windows.find((w) => w.epoch === this.epoch && w.y0 === first.y) : null;
		if (win) {
			for (let i = 0; i < trs.length; i++) {
				const tr = trs[i];
				const th = tr.firstElementChild;
				const meta = th && rt.getMeta(th);
				const rec = meta && meta.y === win.y0 + i ? win.recs.get(meta.y) : null;
				if (!rec) {
					// regular-table keeps a spare row below the last one at the end of the scroll.
					tr.className = "rv-tr stale";
					continue;
				}
				tr.className = this.row_class(rec);
				const stamp = `${this.epoch}:${meta.y}`;
				if (this.rendered.get(th) !== stamp || !th.firstElementChild) {
					th.innerHTML = this.label_html(rec);
					this.rendered.set(th, stamp);
				}
				for (let td = th.nextElementSibling; td; td = td.nextElementSibling) {
					const cm = rt.getMeta(td);
					const col = cm && m.data[cm.x];
					if (!col) continue;
					const cell_stamp = `${stamp}:${cm.x}`;
					if (this.rendered.get(td) === cell_stamp && td.firstElementChild) continue;
					const out = this.cell(rec, col, cm.user?.v);
					const flags = {
						num: col.numeric,
						dr: col.side === "dr",
						cr: col.side === "cr",
						"band-end": col.band_end,
						zero: out.sign === "zero",
						neg: out.sign === "neg",
					};
					for (const name of CELL_CLASSES) td.classList.toggle(name, Boolean(flags[name]));
					td.innerHTML = `<div class="rv-cc">${out.html}</div>`;
					this.rendered.set(td, cell_stamp);
				}
			}
		}
		this.render_total(shown);
	}

	/**
	 * Pinned grand total, outside the scrolling area: the engine's total row (or the report's
	 * reference row in the "as is" tree), aligned with the columns on screen.
	 */
	render_total(shown = null) {
		const cur = this.current;
		const m = this.model;
		if (!cur || !m || !this.total_el) return;
		const xs = shown || this.total_shown || [];
		const signature = `${this.epoch}:${xs.join(",")}`;
		if (this.total_signature === signature) return;
		this.total_signature = signature;
		this.total_shown = xs;
		const fmt = this.fmt;
		const { values, currencies, mixed } = cur.totals;
		const row = { __kind: "grand_total", ...currencies, ...values, __mixed: {} };
		for (const d of m.data) row.__mixed[d.column.key] = Boolean(mixed[d.column.key]);
		const cells = xs.map((x) => {
			const d = m.data[x];
			if (!d) return "";
			const sign = d.totalled ? fmt.sign_of(d.column, row) : "";
			const classes = ["rv-c", d.numeric && "num", d.side, d.band_end && "band-end", sign].filter(Boolean).join(" ");
			const html = d.totalled ? fmt.value_html(d.column, row) : "";
			return `<div class="${classes}" style="width:${d.width}px">${html}</div>`;
		});
		this.total_el.innerHTML =
			`<div class="rv-c pinned pin-edge-s rv-total-label" style="width:${m.label_width}px"><span class="rv-glabel">${esc(__("Grand Total"))}</span>${fmt.count_html(this.counts.facts)}</div>` +
			cells.join("");
	}
}
