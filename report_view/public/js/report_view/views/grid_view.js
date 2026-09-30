// Grid view: Tabulator rendering of the engine output (docs/architecture.md §11.1-§11.2).
// No calculation here: rows, group subtotals and the grand total all come from the engine.
// Hierarchy (report tree and user grouping) is Tabulator dataTree; no groupBy and no
// columnCalcs of Tabulator's own: bottomCalc returns the engine value.
//
// Design classes (reference/prototype/rv.css) are put on Tabulator's own elements, as in the
// mapping table of Tokens.dc.html: .rv-row -> .tabulator-row (+ .group/.d0-2/.foot),
// .rv-c -> .tabulator-cell (+ .num/.dr/.cr/.zero/.neg/.band-end), .rv-hg/.rv-band -> column
// group and its title.

import { TabulatorFull as Tabulator } from "tabulator-tables";

const FOOT_KINDS = new Set(["internal_total", "opening", "closing"]);
const CHEVRON =
	'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>';

function esc(s) {
	return frappe.utils.escape_html(String(s ?? ""));
}

function caret(open) {
	const label = open ? __("Collapse group") : __("Expand group");
	return `<button type="button" class="rv-caret${open ? " open" : ""}" aria-label="${esc(label)}" title="${esc(label)}">${CHEVRON}</button>`;
}

function css_int(el, name, fallback) {
	const v = parseInt(getComputedStyle(el).getPropertyValue(name), 10);
	return Number.isFinite(v) ? v : fallback;
}

export class GridView {
	constructor({ parent, rtl }) {
		this.parent = parent;
		this.rtl = rtl;
		this.table = null;
		this.signature = null;
		this.totals = {};
		this.row_count = 0;
	}

	// Visible columns in display order (view_state.columns).
	visible_columns(report, state) {
		const hidden = new Set(state.columns.hidden);
		let cols = report.columns.filter((c) => !c.hidden && !hidden.has(c.key));
		const order = state.columns.order;
		if (order.length) {
			const pos = new Map(order.map((k, i) => [k, i]));
			cols = [...cols].sort((a, b) => (pos.get(a.key) ?? 1e6) - (pos.get(b.key) ?? 1e6));
		}
		return cols;
	}

	column_defs(report, state, config, fmt, hierarchical) {
		const cols = this.visible_columns(report, state);
		const bands = new Map((config.bands || []).map((b) => [b.id, b]));
		const col_conf = config.columns || {};
		const translate_label = report.__report_type === "Query Report";
		const first_key = cols[0]?.key;
		const parts = config.tree?.name_key ? config.tree : null;
		// Label column: design width 320px, narrower on phones so numbers stay visible.
		const label_width = Math.round(Math.min(320, Math.max(170, this.parent.clientWidth * 0.5)));

		const first_html = (c, row) => {
			if (row.__kind === "group") return fmt.group_label_html(row);
			const has_kids = Boolean(row._children?.length);
			const spacer = hierarchical && !has_kids ? '<span class="rv-caret-sp"></span>' : "";
			const label = parts ? fmt.label_html(c, row, parts) : fmt.value_html(c, row);
			const count = has_kids ? fmt.count_html(row.__count) : "";
			return `${spacer}${label}${count}`;
		};

		// .rv-c is set here and not in cssClass: cssClass also goes on the header element.
		const set_sign = (cell, c, row) => {
			const el = cell.getElement();
			el.classList.add("rv-c");
			const sign = fmt.sign_of(c, row);
			el.classList.toggle("zero", sign === "zero");
			el.classList.toggle("neg", sign === "neg");
		};

		const leaf_def = (c, is_band_end) => {
			const conf = col_conf[c.fieldname] || {};
			const is_first = c.key === first_key;
			const is_measure = c.role === "measure";
			const classes = [];
			if (is_first) classes.push("rv-label");
			if (is_measure) classes.push("num");
			if (conf.side === "dr" || conf.side === "cr") classes.push(conf.side);
			if (is_band_end) classes.push("band-end");
			const label = conf.label || (translate_label ? __(c.label) : c.label);
			const width =
				state.columns.widths[c.key] ||
				conf.width ||
				(is_first ? label_width : is_measure ? Math.max(c.width || 0, 138) : c.width || 140);
			const def = {
				title: esc(label),
				titleFormatter: () => `<span class="rv-hlabel" title="${esc(label)}">${esc(label)}</span>`,
				field: c.key,
				headerSort: false,
				resizable: true,
				minWidth: 72,
				width,
				cssClass: classes.join(" "),
				formatter: (cell) => {
					const row = cell.getRow().getData();
					if (is_first) {
						cell.getElement().classList.add("rv-c");
						return first_html(c, row);
					}
					set_sign(cell, c, row);
					return fmt.value_html(c, row);
				},
			};
			if (is_first) {
				def.frozen = !conf.band;
				def.bottomCalc = () => "total";
				def.bottomCalcFormatter = (cell) => {
					cell.getElement().classList.add("rv-c");
					return `<span class="rv-glabel">${esc(__("Grand Total"))}</span>${fmt.count_html(this.row_count)}`;
				};
			} else if (is_measure) {
				def.bottomCalc = () => this.totals[c.key];
				def.bottomCalcFormatter = (cell) => {
					set_sign(cell, c, this.totals);
					return fmt.value_html(c, this.totals);
				};
			}
			return def;
		};

		// Consecutive columns of the same band become one column group (.rv-hg / .rv-band).
		const defs = [];
		for (let i = 0; i < cols.length; i++) {
			const c = cols[i];
			const band_id = col_conf[c.fieldname]?.band;
			const band = band_id && bands.get(band_id);
			if (!band) {
				defs.push(leaf_def(c, false));
				continue;
			}
			const members = [];
			while (i < cols.length && col_conf[cols[i].fieldname]?.band === band_id) {
				members.push(cols[i]);
				i++;
			}
			i--;
			defs.push({
				title: esc(band.label),
				cssClass: `rv-hg rv-band-${band_id}`,
				columns: members.map((m, j) => leaf_def(m, j === members.length - 1)),
			});
		}
		return defs;
	}

