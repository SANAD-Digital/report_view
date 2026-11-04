// Page "report-view-a" (ADR-025): /desk/report-view-a/<report_name>, the trial layout A of
// Report View: a head of two rows (the title, the view modes and the actions; the filters as chips) and the table in a card with its own toolbar. The same reports, data, engine and features as the
// standard page "report-view" (unchanged); only the shell differs (layouts/layout.js).

frappe.pages["report-view-a"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Report View"),
		single_column: true,
	});
	wrapper.rv_ready = frappe.require(["report_view.bundle.js", "report_view.bundle.css"]).then(() => {
		wrapper.rv_page = new report_view.ReportViewPage(wrapper, { layout: "a" });
	});
};

frappe.pages["report-view-a"].on_page_show = function (wrapper) {
	wrapper.rv_ready.then(() => wrapper.rv_page.show());
};
