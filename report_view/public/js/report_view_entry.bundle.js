// Entry button from the standard query-report page to Report View (ADR-007).
// Loaded on every Desk page (app_include_js), so it stays tiny and imports nothing.
// load_report() clears the inner toolbar, so the button is added once the page has
// loaded the report doc of the current route; add_inner_button dedupes by label.

const entry_states = {};
const WAIT_STEP = 200;
const WAIT_MAX = 50;

// Plain fetch, not frappe.call: this optional button must never raise Frappe's error
// dialogs on the user's report page. A failed request is not cached, so it is retried.
function get_entry_state(report_name) {
	if (!entry_states[report_name]) {
		const url = `/api/method/report_view.api.get_entry_state?${new URLSearchParams({ report_name })}`;
		entry_states[report_name] = fetch(url, {
			headers: { Accept: "application/json", "X-Frappe-CSRF-Token": frappe.csrf_token },
		})
			.then((r) => (r.ok ? r.json() : Promise.reject()))
			.then((r) => r.message || { show: false })
			.catch(() => {
				delete entry_states[report_name];
				return { show: false };
			});
	}
	return entry_states[report_name];
}

function loaded_report(report_name) {
	const qr = frappe.query_report;
	return qr && qr.page && qr.report_name === report_name && qr.report_doc?.name ? qr : null;
}

function add_button(report_name, state, tries = 0) {
	const qr = loaded_report(report_name);
	if (!qr) {
		if (tries < WAIT_MAX) setTimeout(() => add_button(report_name, state, tries + 1), WAIT_STEP);
		return;
	}
	if (current_route()[1] !== report_name) return;
	qr.page.add_inner_button(__("Go to Advanced View"), () => {
		frappe.route_options = qr.get_filter_values ? qr.get_filter_values() : {};
		frappe.set_route(...state.route);
	});
}

// frappe.get_route() is null until the router has run (e.g. during app_ready).
function current_route() {
	return frappe.get_route() || [];
}

function on_route_change() {
	const route = current_route();
	if (route[0] !== "query-report" || !route[1]) return;
	const report_name = route[1];
	get_entry_state(report_name).then((state) => {
		if (state && state.show) add_button(report_name, state);
	});
}

// Never throw inside Frappe's app_ready / router handlers: an exception there stops the
// handlers registered after this one (sidebar, breadcrumbs, page show).
function safe_route_change() {
	try {
		on_route_change();
	} catch (e) {
		console.error(e);
	}
}

$(document).on("app_ready", () => {
	frappe.router.on("change", safe_route_change);
	setTimeout(safe_route_change);
});
