// Notices of the current view above the grid: what the view state asks for and the screen
// does not do (filters Perspective cannot express), and the report's own subtotal rows that
// left the screen with a filter, a grouping or a sort.
// One bar, built once per distinct set of notices; closing it keeps that set closed.

import { icons } from "./icons.js";

function esc(s) {
	return frappe.utils.escape_html(String(s ?? ""));
}

const FILTER_TEXTS = {
	FILTER_SEARCH_UNSUPPORTED: () => __("The free-text search is not applied on screen."),
	FILTER_OP_UNSUPPORTED: (label) => __("The filter on {0} uses an operator that is not applied on screen.", [label]),
	FILTER_TYPE_MISMATCH: (label) => __("The filter on {0} does not fit the type of the column and is not applied.", [label]),
	FILTER_EMPTY_WITH_VALUES: (label) =>
		__("The filter on {0} cannot combine empty cells with other values: empty cells are left out.", [label]),
	FILTER_UNKNOWN_COLUMN: (label) => __("A filter refers to a column that is not in this report: {0}", [label]),
};

/**
 * @param {Array<{code: string, detail: any}>} notices post.notices of the view config
 * @param {Array} columns normalized columns (labels)
 * @returns {{signature: string, tone: "warn"|"info", lines: string[]}|null}
 */
export function describe_notices(notices, columns) {
	if (!notices?.length) return null;
	const label_of = (key) => columns.find((c) => c.key === key)?.label || key;
	const lines = [];
	let filters = 0;
	for (const n of notices) {
		if (FILTER_TEXTS[n.code]) {
			lines.push(FILTER_TEXTS[n.code](__(label_of(n.detail))));
			filters += 1;
		} else if (n.code === "PIVOT_TOO_MANY_COLUMNS") {
			lines.push(
				__("The pivot columns would make {0} columns, more than {1}: the pivot is shown without them. Choose a dimension with fewer values, or filter the rows.", [
					n.detail,
					n.limit,
				])
			);
		} else if (n.code === "REPORT_ROWS_HIDDEN") {
			lines.push(
				__("{0} subtotal rows of the report itself (opening, total and closing of its own groups) are hidden while a filter, a grouping or a sort is applied: they describe the report as it came, not the rows shown now.", [
					n.detail,
				])
			);
		}
	}
	if (!lines.length) return null;
	if (filters) lines.push(__("Excel export is not available while these filters are set: the file would not match the screen. Remove them to export."));
	return { signature: JSON.stringify(notices), tone: filters ? "warn" : "info", lines: [...new Set(lines)] };
}

export class NoticeBar {
	constructor({ parent, before }) {
		this.el = document.createElement("div");
		this.el.className = "rv-notice";
		this.el.hidden = true;
		this.el.setAttribute("role", "status");
		parent.insertBefore(this.el, before || null);
		this.signature = null;
		this.closed = null;
		this.el.addEventListener("click", (e) => {
			if (!e.target.closest(".rv-chip-x")) return;
			this.closed = this.signature;
			this.el.hidden = true;
		});
	}

	/** @param {object|null} notice describe_notices() output */
	show(notice) {
		if (!notice) {
			this.signature = null;
			this.el.hidden = true;
			this.el.replaceChildren();
			return;
		}
		if (notice.signature === this.signature) return;
		this.signature = notice.signature;
		const close = esc(__("Close"));
		this.el.className = `rv-notice ${notice.tone}`;
		this.el.innerHTML =
			`${icons.alert()}<div class="rv-notice-bd">${notice.lines.map((l) => `<p>${esc(l)}</p>`).join("")}</div>` +
			`<button type="button" class="rv-chip-x" aria-label="${close}" title="${close}">${icons.close()}</button>`;
		this.el.hidden = notice.signature === this.closed;
	}
}
