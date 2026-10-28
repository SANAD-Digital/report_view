// The page's side of a cell range (phase 5c and 5d): the numbers of the status bar, the context
// menu (right click; a long press on touch), the clipboard, the export of the selection, the
// chart of a range, the document of a link (link_open), the row details and the configured
// drill. Methods of ReportViewPage (installed by index.js, as host/pages_host.js).
//
// Every value comes from GridView.range_data (the engine's to_columns of the range window);
// the count, sum and average are queries.range_stats_of over the rows the documented rule
// keeps (state/range.js countable_rows).

import { range_stats_of } from "../engine/queries.js";
import { rect_cells, to_tsv, to_html_table, export_file_name } from "../state/range.js";
import { drill_rules, rules_for_row, link_open_of } from "../state/drill.js";
import { document_of } from "../state/row_details.js";
import { open_popover, menu_content, close_popover } from "../components/popover.js";
import { icons } from "../components/icons.js";
import { Drawer } from "../components/drawer.js";
import { DrillPanel } from "./drill_host.js";
import { download_blob, esc } from "../util.js";
import { error_text } from "../api.js";

// The status bar waits this long after the last change of the range before it reads the engine.
const STATS_DEBOUNCE_MS = 60;

export class RangeHost {
	/** Wires the grid's range to the page (make_dom). */
	setup_range() {
		const grid = this.grid;
		grid.on_range = (r) => this.range_status(r);
		grid.on_range_menu = (at) => this.open_range_menu(at);
		grid.on_copy = (o) => this.copy_range(o);
		grid.on_link = (l) => this.open_link(l);
		this.range_token = 0;
		this.drill = null;
	}

	/** The report's settings came (get_meta): range selection and drill as its features say. */
	configure_range(meta) {
		this.grid.range_enabled = this.features.range_selection;
		if (!this.features.range_selection) this.grid.clear_range();
		this.drill_rules = this.features.drill ? drill_rules(meta?.settings?.drilldowns) : [];
		this.link_open = link_open_of(meta?.settings);
	}

	// ------------------------------------------------------------ status bar

	range_status(r) {
		const token = ++this.range_token;
		clearTimeout(this._range_timer);
		if (!r || rect_cells(r) < 2) {
			this.range_stats = null;
			this.range_stats_token = token;
			this.status.set_range(null);
			return;
		}
		this._range_timer = setTimeout(() => this.read_range_stats(r, token), STATS_DEBOUNCE_MS);
	}

	async read_range_stats(r, token) {
		let data;
		try {
			data = await this.grid.range_data(r);
		} catch (e) {
			if (token !== this.range_token) return;
			this.range_stats_token = token;
			this.status.set_range(null);
			frappe.show_alert?.({ message: __("The selection could not be read: {0}", [error_text(e)]), indicator: "orange" });
			return;
		}
		if (token !== this.range_token) return;
		this.range_stats_token = token;
		if (!data) return;
		const numeric = data.columns.map((d, i) => (d.numeric ? i : -1)).filter((i) => i >= 0);
		const stats = range_stats_of(
			numeric.map((i) => data.rows.map((row) => row.cells[i])),
			data.countable
		);
		const column = numeric.length ? data.columns[numeric[0]].column : null;
		const text = (v) => (v === null || !column ? "—" : this.formatter.number_text(column, v));
		this.range_stats = stats;
		this.status.set_range({
			cells: rect_cells(r),
			count: stats.count,
			sum: stats.count ? text(stats.sum) : null,
			avg: stats.count ? text(stats.avg) : null,
		});
	}

	// ------------------------------------------------------------ clipboard and export

	/** The range as rows of cells, with the column titles (copy, export). */
	async range_table(r) {
		const data = await this.grid.range_data(r);
		if (!data) return null;
		const m = this.grid.model;
		const title = (d) => {
			if (d.head === 0) return m.label_title;
			const band = d.band && m.bands?.get?.(d.band)?.label;
			return band && band.trim() ? `${band} · ${d.title}` : d.title;
		};
		return { headers: data.columns.map(title), rows: data.rows.map((row) => row.cells), count: data.rows.length };
	}

