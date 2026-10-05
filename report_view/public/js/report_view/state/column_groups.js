// Column groups of the header (the band row above the column titles). The user's own groups
// (view_state.columns.groups) replace the report's (register bands) when set; a column in no
// group shows as a plain column. Display only: no value is computed here.

export const LIMIT_GROUPS = 30;
const LIMIT_LABEL = 140;

/**
 * @param {*} v groups from a URL, user settings or the dialog
 * @returns {null|Array<{label: string, keys: string[]}>} null = the report's own groups
 */
export function sanitize_groups(v) {
	if (!Array.isArray(v)) return null;
	const used = new Set();
	const out = [];
	for (const g of v.slice(0, LIMIT_GROUPS)) {
		if (!g || typeof g.label !== "string" || !Array.isArray(g.keys)) continue;
		const label = g.label.trim().slice(0, LIMIT_LABEL);
		// A column belongs to one group at most: the first one that names it.
		const keys = g.keys.filter((k) => typeof k === "string" && !used.has(k));
		if (!label || !keys.length) continue;
		keys.forEach((k) => used.add(k));
		out.push({ label, keys });
	}
	return out;
}

/**
 * The bands of the header and the band of each column.
 * @param {object} state view state (columns.groups)
 * @param {object} config register config (bands, columns[fieldname].band)
 * @returns {{bands: Map<string, {id, label}>, band_of: (column) => ?string}}
 */
export function header_bands(state, config = {}) {
	const groups = state?.columns?.groups;
	if (Array.isArray(groups)) {
		const bands = new Map();
		const of_key = new Map();
		groups.forEach((g, i) => {
			const id = `user:${i}`;
			bands.set(id, { id, label: g.label });
			for (const k of g.keys) of_key.set(k, id);
		});
		return { bands, band_of: (column) => of_key.get(column.key) || null };
	}
	const bands = new Map((config.bands || []).map((b) => [b.id, b]));
	const conf = config.columns || {};
	return {
		bands,
		band_of: (column) => {
			const id = conf[column.fieldname]?.band;
			return id && bands.has(id) ? id : null;
		},
	};
}

/**
 * The column order that keeps the members of each group side by side: a group stands where
 * its first member stood, its members in their current order; other columns keep theirs.
 * @param {string[]} keys every column key in the current display order
 * @param {Array<{keys: string[]}>} groups
 */
export function order_for_groups(keys, groups) {
	const group_of = new Map();
	(groups || []).forEach((g, i) => g.keys.forEach((k) => group_of.set(k, i)));
	const placed = new Set();
	const out = [];
	for (const k of keys) {
		const gi = group_of.get(k);
		if (gi === undefined) {
			out.push(k);
			continue;
		}
		if (placed.has(gi)) continue;
		placed.add(gi);
		const members = new Set(groups[gi].keys);
		out.push(...keys.filter((m) => members.has(m)));
	}
	return out;
}
