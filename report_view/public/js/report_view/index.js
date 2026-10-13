// Report View page (/desk/report-view/<report_name>, ADR-005).
// Flow: get_meta -> report script -> filters -> api.run -> adapter -> enrichment ->
// Perspective tables (engine/perspective_engine.js) -> view of the view state -> grid.

import { api } from "./api.js";
import { register, get_config } from "./register.js";
import { normalize_async } from "./adapter/normalize.js";
import { enrich_batches, apply_enrichment } from "./adapter/enrich.js";
import {
	get_engine,
	warm_up,
	schedule_dispose,
	cancel_dispose,
	dispose_engine,
	debug_handles,
	engine_ready,
	ReportSession,
} from "./engine/perspective_engine.js";
import { fold_all, toggle_tree_node, visible_columns } from "./engine/view_config.js";
import { default_state, sanitize, reconcile } from "./state/view_state.js";
import { decode_state, make_url_updater } from "./state/url.js";
import { sanitize_groups } from "./state/column_groups.js";
import { sanitize_dashboard } from "./state/dashboard_state.js";
import { open_column_groups } from "./components/column_groups_dialog.js";
import { load_report_settings, MissingFiltersError } from "./filters/report_filters.js";
import { CriteriaBar } from "./filters/criteria.js";
import { install_facade, make_facade } from "./filters/facade.js";
import { make_formatter } from "./format.js";
import { GridView } from "./views/grid_view.js";
import { PivotView } from "./views/pivot_view.js";
import { PagesView } from "./views/pages_view.js";
import { PivotBar } from "./components/pivot_bar.js";
import { open_pivot_drill, DRILL_LIMIT } from "./components/pivot_drill.js";
import { StateOverlay } from "./components/states.js";
import { Header } from "./components/header.js";
import { Toolbar } from "./components/toolbar.js";
import { StatusBar } from "./components/status_bar.js";
import { Summary } from "./components/summary.js";
import { GroupPanel } from "./components/group_panel.js";
import { SidePanel } from "./components/side_panel.js";
import { HeaderCells } from "./components/header_cells.js";
import { close_popover } from "./components/popover.js";
import { ViewControls } from "./view_controls.js";
import { NoticeBar, describe_notices } from "./components/notices.js";
import { icons } from "./components/icons.js";

const RESERVED_PARAMS = new Set(["rv", "view", "prepared_report_name"]);
// Local preferences of this browser (the theme is not part of the view state, §7.1).
const THEME_KEY = "report_view:theme";
const DENSITY_KEY = "report_view:density";
// The pages settings of a report are saved after a burst of changes.
const PAGES_SAVE_MS = 800;

function read_pref(key) {
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
}

function write_pref(key, value) {
	try {
		window.localStorage.setItem(key, value);
	} catch {
		// storage disabled: the choice lasts for this page only
	}
}

const ERROR_TITLES = {
	PermissionError: () => __("You do not have permission to open this report"),
	DoesNotExistError: () => __("Report not found"),
	RVUnsupportedReport: () => __("This report type is not supported in Report View"),
	RVInvalidInput: () => __("The request was not valid"),
	RVReportError: () => __("The report raised an error"),
	ValidationError: () => __("The report could not run"),
	RVNoExport: () => __("You are not allowed to export this report"),
	RVExportMismatch: () => __("The exported totals do not match the screen"),
};

function esc(s) {
	return frappe.utils.escape_html(String(s ?? ""));
}

function query_report_url(name, filters) {
	const params = new URLSearchParams();
	for (const [k, v] of Object.entries(filters || {})) {
		if (v === null || v === undefined || v === "") continue;
		params.set(k, Array.isArray(v) ? JSON.stringify(v) : String(v));
	}
	const q = params.toString();
	return `/desk/query-report/${encodeURIComponent(name)}${q ? `?${q}` : ""}`;
}

