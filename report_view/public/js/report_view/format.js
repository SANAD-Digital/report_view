// Cell formatting (docs/architecture.md §9.3). Numbers, dates and currencies go through
// frappe.format with {inline: true}; the report's own formatter is used for the rows the
// report produced, never for rows built by the engine (groups, grand total).

const ORIGINAL_KINDS = new Set(["data", "internal_total", "opening", "closing"]);
const FORMAT_OPTS = { inline: true, always_show_decimals: true };

export function make_formatter({ report_settings, columns }) {
	const report_formatter =
		typeof report_settings?.formatter === "function" ? report_settings.formatter : null;
	const df_cache = new Map();
	const df_of = (column) => {
		if (!df_cache.has(column.key)) {
			// Canonical fieldtype (N1.3) so "float" still formats as a number.
			df_cache.set(column.key, { ...column.original, fieldtype: column.fieldtype });
		}
		return df_cache.get(column.key);
	};
	const by_key = new Map(columns.map((c) => [c.key, c]));

	const default_formatter = (value, row, column, data) =>
		frappe.format(value, { ...column, fieldtype: by_key.get(column.fieldname)?.fieldtype || column.fieldtype }, FORMAT_OPTS, data);

	const wrap_number = (html, column) =>
		column.role === "measure" ? `<bdi class="rv-n">${html}</bdi>` : html;

	function value_html(column, row) {
		const value = row[column.key];
		if (row.__mixed?.[column.key]) {
			return `<span class="rv-mixed" title="${frappe.utils.escape_html(
				__("Mixed currencies: no total")
			)}">—</span>`;
		}
		if (report_formatter && ORIGINAL_KINDS.has(row.__kind) && !column.enriched) {
			const out = report_formatter(value, null, column.original, row, default_formatter);
			return wrap_number(out ?? "", column);
		}
		if (value === null || value === undefined || value === "") return "";
		if (Array.isArray(value)) return frappe.utils.escape_html(value.join(", "));
		return wrap_number(frappe.format(value, df_of(column), FORMAT_OPTS, row), column);
	}

	// Label of an engine group row: the group value formatted with its own column.
	function group_label_html(row) {
		const column = by_key.get(row.__group_key);
		const value = row.__group_value;
		const text =
			value === null || value === undefined || value === ""
				? `<span class="rv-muted">${__("Not Set")}</span>`
				: column
				? frappe.format(value, df_of(column), FORMAT_OPTS, row)
				: frappe.utils.escape_html(String(value));
		return `<span class="rv-glabel">${text}</span><span class="rv-gcount">${row.__count}</span>`;
	}

	return { value_html, group_label_html, default_formatter };
}
