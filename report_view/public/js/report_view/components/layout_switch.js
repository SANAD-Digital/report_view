// «Design ▾»: switches the report between the standard page, the two trial layouts (ADR-025)
// and Frappe's own report page, the same report with the same filters and view (the URL's
// query is kept). One button in every head: header.js, header_a.js, header_c.js.
// Frappe's page chosen here stays the choice for this report in this tab (view_choice.js),
// whatever the site opens a report in.

import { icons } from "./icons.js";
import { open_popover, close_popover, menu_content } from "./popover.js";
import { esc } from "../util.js";
import { REPORT_VIEWS, report_url, stay_on_system } from "../view_choice.js";

const LAYOUTS = [
	{ key: "classic", route: "report-view", label: REPORT_VIEWS[0].label },
	{ key: "a", route: "report-view-a", label: REPORT_VIEWS[1].label },
	{ key: "c", route: "report-view-c", label: REPORT_VIEWS[2].label },
	{ key: "system", route: "query-report", label: () => __("System page") },
];

/** The url of this report on the page of a layout, with the current query (filters, view). */
export function layout_url(route, report_name, search = window.location.search) {
	return report_url(route, report_name, search);
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
				if (l.key === current) return;
				stay_on_system("report", page.report_name, l.key === "system");
				window.location.assign(layout_url(l.route, page.report_name));
			},
		}));
		const content = menu_content(items, "");
		open_popover({ root: page.root, anchor: b, content, width: 200, role: "menu", label, align: "end" });
		content.querySelector(".rv-mi")?.focus();
	});
	return b;
}
