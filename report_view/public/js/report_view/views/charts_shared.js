// The modules the Charts view shares with the page, taken from the page's own bundle
// (index.js publishes them as report_view.shared) instead of being bundled a second time
// in report_view_charts.bundle.js: one popover singleton (close_popover() of the page closes
// a popover the charts opened), one copy of the engine's config modules. The Charts bundle
// is loaded by the page (frappe.require), so the page's bundle has run before this module.

const shared = window.report_view?.shared;
if (!shared) throw new Error("report_view: the Charts view needs the page's bundle (report_view.bundle.js)");

export const { chart_config, dashboard_state, popover, set_filter } = shared;
export const icons_module = shared.icons;
export const drawer_module = shared.drawer;
