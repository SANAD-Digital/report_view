// Aggregation rules shared by group subtotals and grand totals (ADR-008).
// Same rules as frappe.utils.report_column_total: Int -> cint sum, Percent -> mean,
// other numeric types -> flt sum. Pure module.

export function flt(v) {
	if (v === null || v === undefined || v === "") return 0;
	const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
	return Number.isFinite(n) ? n : 0;
}

export function cint(v) {
	const n = parseInt(v, 10);
	return Number.isFinite(n) ? n : 0;
}

// Removes binary float noise (0.1 + 0.2) without losing integer precision on large sums.
export function clean(n) {
	return typeof n === "number" && Number.isFinite(n) ? parseFloat(n.toPrecision(15)) : n;
}

export function numeric_value(column, v) {
	return column.fieldtype === "Int" ? cint(v) : flt(v);
}

export function row_currency_key(column) {
	return column.currency?.kind === "row" ? column.currency.key : null;
}

/**
 * Aggregate one measure over a list of rows.
 * Returns a number, null (nothing to aggregate / aggregation disabled) or {mixed: true}.
 */
export function aggregate(column, rows) {
	if (!column.agg || column.original?.disable_total) return null;
	if (!rows.length) return null;
	const ckey = row_currency_key(column);
	if (ckey && column.agg !== "count") {
		const currencies = new Set();
		for (const r of rows) if (r[ckey]) currencies.add(r[ckey]);
		if (currencies.size > 1) return { mixed: true };
	}
	switch (column.agg) {
		case "count":
			return rows.length;
		case "avg": {
			let s = 0;
			for (const r of rows) s += flt(r[column.key]);
			return clean(s / rows.length);
		}
		case "min":
		case "max": {
			let out = null;
			for (const r of rows) {
				const v = r[column.key];
				if (v === null || v === undefined || v === "") continue;
				const n = numeric_value(column, v);
				if (out === null || (column.agg === "min" ? n < out : n > out)) out = n;
			}
			return out;
		}
		default: {
			let s = 0;
			for (const r of rows) s += numeric_value(column, r[column.key]);
			return clean(s);
		}
	}
}

// The single currency shared by the rows for each row-currency key, or null when mixed/absent.
export function shared_currencies(columns, rows) {
	const out = {};
	for (const c of columns) {
		const ckey = row_currency_key(c);
		if (!ckey || ckey in out) continue;
		const set = new Set();
		for (const r of rows) if (r[ckey]) set.add(r[ckey]);
		out[ckey] = set.size === 1 ? [...set][0] : null;
	}
	return out;
}