	/**
	 * Copies the range: raw values as tab-separated text (Excel keeps the columns and the
	 * numbers) and a plain HTML table (a rich paste). The clipboard is written in the press
	 * itself with the values to come (ClipboardItem of promises), as every browser asks.
	 */
	copy_range({ headers = false } = {}) {
		const r = this.grid.range_rect();
		if (!r) return Promise.resolve(false);
		const table = this.range_table(r);
		const tsv = table.then((t) => (t ? to_tsv(t.rows, headers ? t.headers : null) : ""));
		const html = table.then((t) => (t ? to_html_table(t.rows, headers ? t.headers : null) : ""));
		const clip = navigator.clipboard;
		let written;
		if (clip?.write && typeof ClipboardItem !== "undefined") {
			const item = new ClipboardItem({
				"text/plain": tsv.then((s) => new Blob([s], { type: "text/plain" })),
				"text/html": html.then((s) => new Blob([s], { type: "text/html" })),
			});
			written = clip.write([item]).catch(() => tsv.then((s) => clip.writeText(s)));
		} else if (clip?.writeText) written = tsv.then((s) => clip.writeText(s));
		else written = Promise.reject(new Error(__("The browser gives no access to the clipboard")));
		this.last_copy = { tsv, html };
		return Promise.all([written, table])
			.then(([, t]) => {
				frappe.show_alert?.({ message: __("{0} rows copied", [t?.count ?? 0]), indicator: "green" });
				return true;
			})
			.catch((e) => {
				frappe.show_alert?.({ message: __("Could not copy: {0}", [error_text(e)]), indicator: "red" });
				return false;
			});
	}

	/** The range as a TSV file (UTF-8 with its mark, so Excel reads Arabic text). */
	async export_range() {
		const r = this.grid.range_rect();
		if (!r || !this.meta?.perms?.can_export) return;
		const t = await this.range_table(r);
		if (!t) return;
		const text = `\ufeff${to_tsv(t.rows, t.headers)}`;
		download_blob(new Blob([text], { type: "text/tab-separated-values;charset=utf-8" }), export_file_name(this.report_name));
	}

	// ------------------------------------------------------------ context menu

	/** The report row at a display row, when it is one (not a group, a total or a spacer). */
	report_row_at(y) {
		const rec = this.grid.rec_at(y);
		return rec && rec.type === "row" && !this.grid.rows.is_summary(rec) ? { rec, row: rec.row } : null;
	}

	/** The document a cell opens: the cell's link, else the row's own document. */
	document_at(row, c) {
		const d = this.grid.range_columns()[c];
		const doc = d && this.link_document(d.column, row);
		if (doc) return doc;
		const conf = this.row_details?.conf?.() || null;
		return document_of(conf, row, this.grid.model?.label);
	}

	open_range_menu(at) {
		const grid = this.grid;
		const r = grid.range_rect();
		if (!r) return;
		const found = this.report_row_at(at.y_row);
		const row = found?.row || null;
		const data_cols = grid.range_columns().slice(r.c0, r.c1 + 1);
		const items = [
			{ key: "copy", label: __("Copy"), icon: icons.copy(), hint: frappe.utils?.is_mac?.() ? "⌘C" : "Ctrl+C", act: () => (close_popover(), this.copy_range()) },
			{ key: "copy-headers", label: __("Copy with headers"), icon: icons.copy(), act: () => (close_popover(), this.copy_range({ headers: true })) },
		];
		if (this.meta?.perms?.can_export) items.push({ key: "export", label: __("Export selection"), icon: icons.download(), act: () => (close_popover(), this.export_range()) });
		if (this.features.charts) {
			const numeric = data_cols.some((d) => d.numeric);
			items.push({
				key: "chart",
				label: __("Chart from range"),
				icon: icons.chart(),
				disabled: !numeric,
				title: numeric ? "" : __("Select numeric cells to chart them"),
				act: () => (close_popover(), this.chart_range()),
			});
		}
		const row_items = [];
		if (row) {
			const doc = this.document_at(row, at.c);
			if (doc) row_items.push({ key: "open-doc", label: __("Open {0}", [__(doc.doctype)]), icon: icons.open(), act: () => (close_popover(), this.open_document(doc)) });
			if (this.row_details?.enabled?.()) {
				row_items.push({ key: "row-details", label: __("Row details", null, "Report View"), icon: icons.columns(), act: () => (close_popover(), this.row_details.open({ y: at.y_row, row, opener: grid.rt })) });
			}
			for (const rule of rules_for_row(this.drill_rules, row, this.report?.columns)) {
				row_items.push({ key: "drill", label: __("Drill to {0}", [__(rule.label)]), icon: icons.drill(), act: () => (close_popover(), this.open_drill(rule, row)) });
			}
		}
		if (row_items.length) items.push({ sep: true }, ...row_items);
		const content = menu_content(items);
		const pop = open_popover({ root: this.root, anchor: grid.rt, content, cls: "rv-ctx", width: 248, role: "menu", label: __("Cell actions"), at: { x: at.x, y: at.y } });
		pop.el.querySelector(".rv-mi:not(:disabled)")?.focus({ preventScroll: true });
	}

	// ------------------------------------------------------------ links and documents (5d)

	/** {doctype, name} of the value of a Link or Dynamic Link column in a row, or null. */
	link_document(column, row) {
		const link = column?.link;
		const name = row?.[column?.key];
		if (!link || typeof name !== "string" || !name) return null;
		let doctype = null;
		if (link.kind === "static") doctype = link.doctype;
		else if (link.kind === "dynamic") doctype = row[link.doctype_key];
		else if (link.kind === "filter") doctype = this.last_filters?.[link.filter];
		return typeof doctype === "string" && doctype ? { doctype, name } : null;
	}

