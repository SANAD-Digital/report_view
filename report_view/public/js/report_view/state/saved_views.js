// Saved views (ADR-010): what a view saves of the page, what applying one gives, whether the
// page still shows it. Pure module: no frappe, no DOM (tests/js/saved_views.test.mjs).
//
// A view holds the view state (§7.1) without the page's own preferences (ui: density, side
// panel) and, when its owner chose so, the report's filters (report_filters). Applying it goes
// through the same sanitize / restrict as a link (state/view_state.js, state/features.js), so a
// view never asks for what the report turned off.

export const VISIBILITIES = ["Private", "Roles", "Public"];
// roles that are everyone (or no one): never offered to share a view with
export const AUTOMATIC_ROLES = new Set(["All", "Guest", "Desk User", "Administrator"]);

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** JSON with the keys of every object sorted: two equal values give the same text. */
export function stable(v) {
	if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
	if (v && typeof v === "object") {
		return `{${Object.keys(v)
			.filter((k) => v[k] !== undefined)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
			.join(",")}}`;
	}
	return JSON.stringify(v ?? null);
}

/**
 * The view state a view saves: a copy without ui and the page's flags (__newer); with the
 * report's filters when given (an object), without them when null.
 */
export function view_payload(state, report_filters = null) {
	const out = clone(state || {});
	delete out.ui;
	delete out.report_filters;
	for (const k of Object.keys(out)) if (k.startsWith("__")) delete out[k];
	if (report_filters && typeof report_filters === "object") out.report_filters = clean_filters(report_filters);
	return out;
}

/** Report filters without the empty values (as the URL and query-report leave them out). */
export function clean_filters(filters) {
	const out = {};
	for (const [k, v] of Object.entries(filters || {})) {
		if (v === null || v === undefined || v === "") continue;
		if (Array.isArray(v) && !v.length) continue;
		out[k] = clone(v);
	}
	return out;
}

/**
 * What the page shows, to compare with what a view gave when it was applied: the view state
 * (without ui) and, for a view that keeps the filters, the report's filters.
 */
export function snapshot(state, filters, with_filters) {
	return { state: view_payload(state), filters: with_filters ? clean_filters(filters) : null };
}

export function same_snapshot(a, b) {
	return Boolean(a && b) && stable(a) === stable(b);
}

/**
 * The values to give every report filter when a view with filters is applied: the view's
 * value, or empty for a filter the view had no value for (so the filters are the view's, not
 * a mix with the ones on screen). `controls`: [{fieldname, fieldtype}].
 */
export function filters_to_apply(saved, controls) {
	const out = {};
	for (const c of controls || []) {
		const name = c.fieldname;
		if (!name) continue;
		if (Object.hasOwn(saved || {}, name)) out[name] = clone(saved[name]);
		else if (c.fieldtype === "Check") out[name] = 0;
		else if (/^(MultiSelect|Table MultiSelect)/.test(c.fieldtype || "")) out[name] = [];
		else out[name] = "";
	}
	return out;
}

/** The columns sent with a save: the server keeps those the state refers to (columns_ref). */
export function columns_payload(columns) {
	return (columns || []).map((c) => ({ key: c.key, label: c.label ?? "", fieldtype: c.fieldtype ?? "", source_index: c.source_index }));
}

// every column key a (sanitized) state refers to
function referenced(state) {
	const keys = new Set();
	const add = (list) => (list || []).forEach((k) => typeof k === "string" && keys.add(k));
	const cols = state.columns || {};
	add(cols.order);
	add(cols.hidden);
	add(Object.keys(cols.widths || {}));
	add(cols.pinned?.start);
	add(cols.pinned?.end);
	add((state.sort || []).map((s) => s.key));
	add((state.filters || []).map((f) => f.key).filter((k) => k !== "*"));
	add(state.group?.by);
	add((state.values || []).map((v) => v.key));
	add(state.pivot?.rows);
	add(state.pivot?.cols);
	add((state.pivot?.values || []).map((v) => v.key));
	return keys;
}

const DERIVED = /__(year|quarter|month)$/;

