// Charts view (docs/architecture.md §11.1 #69-73, phase 5d task 1; design:
// reference/design/screens/charts.png and the chart-type panel of the integrated chart).
// ECharts draws what one dedicated Perspective view returns (ReportSession.open_chart): the
// chosen measures aggregated by the chosen dimension, under the page's filters. Nothing is
// computed here. The view is deleted, and the ECharts instance disposed, whenever the chart
// is replaced or closed (mode switch, new result, leaving the page).
// Loaded on demand in report_view_charts.bundle.js.

import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";

import {
	CHART_TYPES,
	MAX_SERIES,
	chart_dimensions,
	chart_measures,
	resolve_chart,
} from "../engine/chart_config.js";
import { chart_option } from "./chart_option.js";

echarts.use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, SVGRenderer]);

const PALETTE = ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6", "--c7"];
const HBAR_ROW = 30;

function esc(s) {
	return frappe.utils.escape_html(String(s ?? ""));
}

// Chart type pictures of the design (Main.dc.html, integrated chart), plus a line.
const TYPE_ICONS = {
	bar: '<svg width="30" height="22" viewBox="0 0 30 22" fill="currentColor" aria-hidden="true"><rect x="3" y="8" width="4" height="13" rx="1"></rect><rect x="8" y="3" width="4" height="18" rx="1" opacity=".5"></rect><rect x="16" y="11" width="4" height="10" rx="1"></rect><rect x="21" y="6" width="4" height="15" rx="1" opacity=".5"></rect></svg>',
	stacked:
		'<svg width="30" height="22" viewBox="0 0 30 22" fill="currentColor" aria-hidden="true"><rect x="4" y="10" width="6" height="11" rx="1"></rect><rect x="4" y="3" width="6" height="6" rx="1" opacity=".5"></rect><rect x="12" y="13" width="6" height="8" rx="1"></rect><rect x="12" y="7" width="6" height="5" rx="1" opacity=".5"></rect><rect x="20" y="9" width="6" height="12" rx="1"></rect><rect x="20" y="4" width="6" height="4" rx="1" opacity=".5"></rect></svg>',
	hbar: '<svg width="30" height="22" viewBox="0 0 30 22" fill="currentColor" aria-hidden="true"><rect x="10" y="2" width="18" height="4" rx="1"></rect><rect x="16" y="7" width="12" height="4" rx="1" opacity=".5"></rect><rect x="6" y="12" width="22" height="4" rx="1"></rect><rect x="13" y="17" width="15" height="4" rx="1" opacity=".5"></rect></svg>',
	line: '<svg width="30" height="22" viewBox="0 0 30 22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17l7-7 5 4 12-10"></path></svg>',
	donut: '<svg width="30" height="22" viewBox="0 0 30 22" fill="none" stroke="currentColor" stroke-width="4" aria-hidden="true"><circle cx="15" cy="11" r="7.5"></circle></svg>',
};

const TYPE_LABELS = {
	bar: () => __("Grouped columns"),
	stacked: () => __("Stacked columns"),
	hbar: () => __("Horizontal bars"),
	line: () => __("Line"),
	donut: () => __("Donut"),
};

