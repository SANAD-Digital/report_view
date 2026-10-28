// Chart from range (phase 5d, AG Grid's integrated charts): a dialog with an ECharts chart of the
// selected cells and a small switch of its type (the chart types the report's settings allow,
// state/features.js chart_types; no number card). Loaded with the Charts bundle.
//
// The values are the engine's: the page reads the range (GridView.range_data with its own
// view of the range's report rows, kept while the dialog is open and deleted when it closes).
// The rows are those the status bar sums (state/range.js countable_rows): a group and the
// rows inside it are never drawn side by side. Colours are the chart tokens (--c1..--c7).

import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import { chart_option } from "./chart_option.js";
import { PALETTE, TYPE_ICONS, TYPE_LABELS } from "./chart_card.js";
import { drawer_module } from "./charts_shared.js";
import { esc } from "../util.js";

echarts.use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, SVGRenderer]);

const { Drawer } = drawer_module;
// At most this many categories and series in a chart of a range.
export const MAX_RANGE_ROWS = 200;
export const MAX_RANGE_SERIES = 8;
const TYPES = ["bar", "stacked", "hbar", "hstacked", "line", "area", "donut"];

/**
 * What a chart of a range draws: the rows the sum counts, the numeric columns, their values.
 * Pure: the values are the engine's as range_data read them.
 * @param {{columns: Array, rows: Array<{cells: Array}>, countable: boolean[]}} data
 * @param {(row: object) => string} label_of the category text of a row
 * @returns {{labels: string[], series: Array<{key, column, values}>, truncated: boolean}}
 */
export function range_series(data, label_of) {
	const numeric = data.columns.map((d, i) => ({ d, i })).filter(({ d }) => d.numeric).slice(0, MAX_RANGE_SERIES);
	const rows = data.rows.filter((_, i) => data.countable[i]);
	const shown = rows.slice(0, MAX_RANGE_ROWS);
	return {
		labels: shown.map((row) => String(label_of(row) ?? "")),
		series: numeric.map(({ d, i }) => ({
			key: d.column.key,
			column: d.column,
			title: d.title,
			values: shown.map((row) => (typeof row.cells[i] === "number" && Number.isFinite(row.cells[i]) ? row.cells[i] : null)),
		})),
		truncated: rows.length > shown.length,
	};
}

export class RangeChart {
	/**
	 * @param {object} o
	 * @param {HTMLElement} o.root the .rv element
	 * @param {boolean} o.rtl
	 * @param {string[]} o.types the chart types allowed
	 * @param {string} o.title the report's name (the dialog's subtitle)
	 * @param {() => Promise<object|null>} o.read the range's data (GridView.range_data, own view)
	 * @param {(row: object) => string} o.label_of
	 * @param {(column: object, v: number) => string} o.value_text
	 * @param {(view: object) => Promise|null} o.release deletes the chart's view
	 */
	constructor({ root, rtl, types, title, read, label_of, value_text, release }) {
		this.root = root;
		this.rtl = rtl;
		this.types = TYPES.filter((t) => types.includes(t));
		this.type = this.types[0] || "bar";
		this.label_of = label_of;
		this.value_text = value_text;
		this.release = release;
		this.view = null;
		this.chart = null;
		this.drawer = new Drawer({ root, title: __("Chart from range"), subtitle: title, container: "dialog", width: "medium", cls: "rv-rchart", on_close: () => this.close() });
		this.drawer.state(__("Loading…"));
		this.on_resize = () => this.chart?.resize();
		window.addEventListener("resize", this.on_resize);
		this.ready = this.load(read).catch((e) => {
			if (this.drawer.is_open) this.drawer.state(__("The chart could not be drawn"), e?.message || "", "err");
		});
	}

