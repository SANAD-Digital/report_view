// Page "report-view-c" (ADR-025): /desk/report-view-c/<report_name>, the trial layout C of
// Report View: the filters as one sentence, one dense toolbar, the full-width table and the saved views as tabs in the bottom bar. The same reports, data, engine and features as the
// standard page "report-view" (unchanged); only the shell differs (layouts/layout.js).

frappe.pages["report-view-c"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Report View"),
		single_column: true,
	});
	wrapper.rv_ready = frappe.require(["report_view.bundle.js", "report_view.bundle.css"]).then(() => {
		wrapper.rv_page = new report_view.ReportViewPage(wrapper, { layout: "c" });
	});
};

frappe.pages["report-view-c"].on_page_show = function (wrapper) {
	wrapper.rv_ready.then(() => wrapper.rv_page.show());
};
