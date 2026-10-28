// Configured drill (phase 5d; Report View Settings «Drill», get_meta.settings.drilldowns): the
// rules of a report made valid, the rules a row offers, and the filters of the target report a
// rule makes of a row and of the page's filters. Pure: no DOM, no frappe. The target runs
// through the same api.run as the page, with the user's own permissions: a rule maps values,
// it grants nothing.
//
// A rule: {label, source_column, report, filters: {<target filter>: <value>}}; a value is
// "row:<column>" (the row's value of a column), "filter:<name>" (a filter of this report as
// the page runs it), any other literal, or a list of those (a MultiSelectList filter).

const FIELDNAME = /^[A-Za-z0-9_]+$/;
const ROW = "row:";
const FILTER = "filter:";
export const MAX_RULES = 20;

const is_empty = (v) => v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length);

function valid_value(v) {
	if (Array.isArray(v)) return v.length > 0 && v.every((x) => typeof x === "string" || typeof x === "number");
	return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

/**
 * The valid rules of a report (an invalid one is dropped: the server refuses it on save).
 * @param {Array} raw get_meta.settings.drilldowns
 * @returns {Array<{label: string, source_column: string, report: string, filters: object}>}
 */
export function drill_rules(raw) {
	if (!Array.isArray(raw)) return [];
	const out = [];
	for (const r of raw) {
		if (!r || typeof r !== "object") continue;
		const label = typeof r.label === "string" ? r.label.trim() : "";
		const report = typeof r.report === "string" ? r.report.trim() : "";
		const source = typeof r.source_column === "string" ? r.source_column : "";
		if (!label || !report || !FIELDNAME.test(source)) continue;
		const filters = {};
		const given = r.filters && typeof r.filters === "object" && !Array.isArray(r.filters) ? r.filters : {};
		let ok = true;
		for (const [name, value] of Object.entries(given)) {
			if (!FIELDNAME.test(name) || !valid_value(value)) ok = false;
			else filters[name] = value;
		}
		if (ok) out.push({ label, source_column: source, report, filters });
		if (out.length >= MAX_RULES) break;
	}
	return out;
}

/** The key of a report column by its fieldname (the row's own key), or the name itself. */
function key_of(columns, fieldname) {
	const c = (columns || []).find((col) => col.fieldname === fieldname && !col.enriched) || (columns || []).find((col) => col.key === fieldname);
	return c ? c.key : fieldname;
}

/** The rules a report row offers: those whose source column has a value in it. */
export function rules_for_row(rules, row, columns) {
	if (!row) return [];
	return (rules || []).filter((r) => !is_empty(row[key_of(columns, r.source_column)]));
}

function one(spec, row, filters, columns) {
	if (typeof spec !== "string") return spec;
	if (spec.startsWith(ROW)) return row?.[key_of(columns, spec.slice(ROW.length))] ?? null;
	if (spec.startsWith(FILTER)) return filters?.[spec.slice(FILTER.length)] ?? null;
	return spec;
}

/**
 * The filters of the target report for a row: each value as the rule says; an empty one is
 * left out (the target report's own default, or its "mandatory" message).
 * @param {object} rule a drill_rules() rule
 * @param {object} row the report row
 * @param {object} filters the page's filters (as sent to api.run)
 * @param {Array} [columns] the report's columns (fieldname -> row key)
 */
export function map_filters(rule, row, filters, columns = []) {
	const out = {};
	for (const [name, spec] of Object.entries(rule.filters || {})) {
		let value;
		if (Array.isArray(spec)) {
			value = spec.flatMap((s) => {
				const v = one(s, row, filters, columns);
				return Array.isArray(v) ? v : [v];
			}).filter((v) => !is_empty(v));
		} else value = one(spec, row, filters, columns);
		if (!is_empty(value)) out[name] = value;
	}
	return out;
}

const LINK_OPEN = { "new tab": "new_tab", new_tab: "new_tab", "same tab": "same_tab", same_tab: "same_tab", drawer: "drawer" };

/** link_open of the report's settings (how a Link column opens its document): new_tab (the default), same_tab or drawer. */
export function link_open_of(settings) {
	return LINK_OPEN[String(settings?.link_open || "").trim().toLowerCase()] || "new_tab";
}

/** The link of the target report in Report View, with its filters (the drawer's "open" verb). */
export function drill_href(report, filters) {
	const params = new URLSearchParams();
	for (const [k, v] of Object.entries(filters || {})) params.set(k, Array.isArray(v) ? JSON.stringify(v) : String(v));
	const q = params.toString();
	return `/desk/report-view/${encodeURIComponent(report)}${q ? `?${q}` : ""}`;
}