	/**
	 * @param {object} report NormalizedReport
	 * @param {object} result engine.apply() output
	 * @param {object} state view state
	 * @param {object} config report_view.register config
	 * @param {object} fmt format.js formatter
	 */
	render(report, result, state, config, fmt) {
		this.totals = result.totals;
		this.row_count = result.row_count;
		const tree = result.mode !== "flat";
		const defs = this.column_defs(report, state, config, fmt, tree);
		const depth =
			result.mode === "group"
				? Infinity
				: state.tree.depth ?? report.tree?.initial_depth ?? 2;
		const indent = css_int(this.parent, "--ind", 18);
		const signature = JSON.stringify({
			cols: defs.map((d) => d.field || d.columns.map((x) => x.field)),
			tree,
			depth,
			mode: result.mode,
			indent,
			density: state.ui?.density,
		});
		if (this.table && this.signature === signature) {
			return this.ready.then(() => this.table.replaceData(result.rows)).then(() => this.table.recalc());
		}
		this.destroy();
		this.signature = signature;
		const el = document.createElement("div");
		el.className = "rv-tabulator";
		this.parent.replaceChildren(el);
		this.table = new Tabulator(el, {
			data: result.rows,
			columns: defs,
			index: "__id",
			height: "100%",
			layout: "fitData",
			textDirection: this.rtl ? "rtl" : "ltr",
			nestedFieldSeparator: false,
			columnHeaderVertAlign: "bottom",
			columnCalcs: "table",
			selectableRows: false,
			dataTree: tree,
			dataTreeChildField: "_children",
			dataTreeChildIndent: indent,
			dataTreeBranchElement: false,
			dataTreeExpandElement: caret(false),
			dataTreeCollapseElement: caret(true),
			dataTreeStartExpanded: (row, level) => level < depth,
			renderVertical: "virtual",
			placeholder: "",
			rowFormatter: (row) => {
				const d = row.getData();
				const cl = row.getElement().classList;
				const is_group = d.__kind === "group" || Boolean(d._children?.length);
				if (is_group) {
					const level = d.__kind === "group" ? d.__depth : d.__indent;
					cl.add("group", `d${Math.min(Number(level) || 0, 2)}`);
				} else if (FOOT_KINDS.has(d.__kind)) {
					cl.add("foot");
				}
				if (d.__bold) cl.add("bold");
			},
		});
		this.ready = new Promise((resolve) => this.table.on("tableBuilt", resolve));
		return this.ready;
	}

	// Raw numbers shown in the pinned total row (used by tests and the export check).
	total_values() {
		return { ...this.totals };
	}

	destroy() {
		if (this.table) {
			this.table.destroy();
			this.table = null;
		}
		this.signature = null;
	}
}
