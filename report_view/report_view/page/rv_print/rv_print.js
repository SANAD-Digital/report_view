// Page "rv-print" (ADR-017): /desk/rv-print/<doctype>/<name>, a document printed with the
// pages of Report View. The page lives in rv_print.bundle.js (and the styles of Report
// View), loaded on first open.

frappe.pages["rv-print"].on_page_load = function (wrapper) {
	// Desk's sidebar folds to its icons on this page (on_page_show) and comes back after, as on
	// Frappe's own print page (frappe/printing/page/print/print.js)
	$(wrapper).on("hide", () => frappe.app?.sidebar?.unfold_after_leaving_page?.());
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
	frappe.app?.sidebar?.fold_for_page?.();
	wrapper.rv_ready.then(() => wrapper.rv_print.show());
};
