// "Column groups" dialog: the user makes the groups of the header (the band row above the
// column titles): a name and the columns under it. A column belongs to one group at most;
// ticking it in a group takes it out of the other one. Columns in no group show as plain
// columns. Save applies the groups and keeps them for this user and report; "Report
// default" goes back to the report's own groups.

import { visible_columns } from "../engine/view_config.js";
import { LIMIT_GROUPS } from "../state/column_groups.js";

function esc(s) {
	return frappe.utils.escape_html(String(s ?? ""));
}

/** @param {import("../view_controls.js").ViewControls} controls */
export function open_column_groups(controls) {
	if (!controls.report || !controls.state) return;
	const label_key = controls.label_key();
	const columns = visible_columns(controls.report, controls.state)
		.filter((c) => c.key !== label_key)
		// The report's own column label: unique ("Opening (Dr)"), where the header title
		// may repeat under each group ("Debit").
		.map((c) => ({ key: c.key, title: controls.report_label(c.key) }));
	// Working copy: [{label, keys:Set}]
	let groups = controls.column_groups().map((g) => ({ label: g.label, keys: new Set(g.keys) }));
	if (!groups.length) groups.push({ label: "", keys: new Set() });

	const dialog = new frappe.ui.Dialog({
		title: __("Column groups"),
		size: "large",
		fields: [{ fieldtype: "HTML", fieldname: "editor" }],
		primary_action_label: __("Save"),
		primary_action: () => {
			const out = groups
				.map((g) => ({ label: g.label.trim(), keys: columns.map((c) => c.key).filter((k) => g.keys.has(k)) }))
				.filter((g) => g.keys.length);
			const unnamed = out.find((g) => !g.label);
			if (unnamed) {
				frappe.msgprint(__("Give every group a name"));
				return;
			}
			controls.set_column_groups(out);
			dialog.hide();
		},
		secondary_action_label: __("Report default"),
		secondary_action: () => {
			controls.set_column_groups(null);
			dialog.hide();
		},
	});
	const root = dialog.fields_dict.editor.$wrapper.get(0);
	root.classList.add("rv-cg");

	const owner = (key) => groups.findIndex((g) => g.keys.has(key));

	const render = () => {
		root.innerHTML = `
			<p class="rv-cg-hint">${esc(__("Name a group and tick its columns. Columns in no group show as plain columns."))}</p>
			${groups
				.map(
					(g, gi) => `
				<section class="rv-cg-group" data-group="${gi}">
					<div class="rv-cg-head">
						<input type="text" class="form-control rv-cg-name" data-name="${gi}" maxlength="140"
							placeholder="${esc(__("Group name"))}" aria-label="${esc(__("Group name"))}" value="${esc(g.label)}">
						<button type="button" class="btn btn-default btn-sm rv-cg-remove" data-remove="${gi}">${esc(__("Remove"))}</button>
					</div>
					<div class="rv-cg-cols">
						${columns
							.map((c) => {
								const other = owner(c.key);
								const note = other >= 0 && other !== gi ? groups[other].label || __("another group") : "";
								return `<label class="rv-cg-col${note ? " taken" : ""}">
									<input type="checkbox" data-group="${gi}" data-key="${esc(c.key)}" ${g.keys.has(c.key) ? "checked" : ""}>
									<span>${esc(c.title)}</span>${note ? `<small>${esc(note)}</small>` : ""}
								</label>`;
							})
							.join("")}
					</div>
				</section>`
				)
				.join("")}
			<button type="button" class="btn btn-default btn-sm rv-cg-add" ${groups.length >= LIMIT_GROUPS ? "disabled" : ""}>+ ${esc(__("Add group"))}</button>`;
	};

	root.addEventListener("input", (e) => {
		const gi = e.target.dataset.name;
		if (gi !== undefined) groups[Number(gi)].label = e.target.value;
	});
	root.addEventListener("change", (e) => {
		const t = e.target;
		if (t.type !== "checkbox") return;
		const gi = Number(t.dataset.group);
		const key = t.dataset.key;
		if (t.checked) {
			for (const g of groups) g.keys.delete(key);
			groups[gi].keys.add(key);
		} else groups[gi].keys.delete(key);
		render();
	});
	root.addEventListener("click", (e) => {
		const remove = e.target.closest("[data-remove]");
		if (remove) {
			groups.splice(Number(remove.dataset.remove), 1);
			if (!groups.length) groups.push({ label: "", keys: new Set() });
			render();
		} else if (e.target.closest(".rv-cg-add")) {
			groups.push({ label: "", keys: new Set() });
			render();
			root.querySelector(`[data-name="${groups.length - 1}"]`)?.focus();
		}
	});
	render();
	dialog.show();
}
