// Status bar under the grid (docs/architecture.md §11.1 #66): rows shown of the report's
// rows and the number of groups. Counts come from the engine result.

function esc(s) {
	return frappe.utils.escape_html(String(s ?? ""));
}

function num(n) {
	return `<b>${esc(frappe.format(n, { fieldtype: "Int" }, { inline: true }))}</b>`;
}

export class StatusBar {
	constructor({ parent }) {
		const el = document.createElement("footer");
		el.className = "rv-status";
		el.innerHTML = `<div class="rv-status-grp"></div><div class="rv-status-grp"><span class="rv-status-hint"></span></div>`;
		parent.appendChild(el);
		this.el = el;
		this.clear();
	}

	clear() {
		this.el.firstElementChild.innerHTML = "";
		this.el.hidden = true;
	}

	/** @param {object} result engine.apply() output */
	update(result) {
		const items = [`<span class="rv-status-item">${__("Rows {0} of {1}", [num(result.row_count), num(result.fact_count)])}</span>`];
		if (result.group_count) {
			items.push(`<span class="rv-status-item">${__("Groups {0}", [num(result.group_count)])}</span>`);
		}
		this.el.firstElementChild.innerHTML = items.join("");
		this.el.hidden = false;
	}
}
