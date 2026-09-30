// N1: column normalisation (docs/architecture.md §3.2 and "N1 values fixed in phase 3").
// Pure module: no frappe, no DOM. Twin of report_view/core/normalize.py (_build_columns).

export const MEASURE_TYPES = new Set(["Currency", "Float", "Int", "Percent", "Duration"]);
export const DIMENSION_TYPES = new Set([
	"Link",
	"Dynamic Link",
	"Data",
	"Select",
	"Date",
	"Datetime",
	"Check",
]);
const DATE_TYPES = new Set(["Date", "Datetime"]);
const ROLES = new Set(["dimension", "measure", "attribute"]);
const AGGS = new Set(["sum", "avg", "count", "min", "max"]);

// Canonical Frappe field types, used to repair case ("float" -> "Float").
export const FIELDTYPES = [
	"Autocomplete",
	"Attach",
	"Attach Image",
	"Barcode",
	"Button",
	"Check",
	"Code",
	"Color",
	"Column Break",
	"Currency",
	"Data",
	"Date",
	"Datetime",
	"Duration",
	"Dynamic Link",
	"Float",
	"Fold",
	"Geolocation",
	"Heading",
	"HTML",
	"HTML Editor",
	"Icon",
	"Image",
	"Int",
	"JSON",
	"Link",
	"Long Text",
	"Markdown Editor",
	"Password",
	"Percent",
	"Phone",
	"Rating",
	"Read Only",
	"Section Break",
	"Select",
	"Signature",
	"Small Text",
	"Tab Break",
	"Table",
	"Table MultiSelect",
	"Text",
	"Text Editor",
	"Time",
];
const FIELDTYPE_BY_LOWER = new Map(FIELDTYPES.map((ft) => [ft.toLowerCase(), ft]));

// A Link whose options look like a fieldname refers to a report filter (N1.8).
const FILTER_OPTION_RE = /^[a-z_][a-z0-9_]*$/;
const COMPANY_CURRENCY_RE = /^Company:([^:]+):default_currency$/;

export function scrub(txt) {
	return String(txt ?? "")
		.replace(/ /g, "_")
		.replace(/-/g, "_")
		.toLowerCase();
}

// Same rule as frappe.desk.query_report.get_column_as_dict (Q:1094-1117).
export function column_as_dict(col) {
	if (typeof col === "string") {
		const parts = col.split(":");
		const out = {};
		if (parts.length > 1) {
			const slash = parts[1].indexOf("/");
			if (slash >= 0) {
				out.fieldtype = parts[1].slice(0, slash);
				out.options = parts[1].slice(slash + 1);
			} else {
				out.fieldtype = parts[1];
			}
			if (parts.length === 3) out.width = parts[2];
		}
		out.label = parts[0];
		out.fieldname = scrub(parts[0]);
		return out;
	}
	const out = { ...(col || {}) };
	if (!out.fieldname) out.fieldname = scrub(out.label);
	return out;
}

function canonical_fieldtype(value, fieldname, notices) {
	if (value === null || value === undefined || value === "") return "Data";
	const v = String(value);
	if (FIELDTYPES.includes(v)) return v;
	const fixed = FIELDTYPE_BY_LOWER.get(v.toLowerCase());
	if (fixed) {
		notices.push({ code: "FIELDTYPE_CASE", detail: fieldname });
		return fixed;
	}
	notices.push({ code: "FIELDTYPE_UNKNOWN", detail: fieldname });
	return v;
}

function int_or_null(value) {
	if (value === null || value === undefined || value === "") return null;
	const n = Number.parseFloat(value);
	return Number.isFinite(n) ? Math.trunc(n) : null;
}

function is_hidden(v) {
	return Boolean(v) && !["0", "False", "false"].includes(String(v));
}

function currency_of(options, fieldnames, row_keys) {
	if (options) {
		if (fieldnames.has(options) || row_keys.has(options)) return { kind: "row", key: options };
		const m = COMPANY_CURRENCY_RE.exec(String(options));
		if (m) return { kind: "company", company_key: m[1] };
	}
	return { kind: "system" };
}

function link_of(col, filters) {
	const options = col.options;
	if (!options) return null;
	if (col.fieldtype === "Dynamic Link") return { kind: "dynamic", doctype_key: options };
	if (col.fieldtype === "Link") {
		if ((filters && Object.hasOwn(filters, options)) || FILTER_OPTION_RE.test(String(options))) {
			return { kind: "filter", filter: options };
		}
		return { kind: "static", doctype: options };
	}
	return null;
}

/**
 * @param {Array} raw_columns columns as returned by the report (dicts or strings)
 * @param {object} ctx {filters, report_settings, register, first_row}
 *        first_row = first non-empty dict row of the response (N1.7, list values).
 * @returns {{columns: Array, notices: Array}}
 */
export function normalize_columns(raw_columns, ctx = {}) {
	const notices = [];
	const seen = new Map();
	const export_hidden_cols = ctx.report_settings?.export_hidden_cols === true;

	const columns = (raw_columns || []).map((raw, source_index) => {
		const col = column_as_dict(raw);
		const fieldname = col.fieldname;
		const n = (seen.get(fieldname) || 0) + 1;
		seen.set(fieldname, n);
		const key = n === 1 ? fieldname : `${fieldname}__${n}`;
		const fieldtype = canonical_fieldtype(col.fieldtype, fieldname, notices);
		const hidden = is_hidden(col.hidden);
		return {
			key,
			fieldname,
			label: col.label ?? fieldname,
			fieldtype,
			options: col.options === undefined || col.options === "" ? null : col.options,
			width: int_or_null(col.width),
			hidden,
			export_hidden: hidden && export_hidden_cols,
			role: null,
			agg: null,
			currency: null,
			link: null,
			date: DATE_TYPES.has(fieldtype),
			source_index,
			original: col,
		};
	});

	const fieldnames = new Set(columns.map((c) => c.fieldname));
	const first_row = ctx.first_row || null;
	const row_keys = new Set(first_row ? Object.keys(first_row) : []);
	const currency_refs = new Set();
	for (const c of columns) {
		if (c.fieldtype === "Currency") {
			c.currency = currency_of(c.options, fieldnames, row_keys);
			if (c.currency.kind === "row") currency_refs.add(c.currency.key);
		}
		c.link = link_of(c, ctx.filters);
	}

	const list_valued = new Set(
		Object.entries(first_row || {})
			.filter(([, v]) => Array.isArray(v))
			.map(([k]) => k)
	);
	const overrides = ctx.register?.columns || {};
	for (const c of columns) {
		const ft = c.fieldtype;
		let role;
		if (c.hidden || currency_refs.has(c.fieldname) || list_valued.has(c.fieldname)) role = "attribute";
		else if (MEASURE_TYPES.has(ft)) role = "measure";
		else if (DIMENSION_TYPES.has(ft)) role = "dimension";
		else role = "attribute";
		let agg = role === "measure" ? (ft === "Percent" ? "avg" : "sum") : null;
		const ov = overrides[c.fieldname] || {};
		if (ROLES.has(ov.role)) {
			role = ov.role;
			if (role !== "measure") agg = null;
			else if (agg === null) agg = ft === "Percent" ? "avg" : "sum";
		}
		if (Object.hasOwn(ov, "agg") && (AGGS.has(ov.agg) || ov.agg === null)) agg = ov.agg;
		c.role = role;
		c.agg = agg;
	}
	return { columns, notices };
}
