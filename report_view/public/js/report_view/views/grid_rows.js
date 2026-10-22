// The row model of the grid, shared by the table (views/grid_view.js) and the pages
// (views/pages_view.js): the columns as the view state shows them, what every display
// row is (a report row by __rid, a group Perspective computed, its subtotal, a spacer),
// read from windows of the Perspective view, and the classes and content of every cell
// (docs/architecture.md §9.3, §11.1 #45-#52). Nothing is computed here: rows that are
// report rows show the report's own values, rows Perspective computed show the view's.

import { ROW_PATH, caret, engine_value } from "./rt_base.js";
import { RID, KIND } from "../engine/schema.js";
import { DEPTH, HAS_CHILDREN, LEAVES, LEVELS } from "../engine/tree_nodes.js";
import { CURRENCY_COUNT_PREFIX } from "../engine/view_config.js";
import { entry_at } from "../engine/row_layout.js";
import { column_runs } from "../engine/queries.js";
import { header_bands } from "../state/column_groups.js";
import { is_empty } from "../engine/columns_util.js";

// Pinned columns next to the label need room: on a narrower grid only the label is pinned.
const MIN_WIDTH_FOR_PINS = 600;
// View rows this close are read in one window.
const RUN_GAP = 8;
// Formatted report cells kept for a scroll back; beyond this the cache starts again (a
// window is cheap to format, a cell per row of a long report is not cheap to keep).
export const HTML_CACHE_MAX = 50000;
// A column without a band: not the empty string, so that regular-table does not merge its
// band cell with the one of the pinned columns.
const NO_BAND = " ";
// Rows of the view that carry groups to fold (the others are plain lists of report rows).
const HIERARCHICAL = new Set(["tree", "levels", "group"]);
// Class of a summary row of the report, in the body and pinned: the design's subtotal row
// (.rv-row.foot) for a total and a closing, the opening row of its statement drawer
// (.rv-drow.op) for an opening.
const SUMMARY_CLASS = { opening: "opening", internal_total: "foot", closing: "foot closing", group_header: "group d0" };
const BLANK = { html: "", sign: "" };

/** Runs [a, b) of a set of row numbers, rows this close read together. */
function row_runs(rows) {
	const runs = [];
	for (const row of [...new Set(rows)].sort((a, b) => a - b)) {
		const last = runs[runs.length - 1];
		if (last && row - last[1] < RUN_GAP) last[1] = row + 1;
		else runs.push([row, row + 1]);
	}
	return runs;
}

export class GridRows {
	/**
	 * @param {object} [o]
	 * @param {import("../components/header_cells.js").HeaderCells} [o.cells] title and filter
	 *   cells of the headers (the table); without them the model carries no header elements
	 */
	constructor({ cells = null } = {}) {
		this.cells = cells;
		this.model = null;
		this.fmt = null;
		this.session = null;
		this.html_cache = new Map();
		this.captions = new Map();
		this.cache_owner = null;
	}

	/**
	 * Builds the model of a view and keeps the formatter and the session it reads from.
	 * @param {object} p {report, state, config, post, fmt, session, width}
	 * @returns {object} the model
	 */
	set({ report, state, config, post, fmt, session, width }) {
		if (this.cache_owner !== report || this.fmt !== fmt) {
			this.html_cache.clear();
			this.cache_owner = report;
		}
		this.fmt = fmt;
		this.session = session;
		this.model = this.build_model(report, state, config, post, width);
		// Captions depend on the columns shown, not only on the report.
		this.captions.clear();
		return this.model;
	}

	// ------------------------------------------------------------ model

