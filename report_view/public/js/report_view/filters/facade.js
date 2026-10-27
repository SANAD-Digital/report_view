// ADR-006: a facade object set as frappe.query_report while our page is shown, so that
// report scripts (on_change, get_data, formatter) that call frappe.query_report.* keep
// working. The previous value is restored when the page is hidden. It does not inherit
// from frappe.views.QueryReport and touches no prototype.

class ReportViewQueryReportFacade {
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
	// the answer of `run` as the server sent it; the page keeps it without its rows and
	// rebuilds them on first read (adapter/raw_data.js)
	get raw_data() {
		return typeof this._host.raw_data === "function" ? this._host.raw_data() : this._host.raw || null;
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

// Members outside the interface read as undefined, as on any object: report scripts probe
// for optional methods (`typeof qr.get_snd_filter_values === "function"`), and the original
// page answers the same way for methods it lacks. A real call to a missing method fails
// with the usual TypeError naming it.
export function make_facade(host) {
	return new ReportViewQueryReportFacade(host);
}

export function install_facade(host) {
	const previous = frappe.query_report;
	frappe.query_report = make_facade(host);
	return () => {
		frappe.query_report = previous;
	};
}