	async load(read) {
		const data = await read();
		if (!data) {
			this.drawer.state(__("The table changed: select the range again"));
			return;
		}
		this.view = data.view;
		if (this.closed) {
			await this.free();
			return;
		}
		this.data = range_series(data, this.label_of);
		if (!this.data.series.length || !this.data.labels.length) {
			this.drawer.state(__("Select numeric cells to chart them"));
			return;
		}
		const body = this.drawer.body;
		body.innerHTML = `
			<div class="rv-rc-types" role="radiogroup" aria-label="${esc(__("Chart type"))}">${this.types
				.map((t) => `<button type="button" class="rv-rc-type" role="radio" data-type="${t}" aria-label="${esc(TYPE_LABELS[t]())}" title="${esc(TYPE_LABELS[t]())}">${TYPE_ICONS[t]}</button>`)
				.join("")}</div>
			<div class="rv-rc-plot" dir="ltr"></div>
			<div class="rv-rc-legend"></div>
			${this.data.truncated ? `<div class="rv-rc-note">${esc(__("The first {0} rows of the range are drawn", [this.data.labels.length]))}</div>` : ""}`;
		body.querySelector(".rv-rc-types").addEventListener("click", (e) => {
			const b = e.target.closest?.("[data-type]");
			if (b) this.set_type(b.dataset.type);
		});
		this.draw();
	}

	set_type(type) {
		if (!this.types.includes(type) || type === this.type) return;
		this.type = type;
		this.draw();
	}

	theme() {
		const css = getComputedStyle(this.root);
		const v = (name) => css.getPropertyValue(name).trim();
		return {
			palette: PALETTE.map(v),
			text: v("--tx"),
			text_2: v("--tx-2"),
			text_3: v("--tx-3"),
			line: v("--line"),
			line_2: v("--line-2"),
			line_3: v("--line-3"),
			surface: v("--surface"),
			hover: v("--hover"),
			shadow: v("--sh-pop"),
			radius: v("--r"),
			font: css.fontFamily,
			font_size: parseFloat(v("--fs-chart")) || parseFloat(v("--fs-xs")) || 11,
		};
	}

	axis_text(value) {
		if (value === 0) return "0";
		const shorten = frappe.utils.shorten_number;
		if (typeof shorten === "function") return shorten.call(frappe.utils, value, frappe.sys_defaults?.country, 3);
		return frappe.utils.html2text(String(frappe.format(value, { fieldtype: "Float", precision: 0 }, { inline: true }))).trim();
	}

	draw() {
		const body = this.drawer.body;
		const plot = body.querySelector(".rv-rc-plot");
		if (!plot) return;
		for (const b of body.querySelectorAll(".rv-rc-type")) b.setAttribute("aria-checked", String(b.dataset.type === this.type));
		const theme = this.theme();
		const { labels } = this.data;
		const donut = this.type === "donut";
		const all = donut ? this.data.series.slice(0, 1) : this.data.series;
		const series = all.map((s, i) => ({ key: s.key, name: s.title, color: theme.palette[i % theme.palette.length], values: s.values }));
		const horizontal = this.type === "hbar" || this.type === "hstacked";
		plot.style.height = horizontal ? `${Math.max(260, labels.length * 28 + 36)}px` : "";
		if (!this.chart) this.chart = echarts.init(plot, null, { renderer: "svg" });
		else this.chart.resize();
		const by_key = new Map(all.map((s) => [s.key, s]));
		const width = plot.clientWidth;
		this.chart.setOption(
			chart_option({
				type: this.type,
				rtl: this.rtl,
				labels,
				series,
				palette: theme.palette,
				theme,
				axis_text: (v) => this.axis_text(v),
				value_text: (key, index) => {
					const s = by_key.get(key);
					return this.value_text(s.column, s.values[index]);
				},
				esc,
				width,
				label_width: Math.max(90, Math.min(200, Math.round(width * 0.36))),
				animate: true,
				selected: null,
			}),
			{ notMerge: true }
		);
		const legend = body.querySelector(".rv-rc-legend");
		const items = donut
			? labels.map((l, i) => ({ name: l, color: theme.palette[i % theme.palette.length] }))
			: series.map((s) => ({ name: s.name, color: s.color }));
		legend.innerHTML = items
			.slice(0, 24)
			.map((it) => `<span class="rv-rc-key"><i style="background:${esc(it.color)}"></i>${esc(it.name)}</span>`)
			.join("");
	}

	async free() {
		const view = this.view;
		this.view = null;
		if (view && this.release) await this.release(view);
	}

	/** The dialog closed: ECharts is disposed and the chart's view deleted. */
	close() {
		if (this.closed) return;
		this.closed = true;
		window.removeEventListener("resize", this.on_resize);
		if (this.drawer.is_open) this.drawer.close();
		if (this.chart) this.chart.dispose();
		this.chart = null;
		return this.free();
	}
}
