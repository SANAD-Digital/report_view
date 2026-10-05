// Tool panels at the side of the grid (docs/architecture.md §11.1 #61-#65; design:
// reference/design/screens/sidecols.png, sidefilters.png): the vertical tabs "Columns" and
// "Filters" and their panels. Columns: show / hide with a type tag, the row-group zone, the
// value zone with its aggregate, and the Pivot zone (shown, off until phase 5b). Filters: a
// section per column (contains, values with counts, from / to) and the quick filters.
// Everything is written to the view state through the host; values and counts come from
// temporary engine views the host deletes in `finally`.

import { icons } from "./icons.js";
import { SetList } from "./set_filter.js";
import { DRAG_COLUMN, accepts, dragged } from "./group_panel.js";

function esc(s) {
	return frappe.utils.escape_html(String(s ?? ""));
}

const AGGS = [
	["sum", "Sum"],
	["avg", "Average"],
	["count", "Count"],
	["min", "Minimum"],
	["max", "Maximum"],
];

export class SidePanel {
	/**
	 * @param {object} o
	 * @param {HTMLElement} o.body the .rv-body row (grid, panel, tabs)
	 * @param {object} o.host {side(), set_side(name|null), columns(), filters(), toggle_column(key, on),
	 *        set_group(by), groupable(key), set_agg(key, agg), clear_filters(), set_filter(key, filter|null),
	 *        load_values(key), toggle_quick(id)}
	 */
	constructor({ body, host }) {
		this.host = host;
		this.open_sections = new Map();
		this.col_query = "";
		const panel = document.createElement("aside");
		panel.className = "rv-panel";
		panel.hidden = true;
		const tabs = document.createElement("nav");
		tabs.className = "rv-sidetabs";
		tabs.setAttribute("aria-label", __("Tool panels"));
		tabs.innerHTML = `
			<button type="button" class="rv-sidetab" data-side="columns" aria-expanded="false">${icons.columns()}<span>${esc(__("Columns"))}</span></button>
			<button type="button" class="rv-sidetab" data-side="filters" aria-expanded="false">${icons.funnel(15)}<span>${esc(__("Filters", null, "Report View"))}</span><i class="rv-tabcount" hidden></i></button>`;
		body.append(panel, tabs);
		this.panel = panel;
		this.tabs = tabs;
		for (const b of tabs.querySelectorAll("[data-side]")) {
			b.addEventListener("click", () => host.set_side(host.side() === b.dataset.side ? null : b.dataset.side));
		}
	}

	/** Builds the open panel again from the view state (a focused text input is kept). */
	refresh() {
		const side = this.host.side();
		const filters = this.host.filters();
		for (const b of this.tabs.querySelectorAll("[data-side]")) {
			const on = b.dataset.side === side;
			b.classList.toggle("on", on);
			b.setAttribute("aria-expanded", on ? "true" : "false");
		}
		const count = this.tabs.querySelector(".rv-tabcount");
		count.hidden = !filters.active;
		count.textContent = filters.active ? frappe.format(filters.active, { fieldtype: "Int" }, { inline: true }) : "";
		this.panel.hidden = !side;
		if (!side) {
			this.panel.replaceChildren();
			this.shown = null;
			return;
		}
		const typing = this.panel.contains(document.activeElement) && document.activeElement.matches('input[type="text"]');
		if (typing && this.shown === side) {
			const badge = this.panel.querySelector(".rv-panel-hd .rv-count-badge");
			if (badge) {
				badge.hidden = !filters.active;
				badge.textContent = count.textContent;
			}
			return;
		}
		this.shown = side;
		if (side === "columns") this.columns_panel();
		else this.filters_panel(filters);
	}

	header(title, extra = "") {
		return `<div class="rv-panel-hd"><strong>${esc(title)}</strong>${extra}<span class="sp"></span>
			<button type="button" class="rv-btn icon sm ghost" data-action="close" aria-label="${esc(__("Close the panel"))}" title="${esc(__("Close the panel"))}">${icons.x_md()}</button></div>`;
	}

	bind_close() {
		this.panel.querySelector('[data-action="close"]').addEventListener("click", () => this.host.set_side(null));
	}

	// ------------------------------------------------------------ columns