export class ReportViewPage {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.page = wrapper.page;
		this.rtl = frappe.utils.is_rtl();
		this.facade = make_facade(this);
		this.update_url = make_url_updater(window);
		this.run_token = 0;
		this.render_token = 0;
		this.session = null;
		this.opened = null;
		this.visible = false;
		this.density = read_pref(DENSITY_KEY) === "compact" ? "compact" : "comfortable";
		this.controls = new ViewControls(this);
		this.make_dom();
		this.watch_theme();
		this.fit_height = this.fit_height.bind(this);
		window.addEventListener("resize", this.fit_height);
		// The server bar grows or shrinks with its note and filters: keep the grid in the window.
		this.resize_observer = new ResizeObserver(() => this.fit_height());
		this.resize_observer.observe(this.$(".rv-server"));
		$(wrapper).on("hide", () => this.hide());
	}

	make_dom() {
		const root = document.createElement("div");
		root.className = "rv";
		root.dir = this.rtl ? "rtl" : "ltr";
		root.innerHTML = `
			<div class="rv-shell">
				<section class="rv-server" aria-label="${esc(__("Report criteria"))}">
					<div class="rv-filters"></div>
				</section>
				<div class="rv-message"></div>
				<div class="rv-summary-slot"></div>
				<div class="rv-toolbar-slot"></div>
				<div class="rv-charts-slot"></div>
				<div class="rv-gridwrap"><div class="rv-body"><div class="rv-grid"></div><div class="rv-grid rv-pivotgrid"></div><div class="rv-pages"></div></div></div>
			</div>`;
		this.page.main.get(0).replaceChildren(root);
		this.root = root;
		this.$ = (sel) => root.querySelector(sel);
		this.header = new Header({
			parent: this.page.page_actions.get(0),
			dir: root.dir,
			on_refresh: () => this.run(),
			on_density: (d) => this.set_density(d),
			on_theme: () => this.toggle_theme(),
			on_export: () => this.export_xlsx(),
			on_print: () => this.print(),
		});
		this.summary = new Summary({ parent: this.$(".rv-summary-slot") });
		this.$(".rv-summary-slot").replaceWith(this.summary.el);
		this.toolbar = new Toolbar({
			root,
			parent: this.$(".rv-toolbar-slot"),
			search: this.controls.search_host(),
			on_mode: (mode) => this.set_mode(mode),
		});
		this.$(".rv-toolbar-slot").replaceWith(this.toolbar.el);
		const wrap = this.$(".rv-gridwrap");
		const body = this.$(".rv-body");
		this.group_panel = new GroupPanel({
			parent: wrap,
			on_change: (by) => (this.state?.mode === "pivot" ? this.controls.set_pivot_rows(by) : this.controls.set_group(by)),
			groupable: (key) => (this.state?.mode === "pivot" ? this.controls.pivotable(key) : this.controls.groupable(key)),
			on_subtotals: (on) => this.set_subtotals(on),
			on_fold_all: (open) => this.fold_all(open),
			on_column_groups: () => open_column_groups(this.controls),
		});
		wrap.prepend(this.group_panel.el);
		this.pivot_bar = new PivotBar({
			parent: wrap,
			after: this.group_panel.el,
			on_change: (cols) => this.controls.set_pivot_cols(cols),
			allowed: (key) => this.controls.pivotable(key),
			on_row_moved: (key, at) => this.controls.move_pivot_dim(key, "cols", at),
		});
		this.overlay = new StateOverlay(wrap);
		this.notices = new NoticeBar({ parent: wrap, before: body });
		this.cells = new HeaderCells({
			kind: (key) => this.controls.kind(key),
			sort_of: (key) => this.controls.sort_of(key),
			filter_of: (key) => this.controls.filter_of(key),
			set_label: (key) => this.controls.set_label(key),
			draggable: (key) => this.controls.groupable(key),
			on_sort: (key) => this.controls.toggle_sort(key),
			on_menu: (key, anchor) => this.controls.open_column_menu(key, anchor),
			on_filter: (key, f) => this.controls.set_filter(key, f),
			on_set: (key, anchor) => this.controls.open_set(key, anchor),
		});
		this.grid = new GridView({
			parent: this.$(".rv-grid"),
			rtl: this.rtl,
			cells: this.cells,
			on_tree_toggle: (rid) => this.toggle_tree(rid),
			on_fold_changed: (expanded) => this.save_fold(expanded),
			on_column_resized: (key, width) => this.save_width(key, width),
		});
		this.pivot = new PivotView({
			parent: this.$(".rv-pivotgrid"),
			rtl: this.rtl,
			fold: (opened, change) => this.session.fold_pivot(opened, change),
			on_cell: (cell) => this.open_pivot_cell(cell),
		});
		this.pivot_token = 0;
		this.pivot_opened = null;
		this.pages = new PagesView({ parent: this.$(".rv-pages"), root, rtl: this.rtl, host: this });
		this.side = new SidePanel({ body, host: this.controls.side_host() });
		this.status = new StatusBar({ parent: wrap });
		this.apply_density();
	}

	/**
	 * A change of the view state from a control of the page: the controls follow at once,
	 * then the new view is opened (render) and the URL written.
	 * @param {(state: object) => void} fn mutates this.state
	 */
	change(fn) {
		if (!this.state) return;
		fn(this.state);
		this.refresh_controls();
		this.render();
	}

	// The user's column groups of this report, kept in Frappe's user settings (per user,
	// per report) until saved views exist. A link with its own groups (rv) wins.
	user_settings_key() {
		return `Report View:${this.report_name}`;
	}

	async load_user_groups() {
		if (!frappe.model?.user_settings?.get) return;
		try {
			const saved = (await frappe.model.user_settings.get(this.user_settings_key()))?.column_groups;
			const groups = sanitize_groups(saved?.groups);
			if (!groups) return;
			this.state.columns.groups = groups;
			if (Array.isArray(saved.order)) this.state.columns.order = saved.order.filter((k) => typeof k === "string");
		} catch {
			// no saved groups: the report's own
		}
	}

	// The user's charts dashboard of this report (cards and slicers; the cross-filter of a
	// click is not kept), in the same user settings. A link with its own dashboard (rv) wins.
	async load_user_charts() {
		if (!frappe.model?.user_settings?.get) return;
		try {
			const saved = sanitize_dashboard((await frappe.model.user_settings.get(this.user_settings_key()))?.charts);
			if (saved) this.state.charts = { ...saved, cross: null };
		} catch {
			// no saved dashboard: the report's default
		}
	}

	save_user_charts(dashboard) {
		if (!frappe.model?.user_settings?.save) return;
		// One request after a burst of changes (ticking slicer values one by one).
		clearTimeout(this._charts_save);
		const key = this.user_settings_key();
		const value = dashboard ? { ...dashboard, cross: null } : null;
		this._charts_save = setTimeout(() => frappe.model.user_settings.save(key, "charts", value), 800);
	}

	save_user_groups(groups) {
		if (!frappe.model?.user_settings?.save) return;
		frappe.model.user_settings.save(
			this.user_settings_key(),
			"column_groups",
			groups ? { groups, order: this.state.columns.order } : null
		);
	}

	// Controls that show the view state: facets, header cells, group panel, side panel.
	refresh_controls() {
		if (!this.state) return;
		this.apply_mode();
		this.toolbar.search.refresh();
		this.cells.refresh();
		this.side.refresh();
		const pivot = this.state.mode === "pivot" ? this.controls.pivot() : null;
		this.pivot_bar.show(Boolean(pivot));
		if (pivot) {
			const labels = Object.fromEntries([...pivot.rows, ...pivot.cols].map((k) => [k, this.controls.dim_title(k)]));
			this.group_panel.set({
				by: pivot.rows,
				labels,
				foldable: pivot.rows.length > 1,
				subtotals: false,
				hierarchical: false,
				pivot: { cols: pivot.cols, on_column: (key, at) => this.controls.move_pivot_dim(key, "rows", at) },
			});
			this.pivot_bar.set({
				cols: pivot.cols,
				rows: pivot.rows,
				labels,
				values: pivot.values.map((v) => this.controls.value_title(v)).join(__(", ")),
			});
			return;
		}
		this.group_panel.set({
			by: this.state.group.by,
			labels: Object.fromEntries(this.state.group.by.map((k) => [k, this.controls.title(k)])),
			foldable: Boolean(this.result && this.result.mode !== "flat"),
			subtotals: this.state.group.subtotals !== false,
			hierarchical: Boolean(this.result && this.result.mode !== "flat"),
		});
	}

	// View switcher: the table, the pivot or the charts.
	apply_mode() {
		const mode = this.state?.mode || "grid";
		this.root.classList.toggle("rv-mode-charts", mode === "charts");
		this.root.classList.toggle("rv-mode-pivot", mode === "pivot");
		this.root.classList.toggle("rv-mode-pages", mode === "pages");
		this.toolbar.set_mode(mode);
		this.header.set_mode(mode);
	}

	set_mode(mode) {
		if (!this.state || this.state.mode === mode) return;
		if (mode === "pages" && !this.meta?.perms?.can_print) return;
		this.change((s) => {
			s.mode = mode;
		});
	}

	// The Print action of the page head: the pages, where the print button is (ADR-014).
	print() {
		if (!this.state || !this.meta?.perms?.can_print) return;
		if (this.state.mode !== "pages") {
			this.set_mode("pages");
			return;
		}
		this.pages.print();
	}

	// The user changed the chart (type, dimension, measures): only the chart's view is opened again.
	set_chart(chart) {
		if (!this.state) return;
		this.state.charts = chart;
		this.save_user_charts(chart);
		this.update_url(this.last_filters, this.state, default_state(this.config));
		if (this.charts) this.charts.refresh().catch((e) => this.show_error(e));
	}

	// The user changed the pivot (rows, columns, values): only the pivot's views are opened again.
	set_pivot(pivot, mode = null) {
		if (!this.state) return;
		if (mode && this.state.mode !== mode) {
			this.change((s) => {
				s.pivot = pivot;
				s.mode = mode;
			});
			return;
		}
		this.state.pivot = pivot;
		this.refresh_controls();
		this.update_url(this.last_filters, this.state, default_state(this.config));
		if (this.state.mode === "pivot" && this.session && this.opened) this.show_pivot(this.session).catch((e) => this.show_error(e));
	}

	/**
	 * Pivot mode (docs/architecture.md §11.1 #67): the pivot's two views are opened, swapped
	 * into the pivot table, then the previous ones are deleted. A newer call supersedes this one.
	 */
	async show_pivot(session) {
		const token = ++this.pivot_token;
		const pivot = this.controls.pivot();
		if (!pivot) return;
		const opened = await session.open_pivot(this.state, pivot);
		if (!opened) return;
		if (token !== this.pivot_token || session !== this.session || this.state.mode !== "pivot") {
			await session.close_pivot(opened);
			return;
		}
		const previous = this.pivot_opened;
		this.pivot_opened = opened;
		this.notices.show(describe_notices([...(this.opened?.post.notices || []), ...opened.post.notices], this.report.columns));
		try {
			await this.pivot.show({
				opened,
				report: this.report,
				state: this.state,
				config: this.config,
				controls: this.controls,
				fmt: this.formatter,
			});
		} finally {
			if (previous) await session.close_pivot(previous);
		}
	}

	/** Leaves pivot mode: the pivot table goes, its views are deleted. */
	async close_pivot() {
		this.pivot_token += 1;
		const opened = this.pivot_opened;
		this.pivot_opened = null;
		this.pivot.destroy();
		if (opened && this.session) await this.session.close_pivot(opened);
	}

	// A pivot cell was pressed: the report rows behind it (a temporary view, deleted at once).
	open_pivot_cell(cell) {
		const session = this.session;
		if (!session || cell.opened !== this.pivot_opened) return;
		const label_key = this.controls.label_key();
		const label = this.controls.column(label_key);
		const parts = this.config?.tree?.name_key ? this.config.tree : null;
		const column = this.controls.column(cell.value.key);
		const fmt = this.formatter;
		open_pivot_drill({
			root: this.root,
			cell,
			load: () => session.pivot_drill(cell.opened, cell.row_path, cell.col_values, cell.value, label_key, DRILL_LIMIT),
			row_of: (rid) => session.rows_by_rid.get(rid) || null,
			label_html: (row) => {
				if (parts && row[parts.name_key]) {
					const no = parts.number_key && row[parts.number_key] ? `<bdi class="rv-accno">${esc(row[parts.number_key])}</bdi>` : "";
					return `${no}${esc(row[parts.name_key])}`;
				}
				return label ? fmt.caption_html(label, row) || esc(__("Not Set")) : "";
			},
			value_of: (row) => ({ html: fmt.value_html(column, { ...row, __kind: "group" }), sign: fmt.sign_of(column, row) }),
		});
	}

	// The Charts view and ECharts load on first use (report_view_charts.bundle.js).
	async show_charts(session) {
		if (!this.charts) {
			if (!window.report_view?.ChartsView) await frappe.require("report_view_charts.bundle.js");
			if (!this.charts) {
				this.charts = new report_view.ChartsView({
					parent: this.$(".rv-charts-slot"),
					root: this.root,
					rtl: this.rtl,
					on_change: (chart) => this.set_chart(chart),
				});
			}
		}
		if (session !== this.session || this.state.mode !== "charts") return;
		await this.charts.show({ session, report: this.report, state: this.state, config: this.config, controls: this.controls });
	}

	async close_charts() {
		if (this.charts) await this.charts.close();
	}

	// Theme: the Desk theme by default (data-theme is the resolved light/dark value, also in
	// "automatic" mode); the header button stores a local choice in localStorage.
	watch_theme() {
		this.apply_theme();
		this.theme_observer = new MutationObserver(() => this.apply_theme());
		this.theme_observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme"],
		});
	}

	is_dark() {
		const saved = read_pref(THEME_KEY);
		if (saved === "dark" || saved === "light") return saved === "dark";
		return document.documentElement.getAttribute("data-theme") === "dark";
	}

	apply_theme() {
		const dark = this.is_dark();
		this.root.classList.toggle("dark", dark);
		this.header.set_theme(dark);
	}

	toggle_theme() {
		write_pref(THEME_KEY, this.is_dark() ? "light" : "dark");
		this.apply_theme();
	}

	apply_density() {
		this.root.classList.toggle("compact", this.density === "compact");
		this.header.set_density(this.density);
		if (this.state) this.state.ui.density = this.density;
	}

	set_density(density) {
		if (density === this.density) return;
		this.density = density;
		write_pref(DENSITY_KEY, density);
		this.apply_density();
		this.fit_height();
		this.render();
	}

	// The grid is as tall as the window below Desk's sticky bars: the criteria and the
	// summary scroll away above it, and the report then has the whole screen. On small
	// screens it keeps a minimum height.
	// Asked by several observers while the page builds: one measure per frame, at the frame,
	// instead of a forced layout in the middle of the work for each of them.
	fit_height() {
		if (this._fit_frame) return;
		this._fit_frame = requestAnimationFrame(() => {
			this._fit_frame = 0;
			this.measure_height();
		});
	}

	measure_height() {
		const wrap = this.$(".rv-gridwrap");
		if (!wrap || !wrap.isConnected) return;
		let sticky = 0;
		for (const el of document.querySelectorAll(".navbar, .page-head")) {
			const pos = getComputedStyle(el).position;
			if (pos === "sticky" || pos === "fixed") sticky = Math.max(sticky, el.getBoundingClientRect().bottom);
		}
		const h = Math.max(420, Math.round(window.innerHeight - Math.max(0, sticky) - 16));
		wrap.style.height = `${h}px`;
	}

	// Filters changed: the report runs again by itself, as on query-report (debounced).
	on_filters_changed() {
		this.schedule_run();
	}

	request_refresh() {
		this.schedule_run();
	}

	show() {
		this.restore_facade = install_facade(this);
		this.visible = true;
		cancel_dispose();
		const name = frappe.get_route()[1];
		if (!name) {
			this.overlay.show({ kind: "error", icon: "!", tone: "err", title: __("Report not found") });
			return;
		}
		if (name !== this.report_name) {
			this.load(name);
		} else if (frappe.route_options && this.filters) {
			const options = frappe.route_options;
			frappe.route_options = null;
			this.filters.set_route_values(options).then(() => this.run());
		} else if (this.report && !this.session) {
			this.reopen();
		}
	}

	// Leaving the page: every view and table is deleted now; the worker is terminated if the
	// user does not come back within a minute (docs/architecture.md §8أ.3).
	hide() {
		close_popover();
		if (this.restore_facade) this.restore_facade();
		this.restore_facade = null;
		this.visible = false;
		this.close_session().finally(() => schedule_dispose());
	}

	/** Deletes the main view and the tables of the current result (views first). */
	async close_session() {
		const session = this.session;
		this.session = null;
		this.opened = null;
		this.result = null;
		this.render_token += 1;
		this.grid.destroy();
		this.notices.show(null);
		await this.close_charts();
		// The pivot's views go with the tables of the session.
		this.pivot_token += 1;
		this.pivot_opened = null;
		this.pivot.destroy();
		this.pages.destroy();
		if (session) await session.close();
	}

	/** Loads the normalized report into Perspective tables (explicit schema, in batches). */
	async open_session(token) {
		const { handles } = await get_engine();
		const session = await ReportSession.create(handles, this.report, {
			locale: frappe.boot.lang,
			quick_filters: this.config?.quick_filters || [],
		});
		if (token !== this.run_token || !this.visible || this.session) {
			await session.close();
			return;
		}
		this.session = session;
	}

	// The first run of a page loads the engine (worker and WASM): the loading state says so.
	show_loading() {
		this.overlay.loading(engine_ready() ? "" : __("Preparing the engine…"));
		this.show_summary("loading");
	}

	// Back on the page with the same report: its tables were deleted on leaving.
	async reopen() {
		const token = this.run_token;
		this.show_loading();
		try {
			await this.open_session(token);
			if (token === this.run_token) await this.render();
		} catch (e) {
			if (token === this.run_token) this.show_error(e);
		}
	}

	async load(name) {
		this.report_name = name;
		this.report = null;
		this.raw = null;
		this.run_token += 1;
		warm_up();
		await this.close_session();
		this.page.set_title(__(name));
		this.header.set_report({ can_export: false, can_print: false });
		this.toolbar.set_report({ can_print: false });
		this.show_loading();
		const route_options = frappe.route_options || {};
		frappe.route_options = null;
		try {
			this.meta = await api.get_meta(name);
			this.report_settings = await load_report_settings(name, this.meta.script);
			if (this.meta.include_js?.length) await frappe.require(this.meta.include_js);
		} catch (e) {
			this.show_error(e);
			return;
		}
		if (this.meta.settings && this.meta.settings.enabled === false) {
			this.overlay.show({
				kind: "disabled",
				icon: "i",
				title: __("This report is not enabled in Report View"),
				actions: [{ label: __("Open standard report"), href: query_report_url(name, {}) }],
			});
			return;
		}
		this.config = get_config(name);
		const can_print = Boolean(this.meta.perms?.can_print);
		this.header.set_report({ can_export: Boolean(this.meta.perms?.can_export), can_print });
		this.toolbar.set_report({ can_print });
		if (frappe.breadcrumbs && this.meta.report?.module) frappe.breadcrumbs.add(this.meta.report.module);

		const params = new URLSearchParams(window.location.search);
		const from_url = decode_state(params.get("rv"));
		this.state = sanitize(from_url || default_state(this.config), this.config);
		// The pages need the print permission: a link to them opens the table otherwise.
		if (this.state.mode === "pages" && !can_print) this.state.mode = "grid";
		if (!from_url?.columns?.groups) await this.load_user_groups();
		if (!from_url?.charts) await this.load_user_charts();
		this.state.ui.density = this.density;
		this.prepared_report_name = route_options.prepared_report_name || null;

		this.criteria = new CriteriaBar({
			root: this.root,
			parent: this.$(".rv-filters"),
			host: this,
			defs: this.report_settings.filters || [],
			period: this.config.period,
			on_change: () => this.on_filters_changed(),
		});
		this.filters = this.criteria.filters;
		this.cells.clear();
		const filter_options = Object.fromEntries(
			Object.entries(route_options).filter(([k]) => !RESERVED_PARAMS.has(k))
		);
		await this.filters.set_route_values(filter_options);
		this.criteria.refresh();
		this.refresh_controls();
		this.fit_height();

		if (typeof this.report_settings.onload === "function") {
			this.filters._no_refresh = true;
			try {
				this.report_settings.onload(this.facade);
			} finally {
				this.filters._no_refresh = false;
			}
		}
		await this.run();
	}

	schedule_run() {
		clearTimeout(this._run_timer);
		if (this._runs_held) {
			this._run_wanted = true;
			return;
		}
		this._run_timer = setTimeout(() => this.run(), 300);
	}

	// Several filters written as one change (the period: fiscal year, then the dates):
	// no run in between, one run after if any of them asked for it.
	async hold_runs(job) {
		this._runs_held = true;
		this._run_wanted = false;
		try {
			await job();
		} finally {
			this._runs_held = false;
			if (this._run_wanted) this.schedule_run();
		}
	}

	async run() {
		clearTimeout(this._run_timer);
		if (!this.filters) return;
		const token = ++this.run_token;
		let values;
		try {
			values = this.filters.get_values(true);
		} catch (e) {
			if (e instanceof MissingFiltersError) {
				this.status.clear();
				this.overlay.show({
					kind: "missing_filters",
					icon: "!",
					tone: "warn",
					title: __("Please set filters"),
					text: e.labels.join(", "),
				});
				return;
			}
			throw e;
		}
		this.last_filters = values;
		this.show_loading();
		this.status.clear();
		try {
			const res = await api.run(this.report_name, values, this.filters.js_filters(), this.prepared_report_name);
			if (token !== this.run_token) return;
			await this.handle_response(res.message, res.server_messages, values, token);
		} catch (e) {
			if (token === this.run_token) this.show_error(e);
		} finally {
			if (token === this.run_token && typeof this.report_settings.after_refresh === "function") {
				this.report_settings.after_refresh(this.facade);
			}
		}
	}

	async handle_response(res, server_messages, values, token) {
		const status = res?.status;
		if (status === "too_large" || status === "prepared_pending" || status === "prepared_missing") {
			this.report = null;
			await this.close_session();
		}
		if (status === "too_large") {
			this.overlay.show({
				kind: "too_large",
				icon: "!",
				tone: "warn",
				title: __("Too many rows for Report View"),
				text: __("The report returned {0} rows; the limit is {1}. Narrow the filters or open the standard report.", [
					format_int(res.row_count),
					format_int(res.limit),
				]),
				actions: [{ label: __("Open standard report"), href: query_report_url(this.report_name, values) }],
			});
			return;
		}
		if (status === "prepared_pending" || status === "prepared_missing") {
			const pending = status === "prepared_pending";
			this.overlay.show({
				kind: status,
				icon: "…",
				tone: "warn",
				title: pending
					? __("The report is being prepared in the background")
					: __("No prepared result for these filters"),
				text: pending
					? __("Try again in a moment.")
					: __("Generate it from the standard report page, then come back."),
				actions: [
					{ label: __("Try again"), primary: true, action: () => this.run() },
					{ label: __("Open standard report"), href: query_report_url(this.report_name, values) },
				],
			});
			return;
		}

		this.raw = res.raw;
		const report = await normalize_async(
			{
				raw: res.raw,
				filters: values,
				report_settings: this.report_settings,
				register: this.config,
				server_messages,
			},
			{ translate: __ }
		);
		if (token !== this.run_token) return;
		report.__report_type = this.meta.report?.report_type;
		await this.enrich(report);
		if (token !== this.run_token) return;
		// A new result: the views and tables of the previous one go first.
		await this.close_session();
		if (token !== this.run_token) return;
		this.report = report;
		reconcile(this.state, report.columns);
		this.formatter = make_formatter({ report_settings: this.report_settings, columns: report.columns });
		await this.open_session(token);
		if (token !== this.run_token) return;
		this.$(".rv-message").innerHTML = report.message ? frappe.dom.remove_script_and_style(String(report.message)) : "";
		await this.render();
	}

	async enrich(report) {
		const rules = this.meta.settings?.enrich_rules || [];
		for (const rule of rules) {
			const source = report.columns.find((c) => c.key === rule.source_column);
			if (!source || source.link?.kind !== "static" || !rule.fields?.length) continue;
			const values = {};
			const field_meta = {};
			let fields = [...rule.fields];
			try {
				for (const names of enrich_batches(report, rule.source_column)) {
					const r = await api.enrich(this.report_name, rule.source_column, rule.link_doctype, names, fields);
					Object.assign(values, r.rows || {});
					Object.assign(field_meta, r.fields || {});
					const dropped = new Set(r.dropped_fields || []);
					fields = fields.filter((f) => !dropped.has(f));
				}
			} catch (e) {
				frappe.show_alert({ message: __("Extra columns could not be loaded: {0}", [e.message]), indicator: "orange" });
				continue;
			}
			apply_enrichment(report, rule, values, fields, (f) => __(frappe.unscrub(f)), field_meta);
		}
	}

	// A view state change: the new view is opened, swapped into the grid, then the old one
	// is deleted (no flicker). A newer render() supersedes this one.
	async render() {
		try {
			await this.render_view();
		} catch (e) {
			this.show_error(e);
		}
	}

	async render_view() {
		if (!this.report) return;
		const report = this.report;
		const session = this.session;
		if (!report.rows.length) {
			await this.close_charts();
			await this.close_pivot();
			this.pages.destroy();
			this.grid.destroy();
			this.notices.show(null);
			const notes = report.notices.filter((n) => n.code === "SERVER_MESSAGE").map((n) => n.detail);
			this.overlay.show({
				kind: "empty",
				icon: "∅",
				title: __("No results"),
				text: notes.length ? frappe.utils.html2text(notes.join("\n")) : __("Nothing matches these filters."),
			});
			this.status.clear();
			this.show_summary("empty");
			return;
		}
		if (!session) return;
		const token = ++this.render_token;
		let opened;
		try {
			// The main view also stands behind the charts: summary cards, status bar, export.
			opened = await session.open(this.state, "grid");
		} catch (e) {
			// The result was replaced (its tables deleted) while this view was being opened.
			if (session !== this.session) return;
			throw e;
		}
		if (!opened) return;
		if (token !== this.render_token || session !== this.session) {
			await session.close_view(opened);
			return;
		}
		const previous = this.opened;
		this.opened = opened;
		const mode = { tree: "tree", levels: "tree", group: "group", flat: "flat", report: "flat" }[opened.post.shape];
		this.result = { mode };
		this.overlay.hide();
		// What the view state asks for and the screen does not do is said, once, not dropped.
		this.notices.show(describe_notices(opened.post.notices, report.columns));
		this.refresh_controls();
		const charts = this.state.mode === "charts";
		const pivot = this.state.mode === "pivot";
		const pages = this.state.mode === "pages";
		try {
			if (charts || pivot || pages) {
				this.grid.destroy();
				if (!pivot) await this.close_pivot();
				if (!charts) await this.close_charts();
				if (!pages) this.pages.destroy();
			} else {
				await this.close_charts();
				await this.close_pivot();
				this.pages.destroy();
				await this.grid.show({
					report,
					opened,
					session,
					state: this.state,
					config: this.config,
					fmt: this.formatter,
				});
			}
		} finally {
			// The view shown before goes even when the grid failed to draw the new one.
			if (previous) await session.close_view(previous);
		}
		if (this.opened === opened) {
			this.update_status(opened.counts);
			await this.update_summary(opened, session);
		}
		if (charts && this.opened === opened) await this.show_charts(session);
		if (pivot && this.opened === opened) await this.show_pivot(session);
		if (pages && this.opened === opened) {
			await this.pages.show({ report, opened, session, state: this.state, config: this.config, fmt: this.formatter });
		} else if (this.meta?.perms?.can_print && this.opened === opened) {
			// the pages' settings, options and letter head, ready before the tab is opened
			this.pages.prefetch();
		}
		this.update_url(this.last_filters, this.state, default_state(this.config));
	}

	// Status bar (§8أ.5). Rows are the facts of the report (the leaves of a tree), as in the
	// badge of the grand total: those that pass the browser filters, of all of them. Groups
	// and tree parents are counted apart; folding changes neither number.
	update_status(counts) {
		this.status.update({
			row_count: counts.shown,
			fact_count: counts.total,
			group_count: counts.groups,
			filters: this.controls.active_count(),
			noun: this.config?.rows_label,
		});
	}

	/** Summary cards in a state without numbers (loading, error, no rows). */
	show_summary(status) {
		const pairs = this.config?.summary?.kind === "balance_pairs" ? this.config.summary.pairs || [] : [];
		if (!pairs.length) {
			this.summary.hide();
			return;
		}
		this.summary.show({ status, cards: pairs.map((p) => ({ label: p.label })) });
	}

	/**
	 * Summary cards (register.summary, kind "balance_pairs"): the debit and credit totals of
	 * the grand total shown, read from the engine's view (or the report's own reference row
	 * when that is the grand total shown, ADR-008). The difference is the one subtraction of
	 * the two totals read; "balanced" is that difference rounding to zero at the precision
	 * of the column.
	 */
	async update_summary(opened, session) {
		const pairs = this.config?.summary?.kind === "balance_pairs" ? this.config.summary.pairs || [] : [];
		if (!pairs.length) {
			this.summary.hide();
			return;
		}
		const keys = pairs.flatMap((p) => [p.debit, p.credit]).filter((k) => this.controls.column(k));
		let values;
		try {
			values = await session.summary_totals(opened, keys);
		} catch (e) {
			if (this.opened !== opened) return;
			throw e;
		}
		if (this.opened !== opened) return;
		const counts = opened.counts;
		if (!counts.shown) {
			this.show_summary("empty");
			return;
		}
		const fmt = this.formatter;
		const currencies = opened.totals.currencies || {};
		const cards = pairs.map((p) => {
			const dcol = this.controls.column(p.debit);
			const ccol = this.controls.column(p.credit);
			if (!dcol || !ccol) return { label: p.label, debit_html: "—", credit_html: "—", balanced: false, diff_text: "—" };
			const d = values[p.debit];
			const c = values[p.credit];
			const diff = (d ?? 0) - (c ?? 0);
			const row = (key, v) => ({ __kind: "grand_total", __mixed: {}, ...currencies, [key]: v });
			return {
				label: p.label,
				debit_html: d === null || d === undefined ? "—" : fmt.value_html(dcol, row(p.debit, d)),
				credit_html: c === null || c === undefined ? "—" : fmt.value_html(ccol, row(p.credit, c)),
				balanced: fmt.sign_of(dcol, row(p.debit, diff)) === "zero",
				diff_text: fmt.number_text(dcol, Math.abs(diff)),
			};
		});
		this.summary.show({
			status: "ready",
			cards,
			filtered: opened.post.fact_filter.length > 0,
			shown: counts.shown,
			total: counts.total,
		});
	}

	// A parent of the report tree was opened or closed: the fold is an engine filter.
	toggle_tree(rid) {
		if (!this.report?.tree) return;
		this.state.tree.expanded = toggle_tree_node(this.state, this.report, rid);
		this.render();
	}

	// A group of a grouped view was opened or closed in the view itself: the fold goes into
	// the view state and the URL, nothing is rendered again.
	save_fold(expanded) {
		if (!this.state) return;
		this.state.group.expanded = expanded;
		this.update_url(this.last_filters, this.state, default_state(this.config));
	}

	// A column was resized in the grid (it already shows the new width).
	save_width(key, width) {
		if (!this.state) return;
		this.state.columns.widths[key] = width;
		this.update_url(this.last_filters, this.state, default_state(this.config));
	}

	set_subtotals(on) {
		if (!this.state || this.state.group.subtotals === on) return;
		this.state.group.subtotals = on;
		this.render();
	}

	// "Expand all" / "collapse all" of the toolbar.
	fold_all(open) {
		if (!this.report || !this.state) return;
		if (this.state.mode === "pivot") {
			this.pivot.fold_all(open).catch((e) => this.show_error(e));
			return;
		}
		const change = fold_all(this.state, this.report, open);
		if (!change) return;
		Object.assign(this.state, change);
		this.render();
	}

	show_error(e) {
		const exc = e?.exc_type || null;
		const title = (ERROR_TITLES[exc] || (() => __("Something went wrong")))();
		// What was on screen no longer stands for the criteria: its view and tables go.
		this.close_session().catch(() => {});
		this.status.clear();
		this.show_summary("error");
		this.overlay.show({
			kind: "error",
			icon: "!",
			tone: "err",
			title,
			text: e?.message || "",
			code: exc || "",
			actions: [{ label: __("Try again"), primary: true, action: () => this.run() }],
		});
	}

	// ------------------------------------------------------------ the Pages view (ADR-014)

	/** What the pages print around the table: the report, its criteria and the company. */
	pages_context() {
		const company = this.last_filters?.company || frappe.defaults?.get_default?.("company") || null;
		return {
			report_name: this.report_name,
			company: company ? String(company) : null,
			filters: this.last_filters || {},
			defs: this.report_settings?.filters || [],
			group_labels: (this.state?.group?.by || []).map((k) => this.controls.title(k)),
			raw: this.raw,
			report_settings: this.report_settings,
		};
	}

	pages_options(company) {
		return api.get_print_options(this.report_name, company);
	}

	pages_letterhead(name) {
		const ctx = this.pages_context();
		return api.render_letterhead(name, { ...ctx.filters, company: ctx.filters.company || ctx.company });
	}

	/** A report print format: a JS template as it is, a Jinja one rendered by the server. */
	async pages_format(name, lang = null, type = null, view_columns = null) {
		// a Jinja format known from the options is rendered at once (one request, not two)
		const format = type === "Jinja" ? { type } : await api.get_print_format(this.report_name, name);
		if (format.type !== "Jinja") return format;
		const meta = (this.report_settings?.filters || []).map((df) => ({ fieldname: df.fieldname, label: __(df.label || ""), fieldtype: df.fieldtype }));
		return api.render_print_format(this.report_name, name, this.last_filters, this.filters.js_filters(), meta, this.prepared_report_name, lang, view_columns);
	}

	/** A print heading or signature (ADR-015), rendered by the server with the filters on screen. */
	pages_part(kind, name, lang = null, view_columns = null) {
		const meta = (this.report_settings?.filters || []).map((df) => ({ fieldname: df.fieldname, label: __(df.label || ""), fieldtype: df.fieldtype }));
		const render = kind === "heading" ? api.render_print_heading : api.render_print_signature;
		return render(this.report_name, name, this.last_filters, meta, lang, view_columns);
	}

	/** The PDF of the pages (ADR-016): the server's engine prints the very sheets. */
	pages_pdf_target() {
		return { method: "report_view.api.pdf.pages_pdf_report", args: { report_name: this.report_name } };
	}

		pages_translations(lang, messages) {
		return api.get_translations(this.report_name, lang, messages);
	}

	/**
	 * The report run again in another language (its labels and captions translated by the
	 * server), normalised like the one on screen with the captions of that language. Null
	 * when it cannot stand for the rows shown (a different result).
	 * @param {Promise<object>} pack_p the translation pack of the language
	 */
	async pages_run_lang(lang, pack_p) {
		const shown = this.report;
		const [res, pack] = await Promise.all([
			api.run(this.report_name, this.last_filters, this.filters.js_filters(), this.prepared_report_name, lang),
			pack_p,
		]);
		if (res.message?.status !== "ok" || this.report !== shown) return null;
		const report = await normalize_async(
			{
				raw: res.message.raw,
				filters: this.last_filters,
				report_settings: this.report_settings,
				register: this.config,
				server_messages: res.server_messages,
			},
			{ translate: (s) => pack?.[s] || s }
		);
		if (this.report !== shown || report.rows.length !== shown.rows.length) return null;
		for (let i = 0; i < report.rows.length; i++) if (report.rows[i].__kind !== shown.rows[i].__kind) return null;
		return report;
	}

	async pages_settings_load() {
		if (!frappe.model?.user_settings?.get) return null;
		try {
			return (await frappe.model.user_settings.get(this.user_settings_key()))?.pages || null;
		} catch {
			return null;
		}
	}

	pages_settings_save(settings) {
		if (!frappe.model?.user_settings?.save) return;
		clearTimeout(this._pages_save);
		const key = this.user_settings_key();
		this._pages_save = setTimeout(() => frappe.model.user_settings.save(key, "pages", settings), PAGES_SAVE_MS);
	}

	// Export model v1 (docs/architecture.md §4.1).
	export_model() {
		const cols = visible_columns(this.report, this.state);
		return {
			version: 1,
			format: "xlsx",
			filters: this.last_filters,
			js_filters: this.filters.js_filters(),
			prepared_report_name: this.prepared_report_name,
			view_state: { ...this.state, report_filters: this.last_filters },
			scope: "all",
			selection: null,
			// Read from the view (§8أ.6): the facts that pass the filters and the total shown.
			expected: this.opened.expected,
			layout: {
				title: __(this.report_name),
				orientation: "landscape",
				page_size: "A4",
				include_filters: true,
				include_subtotals: true,
				include_signatures: false,
				columns: cols.map((c) => ({ key: c.key, width: this.state.columns.widths[c.key] || c.width || null })),
			},
			locale: { lang: frappe.boot.lang, rtl: this.rtl },
		};
	}

	async export_xlsx() {
		if (!this.opened) return;
		// Quick filters are engine expressions of the browser; the server export cannot apply
		// them yet, so the file would not be the screen. Said instead of exporting another file.
		if (this.state.quick_filters?.length) {
			frappe.msgprint({
				title: __("Export not available with quick filters"),
				message: esc(__("Quick filters are applied on screen only for now. Remove them to export the file.")),
				indicator: "orange",
			});
			return;
		}
		const btn = this.header.export_button;
		btn.disabled = true;
		try {
			const out = await api.export_xlsx(this.report_name, this.export_model());
			if (out.queued) {
				frappe.show_alert({ message: __("The export is being prepared; you will be notified."), indicator: "blue" });
				return;
			}
			const url = URL.createObjectURL(out.blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = out.filename;
			document.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
			frappe.show_alert({ message: __("Excel file downloaded"), indicator: "green" });
		} catch (e) {
			const title = (ERROR_TITLES[e.exc_type] || (() => __("Export failed")))();
			frappe.msgprint({ title, message: esc(e.message), indicator: "red" });
		} finally {
			btn.disabled = false;
		}
	}

	// Raw values read by the Playwright test: totals of the current view.
	debug_totals() {
		return this.opened ? { mode: this.result.mode, totals: this.opened.expected.totals } : null;
	}

	// What the pivot shows (read by the Playwright tests).
	debug_pivot() {
		const o = this.pivot_opened;
		if (!o) return null;
		return {
			rows: o.post.rows,
			cols: o.post.cols,
			values: o.post.values.map((v) => ({ key: v.key, agg: v.agg, name: v.name })),
			column_paths: o.column_paths,
			body_rows: o.body_rows,
			total: o.total,
			blocked: o.post.blocked,
			shown: this.pivot.current === o && Boolean(this.pivot.rt),
		};
	}

	// Views and tables not deleted yet (development counter, §8أ.3).
	debug_handles() {
		return debug_handles();
	}

	// What the idle timer does a minute after the page was left: used by the tests.
	debug_dispose_engine() {
		return dispose_engine();
	}
}

function format_int(n) {
	return frappe.format(n, { fieldtype: "Int" }, { inline: true });
}

frappe.provide("report_view");
Object.assign(window.report_view, { register, get_config, ReportViewPage });
