// What the controls of the page do to the view state (docs/architecture.md §7.1): browser
// filters (floating filters, set filter, filter panel, search), quick filters, sort, column
// visibility and pins, grouping, aggregates, and the menus and panels that offer them. Every
// change goes through the page (ReportViewPage.change), which opens the new Perspective view
// and writes the URL. Nothing here reads or computes report values: values and counts of a
// column come from temporary engine views (ReportSession.unique_values).

import { perspective_type } from "./engine/schema.js";
import { visible_columns, ordered_columns } from "./engine/view_config.js";
import { default_state } from "./state/view_state.js";
import { resolve_pivot, pivot_dimensions, pivot_measures, PIVOT_AGGS } from "./engine/pivot_config.js";
import { AGG_TITLES } from "./views/pivot_view.js";
import { header_bands, order_for_groups } from "./state/column_groups.js";
import { icons } from "./components/icons.js";
import { open_popover, close_popover, menu_content } from "./components/popover.js";
import { open_set_filter } from "./components/set_filter.js";
import { parse_number, parse_date } from "./components/header_cells.js";
import { esc, fmt_float } from "./util.js";
import { is_empty } from "./engine/columns_util.js";

export class ViewControls {
	/** @param {import("./index.js").ReportViewPage} page */
	constructor(page) {
		this.page = page;
	}

	get state() {
		return this.page.state;
	}

	get report() {
		return this.page.report;
	}

	get config() {
		return this.page.config || {};
	}

	column(key) {
		return this.report?.columns.find((c) => c.key === key) || null;
	}

	// ------------------------------------------------------------ titles

	/** Title of a column as the grid shows it (register label, else the report's). */
	title(key) {
		const c = this.column(key);
		if (!c) return key;
		const conf = this.config.columns?.[c.fieldname] || {};
		if (conf.label) return conf.label;
		return this.report.__report_type === "Query Report" ? __(c.label) : c.label;
	}

	/** The report's own label of a column, without the register's shorter title. */
	report_label(key) {
		const c = this.column(key);
		if (!c) return key;
		return this.report.__report_type === "Query Report" ? __(c.label) : c.label;
	}

	/** Title with its band ("Opening Balance · Debit"), for menus and facets. */
	full_title(key) {
		const c = this.column(key);
		if (!c) return key;
		const { bands, band_of } = header_bands(this.state, this.config);
		const band = bands.get(band_of(c));
		return band ? `${band.label} · ${this.title(key)}` : this.title(key);
	}

	label_key() {
		return visible_columns(this.report, this.state)[0]?.key || null;
	}

	// ------------------------------------------------------------ kinds of columns

	/** The floating filter of a column. */
	kind(key) {
		const c = this.column(key);
		if (!c) return null;
		const type = perspective_type(c.fieldtype);
		if (c.role === "measure") return type === "float" ? "range" : null;
		if (type === "date" || type === "datetime") return "date";
		if (type !== "string") return null;
		return key === this.label_key() ? "text" : "set";
	}

	/** A column that may be a level of a grouping: a dimension or attribute, not the label. */
	groupable(key) {
		const c = this.column(key);
		return Boolean(c) && c.role !== "measure" && key !== this.label_key();
	}

	group_keys() {
		return ordered(this.report).filter((c) => !c.hidden && this.groupable(c.key)).map((c) => c.key);
	}

	// ------------------------------------------------------------ filters

	filter_of(key) {
		return (this.state?.filters || []).find((f) => f.key === key) || null;
	}

	/** Replaces the browser filter of a column (null removes it). */
	set_filter(key, filter) {
		this.page.change((s) => {
			const rest = s.filters.filter((f) => f.key !== key);
			s.filters = filter ? [...rest, filter] : rest;
		});
	}

	set_range(key, kind, from_text, to_text) {
		const parse = kind === "date" ? parse_date : parse_number;
		const lo = parse(from_text);
		const hi = parse(to_text);
		let f = null;
		if (kind === "date" && (lo || hi)) f = { key, type: "date", from: lo, to: hi };
		if (kind === "range" && (lo !== null || hi !== null)) f = { key, type: "range", min: lo, max: hi };
		this.set_filter(key, f);
	}

