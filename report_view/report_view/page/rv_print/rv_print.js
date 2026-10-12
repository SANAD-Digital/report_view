// Page "rv-print" (ADR-017): /desk/rv-print/<doctype>/<name>, a document printed with the
// pages of Report View. The page lives in rv_print.bundle.js (and the styles of Report
// View), loaded on first open.

frappe.pages["rv-print"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Advanced Print"),
		single_column: true,
	});
	wrapper.rv_ready = frappe.require(["rv_print.bundle.js", "report_view.bundle.css"]).then(() => {
		wrapper.rv_print = new report_view.DocPrintPage(wrapper);
	});
};

frappe.pages["rv-print"].on_page_show = function (wrapper) {
	wrapper.rv_ready.then(() => wrapper.rv_print.show());
};
