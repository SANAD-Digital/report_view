// Configured drill (phase 5d; Report View Settings «Drill»): «Drill to <label>» of a row opens a
// drawer with the target report as a compact Report View grid. The target goes through the same
// path as the page: get_meta (its own permission check), its script, the same `api.run` with
// the user's own permissions (a refusal is shown, nothing is opened instead), the adapter, a
// Perspective session of its own and the same GridView. Closing the drawer deletes its views
// and tables (session.close).

import { api, error_text } from "../api.js";
import { get_config } from "../register.js";
import { normalize_async } from "../adapter/normalize.js";
import { get_engine, ReportSession } from "../engine/perspective_engine.js";
import { toggle_tree_node } from "../engine/view_config.js";
import { default_state, sanitize, reconcile } from "../state/view_state.js";
import { sanitize_features, server_config } from "../state/features.js";
import { map_filters, drill_href } from "../state/drill.js";
import { load_report_settings } from "../filters/report_filters.js";
import { make_formatter } from "../format.js";
import { GridView } from "../views/grid_view.js";
import { HeaderCells } from "../components/header_cells.js";
import { Drawer } from "../components/drawer.js";
import { session_lang } from "../util.js";
import { ERROR_TITLES } from "./error_titles.js";

/** The filters of the target report the JS of its script declares (sent as js_filters). */
function js_filters_of(settings) {
	return (settings?.filters || [])
		.filter((d) => d && d.fieldname && d.fieldtype !== "Break")
		.map((d) => ({ fieldname: d.fieldname, fieldtype: d.fieldtype, options: typeof d.options === "string" ? d.options : null }));
}

export class DrillPanel {
	/**
	 * @param {object} page the ReportViewPage
	 * @param {object} rule a state/drill.js rule
	 * @param {object} row the report row drilled from
	 * @param {object} [filters] the page's filters (the last run's)
	 */
	constructor(page, rule, row, filters) {
		this.page = page;
		this.rule = rule;
		this.row = row;
		this.filters = map_filters(rule, row, filters || {}, page.report?.columns || []);
		this.session = null;
		this.grid = null;
		this.closed = false;
		const caption = page.formatter && page.grid.model ? page.formatter.node_text(page.grid.model.label, row, page.grid.model.parts) : "";
		this.drawer = new Drawer({
			root: page.root,
			title: __(rule.label),
			subtitle: caption,
			width: "wide",
			cls: "rv-drill",
			on_close: () => this.close(),
		});
		this.drawer.set_actions([{ label: __("Open in Report View"), href: drill_href(rule.report, this.filters), target: "_blank", primary: true, key: "open-report" }]);
		this.drawer.state(__("Loading…"));
		this.drawer.el.dataset.report = rule.report;
		this.ready = this.load().catch((e) => this.fail(e));
	}

	fail(e) {
		if (this.closed) return;
		const exc = e?.exc_type || null;
		const title = (ERROR_TITLES[exc] || (() => __("The drill could not be opened")))();
		this.drawer.el.dataset.state = "error";
		this.drawer.state(title, error_text(e), "err");
	}

	async load() {
		const report_name = this.rule.report;
		const meta = await api.get_meta(report_name);
		if (this.closed) return;
		if (meta.settings && meta.settings.enabled === false) {
			this.drawer.state(__("This report is not enabled in Report View"));
			return;
		}
		const report_settings = await load_report_settings(report_name, meta.script);
		const res = await api.run(report_name, this.filters, js_filters_of(report_settings), null);
		if (this.closed) return;
		const out = res.message || {};
		if (out.status && out.status !== "ok") {
			const text = out.status === "too_large" ? __("Too many rows for Report View") : __("No prepared result for these filters");
			this.drawer.el.dataset.state = out.status;
			this.drawer.state(text);
			return;
		}
		const features = sanitize_features(meta.settings?.features);
		const config = server_config(get_config(report_name), meta.settings, features, false);
		const report = await normalize_async(
			{ raw: out.raw, filters: this.filters, report_settings, register: config, server_messages: res.server_messages },
			{ translate: __ }
		);
		if (this.closed) return;
		report.__report_type = meta.report?.report_type;
		if (!report.rows.length) {
			this.drawer.el.dataset.state = "empty";
			this.drawer.state(__("No results"), __("Nothing matches these filters."));
			return;
		}
		const state = sanitize(default_state(config), config);
		state.mode = "grid";
		reconcile(state, report.columns);
		this.report = report;
		this.config = config;
		this.state = state;
		this.fmt = make_formatter({ report_settings, columns: report.columns });
		const { handles } = await get_engine();
		const session = await ReportSession.create(handles, report, { locale: session_lang(), quick_filters: config.quick_filters || [] });
		if (this.closed) {
			await session.close();
			return;
		}
		this.session = session;
		const wrap = document.createElement("div");
		wrap.className = "rv compact rv-drill-grid";
		wrap.dir = this.page.root.dir;
		const grid_el = document.createElement("div");
		grid_el.className = "rv-grid";
		wrap.append(grid_el);
		this.drawer.body.replaceChildren(wrap);
		this.drawer.body.classList.add("rv-drill-body");
		const cells = new HeaderCells({
			kind: () => null,
			sort_of: (key) => this.state.sort.find((s) => s.key === key)?.dir || null,
			filter_of: () => null,
			set_label: () => "",
			draggable: () => false,
			on_sort: (key) => this.sort(key),
			on_menu: () => {},
			on_filter: () => {},
			on_set: () => {},
		});
		cells.floating = false;
		this.grid = new GridView({
			parent: grid_el,
			rtl: this.page.rtl,
			cells,
			on_tree_toggle: (rid) => {
				this.state.tree.expanded = toggle_tree_node(this.state, this.report, rid);
				this.render();
			},
		});
		this.grid.range_enabled = false;
		await this.render();
		this.drawer.el.dataset.state = "ready";
		this.drawer.el.dataset.rows = String(report.rows.length);
	}

	sort(key) {
		const now = this.state.sort.find((s) => s.key === key)?.dir || null;
		this.state.sort = now === "asc" ? [{ key, dir: "desc" }] : now === "desc" ? [] : [{ key, dir: "asc" }];
		this.render();
	}

	async render() {
		const session = this.session;
		if (!session || this.closed) return;
		const opened = await session.open(this.state, "grid");
		if (!opened) return;
		if (this.closed || session !== this.session) {
			await session.close_view(opened);
			return;
		}
		const previous = this.opened;
		this.opened = opened;
		try {
			await this.grid.show({ report: this.report, opened, session, state: this.state, config: this.config, fmt: this.fmt });
		} finally {
			if (previous) await session.close_view(previous);
		}
	}

	/** The drawer closed (or the page left): the grid goes, every view and table is deleted. */
	async close() {
		if (this.closed) return;
		this.closed = true;
		if (this.drawer.is_open) this.drawer.close();
		this.grid?.destroy();
		this.grid = null;
		const session = this.session;
		this.session = null;
		this.opened = null;
		if (session) await session.close();
		if (this.page.drill === this) this.page.drill = null;
	}
}