	toggle_quick(id) {
		const defs = this.config.quick_filters || [];
		const def = defs.find((q) => q.id === id);
		this.page.change((s) => {
			const on = s.quick_filters.includes(id);
			let next = s.quick_filters.filter((q) => q !== id);
			if (!on) {
				// Quick filters of one exclusive group (debit or credit balances) replace each other.
				if (def?.exclusive) next = next.filter((q) => defs.find((d) => d.id === q)?.exclusive !== def.exclusive);
				next.push(id);
			}
			s.quick_filters = next;
		});
	}

	clear_filters() {
		this.page.change((s) => {
			s.filters = [];
			s.quick_filters = [];
		});
	}

	active_count() {
		return (this.state?.filters?.length || 0) + (this.state?.quick_filters?.length || 0);
	}

	/** A value of a column as markup (no link), for lists of values. */
	value_html(key, value) {
		const c = this.column(key);
		if (is_empty(value)) return `<span class="rv-muted">${esc(__("Not Set"))}</span>`;
		if (!c) return esc(value);
		const type = perspective_type(c.fieldtype);
		let v = value;
		if (type === "date" && typeof v === "number") v = new Date(v).toISOString().slice(0, 10);
		return this.page.formatter.caption_html(c, { [key]: v, __kind: "group" }) || esc(v);
	}

	value_text(key, value) {
		return frappe.utils.html2text(String(this.value_html(key, value))).trim();
	}

	/** Unique values of a column with their counts (a temporary view of the engine). */
	async load_values(key, search = "") {
		const session = this.page.session;
		if (!session) return { values: [] };
		const out = await session.unique_values(this.state, key, search ? { search } : {});
		return { values: out.values.map((v) => ({ value: v.value, count: v.count, label_html: this.value_html(key, v.value) })), truncated: out.truncated };
	}

	/** Text of the set button of a floating filter. */
	set_label(key) {
		const f = this.filter_of(key);
		if (!f || f.type !== "set") return __("All");
		if (!f.values.length) return __("None");
		if (f.values.length === 1) return this.value_text(key, f.values[0]);
		return __("{0} values", [f.values.length]);
	}

	open_set(key, anchor) {
		const f = this.filter_of(key);
		open_set_filter({
			root: this.page.root,
			anchor,
			title: this.title(key),
			selected: f?.type === "set" ? [...f.values] : null,
			load: (search) => this.load_values(key, search),
			on_change: (selected) =>
				this.set_filter(key, selected ? { key, type: "set", values: selected, exclude: false } : null),
		});
	}

	/** Facets of the search box: one per active filter. */
	chips() {
		const s = this.state;
		if (!s || !this.report) return [];
		const or = __("or");
		const num = (n) => fmt_float(n);
		const out = [];
		for (const f of s.filters) {
			let v = "";
			if (f.type === "text") v = __("contains «{0}»", [f.value]);
			else if (f.type === "set") {
				const labels = f.values.map((x) => this.value_text(f.key, x));
				v = !labels.length ? __("None") : labels.length > 2 ? `${labels.slice(0, 2).join(` ${or} `)} +${labels.length - 2}` : labels.join(` ${or} `);
			} else if (f.type === "range") {
				const parts = [];
				if (Number.isFinite(f.min)) parts.push(`≥ ${num(f.min)}`);
				if (Number.isFinite(f.max)) parts.push(`≤ ${num(f.max)}`);
				v = parts.join(` ${__("and")} `);
			} else if (f.type === "date") {
				const parts = [];
				if (f.from) parts.push(`≥ ${frappe.datetime.str_to_user(f.from)}`);
				if (f.to) parts.push(`≤ ${frappe.datetime.str_to_user(f.to)}`);
				v = parts.join(` ${__("and")} `);
			}
			out.push({ k: this.full_title(f.key), v, remove: () => this.set_filter(f.key, null) });
		}
		for (const id of s.quick_filters) {
			const def = (this.config.quick_filters || []).find((q) => q.id === id);
			out.push({ k: __("Filter", null, "Report View"), v: def ? def.label : id, remove: () => this.toggle_quick(id) });
		}
		return out;
	}

	// ------------------------------------------------------------ search box host

