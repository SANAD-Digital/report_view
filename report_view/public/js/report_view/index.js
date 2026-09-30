// Report View page (/desk/report-view/<report_name>, ADR-005).
// Flow: get_meta -> report script -> filters -> api.run -> adapter -> enrichment -> engine -> grid.

import { api } from "./api.js";
import { register, get_config } from "./register.js";
import { normalize } from "./adapter/normalize.js";
import { enrich_batches, apply_enrichment } from "./adapter/enrich.js";
import { create_engine } from "./engine/engine.js";
import { default_state, sanitize, reconcile } from "./state/view_state.js";
import { decode_state, make_url_updater } from "./state/url.js";
import { load_report_settings, ReportFilters, MissingFiltersError } from "./filters/report_filters.js";
import { install_facade, make_facade } from "./filters/facade.js";
import { make_formatter } from "./format.js";
import { GridView } from "./views/grid_view.js";
import { StateOverlay } from "./components/states.js";

const RESERVED_PARAMS = new Set(["rv", "view", "prepared_report_name"]);

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
		this.make_dom();
		this.watch_theme();
		$(wrapper).on("hide", () => this.hide());
	}

	make_dom() {
		const root = document.createElement("div");
		root.className = "rv";
		root.dir = this.rtl ? "rtl" : "ltr";
		root.innerHTML = `
			<div class="rv-shell">
				<div class="rv-server">
					<div class="rv-filters"></div>
					<div class="rv-server-actions">
						<span class="rv-server-note"></span>
						<button type="button" class="rv-btn primary" data-action="run">${esc(__("Refresh"))}</button>
					</div>
				</div>
				<div class="rv-message"></div>
				<div class="rv-toolbar">
					<span class="rv-toolbar-lbl">${esc(__("Group by"))}</span>
					<div class="rv-group"></div>
					<div class="rv-toolbar-end">
						<span class="rv-count"></span>
						<button type="button" class="rv-btn" data-action="export" hidden>${esc(__("Excel"))}</button>
					</div>
				</div>
				<div class="rv-gridwrap"><div class="rv-grid"></div></div>
			</div>`;
		this.page.main.get(0).replaceChildren(root);
		this.root = root;
		this.$ = (sel) => root.querySelector(sel);
		this.overlay = new StateOverlay(this.$(".rv-gridwrap"));
		this.grid = new GridView({ parent: this.$(".rv-grid"), rtl: this.rtl });
		this.$('[data-action="run"]').addEventListener("click", () => this.run());
		this.$('[data-action="export"]').addEventListener("click", () => this.export_xlsx());
	}

	// The theme follows the Desk theme of the user (§7.1).
	watch_theme() {
		const apply = () => {
			const theme = document.documentElement.getAttribute("data-theme");
			this.root.classList.toggle("dark", theme === "dark");
		};
		apply();
		this.theme_observer = new MutationObserver(apply);
		this.theme_observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme"],
		});
	}

	show() {
		this.restore_facade = install_facade(this);
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
		}
	}

	hide() {
		if (this.restore_facade) this.restore_facade();
		this.restore_facade = null;
	}

	async load(name) {
		this.report_name = name;
		this.report = null;
		this.raw = null;
		this.page.set_title(__(name));
		this.overlay.loading();
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
		this.$('[data-action="export"]').hidden = !this.meta.perms?.can_export;

		const params = new URLSearchParams(window.location.search);
		const from_url = decode_state(params.get("rv"));
		this.state = sanitize(from_url || default_state(this.config), this.config);
		this.prepared_report_name = route_options.prepared_report_name || null;

		this.filters = new ReportFilters({
			parent: this.$(".rv-filters"),
			host: this,
			defs: this.report_settings.filters || [],
			on_change: () => this.schedule_run(),
		});
		const filter_options = Object.fromEntries(
			Object.entries(route_options).filter(([k]) => !RESERVED_PARAMS.has(k))
		);
		await this.filters.set_route_values(filter_options);
		this.make_group_control();

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

	make_group_control() {
		const parent = this.$(".rv-group");
		parent.replaceChildren();
		this.group_control = frappe.ui.form.make_control({
			df: {
				fieldtype: "MultiSelectList",
				fieldname: "rv_group_by",
				label: __("Group by"),
				placeholder: __("Group by"),
				get_data: () => this.group_options(),
				onchange: () => {
					const by = (this.group_control.get_value() || []).filter(Boolean);
					if (JSON.stringify(by) === JSON.stringify(this.state.group.by)) return;
					this.state.group.by = by;
					this.render();
				},
			},
			parent,
			only_input: true,
		});
		this.group_control.refresh();
		if (this.state.group.by.length) this.group_control.set_value(this.state.group.by);
	}

	group_options() {
		if (!this.report) return [];
		return this.report.columns
			.filter((c) => c.role === "dimension")
			.map((c) => ({ value: c.key, label: c.label, description: "" }));
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
				this.$(".rv-server").classList.add("pending");
				this.$(".rv-server-note").textContent = __("Please set filters");
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
		this.$(".rv-server").classList.remove("pending");
		this.$(".rv-server-note").textContent = "";
		this.last_filters = values;
		this.overlay.loading();
		this.$(".rv-count").textContent = "";
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
		this.report = report;
		reconcile(this.state, report.columns);
		this.engine = create_engine(report, { locale: frappe.boot.lang });
		this.formatter = make_formatter({ report_settings: this.report_settings, columns: report.columns });
		this.$(".rv-message").innerHTML = report.message ? frappe.dom.remove_script_and_style(String(report.message)) : "";
		await this.render();
	}

	async enrich(report) {
		const rules = this.meta.settings?.enrich_rules || [];
		for (const rule of rules) {
			const source = report.columns.find((c) => c.key === rule.source_column);
			if (!source || source.link?.kind !== "static" || !rule.fields?.length) continue;
			const values = {};
			let fields = [...rule.fields];
			try {
				for (const names of enrich_batches(report, rule.source_column)) {
					const r = await api.enrich(this.report_name, rule.source_column, rule.link_doctype, names, fields);
					Object.assign(values, r.rows || {});
					const dropped = new Set(r.dropped_fields || []);
					fields = fields.filter((f) => !dropped.has(f));
				}
			} catch (e) {
				frappe.show_alert({ message: __("Extra columns could not be loaded: {0}", [e.message]), indicator: "orange" });
				continue;
			}
			apply_enrichment(report, rule, values, fields, (f) => __(frappe.unscrub(f)));
		}
	}

	async render() {
		if (!this.report) return;
		const report = this.report;
		if (!report.rows.length) {
			this.grid.destroy();
			const notes = report.notices.filter((n) => n.code === "SERVER_MESSAGE").map((n) => n.detail);
			this.overlay.show({
				kind: "empty",
				icon: "∅",
				title: __("No results"),
				text: notes.length ? frappe.utils.html2text(notes.join("\n")) : __("Nothing matches these filters."),
			});
			this.$(".rv-count").textContent = "";
			return;
		}
		this.result = this.engine.apply(this.state);
		this.overlay.hide();
		await this.grid.render(report, this.result, this.state, this.config, this.formatter);
		this.$(".rv-count").innerHTML = __("{0} rows", [`<b>${format_int(this.result.row_count)}</b>`]);
		this.update_url(this.last_filters, this.state);
	}

	show_error(e) {
		const exc = e?.exc_type || null;
		const title = (ERROR_TITLES[exc] || (() => __("Something went wrong")))();
		this.grid.destroy();
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
		const cols = this.grid.visible_columns(this.report, this.state);
		return {
			version: 1,
			format: "xlsx",
			filters: this.last_filters,
			js_filters: this.filters.js_filters(),
			prepared_report_name: this.prepared_report_name,
			view_state: { ...this.state, report_filters: this.last_filters },
			scope: "all",
			selection: null,
			expected: this.engine.expected(this.result),
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
		if (!this.result) return;
		const btn = this.$('[data-action="export"]');
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

	// Raw values read by the Playwright test: engine totals of the current view.
	debug_totals() {
		return this.result ? { mode: this.result.mode, totals: this.engine.expected(this.result).totals } : null;
	}
}

function format_int(n) {
	return frappe.format(n, { fieldtype: "Int" }, { inline: true });
}

frappe.provide("report_view");
Object.assign(window.report_view, { register, get_config, ReportViewPage });