export class ChartsView {
	/**
	 * @param {object} opts
	 * @param {HTMLElement} opts.parent where the view goes (it replaces this element)
	 * @param {HTMLElement} opts.root the .rv element: colours and sizes are its CSS tokens
	 * @param {boolean} opts.rtl
	 * @param {(chart: {type, x, series}) => void} opts.on_change the user changed the chart
	 */
	constructor({ parent, root, rtl, on_change }) {
		this.root = root;
		this.rtl = rtl;
		this.on_change = on_change;
		this.token = 0;
		this.opened = null;
		this.chart = null;
		this.ctx = null;
		const el = document.createElement("div");
		el.className = "rv-charts rv-chartsv";
		el.innerHTML = `
			<section class="rv-card rv-chart-card">
				<div class="rv-card-hd">
					<div class="rv-chart-titles"><h3></h3><p></p></div>
					<div class="rv-legend"></div>
				</div>
				<div class="rv-chart-note" hidden></div>
				<div class="rv-chart-body">
					<div class="rv-chart-plotwrap">
						<div class="rv-chart-plot" dir="ltr"></div>
						<div class="rv-chart-center" hidden><span></span><b></b></div>
					</div>
					<ul class="rv-dlegend rv-chart-dlegend" hidden></ul>
				</div>
				<div class="rv-chart-state" hidden>
					<div class="rv-state">
						<div class="rv-state-ico">${TYPE_ICONS.bar}</div>
						<h3></h3>
						<p></p>
					</div>
				</div>
			</section>
			<aside class="rv-card rv-chart-side" aria-label="${esc(__("Chart settings"))}">
				<div class="rv-chart-sec">
					<div class="rv-zone-hd">${esc(__("Chart type"))}</div>
					<div class="rv-chart-types" role="radiogroup" aria-label="${esc(__("Chart type"))}">
						${CHART_TYPES.map(
							(t) =>
								`<button type="button" class="rv-ctype" role="radio" data-type="${t}" aria-checked="false">${TYPE_ICONS[t]}<span>${esc(TYPE_LABELS[t]())}</span></button>`
						).join("")}
					</div>
				</div>
				<div class="rv-chart-sec">
					<label class="rv-zone-hd" for="rv-chart-x">${esc(__("Dimension"))}</label>
					<select class="rv-chart-select" id="rv-chart-x"></select>
				</div>
				<div class="rv-chart-sec">
					<div class="rv-zone-hd">${esc(__("Measures"))}</div>
					<div class="rv-chart-measures"></div>
				</div>
				<div class="rv-zone-empty rv-chart-foot"></div>
			</aside>`;
		parent.replaceWith(el);
		this.el = el;
		this.q = (sel) => el.querySelector(sel);
		this.plot = this.q(".rv-chart-plot");

		for (const btn of el.querySelectorAll(".rv-ctype")) {
			btn.addEventListener("click", () => this.change({ type: btn.dataset.type }));
		}
		this.q(".rv-chart-select").addEventListener("change", (e) => this.change({ x: e.target.value }));
		this.q(".rv-chart-measures").addEventListener("change", (e) => {
			const input = e.target.closest("input[data-key]");
			if (!input || !this.current) return;
			const on = new Set(this.current.series);
			if (input.checked) on.add(input.dataset.key);
			else on.delete(input.dataset.key);
			// Report order keeps the colour of a measure where it was.
			const series = this.measures.filter((k) => on.has(k)).slice(0, MAX_SERIES);
			if (series.length) this.change({ series });
		});

		// The size of the card, the theme and the density of the page: drawn again, in place.
		this.resize_observer = new ResizeObserver(() => this.schedule_draw());
		this.resize_observer.observe(this.plot);
		this.theme_observer = new MutationObserver(() => this.schedule_draw());
		this.theme_observer.observe(root, { attributes: true, attributeFilter: ["class"] });
	}

	change(patch) {
		if (!this.current) return;
		const next = { ...this.current, ...patch };
		if (next.type === this.current.type && next.x === this.current.x && next.series.join() === this.current.series.join()) return;
		this.on_change(next);
	}

	/**
	 * Shows the chart of the view state of the page.
	 * @param {object} ctx {session, report, state, config, controls}
	 */
	async show(ctx) {
		this.ctx = ctx;
		await this.refresh();
	}

	/** Reads the chart again (the chart of the view state changed). */
	async refresh() {
		const ctx = this.ctx;
		if (!ctx) return;
		const token = ++this.token;
		const { session, report, state, config, controls } = ctx;
		const label_key = controls.label_key();
		const chart = resolve_chart(state, report, config, label_key);
		this.current = chart;
		this.measures = chart_measures(report, state);
		this.render_controls(chart, report);
		if (!chart.x || !chart.series.length) {
			await this.release();
			this.show_state("none", __("Nothing to chart"), __("This report has no numeric column the engine can add up."));
			return;
		}
		if (!this.opened) this.show_state("loading", __("Preparing the charts…"), __("Charts are built from the same rows, once they arrive."));
		let opened;
		try {
			opened = await session.open_chart(state, chart);
		} catch (e) {
			// The result was replaced (its tables deleted) while the chart view was opening.
			if (token !== this.token || session !== this.ctx?.session || session.closed) return;
			throw e;
		}
		if (!opened) return;
		if (token !== this.token || this.ctx !== ctx) {
			await session.close_chart(opened);
			return;
		}
		const previous = this.opened;
		this.opened = { ...opened, session, chart, report, controls, config };
		if (previous) await previous.session.close_chart(previous);
		if (this.opened?.view !== opened.view) return;
		this.draw(true);
	}

	// ------------------------------------------------------------ controls