	search_host() {
		return {
			chips: () => this.chips(),
			placeholder: () => {
				if (!this.report) return __("Search or filter…");
				const keys = [this.label_key(), ...this.group_keys()].filter(Boolean).slice(0, 3);
				return __("Search or filter: {0}…", [keys.map((k) => this.title(k)).join(__(", "))]);
			},
			search: (text) => this.search_label(text),
			suggestions: () => {
				if (!this.report) return [];
				const label = this.label_key();
				const out = [{ column: this.title(label), hint: "Enter", act: (t) => this.search_label(t) }];
				for (const key of this.group_keys()) {
					if (this.kind(key) !== "set") continue;
					out.push({ column: this.title(key), act: (t) => this.search_values(key, t) });
				}
				return out;
			},
			options: () => this.search_options(),
		};
	}

	search_label(text) {
		const key = this.label_key();
		if (key) this.set_filter(key, { key, type: "text", op: "contains", value: text });
	}

	// Every value of the column that contains the text becomes its set filter.
	async search_values(key, text) {
		const out = await this.load_values(key, text);
		if (!out.values.length) {
			frappe.show_alert({ message: __("No values match «{0}»", [text]), indicator: "orange" });
			return;
		}
		this.set_filter(key, { key, type: "set", values: out.values.map((v) => v.value), exclude: false });
	}

	async search_options() {
		const s = this.state;
		const quick = (this.config.quick_filters || []).map((q) => ({
			label: q.label,
			on: Boolean(s?.quick_filters.includes(q.id)),
			toggle: () => this.toggle_quick(q.id),
		}));
		let facets = [];
		const facet = this.config.search_facet;
		if (facet && this.column(facet) && this.report) {
			try {
				const out = await this.load_values(facet);
				const f = this.filter_of(facet);
				const chosen = f?.type === "set" ? f.values : [];
				facets = out.values
					.filter((v) => !is_empty(v.value))
					.map((v) => ({
						label: this.value_text(facet, v.value),
						on: chosen.includes(v.value),
						toggle: () => {
							const cur = this.filter_of(facet);
							const now = cur?.type === "set" ? [...cur.values] : [];
							const next = now.includes(v.value) ? now.filter((x) => x !== v.value) : [...now, v.value];
							this.set_filter(facet, next.length ? { key: facet, type: "set", values: next, exclude: false } : null);
						},
					}));
			} catch {
				facets = [];
			}
		}
		const by = s?.group.by || [];
		const groups = this.report
			? this.group_keys().map((k) => ({
					label: this.title(k),
					on: by.includes(k),
					order: by.includes(k) ? by.indexOf(k) + 1 : 0,
					toggle: () => this.set_group(by.includes(k) ? by.filter((x) => x !== k) : [...by, k]),
			  }))
			: [];
		const label = this.report ? this.title(this.label_key()) : "";
		return {
			quick,
			facets,
			groups,
			hint: __("Type a text to search {0}, or a value of another column. Backspace removes the last facet.", [label]),
		};
	}

	// ------------------------------------------------------------ sort, columns, groups

	sort_of(key) {
		return (this.state?.sort || []).find((x) => x.key === key)?.dir || null;
	}

	// A click on a title: ascending, descending, then none.
	toggle_sort(key) {
		const dir = this.sort_of(key);
		this.set_sort(key, dir === null ? "asc" : dir === "asc" ? "desc" : null);
	}

	set_sort(key, dir) {
		this.page.change((s) => {
			s.sort = dir ? [{ key, dir }] : [];
		});
	}

	toggle_column(key, on) {
		if (key === this.label_key() && !on) return;
		this.page.change((s) => {
			const hidden = s.columns.hidden.filter((k) => k !== key);
			s.columns.hidden = on ? hidden : [...hidden, key];
			if (!on) s.columns.pinned.start = s.columns.pinned.start.filter((k) => k !== key);
		});
	}

	set_pin(key, side) {
		this.page.change((s) => {
			const start = s.columns.pinned.start.filter((k) => k !== key);
			s.columns.pinned.start = side === "start" ? [...start, key] : start;
		});
	}

	// ------------------------------------------------------------ column groups

