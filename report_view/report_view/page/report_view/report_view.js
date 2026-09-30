// Page "report-view" (ADR-005): /desk/report-view/<report_name>.
// Kept small: the libraries and the page live in report_view.bundle.js, loaded on first open.

frappe.pages["report-view"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Report View"),
		single_column: true,
	});
	wrapper.rv_ready = frappe
		.require([
			"/assets/report_view/node_modules/arquero/dist/arquero.min.js",
			"report_view.bundle.js",
			"report_view.bundle.css",
		])
		.then(() => {
			wrapper.rv_page = new report_view.ReportViewPage(wrapper);
		});
};

frappe.pages["report-view"].on_page_show = function (wrapper) {
	wrapper.rv_ready.then(() => wrapper.rv_page.show());
};
