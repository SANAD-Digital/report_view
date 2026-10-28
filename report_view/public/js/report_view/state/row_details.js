// Row details (ADR-023): what the button in the first column of a report row opens, as the
// report's settings say (get_meta.settings.row_details), and what the "Fields" content shows of
// one row: its columns labelled, and its key measures as tiles. Pure: no DOM, no Frappe call;
// the panel (components/row_details.js) formats and draws. Nothing is computed here either: a
// tile is a column of the row as the report returned it.

// Widths of the drawer (px) by the settings' Select, and of the dialog.
export const DRAWER_WIDTHS = { narrow: 420, medium: 520, wide: 720 };
export const DIALOG_WIDTHS = { narrow: 560, medium: 800, wide: 1040 };
export const MAX_TILES = 4;

const CONTAINERS = { drawer: "drawer", dialog: "dialog" };
const CONTENTS = { fields: "fields", "html template": "html", html: "html", "print format": "print_format", print_format: "print_format" };
const FIELDNAME = /^[A-Za-z0-9_]+$/;

const key_of = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");

function doc_fields(raw) {
	if (!raw || typeof raw !== "object") return null;
	const out = { doctype_field: raw.doctype_field, name_field: raw.name_field };
	return FIELDNAME.test(out.doctype_field || "") && FIELDNAME.test(out.name_field || "") ? out : null;
}

/**
 * The row details config of a report, complete and valid. Takes the server's keys
 * ({container: "drawer", content: "print_format", document: true, doc_fields: {…}}) and the
 * Select labels ("Drawer", "Print format", document: {doctype_field, name_field}). Missing:
 * on, a drawer, the fields.
 * @param {object} [raw] get_meta.settings.row_details (or get_meta.row_details)
 */
export function row_details_config(raw) {
	const r = raw && typeof raw === "object" ? raw : {};
	const width = key_of(r.width);
	const document = r.document && typeof r.document === "object" ? doc_fields(r.document) : r.document ? doc_fields(r.doc_fields) : null;
	return {
		enabled: r.enabled === undefined || r.enabled === null ? true : Boolean(Number(r.enabled) || r.enabled === true),
		container: CONTAINERS[key_of(r.container)] || "drawer",
		width: Object.hasOwn(DRAWER_WIDTHS, width) ? width : "medium",
		content: CONTENTS[key_of(r.content)] || "fields",
		print_format: typeof r.print_format === "string" && r.print_format ? r.print_format : null,
		document,
	};
}

const BALANCE = /balance|رصيد/i;
const SIDE = /(^|_)(debit|credit|dr|cr)(_|$)|debit|credit|مدين|دائن/i;
const CLOSING = /closing|ختام/i;
const OPENING = /opening|افتتاح/i;

/**
 * Rank of a measure as a key figure: balances first, then the closing side, the period's
 * debit and credit, the opening side. null: not a balance, debit or credit column.
 */
function key_rank(d) {
	const text = `${d.column.fieldname || d.column.key} ${d.column.label || ""}`;
	if (BALANCE.test(d.column.fieldname || "") || (!d.side && BALANCE.test(text))) return 0;
	if (!d.side && !SIDE.test(text)) return null;
	if (CLOSING.test(text)) return 1;
	if (OPENING.test(text)) return 3;
	return 2;
}

/**
 * The columns of a row's details, in the order the table shows them, then the report's other
 * columns the user hid (never the ones the report itself hides).
 * @param {object} model the grid's model (views/grid_rows.js build_model): label, pinned, data, bands
 * @param {Array} columns the report's normalised columns
 * @param {object} [o] {title(column): the report's label of a column the table does not show}
 * @returns {Array<{column, label, numeric, side}>}
 */
export function detail_columns(model, columns, { title = (c) => c.label } = {}) {
	const out = [];
	const seen = new Set();
	const band_label = (d) => (d.band && model.bands?.get?.(d.band)?.label) || "";
	const add = (d, label) => {
		if (seen.has(d.column.key)) return;
		seen.add(d.column.key);
		out.push({ column: d.column, label, numeric: Boolean(d.numeric), side: d.side || null });
	};
	add({ column: model.label, numeric: false }, model.label_title || title(model.label));
	for (const d of [...(model.pinned || []), ...(model.data || [])]) {
		const band = band_label(d);
		add(d, band && band.trim() ? `${band} · ${d.title}` : d.title);
	}
	for (const c of columns || []) {
		if (c.hidden || seen.has(c.key)) continue;
		add({ column: c, numeric: c.role === "measure", side: null }, title(c));
	}
	return out;
}

/**
 * The key figures of a row as tiles: the balance, debit and credit columns when the report has
 * them (the closing and period ones before the opening ones), otherwise its first numeric
 * columns; at most four, in the table's order.
 * @param {Array<{column, label, numeric, side}>} cols detail_columns()
 */
export function pick_tiles(cols, max = MAX_TILES) {
	const measures = cols.filter((d) => d.numeric);
	const keyed = measures.map((d, i) => ({ d, i, rank: key_rank(d) })).filter((x) => x.rank !== null);
	const chosen = keyed.length
		? keyed.sort((a, b) => a.rank - b.rank || a.i - b.i).slice(0, max).sort((a, b) => a.i - b.i).map((x) => x.d)
		: measures.slice(0, max);
	return chosen;
}

/**
 * The document a row stands for: the settings' {doctype_field, name_field}, else the label
 * column when it links one DocType (Trial Balance: the Account). null when none.
 */
export function document_of(conf, row, label_column) {
	if (!row) return null;
	if (conf?.document) {
		const doctype = row[conf.document.doctype_field];
		const name = row[conf.document.name_field];
		return typeof doctype === "string" && doctype && name !== null && name !== undefined && name !== "" ? { doctype, name: String(name) } : null;
	}
	const link = label_column?.link;
	const name = label_column && row[label_column.key];
	if (link?.kind === "static" && link.doctype && typeof name === "string" && name) return { doctype: link.doctype, name };
	return null;
}

/** The row as the server's template reads it: the report's columns by fieldname, no internal keys. */
export function row_payload(row, columns) {
	const out = {};
	for (const c of columns || []) {
		if (c.enriched && !Object.hasOwn(row, c.key)) continue;
		const v = row[c.key];
		if (v !== undefined) out[c.fieldname && !Object.hasOwn(out, c.fieldname) ? c.fieldname : c.key] = v;
	}
	return out;
}

/** The columns as the server's template reads them. */
export function columns_payload(columns) {
	return (columns || []).filter((c) => !c.hidden).map((c) => ({ fieldname: c.fieldname || c.key, label: c.label, fieldtype: c.fieldtype, options: c.options ?? undefined }));
}
