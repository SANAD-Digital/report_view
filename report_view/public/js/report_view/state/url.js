// URL representation of the view (docs/architecture.md §7.4):
//   /desk/report-view/<report>?<report filters as plain params>&rv=<base64url(JSON)>
// `rv` carries the view state without report_filters and ui.

export const MAX_URL = 2000;

export function encode_state(state) {
	const { report_filters, ui, ...rest } = state;
	const bytes = new TextEncoder().encode(JSON.stringify(rest));
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decode_state(text) {
	try {
		const b64 = String(text).replace(/-/g, "+").replace(/_/g, "/");
		const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
		const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
		return JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return null;
	}
}

// Same serialisation as query_report.js update_url_with_filters: arrays as JSON.
export function filters_to_params(filters) {
	const params = new URLSearchParams();
	for (const [k, v] of Object.entries(filters || {})) {
		if (v === null || v === undefined || v === "") continue;
		if (Array.isArray(v) && !v.length) continue;
		params.set(k, Array.isArray(v) || typeof v === "object" ? JSON.stringify(v) : String(v));
	}
	return params;
}

// Nothing of the view differs from the default one: the URL carries no `rv`.
function is_default_view(state) {
	return (
		!state.sort.length &&
		!state.filters.length &&
		!state.group.by.length &&
		state.group.subtotals !== false &&
		state.group.expanded === "all" &&
		!state.columns.order.length &&
		!state.columns.hidden.length &&
		!Object.keys(state.columns.widths).length &&
		!state.columns.pinned.start.length &&
		state.tree.depth === null &&
		state.tree.expanded === null
	);
}

/**
 * @returns {{search: string, rv_dropped: boolean}}
 */
export function build_search(filters, state, pathname) {
	const params = filters_to_params(filters);
	let rv_dropped = false;
	if (!is_default_view(state)) {
		params.set("rv", encode_state(state));
		if ((pathname + "?" + params.toString()).length > MAX_URL) {
			params.delete("rv");
			rv_dropped = true;
		}
	}
	const q = params.toString();
	return { search: q ? `?${q}` : "", rv_dropped };
}

// Debounced history.replaceState, as the original page does (300 ms).
export function make_url_updater(win, delay = 300) {
	let timer = null;
	return (filters, state) => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			const { pathname, hash } = win.location;
			const { search } = build_search(filters, state, pathname);
			win.history.replaceState(win.history.state, "", pathname + search + hash);
		}, delay);
	};
}