	/** The groups as the header shows them now: the user's, else the report's. */
	column_groups() {
		if (Array.isArray(this.state?.columns?.groups)) return this.state.columns.groups;
		const { band_of } = header_bands({ columns: { groups: null } }, this.config);
		const groups = new Map();
		for (const c of visible_columns(this.report, this.state)) {
			const id = band_of(c);
			if (!id) continue;
			if (!groups.has(id)) groups.set(id, { label: (this.config.bands || []).find((b) => b.id === id).label, keys: [] });
			groups.get(id).keys.push(c.key);
		}
		return [...groups.values()];
	}

	/**
	 * Apply the user's groups (null = the report's own) and keep them for this user and
	 * report (Frappe user settings), so they come back on the next visit.
	 */
	set_column_groups(groups) {
		// Every column, hidden ones too, so that showing one again keeps its place.
		const all = { columns: { ...this.state.columns, hidden: [] } };
		const keys = visible_columns(this.report, all).map((c) => c.key);
		this.page.change((s) => {
			s.columns.groups = groups;
			if (groups) s.columns.order = order_for_groups(keys, groups);
		});
		this.page.save_user_groups(groups);
	}

	reset_columns() {
		const base = default_state(this.config);
		this.page.change((s) => {
			s.columns = base.columns;
			s.sort = [];
			s.values = [];
		});
	}

	set_group(by) {
		this.page.change((s) => {
			s.group.by = by;
			// Paths of open groups belong to the grouping they were made in.
			s.group.expanded = "all";
		});
	}

	set_agg(key, agg) {
		this.page.change((s) => {
			const rest = (s.values || []).filter((v) => v.key !== key);
			s.values = [...rest, { key, agg }];
		});
	}

	// ------------------------------------------------------------ pivot (analysis) mode

	/** The pivot of the view state, made valid for the report (its default one when not set). */
	pivot() {
		if (!this.report || !this.state) return null;
		return resolve_pivot(this.state, this.report, this.config, this.label_key());
	}

	/** Title of a pivot dimension: a level of the report tree, or a column. */
	dim_title(key) {
		const level = /^level_(\d+)$/.exec(key || "");
		if (level) return Number(level[1]) === 1 ? __("Top-level groups") : __("Level {0}", [level[1]]);
		return this.title(key);
	}

	pivot_dims() {
		return this.report ? pivot_dimensions(this.report).map((d) => ({ key: d.key, label: this.dim_title(d.key), type: d.type })) : [];
	}

	pivot_measures() {
		return this.report ? pivot_measures(this.report).map((key) => ({ key, label: this.full_title(key) })) : [];
	}

	/** A dimension the pivot may group or split by. */
	pivotable(key) {
		return this.pivot_dims().some((d) => d.key === key);
	}

	value_title(v) {
		return AGG_TITLES[v.agg](this.full_title(v.key));
	}

	/**
	 * Change the pivot: `fn` edits a copy of the resolved pivot. A pivot column is never also a
	 * row: the place it is put wins.
	 */
	edit_pivot(fn, mode = null) {
		const p = this.pivot();
		if (!p) return;
		const next = { rows: [...p.rows], cols: [...p.cols], values: p.values.map((v) => ({ ...v })), totals: { ...p.totals } };
		fn(next);
		this.page.set_pivot(next, mode);
	}

	set_pivot_rows(rows) {
		this.edit_pivot((p) => {
			p.rows = rows.filter((k) => this.pivotable(k));
			p.cols = p.cols.filter((k) => !p.rows.includes(k));
		});
	}

	// A pivot column added outside pivot mode (dropped on the pivot zone) turns the mode on (design).
	set_pivot_cols(cols) {
		this.edit_pivot(
			(p) => {
				p.cols = cols.filter((k) => this.pivotable(k));
				p.rows = p.rows.filter((k) => !p.cols.includes(k));
			},
			cols.length ? "pivot" : null
		);
	}

	/** A pivot column dropped among the rows at `at` (or a row among the columns). */
	move_pivot_dim(key, to, at) {
		this.edit_pivot((p) => {
			const from = to === "rows" ? "cols" : "rows";
			p[from] = p[from].filter((k) => k !== key);
			const list = p[to].filter((k) => k !== key);
			list.splice(Math.min(at ?? list.length, list.length), 0, key);
			p[to] = list;
		});
	}

	add_pivot_value(key, agg = null) {
		const column = this.column(key);
		this.edit_pivot((p) => {
			const a = agg || (PIVOT_AGGS.includes(column?.agg) ? column.agg : "sum");
			if (!p.values.some((v) => v.key === key && v.agg === a)) p.values.push({ key, agg: a });
		});
	}

