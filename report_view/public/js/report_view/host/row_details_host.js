// The page's side of the row details (ADR-023): the panel (components/row_details.js) fed with
// the rows of the grid, the report's columns and formatter, its settings (get_meta
// .settings.row_details) and the server's rendering of a template. index.js makes it once
// and sets the config after get_meta (configure).

import { RowDetails } from "../components/row_details.js";
import { api } from "../api.js";
import { columns_payload, detail_columns, document_of, pick_tiles, row_details_config, row_payload } from "../state/row_details.js";

const FORMAT_OPTS = { inline: true, always_show_decimals: true };

/** A value of a column as frappe.format shows it (the drawer's fields and tiles). */
export function field_html(column, row) {
	const value = row[column.key];
	if (value === null || value === undefined || value === "") return "";
	if (Array.isArray(value)) return frappe.utils.escape_html(value.join(", "));
	return String(frappe.format(value, { ...(column.original || {}), fieldtype: column.fieldtype }, FORMAT_OPTS, row) ?? "");
}

/**
 * @param {object} page the ReportViewPage (index.js)
 * @returns {{panel: RowDetails, configure: (meta: object) => object, open: (at: object) => void}}
 */
export function make_row_details(page) {
	let conf = row_details_config(null);
	const grid = page.grid;
	const describe = (row) => {
		const m = grid.model;
		const fmt = page.formatter;
		const report = page.report;
		const cols = detail_columns(m, report.columns, { title: (c) => (report.__report_type === "Query Report" ? __(c.label) : c.label) });
		const cell = (d) => {
			const html = field_html(d.column, row);
			return { label: d.label, html, numeric: d.numeric, sign: d.numeric ? fmt.sign_of(d.column, row) : "" };
		};
		const parts = m.parts;
		const name = parts?.name_key ? row[parts.name_key] : null;
		return {
			subtitle: __(page.report_name),
			code: parts?.number_key && name ? String(row[parts.number_key] ?? "") : "",
			title: name ? String(name) : fmt.node_text(m.label, row, null),
			tiles: conf.content === "fields" ? pick_tiles(cols).map(cell) : [],
			fields: conf.content === "fields" ? cols.map(cell) : [],
			document: document_of(conf, row, m.label),
		};
	};
	const filters = () => {
		try {
			return page.filters?.get_values?.(false) || {};
		} catch {
			return {};
		}
	};
	const panel = new RowDetails({
		root: page.root,
		rtl: page.rtl,
		source: {
			conf: () => conf,
			describe,
			step: (y, dir) => grid.step_row(y, dir),
			mark: (y) => grid.mark_details(y),
			focus_row: (y) => grid.focus_details(y),
			render: (row) => api.render_row_details(page.report_name, row_payload(row, page.report.columns), filters(), columns_payload(page.report.columns)),
			extra: (row) => page.drill_actions?.(row) || [],
		},
	});
	grid.on_relayout = () => panel.reset();
	return {
		panel,
		configure(meta) {
			conf = row_details_config(meta?.row_details || meta?.settings?.row_details);
			grid.details = conf.enabled;
			panel.reset();
			return conf;
		},
		open(at) {
			if (conf.enabled && page.report) panel.open(at);
		},
		/** Whether a report row offers its details now. */
		enabled: () => Boolean(conf.enabled && page.report),
		conf: () => conf,
	};
}
