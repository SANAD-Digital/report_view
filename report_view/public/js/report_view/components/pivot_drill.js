// Drill-down of a pivot cell (docs/architecture.md §11.1 #68; design: the "constituents"
// popover of Main.dc.html, reference/design/screens/pivot_drill.png): the rows of the report
// behind one value, largest first. They come from a temporary engine view filtered by the
// row path and the column path of the cell (ReportSession.pivot_drill), deleted in `finally`
// before anything is drawn. Each row is shown with the report's own values.

import { open_popover } from "./popover.js";
import { esc, fmt_int } from "../util.js";

export const DRILL_LIMIT = 200;

/**
 * @param {object} o
 * @param {HTMLElement} o.root the .rv element
 * @param {object} o.cell PivotView cell_info(): {title, value_title, total_html, value, anchor}
 * @param {() => Promise<{count: number, rids: number[]}>} o.load reads the rows (temporary view)
 * @param {(rid: number) => object|null} o.row_of the report row of a __rid
 * @param {(row: object) => string} o.label_html what names a row (markup, no link)
 * @param {(row: object) => {html: string, sign: string}} o.value_of the cell's measure of a row
 */
export function open_pivot_drill({ root, cell, load, row_of, label_html, value_of }) {
	const content = document.createElement("div");
	content.className = "rv-pv-drill";
	content.innerHTML = `
		<div class="rv-pop-hd"><span>${esc(cell.title)}</span><span class="ltr">${cell.total_html}</span></div>
		<div class="rv-zone-empty rv-pv-sub">${esc(__("Loading…"))}</div>
		<div class="rv-pv-list" role="list"></div>`;
	const handle = open_popover({
		root,
		anchor: cell.anchor,
		content,
		width: 360,
		cls: "rv-pv-pop",
		label: __("Rows behind this value"),
	});
	// The focus goes into the popover: Escape closes it and gives the focus back to the cell.
	handle.el.tabIndex = -1;
	handle.el.focus({ preventScroll: true });
	const sub = content.querySelector(".rv-pv-sub");
	const list = content.querySelector(".rv-pv-list");
	load()
		.then(({ count, rids }) => {
			if (!handle.el.isConnected) return;
			const rows = rids.map(row_of).filter(Boolean);
			const n = fmt_int(count);
			sub.textContent =
				count > rows.length
					? __("{0} · {1} rows, the largest {2} shown", [cell.value_title, n, rows.length])
					: __("{0} · {1} rows", [cell.value_title, n]);
			sub.dataset.count = String(count);
			list.innerHTML = rows
				.map((row) => {
					const v = value_of(row);
					return `<div class="rv-pv-item" role="listitem"><span class="nm">${label_html(row)}</span><span class="v${v.sign ? ` ${v.sign}` : ""}">${v.html}</span></div>`;
				})
				.join("");
			handle.place();
		})
		.catch(() => {
			if (handle.el.isConnected) sub.textContent = __("The rows could not be read");
		});
	return handle;
}
