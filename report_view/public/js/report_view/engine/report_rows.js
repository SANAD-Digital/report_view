// The report's own summary rows in a report without a tree (opening / closing /
// internal_total / group_header, N3) and the "rows as reported" table (docs/architecture.md
// §3.2أ N9). Pure module. Summary rows never enter the facts table, so they take no part in
// grouping, filtering or totals.
//
// Two sorts of summary rows:
// - the rows of the whole report: its opening before the first fact, its closing and total
//   after the last one. They are shown pinned above and below the grid body;
// - the rows of the report's own groups, between the facts (General Ledger "by account": an
//   opening, a total and a closing per account). A report that has them is shown from the
//   rows table, every row in its place, while the user neither filters, groups nor sorts.
//
// Which rows stand for the whole report is read from the order of the kinds alone, never from
// the separators (a report may have none):
// - opening: the first opening before the first fact. When the report's groups carry an
//   opening of their own (an opening after the first fact), the first group has one too: the
//   report has its own only if at least two openings stand before the first fact;
// - closing / total: the summary rows after the last fact, without the rows that close the
//   last group. Those are as many, and of the same kinds, as the rows that close the group
//   before it (the summary rows right after a fact, between two facts).

const SEPARATOR = "separator";
const TAIL = new Set(["closing", "internal_total"]);
const SUMMARY = new Set(["opening", "closing", "internal_total", "group_header"]);

// Kinds of the rows that close a group of the report: the summary rows right after a fact, in
// the last place where facts stand on both sides.
function group_tail(between) {
	for (let i = between.length - 1; i > 0; i--) {
		if (between[i].__kind !== "data" || between[i - 1].__kind === "data") continue;
		let start = i - 1;
		while (start > 0 && between[start - 1].__kind !== "data") start -= 1;
		const kinds = [];
		for (let j = start; j < i && TAIL.has(between[j].__kind); j++) kinds.push(between[j].__kind);
		if (kinds.length) return kinds;
	}
	return [];
}

/**
 * @returns {{top: number[], bottom: number[], reference: number|null, inner: number}} __rid
 *   of the opening row pinned above, of the closing / total rows pinned below, of the
 *   reference total row (ADR-008: the last internal_total) when it closes the report, and the
 *   number of summary rows of the report's own groups (between the facts).
 */
export function edge_rows(normalized) {
	const none = { top: [], bottom: [], reference: null, inner: 0 };
	if (normalized.tree?.enabled) return none;
	const rows = (normalized.rows || []).filter((r) => r.__kind !== SEPARATOR);
	const first = rows.findIndex((r) => r.__kind === "data");
	if (first < 0) return none;
	let last = first;
	for (let i = rows.length - 1; i > first; i--) {
		if (rows[i].__kind === "data") {
			last = i;
			break;
		}
	}
	const between = rows.slice(first, last + 1);

	const leading = rows.slice(0, first).filter((r) => r.__kind === "opening");
	const groups_open = between.some((r) => r.__kind === "opening");
	const top = leading.length >= (groups_open ? 2 : 1) ? [leading[0]] : [];

	const trailing = rows.slice(last + 1).filter((r) => TAIL.has(r.__kind));
	const tail = group_tail(between);
	let own = 0;
	while (own < tail.length && own < trailing.length && trailing[own].__kind === tail[own]) own += 1;
	const closing = trailing.slice(own);

	const reference_row = normalized.report_totals?.internal?.at(-1) || null;
	const reference = reference_row && closing.some((r) => r.__rid === reference_row.__rid) ? reference_row.__rid : null;
	const bottom = closing.filter((r) => r.__rid !== reference);
	const shown = top.length + bottom.length + (reference === null ? 0 : 1);
	const all = rows.filter((r) => SUMMARY.has(r.__kind)).length;
	return {
		top: top.map((r) => r.__rid),
		bottom: bottom.map((r) => r.__rid),
		reference,
		inner: all - shown,
	};
}

/**
 * Input of the rows table: every row of the report in its order and with its kind, without
 * the separators. Null for a tree report (N9: nodes table) and for a report whose facts have
 * no summary rows between them (the facts table shows all of it).
 * @returns {{rows: Array, edges: object}|null}
 */
export function build_report_rows(normalized) {
	const edges = edge_rows(normalized);
	if (!edges.inner) return null;
	return { rows: normalized.rows.filter((r) => r.__kind !== SEPARATOR), edges };
}
