// Report View page (/desk/report-view/<report_name>, ADR-005).
// Flow: get_meta -> report script -> filters -> api.run -> adapter -> enrichment ->
// Perspective tables (engine/perspective_engine.js) -> view of the view state -> grid.

import { api } from "./api.js";
import { register, get_config } from "./register.js";
import { normalize } from "./adapter/normalize.js";
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
import { load_report_settings, MissingFiltersError } from "./filters/report_filters.js";
import { CriteriaBar } from "./filters/criteria.js";
import { install_facade, make_facade } from "./filters/facade.js";
import { make_formatter } from "./format.js";
import { GridView } from "./views/grid_view.js";
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

// The one currency of the totals shown, or null (header info line).
function single_currency(currencies) {
	const values = Object.values(currencies || {});
	if (!values.length || values.some((v) => !v)) return null;
	return new Set(values).size === 1 ? values[0] : null;
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
		this.has_run = false;
		this.density = read_pref(DENSITY_KEY) === "compact" ? "compact" : "comfortable";
		this.controls = new ViewControls(this);
		this.make_dom();
		this.watch_theme();
		this.fit_height = this.fit_height.bind(this);
		window.addEventListener("resize", this.fit_height);
		// The server bar grows or shrinks with its note and filters: keep the grid in the window.
		this.resize_observer = new ResizeObserver(() => this.fit_height());
		this.resize_observer.observe(this.$(".rv-server"));
		this.resize_observer.observe(this.header.el);
		$(wrapper).on("hide", () => this.hide());
	}

	make_dom() {
		const root = document.createElement("div");
		root.className = "rv";
		root.dir = this.rtl ? "rtl" : "ltr";
		root.innerHTML = `
			<div class="rv-shell">
				<div class="rv-header-slot"></div>
				<section class="rv-server" aria-label="${esc(__("Report criteria"))}">
					<div class="rv-server-tag">
						<div class="rv-server-ico">${icons.database()}</div>
						<div><strong>${esc(__("Report criteria"))}</strong><span>${esc(__("Fetch the data again from the server"))}</span></div>
					</div>
					<div class="rv-filters"></div>
					<div class="rv-server-side">
						<div class="rv-server-note" aria-live="polite"></div>
						<button type="button" class="rv-btn primary" data-action="run">${icons.play()}<span>${esc(__("Run report"))}</span></button>
					</div>
				</section>
				<div class="rv-message"></div>
				<div class="rv-summary-slot"></div>
				<div class="rv-toolbar-slot"></div>
				<div class="rv-gridwrap"><div class="rv-body"><div class="rv-grid"></div></div></div>
			</div>`;
		this.page.main.get(0).replaceChildren(root);
		this.root = root;
		this.$ = (sel) => root.querySelector(sel);
		this.header = new Header({
			parent: this.$(".rv-header-slot"),
			on_density: (d) => this.set_density(d),
			on_theme: () => this.toggle_theme(),
			on_export: () => this.export_xlsx(),
		});
		this.$(".rv-header-slot").replaceWith(this.header.el);
		this.summary = new Summary({ parent: this.$(".rv-summary-slot") });
		this.$(".rv-summary-slot").replaceWith(this.summary.el);
		this.toolbar = new Toolbar({ root, parent: this.$(".rv-toolbar-slot"), search: this.controls.search_host() });
		this.$(".rv-toolbar-slot").replaceWith(this.toolbar.el);
		const wrap = this.$(".rv-gridwrap");
		const body = this.$(".rv-body");
		this.group_panel = new GroupPanel({
			parent: wrap,
			on_change: (by) => this.controls.set_group(by),
			groupable: (key) => this.controls.groupable(key),
			on_subtotals: (on) => this.set_subtotals(on),
			on_fold_all: (open) => this.fold_all(open),
		});
		wrap.prepend(this.group_panel.el);
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
		this.side = new SidePanel({ body, host: this.controls.side_host() });
		this.status = new StatusBar({ parent: wrap });
		this.$('[data-action="run"]').addEventListener("click", () => this.run());
		this.apply_density();
		this.set_note("idle");
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

	// Controls that show the view state: facets, header cells, group panel, side panel.
	refresh_controls() {
		if (!this.state) return;
		this.toolbar.search.refresh();
		this.cells.refresh();
		this.side.refresh();
		this.group_panel.set({
			by: this.state.group.by,
			labels: Object.fromEntries(this.state.group.by.map((k) => [k, this.controls.title(k)])),
			foldable: Boolean(this.result && this.result.mode !== "flat"),
			subtotals: this.state.group.subtotals !== false,
			hierarchical: Boolean(this.result && this.result.mode !== "flat"),
		});
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
	fit_height() {
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

	/**
	 * Server bar note (§11.1 #12, #16).
	 * @param {"idle"|"loading"|"fresh"|"pending"|"missing"|"error"} kind
	 */
	set_note(kind, text = "") {
		const bar = this.$(".rv-server");
		const pending = kind === "pending" || kind === "missing";
		bar.classList.toggle("pending", pending);
		const messages = {
			idle: __("Not run yet"),
			loading: __("Fetching data from the server…"),
			pending: __("Criteria changed: run the report to fetch the data again"),
			missing: __("Please set filters"),
			error: __("The last run failed"),
		};
		const msg = text || messages[kind] || "";
		const icon = pending || kind === "error" ? icons.alert() : kind === "fresh" && msg ? icons.check() : "";
		this.$(".rv-server-note").innerHTML = msg ? `${icon}<span>${esc(msg)}</span>` : "";
	}

	// Filters changed: before the first run the report runs by itself (like query-report);
	// after it, the bar shows the pending state until the user runs the report.
	on_filters_changed() {
		if (!this.has_run) {
			this.schedule_run();
			return;
		}
		this.update_pending();
	}

	request_refresh() {
		this.on_filters_changed();
	}

	update_pending() {
		if (!this.filters || !this.has_run) return;
		const same = JSON.stringify(this.filters.get_values()) === JSON.stringify(this.last_filters);
		if (!same) this.set_note("pending");
		else if (this.last_error) this.set_note("error");
		else this.set_note("fresh", this.fresh_note());
	}

	fresh_note() {
		if (!this.report) return "";
		return __("Data is up to date · {0} rows from the server", [format_int(this.report.rows.length)]);
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
		this.has_run = false;
		this.run_token += 1;
		warm_up();
		await this.close_session();
		this.page.set_title(__(name));
		this.header.set_report({ name });
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
		this.header.set_report({
			name,
			module: this.meta.report?.module,
			report_type: this.meta.report?.report_type,
			can_export: Boolean(this.meta.perms?.can_export),
			can_print: Boolean(this.meta.perms?.can_print),
		});
		if (frappe.breadcrumbs && this.meta.report?.module) frappe.breadcrumbs.add(this.meta.report.module);

		const params = new URLSearchParams(window.location.search);
		const from_url = decode_state(params.get("rv"));
		this.state = sanitize(from_url || default_state(this.config), this.config);
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
		this._run_timer = setTimeout(() => this.run(), 300);
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
				this.set_note("missing");
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
		this.has_run = true;
		this.last_error = false;
		this.last_filters = values;
		this.set_note("loading");
		this.header.set_meta({ filters: values, running: true });
		this.show_loading();
		this.status.clear();
		try {
			const res = await api.run(this.report_name, values, this.filters.js_filters(), this.prepared_report_name);
			if (token !== this.run_token) return;
			await this.handle_response(res.message, res.server_messages, values, token);
		} catch (e) {
			if (token === this.run_token) {
				this.last_error = true;
				this.show_error(e);
				this.header.set_meta({ filters: values });
			}
		} finally {
			if (token === this.run_token) this.update_pending();
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
			this.header.set_meta({ filters: values });
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
		const report = normalize(
			{
				raw: res.raw,
				filters: values,
				report_settings: this.report_settings,
				register: this.config,
				server_messages,
			},
			{ translate: __ }
		);
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
		this.run_at = frappe.format(frappe.datetime.now_datetime(), { fieldtype: "Datetime" }, { inline: true });
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
			this.header.set_meta({ filters: this.last_filters, run_at: this.run_at });
			return;
		}
		if (!session) return;
		const token = ++this.render_token;
		let opened;
		try {
			opened = await session.open(this.state, this.state.mode);
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
		this.result = { mode, currency: single_currency(opened.totals.currencies) };
		this.header.set_meta({ filters: this.last_filters, currency: this.result.currency, run_at: this.run_at });
		this.overlay.hide();
		// What the view state asks for and the screen does not do is said, once, not dropped.
		this.notices.show(describe_notices(opened.post.notices, report.columns));
		this.refresh_controls();
		await this.grid.show({
			report,
			opened,
			session,
			state: this.state,
			config: this.config,
			fmt: this.formatter,
		});
		if (previous) await session.close_view(previous);
		if (this.opened === opened) {
			this.update_status(opened.counts);
			await this.update_summary(opened, session);
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
			noun: this.config.rows_label,
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
