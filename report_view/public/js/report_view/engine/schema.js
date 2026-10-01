// N8: explicit Perspective schema and value conversion (docs/architecture.md §3.2أ).
// Pure module: no frappe, no DOM, no Perspective. Perspective never infers a type: every
// value is converted to the type of its column, or to null, before it is loaded.

export const RID = "__rid";
export const KIND = "__kind";
export const SORT_PREFIX = "__sort__";
export const BATCH_ROWS = 50000;

const FLOAT_TYPES = new Set(["Currency", "Float", "Percent", "Duration", "Int"]);
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?$/;

/** Perspective type of a Frappe fieldtype. Int is loaded as float: integer is int32 and wraps. */
export function perspective_type(fieldtype) {
	if (FLOAT_TYPES.has(fieldtype)) return "float";
	if (fieldtype === "Date") return "date";
	if (fieldtype === "Datetime") return "datetime";
	if (fieldtype === "Check") return "boolean";
	return "string";
}

function valid_ymd(y, m, d) {
	const t = new Date(Date.UTC(y, m - 1, d));
	return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function to_float(value) {
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (typeof value !== "string") return null;
	const text = value.trim();
	if (!text) return null;
	const n = Number(text);
	return Number.isFinite(n) ? n : null;
}

/** "YYYY-MM-DD" (a datetime string gives its date part), or null. */
export function to_date(value) {
	if (typeof value !== "string") return null;
	const head = value.length > 10 && /[ T]/.test(value[10]) ? value.slice(0, 10) : value;
	const m = DATE_RE.exec(head);
	if (!m) return null;
	return valid_ymd(Number(m[1]), Number(m[2]), Number(m[3])) ? head : null;
}

/** Milliseconds since the epoch, reading the naive site datetime as UTC, or null. */
export function to_datetime(value) {
	if (typeof value !== "string") return null;
	const m = DATETIME_RE.exec(value.trim());
	if (!m) return null;
	const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const [h, mi, s] = [Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)];
	if (!valid_ymd(y, mo, d) || h > 23 || mi > 59 || s > 59) return null;
	const ms = m[7] ? Math.floor(Number(`0.${m[7]}`) * 1000) : 0;
	return Date.UTC(y, mo - 1, d, h, mi, s, ms);
}

export function to_boolean(value) {
	if (value === true || value === 1 || value === "1") return true;
	if (value === false || value === 0 || value === "0") return false;
	return null;
}

export function to_string(value) {
	if (value === null || value === undefined || value === "") return null;
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		const parts = value.map(to_string).filter((v) => v !== null);
		return parts.length ? parts.join(", ") : null;
	}
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

const CONVERT = {
	float: to_float,
	date: to_date,
	datetime: to_datetime,
	boolean: to_boolean,
	string: to_string,
};

export function convert(type, value) {
	return CONVERT[type](value);
}

/** Row keys that hold the currency of a measure without being a report column (N1.7). */
export function aux_currency_keys(columns) {
	const keys = new Set(columns.map((c) => c.key));
	const out = [];
	for (const c of columns) {
		const key = c.currency?.kind === "row" ? c.currency.key : null;
		if (key && !keys.has(key) && !out.includes(key)) out.push(key);
	}
	return out;
}

/**
 * Float sort keys of a string column: the rank of every value in Intl.Collator order.
 * Perspective sorts strings by code unit, not by the rules of the language. Empty values
 * rank last.
 */
export function sort_keys(values, collator) {
	const unique = [...new Set(values.filter((v) => v !== null))].sort(collator.compare);
	const rank = new Map(unique.map((v, i) => [v, i]));
	return values.map((v) => (v === null ? unique.length : rank.get(v)));
}

export function make_collator(locale) {
	return new Intl.Collator(locale || undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Schema and columnar data of one Perspective table.
 *
 * @param {Array} columns NormalizedReport.columns
 * @param {Array} rows rows to load (normalized rows: facts or tree nodes)
 * @param {object} [opts]
 * @param {string} [opts.locale] language of the sort keys
 * @param {Array<{name: string, type: string, values: Array}>} [opts.extras] technical
 *   columns already computed for these rows (tree columns, N9)
 * @returns {{schema: object, data: object, size: number}}
 */
export function build_table_input(columns, rows, opts = {}) {
	const collator = make_collator(opts.locale);
	const schema = {};
	const data = {};
	const add = (name, type, values) => {
		if (Object.hasOwn(schema, name)) throw new Error(`report_view: duplicate engine column "${name}"`);
		schema[name] = type;
		data[name] = values;
	};

	for (const c of columns) {
		const type = perspective_type(c.fieldtype);
		const values = rows.map((r) => convert(type, r[c.key]));
		add(c.key, type, values);
		if (type === "string") add(SORT_PREFIX + c.key, "float", sort_keys(values, collator));
	}
	for (const key of aux_currency_keys(columns)) {
		add(key, "string", rows.map((r) => to_string(r[key])));
	}
	add(RID, "float", rows.map((r) => r.__rid));
	add(KIND, "string", rows.map((r) => r.__kind));
	for (const extra of opts.extras || []) add(extra.name, extra.type, extra.values);
	return { schema, data, size: rows.length };
}

/** Columnar batches of at most `size` rows (peak memory of the load, §8). */
export function* batches(data, total, size = BATCH_ROWS) {
	for (let start = 0; start < total; start += size) {
		const batch = {};
		for (const [name, values] of Object.entries(data)) batch[name] = values.slice(start, start + size);
		yield batch;
	}
}
