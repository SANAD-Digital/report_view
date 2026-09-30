// N3: row classification (docs/architecture.md §3.2). Pure module.
// Twin of report_view/core/normalize.py (_classify_rows).

export const KINDS = [
	"data",
	"frappe_total",
	"internal_total",
	"opening",
	"closing",
	"group_header",
	"separator",
];

export function has_value(v) {
	return v !== null && v !== undefined && v !== "";
}

function is_nonzero_measure(v) {
	if (!has_value(v)) return false;
	if (typeof v === "boolean") return v;
	if (typeof v === "number") return v !== 0;
	return true;
}

function is_quoted(v) {
	return typeof v === "string" && v.length >= 2 && v.startsWith("'") && v.endsWith("'");
}

function num(v) {
	if (typeof v === "boolean" || v === null || v === undefined || v === "") return 0;
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
}

/**
 * Classify every row in place (sets __kind, __bold, __label_raw and strips the
 * quotes from the matched label column).
 * ctx: {columns, label_key, tree_enabled, register, translate}
 */
export function classify_rows(rows, ctx) {
	const t = ctx.translate || ((s) => s);
	const dims = ctx.columns.filter((c) => c.role === "dimension").map((c) => c.key);
	const measures = ctx.columns.filter((c) => c.role === "measure").map((c) => c.key);
	const label_key = ctx.label_key;
	// The label column first, then every other dimension (GL keeps 'Opening' in `account`,
	// AR keeps "Total" in `party`).
	const label_scan = (label_key ? [label_key] : []).concat(dims.filter((k) => k !== label_key));
	// English is what the fixtures and the server compare; the translated forms cover
	// reports that quote _("Opening") in the session language.
	const opening = new Set(["Opening", t("Opening")]);
	const closing = new Set(["Closing (Opening + Total)", t("Closing (Opening + Total)")]);
	const total_words = new Set(["Total", t("Total")]);
	const header_key = ctx.register?.group_header_key;
	const custom = ctx.register?.classify_row;

	rows.forEach((row, rid) => {
		row.__rid = rid;
		row.__bold = Boolean(row.bold);
		row.__label_raw = null;
		let kind = null;

		// N3.1 separator: no dimension value and no non-zero measure.
		if (!dims.some((k) => has_value(row[k])) && !measures.some((k) => is_nonzero_measure(row[k]))) {
			kind = "separator";
		}

		// N3.2 quoted label.
		if (kind === null) {
			for (const key of label_scan) {
				const value = row[key];
				if (is_quoted(value)) {
					const label = value.slice(1, -1);
					row.__label_raw = value;
					row[key] = label;
					if (opening.has(label)) kind = "opening";
					else if (closing.has(label)) kind = "closing";
					else kind = "internal_total";
					break;
				}
			}
		}

		// N3.3 bold total without quotes.
		if (kind === null && row.__bold && label_scan.some((k) => total_words.has(row[k]))) {
			kind = "internal_total";
		}

		// N3.4 custom classifier (JS only: functions do not reach the server).
		if (kind === null && typeof custom === "function") {
			const k = custom(row, { index: rid, rows, columns: ctx.columns });
			if (k && KINDS.includes(k)) kind = k;
		}

		// N3.5 group header in tree reports: no indent, next row indented.
		if (kind === null && ctx.tree_enabled && (row.indent === null || row.indent === undefined)) {
			const next = rows[rid + 1];
			if (next && num(next.indent) > 0) kind = "group_header";
		}

		// N3.6 group header without indent (only with at least one measure column).
		if (kind === null && measures.length) {
			if (header_key) {
				const others = dims.concat(measures).filter((k) => k !== header_key);
				if (has_value(row[header_key]) && !others.some((k) => has_value(row[k]))) {
					kind = "group_header";
				}
			} else if (
				!measures.some((k) => has_value(row[k])) &&
				dims.filter((k) => has_value(row[k])).length === 1
			) {
				kind = "group_header";
			}
		}

		row.__kind = kind || "data";
	});

	// N3.7 exception: in a flat report with an unquoted bold "Total" (N3.3), other bold
	// data rows are the report's own subtotals (AR group_by_party), not facts.
	if (!ctx.tree_enabled) {
		const has_bold_total = rows.some(
			(r) => r.__kind === "internal_total" && r.__bold && r.__label_raw === null
		);
		if (has_bold_total) {
			for (const r of rows) if (r.__kind === "data" && r.__bold) r.__kind = "internal_total";
		}
	}
}

export { num };
