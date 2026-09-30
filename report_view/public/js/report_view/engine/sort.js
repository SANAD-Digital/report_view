// Sorting (view_state.sort). Strings use Intl.Collator so Arabic sorts correctly. Pure module.

import { MEASURE_TYPES } from "../adapter/columns.js";

export function make_compare(locale) {
	const collator = new Intl.Collator(locale || undefined, { numeric: true, sensitivity: "base" });
	return (a, b) => {
		if (typeof a === "number" && typeof b === "number") return a - b;
		return collator.compare(String(a ?? ""), String(b ?? ""));
	};
}

export function sort_rows(rows, sort, columns, compare) {
	if (!Array.isArray(sort) || !sort.length) return rows;
	const by_key = new Map(columns.map((c) => [c.key, c]));
	const specs = sort
		.filter((s) => by_key.has(s.key))
		.map((s) => ({ key: s.key, dir: s.dir === "desc" ? -1 : 1, numeric: MEASURE_TYPES.has(by_key.get(s.key).fieldtype) }));
	if (!specs.length) return rows;
	return [...rows].sort((x, y) => {
		for (const s of specs) {
			let a = x[s.key];
			let b = y[s.key];
			const a_empty = a === null || a === undefined || a === "";
			const b_empty = b === null || b === undefined || b === "";
			if (a_empty || b_empty) {
				if (a_empty && b_empty) continue;
				return a_empty ? 1 : -1;
			}
			if (s.numeric) {
				a = Number(a);
				b = Number(b);
			}
			const r = compare(a, b);
			if (r) return r * s.dir;
		}
		return x.__rid - y.__rid;
	});
}