	build_model(report, state, config, post, width) {
		const by_key = new Map(report.columns.map((c) => [c.key, c]));
		const col_conf = config.columns || {};
		const { bands, band_of } = header_bands(state, config);
		const translate_label = report.__report_type === "Query Report";
		const report_label = (c) => (translate_label ? __(c.label) : c.label);
		// With the user's own groups, a column out of every group shows the report's label:
		// the register's short title ("Debit") only reads under its group.
		const own_groups = Array.isArray(state.columns.groups);
		const title = (c) => (own_groups && !band_of(c) ? report_label(c) : col_conf[c.fieldname]?.label || report_label(c));
		const totalled = new Set(post.measures);
		const widths = state.columns.widths;
		const label = by_key.get(post.label_key);
		// Label column: design width 320px, narrower on phones so numbers stay visible.
		const label_width = widths[label.key] || Math.round(Math.min(320, Math.max(170, width * 0.5)));

		const describe = (key) => {
			const column = by_key.get(key);
			const conf = col_conf[column.fieldname] || {};
			const numeric = column.role === "measure";
			return {
				column,
				title: title(column),
				numeric,
				side: conf.side === "dr" || conf.side === "cr" ? conf.side : null,
				band: band_of(column),
				band_end: false,
				totalled: totalled.has(key),
				currency_key: column.currency?.kind === "row" ? column.currency.key : null,
				index: post.index[key],
				width: widths[key] || conf.width || (numeric ? Math.max(column.width || 0, 138) : column.width || 140),
			};
		};
		// columns.pinned.start: row headers of regular-table next to the label column.
		const roomy = width >= MIN_WIDTH_FOR_PINS;
		const pinned = roomy ? post.pinned_keys.map(describe) : [];
		const data = (roomy ? post.data_keys : [...post.pinned_keys, ...post.data_keys]).map(describe);
		for (const p of pinned) p.band = null;
		data.forEach((d, i) => {
			d.band_end = Boolean(d.band) && data[i + 1]?.band !== d.band;
		});
		const levels = data.some((d) => d.band) ? 2 : 1;
		// Header rows: the bands (when any), the titles, then the floating filters. Title and
		// filter cells are elements of components/header_cells.js, the same ones every draw.
		const cells = this.cells;
		const head = (d) => (cells ? [cells.leaf(d.column.key, d.title, d.numeric), cells.filter(d.column.key, d.title)] : [d.title]);
		const band_label = (d) => (d.band ? bands.get(d.band).label : NO_BAND);
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
			headers: data.map((d) => (levels === 2 ? [band_label(d), ...head(d)] : head(d))),
			bands,
			by_key,
		};
	}

	// ------------------------------------------------------------ reading the view

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

	// Named columns of the view for every run of the plan: one read per run of rows and run
	// of neighbouring columns, merged per run of rows.
	async read_named(cur, plan, names) {
		const col_runs = column_runs(cur.post.index, names);
		const parts = await Promise.all(col_runs.map(([start, stop]) => this.read_runs(cur, plan, start, stop)));
		return plan.runs.map((_, r) => Object.assign({}, ...parts.map((part) => part[r])));
	}

	/**
	 * What each row of a window is: a report row (by __rid), a group Perspective computed,
	 * its subtotal, a spacer.
	 * @returns {Promise<Map<number, object>>} display row -> record
	 */
	async read_records(cur, plan, layout) {
		const { post } = cur;
		const grouped = post.row_offset === 1;
		const of_row = cur.fold ? await this.read_fold_rows(cur, plan, layout) : new Map();
		// The technical columns, and the currency columns when they are visible ones: read as
		// runs of neighbouring view columns.
		const by_run = cur.fold ? [] : await this.read_named(cur, plan, [...post.technical, ...(grouped ? post.currency_keys : [])]);
		const by_rid = this.session.rows_by_rid;

		for (const [row, run] of cur.fold ? [] : plan.slot) {
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
		return recs;
	}

	/**
	 * The rows of a grouping of the user (engine/group_fold.js): groups from what the fold
	 * read of the group view, facts by their __rid, read from the flat view in runs.
	 * @returns {Promise<Map<number, object>>} view row -> record
	 */
	async read_fold_rows(cur, plan, layout) {
		const { post, fold } = cur;
		const by_rid = this.session.rows_by_rid;
		const cols = fold.columns;
		const leaf_rows = [];
		for (const row of plan.slot.keys()) if (fold.leaf_at[row] >= 0) leaf_rows.push(fold.leaf_at[row]);
		const runs = row_runs(leaf_rows);
		const at = post.leaves.index[RID];
		const read = await Promise.all(runs.map(([a, b]) => cur.leaves.to_columns({ start_row: a, end_row: b, start_col: at, end_col: at + 1 })));
		const rid_of = (f) => {
			const r = runs.findIndex(([a, b]) => f >= a && f < b);
			return r < 0 ? undefined : read[r][RID]?.[f - runs[r][0]];
		};
		const out = new Map();
		for (const row of plan.slot.keys()) {
			const g = fold.group_at[row];
			if (g < 0) {
				const record = by_rid.get(rid_of(fold.leaf_at[row]));
				if (record) out.set(row, { type: "row", row: record, depth: post.group_keys.length, parent: false });
				continue;
			}
			const path = fold.paths[g];
			const depth = path.length - 1;
			const currencies = {};
			const mixed = {};
			for (const ck of post.currency_keys) {
				currencies[ck] = cols[ck]?.[g] || null;
				mixed[ck] = !currencies[ck] && (cols[CURRENCY_COUNT_PREFIX + ck]?.[g] || 0) > 1;
			}
			out.set(row, {
				type: "group",
				depth,
				open: Boolean(layout.open[row]),
				count: fold.counts[g],
				key: post.group_keys[depth],
				value: path[depth],
				node: null,
				currencies,
				mixed,
			});
		}
		return out;
	}

	/**
	 * Values of the data columns of a window, for the rows Perspective computed (groups and
	 * their subtotals read their numbers from the view). Null when the view is not grouped.
	 * Only the totalled columns are part of a grouped view (engine/view_config.js).
	 * @returns {Promise<Array<object>|null>} per run of the plan, the view's columns by name
	 */
	async read_values(cur, plan, x0, x1) {
		const m = this.model;
		if (cur.post.row_offset !== 1 || x1 <= x0) return null;
		const names = m.data.slice(x0, x1).filter((d) => d.totalled).map((d) => d.column.key);
		if (!names.length) return plan.runs.map(() => ({}));
		if (!cur.fold) return this.read_named(cur, plan, names);
		// a grouping of the user: the group rows of the window, read from the group view
		const fold = cur.fold;
		const groups = [];
		for (const row of plan.slot.keys()) if (fold.group_at[row] >= 0) groups.push(fold.group_at[row]);
		const g_runs = row_runs(groups);
		const col_runs = column_runs(cur.post.index, names);
		const off = cur.post.row_offset;
		const parts = await Promise.all(
			g_runs.map(([a, b]) =>
				Promise.all(col_runs.map(([c0, c1]) => cur.view.to_columns({ start_row: off + a, end_row: off + b, start_col: c0, end_col: c1 })))
			)
		);
		const read = parts.map((p) => Object.assign({}, ...p));
		const out = plan.runs.map(([a, b]) => Object.fromEntries(names.map((name) => [name, new Array(b - a).fill(null)])));
		for (const [row, run] of plan.slot) {
			const g = fold.group_at[row];
			if (g < 0) continue;
			const r = g_runs.findIndex(([a, b]) => g >= a && g < b);
			for (const name of names) out[run][name][row - plan.runs[run][0]] = read[r][name]?.[g - g_runs[r][0]] ?? null;
		}
		return out;
	}

	/** The value of a data column for a view row, out of read_values. */
	value_of(values, plan, row, name) {
		if (!values || row < 0) return null;
		const run = plan.slot.get(row);
		return values[run]?.[name]?.[row - plan.runs[run][0]] ?? null;
	}

	// ------------------------------------------------------------ rows and cells

	foot_text(rec) {
		const m = this.model;
		if (rec.type === "row") return this.fmt.node_text(m.label, rec.row, m.parts);
		if (rec.node) return this.fmt.node_text(m.label, rec.node, m.parts);
		return this.fmt.group_text({ __group_key: rec.key, __group_value: engine_value(m.by_key.get(rec.key), rec.value) });
	}

	/**
	 * The label cell of a record.
	 * @param {object} rec
	 * @param {object} [opts] {foot_label(text): the subtotal caption in another language}
	 */
	label_html(rec, opts = {}) {
		const m = this.model;
		const fmt = this.fmt;
		let inner;
		if (rec.type === "foot") {
			const text = this.foot_text(rec.of);
			inner = `<span class="rv-caret-sp"></span>${opts.foot_label ? opts.foot_label(text) : fmt.foot_label_html(text)}`;
		} else if (rec.type === "group") {
			const label = rec.node
				? fmt.group_title_html(m.label, rec.node, m.parts)
				: fmt.group_label_html({
						__group_key: rec.key,
						__group_value: engine_value(m.by_key.get(rec.key), rec.value),
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
		if (is_empty(row[m.label.key])) {
			const from = [...m.pinned, ...m.data].find((d) => !d.numeric && typeof row[d.column.key] === "string" && row[d.column.key]);
			if (from) out = { key: from.column.key, html: fmt.caption_html(from.column, row) };
		}
		this.captions.set(row.__rid, out);
		return out;
	}

	// A cell of a summary row of the report, as the report returned it (no link is built).
	summary_cell(col, row) {
		if (col.column.key === this.caption_of(row).key) return BLANK;
		return { html: this.fmt.caption_html(col.column, row), sign: this.fmt.sign_of(col.column, row) };
	}

	report_cell(col, row) {
		const key = `${row.__rid}|${col.column.key}`;
		let out = this.html_cache.get(key);
		if (!out) {
			out = { html: this.fmt.value_html(col.column, row), sign: this.fmt.sign_of(col.column, row) };
			if (this.html_cache.size >= HTML_CACHE_MAX) this.html_cache.clear();
			this.html_cache.set(key, out);
		}
		return out;
	}

	// A group row carries what Perspective aggregated; other columns stay empty.
	group_cell(rec, col, value) {
		if (!col.totalled) return BLANK;
		const k = col.column.key;
		const row = { __kind: "group", ...rec.currencies, [k]: value, __mixed: { [k]: Boolean(rec.mixed[col.currency_key]) } };
		return { html: this.fmt.value_html(col.column, row), sign: this.fmt.sign_of(col.column, row) };
	}

	// {html, sign} of a body cell.
	cell(rec, col, value) {
		if (rec.type === "spacer") return BLANK;
		// With subtotal rows, the header of an open group keeps its title and count only: its
		// numbers stand in its subtotal row (design #46, #47).
		const moved = this.model.subtotals && rec.open;
		if (this.is_summary(rec)) return this.summary_cell(col, rec.row);
		if (rec.type === "row") return moved && rec.parent && col.numeric ? BLANK : this.report_cell(col, rec.row);
		if (rec.type === "group") return moved ? BLANK : this.group_cell(rec, col, value);
		const of = rec.of;
		if (of.type === "group") return this.group_cell(of, col, value);
		return col.numeric ? this.report_cell(col, of.row) : BLANK;
	}

	/** The kind of a display row as the design classes it: "group d0", "foot", "opening", "bold", "spacer" or "". */
	row_kind(rec) {
		if (rec.type === "spacer") return "spacer";
		if (rec.type === "foot") return "foot";
		if (rec.type === "group" || rec.parent) return `group d${Math.min(Number(rec.depth) || 0, 2)}`;
		if (this.is_summary(rec)) return SUMMARY_CLASS[rec.row.__kind] || "foot";
		return rec.row.__bold ? "bold" : "";
	}

	// ------------------------------------------------------------ rows outside the body

	/** The report's own rows pinned above and below the body, by __rid. */
	report_rows(cur) {
		const by_rid = this.session.rows_by_rid;
		const rows_of = (rids) => rids.map((rid) => by_rid.get(rid)).filter(Boolean);
		return { top: rows_of(cur.post.pinned_rows.top), bottom: rows_of(cur.post.pinned_rows.bottom) };
	}

	/**
	 * The grand total shown (the engine's total row, or the report's reference row).
	 * @returns {{cell: (d: object) => {html: string, sign: string}, count: number}}
	 */
	total_row(cur, counts) {
		const m = this.model;
		const fmt = this.fmt;
		const { values, currencies, mixed } = cur.totals;
		const total = { __kind: "grand_total", ...currencies, ...values, __mixed: {} };
		for (const d of m.data) total.__mixed[d.column.key] = Boolean(mixed[d.column.key]);
		for (const d of m.pinned) total.__mixed[d.column.key] = Boolean(mixed[d.column.key]);
		return {
			count: counts.facts,
			cell: (d) => (d.totalled ? { html: fmt.value_html(d.column, total), sign: fmt.sign_of(d.column, total) } : BLANK),
		};
	}
}
