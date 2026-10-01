// The report's own summary rows in a report without a tree (opening / closing /
// internal_total, N3). Pure module. They never enter the facts table, so they take no part
// in grouping, filtering or totals; the ones that stand for the whole report are shown pinned
// above and below the grid body, as the report returned them.
//
// Which rows stand for the whole report: the summary rows before the first fact and after the
// last one, cut at the nearest separator (General Ledger "by account" starts with the report's
// opening, a separator, then the opening of the first account). The summary rows between the
// facts belong to the report's own grouping and are not shown on screen.

const SUMMARY = new Set(["opening", "closing", "internal_total"]);

/**
 * @returns {{top: number[], bottom: number[], reference: number|null, inner: number}} __rid
 *   of the opening rows pinned above, of the closing / total rows pinned below, of the
 *   reference total row (ADR-008: the last internal_total) when it closes the report, and the
 *   number of summary rows that are not shown.
 */
export function edge_rows(normalized) {
	const none = { top: [], bottom: [], reference: null, inner: 0 };
	if (normalized.tree?.enabled) return none;
	const rows = normalized.rows || [];
	const first = rows.findIndex((r) => r.__kind === "data");
	if (first < 0) return none;
	let last = first;
	for (let i = rows.length - 1; i > first; i--) {
		if (rows[i].__kind === "data") {
			last = i;
			break;
		}
	}
	let lead_end = first;
	for (let i = 0; i < first; i++) {
		if (rows[i].__kind === "separator") {
			lead_end = i;
			break;
		}
	}
	let trail_start = last + 1;
	for (let i = rows.length - 1; i > last; i--) {
		if (rows[i].__kind === "separator") {
			trail_start = i + 1;
			break;
		}
	}
	const top = rows.slice(0, lead_end).filter((r) => r.__kind === "opening");
	const trailing = rows.slice(trail_start).filter((r) => r.__kind === "closing" || r.__kind === "internal_total");
	const reference_row = normalized.report_totals?.internal?.at(-1) || null;
	const reference = reference_row && trailing.some((r) => r.__rid === reference_row.__rid) ? reference_row.__rid : null;
	const bottom = trailing.filter((r) => r.__rid !== reference);
	const shown = top.length + bottom.length + (reference === null ? 0 : 1);
	const all = rows.filter((r) => SUMMARY.has(r.__kind)).length;
	return {
		top: top.map((r) => r.__rid),
		bottom: bottom.map((r) => r.__rid),
		reference,
		inner: all - shown,
	};
}