	columns_panel() {
		const data = this.host.columns();
		const q = this.col_query.toLowerCase();
		const list = data.items
			.filter((it) => !q || it.label.toLowerCase().includes(q))
			.map(
				(it) => `<div class="rv-colitem" draggable="true" data-key="${esc(it.key)}">
					<span class="rv-grip">${icons.grip()}</span>
					<label class="rv-check"><input type="checkbox" data-col="${esc(it.key)}" ${it.on ? "checked" : ""} ${it.locked ? "disabled" : ""}><span>${esc(it.label)}</span></label>
					<span class="rv-coltag${it.tag === "dim" ? " dim" : ""}">${esc(it.tag === "num" ? "123" : it.tag === "dim" ? __("Dim.") : "Aa")}</span>
				</div>`
			)
			.join("");
		const remove = esc(__("Remove", null, "Report View"));
		const groups = data.groups
			.map(
				(g, i) => `<div class="rv-zchip"><span class="rv-grip">${icons.grip()}</span><span class="lbl">${esc(g.label)}</span>
					<button type="button" class="rv-chip-x" data-ungroup="${i}" aria-label="${remove}" title="${remove}">${icons.close()}</button></div>`
			)
			.join("");
		const values = data.values
			.map(
				(v) => `<div class="rv-zchip"><span class="lbl">${esc(v.label)}</span>
					<select data-agg="${esc(v.key)}" aria-label="${esc(__("Aggregate function"))}">${AGGS.map(
						([id, label]) => `<option value="${id}" ${v.agg === id ? "selected" : ""}>${esc(__(label, null, "Report View"))}</option>`
					).join("")}</select>
					<button type="button" class="rv-chip-x" data-hide="${esc(v.key)}" aria-label="${remove}" title="${remove}">${icons.close()}</button></div>`
			)
			.join("");
		// The pivot mode and its zone join this panel when they work (phase 5b).
		this.panel.innerHTML = `${this.header(__("Columns"))}
			<div class="rv-panel-bd">
				<input type="text" class="rv-input sm" data-action="col-search" aria-label="${esc(__("Search the columns"))}" placeholder="${esc(__("Search the columns…"))}" value="${esc(this.col_query)}">
				<div class="rv-collist">${list}</div>
				<div class="rv-zone" data-zone="groups">
					<div class="rv-zone-hd">${icons.group()}${esc(__("Row groups"))}</div>
					${groups ? `<div class="rv-zone-chips">${groups}</div>` : `<div class="rv-zone-empty">${esc(__("Drag columns here to group the rows"))}</div>`}
				</div>
				<div class="rv-zone" data-zone="values">
					<div class="rv-zone-hd">${icons.sigma()}${esc(__("Values"))}</div>
					${values ? `<div class="rv-zone-chips">${values}</div>` : `<div class="rv-zone-empty">${esc(__("Drag a numeric column here"))}</div>`}
				</div>
			</div>`;
		this.bind_close();
		const search = this.panel.querySelector('[data-action="col-search"]');
		search.addEventListener("input", () => {
			this.col_query = search.value;
			this.columns_panel();
			const again = this.panel.querySelector('[data-action="col-search"]');
			again.focus();
			again.setSelectionRange(again.value.length, again.value.length);
		});
		for (const item of this.panel.querySelectorAll(".rv-colitem")) {
			item.addEventListener("dragstart", (e) => {
				e.dataTransfer.setData(DRAG_COLUMN, item.dataset.key);
				e.dataTransfer.effectAllowed = "copyMove";
			});
		}
		for (const box of this.panel.querySelectorAll("[data-col]")) {
			box.addEventListener("change", () => this.host.toggle_column(box.dataset.col, box.checked));
		}
		for (const b of this.panel.querySelectorAll("[data-ungroup]")) {
			b.addEventListener("click", () => this.host.set_group(data.groups.filter((_, i) => i !== Number(b.dataset.ungroup)).map((g) => g.key)));
		}
		for (const sel of this.panel.querySelectorAll("[data-agg]")) {
			sel.addEventListener("change", () => this.host.set_agg(sel.dataset.agg, sel.value));
		}
		for (const b of this.panel.querySelectorAll("[data-hide]")) {
			b.addEventListener("click", () => this.host.toggle_column(b.dataset.hide, false));
		}
		const zone = (name, drop) => {
			const z = this.panel.querySelector(`[data-zone="${name}"]`);
			z.addEventListener("dragover", (e) => {
				if (!accepts(e)) return;
				e.preventDefault();
				z.classList.add("drop");
			});
			z.addEventListener("dragleave", (e) => {
				if (!z.contains(e.relatedTarget)) z.classList.remove("drop");
			});
			z.addEventListener("drop", (e) => {
				z.classList.remove("drop");
				const d = dragged(e);
				if (!d || d.type !== "column") return;
				e.preventDefault();
				drop(d.key);
			});
		};
		zone("groups", (key) => {
			const by = data.groups.map((g) => g.key);
			if (!by.includes(key) && this.host.groupable(key)) this.host.set_group([...by, key]);
		});
		zone("values", (key) => {
			const it = data.items.find((i) => i.key === key);
			if (it && it.tag === "num" && !it.on) this.host.toggle_column(key, true);
		});
	}

	// ------------------------------------------------------------ filters

