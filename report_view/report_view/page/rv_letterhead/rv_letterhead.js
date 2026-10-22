// Page "rv-letterhead" (ADR-018): /desk/rv-letterhead[/<letter head>], the letter head
// builder. The page lives in rv_letterhead.bundle.js with the styles of Report View and its
// own (rv_letterhead.bundle.css, hashed by the build), loaded on first open. The page is open
// to Desk users; the builder needs Letter Head read (and write to save: the server checks).

frappe.pages["rv-letterhead"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Letter Head Builder"),
		single_column: true,
	});
	if (!frappe.model.can_read("Letter Head")) {
		wrapper.rv_ready = null;
		$(wrapper).find(".layout-main-section").html(`<div class="text-muted" style="padding:var(--padding-lg)">${frappe.utils.escape_html(__("You may not read letter heads."))}</div>`);
		return;
	}
	wrapper.rv_ready = frappe.require(["rv_letterhead.bundle.js", "report_view.bundle.css", "rv_letterhead.bundle.css"]).then(() => {
		wrapper.rv_letterhead = new report_view.LetterheadBuilderPage(wrapper);
	});
};

frappe.pages["rv-letterhead"].on_page_show = function (wrapper) {
	wrapper.rv_ready?.then(() => wrapper.rv_letterhead.show());
};
