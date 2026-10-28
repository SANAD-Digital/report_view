// One card of the charts dashboard (views/charts_view.js): its chart drawn by ECharts from
// its own Perspective view (ReportSession.read_card, deleted once read), its menu and editor,
// read only when on screen and again only when what it shows changed.
// Loaded with the charts bundle (report_view_charts.bundle.js).

import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";

import { chart_config, dashboard_state, popover, icons_module } from "./charts_shared.js";
import { chart_option } from "./chart_option.js";
import { esc, fmt_int } from "../util.js";

const { MAX_SERIES, chart_dimensions, chart_measures, dashboard_terms, card_sort, date_text } = chart_config;
const { CARD_TYPES, CARD_TOPS, CARD_AGGS, LIMIT_CARDS } = dashboard_state;
const { open_popover, close_popover, menu_content } = popover;
const { icons } = icons_module;

echarts.use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, SVGRenderer]);

export const PALETTE = ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6", "--c7"];
const HBAR_ROW = 28;

const svg = (body, attrs = 'fill="currentColor"') => `<svg width="30" height="22" viewBox="0 0 30 22" ${attrs} aria-hidden="true">${body}</svg>`;
// Chart type pictures (Main.dc.html, integrated chart), plus line, area and number.
export const TYPE_ICONS = {
	bar: svg('<rect x="3" y="8" width="4" height="13" rx="1"></rect><rect x="8" y="3" width="4" height="18" rx="1" opacity=".5"></rect><rect x="16" y="11" width="4" height="10" rx="1"></rect><rect x="21" y="6" width="4" height="15" rx="1" opacity=".5"></rect>'),
	stacked: svg('<rect x="4" y="10" width="6" height="11" rx="1"></rect><rect x="4" y="3" width="6" height="6" rx="1" opacity=".5"></rect><rect x="12" y="13" width="6" height="8" rx="1"></rect><rect x="12" y="7" width="6" height="5" rx="1" opacity=".5"></rect><rect x="20" y="9" width="6" height="12" rx="1"></rect><rect x="20" y="4" width="6" height="4" rx="1" opacity=".5"></rect>'),
	hbar: svg('<rect x="10" y="2" width="18" height="4" rx="1"></rect><rect x="16" y="7" width="12" height="4" rx="1" opacity=".5"></rect><rect x="6" y="12" width="22" height="4" rx="1"></rect><rect x="13" y="17" width="15" height="4" rx="1" opacity=".5"></rect>'),
	hstacked: svg('<rect x="14" y="2" width="14" height="5" rx="1"></rect><rect x="4" y="2" width="9" height="5" rx="1" opacity=".5"></rect><rect x="18" y="9" width="10" height="5" rx="1"></rect><rect x="10" y="9" width="7" height="5" rx="1" opacity=".5"></rect><rect x="20" y="16" width="8" height="5" rx="1"></rect><rect x="15" y="16" width="4" height="5" rx="1" opacity=".5"></rect>'),
	line: svg('<path d="M3 17l7-7 5 4 12-10"></path>', 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"'),
	area: svg('<path d="M3 19V15l7-6 5 4 12-9v15z" opacity=".35"></path><path d="M3 15l7-6 5 4 12-9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>'),
	donut: svg('<circle cx="15" cy="11" r="7.5"></circle>', 'fill="none" stroke="currentColor" stroke-width="4"'),
	kpi: svg('<rect x="2" y="3" width="26" height="16" rx="3" opacity=".25"></rect><path d="M7 14V8l-2 1.5M11 8h4l-3 6M18 8h4v3h-4v3h4"></path>', 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"'),
};

export const TYPE_LABELS = {
	bar: () => __("Grouped columns"),
	stacked: () => __("Stacked columns"),
	hbar: () => __("Horizontal bars"),
	hstacked: () => __("Stacked bars"),
	line: () => __("Line"),
	area: () => __("Area", null, "Report View"),
	donut: () => __("Donut"),
	kpi: () => __("Number card"),
};
const AGG_LABELS = {
	sum: () => __("Sum"),
	avg: () => __("Average"),
	count: () => __("Count"),
	min: () => __("Minimum"),
	max: () => __("Maximum"),
};
const SORT_LABELS = {
	desc: () => __("Largest first"),
	asc: () => __("Smallest first"),
	label: () => __("By category"),
};
export const MORE_ICON =
	'<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"></circle><circle cx="12" cy="12" r="1.8"></circle><circle cx="19" cy="12" r="1.8"></circle></svg>';

// Stable text of what a card reads: the card, the filters it gets, the page's filters and the
// result it reads from. Equal texts read the same numbers.
let session_ids = new WeakMap();
let session_seq = 0;
function session_id(session) {
	if (!session_ids.has(session)) session_ids.set(session, ++session_seq);
	return session_ids.get(session);
}

/** A closed dashboard forgets its sessions: a new one reads its cards again. */
export function forget_sessions() {
	session_ids = new WeakMap();
}

export class ChartCard {
	constructor(view, id) {
		this.view = view;
		this.id = id;
		this.def = null;
		this.sig = null;
		this.loaded_sig = null;
		this.data = null;
		this.spec = null;
		this.chart = null;
		this.token = 0;
		this.visible = false;
		const el = document.createElement("section");
		el.className = "rv-card rv-dcard";
		el.dataset.card = id;
		el.dataset.state = "loading";
		el.innerHTML = `
			<div class="rv-card-hd">
				<div class="rv-chart-titles"><h3></h3><p></p></div>
				<div class="rv-dcard-tools">
					<div class="rv-legend"></div>
					<button type="button" class="rv-btn sm icon ghost rv-dcard-menu" aria-haspopup="menu" aria-label="${esc(__("Chart options"))}" title="${esc(
						__("Chart options")
					)}">${MORE_ICON}</button>
				</div>
			</div>
			<div class="rv-chart-note" hidden></div>
			<div class="rv-chart-body" hidden>
				<div class="rv-chart-plotwrap">
					<div class="rv-chart-plot" dir="ltr"></div>
					<div class="rv-chart-center" hidden><span></span><b></b></div>
				</div>
				<ul class="rv-dlegend rv-chart-dlegend" hidden></ul>
			</div>
			<div class="rv-kpis" hidden></div>
			<div class="rv-chart-state">
				<div class="rv-state">
					<div class="rv-skel rv-dcard-skel"></div>
				</div>
			</div>`;
		this.el = el;
		this.q = (sel) => el.querySelector(sel);
		this.plot = this.q(".rv-chart-plot");
		this.q(".rv-dcard-menu").addEventListener("click", (e) => this.open_menu(e.currentTarget));
		this.resize_observer = new ResizeObserver(() => this.schedule_draw());
		this.resize_observer.observe(this.plot);
	}

	/** The card's definition and the page it belongs to; read again only if what it shows changed. */
	set(def, ctx) {
		this.def = def;
		this.ctx = ctx;
		this.el.classList.toggle("wide", def.size === "full");
		this.el.dataset.type = def.type;
		const dash = this.view.dash;
		const { state } = ctx;
		this.sig = JSON.stringify([
			session_id(ctx.session),
			def.type,
			def.x,
			def.series,
			def.agg,
			def.sort,
			def.top,
			dashboard_terms(dash, def, ctx.report),
			state.filters,
			state.quick_filters,
			state.values,
		]);
		this.render_head();
		if (this.sig !== this.loaded_sig) {
			if (this.visible) this.load();
			else this.forget_read();
		} else {
			// Same numbers: the cross-filter highlight or the title may have changed.
			this.schedule_draw();
		}
	}

	// A read in flight stands for what the card showed before: it is dropped, so that the
	// card reads again when it comes on screen, even when it then asks for that very view
	// again (a slicer added and removed while the card was off screen).
	forget_read() {
		if (!this.loading_sig) return;
		this.token += 1;
		this.loading_sig = null;
		this.el.removeAttribute("aria-busy");
	}

	load_if_stale() {
		if (this.def && this.sig !== this.loaded_sig && this.sig !== this.loading_sig) this.load();
	}

	async load() {
		const ctx = this.ctx;
		const def = this.def;
		const sig = this.sig;
		const token = ++this.token;
		this.loading_sig = sig;
		if (!def.series.length) {
			this.show_state("none", __("Nothing to chart"), __("This report has no numeric column the engine can add up."));
			this.loaded_sig = sig;
			return;
		}
		if (!this.data) this.el.dataset.state = "loading";
		this.el.setAttribute("aria-busy", "true");
		let out;
		try {
			out = await ctx.session.read_card(ctx.state, def, this.view.dash);
		} catch (e) {
			if (token !== this.token) return;
			this.loading_sig = null;
			// The result was replaced (its tables deleted) while the card was being read.
			if (ctx.session.closed || this.view.ctx?.session !== ctx.session) return;
			this.show_state("error", __("This chart could not be drawn"), e?.message || "");
			return;
		} finally {
			if (token === this.token) this.el.removeAttribute("aria-busy");
		}
		if (token !== this.token) return;
		this.loading_sig = null;
		if (this.view.ctx !== ctx) return;
		this.loaded_sig = sig;
		this.spec = out.spec;
		this.data = out.data;
		this.drawn_def = def;
		this.draw(true);
	}

	// ------------------------------------------------------------ head

	measure_title(key) {
		return this.ctx.controls.full_title(key);
	}

	/** The title a card has when the user gave none: what it shows by what. */
	auto_title(html = false) {
		const { def, view } = this;
		// Names of columns in another language than the page keep their own direction.
		const part = (t) => (html ? `<bdi>${esc(t)}</bdi>` : t);
		const { controls } = this.ctx;
		const series = def.series;
		let what = "";
		if (series.length === 1) what = controls.full_title(series[0]);
		else if (series.length > 1) {
			// Measures of one band (Closing Balance · Debit / Credit): the band's name.
			const bands = series.map((k) => controls.full_title(k).split(" · "));
			const band = bands[0].length > 1 && bands.every((b) => b.length > 1 && b[0] === bands[0][0]) ? bands[0][0] : null;
			what = band || series.map((k) => controls.title(k)).join(" · ");
		}
		if (def.type === "kpi") return what ? part(what) : html ? esc(__("Totals")) : __("Totals");
		if (def.x === null) return part(what);
		const text = __("{0} by {1}", ["\u0000", "\u0001"]);
		const [a, rest] = text.split("\u0000");
		const [b, c] = (rest ?? "").split("\u0001");
		const out = html ? (x) => esc(x) : (x) => x;
		return `${out(a)}${part(what)}${out(b ?? "")}${part(view.dimension_title(def.x))}${out(c ?? "")}`;
	}

	subtitle() {
		const { def, spec, view } = this;
		const parts = [];
		if (def.agg) parts.push(AGG_LABELS[def.agg]());
		for (const f of def.filter || []) {
			parts.push(`${view.dimension_title(f.key)}: ${(f.values || []).map((v) => view.value_text(f.key, v)).join(", ")}`);
		}
		if (def.type !== "kpi" && def.x !== null) {
			const post = spec?.post;
			const sort = card_sort(def);
			if (sort !== "label") parts.push(SORT_LABELS[sort]());
			if (post?.categories !== null && post?.categories !== undefined) {
				const n = fmt_int;
				parts.push(
					post.top ? __("Showing {0} of {1}", [n(this.data?.categories.length ?? post.limit), n(post.categories)]) : __("{0} categories", [n(post.categories)])
				);
			}
		} else if (def.type !== "kpi") {
			parts.push(__("Totals of the measures"));
		}
		return parts.join(" · ");
	}

	render_head() {
		const def = this.def;
		const h3 = this.q(".rv-chart-titles h3");
		if (def.title) h3.textContent = def.title;
		else h3.innerHTML = this.auto_title(true);
		this.q(".rv-chart-titles p").textContent = this.subtitle();
	}

	// ------------------------------------------------------------ states

	show_state(kind, title, text) {
		this.dispose_chart();
		this.el.dataset.state = kind;
		this.q(".rv-chart-body").hidden = true;
		this.q(".rv-kpis").hidden = true;
		this.q(".rv-chart-note").hidden = true;
		this.q(".rv-legend").innerHTML = "";
		const box = this.q(".rv-chart-state");
		box.hidden = false;
		box.innerHTML = `<div class="rv-state"><div class="rv-state-ico${kind === "error" ? " err" : ""}">${TYPE_ICONS[this.def?.type] || TYPE_ICONS.bar}</div><h3>${esc(
			title
		)}</h3><p>${esc(text)}</p></div>`;
	}

	schedule_draw() {
		if (!this.data || this._frame) return;
		this._frame = requestAnimationFrame(() => {
			this._frame = null;
			if (this.data && this.view.ctx) this.draw(false);
		});
	}

	/** Text of the categories: a tree node's name, else the value as the grid formats it. */
	category_texts() {
		const { spec, data, view } = this;
		const post = spec.post;
		if (post.route === "totals") return post.series.map((k) => this.measure_title(k));
		const report = this.ctx.report;
		const parts = this.ctx.config.tree || {};
		const tree_label = report.tree?.enabled ? report.tree.label_key : null;
		if (post.level !== null || (tree_label && post.x === tree_label)) {
			const by_rid = post.route === "nodes" ? new Map(report.rows.map((r) => [r.__rid, r])) : null;
			const with_number = post.x === tree_label && parts.number_key;
			return data.categories.map((value, i) => {
				const row = (by_rid && data.rids ? by_rid.get(data.rids[i]) : null) || null;
				if (value === null || value === undefined || value === "") return __("Not Set");
				const name = row && parts.name_key ? row[parts.name_key] : view.tree_name(value);
				if (with_number) {
					const number = (row || view._names?.map.get(String(value)))?.[parts.number_key];
					if (number && name && !String(name).startsWith(String(number))) return `${number} ${name}`;
				}
				return String(name || value);
			});
		}
		return data.categories.map((value) => view.value_text(post.x, value));
	}

	value_text(key, index) {
		const { data } = this;
		const value = data.series[key]?.[index];
		if (data.mixed[key]?.[index]) return __("Mixed currencies: no total");
		return this.view.format(this.ctx.controls.column(key), value, data.currencies[key]?.[index]);
	}

	total_text(key) {
		const t = this.data.total[key];
		if (!t) return "—";
		if (t.mixed) return __("Mixed currencies: no total");
		return this.view.format(this.ctx.controls.column(key), t.value, t.currency);
	}

	selected_index() {
		const cross = this.view.dash?.cross;
		if (!cross || cross.card !== this.id || !this.data || this.spec.post.route === "totals") return null;
		const want = cross.value;
		const at = this.data.categories.findIndex((v) => {
			if (v === null || v === undefined || v === "") return want === null;
			if (typeof v === "number" && typeof want === "string" && this.view.is_date(this.def.x)) return date_text(v) === want;
			return String(v) === String(want);
		});
		return at >= 0 ? at : null;
	}

	draw(animate) {
		const { data, spec, view } = this;
		if (!data || !spec) return;
		const post = spec.post;
		const def = this.drawn_def || this.def;
		const type = def.type;
		this.render_head();
		const theme = view.theme();
		const totals = post.route === "totals";

		if (type === "kpi") return this.draw_kpi(post);
		const labels = this.category_texts();
		const n = labels.length;
		if (!n) {
			this.show_state("empty", __("No data to chart"), __("The current filters left no rows. Remove some of them."));
			return;
		}
		this.el.dataset.state = "ready";
		this.q(".rv-chart-state").hidden = true;
		this.q(".rv-kpis").hidden = true;
		this.q(".rv-chart-body").hidden = false;

		const donut = type === "donut";
		// The measures side by side: one series of their totals, a category per measure.
		const series = totals
			? [{ key: "__totals__", name: this.auto_title(), color: theme.palette[0], values: post.series.map((k) => data.total[k]?.value ?? null) }]
			: (donut ? post.series.slice(0, 1) : post.series).map((key, i) => ({
					key,
					name: this.measure_title(key),
					color: theme.palette[i % theme.palette.length],
					values: data.series[key],
			  }));
		const value_text = totals ? (key, i) => this.total_text(post.series[i]) : (key, i) => this.value_text(key, i);

		this.q(".rv-legend").innerHTML =
			donut || totals ? "" : series.map((s, i) => `<span><i class="rv-sw rv-sw-${(i % PALETTE.length) + 1}"></i>${esc(s.name)}</span>`).join("");
		const notes = [];
		if (donut && post.series.length > 1) notes.push(__("A donut shows the first measure only."));
		if (!totals && series.some((s) => data.mixed[s.key]?.some(Boolean))) notes.push(__("Categories that mix currencies have no total and are not drawn."));
		const note = this.q(".rv-chart-note");
		note.hidden = !notes.length;
		note.textContent = notes.join(" ");

		// Donut: its categories with value and share (the engine's) as a list next to it, and
		// the total the engine computed in the middle.
		const dlegend = this.q(".rv-chart-dlegend");
		const center = this.q(".rv-chart-center");
		dlegend.hidden = !donut;
		center.hidden = !donut;
		this.el.classList.toggle("is-donut", donut);
		const selected = this.selected_index();
		if (donut) {
			const key = series[0].key;
			const pct = totals ? null : data.pct[key];
			dlegend.innerHTML = labels
				.map(
					(label, i) =>
						`<li class="${selected !== null && selected !== i ? "dim" : ""}"><i class="rv-sw rv-sw-${(i % PALETTE.length) + 1}"></i><span class="nm" title="${esc(label)}">${esc(
							label
						)}</span><bdi class="v">${esc(value_text(key, i))}</bdi>${pct ? `<bdi class="p">${esc(view.pct_text(pct[i]))}</bdi>` : ""}</li>`
				)
				.join("");
			const total = totals ? null : data.total[key];
			const has_total = total && total.value !== null;
			center.querySelector("span").textContent = has_total ? __("Total") : series[0].name;
			center.querySelector("b").textContent = has_total ? view.axis_text(total.value) : "";
			center.title = has_total ? this.total_text(key) : "";
		} else {
			dlegend.innerHTML = "";
		}

		// Horizontal bars take the room of their rows; the other types the height of the CSS.
		const horizontal = type === "hbar" || type === "hstacked";
		this.plot.style.height = horizontal ? `${Math.max(180, n * HBAR_ROW + 36)}px` : "";
		if (!this.chart) {
			this.chart = echarts.init(this.plot, null, { renderer: "svg" });
			this.chart.on("click", (params) => this.on_click(params));
		} else this.chart.resize();
		this.el.classList.toggle("can-cross", !totals);
		const width = this.plot.clientWidth;
		const option = chart_option({
			type,
			rtl: view.rtl,
			labels,
			series,
			palette: theme.palette,
			theme,
			axis_text: (v) => view.axis_text(v),
			value_text,
			esc,
			width,
			label_width: Math.max(90, Math.min(200, Math.round(width * 0.36))),
			animate,
			selected,
		});
		this.chart.setOption(option, { notMerge: true });
	}

	draw_kpi(post) {
		this.dispose_chart();
		this.el.dataset.state = "ready";
		this.q(".rv-chart-state").hidden = true;
		this.q(".rv-chart-body").hidden = true;
		this.q(".rv-chart-note").hidden = true;
		this.q(".rv-legend").innerHTML = "";
		const box = this.q(".rv-kpis");
		box.hidden = false;
		box.innerHTML = post.series
			.map((key, i) => {
				const t = this.data.total[key];
				const short = t && t.value !== null ? this.view.axis_text(t.value) : "—";
				return `<div class="rv-kpi"><span class="k"><i class="rv-sw rv-sw-${(i % PALETTE.length) + 1}"></i>${esc(this.measure_title(key))}</span><b class="v" title="${esc(
					this.total_text(key)
				)}">${esc(this.total_text(key))}</b><span class="s">${esc(short)}</span></div>`;
			})
			.join("");
	}

	on_click(params) {
		if (!this.data || this.spec?.post.route === "totals" || params?.componentType !== "series") return;
		const value = this.data.categories[params.dataIndex];
		if (value === undefined) return;
		this.view.cross_filter(this, value);
	}

	// ------------------------------------------------------------ menu and editor

	open_menu(anchor) {
		const def = this.def;
		const view = this.view;
		const full = def.size === "full";
		open_popover({
			root: view.root,
			anchor,
			role: "menu",
			width: 220,
			align: "end",
			label: __("Chart options"),
			content: menu_content([
				{ key: "edit", label: __("Edit chart"), icon: icons.columns(), act: () => this.open_editor(anchor) },
				{
					key: "duplicate",
					label: __("Duplicate", null, "Report View"),
					icon: icons.pivot(),
					disabled: view.dash.cards.length >= LIMIT_CARDS,
					act: () => (close_popover(), view.duplicate_card(def.id)),
				},
				{
					key: "size",
					label: full ? __("Half width") : __("Full width"),
					icon: icons.fit(),
					act: () => (close_popover(), view.update_card(def.id, { size: full ? "half" : "full" })),
				},
				{ sep: true },
				{ key: "remove", label: __("Remove chart"), icon: icons.close(), act: () => (close_popover(), view.remove_card(def.id)) },
			]),
		});
	}

	open_editor(anchor = null) {
		const view = this.view;
		const box = document.createElement("div");
		box.className = "rv-ced";
		const at = anchor || this.q(".rv-dcard-menu");
		const handle = open_popover({ root: view.root, anchor: at, content: box, cls: "rv-ced-pop", width: 340, align: "end", label: __("Edit chart") });
		const render = () => {
			if (handle.closed) return;
			const def = view.dash?.cards.find((c) => c.id === this.id);
			if (!def) return handle.close();
			// a change drawn while the title is being typed keeps what was typed, and the caret
			const typing = box.querySelector(".rv-ced-title");
			const kept = typing && document.activeElement === typing ? { value: typing.value, start: typing.selectionStart, end: typing.selectionEnd } : null;
			this.render_editor(box, def);
			const title = kept && box.querySelector(".rv-ced-title");
			if (title) {
				title.value = kept.value;
				title.focus();
				title.setSelectionRange(kept.start, kept.end);
			}
			handle.place();
		};
		this.editor = { handle, render };
		render();
		box.querySelector(".rv-ced-title")?.focus();
	}

	render_editor(box, def) {
		const view = this.view;
		const { report, state, controls } = this.ctx;
		const dims = chart_dimensions(report);
		const measures = chart_measures(report, state);
		// The editor shows the new dashboard once the page applied it (ChartsView.refresh_now).
		const update = (patch) => view.update_card(def.id, patch);
		const sel = (name, options, value, label) =>
			`<label class="rv-ced-row"><span>${esc(label)}</span><select class="rv-chart-select" data-f="${name}">${options
				.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(value) ? " selected" : ""}>${esc(t)}</option>`)
				.join("")}</select></label>`;
		const no_x = def.type === "line" || def.type === "area";
		const dim_options = [
			...(no_x ? [] : [["", __("None: the measures side by side")]]),
			...dims.map((d) => [d.key, view.dimension_title(d.key)]),
		];
		const full = def.series.length >= MAX_SERIES;
		const kpi = def.type === "kpi";
		box.innerHTML = `
			<div class="rv-pop-hd"><span>${esc(__("Edit chart"))}</span><button type="button" class="rv-link" data-action="done">${esc(__("Done", null, "Report View"))}</button></div>
			<div class="rv-ced-body">
				<label class="rv-ced-row"><span>${esc(__("Title", null, "Report View"))}</span><input type="text" class="rv-input sm rv-ced-title" maxlength="140" value="${esc(def.title || "")}" placeholder="${esc(
					this.auto_title()
				)}"></label>
				<div class="rv-ced-row"><span>${esc(__("Chart type"))}</span>
					<div class="rv-chart-types rv-ced-types" role="radiogroup" aria-label="${esc(__("Chart type"))}">
						${CARD_TYPES.filter((t) => t === def.type || !this.ctx.config?.features || this.ctx.config.features.chart_types.includes(t)).map(
							(t) =>
								`<button type="button" class="rv-ctype${t === def.type ? " on" : ""}" role="radio" aria-checked="${t === def.type}" data-type="${t}" title="${esc(
									TYPE_LABELS[t]()
								)}">${TYPE_ICONS[t]}<span>${esc(TYPE_LABELS[t]())}</span></button>`
						).join("")}
					</div>
				</div>
				${kpi ? "" : sel("x", dim_options, def.x ?? "", __("Dimension"))}
				<div class="rv-ced-row"><span>${esc(__("Measures"))}</span>
					<div class="rv-chart-measures">
						${measures
							.map((key) => {
								const i = def.series.indexOf(key);
								const on = i >= 0;
								const locked = (on && def.series.length === 1) || (!on && full);
								return `<label class="rv-setitem"><span class="rv-check"><input type="checkbox" data-key="${esc(key)}"${on ? " checked" : ""}${
									locked ? " disabled" : ""
								}><i class="rv-sw ${on ? `rv-sw-${(i % PALETTE.length) + 1}` : "off"}"></i><span>${esc(controls.full_title(key))}</span></span></label>`;
							})
							.join("")}
					</div>
				</div>
				<div class="rv-ced-2">
					${sel("agg", [["", __("As in the report")], ...CARD_AGGS.map((a) => [a, AGG_LABELS[a]()])], def.agg ?? "", __("Aggregate"))}
					${kpi || def.x === null ? "" : sel("sort", [["", __("Automatic", null, "Report View")], ...Object.keys(SORT_LABELS).map((s) => [s, SORT_LABELS[s]()])], def.sort ?? "", __("Sort", null, "Report View"))}
				</div>
				${
					kpi || def.x === null
						? ""
						: `<div class="rv-ced-row"><span>${esc(__("Show", null, "Report View"))}</span><div class="rv-seg rv-ced-top" role="radiogroup" aria-label="${esc(__("Show", null, "Report View"))}">${CARD_TOPS.map(
								(t) =>
									`<button type="button" role="radio" data-top="${t}" class="${(def.top || 0) === t ? "on" : ""}" aria-checked="${(def.top || 0) === t}">${esc(
										t ? __("Top {0}", [t]) : __("All")
									)}</button>`
						  ).join("")}</div></div>`
				}
			</div>`;
		box.querySelector('[data-action="done"]').addEventListener("click", () => close_popover());
		const title = box.querySelector(".rv-ced-title");
		const save_title = () => {
			const v = title.value.trim() || null;
			if (v !== (def.title || null)) update({ title: v });
		};
		title.addEventListener("change", save_title);
		title.addEventListener("keydown", (e) => {
			if (e.key === "Enter") save_title();
		});
		for (const b of box.querySelectorAll(".rv-ctype")) {
			b.addEventListener("click", () => {
				const type = b.dataset.type;
				const patch = { type };
				if ((type === "line" || type === "area") && def.x === null) patch.x = dims[0]?.key ?? null;
				update(patch);
			});
		}
		box.querySelector('[data-f="x"]')?.addEventListener("change", (e) => update({ x: e.target.value || null }));
		box.querySelector('[data-f="agg"]')?.addEventListener("change", (e) => update({ agg: e.target.value || null }));
		box.querySelector('[data-f="sort"]')?.addEventListener("change", (e) => update({ sort: e.target.value || null }));
		for (const b of box.querySelectorAll("[data-top]")) b.addEventListener("click", () => update({ top: Number(b.dataset.top) || null }));
		box.querySelector(".rv-chart-measures").addEventListener("change", (e) => {
			const input = e.target.closest("input[data-key]");
			if (!input) return;
			const on = new Set(def.series);
			if (input.checked) on.add(input.dataset.key);
			else on.delete(input.dataset.key);
			// Report order keeps the colour of a measure where it was.
			const series = measures.filter((k) => on.has(k)).slice(0, MAX_SERIES);
			if (series.length) update({ series });
		});
	}

	// ------------------------------------------------------------ lifecycle

	dispose_chart() {
		if (this._frame) cancelAnimationFrame(this._frame);
		this._frame = null;
		if (this.chart) this.chart.dispose();
		this.chart = null;
	}

	destroy() {
		this.token += 1;
		this.dispose_chart();
		this.resize_observer.disconnect();
		if (this.editor && !this.editor.handle.closed) this.editor.handle.close();
		this.data = null;
		this.el.remove();
	}

	debug() {
		const { def, data, spec } = this;
		return {
			id: this.id,
			type: def?.type,
			x: def?.x,
			series: spec?.post.series || def?.series || [],
			route: spec?.post.route || null,
			state: this.el.dataset.state,
			categories: data?.categories || [],
			rids: data?.rids || null,
			values: data?.series || {},
			pct: data?.pct || {},
			total: data?.total || {},
			count: spec?.post.categories ?? null,
			top: spec?.post.top ?? false,
			labels: data && spec ? this.category_texts() : [],
			drawn: Boolean(this.chart) || (def?.type === "kpi" && this.el.dataset.state === "ready"),
			loaded: this.loaded_sig === this.sig && Boolean(data),
			visible: this.visible,
		};
	}
}

