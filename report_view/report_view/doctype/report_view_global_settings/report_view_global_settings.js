// Report View Global Settings (ADR-015): a print signature of a report only.

frappe.ui.form.on("Report View Global Settings", {
	refresh(frm) {
		frm.set_query("print_signature", () => ({ filters: { disabled: 0, signature_for: "Report" } }));
	},
});