/**
 * §7.3: a key of the view that the report no longer has is looked for again, by its label
 * (translated or not), then by its place and type; found, it is renamed in the state; not
 * found, it is left for `reconcile` to drop, and its label is reported.
 * @param {object} state a sanitized state (changed in place)
 * @param {object|null} ref the view's columns_ref {key: {label, fieldtype, source_index}}
 * @param {Array} columns the report's columns now
 * @param {(s: string) => string} [translate]
 * @returns {{renamed: object, missing: string[]}}
 */
export function rebind(state, ref, columns, translate = (s) => s) {
	const out = { renamed: {}, missing: [] };
	if (!state || !Array.isArray(columns) || !columns.length) return out;
	const known = new Set(columns.map((c) => c.key));
	const date_keys = new Set(columns.filter((c) => c.date).map((c) => c.key));
	const taken = new Set();
	const used = referenced(state);
	const free = (c) => !taken.has(c.key) && !used.has(c.key);
	for (const key of used) {
		if (known.has(key)) continue;
		const base = key.replace(DERIVED, "");
		if (base !== key && date_keys.has(base)) continue;
		const r = ref && ref[key];
		let hit = null;
		if (r) {
			const labels = new Set([r.label, translate(r.label)].filter(Boolean));
			hit =
				columns.find((c) => free(c) && labels.has(c.label)) ||
				columns.find((c) => free(c) && c.source_index === r.source_index && c.fieldtype === r.fieldtype) ||
				null;
		}
		if (hit) {
			taken.add(hit.key);
			out.renamed[key] = hit.key;
		} else {
			out.missing.push(r?.label ? translate(r.label) : key);
		}
	}
	if (Object.keys(out.renamed).length) rename_keys(state, out.renamed);
	return out;
}

function rename_keys(state, map) {
	const k = (key) => map[key] || key;
	const list = (l) => (Array.isArray(l) ? l.map(k) : l);
	const cols = state.columns;
	if (cols) {
		cols.order = list(cols.order);
		cols.hidden = list(cols.hidden);
		cols.widths = Object.fromEntries(Object.entries(cols.widths || {}).map(([key, w]) => [k(key), w]));
		if (cols.pinned) cols.pinned = { start: list(cols.pinned.start), end: list(cols.pinned.end) };
		if (Array.isArray(cols.groups)) cols.groups = cols.groups.map((g) => ({ ...g, keys: list(g.keys) }));
	}
	state.sort = (state.sort || []).map((s) => ({ ...s, key: k(s.key) }));
	state.filters = (state.filters || []).map((f) => ({ ...f, key: k(f.key) }));
	if (state.group) state.group.by = list(state.group.by);
	state.values = (state.values || []).map((v) => ({ ...v, key: k(v.key) }));
	if (state.pivot) {
		state.pivot.rows = list(state.pivot.rows);
		state.pivot.cols = list(state.pivot.cols);
		state.pivot.values = (state.pivot.values || []).map((v) => ({ ...v, key: k(v.key) }));
	}
}

/** The list of the menu: the user's own views, then the ones shared with them, by title. */
export function split_views(rows) {
	const by_title = (a, b) => String(a.title || "").localeCompare(String(b.title || ""));
	const list = Array.isArray(rows) ? rows : [];
	return { mine: list.filter((r) => r.is_owner).sort(by_title), shared: list.filter((r) => !r.is_owner).sort(by_title) };
}

/** The roles a user may share a view with: their own, without the automatic ones. */
export function share_roles(user_roles) {
	return [...new Set((user_roles || []).filter((r) => typeof r === "string" && r && !AUTOMATIC_ROLES.has(r)))].sort();
}

/**
 * The view to open the page with: the one in the link (`?view=`), else the default (the
 * user's own, else the report's) — unless the link carries its own state (`rv`), which wins
 * (§7.4); the view of the link is then only the one the state was made from.
 * @returns {{name: string|null, from: "link"|"default"|null}}
 */
export function view_to_open(params, defaults) {
	const linked = params?.get?.("view") || null;
	if (linked) return { name: linked, from: "link" };
	if (params?.get?.("rv")) return { name: null, from: null };
	return defaults?.saved_view ? { name: defaults.saved_view, from: "default" } : { name: null, from: null };
}