	render_controls(chart, report) {
		const { controls } = this.ctx;
		for (const btn of this.el.querySelectorAll(".rv-ctype")) {
			const on = btn.dataset.type === chart.type;
			btn.classList.toggle("on", on);
			btn.setAttribute("aria-checked", on ? "true" : "false");
		}
		const select = this.q(".rv-chart-select");
		select.innerHTML = chart_dimensions(report)
			.map((d) => `<option value="${esc(d.key)}"${d.key === chart.x ? " selected" : ""}>${esc(this.dimension_title(d.key))}</option>`)
			.join("");
		const full = chart.series.length >= MAX_SERIES;
		this.q(".rv-chart-measures").innerHTML = this.measures
			.map((key) => {
				const at = chart.series.indexOf(key);
				const on = at >= 0;
				// The last measure shown stays; no more than one colour token per measure.
				const locked = (on && chart.series.length === 1) || (!on && full);
				const sw = on ? `rv-sw rv-sw-${(chart.type === "donut" ? 0 : at) + 1}${chart.type === "donut" && at > 0 ? " off" : ""}` : "rv-sw off";
				return `<label class="rv-setitem"><span class="rv-check"><input type="checkbox" data-key="${esc(key)}"${on ? " checked" : ""}${
					locked ? " disabled" : ""
				}><i class="${sw}"></i><span>${esc(controls.full_title(key))}</span></span></label>`;
			})
			.join("");
	}

	dimension_title(key) {
		const d = chart_dimensions(this.ctx.report).find((x) => x.key === key);
		if (d?.level) return d.level === 1 ? __("Top-level groups") : __("Level {0}", [d.level]);
		return this.ctx.controls.title(key);
	}

	// ------------------------------------------------------------ states

	show_state(kind, title, text) {
		this.dispose_chart();
		this.el.dataset.state = kind;
		this.q(".rv-chart-state").hidden = false;
		this.q(".rv-chart-body").hidden = true;
		this.q(".rv-chart-note").hidden = true;
		this.q(".rv-legend").innerHTML = "";
		this.q(".rv-chart-state h3").textContent = title;
		this.q(".rv-chart-state p").textContent = text;
		this.q(".rv-chart-titles h3").textContent = this.current?.x ? __("By {0}", [this.dimension_title(this.current.x)]) : "";
		this.q(".rv-chart-titles p").textContent = "";
		this.q(".rv-chart-foot").textContent = "";
	}

	// ------------------------------------------------------------ drawing