	set_pivot_agg(index, agg) {
		this.edit_pivot((p) => {
			if (!p.values[index] || !PIVOT_AGGS.includes(agg)) return;
			p.values[index].agg = agg;
			p.values = p.values.filter((v, i) => p.values.findIndex((o) => o.key === v.key && o.agg === v.agg) === i);
		});
	}

	remove_pivot_value(index) {
		this.edit_pivot((p) => {
			p.values = p.values.filter((_, i) => i !== index);
		});
	}

	// ------------------------------------------------------------ column menu

	open_column_menu(key, anchor) {
		const c = this.column(key);
		if (!c) return;
		const s = this.state;
		const rtl = this.page.rtl;
		const label = key === this.label_key();
		const pinned = label || s.columns.pinned.start.includes(key);
		const pinnable = !label && c.role !== "measure";
		const by = s.group.by;
		const kind = this.kind(key);
		const no_pin = __("A numeric column cannot be pinned: a group row has no value of its own for it");
		const items = [
			{
				label: rtl ? __("Pin right") : __("Pin left"),
				icon: icons.pin(),
				check: pinned ? icons.check_sm() : "",
				disabled: !pinnable,
				title: c.role === "measure" ? no_pin : label ? __("The label column is always pinned") : "",
				act: () => this.set_pin(key, "start"),
			},
			{
				label: rtl ? __("Pin left") : __("Pin right"),
				disabled: true,
				title: __("The grid pins columns at the start only"),
				act: () => {},
			},
			{
				label: __("No pin"),
				check: pinned ? "" : icons.check_sm(),
				disabled: !pinnable,
				title: c.role === "measure" ? no_pin : "",
				act: () => this.set_pin(key, null),
			},
			{ sep: true },
			{ label: __("Autosize this column"), icon: icons.fit(), act: () => this.page.grid.autosize(key) },
			{ label: __("Autosize all columns"), act: () => this.page.grid.autosize(null) },
			{ sep: true },
			{
				label: this.groupable(key) ? __("Group by «{0}»", [this.title(key)]) : __("Group by this column"),
				icon: icons.group(),
				disabled: !this.groupable(key) || by.includes(key),
				act: () => this.set_group([...by, key]),
			},
		];
		if (kind === "set") items.push({ label: __("Filter values…"), icon: icons.funnel(15), act: () => this.open_set(key, anchor) });
		items.push(
			{ sep: true },
			{ label: __("Sort ascending"), icon: icons.sort_asc(15), act: () => this.set_sort(key, "asc") },
			{ label: __("Sort descending"), icon: icons.sort_desc(15), act: () => this.set_sort(key, "desc") },
			{ sep: true },
			{ label: __("Hide the column"), icon: icons.hide(), disabled: label, act: () => this.toggle_column(key, false) },
			{ label: __("Reset the columns"), icon: icons.reset(), act: () => this.reset_columns() }
		);
		const wrapped = items.map((it) =>
			it.sep || it.disabled
				? it
				: {
						...it,
						act: () => {
							// The set filter opens in place of the menu, on the same anchor.
							close_popover();
							it.act();
						},
				  }
		);
		const content = menu_content(wrapped, this.full_title(key));
		this.page.cells.set_menu(key);
		open_popover({
			root: this.page.root,
			anchor,
			content,
			width: 236,
			role: "menu",
			label: __("Column menu"),
			on_close: () => this.page.cells.set_menu(null),
		});
		content.querySelector(".rv-mi:not(:disabled)")?.focus();
	}

	// ------------------------------------------------------------ side panel host