	/** A link in the grid was pressed: its document opens as link_open says. */
	open_link({ column, row, event }) {
		const doc = this.link_document(column, row);
		if (!doc) return false;
		// a press with a modifier opens a new tab whatever the setting (the browser's own way)
		const how = event?.ctrlKey || event?.metaKey || event?.button === 1 ? "new_tab" : this.link_open;
		this.open_document(doc, how);
		return true;
	}

	form_link(doc) {
		return frappe.utils?.get_form_link ? frappe.utils.get_form_link(doc.doctype, doc.name) : `/app/${encodeURIComponent(frappe.router?.slug?.(doc.doctype) || doc.doctype)}/${encodeURIComponent(doc.name)}`;
	}

	open_document(doc, how = this.link_open) {
		if (how === "same_tab") frappe.set_route("Form", doc.doctype, doc.name);
		else if (how === "drawer") this.open_doc_drawer(doc);
		else window.open(this.form_link(doc), "_blank", "noopener");
	}

	/** The document in a drawer: its fields as Frappe gives them to the user (frappe.client.get). */
	async open_doc_drawer(doc) {
		const drawer = new Drawer({ root: this.root, title: doc.name, subtitle: __(doc.doctype), width: "medium", cls: "rv-docdrawer" });
		drawer.set_actions([{ label: __("Open {0}", [__(doc.doctype)]), href: this.form_link(doc), primary: true, key: "open-form" }]);
		drawer.state(__("Loading…"));
		try {
			const [record] = await Promise.all([frappe.db.get_doc(doc.doctype, doc.name), new Promise((resolve) => frappe.model.with_doctype(doc.doctype, resolve))]);
			if (!drawer.is_open) return;
			const meta = frappe.get_meta(doc.doctype);
			const skip = new Set(["Section Break", "Column Break", "Tab Break", "HTML", "Button", "Table", "Table MultiSelect", "Image", "Attach Image", "Fold", "Heading", "Password", "Code", "Text Editor", "HTML Editor", "Markdown Editor", "Geolocation", "Signature", "JSON"]);
			const fields = (meta?.fields || []).filter((df) => !skip.has(df.fieldtype) && !df.hidden && record[df.fieldname] !== null && record[df.fieldname] !== undefined && record[df.fieldname] !== "");
			const dl = fields
				.map((df) => `<dt>${esc(__(df.label || df.fieldname))}</dt><dd>${frappe.format(record[df.fieldname], df, { inline: true }, record)}</dd>`)
				.join("");
			drawer.body.innerHTML = `<section class="rv-rd-sec"><dl class="rv-rd-fields">${dl}</dl></section>`;
		} catch (e) {
			if (drawer.is_open) drawer.state(__("The document could not be shown"), error_text(e), "err");
		}
	}

	// ------------------------------------------------------------ chart from range (5d)

	async chart_range() {
		const r = this.grid.range_rect();
		if (!r || !this.features.charts) return;
		if (!window.report_view?.RangeChart) await frappe.require("report_view_charts.bundle.js");
		const grid = this.grid;
		const fmt = this.formatter;
		const chart = new report_view.RangeChart({
			root: this.root,
			rtl: this.rtl,
			types: this.features.chart_types.filter((t) => t !== "kpi"),
			title: __(this.report_name),
			// the chart's own view of the range (deleted when the chart closes) and its rows
			read: () => grid.range_data(r, { own_view: true }),
			label_of: (row, d) => {
				const rec = row.rec;
				if (rec.type === "foot") return __("Total {0}", [grid.rows.foot_text(rec.of)]);
				if (rec.type === "group") return grid.rows.foot_text(rec);
				return fmt.node_text(grid.model.label, rec.row, grid.model.parts);
			},
			value_text: (column, v) => (v === null || v === undefined ? "—" : fmt.number_text(column, v)),
			release: (view) => (view && this.session?.handles.is_alive(view) ? this.session.handles.delete(view) : null),
		});
		this.range_chart = chart;
		await chart.ready;
	}

	// ------------------------------------------------------------ drill (5d)

	/** «Drill to <label>» of a row: the target report in a drawer (host/drill_host.js). */
	open_drill(rule, row) {
		if (!this.features.drill) return null;
		if (this.drill) this.drill.close();
		this.drill = new DrillPanel(this, rule, row, this.last_filters);
		return this.drill;
	}

	/** The drill rules a row of the row details panel offers (its footer). */
	drill_actions(row) {
		return rules_for_row(this.drill_rules || [], row, this.report?.columns).map((rule) => ({
			label: __("Drill to {0}", [__(rule.label)]),
			act: () => this.open_drill(rule, row),
		}));
	}
}