	/** Colours and sizes of the page, read from its CSS tokens (they change with the theme). */
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
			font_size: parseFloat(v("--fs-xs")) || 11.5,
		};
	}

	schedule_draw() {
		if (!this.chart || this._draw_frame) return;
		this._draw_frame = requestAnimationFrame(() => {
			this._draw_frame = null;
			if (this.chart && this.opened) this.draw(false);
		});
	}

	/** Text of a category: the node's name for a level of the report tree, else the value formatted. */
	category_texts(opened) {
		const { spec, data, report, config, controls } = opened;
		const post = spec.post;
		const parts = config.tree || {};
		const tree_label = report.tree?.enabled ? report.tree.label_key : null;
		if (post.level !== null || (tree_label && post.x === tree_label)) {
			const by_rid = new Map(report.rows.map((r) => [r.__rid, r]));
			const by_label = new Map();
			if (tree_label) for (const r of report.rows) if (r[tree_label] !== null && r[tree_label] !== undefined) by_label.set(String(r[tree_label]), r);
			return data.categories.map((value, i) => {
				const row = (post.route === "nodes" && data.rids ? by_rid.get(data.rids[i]) : null) || by_label.get(String(value));
				const name = row && parts.name_key ? row[parts.name_key] : null;
				if (name) return String(name);
				return value === null || value === undefined || value === "" ? __("Not Set") : String(value);
			});
		}
		return data.categories.map((value) => controls.value_text(post.x, value) || __("Not Set"));
	}

	value_text(key, index) {
		const { data, controls } = this.opened;
		const value = data.series[key]?.[index];
		if (data.mixed[key]?.[index]) return __("Mixed currencies: no total");
		return this.format(controls.column(key), value, data.currencies[key]?.[index]);
	}

	format(column, value, currency) {
		if (value === null || value === undefined) return "—";
		if (!column) return String(value);
		const ck = column.currency?.kind === "row" ? column.currency.key : null;
		const row = ck ? { [ck]: currency || null } : {};
		const df = { ...column.original, fieldtype: column.fieldtype };
		return frappe.utils.html2text(String(frappe.format(value, df, { inline: true, always_show_decimals: true }, row))).trim();
	}

	axis_text(value) {
		if (value === 0) return "0";
		const shorten = frappe.utils.shorten_number;
		if (typeof shorten === "function") return shorten.call(frappe.utils, value, frappe.sys_defaults?.country, 3);
		return frappe.utils.html2text(String(frappe.format(value, { fieldtype: "Float", precision: 0 }, { inline: true }))).trim();
	}

	draw(animate) {
		const opened = this.opened;
		if (!opened) return;
		const { chart, data, spec, controls } = opened;
		const post = spec.post;
		const n = data.categories.length;
		this.el.dataset.type = chart.type;
		if (!n) {
			this.show_state("empty", __("No data to chart"), __("The current filters left no rows. Remove some of them from the search box."));
			return;
		}
		this.el.dataset.state = "ready";
		this.q(".rv-chart-state").hidden = true;
		this.q(".rv-chart-body").hidden = false;

		const theme = this.theme();
		const labels = this.category_texts(opened);
		const donut = chart.type === "donut";
		const keys = donut ? post.series.slice(0, 1) : post.series;
		const series = keys.map((key, i) => ({
			key,
			name: controls.full_title(key),
			color: theme.palette[i % theme.palette.length],
			values: data.series[key],
		}));

		// Header: what is drawn, and how many categories (largest first when not all fit).
		this.q(".rv-chart-titles h3").textContent = __("By {0}", [this.dimension_title(post.x)]);
		const what =
			post.route === "nodes"
				? __("The report's own values of each group at this level")
				: __("Values added up by the engine for each category");
		this.q(".rv-chart-titles p").textContent = `${what} · ${__("{0} categories", [frappe.format(post.categories, { fieldtype: "Int" }, { inline: true })])}`;
		this.q(".rv-legend").innerHTML = donut
			? `<span><i class="rv-sw rv-sw-1"></i>${esc(series[0].name)}</span>`
			: series.map((s, i) => `<span><i class="rv-sw rv-sw-${i + 1}"></i>${esc(s.name)}</span>`).join("");
		const notes = [];
		if (post.top) {
			notes.push(
				__("Showing the {0} largest of {1} categories by {2}.", [n, post.categories, controls.full_title(post.series[0])])
			);
		}
		if (donut && post.series.length > 1) notes.push(__("A donut shows the first measure only."));
		if (keys.some((k) => data.mixed[k]?.some(Boolean))) notes.push(__("Categories that mix currencies have no total and are not drawn."));
		const note = this.q(".rv-chart-note");
		note.hidden = !notes.length;
		note.textContent = notes.join(" ");
		this.q(".rv-chart-foot").textContent = __("{0} of {1} categories shown.", [n, post.categories]);

		// Donut: the categories as a list next to it, and the total the engine computed.
		const dlegend = this.q(".rv-chart-dlegend");
		const center = this.q(".rv-chart-center");
		dlegend.hidden = !donut;
		center.hidden = !donut;
		if (donut) {
			const key = series[0].key;
			dlegend.innerHTML = labels
				.map(
					(label, i) =>
						`<li><i class="rv-sw rv-sw-${(i % PALETTE.length) + 1}"></i><span class="nm" title="${esc(label)}">${esc(label)}</span><bdi class="v">${esc(
							this.value_text(key, i)
						)}</bdi></li>`
				)
				.join("");
			const total = data.total?.[key];
			const has_total = total && total.value !== null && !post.top;
			center.querySelector("span").textContent = has_total ? __("Total") : series[0].name;
			center.querySelector("b").textContent = has_total ? this.axis_text(total.value) : "";
			center.title = has_total ? this.format(controls.column(key), total.value, total.currency) : "";
		} else {
			dlegend.innerHTML = "";
		}

		// Horizontal bars take the room of their rows; the other types the height of the CSS.
		this.plot.style.height = chart.type === "hbar" ? `${Math.max(260, n * HBAR_ROW + 40)}px` : "";
		this.el.classList.toggle("is-donut", donut);
		if (!this.chart) this.chart = echarts.init(this.plot, null, { renderer: "svg" });
		else this.chart.resize();
		const option = chart_option({
			type: chart.type,
			rtl: this.rtl,
			labels,
			series,
			palette: theme.palette,
			theme,
			axis_text: (v) => this.axis_text(v),
			value_text: (key, i) => this.value_text(key, i),
			esc,
			width: this.plot.clientWidth,
			animate,
		});
		this.chart.setOption(option, { notMerge: true });
	}

	// ------------------------------------------------------------ lifecycle

	dispose_chart() {
		if (this._draw_frame) cancelAnimationFrame(this._draw_frame);
		this._draw_frame = null;
		if (this.chart) this.chart.dispose();
		this.chart = null;
	}

	/** Deletes the chart's view (kept on screen until then). */
	async release() {
		const opened = this.opened;
		this.opened = null;
		if (opened) await opened.session.close_chart(opened);
	}

	/** Leaves the Charts view: the ECharts instance is disposed and the view deleted. */
	async close() {
		this.token += 1;
		this.ctx = null;
		this.dispose_chart();
		await this.release();
	}

	// Raw data of the chart shown, for the tests: {type, x, series, categories, values}.
	debug_data() {
		const o = this.opened;
		if (!o) return null;
		return {
			type: o.chart.type,
			x: o.chart.x,
			route: o.spec.post.route,
			series: o.spec.post.series,
			categories: o.data.categories,
			rids: o.data.rids,
			values: o.data.series,
			total: o.data.total,
			labels: this.category_texts(o),
			drawn: Boolean(this.chart),
		};
	}
}
