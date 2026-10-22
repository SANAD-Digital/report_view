// The Letter Head form (doctype_js, ADR-018): «Design with the builder» opens the letter
// head in the builder page /desk/rv-letterhead/<name> (a new form opens an empty builder).
// Shown to whoever may write letter heads (the permission the builder's save checks), not by role.

frappe.ui.form.on("Letter Head", {
	refresh(frm) {
		if (!(frm.is_new() ? frappe.model.can_create("Letter Head") : frappe.model.can_write("Letter Head"))) return;
		frm.add_custom_button(__("Design with the builder"), () => {
			if (frm.is_new()) frappe.set_route("rv-letterhead");
			else frappe.set_route("rv-letterhead", frm.doc.name);
		});
	},
});
