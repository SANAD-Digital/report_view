// Cell formatting (docs/architecture.md §9.3). Numbers, dates and currencies go through
// frappe.format with {inline: true}; the report's own formatter is used for the rows the
// report produced, never for rows Perspective computed (groups, grand total).
// Display rules of the design (§11.1 #51): a zero shows "—" (class .zero), a negative value
// gets .neg. The precision stays the one of System Settings (the zero test uses it too).

const ORIGINAL_KINDS = new Set(["data", "internal_total", "opening", "closing"]);
const FORMAT_OPTS = { inline: true, always_show_decimals: true };
const NUMERIC_TYPES = new Set(["Currency", "Float", "Int", "Percent"]);

function esc(s) {
	return frappe.utils.escape_html(String(s ?? ""));
}

// Decimals Frappe uses to show a value of this column (same fallbacks as
// frappe.form.formatters.Currency / Float).
function precision_of(df) {
	if (df.fieldtype === "Int") return 0;
	const own = parseInt(df.precision, 10);
	if (Number.isFinite(own)) return own;
	const sys = frappe.boot?.sysdefaults || {};
	if (df.fieldtype === "Currency") return parseInt(sys.currency_precision, 10) || 2;
	const float = parseInt(sys.float_precision, 10);
	if (float) return float;
	if (typeof window.get_number_format_info === "function" && typeof window.get_number_format === "function") {
		return window.get_number_format_info(window.get_number_format()).precision;
	}
	return 2;
}

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

	/**
	 * Sign of a numeric cell as shown: "zero" when it rounds to 0 at the system precision,
	 * "neg" when negative, "" otherwise or for non-numeric values.
	 */
	function sign_of(column, row) {
		if (column.role !== "measure" || !NUMERIC_TYPES.has(column.fieldtype)) return "";
		if (row.__mixed?.[column.key]) return "";
		const value = row[column.key];
		if (value === null || value === undefined || value === "") return "";
		const n = typeof value === "number" ? value : Number(value);
		if (!Number.isFinite(n)) return "";
		if (Math.abs(n) < 0.5 * 10 ** -precision_of(df_of(column))) return "zero";
		return n < 0 ? "neg" : "";
	}

	function value_html(column, row) {
		const value = row[column.key];
		if (row.__mixed?.[column.key]) {
			return `<span class="rv-mixed" title="${esc(__("Mixed currencies: no total"))}">—</span>`;
		}
		if (sign_of(column, row) === "zero") return `<bdi class="rv-n">—</bdi>`;
		if (report_formatter && ORIGINAL_KINDS.has(row.__kind) && !column.enriched) {
			const out = report_formatter(value, null, column.original, row, default_formatter);
			return wrap_number(out ?? "", column);
		}
		if (value === null || value === undefined || value === "") return "";
		if (Array.isArray(value)) return esc(value.join(", "));
		return wrap_number(frappe.format(value, df_of(column), FORMAT_OPTS, row), column);
	}

	/**
	 * Label cell of a report row as "number + name" (design .rv-acc), when the register
	 * names the two fields (tree.number_key / tree.name_key). A link produced by the
	 * report's formatter (ERPNext opens the General Ledger) is kept, with the name as text.
	 */
	function label_html(column, row, parts) {
		const html = value_html(column, row);
		if (!parts?.name_key) return html;
		const name = row[parts.name_key];
		if (!name) return html;
		const number = parts.number_key ? row[parts.number_key] : null;
		const tpl = document.createElement("template");
		tpl.innerHTML = html;
		const link = tpl.content.querySelector("a");
		let name_html;
		if (link) {
			link.textContent = name;
			link.classList.add("rv-accname");
			name_html = link.outerHTML;
		} else {
			name_html = `<span class="rv-accname">${esc(name)}</span>`;
		}
		const no = number ? `<bdi class="rv-accno">${esc(number)}</bdi>` : "";
		return `<span class="rv-acc">${no}${name_html}</span>`;
	}

	// Label of a group that stands for a node of the report tree (re-grouped tree): the
	// node's number and name as text; the report's formatter is for report rows only.
	function node_label_html(column, row, parts) {
		const name = parts?.name_key ? row[parts.name_key] : null;
		if (name) {
			const number = parts.number_key ? row[parts.number_key] : null;
			const no = number ? `<bdi class="rv-accno">${esc(number)}</bdi>` : "";
			return `<span class="rv-acc">${no}<span class="rv-accname">${esc(name)}</span></span>`;
		}
		const value = row[column.key];
		const text =
			value === null || value === undefined || value === ""
				? `<span class="rv-muted">${esc(__("Not Set"))}</span>`
				: esc(Array.isArray(value) ? value.join(", ") : value);
		return `<span class="rv-glabel">${text}</span>`;
	}

	// Label of an engine group row: the group value formatted with its own column.
	function group_label_html(row) {
		const column = by_key.get(row.__group_key);
		const value = row.__group_value;
		const text =
			value === null || value === undefined || value === ""
				? `<span class="rv-muted">${esc(__("Not Set"))}</span>`
				: column
				? frappe.format(value, df_of(column), FORMAT_OPTS, row)
				: esc(value);
		return `<span class="rv-glabel">${text}</span>${count_html(row.__count)}`;
	}

	function count_html(n) {
		if (n === null || n === undefined) return "";
		return `<span class="rv-gcount">${esc(frappe.format(n, { fieldtype: "Int" }, { inline: true }))}</span>`;
	}

	return { value_html, label_html, node_label_html, group_label_html, count_html, sign_of, default_formatter };
}
