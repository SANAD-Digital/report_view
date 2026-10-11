// Adapter entry point: raw query_report.run response -> NormalizedReport
// (docs/architecture.md §3). Pure module: translation is injected, no frappe, no DOM.
// Twin of report_view/core/normalize.py; both must give the same output for the
// shared cases in report_view/tests/fixtures/normalize/.

import { normalize_columns } from "./columns.js";
import { make_classifier } from "./classify.js";
import { detect_tree, resolve_label_key, link_tree } from "./tree.js";

const BOOLEAN_LIKE = [null, undefined, true, false, 0, 1];
// Rows copied, or classified, between two points where normalize_async gives the main
// thread back (about 20 ms of work each on a wide report).
const CHUNK_ROWS = 4000;

function is_empty(v) {
	if (v === null || v === undefined || v === "" || v === 0 || v === false) return true;
	if (Array.isArray(v)) return v.length === 0;
	if (typeof v === "object") return Object.keys(v).length === 0;
	return false;
}

function is_list(r) {
	return Array.isArray(r);
}

function is_dict(r) {
	return r !== null && typeof r === "object" && !Array.isArray(r);
}

function server_notices(messages) {
	return (messages || []).map((m) => {
		let detail = m;
		if (typeof m === "string") {
			try {
				detail = JSON.parse(m)?.message ?? m;
			} catch {
				detail = m;
			}
		} else if (m && typeof m === "object") {
			detail = m.message ?? "";
		}
		return { code: "SERVER_MESSAGE", detail: String(detail) };
	});
}

function row_to_dict(raw_row, columns) {
	if (is_list(raw_row)) {
		const row = {};
		for (const c of columns) row[c.key] = c.source_index < raw_row.length ? raw_row[c.source_index] : null;
		return row;
	}
	// A plain loop, not a spread (the build turns a spread into a helper call per key) nor
	// Object.assign (three times slower here): rows parsed from JSON share one shape, and
	// copying them key by key keeps it, so every later pass over the rows stays fast.
	const row = {};
	for (const key in raw_row) row[key] = raw_row[key];
	for (const c of columns) {
		if (!(c.key in row)) row[c.key] = row[c.fieldname] ?? null;
	}
	return row;
}

/**
 * @param {object} input {raw, filters, report_settings, register, server_messages}
 * @param {object} [opts] {translate}
 */
export function normalize(input, opts = {}) {
	const steps = normalize_steps(input, opts);
	let step = steps.next();
	while (!step.done) step = steps.next();
	return step.value;
}

/**
 * normalize with the main thread given back between runs of rows (the copy and the
 * classification are the long parts on tens of thousands of rows): the same output.
 */
export async function normalize_async(input, opts = {}) {
	const steps = normalize_steps(input, opts);
	let step = steps.next();
	while (!step.done) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		step = steps.next();
	}
	return step.value;
}

// The normalisation as steps: a yield after every run of CHUNK_ROWS rows.
function* normalize_steps(input, opts) {
	const translate = opts.translate || ((s) => s);
	const raw = input.raw || {};
	const filters = input.filters || {};
	const report_settings = input.report_settings || {};
	const register = input.register || {};
	const notices = [];

	const raw_rows = Array.isArray(raw.result) ? [...raw.result] : [];
	const add_total_row = Boolean(raw.add_total_row);
	const skip_raw = raw.skip_total_row;
	const skip_total_row = Boolean(skip_raw);
	if (!BOOLEAN_LIKE.includes(skip_raw)) notices.push({ code: "SKIP_TOTAL_NON_BOOL", detail: skip_raw });

	// N2.1: Frappe total row = last row, a list, when add_total_row and not skip_total_row.
	let frappe_total_raw = null;
	if (raw_rows.length && is_list(raw_rows[raw_rows.length - 1]) && add_total_row && !skip_total_row) {
		frappe_total_raw = raw_rows.pop();
	}

	const first_dict = raw_rows.find((r) => is_dict(r) && Object.keys(r).length) || null;
	const { columns, notices: col_notices } = normalize_columns(raw.columns || [], {
		filters,
		report_settings,
		register,
		first_row: first_dict,
	});
	notices.push(...col_notices);

	// N2.2
	const has_list = raw_rows.some(is_list);
	const has_dict = raw_rows.some(is_dict);
	const rows = [];
	for (let i = 0; i < raw_rows.length; i++) {
		rows.push(row_to_dict(raw_rows[i], columns));
		if ((i + 1) % CHUNK_ROWS === 0) yield;
	}

	const tree_enabled = detect_tree(rows, register);
	const label_key = resolve_label_key(columns, report_settings, register);

	const classifier = make_classifier(rows, { columns, label_key, tree_enabled, register, translate });
	for (let i = 0; i < rows.length; i++) {
		classifier.classify(rows[i], i);
		if ((i + 1) % CHUNK_ROWS === 0) yield;
	}
	classifier.finish();
	link_tree(rows, { enabled: tree_enabled, report_settings, notices });

	// N4.6: facts are data rows, and only leaves in tree reports.
	const facts = rows.filter((r) => r.__kind === "data" && (!tree_enabled || r.__is_leaf));

	let tree = null;
	if (tree_enabled) {
		const depth = register.tree?.initial_depth ?? report_settings.initial_depth ?? 2;
		tree = { enabled: true, id_key: "__rid", parent_key: "__parent", label_key, initial_depth: depth };
	}

	let frappe_total = null;
	if (frappe_total_raw) {
		frappe_total = {};
		for (const c of columns) {
			frappe_total[c.key] =
				c.source_index < frappe_total_raw.length ? frappe_total_raw[c.source_index] : null;
		}
	}

	notices.push(...server_notices(input.server_messages));

	return {
		columns,
		rows,
		facts,
		tree,
		report_totals: {
			frappe_total,
			internal: rows.filter((r) => r.__kind === "internal_total"),
		},
		message: raw.message || null,
		chart: is_empty(raw.chart) ? null : raw.chart,
		report_summary: is_empty(raw.report_summary) ? null : raw.report_summary,
		flags: {
			add_total_row,
			skip_total_row,
			prepared: Boolean(raw.prepared_report),
			mixed_row_shapes: has_list && has_dict,
		},
		notices,
	};
}
