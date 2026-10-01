// Page "report-view" (ADR-005): /desk/report-view/<report_name>.
// Kept small: the page and the JS of its libraries live in report_view.bundle.js, loaded on
// first open; the engine's WASM files are fetched when the first report runs.

frappe.pages["report-view"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Report View"),
		single_column: true,
	});
	wrapper.rv_ready = frappe.require(["report_view.bundle.js", "report_view.bundle.css"]).then(() => {
		wrapper.rv_page = new report_view.ReportViewPage(wrapper);
	});
};

frappe.pages["report-view"].on_page_show = function (wrapper) {
	wrapper.rv_ready.then(() => wrapper.rv_page.show());
};
