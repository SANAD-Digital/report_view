// N8: explicit Perspective schema and value conversion (docs/architecture.md §3.2أ).
// Pure module: no frappe, no DOM, no Perspective. Perspective never infers a type: every
// value is converted to the type of its column, or to null, before it is loaded.

export const RID = "__rid";
export const KIND = "__kind";
export const SORT_PREFIX = "__sort__";
// Rows per table.update: the client encodes a batch on the main thread (about 12 ms per
// 1,000 rows of a 40-column report), so a batch stays well under a frame's worth of work;
// the worker ingests one batch while the next is encoded (docs/architecture.md §8).
export const BATCH_ROWS = 5000;
// The main thread is given back after this much work (build_table_input_async).
const YIELD_BUDGET_MS = 40;
// Unique values above which a collator sort is done in runs, with the main thread given
// back between them: 20,000 unique strings sort in about 70 ms, 100,000 in a long freeze.
const CHUNK_SORT_ABOVE = 4096;
const SORT_RUN = 4096;

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

/** Gives the main thread back for one macrotask (input and paint happen in between). */
export function yield_to_main() {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

// A `tick` yields only once a budget of work has been spent since the last yield, so that
// a run of small steps costs no extra tasks.
export function make_ticker(budget_ms = YIELD_BUDGET_MS) {
	let last = Date.now();
	return async () => {
		if (Date.now() - last < budget_ms) return;
		await yield_to_main();
		last = Date.now();
	};
}

function merge_runs(a, b, compare) {
	const out = new Array(a.length + b.length);
	let i = 0;
	let j = 0;
	let k = 0;
	while (i < a.length && j < b.length) out[k++] = compare(a[i], b[j]) <= 0 ? a[i++] : b[j++];
	while (i < a.length) out[k++] = a[i++];
	while (j < b.length) out[k++] = b[j++];
	return out;
}

// The same order as `items.sort(compare)` (stable), in runs with the main thread given back
// between them: the comparator is the collator's and never yields itself.
async function sort_in_runs(items, compare, tick) {
	let runs = [];
	for (let start = 0; start < items.length; start += SORT_RUN) {
		runs.push(items.slice(start, start + SORT_RUN).sort(compare));
		await tick();
	}
	while (runs.length > 1) {
		const next = [];
		for (let i = 0; i < runs.length; i += 2) {
			next.push(runs[i + 1] ? merge_runs(runs[i], runs[i + 1], compare) : runs[i]);
			await tick();
		}
		runs = next;
	}
	return runs[0] || [];
}

/** sort_keys with the main thread given back while a large set of unique values is sorted. */
async function sort_keys_async(values, collator, tick) {
	const unique = [...new Set(values.filter((v) => v !== null))];
	const sorted = unique.length > CHUNK_SORT_ABOVE ? await sort_in_runs(unique, collator.compare, tick) : unique.sort(collator.compare);
	const rank = new Map(sorted.map((v, i) => [v, i]));
	return values.map((v) => (v === null ? unique.length : rank.get(v)));
}

function new_input(rows) {
	const schema = {};
	const data = {};
	const add = (name, type, values) => {
		if (Object.hasOwn(schema, name)) throw new Error(`report_view: duplicate engine column "${name}"`);
		schema[name] = type;
		data[name] = values;
	};
	return { schema, data, size: rows.length, add };
}

function add_technical(input, columns, rows, extras) {
	for (const key of aux_currency_keys(columns)) {
		input.add(key, "string", rows.map((r) => to_string(r[key])));
	}
	input.add(RID, "float", rows.map((r) => r.__rid));
	input.add(KIND, "string", rows.map((r) => r.__kind));
	for (const extra of extras || []) input.add(extra.name, extra.type, extra.values);
	const { schema, data, size } = input;
	return { schema, data, size };
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
	const input = new_input(rows);
	for (const c of columns) {
		const type = perspective_type(c.fieldtype);
		const values = rows.map((r) => convert(type, r[c.key]));
		input.add(c.key, type, values);
		if (type === "string") input.add(SORT_PREFIX + c.key, "float", sort_keys(values, collator));
	}
	return add_technical(input, columns, rows, opts.extras);
}

/**
 * build_table_input with the main thread given back between columns (and inside the sort
 * of a column with many unique values), so that no step is a freeze: the same output.
 * @param {number} [opts.budget_ms] work between two yields
 */
export async function build_table_input_async(columns, rows, opts = {}) {
	const collator = make_collator(opts.locale);
	const tick = make_ticker(opts.budget_ms);
	const input = new_input(rows);
	for (const c of columns) {
		const type = perspective_type(c.fieldtype);
		const values = rows.map((r) => convert(type, r[c.key]));
		input.add(c.key, type, values);
		await tick();
		if (type === "string") {
			input.add(SORT_PREFIX + c.key, "float", await sort_keys_async(values, collator, tick));
			await tick();
		}
	}
	return add_technical(input, columns, rows, opts.extras);
}

/** Columnar batches of at most `size` rows (peak memory of the load, §8). */
export function* batches(data, total, size = BATCH_ROWS) {
	for (let start = 0; start < total; start += size) {
		const batch = {};
		for (const [name, values] of Object.entries(data)) batch[name] = values.slice(start, start + size);
		yield batch;
	}
}