	side_host() {
		return {
			side: () => this.state?.ui.side_panel || null,
			set_side: (name) => {
				if (!this.state) return;
				this.state.ui.side_panel = name;
				this.page.side.refresh();
			},
			columns: () => this.columns_data(),
			filters: () => this.filters_data(),
			toggle_column: (key, on) => this.toggle_column(key, on),
			set_group: (by) => this.set_group(by),
			groupable: (key) => this.groupable(key),
			set_agg: (key, agg) => this.set_agg(key, agg),
			mode: () => this.state?.mode || "grid",
			set_mode: (mode) => this.page.set_mode(mode),
			pivot: () => this.pivot_data(),
			pivot_rows: (rows) => this.set_pivot_rows(rows),
			pivot_cols: (cols) => this.set_pivot_cols(cols),
			pivot_add_value: (key) => this.add_pivot_value(key),
			pivot_agg: (i, agg) => this.set_pivot_agg(i, agg),
			pivot_remove_value: (i) => this.remove_pivot_value(i),
			pivotable: (key) => this.pivotable(key),
			clear_filters: () => this.clear_filters(),
			set_filter: (key, f) => this.set_filter(key, f),
			set_range: (key, kind, a, b) => this.set_range(key, kind, a, b),
			load_values: (key) => this.load_values(key),
		};
	}

	columns_data() {
		if (!this.report || !this.state) return { items: [], groups: [], values: [] };
		const s = this.state;
		const hidden = new Set(s.columns.hidden);
		const label = this.label_key();
		const items = ordered(this.report)
			.filter((c) => !c.hidden)
			.map((c) => ({
				key: c.key,
				label: this.full_title(c.key),
				on: !hidden.has(c.key),
				locked: c.key === label,
				tag: c.role === "measure" ? "num" : c.key !== label && this.groupable(c.key) && c.role === "dimension" ? "dim" : "text",
			}));
		const shown = visible_columns(this.report, s);
		const values = shown
			.filter((c) => c.role === "measure" && c.agg)
			.map((c) => ({ key: c.key, label: this.full_title(c.key), agg: (s.values || []).find((v) => v.key === c.key)?.agg || c.agg }));
		return { items, groups: s.group.by.map((k) => ({ key: k, label: this.title(k) })), values };
	}

	/** What the columns panel shows of the pivot: its rows, columns and values with labels, and what may be added. */
	pivot_data() {
		const p = this.pivot();
		if (!p) return null;
		const dims = this.pivot_dims();
		const label = (k) => dims.find((d) => d.key === k)?.label || k;
		const used = new Set([...p.rows, ...p.cols]);
		return {
			rows: p.rows.map((k) => ({ key: k, label: label(k) })),
			cols: p.cols.map((k) => ({ key: k, label: label(k) })),
			values: p.values.map((v) => ({ key: v.key, agg: v.agg, label: this.full_title(v.key) })),
			dims: dims.filter((d) => !used.has(d.key)),
			measures: this.pivot_measures(),
		};
	}

	filters_data() {
		if (!this.report || !this.state) return { active: 0, sections: [] };
		const s = this.state;
		const label = this.label_key();
		const sections = [];
		const shown = visible_columns(this.report, s);
		const keys = [...new Set([label, ...this.group_keys(), ...shown.map((c) => c.key)])].filter(Boolean);
		let first_set = true;
		for (const key of keys) {
			const kind = this.kind(key);
			if (!kind) continue;
			const f = this.filter_of(key);
			const sec = { id: key, key, label: this.full_title(key), kind, active: Boolean(f), open_default: false };
			if (kind === "text") {
				sec.value = f?.type === "text" ? f.value : "";
				sec.open_default = true;
			} else if (kind === "set") {
				sec.selected = f?.type === "set" ? [...f.values] : null;
				sec.open_default = first_set;
				first_set = false;
			} else if (kind === "range") {
				sec.min = Number.isFinite(f?.min) ? f.min : "";
				sec.max = Number.isFinite(f?.max) ? f.max : "";
			} else if (kind === "date") {
				sec.min = f?.from ? frappe.datetime.str_to_user(f.from) : "";
				sec.max = f?.to ? frappe.datetime.str_to_user(f.to) : "";
			}
			sections.push(sec);
		}
		const quick = this.config.quick_filters || [];
		if (quick.length) {
			sections.push({
				id: "__quick",
				label: __("Quick options"),
				kind: "quick",
				active: s.quick_filters.length > 0,
				open_default: true,
				items: quick.map((q) => ({ label: q.label, on: s.quick_filters.includes(q.id), toggle: () => this.toggle_quick(q.id) })),
			});
		}
		return { active: this.active_count(), sections };
	}
}

// Columns of the report in their default order (enrichment next to its source).
function ordered(report) {
	return ordered_columns(report);
}