	filters_panel(filters) {
		const sections = filters.sections;
		const badge = `<span class="rv-count-badge"${filters.active ? "" : " hidden"}>${esc(filters.active ? frappe.format(filters.active, { fieldtype: "Int" }, { inline: true }) : "")}</span>`;
		this.panel.innerHTML = `${this.header(__("Filters", null, "Report View"), badge)}<div class="rv-panel-bd"></div>`;
		const clear = document.createElement("button");
		clear.type = "button";
		clear.className = "rv-link";
		clear.textContent = __("Clear all");
		clear.addEventListener("click", () => this.host.clear_filters());
		this.panel.querySelector(".rv-panel-hd .sp").after(clear);
		this.bind_close();
		const bd = this.panel.querySelector(".rv-panel-bd");
		sections.forEach((s, i) => {
			const open = this.open_sections.has(s.id) ? this.open_sections.get(s.id) : s.active || s.open_default;
			const sec = document.createElement("div");
			sec.className = "rv-fsec";
			sec.innerHTML = `<button type="button" class="rv-fsec-hd" aria-expanded="${open}">
					<span class="${open ? "open" : ""}">${icons.chevron_end(14)}</span>
					<span class="lbl">${esc(s.label)}</span>${s.active ? `<span class="rv-dot" title="${esc(__("Active filter"))}"></span>` : ""}
				</button>`;
			sec.querySelector(".rv-fsec-hd").addEventListener("click", () => {
				this.open_sections.set(s.id, !open);
				this.filters_panel(this.host.filters());
			});
			if (open) {
				const body = document.createElement("div");
				body.className = "rv-fsec-bd";
				sec.appendChild(body);
				this.section_body(s, body);
			}
			bd.appendChild(sec);
			if (i === 0) sec.dataset.first = "1";
		});
	}

	section_body(s, body) {
		const debounce = (fn) => {
			let t = null;
			return (...a) => {
				clearTimeout(t);
				t = setTimeout(() => fn(...a), 350);
			};
		};
		if (s.kind === "text") {
			body.innerHTML = `<input type="text" class="rv-input sm" aria-label="${esc(s.label)}" placeholder="${esc(__("Contains…"))}" value="${esc(s.value || "")}">`;
			const input = body.querySelector("input");
			const apply = debounce(() => this.host.set_filter(s.key, input.value.trim() ? { key: s.key, type: "text", op: "contains", value: input.value.trim() } : null));
			input.addEventListener("input", apply);
		} else if (s.kind === "range" || s.kind === "date") {
			const ph = s.kind === "date" ? frappe.datetime.get_user_date_fmt?.() || "" : "";
			body.innerHTML = `<div class="rv-range">
				<input type="text" inputmode="${s.kind === "date" ? "numeric" : "decimal"}" class="rv-input sm num" data-edge="min" aria-label="${esc(__("From"))}" placeholder="${esc(ph || __("From"))}" value="${esc(s.min ?? "")}">
				<span>${esc(__("to"))}</span>
				<input type="text" inputmode="${s.kind === "date" ? "numeric" : "decimal"}" class="rv-input sm num" data-edge="max" aria-label="${esc(__("To"))}" placeholder="${esc(ph || __("To"))}" value="${esc(s.max ?? "")}">
			</div>`;
			const [a, b] = body.querySelectorAll("input");
			const apply = debounce(() => this.host.set_range(s.key, s.kind, a.value, b.value));
			a.addEventListener("input", apply);
			b.addEventListener("input", apply);
		} else if (s.kind === "quick") {
			body.innerHTML = s.items
				.map(
					(it, i) =>
						`<label class="rv-setitem"><span class="rv-check"><input type="checkbox" data-q="${i}" ${it.on ? "checked" : ""}><span>${esc(it.label)}</span></span></label>`
				)
				.join("");
			for (const box of body.querySelectorAll("[data-q]")) {
				box.addEventListener("change", () => s.items[Number(box.dataset.q)].toggle());
			}
		} else if (s.kind === "set") {
			body.innerHTML = `<div class="rv-zone-empty">${esc(__("Loading…"))}</div>`;
			const wrap = document.createElement("div");
			const list = new SetList({
				parent: wrap,
				on_change: (selected) => this.host.set_filter(s.key, selected ? { key: s.key, type: "set", values: selected, exclude: false } : null),
			});
			list.el.classList.add("short");
			this.host
				.load_values(s.key)
				.then((out) => {
					list.set({ values: out.values, all: out.values.map((v) => v.value), selected: s.selected });
					body.replaceChildren(wrap);
				})
				.catch(() => {
					body.innerHTML = `<div class="rv-zone-empty">${esc(__("The values could not be read"))}</div>`;
				});
		}
	}
}
