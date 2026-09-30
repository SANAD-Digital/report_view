// Browser-side filters over facts (view_state.filters, docs/architecture.md §7.1). Pure module.

function norm(v) {
	return String(v ?? "").toLocaleLowerCase();
}

function text_match(value, f) {
	const a = norm(value);
	const b = norm(f.value);
	switch (f.op) {
		case "equals":
			return a === b;
		case "starts_with":
			return a.startsWith(b);
		case "not_contains":
			return !a.includes(b);
		default:
			return a.includes(b);
	}
}

function make_predicate(f, columns) {
	if (f.key === "*") {
		const keys = columns.filter((c) => c.role !== "attribute").map((c) => c.key);
		return (row) => keys.some((k) => text_match(row[k], f));
	}
	switch (f.type) {
		case "set": {
			const values = new Set((f.values || []).map((v) => (v === null ? null : String(v))));
			return (row) => {
				const v = row[f.key];
				const hit = values.has(v === null || v === undefined || v === "" ? null : String(v));
				return f.exclude ? !hit : hit;
			};
		}
		case "range":
			return (row) => {
				const v = Number(row[f.key]);
				if (!Number.isFinite(v)) return false;
				if (f.min !== null && f.min !== undefined && v < f.min) return false;
				if (f.max !== null && f.max !== undefined && v > f.max) return false;
				return true;
			};
		case "date":
			return (row) => {
				const v = row[f.key] ? String(row[f.key]).slice(0, 10) : null;
				if (!v) return false;
				if (f.from && v < f.from) return false;
				if (f.to && v > f.to) return false;
				return true;
			};
		default:
			return (row) => text_match(row[f.key], f);
	}
}

export function has_filters(filters) {
	return Array.isArray(filters) && filters.length > 0;
}

export function filter_rows(rows, filters, columns) {
	if (!has_filters(filters)) return rows;
	const preds = filters.map((f) => make_predicate(f, columns));
	return rows.filter((r) => preds.every((p) => p(r)));
}
