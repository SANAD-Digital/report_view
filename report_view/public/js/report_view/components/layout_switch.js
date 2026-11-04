// «Design ▾»: switches the report between the standard page and the two trial layouts
// (ADR-025), the same report with the same filters and view (the URL's query is kept), so
// the owner can compare them. One button in every head: header.js, header_a.js, header_c.js.

import { icons } from "./icons.js";
import { open_popover, close_popover, menu_content } from "./popover.js";
import { esc } from "../util.js";

const LAYOUTS = [
	{ key: "classic", route: "report-view", label: () => __("Standard design") },
	{ key: "a", route: "report-view-a", label: () => __("Design A") },
	{ key: "c", route: "report-view-c", label: () => __("Design C") },
];

/** The url of this report on the page of a layout, with the current query (filters, view). */
export function layout_url(route, report_name, search = window.location.search) {
	return `/desk/${route}/${encodeURIComponent(report_name || "")}${search || ""}`;
}

/**
 * @param {object} page the ReportViewPage
 * @param {string} cls the class of the head's buttons
 * @returns {HTMLButtonElement}
 */
export function make_layout_switch(page, cls) {
	const b = document.createElement("button");
	b.type = "button";
	b.className = cls;
	b.dataset.action = "layout";
	b.setAttribute("aria-haspopup", "menu");
	const label = __("Design");
	b.title = label;
	b.innerHTML = `<span>${esc(label)}</span>${icons.chevron_down(12)}`;
	b.addEventListener("click", () => {
		const current = page.layout || "classic";
		const items = LAYOUTS.map((l) => ({
			key: l.key,
			label: l.label(),
			check: l.key === current ? "✓" : "",
			act: () => {
				close_popover();
				if (l.key !== current) window.location.assign(layout_url(l.route, page.report_name));
			},
		}));
		const content = menu_content(items, "");
		open_popover({ root: page.root, anchor: b, content, width: 200, role: "menu", label, align: "end" });
		content.querySelector(".rv-mi")?.focus();
	});
	return b;
}
