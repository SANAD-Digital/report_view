// Variables of a print format (ADR-024): the definitions kept in its hidden field
// `rv_variables`, checked as the server checks them (report_view/core/print_variables.py),
// and the values the print page sends with every render. Pure: no DOM, no Frappe call
// (tests/js/print_variables.test.mjs). The Print Format form reads it as
// report_view.print_variables (report_view_entry.bundle.js); the pages import it.

export const MAX_VARIABLES = 30;

export const FIELDTYPES = ["Select", "Check", "Link", "Float", "Int"];

export const FIELDNAME = /^[a-z][a-z0-9_]{0,39}$/;

// names a template's context already has (document, report and Custom formats)
export const RESERVED = new Set(["doc", "data", "rows", "filters", "columns", "title", "company", "lang", "frappe", "_", "variables"]);

const MAX_LABEL = 140;

const MAX_OPTIONS = 100;

const MAX_OPTION = 140;

export const MAX_NUMBER = 1e12;

// formats whose values one user's settings keep
const MAX_FORMATS = 50;

const TRUE = new Set([true, 1, "1", "true", "True", "yes", "on"]);

const options_of = (text) =>
	String(text || "")
		.split("\n")
		.map((o) => o.trim())
		.filter(Boolean);

/** A number of a variable of type `fieldtype`, or null when it is not one. */
export function to_number(fieldtype, raw) {
	if (raw === null || raw === undefined || (typeof raw === "string" && !raw.trim()) || typeof raw === "object") return null;
	const n = Number(typeof raw === "boolean" ? Number(raw) : raw);
	if (!Number.isFinite(n) || Math.abs(n) > MAX_NUMBER) return null;
	if (fieldtype === "Int" && !Number.isInteger(n)) return null;
	return n;
}

/**
 * The rows of the dialog checked as the server checks them: `{defs, errors}`, each error a
 * translated sentence naming the row. A Link's DocType is checked again by the server.
 */
export function validate_definitions(rows) {
	const errors = [];
	const defs = [];
	const seen = new Set();
	const list = (rows || []).filter((r) => r && (r.label || r.fieldname || r.options || r.default));
	if (list.length > MAX_VARIABLES) errors.push(__("A print format has at most {0} variables", [MAX_VARIABLES]));
	list.forEach((r, i) => {
		const label = String(r.label || "").trim();
		const name = label || __("Row {0}", [i + 1]);
		const fail = (msg) => errors.push(`${name}: ${msg}`);
		if (!label || label.length > MAX_LABEL) fail(__("write its label (at most {0} characters)", [MAX_LABEL]));
		const fieldname = String(r.fieldname || "").trim();
		if (!FIELDNAME.test(fieldname)) fail(__("its name starts with a small letter and has small letters, digits and _ only (at most 40)"));
		else if (RESERVED.has(fieldname)) fail(__("the name {0} is taken by the template's context", [fieldname]));
		else if (seen.has(fieldname)) fail(__("the name {0} is used twice", [fieldname]));
		seen.add(fieldname);
		const fieldtype = r.fieldtype;
		if (!FIELDTYPES.includes(fieldtype)) {
			fail(__("the type must be Select, Check, Link, Float or Int"));
			return;
		}
		const d = { label, fieldname, fieldtype, options: null };
		if (fieldtype === "Select") {
			const opts = options_of(r.options);
			if (!opts.length) fail(__("write its options, one per line"));
			else if (opts.length > MAX_OPTIONS || opts.some((o) => o.length > MAX_OPTION)) fail(__("too many or too long options"));
			else if (new Set(opts).size !== opts.length) fail(__("an option is written twice"));
			d.options = opts.join("\n");
		} else if (fieldtype === "Link") {
			d.options = String(r.options || "").trim();
			if (!d.options) fail(__("its options must name a DocType"));
		}
		const raw = r.default;
		if (fieldtype === "Check") d.default = TRUE.has(raw) ? 1 : 0;
		else if (raw === null || raw === undefined || raw === "") d.default = fieldtype === "Int" || fieldtype === "Float" ? 0 : "";
		else if (fieldtype === "Int" || fieldtype === "Float") {
			d.default = to_number(fieldtype, raw);
			if (d.default === null) fail(fieldtype === "Int" ? __("the default must be a whole number") : __("the default must be a number"));
		} else {
			d.default = String(raw).trim();
			if (fieldtype === "Select" && d.options && !options_of(d.options).includes(d.default)) fail(__("the default must be one of its options"));
		}
		const description = String(r.description || "").trim();
		if (description) d.description = description.slice(0, 500);
		defs.push(d);
	});
	return { defs, errors };
}

/** The definitions stored in a format's field (JSON text or a list); [] when unreadable. */
export function parse_definitions(raw) {
	let list = raw;
	if (typeof raw === "string") {
		try {
			list = raw.trim() ? JSON.parse(raw) : [];
		} catch {
			return [];
		}
	}
	return Array.isArray(list) ? list.filter((d) => d && typeof d === "object" && FIELDNAME.test(d.fieldname || "") && FIELDTYPES.includes(d.fieldtype)) : [];
}

/** `raw` as a value of `d`, or undefined when it cannot be one (a Select not of its options). */
export function coerce_value(d, raw) {
	if (raw === undefined) return undefined;
	switch (d.fieldtype) {
		case "Check":
			return TRUE.has(raw) ? 1 : 0;
		case "Int":
		case "Float":
			return to_number(d.fieldtype, raw) ?? undefined;
		case "Select":
			return typeof raw === "string" && options_of(d.options).includes(raw) ? raw : undefined;
		case "Link":
			return typeof raw === "string" && raw.length <= MAX_OPTION ? raw : undefined;
		default:
			return undefined;
	}
}

/** The value of every variable of `defs`: the one saved (when still valid), else its default. */
export function values_for(defs, saved) {
	const out = {};
	for (const d of defs || []) {
		const v = coerce_value(d, saved?.[d.fieldname]);
		out[d.fieldname] = v === undefined ? (coerce_value(d, d.default) ?? (d.fieldtype === "Check" || d.fieldtype === "Int" || d.fieldtype === "Float" ? 0 : "")) : v;
	}
	return out;
}

/**
 * The values kept in the user's print settings (`variables`): `{format: {fieldname: value}}`,
 * plain values only; anything else dropped. The definitions check them again when the
 * pages use them (values_for), and the server once more.
 */
export function sanitize_variables(raw) {
	const out = {};
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
	for (const [fmt, vals] of Object.entries(raw).slice(0, MAX_FORMATS)) {
		if (!fmt || fmt.length > MAX_OPTION || !vals || typeof vals !== "object" || Array.isArray(vals)) continue;
		const one = {};
		for (const [k, v] of Object.entries(vals).slice(0, MAX_VARIABLES)) {
			if (!FIELDNAME.test(k)) continue;
			if (typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.length <= MAX_OPTION)) one[k] = v;
		}
		out[fmt] = one;
	}
	return out;
}
