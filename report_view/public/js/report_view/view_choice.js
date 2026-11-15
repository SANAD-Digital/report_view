// What opens first (Report View Global Settings «A report opens in», «A document's Print
// opens in»; frappe.boot.report_view) and the choice a person made against it: a report or
// a print they moved to Frappe's own page stays there in this tab, until they choose a
// Report View page again. Small: loaded on every Desk page by the entry bundle.

const KEY = "report_view:stay_on_system";

// the report pages of Report View and the names the lists show (layout_switch.js)
export const REPORT_VIEWS = [
	{ route: "report-view", label: () => __("Standard design") },
	{ route: "report-view-a", label: () => __("Design A") },
	{ route: "report-view-c", label: () => __("Design C") },
];

function read() {
	try {
		return new Set(JSON.parse(window.sessionStorage.getItem(KEY) || "[]"));
	} catch {
		return new Set();
	}
}

function write(set) {
	try {
		window.sessionStorage.setItem(KEY, JSON.stringify([...set]));
	} catch {
		// private window or storage off: the choice lasts as long as the page
	}
}

const key_of = (kind, name) => `${kind}:${name}`;

/** Frappe's own page of a report («report») or of a document's print («print», "Doctype/name") chosen, or dropped. */
export function stay_on_system(kind, name, on = true) {
	const set = read();
	if (on) set.add(key_of(kind, name));
	else set.delete(key_of(kind, name));
	write(set);
}

export function stays_on_system(kind, name) {
	return read().has(key_of(kind, name));
}

/** The route the site opens a report in ("" = Frappe's own page). */
export function default_report_route() {
	return frappe.boot?.report_view?.report_route || "";
}

/** The route the site opens a document's print in ("" = Frappe's own page). */
export function default_print_route() {
	return frappe.boot?.report_view?.print_route || "";
}

/** The address of a report on a page, its filters (the query) kept. */
export function report_url(route, report_name, search = window.location.search) {
	return `/desk/${route}/${encodeURIComponent(report_name || "")}${search || ""}`;
}
