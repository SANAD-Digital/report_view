// The Letter Head form (doctype_js, ADR-018): «Design with the builder» opens the letter
// head in the builder page /desk/rv-letterhead/<name> (a new form opens an empty builder).

frappe.ui.form.on("Letter Head", {
	refresh(frm) {
		if (!frappe.user.has_role("System Manager")) return;
		frm.add_custom_button(__("Design with the builder"), () => {
			if (frm.is_new()) frappe.set_route("rv-letterhead");
			else frappe.set_route("rv-letterhead", frm.doc.name);
		});
	},
});
