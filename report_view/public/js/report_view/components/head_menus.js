// The menus of the trial layouts' heads and toolbars (ADR-025): Export ▾, ⋯, Group by ▾ and
// Density ▾. Each is a menu of the design (popover.js menu_content) whose items call what the
// page already does (export_xlsx, print, the side panel, the grouping, the density, the
// theme, Report View Settings); nothing here computes anything.

import { icons } from "./icons.js";
import { open_popover, close_popover, menu_content } from "./popover.js";
import { open_column_groups } from "./column_groups_dialog.js";

const is_manager = () => Boolean(frappe.user?.has_role?.("System Manager") || frappe.user?.has_role?.("Report View Manager"));

function open_menu(page, anchor, items, label, width = 240) {
	const wrapped = items.map((it) => (it.sep || it.disabled ? it : { ...it, act: () => (close_popover(), it.act()) }));
	const content = menu_content(wrapped, "");
	open_popover({ root: page.root, anchor, content, width, role: "menu", label, align: "end" });
	content.querySelector(".rv-mi:not(:disabled)")?.focus();
}

/** Export ▾: the Excel file of the table, and the pages to print or keep as a PDF. */
export function open_export_menu(page, anchor) {
	const can_export = Boolean(page.meta?.perms?.can_export) && page.features.excel !== false;
	const table = ["grid", "statement"].includes(page.state?.mode || "grid");
	const items = [];
	if (can_export) {
		items.push({
			key: "excel",
			label: __("Excel"),
			hint: ".xlsx",
			icon: icons.sheet(),
			disabled: !table || Boolean(page.header?.exporting),
			title: table ? "" : __("Excel export is available in the Table view"),
			act: () => page.export_xlsx(),
		});
	}
	if (page.modes().includes("pages")) {
		items.push({ key: "pages", label: __("Print or PDF…"), icon: icons.print(), act: () => page.print() });
	}
	if (!items.length) items.push({ label: __("Nothing to export"), disabled: true, act: () => {} });
	open_menu(page, anchor, items, __("Export"));
}

/** ⋯: what the head has no room for (the theme, the tool panels, Report View Settings, the standard report). */
export function open_more_menu(page, anchor, { print = false } = {}) {
	const f = page.features;
	const mode = page.state?.mode || "grid";
	const dark = page.is_dark();
	const items = [];
	if (print && page.modes().includes("pages")) items.push({ key: "print", label: __("Print", null, "Report View"), icon: icons.print(), act: () => page.print() });
	if (f.side_panel && f.filters_panel && (mode === "grid" || mode === "pivot")) {
		items.push({ key: "filters", label: __("Column filters"), icon: icons.funnel(15), act: () => page.controls.side_host().set_side("filters") });
	}
	if (mode === "grid" && f.column_groups) items.push({ key: "column-groups", label: __("Column groups"), icon: icons.columns(), act: () => open_column_groups(page.controls) });
	const foldable = mode === "pivot" ? (page.controls.pivot()?.rows.length || 0) > 1 : Boolean(page.result && page.result.mode !== "flat");
	if (foldable && (mode === "grid" || mode === "pivot")) {
		items.push(
			{ key: "expand-all", label: __("Expand all"), icon: icons.expand_all(), act: () => page.fold_all(true) },
			{ key: "collapse-all", label: __("Collapse all"), icon: icons.collapse_all(), act: () => page.fold_all(false) }
		);
	}
	if (items.length) items.push({ sep: true });
	items.push({ key: "theme", label: dark ? __("Switch to light mode") : __("Switch to dark mode"), icon: dark ? icons.sun() : icons.moon(), act: () => page.toggle_theme() });
	items.push({ key: "standard", label: __("Open standard report"), icon: icons.open(), act: () => page.open_standard_report() });
	if (is_manager()) items.push({ key: "settings", label: __("Report View settings"), icon: icons.gear(), act: () => page.open_settings() });
	open_menu(page, anchor, items, __("More"), 248);
}

/** Group by ▾: the columns a group level may be, ticked when they are one; «No grouping». */
export function open_group_menu(page, anchor) {
	const c = page.controls;
	const by = page.state?.group.by || [];
	const items = c.group_keys().map((key) => ({
		key: `group:${key}`,
		label: c.title(key),
		check: by.includes(key) ? icons.check_sm() : "",
		act: () => c.set_group(by.includes(key) ? by.filter((k) => k !== key) : [...by, key]),
	}));
	if (!items.length) items.push({ label: __("No column to group by"), disabled: true, act: () => {} });
	items.push({ sep: true }, { key: "group:none", label: __("No grouping"), disabled: !by.length, act: () => c.set_group([]) });
	open_menu(page, anchor, items, __("Group by"), 260);
}

/** Density ▾ (layout C): comfortable or compact. */
export function open_density_menu(page, anchor) {
	const d = page.features.density ? page.density : "comfortable";
	const items = [
		{ key: "comfortable", label: __("Comfortable"), check: d === "comfortable" ? icons.check_sm() : "", act: () => page.set_density("comfortable") },
		{ key: "compact", label: __("Compact"), check: d === "compact" ? icons.check_sm() : "", act: () => page.set_density("compact") },
	];
	open_menu(page, anchor, items, __("Density"), 200);
}
