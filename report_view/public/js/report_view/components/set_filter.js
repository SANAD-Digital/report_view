// Set filter (docs/architecture.md §11.1 #44; design: reference/design/screens/setfilter.png):
// the unique values of a column with the number of rows of each, "(Select all)", a search,
// and "Clear". The values and counts come from a temporary Perspective view (group_by on the
// column, under the other filters) that the page deletes in `finally` (§8أ.4); the search
// asks the engine again (a "contains" filter). The selection is the set filter of the view
// state: no filter = everything selected.

import { open_popover } from "./popover.js";

function esc(s) {
	return frappe.utils.escape_html(String(s ?? ""));
}

const NULL_KEY = "\u0000";
const key_of = (v) => (v === null || v === undefined || v === "" ? NULL_KEY : String(v));

/** The selection after a value is switched (null = all selected). */
export function toggle_value(selected, all, value) {
	const k = key_of(value);
	const cur = selected ? [...selected] : [...all];
	const at = cur.findIndex((v) => key_of(v) === k);
	if (at >= 0) cur.splice(at, 1);
	else cur.push(value);
	const keys = new Set(cur.map(key_of));
	return all.every((v) => keys.has(key_of(v))) ? null : cur;
}

/** The list of values with their checkboxes (.rv-setlist), in a popover or a panel. */
export class SetList {
	/**
	 * @param {object} o {parent, on_change(selected|null), max_height}
	 */
	constructor({ parent, on_change }) {
		this.on_change = on_change;
		this.el = document.createElement("div");
		this.el.className = "rv-setlist";
		parent.appendChild(this.el);
		this.values = [];
		this.all = [];
		this.selected = null;
	}

	/**
	 * @param {object} s {values: [{value, label_html, count}] shown, all: [value] of the column,
	 *        selected: [value]|null, total: number of values, truncated}
	 */
	set({ values, all, selected }) {
		this.values = values;
		this.all = all;
		this.selected = selected;
		const on = new Set((selected || []).map(key_of));
		const is_on = (v) => !selected || on.has(key_of(v));
		const n = (x) => esc(frappe.format(x, { fieldtype: "Int" }, { inline: true }));
		const count = selected ? selected.length : all.length;
		const rows = values
			.map(
				(v, i) =>
					`<label class="rv-setitem"><span class="rv-check"><input type="checkbox" data-i="${i}" ${is_on(v.value) ? "checked" : ""}><span>${v.label_html}</span></span><span class="cnt">${n(v.count)}</span></label>`
			)
			.join("");
		this.el.innerHTML =
			`<label class="rv-setitem all"><span class="rv-check"><input type="checkbox" data-all ${selected ? "" : "checked"}><span>${esc(__("(Select all)"))}</span></span>` +
			`<span class="cnt"><bdi>${n(count)} / ${n(all.length)}</bdi></span></label>` +
			(rows || `<div class="rv-zone-empty">${esc(__("No values"))}</div>`);
		const all_box = this.el.querySelector("[data-all]");
		all_box.indeterminate = Boolean(selected && selected.length);
		all_box.addEventListener("change", () => this.emit(selected ? null : []));
		for (const box of this.el.querySelectorAll("[data-i]")) {
			box.addEventListener("change", () => this.emit(toggle_value(this.selected, this.all, values[Number(box.dataset.i)].value)));
		}
	}

	emit(selected) {
		this.set({ values: this.values, all: this.all, selected });
		this.on_change(selected);
	}
}

/**
 * Opens the set filter of a column.
 * @param {object} o
 * @param {HTMLElement} o.root
 * @param {HTMLElement} o.anchor
 * @param {string} o.title the column
 * @param {(search: string) => Promise<{values: Array<{value, label_html, count}>}>} o.load
 * @param {Array|null} o.selected
 * @param {(selected: Array|null) => void} o.on_change
 */
export function open_set_filter({ root, anchor, title, load, selected, on_change }) {
	const box = document.createElement("div");
	box.innerHTML = `
		<div class="rv-pop-hd"><span>${esc(__("Value filter · {0}", [title]))}</span><button type="button" class="rv-link" data-action="clear">${esc(__("Clear", null, "Report View"))}</button></div>
		<div class="rv-pop-sec"><input type="text" class="rv-input sm rv-set-search" aria-label="${esc(__("Search the values"))}" placeholder="${esc(__("Search the values…"))}"></div>
		<div class="rv-set-body"></div>`;
	const body = box.querySelector(".rv-set-body");
	let all = [];
	let current = selected;
	const list = new SetList({
		parent: body,
		on_change: (sel) => {
			current = sel;
			on_change(sel);
		},
	});
	let token = 0;
	const fill = async (search = "") => {
		const mine = ++token;
		const out = await load(search);
		if (mine !== token || handle.closed) return;
		if (!search) all = out.values.map((v) => v.value);
		list.set({ values: out.values, all, selected: current });
		handle.place();
	};
	const handle = open_popover({ root, anchor, content: box, cls: "rv-set-pop", width: 264, label: __("Value filter · {0}", [title]) });
	box.querySelector('[data-action="clear"]').addEventListener("click", () => {
		current = null;
		list.set({ values: list.values, all, selected: null });
		on_change(null);
	});
	const search = box.querySelector(".rv-set-search");
	let timer = null;
	search.addEventListener("input", () => {
		clearTimeout(timer);
		timer = setTimeout(() => fill(search.value.trim()), 250);
	});
	fill().catch(() => {
		body.innerHTML = `<div class="rv-zone-empty">${esc(__("The values could not be read"))}</div>`;
	});
	search.focus();
	return handle;
}
