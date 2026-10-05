// Entry button from the standard query-report page to Report View (ADR-007).
// Loaded on every Desk page (app_include_js), so it stays tiny: it imports only the engine's file list.
// load_report() clears the inner toolbar, so the button is added once the page has
// loaded the report doc of the current route; add_inner_button dedupes by label.
// Where the button shows, the page's files and the engine (2.5 MB of WASM) are fetched
// ahead, while the browser is idle: opening Report View then finds them in the cache.

import { SERVER_WASM, CLIENT_WASM, WORKER_JS } from "./report_view/engine/assets.js";

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

let prefetched = false;

function prefetch_page() {
	if (prefetched) return;
	prefetched = true;
	const rtl = frappe.utils.is_rtl?.();
	const files = [
		frappe.assets.bundled_asset("report_view.bundle.js"),
		frappe.assets.bundled_asset("report_view.bundle.css", rtl),
		SERVER_WASM,
		CLIENT_WASM,
		WORKER_JS,
	];
	const go = () => {
		for (const href of files) {
			if (!href) continue;
			const link = document.createElement("link");
			link.rel = "prefetch";
			link.href = href;
			document.head.appendChild(link);
		}
	};
	if (window.requestIdleCallback) window.requestIdleCallback(go, { timeout: 3000 });
	else setTimeout(go, 1000);
}

let watcher = null;

function stop_watching() {
	if (watcher) watcher.disconnect();
	watcher = null;
}

function add_button(report_name, state, tries = 0) {
	const qr = loaded_report(report_name);
	if (!qr) {
		if (tries < WAIT_MAX) setTimeout(() => add_button(report_name, state, tries + 1), WAIT_STEP);
		return;
	}
	if (current_route()[1] !== report_name) return;
	const put = () =>
		qr.page.add_inner_button(__("Go to Advanced View"), () => {
			frappe.route_options = qr.get_filter_values ? qr.get_filter_values() : {};
			frappe.set_route(...state.route);
		});
	put();
	prefetch_page();
	// In Frappe 16 the inner toolbar is the custom-actions area, which refresh_report empties
	// (page.js:165, query_report.js refresh_report): put the button back whenever it goes.
	stop_watching();
	const toolbar = qr.page.inner_toolbar?.get(0);
	if (!toolbar) return;
	watcher = new MutationObserver(() => {
		if (current_route()[0] !== "query-report" || current_route()[1] !== report_name) return stop_watching();
		if (!toolbar.querySelector(`button[data-label="${encodeURIComponent(__("Go to Advanced View"))}"]`)) put();
	});
	watcher.observe(toolbar, { childList: true });
}

// frappe.get_route() is null until the router has run (e.g. during app_ready).
function current_route() {
	return frappe.get_route() || [];
}

function on_route_change() {
	const route = current_route();
	if (route[0] !== "query-report" || !route[1]) return stop_watching();
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
