// ADR-006: a facade object set as frappe.query_report while our page is shown, so that
// report scripts (on_change, get_data, formatter) that call frappe.query_report.* keep
// working. The previous value is restored when the page is hidden. It does not inherit
// from frappe.views.QueryReport and touches no prototype.

const SUPPORTED = new Set([
	"report_name",
	"filters",
	"page",
	"get_filter",
	"get_filter_value",
	"get_filter_values",
	"get_values",
	"set_filter_value",
	"toggle_filter_display",
	"refresh",
	"trigger_refresh",
	"datatable",
	"raw_data",
	"report_settings",
]);
// Probes made by JS itself or jQuery; never treated as unsupported calls.
const PASS_THROUGH = new Set(["then", "toJSON", "constructor", "nodeType", "jquery", "length"]);

export class ReportViewQueryReportFacade {
	constructor(host) {
		this._host = host;
		this.datatable = null;
	}
	get report_name() {
		return this._host.report_name;
	}
	get filters() {
		return this._host.filters?.controls || [];
	}
	get page() {
		return this._host.page;
	}
	get raw_data() {
		return this._host.raw || null;
	}
	get report_settings() {
		return this._host.report_settings || {};
	}
	get_filter(fieldname) {
		return this._host.filters?.get_filter(fieldname);
	}
	get_filter_value(fieldname) {
		return this._host.filters?.get_filter_value(fieldname);
	}
	get_filter_values(raise) {
		return this._host.filters?.get_values(raise);
	}
	get_values(raise) {
		return this.get_filter_values(raise);
	}
	set_filter_value(fieldname, value) {
		return this._host.filters?.set_filter_value(fieldname, value);
	}
	toggle_filter_display(fieldname, flag) {
		return this._host.filters?.toggle_filter_display(fieldname, flag);
	}
	// After the first run, a refresh asked by the report script marks the criteria as
	// pending instead of re-running (the user runs the report with the button).
	refresh() {
		return this._host.request_refresh();
	}
	trigger_refresh() {
		return this._host.request_refresh();
	}
}

// In developer mode, any member outside the declared interface throws a clear error.
export function make_facade(host) {
	const facade = new ReportViewQueryReportFacade(host);
	if (!frappe.boot?.developer_mode) return facade;
	return new Proxy(facade, {
		get(target, prop, receiver) {
			if (typeof prop !== "string" || SUPPORTED.has(prop) || PASS_THROUGH.has(prop) || prop.startsWith("_")) {
				return Reflect.get(target, prop, receiver);
			}
			throw new Error(
				`report_view: frappe.query_report.${prop} is not supported on the Report View page (ADR-006)`
			);
		},
	});
}

export function install_facade(host) {
	const previous = frappe.query_report;
	frappe.query_report = make_facade(host);
	return () => {
		frappe.query_report = previous;
	};
}
