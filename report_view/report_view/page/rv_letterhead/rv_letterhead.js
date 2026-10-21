// Page "rv-letterhead" (ADR-018): /desk/rv-letterhead[/<letter head>], the letter head
// builder. The page lives in rv_letterhead.bundle.js with the styles of Report View and its
// own (rv_letterhead.css), loaded on first open.

frappe.pages["rv-letterhead"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Letter Head Builder"),
		single_column: true,
	});
	wrapper.rv_ready = frappe.require(["rv_letterhead.bundle.js", "report_view.bundle.css", "/assets/report_view/css/rv_letterhead.css"]).then(() => {
		wrapper.rv_letterhead = new report_view.LetterheadBuilderPage(wrapper);
	});
};

frappe.pages["rv-letterhead"].on_page_show = function (wrapper) {
	wrapper.rv_ready.then(() => wrapper.rv_letterhead.show());
};
