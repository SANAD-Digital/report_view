// The report's raw answer for frappe.query_report.raw_data (ADR-006), without holding its
// rows twice (B7). The page keeps the answer of `run` without `result` (the rows) once they
// are normalised; `result` is rebuilt from the normalised rows when a report script asks for
// raw_data, as the server sent it: dict rows with their own keys (the page's own `__` keys,
// the enrichment's columns and the keys of repeated fieldnames left out; a label the
// classification unquoted quoted again), list rows as lists, Frappe's total row last.

/**
 * What is kept of an answer once its rows are normalised: the answer without `result`, and
 * which rows were lists. Null for no answer.
 * @returns {{meta: object, lists: Uint8Array|null, total_len: number|null}|null}
 */
export function keep_raw(raw) {
	if (!raw || typeof raw !== "object") return null;
	const { result, ...meta } = raw;
	const rows = Array.isArray(result) ? result : [];
	let lists = null;
	for (let i = 0; i < rows.length; i++) {
		if (!Array.isArray(rows[i])) continue;
		lists ||= new Uint8Array(rows.length);
		lists[i] = 1;
	}
	const last = rows[rows.length - 1];
	return { meta, lists, total_len: Array.isArray(last) ? last.length : null };
}

/** `result` of the raw answer, rebuilt from the normalised report (adapter/normalize.js). */
export function rebuild_result(kept, report) {
	const columns = (report?.columns || []).filter((c) => !c.enriched);
	const dims = columns.filter((c) => c.role === "dimension");
	// keys the page adds to a row: the enrichment's columns, a repeated fieldname's own key
	const added = new Set((report?.columns || []).filter((c) => c.enriched || c.key !== c.fieldname).map((c) => c.key));
	const rows = report?.rows || [];
	const out = new Array(rows.length);
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		// the label the classification unquoted ('Opening' → Opening): quoted again
		const raw_label = typeof row.__label_raw === "string" ? row.__label_raw : null;
		const label_col = raw_label === null ? null : dims.find((c) => row[c.key] === raw_label.slice(1, -1)) || null;
		if (kept?.lists?.[i]) {
			const list = [];
			for (const c of columns) list[c.source_index] = c === label_col ? raw_label : row[c.key];
			out[i] = list;
			continue;
		}
		const dict = {};
		for (const k in row) {
			if (k.startsWith("__") || added.has(k)) continue;
			dict[k] = row[k];
		}
		if (label_col) dict[label_col.key] = raw_label;
		out[i] = dict;
	}
	const total = report?.report_totals?.frappe_total;
	if (total && kept?.total_len !== null && kept?.total_len !== undefined) {
		const list = new Array(kept.total_len).fill(null);
		for (const c of columns) if (c.source_index < kept.total_len) list[c.source_index] = total[c.key] ?? null;
		out.push(list);
	}
	return out;
}

/**
 * raw_data of a page: rebuilt on first read, then kept as long as the browser keeps it
 * (a WeakRef: memory is given back when no report script holds it). Bound to one report.
 */
export function raw_data_cache() {
	let ref = null;
	let for_report = null;
	return (kept, report) => {
		if (!kept) return null;
		const cached = for_report === report ? ref?.deref() : null;
		if (cached) return cached;
		const full = { ...kept.meta, result: rebuild_result(kept, report) };
		ref = typeof WeakRef === "function" ? new WeakRef(full) : { deref: () => full };
		for_report = report;
		return full;
	};
}
