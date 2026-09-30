// Grid view: Tabulator rendering of the engine output (docs/architecture.md §11.1-§11.2).
// No calculation here: rows, group subtotals and the grand total all come from the engine.
// Hierarchy (report tree and user grouping) is Tabulator dataTree; no groupBy and no
// columnCalcs of Tabulator's own: bottomCalc returns the engine value.

import { TabulatorFull as Tabulator } from "tabulator-tables";

const ROW_CLASS = {
	group: "rv-group",
	opening: "rv-opening",
	closing: "rv-closing",
	internal_total: "rv-bold",
};

function esc(s) {
	return frappe.utils.escape_html(String(s ?? ""));
}

export class GridView {
	constructor({ parent, rtl }) {
		this.parent = parent;
		this.rtl = rtl;
		this.table = null;
		this.signature = null;
		this.totals = {};
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

	column_defs(report, state, config, fmt) {
		const cols = this.visible_columns(report, state);
		const bands = new Map((config.bands || []).map((b) => [b.id, b]));
		const col_conf = config.columns || {};
		const translate_label = report.__report_type === "Query Report";
		const first_key = cols[0]?.key;
		const ind = parseInt(getComputedStyle(this.parent).getPropertyValue("--ind"), 10) || 18;
		this.indent = ind;

		const leaf_def = (c, is_band_end) => {
			const conf = col_conf[c.fieldname] || {};
			const classes = [];
			if (c.role === "measure") classes.push("rv-num");
			if (conf.side) classes.push(`rv-side-${conf.side}`);
			if (is_band_end) classes.push("rv-band-end");
			const is_first = c.key === first_key;
			const def = {
				title: esc(translate_label ? __(c.label) : c.label),
				field: c.key,
				headerSort: false,
				resizable: true,
				minWidth: 72,
				width: state.columns.widths[c.key] || conf.width || c.width || (is_first ? 300 : 130),
				cssClass: classes.join(" "),
				formatter: (cell) => {
					const row = cell.getRow().getData();
					if (is_first && row.__kind === "group") return fmt.group_label_html(row);
					return fmt.value_html(c, row);
				},
			};
			if (is_first) {
				def.frozen = !conf.band;
				def.bottomCalc = () => __("Total");
				def.bottomCalcFormatter = () => `<b>${esc(__("Total"))}</b>`;
			} else if (c.role === "measure") {
				def.bottomCalc = () => this.totals[c.key];
				def.bottomCalcFormatter = () => fmt.value_html(c, this.totals);
			}
			return def;
		};

		// Consecutive columns of the same band become one column group.
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
				cssClass: `rv-band rv-band-${band_id}`,
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
		const defs = this.column_defs(report, state, config, fmt);
		const tree = result.mode !== "flat";
		const depth =
			result.mode === "group"
				? Infinity
				: state.tree.depth ?? report.tree?.initial_depth ?? 2;
		const signature = JSON.stringify({
			cols: defs.map((d) => d.field || d.columns.map((x) => x.field)),
			tree,
			depth,
			mode: result.mode,
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
			layout: "fitDataStretch",
			textDirection: this.rtl ? "rtl" : "ltr",
			nestedFieldSeparator: false,
			columnCalcs: "table",
			dataTree: tree,
			dataTreeChildField: "_children",
			dataTreeChildIndent: this.indent,
			dataTreeStartExpanded: (row, level) => level < depth,
			renderVertical: "virtual",
			placeholder: "",
			rowFormatter: (row) => {
				const d = row.getData();
				const el_row = row.getElement();
				const cls = ROW_CLASS[d.__kind];
				if (cls) el_row.classList.add(cls);
				if (d.__kind === "group") el_row.classList.add(`rv-d${d.__depth}`);
				if (d.__bold) el_row.classList.add("rv-bold");
				if (d.__kind === "data" && d.__is_leaf === false) el_row.classList.add("rv-parent");
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
